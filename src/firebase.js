// Firebase bootstrap: App, App Check, Auth, Firestore, Remote Config, AI Logic.
// Everything degrades gracefully so the app is never a blank screen:
// each subsystem reports its own status and the UI labels fallbacks honestly.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getAll } from 'firebase/remote-config';
import { getAI, GoogleAIBackend } from 'firebase/ai';

const env = import.meta.env;

export const RC_DEFAULTS = {
  cloud_model: 'gemini-2.5-flash',
  risk_high: 70,
  risk_medium: 35,
  max_input_chars: 6000,
  stage2_max_tokens: 1200,
  cloud_stage_enabled: true,
  image_input_enabled: true,
  history_enabled: true,
  disclaimer_text: 'TrustLens is an AI assistant, not legal or financial advice. When in doubt, verify through official channels before acting.',
};

export const firebaseState = {
  configured: false,
  app: null,
  auth: null,
  db: null,
  rcValues: { ...RC_DEFAULTS },
  ai: null,
  appCheck: 'off', // off | debug | enterprise
  user: null,
};

function readConfig() {
  const cfg = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const ok = Object.values(cfg).every((v) => typeof v === 'string' && v.length > 8);
  return ok ? cfg : null;
}

export async function initFirebase() {
  const cfg = readConfig();
  if (!cfg) return firebaseState; // demo mode: UI will say so explicitly

  firebaseState.app = initializeApp(cfg);
  firebaseState.configured = true;

  // --- App Check (required by Firebase AI Logic; debug tokens accepted) ---
  try {
    const siteKey = env.VITE_APPCHECK_SITE_KEY;
    if (siteKey) {
      initializeAppCheck(firebaseState.app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      firebaseState.appCheck = 'enterprise';
    } else if (import.meta.env.DEV) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      // Initializing with the debug flag prints a token in DevTools console;
      // register it under App Check > Apps > Manage debug tokens.
      initializeAppCheck(firebaseState.app, {
        provider: new ReCaptchaEnterpriseProvider('debug-no-site-key'),
        isTokenAutoRefreshEnabled: true,
      });
      firebaseState.appCheck = 'debug';
    }
  } catch (e) {
    console.warn('[app-check] init failed, continuing:', e?.message);
  }

  // --- Auth / Firestore / Remote Config / AI Logic ---
  firebaseState.auth = getAuth(firebaseState.app);
  firebaseState.db = getFirestore(firebaseState.app);
  firebaseState.ai = getAI(firebaseState.app, { backend: new GoogleAIBackend() });

  try {
    const rc = getRemoteConfig(firebaseState.app);
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000;
    rc.defaultConfig = RC_DEFAULTS;
    await fetchAndActivate(rc).catch(() => {});
    const all = getAll(rc);
    for (const [k, v] of Object.entries(all)) {
      const d = RC_DEFAULTS[k];
      firebaseState.rcValues[k] = typeof d === 'number' ? Number(v.asString()) || d
        : typeof d === 'boolean' ? v.asBoolean()
        : v.asString();
    }
  } catch (e) {
    console.warn('[remote-config] using defaults:', e?.message);
  }
  return firebaseState;
}

export function watchUser(cb) {
  if (!firebaseState.auth) { cb(null); return () => {}; }
  return onAuthStateChanged(firebaseState.auth, (u) => { firebaseState.user = u; cb(u); });
}

export async function ensureSignedIn() {
  if (!firebaseState.auth || firebaseState.auth.currentUser) return;
  await signInAnonymously(firebaseState.auth);
}

export async function signInWithGoogle() {
  if (!firebaseState.auth) throw new Error('Firebase is not configured.');
  await signInWithPopup(firebaseState.auth, new GoogleAuthProvider());
}
