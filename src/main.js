// TrustLens orchestrator: wires UI → hybrid pipeline → history.
// Honesty rule: every result is badged with the engine that produced it
// (ON_DEVICE / IN_CLOUD / DEMO / SKIPPED). Nothing is ever faked.

import { initFirebase, watchUser, ensureSignedIn, signInWithGoogle, signUpEmail, signInEmail, sendReset, signOutUser, friendlyAuthError, firebaseState } from './firebase.js';
import { getModels, nanoStatus, warmDevice, fileToImagePart, normalizeStage1, runStage1OnDevice, runStage1Cloud, runStage2Stream, friendlyError } from './ai.js';
import { demoTriage, demoDeepAnalysis } from './demo.js';
import { saveAnalysis, listAnalyses, removeAnalysis, historyMode } from './history.js';
import { truncateForDevice } from './redact.js';
import { SAMPLES } from './samples.js';
import { $, toast, setPill, setBadge, renderStage1, renderVerdict, renderRisk, renderTactics, renderDeep, renderHistory, fmtMs } from './ui.js';

const S = {
  mode: 'scam',
  imagePart: null,
  imageFile: null,
  last: null, // { s1, deep, engines }
  history: [],
  showingOriginal: false,
};

const MODE_COPY = {
  scam: 'Suspicious SMS, email, job offer, or viral forward? Get an instant private verdict, then a deep breakdown.',
  fine: 'Rental clause, loan offer, or subscription terms? Get the traps flagged privately, then a plain-language X-ray.',
};

async function boot() {
  await initFirebase();
  const rc = firebaseState.rcValues;

  $('disclaimer').textContent = rc.disclaimer_text;
  $('modeDesc').textContent = MODE_COPY[S.mode];

  // Remote Config gates
  if (!rc.image_input_enabled) $('imgRow').classList.add('hidden');
  if (!rc.cloud_stage_enabled) {
    $('cloudToggle').checked = false;
    $('cloudToggle').disabled = true;
    $('privacyNote').innerHTML = 'Off by Remote Config — this build runs <strong>on-device only</strong>.';
  }
  $('s2Model').textContent = rc.cloud_model;

  // Auth (anonymous auto sign-in; Google upgrade on click)
  try { await ensureSignedIn(); } catch { /* demo mode */ }
  watchUser((u) => {
    $('authBtn').textContent = !firebaseState.configured ? 'Demo mode'
      : !u ? 'Sign in' : u.isAnonymous ? 'Guest · Sign in' : (u.email || 'Signed in');
  });
  $('authBtn').onclick = () => {
    if (!firebaseState.configured) { toast('Add Firebase keys to .env to enable sign-in.'); return; }
    openAuthModal();
  };
  $('authClose').onclick = closeAuthModal;
  $('authModal').addEventListener('click', (e) => { if (e.target.id === 'authModal') closeAuthModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAuthModal(); $('historyDrawer').classList.add('hidden'); }
  });
  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await authSubmit('signin');
  });
  $('signUpBtn').onclick = () => authSubmit('signup');
  $('googleBtn').onclick = async () => {
    try { await signInWithGoogle(); closeAuthModal(); toast('Signed in with Google.'); }
    catch (e) { showAuthError(e); }
  };
  $('resetBtn').onclick = async () => {
    const email = $('authEmail').value.trim();
    if (!email) { showAuthError({ code: 'auth/invalid-email' }); return; }
    try { await sendReset(email); toast(`Password reset sent to ${email}.`); closeAuthModal(); }
    catch (e) { showAuthError(e); }
  };
  // Ctrl/Cmd+Enter analyzes from anywhere except while the auth modal is open.
  document.addEventListener('keydown', (e) => {
    const modalOpen = !$('authModal').classList.contains('hidden');
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !modalOpen) analyze();
  });

  // Status pills
  setPill($('pillAppCheck'), `Shield: ${firebaseState.appCheck}`, firebaseState.appCheck === 'off' ? 'muted' : 'ok');
  updateCloudPill();
  updateNetPill();
  window.addEventListener('online', updateNetPill);
  window.addEventListener('offline', updateNetPill);
  probeNano();

  // Tabs + samples + input
  $('tabScam').onclick = () => setMode('scam');
  $('tabFine').onclick = () => setMode('fine');
  renderSamples();
  $('input').addEventListener('input', () => { $('charCount').textContent = `${$('input').value.length} chars`; });
  $('cloudToggle').addEventListener('change', updateCloudPill);
  $('fileInput').addEventListener('change', onFile);
  $('imgRemove').onclick = clearImage;
  $('analyzeBtn').onclick = analyze;
  $('redactToggle').onclick = toggleRedact;
  $('copyBtn').onclick = copyReport;
  $('historyBtn').onclick = openHistory;
  $('historyClose').onclick = () => $('historyDrawer').classList.add('hidden');
  $('historyList').addEventListener('click', onHistoryClick);

  if (!firebaseState.configured) {
    $('engineNote').textContent = 'Demo mode: add Firebase keys (.env) + Chrome Nano flags for the full hybrid pipeline. See README.';
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

function setMode(mode) {
  S.mode = mode;
  $('tabScam').classList.toggle('active', mode === 'scam');
  $('tabFine').classList.toggle('active', mode === 'fine');
  $('tabScam').setAttribute('aria-selected', mode === 'scam');
  $('tabFine').setAttribute('aria-selected', mode === 'fine');
  $('modeDesc').textContent = MODE_COPY[mode];
  renderSamples();
}

function renderSamples() {
  $('samples').innerHTML = '';
  for (const s of SAMPLES[S.mode]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = s.title;
    b.onclick = () => { $('input').value = s.body; $('charCount').textContent = `${s.body.length} chars`; };
    $('samples').appendChild(b);
  }
}

async function probeNano() {
  setPill($('pillNano'), 'Nano: …', 'muted');
  const st = await nanoStatus();
  const map = {
    available: ['Nano: ready', 'ok'],
    downloading: ['Nano: downloading', 'warn'],
    downloadable: ['Nano: downloadable', 'warn'],
    unavailable: ['Nano: n/a', 'bad'],
    unknown: ['Nano: ?', 'muted'],
  };
  setPill($('pillNano'), ...(map[st] || map.unknown));
}

function updateNetPill() {
  setPill($('pillNet'), navigator.onLine ? 'Net: online' : 'Net: OFFLINE', navigator.onLine ? 'ok' : 'bad');
}

function updateCloudPill() {
  const on = $('cloudToggle').checked && firebaseState.rcValues.cloud_stage_enabled;
  setPill($('pillCloud'), on ? `Cloud: ${firebaseState.rcValues.cloud_model}` : 'Cloud: off', on ? 'info' : 'muted');
}

async function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    S.imagePart = await fileToImagePart(f);
    S.imageFile = f;
    $('imgPreview').src = URL.createObjectURL(f);
    $('imgPreviewWrap').classList.remove('hidden');
  } catch (err) { toast(err.message); }
}

