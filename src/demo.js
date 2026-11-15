// Honest fallback engine: transparent keyword heuristics used ONLY when
// Firebase AI Logic is unreachable (no .env, no Nano, offline cloud).
// Results are always badged "Demo engine" in the UI — never passed off as AI.
// Pure module: also exercised by node scripts/smoke.mjs.

import { prescrub, clamp } from './redact.js';

const SCAM_SIGNALS = [
  { label: 'Urgency pressure', why: 'Scams rush you so you cannot think or verify.', weight: 14, res: [/urgent|immediately|last warning|within \d+ hours?|today only|act now|expire|blocked today/i] },
  { label: 'Threat of loss', why: 'Threats (blocked account, arrest, parcel return) force panic compliance.', weight: 16, res: [/block(ed)?|suspend|arrest|legal action|return(ed)?|deactivat/i] },
  { label: 'Advance fee', why: 'Real jobs and prizes never ask you to pay first.', weight: 22, res: [/registration( fee)?|pay rs|processing fee|activate.*pay|advance|refundable deposit/i] },
  { label: 'Collect request / UPI trick', why: 'Approving a collect request SENDS money — refunds never need your approval.', weight: 24, res: [/collect request|approve.*request|upi.*(pin|approve)|send.*re 1|rs 1/i] },
  { label: 'Authority impersonation', why: 'Scammers pose as banks, officers, or brands to borrow trust.', weight: 12, res: [/\b(bank|officer|kyc|customs?|indian? ?post|TRAI|RBI|CBI|customer care)\b/i] },
  { label: 'Suspicious link', why: 'Lookalike domains and URL shorteners hide phishing pages.', weight: 18, res: [/https?:\/\/\S*|\b\w+\.(xyz|top|click|link|tk|ml|gq)\b|bit\.ly|tinyurl/i] },
  { label: 'Too good to be true', why: 'Unrealistic income for trivial work is the classic job-scam hook.', weight: 16, res: [/earn rs ?[\d,]+\/(day|week)|5000\/day|work from home.*\d|no investment.*profit|guaranteed.*return/i] },
  { label: 'OTP / KYC lure', why: 'Banks never ask for OTPs or KYC over calls, SMS, or links.', weight: 20, res: [/\botp\b|kyc.*(expir|update|verif)|share.*(otp|pin|cvv)/i] },
  { label: 'Reply pressure', why: '"Reply YES now" / "limited slots" short-circuits skepticism.', weight: 10, res: [/reply (yes|now)|limited slots|only \d+ left|first \d+ (people|users)/i] },
];

