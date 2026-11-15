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

export function verdictMeta(verdict) {
  return {
    safe: { icon: '✅', label: 'Looks safe', cls: 'safe' },
    suspicious: { icon: '⚠️', label: 'Suspicious', cls: 'warn' },
    malicious: { icon: '🚨', label: 'Likely malicious', cls: 'bad' },
  }[verdict] ?? { icon: '❔', label: 'Uncertain', cls: 'warn' };
}

export function renderStage1(s1, rc) {
  const m = verdictMeta(s1.verdict);
  const hi = rc.risk_high, mid = rc.risk_medium;
  const band = s1.riskScore >= hi ? 'bad' : s1.riskScore >= mid ? 'warn' : 'safe';
  return `<div class="mini-verdict ${band}"><span>${m.icon} ${m.label}</span><strong>${s1.riskScore}/100</strong></div>
    <p>${escapeHtml(s1.summary)}</p>
    <p class="muted small">🔒 ${s1.piiCount} PII span${s1.piiCount === 1 ? '' : 's'} scrubbed on-device before anything left this tab.</p>`;
}

export function renderVerdict(s1) {
  const m = verdictMeta(s1.verdict);
  return `<div class="verdict ${m.cls}"><span class="v-icon">${m.icon}</span>
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

export function renderHistory(items) {
  if (!items.length) return '<li class="muted">Nothing yet — your redacted analyses will appear here.</li>';
  return items.map((it, i) => {
    const m = verdictMeta(it.verdict);
    const when = it.createdAt?.toDate ? it.createdAt.toDate().toLocaleString() : (it.createdAt || '');
    return `<li class="h-item" data-i="${i}"><span class="dot ${m.cls}">${m.icon}</span>
      <div><strong>${it.mode === 'fine' ? 'Fine-print' : 'Scam shield'} · ${it.riskScore}/100</strong>
      <p>${escapeHtml(it.summary || '')}</p><small class="muted">${escapeHtml(when)}${it.local ? ' · this device' : ''}</small></div>
      <button class="btn ghost small h-del" data-i="${i}" aria-label="Delete">✕</button></li>`;
  }).join('');
}