function clearImage() {
  S.imagePart = null; S.imageFile = null;
  $('fileInput').value = '';
  $('imgPreviewWrap').classList.add('hidden');
}

function openAuthModal() {
  $('authError').classList.add('hidden');
  const u = firebaseState.user;
  const signed = u && !u.isAnonymous;
  $('authSigned').innerHTML = signed
    ? `<div class="signed-box"><p>Signed in as <strong>${u.email || 'account'}</strong></p><button class="btn ghost small" id="signOutBtn">Sign out</button></div>`
    : (u ? '<p class="muted small">Browsing as guest — sign in to sync history everywhere.</p>' : '');
  $('authForm').style.display = signed ? 'none' : '';
  $('authModal').classList.remove('hidden');
  const so = $('signOutBtn');
  if (so) so.onclick = async () => { await signOutUser(); closeAuthModal(); toast('Signed out — fresh guest session.'); };
  if (!signed) $('authEmail').focus();
}

function closeAuthModal() {
  $('authModal').classList.add('hidden');
  $('authPass').value = '';
}

function showAuthError(e) {
  const el = $('authError');
  el.textContent = friendlyAuthError(e);
  el.classList.remove('hidden');
}

async function authSubmit(kind) {
  const email = $('authEmail').value.trim();
  const pw = $('authPass').value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showAuthError({ code: 'auth/invalid-email' }); return; }
  if (pw.length < 6) { showAuthError({ code: 'auth/weak-password' }); return; }
  try {
    if (kind === 'signup') {
      const r = await signUpEmail(email, pw);
      closeAuthModal();
      toast(r.linked ? 'Account created — guest history kept ✓' : 'Account created — welcome ✓');
    } else {
      await signInEmail(email, pw);
      closeAuthModal();
      toast('Signed in ✓');
    }
  } catch (e) { showAuthError(e); }
}

function setBusy(busy) {
  $('analyzeBtn').disabled = busy;
  $('analyzeBtn').textContent = busy ? 'Analyzing…' : 'Analyze privately →';
}

