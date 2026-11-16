# TrustLens — judge & reviewer guide (3 minutes to full pipeline)

This is the fastest path to seeing the **real hybrid pipeline**:
`ON_DEVICE` Nano triage + `IN_CLOUD` deep-analysis. Without the steps below
the app still works end to end, but Stage 1 shows the honestly-labeled
cloud-triage or demo legs instead.

## 1. Get Gemini Nano (web, one time, ~10 min)

Requirements: **Chrome Desktop 139+** (Nano does not exist on mobile or Edge),
~5 GB free disk for the one-time model download.

1. Open `chrome://settings/help` — confirm 139+ and “up to date”.
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` →
   set **Enabled** → click **Relaunch**.
3. Press **F12** → Console, then run:
   ```js
   await LanguageModel.availability()
   ```
   If it returns `"downloadable"`, start the download and wait (several minutes):
   ```js
   await LanguageModel.create({ monitor(m) {
     m.addEventListener("downloadprogress",
       e => console.log(`Downloaded ${Math.round(e.loaded * 100)}%`));
   }});
   ```
   Re-run `availability()` until it returns `"available"`.
4. Reload TrustLens: the `Nano:` pill reads **ready**, and Stage 1 badges
   `ON_DEVICE` with millisecond latency.

Trouble? `chrome://components` → **Optimization Guide On Device Models** →
**Check for update**, then retry step 3.

## 2. Firebase AI Logic (already wired — just verify)

The deployed app ships with its Firebase config; no keys needed from you.
What to look for:

- Header `Shield:` pill reads `debug` (localhost) or `enterprise` (hosted) —
  App Check attestation is active, as the rules require.
- Run the UPI sample: Stage 2 badges `IN_CLOUD` and streams markdown.
- A document appears in the `analyses` collection (redacted text only).

Running locally instead? `cp .env.example .env`, fill the six
`VITE_FIREBASE_*` keys from Firebase console → Project settings → Your apps,
then `npm install && npm run dev`. AI Logic needs
**AI Services → AI Logic → Get started → Gemini Developer API** enabled once
per project.

## 3. Badge legend (nothing is ever faked)

| Badge | Meaning |
|---|---|
| `ON_DEVICE` | Gemini Nano ran locally (web: Chrome Prompt API, Android: AICore) |
| `IN_CLOUD` | Gemini Flash via Firebase AI Logic, redacted input only |
| `DEMO` | Labeled heuristic fallback (no keys / no Nano / offline) |
| `SKIPPED` | Maximum-privacy mode: cloud stage deliberately off |

## 4. Suggested 3-minute judging run

Press **▶ 3-min demo** in the header — the app drives itself:

1. (0:00) UPI scam → Nano verdict + PII scrub, all on-device.
2. (0:45) Cloud deep-analysis streams; Link X-ray + redaction diff prove privacy.
3. (1:30) Cloud OFF → pure on-device re-run (`SKIPPED` badge).
4. (2:00) Fine-Print X-ray on the rental clause; Firestore-synced History.
5. (2:30) Remote Config thresholds live; close on the hybrid architecture.

Android shows the same tour and badges; history syncs across both apps via
the shared `analyses` collection.
