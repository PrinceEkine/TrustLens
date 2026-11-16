# TrustLens — see through scams & fine print, privately 🔒🔍

> **One-line pitch:** an AI trust advisor that triages suspicious messages and hostile contract
> clauses **on your device with Gemini Nano**, scrubs your personal data **before anything
> leaves the tab**, and only then asks the cloud for a deep explanation — on redacted text only.

**Platforms:** Web (Chrome Desktop) + Android — one hybrid pipeline, one Firebase project ·
**AI runtime:** Firebase AI Logic hybrid inference · 🎥 Demo video: *(add your unlisted
YouTube link here before submitting)*

- Web: `firebase/ai` — `getAI`, `getGenerativeModel`, `InferenceMode.ONLY_ON_DEVICE` /
  `ONLY_IN_CLOUD`, `initializeDeviceModel`, `generateContent`, `generateContentStream`
- Android: `firebase-ai` + `firebase-ai-ondevice` — `Firebase.ai(GenerativeBackend.googleAI())`,
  `generativeModel(…, OnDeviceConfig(ONLY_ON_DEVICE / ONLY_IN_CLOUD))`,
  `onDeviceExtension?.warmUp()`, `generateContent`, `generateContentStream`

---

## Why this wins: the idea in 30 seconds

Everyone builds chatbots that ship your sensitive text to the cloud. TrustLens inverts the
pipeline — **privacy by construction, not by promise**:

1. **Stage 1 — On-device (Gemini Nano):** instant verdict, risk score, manipulation-tactic
   flags, and PII redaction as **structured JSON** (`responseConstraint` schema). Works offline,
   free, in milliseconds. Your raw text never leaves the tab.
2. **Stage 2 — Cloud (Gemini Flash):** plain-language explanation, verification steps, and an
   action checklist — generated from the **redacted text only**, streamed to the UI.
3. **Maximum-privacy toggle:** one switch disables Stage 2 entirely — a pure on-device app.

Two lenses, one engine: **🛡️ Scam Shield** (SMS, job fraud, phishing, UPI scams) and
**🔍 Fine-Print X-ray** (rental clauses, loan offers, subscription traps). Every result is
badged with the engine that produced it (`ON_DEVICE` / `IN_CLOUD` / `DEMO` / `SKIPPED`) —
nothing is ever faked. The Android app ([android/](android/README.md)) runs the identical
pipeline against the same Firebase project — history, thresholds, and flags stay in sync
across platforms, which is the heart of the Grand Prize story.

## Firebase products used

| Product | How it's used (see code) |
|---|---|
| **AI Logic (hybrid)** | `src/ai.js` — Nano triage + Flash deep-analysis, `inferenceSource` badges, latency per stage |
| **App Check** | `src/firebase.js` — reCAPTCHA Enterprise in prod, **debug provider** for local dev/submission |
| **Authentication** | Anonymous auto sign-in + Google/email upgrade with guest-history linking, reset, sign-out (`src/firebase.js`, account modal) |
| **Firestore** | Redacted-only history, per-user security rules (`src/history.js`, `firestore.rules`) |
| **Remote Config** | Cloud model, risk thresholds, feature flags, disclaimer text (`RC_DEFAULTS`, live fetch) |
| **Hosting** | `firebase.json` — `firebase deploy` serves `dist/` |

```
paste / screenshot ──▶ NANO (on-device, structured JSON) ──▶ redacted text ──▶ FLASH (cloud, streamed md)
  (raw, stays local)   verdict · risk · tactics · PII scrub     (only this      explanation · verify steps
                                                   crosses the net)  · action checklist
```

## Quickstart (5 minutes)

**Prereqs:** Node 18+, Chrome Desktop 139+.

```bash
npm install
cp .env.example .env   # then fill in Firebase web-app keys (Project settings > Your apps)
npm run dev            # open http://localhost:5173 in Chrome
```

Without `.env` keys the app runs in **clearly-labeled demo mode** so judges can click
everything; with keys it runs the real Firebase AI Logic pipeline.

**Enable Gemini Nano in Chrome (one time):**