const FINE_SIGNALS = [
  { label: 'Auto-renewal trap', why: 'Silent renewals with hard cancellation windows lock you in.', weight: 22, res: [/automatically renew|auto.?renew|unless.*notice/i] },
  { label: 'Harsh cancellation window', why: '90-day registered-post notice is designed to be missed.', weight: 12, res: [/\d{2,3} days?.*notice|registered post|cancellation.*\d+ business days/i] },
  { label: 'Excessive penalties', why: 'Per-day fines and 40%+ penal interest compound brutally.', weight: 20, res: [/rs ?\d+ ?\/ ?day|penal|compounded|late (fee|payment)|4\d% p\.?a/i] },
  { label: 'One-sided deductions', why: '"Assessed solely by" means they decide what you lose.', weight: 16, res: [/solely by|at (the )?(owner|company|lender)'s (discretion|cost)|less deductions/i] },
  { label: 'Refund delays / no refunds', why: '180-day refunds and non-refundable terms trap your money.', weight: 14, res: [/within \d{2,3} days|non.?refundable|no refund|all payments are final/i] },
  { label: 'Jurisdiction lock-in', why: 'Distant exclusive arbitration makes disputes unaffordable.', weight: 16, res: [/exclusively.*arbitration|sole jurisdiction|resolved.*only in/i] },
  { label: 'Forced consent', why: 'Auto-debit plus contact-list access is extreme for collections.', weight: 16, res: [/auto.?debit|contact.?list|consent.*collection|access.*(contacts|sms)/i] },
  { label: 'Foreclosure / exit fees', why: 'Prepayment locks and foreclosure charges punish early exit.', weight: 12, res: [/foreclosure|prepayment.*after|exit (fee|charge)|deleting the app does not cancel/i] },
  { label: 'Unilateral changes', why: 'They can raise prices or change terms without telling you.', weight: 14, res: [/without notice|future price|constitutes acceptance|may (change|revise).*(terms|price)/i] },
  { label: 'Zero-cost illusion', why: '"0% interest" hides upfront fees that exceed normal interest.', weight: 14, res: [/0% interest|no cost|free.*trial|processing fee/i] },
];

function snippet(text, re) {
  const m = re.exec(text);
  re.lastIndex = 0;
  if (!m || m.index === undefined) return '';
  const start = Math.max(0, m.index - 30);
  return (start > 0 ? '…' : '') + text.slice(start, m.index + m[0].length + 30).replace(/\s+/g, ' ').slice(0, 140);
}

function runSignals(text, signals, high, medium) {
  const tactics = [];
  let score = 0;
  for (const s of signals) {
    const hit = s.res.find((re) => { re.lastIndex = 0; return re.test(text); });
    if (hit) {
      score += s.weight;
      tactics.push({ label: s.label, why: s.why, quote: snippet(text, hit) });
    }
  }
  const riskScore = clamp(score, 2, 97);
  const verdict = riskScore >= high ? 'malicious' : riskScore >= medium ? 'suspicious' : 'safe';
  return { verdict, riskScore, tactics: tactics.slice(0, 6) };
}

/** Same JSON contract as Stage 1, produced heuristically. */
export function demoTriage(mode, text, rc) {
  const signals = mode === 'fine' ? FINE_SIGNALS : SCAM_SIGNALS;
  const r = runSignals(text, signals, rc.risk_high, rc.risk_medium);
  const scrub = prescrub(text);
  const noun = mode === 'fine' ? 'clause' : 'message';
  const summary = r.tactics.length === 0
    ? `No classic red flags detected in this ${noun} — stay cautious anyway.`
    : `Detected ${r.tactics.length} red flag${r.tactics.length > 1 ? 's' : ''}: ${r.tactics.map((t) => t.label.toLowerCase()).join(', ')}.`;
  return { ...r, summary: summary.slice(0, 240), redactedText: scrub.text, piiCount: scrub.count };
}

/** Input-derived deep analysis (extractive over matched tactics). */
export function demoDeepAnalysis(mode, stage1) {
  const flags = stage1.tactics.map((t, i) => `${i + 1}. **${t.label}** — ${t.why}${t.quote ? `\n   > "${t.quote}"` : ''}`).join('\n');
  if (mode === 'fine') {
    return `## What this really means\nRisk ${stage1.riskScore}/100 (${stage1.verdict}). ${stage1.summary}\n\n## Money and time traps\n${flags || 'None detected — but read every number twice.'}\n\n## Questions to ask before signing\n1. Which of these terms are negotiable, in writing?\n2. What is the total cost including all fees if I exit early?\n3. What notice, in what form, stops renewal or billing?\n\n## Safer alternatives to propose\n- Shorter term or trial period with written exit terms.\n- Penalties capped at actual loss, not per-day compounding.\n- Disputes in your home jurisdiction.\n\nConsult a professional for high-value agreements.\n\n*(Demo-engine analysis — connect Firebase for full AI reasoning.)*`;
  }
  return `## Verdict in plain words\nRisk ${stage1.riskScore}/100 (${stage1.verdict}). ${stage1.summary}\n\n## Tricks being used\n${flags || 'None detected — verify independently anyway.'}\n\n## How to verify safely\n1. Never use links or numbers from the message itself.\n2. Open the official app/site directly or call the number on your card.\n3. Ask a trusted person to read it before you act.\n\n## What to do next\n- Do: report and block the sender; screenshot for evidence.\n- Never: share OTPs, approve collect requests, or pay to “unlock” money.\n\n*(Demo-engine analysis — connect Firebase for full AI reasoning.)*`;
}
