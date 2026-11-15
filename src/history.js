// Analysis history: Firestore (redacted excerpts only) with an honest
// in-memory fallback when Firebase is not configured.
import { collection, addDoc, query, where, orderBy, limit, getDocs, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { firebaseState } from './firebase.js';

const memory = [];
const CAP = 20;

export function historyMode() {
  if (!firebaseState.configured || !firebaseState.rcValues.history_enabled) return 'local';
  return 'cloud';
}

export async function saveAnalysis(record) {
  const entry = { ...record, id: `m${Date.now()}`, createdAt: new Date().toISOString(), local: true };
  if (historyMode() === 'local' || !firebaseState.user) {
    memory.unshift(entry);
    if (memory.length > CAP) memory.length = CAP;
    return { local: true };
  }
  try {
    await addDoc(collection(firebaseState.db, 'analyses'), {
      ...record,
      uid: firebaseState.user.uid,
      createdAt: serverTimestamp(),
    });
    return { local: false };
  } catch (e) {
    console.warn('[history] firestore write failed, kept locally:', e?.message);
    memory.unshift(entry);
    return { local: true };
  }
}

export async function listAnalyses() {
  if (historyMode() === 'local' || !firebaseState.user) return { items: [...memory], local: true };
  try {
    const q = query(
      collection(firebaseState.db, 'analyses'),
      where('uid', '==', firebaseState.user.uid),
      orderBy('createdAt', 'desc'),
      limit(CAP)
    );
    const snap = await getDocs(q);
    return { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })), local: false };
  } catch (e) {
    console.warn('[history] firestore read failed:', e?.message);
    return { items: [...memory], local: true };
  }
}

export async function removeAnalysis(item) {
  const mi = memory.findIndex((m) => m.id === item.id);
  if (mi >= 0) memory.splice(mi, 1);
  if (!item.local && firebaseState.db) {
    try { await deleteDoc(doc(firebaseState.db, 'analyses', item.id)); } catch { /* already gone */ }
  }
}