async function analyze() {
  const rc = firebaseState.rcValues;
  const rawInput = $('input').value.trim();
  if (!rawInput && !S.imagePart) { toast('Paste some text or attach a screenshot first.'); return; }
  const { text, truncated } = truncateForDevice(rawInput, rc.max_input_chars);
  $('truncateNote').textContent = truncated ? `trimmed to ${rc.max_input_chars} chars for on-device context` : '';
  $('resultsCard').classList.add('hidden');
  S.showingOriginal = false;
  $('redactToggle').textContent = 'show my original';

  setBusy(true);
  const engines = {};
  try {
    // ---- Stage 1: on-device triage (+ cloud-triaged / demo fallbacks) ----
    setBadge($('s1Badge'), 'running…', 'run');
    $('s1Body').innerHTML = '<p class="muted">Contacting on-device model…</p>';
    let s1, s1Engine;
    if (getModels()) {
      try {
        showWarmup(true, 0.05, 'Waking Gemini Nano on-device…');
        await warmDevice((v) => showWarmup(true, v, `Downloading Nano model… ${Math.round(v * 100)}%`));
        const r = await runStage1OnDevice(S.mode, text || '(analyze the attached image)', S.imagePart);
        showWarmup(false);
        s1 = normalizeStage1(r.json, text);
        s1Engine = r.source === 'IN_CLOUD' ? 'IN_CLOUD' : 'ON_DEVICE';
        $('s1Latency').textContent = fmtMs(r.ms);
        engines.s1 = `Gemini Nano on-device (${fmtMs(r.ms)})`;
        if (s1Engine === 'IN_CLOUD') engines.s1 = `cloud triage (${fmtMs(r.ms)})`;
      } catch (e1) {
        showWarmup(false);
        const fe = friendlyError(e1);
        console.warn('[stage1-device] failed:', e1);
        if (cloudUsable()) {
          try {
            const r = await runStage1Cloud(S.mode, text || '(analyze the attached image)', S.imagePart);
            s1 = normalizeStage1(r.json, text);
            s1Engine = 'IN_CLOUD';
            $('s1Latency').textContent = fmtMs(r.ms);
            engines.s1 = `cloud triage fallback (${fmtMs(r.ms)}) — ${fe.title}`;
          } catch (e2) {
            console.warn('[stage1-cloud] failed:', e2);
            ({ s1, s1Engine } = useDemo(text, fe));
          }
        } else {
          ({ s1, s1Engine } = useDemo(text, fe));
        }
      }
    } else {
      ({ s1, s1Engine } = useDemo(text, null));
    }
    setBadge($('s1Badge'), s1Engine, s1Engine === 'ON_DEVICE' ? 'device' : s1Engine === 'IN_CLOUD' ? 'cloud' : 'demo');
    $('s1Body').innerHTML = renderStage1(s1, rc);
    renderResultsHead(s1, rc, text);

    // ---- Stage 2: cloud deep-analysis on REDACTED text (or honest skip) ----
    const wantCloud = $('cloudToggle').checked && rc.cloud_stage_enabled;
    setBadge($('s2Badge'), '…', 'run');
    let deep = '';
    if (wantCloud && firebaseState.configured && navigator.onLine) {
      try {
        $('s2Body').innerHTML = '<p class="muted">Streaming deep-analysis (redacted text only)…</p>';
        $('deep').innerHTML = '<p class="muted">Streaming…</p>';
        const r = await runStage2Stream(S.mode, s1.redactedText, s1, (_p, full) => {
          $('deep').innerHTML = renderDeep(full + ' ▍');
        });
        deep = r.text;
        $('s2Latency').textContent = fmtMs(r.ms);
        setBadge($('s2Badge'), 'IN_CLOUD', 'cloud');
        $('s2Body').innerHTML = `<p>✅ ${rc.cloud_model} · redacted input · ${s1.redactedText.length} chars, 0 raw PII.</p>`;
        engines.s2 = `${rc.cloud_model} (${fmtMs(r.ms)})`;
      } catch (e) {
        const fe = friendlyError(e);
        console.warn('[stage2] failed:', e);
        setBadge($('s2Badge'), 'DEMO', 'demo');
        $('s2Body').innerHTML = `<p>⚠️ Cloud failed (${fe.title}). ${fe.hint}</p>`;
        deep = demoDeepAnalysis(S.mode, s1);
        engines.s2 = `demo engine — ${fe.title}`;
      }
    } else if (!firebaseState.configured || s1Engine === 'DEMO') {
      setBadge($('s2Badge'), 'DEMO', 'demo');
      $('s2Body').innerHTML = '<p>Demo engine: input-derived heuristic analysis (connect Firebase for full AI).</p>';
      deep = demoDeepAnalysis(S.mode, s1);
      engines.s2 = 'demo engine';
    } else {
      setBadge($('s2Badge'), 'SKIPPED', 'idle');
      $('s2Body').innerHTML = '<p>🔒 Skipped — maximum-privacy mode. Raw text never left your device.</p>';
      deep = '## Maximum-privacy mode\nCloud deep-analysis is off, so nothing left your device. The on-device verdict, risk score, and flags above are your full result.\n\nToggle **Cloud deep-analysis** on to get the deep breakdown — it still only receives redacted text.';
      engines.s2 = 'skipped (privacy mode)';
    }
    $('deep').innerHTML = renderDeep(deep);
    $('resultsCard').classList.remove('hidden');
    $('engineNote').textContent = `Stage 1: ${engines.s1} · Stage 2: ${engines.s2}`;
    S.last = { s1, deep, engines, mode: S.mode };

    // ---- Persist (redacted only) ----
    const saved = await saveAnalysis({
      mode: S.mode, verdict: s1.verdict, riskScore: s1.riskScore, summary: s1.summary,
      tactics: s1.tactics, redactedText: s1.redactedText, redactedExcerpt: s1.redactedText.slice(0, 160),
      deep, engines: `${engines.s1} / ${engines.s2}`,
    });
    $('saveState').textContent = saved.local ? 'kept on this device (history sync needs sign-in)' : 'saved to your private Firestore history ✓';
  } catch (e) {
    console.error(e);
    toast(`Analysis failed: ${e.message}`);
  } finally {
    setBusy(false);
    showWarmup(false);
  }
}

