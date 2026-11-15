package com.trustlens.android.data

import com.google.firebase.Firebase
import com.google.firebase.remoteconfig.remoteConfig
import com.google.firebase.remoteconfig.remoteConfigSettings
import kotlinx.coroutines.tasks.await

/** Same keys + defaults as the web app — one console config drives both. */
data class RcValues(
    val cloudModel: String = "gemini-2.5-flash",
    val riskHigh: Int = 70,
    val riskMedium: Int = 35,
    val maxInputChars: Int = 6000,
    val stage2MaxTokens: Int = 1200,
    val cloudStageEnabled: Boolean = true,
    val imageInputEnabled: Boolean = true,
    val historyEnabled: Boolean = true,
    val disclaimer: String = "TrustLens is an AI assistant, not legal or financial advice. When in doubt, verify through official channels before acting.",
)

object Remote {
    suspend fun fetch(): RcValues {
        return try {
            val rc = Firebase.remoteConfig
            rc.setConfigSettingsAsync(remoteConfigSettings {
                minimumFetchIntervalInSeconds = 3600
            }).await()
            rc.setDefaultsAsync(
                mapOf(
                    "cloud_model" to "gemini-2.5-flash",
                    "risk_high" to 70L,
                    "risk_medium" to 35L,
                    "max_input_chars" to 6000L,
                    "stage2_max_tokens" to 1200L,
                    "cloud_stage_enabled" to true,
                    "image_input_enabled" to true,
                    "history_enabled" to true,
                    "disclaimer_text" to RcValues().disclaimer,
                )
            ).await()
            rc.fetchAndActivate().await()
            RcValues(
                cloudModel = rc.getString("cloud_model").ifEmpty { "gemini-2.5-flash" },
                riskHigh = rc.getLong("risk_high").toInt().takeIf { it > 0 } ?: 70,
                riskMedium = rc.getLong("risk_medium").toInt().takeIf { it > 0 } ?: 35,
                maxInputChars = rc.getLong("max_input_chars").toInt().takeIf { it > 0 } ?: 6000,
                stage2MaxTokens = rc.getLong("stage2_max_tokens").toInt().takeIf { it > 0 } ?: 1200,
                cloudStageEnabled = rc.getBoolean("cloud_stage_enabled"),
                imageInputEnabled = rc.getBoolean("image_input_enabled"),
                historyEnabled = rc.getBoolean("history_enabled"),
                disclaimer = rc.getString("disclaimer_text").ifEmpty { RcValues().disclaimer },
            )
        } catch (_: Exception) {
            RcValues() // offline / unconfigured → compiled defaults
        }
    }
}
