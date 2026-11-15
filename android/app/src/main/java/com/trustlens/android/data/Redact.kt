package com.trustlens.android.data

import com.trustlens.android.ai.Tactic
import com.trustlens.android.ai.TriageResult
import org.json.JSONObject

/** Deterministic PII pre-scrub + tolerant model-JSON parsing. Mirrors web src/redact.js. */
object Redact {
    private val patterns = listOf(
        "email" to Regex("""[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"""),
        "upi" to Regex("""[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}"""),
        "phone" to Regex("""(?<!\d)(?:\+?\d{1,3}[-.\s]?)?(?:\d[-.\s]?){7,12}\d(?!\d)"""),
        "card" to Regex("""(?<!\d)(?:\d[ -]?){13,19}(?!\d)"""),
        "aadhaar" to Regex("""(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)"""),
    )
    private val urlQuery = Regex("""(https?://[^\s?]+)\?[^\s]*""")

    data class Scrub(val text: String, val count: Int)

    fun prescrub(input: String): Scrub {
        var out = input
        var count = 0
        out = urlQuery.replace(out) { m ->
            count++; m.groupValues[1] + "?…"
        }
        for ((type, re) in patterns) {
            out = re.replace(out) { m ->
                count++
                val v = m.value
                val keep = if (v.length <= 4) 0 else 2
                v.take(keep) + "•".repeat(maxOf(3, minOf(v.length - keep, 12))) + "[$type]"
            }
        }
        return Scrub(out, count)
    }

    /** Extract the first {...} JSON object from model output, tolerantly. */
    fun parseTriage(raw: String?, originalText: String): TriageResult {
        val clean = (raw ?: "").trim()
            .removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        var obj: JSONObject? = null
        try {
            obj = JSONObject(clean)
        } catch (_: Exception) {
            val s = clean.indexOf('{'); val e = clean.lastIndexOf('}')
            if (s >= 0 && e > s) {
                try { obj = JSONObject(clean.substring(s, e + 1)) } catch (_: Exception) { }
            }
        }
        val verdict = obj?.optString("verdict")?.lowercase()?.takeIf {
            it == "safe" || it == "suspicious" || it == "malicious"
        } ?: "suspicious"
        val tactics = mutableListOf<Tactic>()
        val arr = obj?.optJSONArray("tactics")
        if (arr != null) {
            for (i in 0 until minOf(arr.length(), 6)) {
                val t = arr.optJSONObject(i) ?: continue
                tactics += Tactic(
                    label = t.optString("label", "Flag").take(60),
                    why = t.optString("why", "").take(280),
                    quote = t.optString("quote", "").take(140),
                )
            }
        }
        val modelRedacted = obj?.optString("redactedText")?.takeIf { it.isNotEmpty() } ?: originalText
        val scrub = prescrub(modelRedacted) // defense in depth on top of model redaction
        return TriageResult(
            verdict = verdict,
            riskScore = (obj?.optDouble("riskScore", 50.0) ?: 50.0).toInt().coerceIn(0, 100),
            summary = (obj?.optString("summary", "Analysis complete.")).take(240),
            tactics = tactics,
            redactedText = scrub.text,
            piiCount = (obj?.optInt("piiCount", 0) ?: 0) + scrub.count,
        )
    }

    fun truncate(text: String, maxChars: Int): Pair<String, Boolean> =
        if (text.length <= maxChars) text to false
        else (text.take(maxChars) + "\n[…trimmed for on-device context…]") to true
}
