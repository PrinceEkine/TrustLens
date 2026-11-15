// Smoke tests for the DOM-free modules (redact.js, demo.js).
// Run: npm run smoke
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { prescrub, safeJsonParse, escapeHtml, renderLiteMarkdown, truncateForDevice } from '../src/redact.js';
import { demoTriage, demoDeepAnalysis } from '../src/demo.js';

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
