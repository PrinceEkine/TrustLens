// Smoke tests for the DOM-free modules (redact.js, demo.js, ai.js error map).
// Run: npm run smoke
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { prescrub, prescrubSpans, safeJsonParse, escapeHtml, renderLiteMarkdown, truncateForDevice } from '../src/redact.js';
import { demoTriage, demoDeepAnalysis } from '../src/demo.js';
import { friendlyError } from '../src/ai.js';
import { extractLinks, analyzeLink, xrayLinks } from '../src/links.js';
import { highlightMasks, highlightPii, renderLinkXray } from '../src/ui.js';
import { DEMO_STEPS, DEMO_BUDGET_S, fmtClock } from '../src/demotour.js';

const RC = { risk_high: 70, risk_medium: 35 };

describe('redact.js', () => {
  test('prescrub masks email, phone, UPI and keeps scam evidence', () => {
    const { text, count } = prescrub('Call Rahul on +91 98220 44513 or pay refunds@okhdfc, mail me@x.com. Approve Rs 1 now!');
    assert.ok(count >= 3);
    assert.ok(!text.includes('98220 44513') && !text.includes('me@x.com'));
    assert.ok(text.includes('Rs 1'), 'amounts must survive — they are evidence');
  });

  test('safeJsonParse tolerates code fences', () => {
    const o = safeJsonParse('```json\n{"verdict":"safe","riskScore":5}\n```');
    assert.equal(o.verdict, 'safe');
    assert.equal(safeJsonParse('not json'), null);
  });

  test('markdown renderer escapes HTML (no XSS from model output)', () => {
    const html = renderLiteMarkdown('## Hi\n<script>alert(1)</script>\n- **bold** move');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;') && html.includes('<strong>bold</strong>') && html.includes('<ul>'));
    assert.equal(escapeHtml('<>&"\'').length > 10, true);
  });

  test('truncateForDevice guards the on-device context window', () => {
    const r = truncateForDevice('x'.repeat(9000), 6000);
    assert.equal(r.truncated, true);
    assert.ok(r.text.length < 9000);
  });
});

describe('demo.js fallback engine', () => {
  test('UPI scam scores malicious with named tactics', () => {
    const s1 = demoTriage('scam', 'KYC expired! Approve the collect request of Rs 1 from refunds@okhdfc or your account will be BLOCKED. Call +91 98220 44513.', RC);
    assert.equal(s1.verdict, 'malicious');
    assert.ok(s1.riskScore >= 70);
    assert.ok(s1.tactics.length >= 3);
    assert.ok(!s1.redactedText.includes('98220'), 'PII must be scrubbed');
  });

  test('rental trap flags auto-renewal and jurisdiction lock-in', () => {
    const s1 = demoTriage('fine', 'This agreement shall automatically renew for 11 months. Disputes resolved exclusively by arbitration in Mumbai at Tenant cost.', RC);
    assert.ok(['suspicious', 'malicious'].includes(s1.verdict));
    assert.ok(s1.tactics.some((t) => /renewal/i.test(t.label)));
  });

  test('benign message stays safe', () => {
    const s1 = demoTriage('scam', 'Hi! Coffee tomorrow at 4pm near the library? Let me know what works.', RC);
    assert.equal(s1.verdict, 'safe');
  });

  test('deep analysis is input-derived markdown', () => {
    const s1 = demoTriage('scam', 'Pay Rs 499 registration to unlock your job. Reply YES now, limited slots!', RC);
    const md = demoDeepAnalysis('scam', s1);
    assert.ok(md.includes('## Verdict') && md.includes('## What to do next'));
    assert.ok(md.includes('Advance fee') || md.includes('Reply pressure'));
  });
});

describe('links.js Link X-ray', () => {
  test('extractLinks finds URLs but skips emails and UPI ids', () => {
    const links = extractLinks('Pay http://indiap0st-track.xyz/pay?id=1 now, or mail me@x.com, or pay refunds@okhdfc. Also visit example.com/a.');
    assert.ok(links.some((l) => l.includes('indiap0st-track.xyz')));
    assert.ok(links.some((l) => l.includes('example.com')));
    assert.ok(!links.some((l) => l.includes('me@') || l.includes('x.com') && l === 'x.com'), 'email domain must not leak in');
    assert.ok(!links.some((l) => l.includes('refunds@okhdfc')), 'UPI id is not a link');
  });

  test('phishing link flags swap + risky TLD + http', () => {
    const r = analyzeLink('http://indiap0st-track.xyz/pay?id=88412&user=amit_91');
    assert.equal(r.host, 'indiap0st-track.xyz');
    assert.equal(r.worst, 'warn');
    assert.ok(r.risk >= 28);
    const labels = r.findings.map((f) => f.label).join('|');
    assert.ok(/Letter\/number swap/.test(labels));
    assert.ok(/Risky TLD/.test(labels));
    assert.ok(/Unencrypted http/.test(labels));
  });

  test('IP host and @ trick are bad', () => {
    const ip = analyzeLink('http://192.168.1.9/login');
    assert.equal(ip.worst, 'bad');
    const at = analyzeLink('https://hdfcbank.com@evil.example/login');
    assert.ok(at.findings.some((f) => f.label === '@ trick'));
    assert.equal(at.worst, 'bad');
  });

  test('clean https link passes with ok', () => {
    const r = analyzeLink('https://www.example.com/about');
    assert.equal(r.worst, 'ok');
    assert.equal(r.risk, 0);
  });

  test('xrayLinks maps text to reports', () => {
    const rs = xrayLinks('no links here, just words');
    assert.equal(rs.length, 0);
  });
});

