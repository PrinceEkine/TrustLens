// DOM rendering helpers. No AI, no Firebase — pure presentation.
import { escapeHtml, renderLiteMarkdown } from './redact.js';

export const $ = (id) => document.getElementById(id);

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3200);
}

export function setPill(el, text, tone = '') {
  el.textContent = text;
  el.className = `pill ${tone}`;
}

export function setBadge(el, text, tone = 'idle') {
  el.textContent = text;
  el.className = `badge ${tone}`;
}

const ICON_PATHS = {
  check: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8.5 12.5 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M12 3 2.5 20h19L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/>',
  alert: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
  shield: '<path d="M12 2 4 5.5V11c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5.5L12 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m8.8 12 2.2 2.2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16.5 16.5 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

/** Official Google "G" (multicolor, never recolored) for the sign-in button. */
const GOOGLE_G = '<path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>';

export function icon(name, size = 18) {
  if (name === 'google') {
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${GOOGLE_G}</svg>`;
  }
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.warn}</svg>`;
}

export function verdictMeta(verdict) {
  return {
    safe: { icon: 'check', label: 'Looks safe', cls: 'safe' },
    suspicious: { icon: 'warn', label: 'Suspicious', cls: 'warn' },
    malicious: { icon: 'alert', label: 'Likely malicious', cls: 'bad' },
  }[verdict] ?? { icon: 'warn', label: 'Uncertain', cls: 'warn' };
}

export function renderStage1(s1, rc) {
  const m = verdictMeta(s1.verdict);
  const hi = rc.risk_high, mid = rc.risk_medium;
  const band = s1.riskScore >= hi ? 'bad' : s1.riskScore >= mid ? 'warn' : 'safe';
  return `<div class="mini-verdict ${band}"><span>${icon(m.icon)} ${m.label}</span><strong>${s1.riskScore}/100</strong></div>
    <p>${escapeHtml(s1.summary)}</p>
    <p class="muted small">${icon('lock', 14)} ${s1.piiCount} PII span${s1.piiCount === 1 ? '' : 's'} scrubbed on-device before anything left this tab.</p>`;
}

export function renderVerdict(s1) {
  const m = verdictMeta(s1.verdict);
  return `<div class="verdict ${m.cls}"><span class="v-icon">${icon(m.icon, 34)}</span>
    <div><h2>${m.label} — ${s1.riskScore}/100 risk</h2><p>${escapeHtml(s1.summary)}</p></div></div>`;
}

export function renderRisk(s1, rc) {
  const pct = Math.max(2, Math.min(100, s1.riskScore));
  const band = s1.riskScore >= rc.risk_high ? 'bad' : s1.riskScore >= rc.risk_medium ? 'warn' : 'safe';
  return `<div class="risk"><div class="risk-bar ${band}"><div style="width:${pct}%"></div>
    <i class="tick" style="left:${rc.risk_medium}%" title="medium threshold"></i>
    <i class="tick" style="left:${rc.risk_high}%" title="high threshold"></i></div>
    <div class="risk-scale"><span>0 safe</span><span>thresholds ${rc.risk_medium}/${rc.risk_high} (Remote Config)</span><span>100</span></div></div>`;
}

export function renderTactics(tactics) {
  if (!tactics.length) return '<p class="muted">No specific manipulation patterns flagged.</p>';
  return `<ul class="tactics">${tactics.map((t) => `<li><strong>${escapeHtml(t.label)}</strong>
    <span>${escapeHtml(t.why)}</span>${t.quote ? `<blockquote>“${escapeHtml(t.quote)}”</blockquote>` : ''}</li>`).join('')}</ul>`;
}

export function renderDeep(markdown) {
  return renderLiteMarkdown(markdown);
}

export function fmtMs(ms) {
  return ms < 1500 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function renderLinkXray(reports) {
  if (!reports.length) return '';
  const tone = { bad: 'bad', warn: 'warn', ok: 'safe', info: 'safe' };
  return `<ul class="links">${reports.map((r) => `<li class="link-card ${r.worst}">
    <div class="link-host">${icon(r.worst === 'ok' ? 'check' : 'warn', 15)} <strong>${escapeHtml(r.host || r.url)}</strong>
    <span class="link-risk">${r.risk}/100 link risk</span></div>
    <div class="link-url">${escapeHtml(r.url)}</div>
    <ul>${r.findings.map((f) => `<li><span class="flag ${tone[f.level] || 'safe'}">${escapeHtml(f.label)}</span>
    <span class="muted">${escapeHtml(f.detail)}</span></li>`).join('')}</ul></li>`).join('')}</ul>
    <p class="muted small">${icon('lock', 13)} Deterministic checks, computed on-device — not an AI verdict.</p>`;
}

const MASK_RE = /(\[[^\][\n]{1,24}\]|•{2,}|…(?=[\s.,;:!?)\]]|$))/g;

/** Highlight mask tokens ([NAME], •••[phone], ?…) inside redacted text. XSS-safe. */
export function highlightMasks(redacted) {
  return escapeHtml(redacted).replace(MASK_RE, '<mark class="mask">$1</mark>');
}

/** Highlight the original PII spans that were scrubbed. XSS-safe. */
export function highlightPii(original, spans) {
  const src = String(original ?? '');
  const valid = (spans || []).filter((sp) => sp.start >= 0 && sp.end > sp.start && sp.end <= src.length)
    .sort((a, b) => a.start - b.start);
  let html = '';
  let cur = 0;
  for (const sp of valid) {
    if (sp.start < cur) continue; // skip overlaps defensively
    html += escapeHtml(src.slice(cur, sp.start));
    html += `<mark class="pii" title="scrubbed: ${escapeHtml(sp.type)}">${escapeHtml(src.slice(sp.start, sp.end))}</mark>`;
    cur = sp.end;
  }
  return html + escapeHtml(src.slice(cur));
}

export function renderHistory(items) {
  if (!items.length) return '<li class="muted">Nothing yet — your redacted analyses will appear here.</li>';
  return items.map((it, i) => {
    const m = verdictMeta(it.verdict);
    const when = it.createdAt?.toDate ? it.createdAt.toDate().toLocaleString() : (it.createdAt || '');
    return `<li class="h-item" data-i="${i}"><span class="dot ${m.cls}">${icon(m.icon, 20)}</span>
      <div><strong>${it.mode === 'fine' ? 'Fine-print' : 'Scam shield'} · ${it.riskScore}/100</strong>
      <p>${escapeHtml(it.summary || '')}</p><small class="muted">${escapeHtml(when)}${it.local ? ' · this device' : ''}</small></div>
      <button class="btn ghost small h-del" data-i="${i}" aria-label="Delete">✕</button></li>`;
  }).join('');
}