function useDemo(text, fe) {
  $('s1Latency').textContent = '<5 ms';
  const s1 = demoTriage(S.mode, text, firebaseState.rcValues);
  $('engineNote').textContent = '';
  if (fe) toast(`${fe.title}. ${fe.hint}`);
  return { s1, s1Engine: 'DEMO' };
}

function cloudUsable() {
  return $('cloudToggle').checked && firebaseState.rcValues.cloud_stage_enabled
    && firebaseState.configured && navigator.onLine;
}

function renderResultsHead(s1, rc, originalText) {
  $('verdict').innerHTML = renderVerdict(s1);
  $('riskWrap').innerHTML = renderRisk(s1, rc);
  $('tactics').innerHTML = renderTactics(s1.tactics);
  $('redactView').textContent = s1.redactedText;
  $('resultsCard').dataset.original = originalText;
}

function toggleRedact() {
  if (!S.last) return;
  S.showingOriginal = !S.showingOriginal;
  $('redactView').textContent = S.showingOriginal ? ($('resultsCard').dataset.original || '') : S.last.s1.redactedText;
  $('redactToggle').textContent = S.showingOriginal ? 'show redacted' : 'show my original';
}

async function copyReport() {
  if (!S.last) return;
  const { s1, deep, engines, mode } = S.last;
  const report = `TrustLens report (${mode})\nVerdict: ${s1.verdict} (${s1.riskScore}/100)\n${s1.summary}\nEngines: ${engines.s1} / ${engines.s2}\n\n${deep}`;
  try { await navigator.clipboard.writeText(report); toast('Report copied.'); }
  catch { toast('Copy blocked by browser permissions.'); }
}

function showWarmup(show, v = 0, text = '') {
  $('warmupWrap').classList.toggle('hidden', !show);
  if (show) {
    $('warmupFill').style.width = `${Math.round((v || 0) * 100)}%`;
    $('warmupText').textContent = text || 'Waking Gemini Nano on-device…';
  }
}

async function openHistory() {
  $('historyDrawer').classList.remove('hidden');
  const { items, local } = await listAnalyses();
  S.history = items;
  $('historyNote').textContent = historyMode() === 'local' || local
    ? 'Local session history (sign in + Firestore for synced history). Redacted excerpts only.'
    : 'Synced from your private Firestore history. Redacted excerpts only.';
  $('historyList').innerHTML = renderHistory(items);
}

async function onHistoryClick(e) {
  const del = e.target.closest('.h-del');
  const row = e.target.closest('.h-item');
  if (!row) return;
  const item = S.history[Number(row.dataset.i)];
  if (del) {
    e.stopPropagation();
    await removeAnalysis(item);
    openHistory();
    return;
  }
  // Restore full result view from the stored record.
  const s1 = { verdict: item.verdict, riskScore: item.riskScore, summary: item.summary, tactics: item.tactics || [], redactedText: item.redactedText || item.redactedExcerpt || '', piiCount: 0 };
  setMode(item.mode === 'fine' ? 'fine' : 'scam');
  renderResultsHead(s1, firebaseState.rcValues, '');
  $('deep').innerHTML = renderDeep(item.deep || '');
  $('engineNote').textContent = `Restored from history · originally: ${item.engines || 'unknown engines'}`;
  $('resultsCard').classList.remove('hidden');
  $('historyDrawer').classList.add('hidden');
  setBadge($('s1Badge'), 'history', 'idle');
  setBadge($('s2Badge'), 'history', 'idle');
}

boot();
