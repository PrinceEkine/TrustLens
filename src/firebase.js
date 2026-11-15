// Firebase bootstrap: App, App Check, Auth, Firestore, Remote Config, AI Logic.
// Everything degrades gracefully so the app is never a blank screen:
// each subsystem reports its own status and the UI labels fallbacks honestly.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, EmailAuthProvider, linkWithCredential, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getAll } from 'firebase/remote-config';
import { getAI, GoogleAIBackend } from 'firebase/ai';

const env = import.meta.env;

export const RC_DEFAULTS = {
  cloud_model: 'gemini-3.8-flash',
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

/** Create account; anonymous guests are UPGRADED (uid + history preserved). */
export async function signUpEmail(email, password) {
  const auth = firebaseState.auth;
  if (!auth) throw new Error('not-configured');
  const u = auth.currentUser;
  if (u && u.isAnonymous) {
    try {
      await linkWithCredential(u, EmailAuthProvider.credential(email, password));
      return { linked: true };
    } catch (e) {
      // Email taken → fall through to plain sign-in below.
      if (e?.code !== 'auth/email-already-in-use' && e?.code !== 'auth/credential-already-in-use') throw e;
    }
  }
  await createUserWithEmailAndPassword(auth, email, password);
  return { linked: false };
}

export async function signInEmail(email, password) {
  const auth = firebaseState.auth;
  if (!auth) throw new Error('not-configured');
  await signInWithEmailAndPassword(auth, email, password);
}

export async function sendReset(email) {
  const auth = firebaseState.auth;
  if (!auth) throw new Error('not-configured');
  await sendPasswordResetEmail(auth, email);
}

/** Sign out, then quietly return to a fresh guest session. */
export async function signOutUser() {
  const auth = firebaseState.auth;
  if (!auth) return;
  await signOut(auth);
  try { await signInAnonymously(auth); } catch { /* offline: stay signed out */ }
}

export function friendlyAuthError(e) {
  switch (e?.code) {
    case 'auth/invalid-email': return 'That email address looks invalid.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'Wrong email or password.';
    case 'auth/email-already-in-use': return 'An account with this email already exists — sign in instead.';
    case 'auth/weak-password': return 'Password must be at least 6 characters.';
    case 'auth/operation-not-allowed': return 'Email login is off — enable Email/Password in Firebase console → Authentication → Sign-in method.';
    case 'auth/too-many-requests': return 'Too many attempts — wait a minute and try again.';
    case 'auth/network-request-failed': return 'Network unreachable — check your connection.';
    case 'auth/popup-closed-by-user': return 'Sign-in popup was closed.';
    case 'not-configured': return 'Firebase is not configured — add keys to .env.';
    default: return (e?.message || 'Sign-in failed.').slice(0, 160);
  }
}
