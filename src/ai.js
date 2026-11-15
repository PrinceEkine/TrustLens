// Hybrid AI service — Firebase AI Logic is the ONLY AI runtime.
// Stage 1: ONLY_ON_DEVICE (Gemini Nano via Chrome Prompt API), structured JSON.
// Stage 2: ONLY_IN_CLOUD (Gemini Flash), streaming markdown on redacted text.
// A separate cloud triage model exists purely as an honest, labeled fallback
// when the device has no Nano (e.g. non-Chrome) — never silently.

import { getGenerativeModel, InferenceMode, Schema } from 'firebase/ai';
import { firebaseState } from './firebase.js';
import { STAGE1_PROMPT, STAGE2_PROMPT } from './prompts.js';
import { safeJsonParse, clamp, prescrub } from './redact.js';

let deviceModel = null;
let cloudDeepModel = null;
let cloudTriageModel = null;
let cloudModelName = '';

function buildStage1Schema() {
  return Schema.object({
    properties: {
      verdict: Schema.string(), // safe | suspicious | malicious
      riskScore: Schema.number(),
      summary: Schema.string(),
      tactics: Schema.array({
        items: Schema.object({
          properties: {
            label: Schema.string(),
            why: Schema.string(),
            quote: Schema.string(),
          },
          optionalProperties: ['quote'],
        }),
      }),
      redactedText: Schema.string(),
      piiCount: Schema.number(),
    },
  });
}

export function getModels() {
  const ai = firebaseState.ai;
  if (!ai) return null;
  const rc = firebaseState.rcValues;
  if (!deviceModel) {
    deviceModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        promptOptions: { responseConstraint: buildStage1Schema() },
        // Nano requires a declared output language for quality + safety attestation.
        createOptions: {
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
          // Newer Chrome Prompt API shape; passed through when supported, ignored otherwise.
          outputLanguage: 'en',
        },
      },
    });
  }
  if (!cloudDeepModel || cloudModelName !== rc.cloud_model) {
    cloudModelName = rc.cloud_model;
    cloudDeepModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModelName,
        generationConfig: { maxOutputTokens: rc.stage2_max_tokens, temperature: 0.4 },
      },
    });
    cloudTriageModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: buildStage1Schema(),
          maxOutputTokens: 1500,
          temperature: 0.2,
        },
      },
    });
  }
  return { deviceModel, cloudDeepModel, cloudTriageModel };
}

/** Chrome Prompt API availability probe for the status pill. */
export async function nanoStatus() {
  try {
    const LM = globalThis.LanguageModel;
    if (!LM?.availability) return 'unknown';
    return await LM.availability(); // available | downloading | downloadable | unavailable
  } catch {
    return 'unknown';
  }
}

/** MUST be called from a user gesture, before first generateContent. */
export async function warmDevice(onProgress) {
  const models = getModels();
  if (!models) throw new Error('firebase-missing');
  await models.deviceModel.initializeDeviceModel((v) => onProgress?.(v));
}

export function fileToImagePart(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      reject(new Error('Only PNG or JPEG images work with on-device inference.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onloadend = () => {
      const base64 = String(reader.result).split(',')[1];
      resolve({ type: 'inlineData', inlineData: { data: base64, mimeType: file.type } });
    };
    reader.readAsDataURL(file);
  });
}

/** Coerce model JSON into the exact UI contract; never trust raw output. */
export function normalizeStage1(obj, originalText) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const verdict = ['safe', 'suspicious', 'malicious'].includes(o.verdict) ? o.verdict : 'suspicious';
  const tactics = Array.isArray(o.tactics) ? o.tactics.slice(0, 6).map((t) => ({
    label: String(t?.label ?? 'Flag').slice(0, 60),
    why: String(t?.why ?? '').slice(0, 280),
    quote: String(t?.quote ?? '').slice(0, 140),
  })) : [];
  // Defense in depth: deterministic scrub on top of the model's redaction.
  const modelRedacted = typeof o.redactedText === 'string' && o.redactedText.length > 0
    ? o.redactedText : originalText;
  const scrub = prescrub(modelRedacted);
  return {
    verdict,
    riskScore: clamp(o.riskScore, 0, 100),
    summary: String(o.summary ?? 'Analysis complete.').slice(0, 240),
    tactics,
    redactedText: scrub.text,
    piiCount: (Number(o.piiCount) || 0) + scrub.count,
  };
}

