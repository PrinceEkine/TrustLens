# TrustLens for Android 🤖

Native Android twin of the TrustLens web app — the **same two-stage hybrid pipeline**
(on-device Nano triage + PII scrub → cloud deep-analysis on redacted text only) against
the **same Firebase project**, so history syncs across web and Android.

- AI runtime: Firebase AI Logic hybrid (`firebase-ai` + `firebase-ai-ondevice` beta),
  `InferenceMode.ONLY_ON_DEVICE` / `ONLY_IN_CLOUD`, `onDeviceExtension?.warmUp()`.
- On-device Nano needs a capable device (Pixel 8 Pro/9, Galaxy S24+, …) via AICore.
  Every other device gets **labeled** cloud triage or the demo engine — never silent.
- Same `analyses` Firestore collection, same Remote Config keys, same prompts as web.

## Setup (Android Studio, latest stable)

1. **Free disk first:** SDK + Gradle + caches need ~10 GB. Check free space.
2. In the Firebase console, add an **Android app** to the SAME project as the web app:
   package `com.trustlens.android`. Download **`google-services.json`** into `android/app/`
   (git-ignored — never commit it).
3. **App Check:** the app uses the debug provider in debug builds. Run once, copy the
   `App Check debug token` from Logcat → App Check → Apps → Manage debug tokens.
   Enforce App Check for AI Logic (debug tokens are accepted for submissions).
4. **Auth:** enable Anonymous. **Firestore:** same database + already-deployed rules
   (`../firestore.rules` — platform-agnostic, per-user). **Remote Config:** same keys.
5. Open the `android/` folder in Android Studio → let it sync → Run on a device
   (a Nano-capable physical device shows ON_DEVICE; emulators show cloud/demo legs).

## What to demo (cross-platform story)

1. Analyze the UPI sample on Android (note the engine badges + latencies).
2. Open the web app → History: the same redacted analysis is there (shared Firestore).
3. Change `risk_high` in Remote Config: both apps move their thresholds.
4. Toggle cloud off on Android: pure on-device result (Nano device) or honest demo
   fallback (other devices) — maximum-privacy mode either way.

## Project layout

```
android/
  settings.gradle.kts  rootProject + repos
  build.gradle.kts     pinned AGP / Kotlin / google-services versions
  app/build.gradle.kts BoM 35.2.0 + firebase-ai-ondevice:16.0.0-beta08, minSdk 26, Compose
  app/src/main/...
    TrustLensApplication.kt  Firebase init + App Check (debug in DEBUG, Play Integrity in release)
    MainActivity.kt          Compose entry point
    TrustLensViewModel.kt    pipeline orchestration (mirrors web main.js)
    ai/HybridAi.kt           ONLY_ON_DEVICE triage + ONLY_IN_CLOUD streaming deep-analysis
    ai/Prompts.kt            stage-1/2 prompts (same contract as web)
    ai/DemoEngine.kt         labeled heuristic fallback (never passed off as AI)
    data/Redact.kt           PII pre-scrub + tolerant model-JSON parsing
    data/Remote.kt           Remote Config fetch (same keys as web)
    data/HistoryRepo.kt      shared 'analyses' collection + local fallback
    ui/TrustLensScreen.kt    full Compose UI (tabs, stages, verdict, history)
    ui/Theme.kt              dark Material3 theme
```

Deliberate simplification vs web: Stage-1 JSON is prompt-instructed + tolerantly
parsed rather than `responseConstraint` schemas, keeping the beta on-device API
surface minimal. ONLY_* modes make the inference badge known by construction.
