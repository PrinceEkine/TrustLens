package com.trustlens.android.ai

import android.graphics.Bitmap
import com.google.firebase.Firebase
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.InferenceMode
import com.google.firebase.ai.type.OnDeviceConfig
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.trustlens.android.data.Redact
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

@file:OptIn(PublicPreviewAPI::class)

data class Tactic(val label: String, val why: String, val quote: String = "")

data class TriageResult(
    val verdict: String, // safe | suspicious | malicious
    val riskScore: Int,
    val summary: String,
    val tactics: List<Tactic>,
    val redactedText: String,
    val piiCount: Int,
)

data class TriageRun(val result: TriageResult, val source: String, val ms: Long)

/**
 * Hybrid AI service — Firebase AI Logic is the ONLY AI runtime.
 * Stage 1: ONLY_ON_DEVICE (Gemini Nano via ML Kit Prompt API / AICore).
 * Stage 2: ONLY_IN_CLOUD (Gemini Flash), streaming, on REDACTED text only.
 * A cloud triage model exists purely as an honest, labeled fallback when the
 * device has no Nano (most devices!) — never silently.
 *
 * Deliberate simplification vs web: JSON is prompt-instructed and tolerantly
 * parsed (Redact.parseTriage) instead of responseConstraint schemas, so the
 * app compiles against the beta on-device SDK with minimum API surface.
 * ONLY_* modes make the inference source known by construction.
 */
object HybridAi {
    private var deviceModel: GenerativeModel? = null
    private var cloudDeep: GenerativeModel? = null
    private var cloudTriage: GenerativeModel? = null
    private var cloudModelName: String = ""

    @Synchronized
    private fun models(cloudModel: String, stage2MaxTokens: Int): Triple<GenerativeModel, GenerativeModel, GenerativeModel> {
        if (deviceModel == null || cloudModelName != cloudModel) {
            cloudModelName = cloudModel
            val ai = Firebase.ai(backend = GenerativeBackend.googleAI())
            deviceModel = ai.generativeModel(
                modelName = cloudModel,
                onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE),
            )
            cloudDeep = ai.generativeModel(
                modelName = cloudModel,
                onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
                generationConfig = generationConfig {
                    maxOutputTokens = stage2MaxTokens
                    temperature = 0.4f
                },
            )
            cloudTriage = ai.generativeModel(
                modelName = cloudModel,
                onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD),
                generationConfig = generationConfig {
                    maxOutputTokens = 1500
                    temperature = 0.2f
                },
            )
        }
        return Triple(deviceModel!!, cloudDeep!!, cloudTriage!!)
    }

    /** Loads Nano into memory; first-ever call may download the model (AICore). */
    suspend fun warmUp(cloudModel: String, stage2MaxTokens: Int) {
        val (device, _, _) = models(cloudModel, stage2MaxTokens)
        device.onDeviceExtension?.warmUp()
    }

    suspend fun triageOnDevice(
        mode: String, text: String, bitmap: Bitmap?,
        cloudModel: String, stage2MaxTokens: Int,
    ): TriageRun {
        val (device, _, _) = models(cloudModel, stage2MaxTokens)
        val prompt = Prompts.stage1(mode) + "\n\n--- INPUT ---\n" + text.ifEmpty { "(analyze the attached image)" }
        val t0 = System.currentTimeMillis()
        val response = if (bitmap != null) {
            device.generateContent(content {
                text(prompt)
                image(bitmap)
            })
        } else {
            device.generateContent(prompt)
        }
        val ms = System.currentTimeMillis() - t0
        return TriageRun(Redact.parseTriage(response.text, text), "ON_DEVICE", ms)
    }

    suspend fun triageCloud(
        mode: String, text: String, bitmap: Bitmap?,
        cloudModel: String, stage2MaxTokens: Int,
    ): TriageRun {
        val (_, _, triage) = models(cloudModel, stage2MaxTokens)
        val prompt = Prompts.stage1(mode) + "\n\n--- INPUT ---\n" + text.ifEmpty { "(analyze the attached image)" }
        val t0 = System.currentTimeMillis()
        val response = if (bitmap != null) {
            triage.generateContent(content {
                text(prompt)
                image(bitmap)
            })
        } else {
            triage.generateContent(prompt)
        }
        val ms = System.currentTimeMillis() - t0
        return TriageRun(Redact.parseTriage(response.text, text), "IN_CLOUD", ms)
    }

    /** Streams the deep-analysis markdown on redacted text only. */
    fun deepStream(
        mode: String, redacted: String, s1: TriageResult,
        cloudModel: String, stage2MaxTokens: Int,
    ): Flow<String> {
        val (_, deep, _) = models(cloudModel, stage2MaxTokens)
        return deep.generateContentStream(Prompts.stage2(mode, redacted, s1))
            .map { it.text.orEmpty() }
    }

    fun friendlyError(e: Throwable): Pair<String, String> {
        val msg = e.message.orEmpty()
        return when {
            msg.contains("unavailable", true) || msg.contains("not available", true) ||
                msg.contains("AICore", true) || msg.contains("download", true) ||
                msg.contains("MODEL", true) ->
                "On-device model unavailable" to
                    "Needs a Nano-capable device (e.g. Pixel 8 Pro/9, Galaxy S24+) with the model downloaded. Falling back to labeled cloud triage."
            msg.contains("appcheck", true) || msg.contains("attest", true) || msg.contains("403", true) ->
                "App Check blocked the request" to
                    "Register your debug token (Logcat: 'App Check debug token') under App Check > Apps > Manage debug tokens."
            msg.contains("429", true) || msg.contains("quota", true) || msg.contains("exhausted", true) ->
                "Cloud quota exhausted" to "On-device results above are still valid. Retry the cloud stage later."
            msg.contains("network", true) || msg.contains("Unable to resolve host", true) ->
                "Network unreachable" to "On-device stage works offline; the cloud stage needs connectivity."
            else -> "AI request failed" to msg.take(180)
        }
    }
}
