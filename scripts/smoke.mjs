// Smoke tests for the DOM-free modules (redact.js, demo.js, ai.js error map).
// Run: npm run smoke
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { prescrub, safeJsonParse, escapeHtml, renderLiteMarkdown, truncateForDevice } from '../src/redact.js';
import { demoTriage, demoDeepAnalysis } from '../src/demo.js';
import { friendlyError } from '../src/ai.js';

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