1. Update Chrome at `chrome://settings/help` (139+).
2. Set `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → **Enabled**, restart.
3. Optional (avoids a first-run wait): DevTools console → `await LanguageModel.create()` —
   first download is ~1–2 GB, once.

**Firebase setup (one time):**

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com),
   add a **Web app**, paste keys into `.env`.
2. **AI Logic:** open AI Services → AI Logic → Get started → choose **Gemini Developer API**.
3. **App Check:** Security → App Check → enforce for AI Logic; run the app, copy the
   `AppCheck debug token` from DevTools console → Apps → your app → Manage debug tokens.
   (Debug tokens are accepted for submissions.) For production, register a reCAPTCHA
   Enterprise key and set `VITE_APPCHECK_SITE_KEY`.
4. **Auth:** enable Anonymous + Google providers.
5. **Firestore:** create database → deploy rules: `firebase deploy --only firestore:rules`.
6. **Remote Config** (optional — sane defaults ship in code): `cloud_model`,
   `risk_high` (70), `risk_medium` (35), `max_input_chars` (6000), `stage2_max_tokens`,
   `cloud_stage_enabled`, `image_input_enabled`, `history_enabled`, `disclaimer_text`.

```bash
npm run smoke    # node:test suite for the offline modules (redaction, fallback engine, XSS guard)
npm run build    # vite production build → dist/
firebase deploy  # hosting + rules (needs: npm i -g firebase-tools; firebase login)

**Vercel instead (recommended judging URL):** import the repo (framework: Vite —
`vercel.json` is preconfigured), set the `VITE_FIREBASE_*` env vars (+ optional
`VITE_APPCHECK_SITE_KEY`) in Project Settings → Environment Variables, then add the
`*.vercel.app` domain to Firebase Auth → **Authorized domains** and to your reCAPTCHA
Enterprise key. HTTPS is automatic, which on-device Nano requires outside localhost.
```

## Project structure

```
index.html            app shell (header pills, pipeline cards, results, history drawer, tour bar)
src/main.js           orchestration: pipeline, fallbacks, history restore, honest engine badges, tour runner
src/ai.js             Firebase AI Logic: ONLY_ON_DEVICE triage + ONLY_IN_CLOUD deep-analysis
src/firebase.js       App / App Check / Auth / Firestore / Remote Config bootstrap
src/schemas→ai.js     Stage-1 JSON contract via Schema helpers (verdict, risk, tactics, redaction)
src/prompts.js        Stage-1/2 prompt templates per lens
src/redact.js         deterministic PII pre-scrub + span capture, safe JSON parse, XSS-safe markdown (node-safe)
src/links.js          Link X-ray: deterministic on-device URL risk checks (node-safe)
src/demotour.js       guided 3-minute demo script data — step budgets sum to 180 s
src/demo.js           labeled heuristic fallback — same JSON contract, never passed off as AI
src/history.js        Firestore CRUD (redacted only) + local-session fallback
src/ui.js             render helpers (verdict, risk meter, tactics, links, diff highlights, history)
src/styles.css        full dark UI, no framework
public/sw.js          offline app-shell cache (Firebase/Google APIs never cached)
scripts/smoke.mjs     node:test suite
firestore.rules       per-user read/write, no updates
JUDGES.md             Nano + Firebase AI setup for judges, badge legend, video beats
```

## Honesty notes (for judges)

- No Firebase keys / no Nano / offline cloud → the app **says so** and uses the labeled
  demo engine. Engine badges and the `engineNote` line always show what ran.
- Firestore stores **redacted text only** — the raw input is never written anywhere.
- Cloud Stage 2 input is double-scrubbed: model redaction + deterministic regex pre-scrub.
- AI monitoring note: per Firebase docs, on-device inference doesn't appear in console
  AI-monitoring; cloud stages do.

## 3-minute demo script

Press **▶ 3-min demo** (web header / Android top bar): the app replays these
beats itself with a live 3:00 budget clock — or step manually with ←/→.

1. (0:00) Paste the UPI sample → Analyze → Nano verdict in ms, PII scrubbed, all on-device.
2. (0:45) Watch the cloud deep-analysis stream — Link X-ray flags the URL tricks, then the
   redaction diff proves what the cloud saw vs what stayed on-device.
3. (1:30) Turn cloud OFF → re-run: pure on-device result, “maximum-privacy mode”.
4. (2:00) Fine-Print X-ray on the rental clause; open History (Firestore-synced).
5. (2:30) Show Remote Config changing a threshold/disclaimer live; close on architecture.

## Submission checklist

- [ ] Public GitHub repo with this code + `LICENSE` (Apache-2.0) visible in About
- [ ] `.env` filled locally but **never committed** (debug tokens stay private)
- [ ] Hosted URL deployed (`firebase deploy`) for judging
- [ ] YouTube demo ≤ 3 min, English, footage on Chrome, link in Devpost form
- [ ] Devpost text: Firebase AI Logic usage + features + value proposition

## License

Apache-2.0 — see [LICENSE](LICENSE).
