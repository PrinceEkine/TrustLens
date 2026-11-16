// Pure, DOM-free helpers: deterministic PII pre-scrub (defense in depth),
// safe JSON extraction, and tiny text renderers. Importable from Node tests.

const PII_PATTERNS = [
  { type: 'email', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'upi', re: /[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}/g },
  { type: 'phone', re: /(?<!\d)(?:\+?\d{1,3}[-.\s]?)?(?:\d[-.\s]?){7,12}\d(?!\d)/g },
  { type: 'card', re: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g },
  { type: 'aadhaar', re: /(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)/g },
  { type: 'url-query', re: /(https?:\/\/[^\s?]+)\?[^\s]*/g },
];

/** Match spans of each PII pattern against the ORIGINAL text, skipping
 *  overlaps (first pattern wins). Powers the redaction diff view. */
export function prescrubSpans(text) {
  const src = String(text ?? '');
  const spans = [];
  const claimed = (s, e) => spans.some((sp) => s < sp.end && e > sp.start);
  for (const { type, re } of PII_PATTERNS) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (!claimed(s, e)) spans.push({ start: s, end: e, type });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/** Deterministic regex pre-scrub. The on-device model does the smart
 *  redaction; this is a cheap safety net applied before anything reaches stage 2. */
export function prescrub(text) {
  let out = String(text ?? '');
  let count = 0;
  for (const { type, re } of PII_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      count += 1;
      if (type === 'url-query') return m.split('?')[0] + '?…';
      const keep = m.length <= 4 ? 0 : 2;
      return m.slice(0, keep) + '•'.repeat(Math.max(3, Math.min(m.length - keep, 12))) + `[${type}]`;
    });
  }
  return { text: out, count };
}

export function stripCodeFences(s) {
  return String(s ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/** Extract the first {...} JSON object from model output, tolerantly. */
export function safeJsonParse(s) {
  const clean = stripCodeFences(s);
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Minimal safe markdown: headings, bold, bullets, numbered lists, paragraphs. */
export function renderLiteMarkdown(src) {
  const lines = String(src ?? '').split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { html += list === 'ul' ? '</ul>' : '</ol>'; list = null; } };
  const inline = (t) => escapeHtml(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeList(); const lvl = Math.min(h[1].length + 2, 4); html += `<h${lvl}>${inline(h[2])}</h${lvl}>`; continue; }
    const ul = line.match(/^[-*•]\s+(.*)/);
    if (ul) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(ul[1])}</li>`; continue; }
    const ol = line.match(/^\d+[.)]\s+(.*)/);
    if (ol) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(ol[1])}</li>`; continue; }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html || '<p class="muted">No details.</p>';
}

export function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Approximate token guard for the on-device 9216-token context window. */
export function truncateForDevice(text, maxChars) {
  const t = String(text ?? '');
  if (t.length <= maxChars) return { text: t, truncated: false };
  return { text: t.slice(0, maxChars) + '\n[…trimmed for on-device context…]', truncated: true };
}
