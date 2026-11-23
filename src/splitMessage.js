/** Split long Discord messages near the hard limit without breaking mid-code-fence naively. */

const DISCORD_SAFE = 1900;

export function splitMessage(text, limit = DISCORD_SAFE) {
  const t = String(text || '');
  if (t.length <= limit) return [t];

  const chunks = [];
  let rest = t;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.5)) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}
