import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { splitMessage } from './splitMessage.js';

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}

function readBody(req, maxBytes = 20000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Loopback-only HTTP endpoint so the local MausBot can ask the bridge to post a
 * message. The bridge keeps owning the Discord token; callers get only a narrow
 * "send text to an allowed channel" capability guarded by a separate secret.
 * Content and secrets are never logged.
 */
export function createSendApi(cfg, client, log = () => {}) {
  const secret = cfg.sendApi?.secret;
  if (!secret) return null;

  const channels = new Set(cfg.channelAllow || []);
  const dmUsers = new Set(cfg.dmAllow || []);
  const mentionUsers = [...(cfg.mentionAllow || [])];
  const port = cfg.sendApi.port;

  const server = http.createServer(async (req, res) => {
    const fail = (code, error) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error }));
    };
    try {
      if (req.method !== 'POST' || req.url !== '/send') return fail(404, 'not_found');
      const auth = String(req.headers.authorization || '');
      if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), secret)) return fail(401, 'unauthorized');

      let data;
      try { data = JSON.parse(await readBody(req)); } catch { return fail(400, 'bad_json'); }

      const channelId = String(data.channel_id || '');
      const userId = String(data.user_id || '');
      if (Boolean(channelId) === Boolean(userId)) return fail(400, 'need_exactly_one_target');

      let channel;
      if (userId) {
        // DMs use the same allowlist as inbound DMs; never open one to a bot.
        if (!dmUsers.has(userId)) return fail(403, 'user_not_allowed');
        const user = await client.users.fetch(userId);
        if (!user || user.bot) return fail(403, 'user_not_allowed');
        channel = await user.createDM();
      } else {
        if (!channels.has(channelId)) return fail(403, 'channel_not_allowed');
        channel = await client.channels.fetch(channelId);
      }
      if (!channel || typeof channel.send !== 'function') return fail(404, 'target_unavailable');

      const content = String(data.content || '').trim();
      if (!content || content.length > 12000) return fail(400, 'bad_content');
      const replyTo = data.reply_to ? String(data.reply_to) : null;
      if (replyTo && !/^\d{1,25}$/.test(replyTo)) return fail(400, 'bad_reply_to');

      const chunks = splitMessage(content, 1900);
      const base = { allowedMentions: { parse: [], users: mentionUsers, repliedUser: false } };
      await channel.send({ content: chunks[0], ...base, ...(replyTo ? { messageReference: { messageId: replyTo } } : {}) });
      for (let i = 1; i < chunks.length; i += 1) await channel.send({ content: chunks[i], ...base });

      log('info', 'send api delivered', { target: userId ? `dm:${userId}` : `channel:${channelId}`, chunks: chunks.length });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, chunks: chunks.length }));
    } catch {
      fail(500, 'send_failed');
    }
  });

  server.on('error', (err) => log('error', 'send api failed to start', { code: err?.code || 'unknown' }));
  server.once('listening', () => log('info', 'send api listening on loopback', { port: server.address()?.port || port }));
  server.listen(port, '127.0.0.1');
  return server;
}
