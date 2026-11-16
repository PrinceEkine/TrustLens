// Guided 3-minute demo script (mirrors the README demo beats + Devpost video).
// Pure data: the runner lives in main.js (web) / TrustLensViewModel (Android).
// Step budgets sum to exactly 180 seconds.
export const DEMO_BUDGET_S = 180;

export const DEMO_STEPS = [
  {
    id: 'upi', seconds: 15, spot: '#input',
    title: 'The hook: a UPI refund scam',
    caption: '0:00 — Scam Shield. A blocked-account threat with a collect request and a callback number. Raw text stays on-device.',
  },
  {
    id: 'analyze1', seconds: 40, spot: '#stage1',
    title: 'On-device triage, then cloud depth',
    caption: 'Watch Stage 1: Nano verdict + PII scrub in milliseconds — then the cloud deep-analysis streams on redacted text only.',
  },
  {
    id: 'diff', seconds: 20, spot: '#redactCard',
    title: 'Proof of privacy: the diff',
    caption: 'Side by side: what stayed on your device vs the only text the cloud ever saw. Every mask is PII that never left the tab.',
  },
  {
    id: 'privacy', seconds: 30, spot: '#cloudToggle',
    title: 'Maximum-privacy mode',
    caption: 'Cloud OFF, re-run: a pure on-device result. Nothing leaves the device — the honest SKIPPED badge says so.',
  },
  {
    id: 'fine', seconds: 40, spot: '#tabFine',
    title: 'Second lens: Fine-Print X-ray',
    caption: 'Cloud back on. Same engine, new lens: the rental auto-renewal trap, X-rayed clause by clause.',
  },
  {
    id: 'history', seconds: 15, spot: '#historyDrawer',
    title: 'History syncs across platforms',
    caption: 'Redacted excerpts in Firestore — the same record appears on Android. One project, two apps.',
  },
  {
    id: 'rc', seconds: 10, spot: '#riskWrap',
    title: 'Remote Config runs the dials',
    caption: 'Thresholds, model, disclaimer — all live from Remote Config. No redeploy to retune.',
  },
  {
    id: 'close', seconds: 10, spot: null,
    title: 'Private by construction',
    caption: 'TrustLens: ON_DEVICE triage plus IN_CLOUD depth. Thanks for watching — now try your own message.',
  },
];

export function fmtClock(totalS) {
  const s = Math.max(0, Math.floor(totalS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
