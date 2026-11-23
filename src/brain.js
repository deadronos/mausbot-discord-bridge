import { thinkGbot } from './gbot.js';

/**
 * Brain backends for the Discord bridge.
 *
 * - openai_compat: call an OpenAI-compatible chat API (xAI Grok API works)
 * - webhook: POST the inbound event to your own inbox (Grok Bot routine / custom service)
 * - log_only: dry-run for wiring tests
 *
 * None of these backends ever receive or return Discord tokens.
 */

export async function think(cfg, payload) {
  if (cfg.brainMode === 'gbot') return thinkGbot(cfg, payload);
  if (cfg.brainMode === 'log_only') {
    return {
      text: `[log_only] heard from ${payload.authorTag}: ${payload.text.slice(0, 200)}`,
    };
  }

  if (cfg.brainMode === 'webhook') {
    if (!cfg.webhook.url) throw new Error('WEBHOOK_URL required for BRAIN_MODE=webhook');
    const headers = { 'content-type': 'application/json' };
    if (cfg.webhook.authHeader) headers.authorization = cfg.webhook.authHeader;
    const res = await fetch(cfg.webhook.url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        source: 'discord',
        text: payload.text,
        author_id: payload.authorId,
        author_tag: payload.authorTag,
        is_bot: payload.isBot,
        channel_id: payload.channelId,
        guild_id: payload.guildId,
        isDM: Boolean(payload.isDM),
        message_id: payload.messageId,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`webhook ${res.status}: ${cfg.webhook.async ? 'rejected' : body.slice(0, 300)}`);
    }
    if (cfg.webhook.async) return { silent: true, handoff: false };
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const data = await res.json();
      const text = data.reply || data.text || data.message || JSON.stringify(data);
      return { text: String(text) };
    }
    return { text: (await res.text()).slice(0, 1800) };
  }

  // openai_compat
  if (!cfg.openai.apiKey) throw new Error('OPENAI_API_KEY required for BRAIN_MODE=openai_compat');
  const url = `${cfg.openai.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.openai.model,
      messages: [
        { role: 'system', content: cfg.systemPrompt },
        {
          role: 'user',
          content:
            `Discord message from ${payload.authorTag} (id=${payload.authorId}, bot=${payload.isBot})\n` +
            `channel=${payload.channelId} guild=${payload.guildId} message_id=${payload.messageId}\n\n` +
            payload.text,
        },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`openai_compat ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('openai_compat returned empty content');
  return { text: String(text).trim() };
}