async function runTriage(model, prompt, imagePart, fallbackSource) {
  const t0 = performance.now();
  const parts = imagePart ? [prompt, imagePart] : [prompt];
  const result = await model.generateContent(parts);
  const ms = Math.round(performance.now() - t0);
  const raw = result.response.text();
  return { json: safeJsonParse(raw), source: result.response.inferenceSource || fallbackSource, ms, raw };
}

export async function runStage1OnDevice(mode, text, imagePart) {
  const { deviceModel } = getModels();
  const prompt = `${STAGE1_PROMPT[mode]}\n\n--- INPUT ---\n${text}`;
  return runTriage(deviceModel, prompt, imagePart, 'ON_DEVICE');
}

export async function runStage1Cloud(mode, text, imagePart) {
  const { cloudTriageModel } = getModels();
  const prompt = `${STAGE1_PROMPT[mode]}\n\n--- INPUT ---\n${text}`;
  return runTriage(cloudTriageModel, prompt, imagePart, 'IN_CLOUD');
}

export async function runStage2Stream(mode, redactedText, stage1, onChunk) {
  const { cloudDeepModel } = getModels();
  const prompt = STAGE2_PROMPT[mode](redactedText, stage1);
  const t0 = performance.now();
  const result = await cloudDeepModel.generateContentStream(prompt);
  let full = '';
  for await (const chunk of result.stream) {
    const piece = chunk.text();
    full += piece;
    onChunk?.(piece, full);
  }
  const response = await result.response;
  return { text: full, source: response.inferenceSource || 'IN_CLOUD', ms: Math.round(performance.now() - t0) };
}

export function friendlyError(e) {
  const msg = String(e?.message ?? e ?? '');
  if (/firebase-missing/i.test(msg)) return { title: 'Firebase not configured', hint: 'Add your web app keys to .env — see README. Showing demo-engine results instead.' };
  if (/unavailable|not available|no model|download|DEVICE_MODEL/i.test(msg)) return { title: 'On-device model unavailable', hint: 'Use Chrome Desktop 139+ with chrome://flags/#prompt-api-for-gemini-nano-multimodal-input enabled. Falling back to labeled cloud triage.' };
  if (/app.?check|attestat|403/i.test(msg)) return { title: 'App Check blocked the request', hint: 'Register your debug token (DevTools console) under App Check > Apps > Manage debug tokens.' };
  if (/429|quota|exhausted|RESOURCE_EXHAUSTED/i.test(msg)) return { title: 'Cloud quota exhausted', hint: 'On-device results above are still valid. Retry the cloud stage later.' };
  if (/\b404\b|not found|no longer available|unknown model|MODEL_NOT_FOUND/i.test(msg)) return { title: 'Cloud model unavailable', hint: 'The cloud model name was rejected (retired or misspelled). Update cloud_model in code/Remote Config — see README.' };
  if (/\b50[023]\b|overload|high demand|deadline|timeout|abort/i.test(msg)) return { title: 'Cloud overloaded', hint: 'Google’s AI servers are busy (transient 5xx/timeout). Wait ~1 min and re-run — nothing on your side is broken.' };
  if (/Failed to fetch|network request failed|NetworkError|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|offline/i.test(msg)) return { title: 'Network unreachable', hint: 'On-device stage works offline; the cloud stage needs connectivity.' };
  if (/vertexai|API.*not enabled|has not been used|enable this API|SERVICE_DISABLED/i.test(msg)) return { title: 'AI Logic API not enabled', hint: 'Console → AI Services → AI Logic → Get started (Gemini Developer API), or enable firebasevertexai.googleapis.com for your project. Wait ~2 min, retry.' };
  return { title: 'AI request failed', hint: msg.slice(0, 180) };
}