describe('redact.js spans + diff highlighters', () => {
  test('prescrubSpans returns sorted non-overlapping spans', () => {
    const spans = prescrubSpans('Call +91 98220 44513 or mail me@x.com now');
    assert.ok(spans.length >= 2);
    assert.deepEqual(spans.map((s) => s.type).sort(), ['email', 'phone']);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i].start >= spans[i - 1].end, 'no overlaps');
    const phone = spans.find((s) => s.type === 'phone');
    assert.equal('Call +91 98220 44513 or mail me@x.com now'.slice(phone.start, phone.end), '+91 98220 44513');
  });

  test('highlightPii escapes HTML and marks spans', () => {
    const html = highlightPii('Hi <b>Bob</b>, call +91 98220 44513', [{ start: 20, end: 35, type: 'phone' }]);
    assert.ok(!html.includes('<b>') && html.includes('&lt;b&gt;'));
    assert.ok(html.includes('<mark class="pii"') && html.includes('+91 98220 44513'));
  });

  test('highlightMasks marks model + scrubber tokens', () => {
    const html = highlightMasks('Call [NAME] on +9•••[phone] or visit http://x.io/?… ok');
    assert.ok(html.includes('<mark class="mask">[NAME]</mark>'));
    assert.ok(html.includes('[phone]</mark>'));
  });

  test('renderLinkXray escapes hostile link text', () => {
    const html = renderLinkXray([{ url: '"><script>alert(1)</script>', host: '<evil>', findings: [{ level: 'bad', label: '<b>x</b>', detail: 'd' }], worst: 'bad', risk: 34 }]);
    assert.ok(!html.includes('<script>') && html.includes('&lt;evil&gt;'));
  });
});

describe('demotour.js 3-minute script', () => {
  test('step budgets sum to the 180s budget', () => {
    assert.equal(DEMO_BUDGET_S, 180);
    assert.equal(DEMO_STEPS.reduce((n, s) => n + s.seconds, 0), 180);
    assert.ok(DEMO_STEPS.every((s) => s.id && s.caption && s.title));
  });

  test('fmtClock formats m:ss', () => {
    assert.equal(fmtClock(0), '0:00');
    assert.equal(fmtClock(75), '1:15');
    assert.equal(fmtClock(180), '3:00');
  });
});

describe('ai.js friendlyError', () => {
  test('retired cloud model (404) is not mislabeled as a network failure', () => {
    const err = 'FirebaseError: AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/trustlens-d6fbb/models/gemini-2.5-flash:generateContent: [404 ] This model models/gemini-2.5-flash is no longer available to new users. (AI/fetch-error)';
    const fe = friendlyError(new Error(err));
    assert.equal(fe.title, 'Cloud model unavailable');
    assert.ok(fe.hint.includes('cloud_model'));
  });

  test('genuine transport failure still maps to Network unreachable', () => {
    assert.equal(friendlyError(new TypeError('Failed to fetch')).title, 'Network unreachable');
    assert.equal(friendlyError(new Error('FirebaseError: AI: Error fetching from https://x: Failed to fetch')).title, 'Network unreachable');
  });

  test('disabled AI Logic API still maps to its own fix', () => {
    const err = "AI: The Firebase AI SDK requires the Firebase AI API ('firebasevertexai.googleapis.com') to be enabled in your Firebase project. (AI/api-not-enabled)";
    assert.equal(friendlyError(new Error(err)).title, 'AI Logic API not enabled');
  });

  test('cloud overload (503/500) maps to retry, not API-not-enabled', () => {
    const e503 = 'FirebaseError: AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/models/m:generateContent: [503 ] Deadline expired before operation could complete. (AI/fetch-error)';
    const e500 = 'FirebaseError: AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/models/m:streamGenerateContent?alt=sse: [500 ] This model is currently experiencing high demand. (AI/fetch-error)';
    assert.equal(friendlyError(new Error(e503)).title, 'Cloud overloaded');
    assert.equal(friendlyError(new Error(e500)).title, 'Cloud overloaded');
  });

  test('cloud timeout maps to retry', () => {
    const fe = friendlyError({ name: 'AbortError', message: 'Timeout has expired.' });
    assert.equal(fe.title, 'Cloud overloaded');
  });

  test('on-device unavailability still maps to the Nano fix', () => {
    const err = 'FirebaseError: AI: Local LanguageModel API not available in this environment. (AI/api-not-enabled)';
    assert.equal(friendlyError(new Error(err)).title, 'On-device model unavailable');
  });
});
