package com.trustlens.android.data

import java.net.URI

/** Link X-ray: deterministic, on-device URL risk checks. Mirrors web src/links.js. */
object LinkXray {
    data class Finding(val level: String, val label: String, val detail: String)
    data class Report(val url: String, val host: String, val findings: List<Finding>, val worst: String, val risk: Int)

    private val urlRe = Regex("""(?:https?://[^\s<>"')\]]+|www\.[^\s<>"')\]]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:/[^\s<>"')\]]*)?)""", RegexOption.IGNORE_CASE)
    private val emailBefore = Regex("""[a-zA-Z0-9._%+-]+@$""")
    private val trailPunct = Regex("""[.,;:!?)"'\]]+$""")
    private const val MAX_LINKS = 8

    private val shorteners = setOf("bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "ow.ly", "buff.ly", "tiny.cc", "rb.gy", "s.id", "ln.run")
    private val riskyTlds = setOf("xyz", "top", "click", "link", "tk", "ml", "gq", "cf", "ga", "buzz", "vip", "win", "bid", "loan", "work", "men", "date", "stream", "download", "zip", "mov")
    private val brands = listOf("hdfc", "sbi", "icici", "axis", "paytm", "phonepe", "gpay", "google", "amazon", "flipkart", "indiapost", "rbi", "trai", "apple", "netflix", "whatsapp", "telegram", "aadhaar", "okhdfc", "olx", "swiggy", "zomato")

    /** Pull candidate URLs out of free text. Skips email addresses. */
    fun extractLinks(text: String): List<String> {
        val out = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        for (m in urlRe.findAll(text)) {
            var raw = m.value.replace(trailPunct, "")
            if (raw.isEmpty() || !seen.add(raw.lowercase())) continue
            // Reject the domain half of an email address (user@host.tld) and UPI ids.
            if (emailBefore.containsMatchIn(text.substring(maxOf(0, m.range.first - 64), m.range.first))) continue
            if (raw.contains('@') && !hasScheme(raw)) continue
            out += raw
            if (out.size >= MAX_LINKS) break
        }
        return out
    }

    /** Deterministic checks over one link. Returns findings + worst level. */
    fun analyze(raw: String): Report {
        val uri = try {
            URI(if (hasScheme(raw)) raw else "http://$raw")
        } catch (_: Exception) { return Report(raw, "", emptyList(), "ok", 0) }
        if (!hasScheme(raw) && uri.host.isNullOrEmpty()) return Report(raw, "", emptyList(), "ok", 0)
        val host = (uri.host ?: "").lowercase().trimEnd('.')
        if (host.isEmpty()) return Report(raw, "", emptyList(), "ok", 0)
        val labels = host.split('.')
        val tld = labels.last()
        val findings = mutableListOf<Finding>()
        fun add(level: String, label: String, detail: String) = findings.add(Finding(level, label, detail))

        if (Regex("""^\d{1,3}(\.\d{1,3}){3}$""").matches(host) || host.contains(':')) {
            add("bad", "Numeric IP address", "Legitimate brands use domain names; raw IPs hide who you are really visiting.")
        }
        if (uri.scheme?.lowercase() == "http") {
            add("warn", "Unencrypted http", "No TLS padlock — anything you type can be read or altered in transit.")
        }
        if (raw.contains('@')) {
            add("bad", "@ trick", "Everything before @ is ignored by browsers — the real destination is after it.")
        }
        if (labels.any { it.startsWith("xn--") }) {
            add("bad", "Punycode lookalike", "xn-- means non-Latin letters designed to mimic a trusted brand visually.")
        }
        if (Regex("[a-z][0-9]|[0-9][a-z]", RegexOption.IGNORE_CASE).containsMatchIn(host) && host.any { it in "il1o0" }) {
            val sub = Regex("[a-z0-9]*[0-9][a-z0-9]*", RegexOption.IGNORE_CASE).find(host)?.value ?: host
            add("warn", "Letter/number swap", "\"$sub\" mixes digits into words — a classic lookalike-domain trick (e.g. indiap0st).")
        }
        val root = labels.takeLast(2).joinToString(".")
        if (root in shorteners || host in shorteners) {
            add("warn", "URL shortener", "The real destination is hidden — expand it before tapping.")
        }
        if (tld in riskyTlds) {
            add("warn", "Risky TLD .$tld", "Cheap, abused top-level domain that phishing kits favor.")
        }
        if (labels.size >= 4) {
            add("warn", "Deep subdomain stack", "\"$host\" buries the real domain under ${labels.size} labels to confuse readers.")
        }
        for (b in brands) {
            val hit = labels.firstOrNull { it.contains(b) && it.length > b.length + 3 }
            if (hit != null) {
                add("warn", "Brand name padding", "\"$hit\" wraps \"$b\" in extra words — official sites do not do this.")
                break
            }
        }
        if (uri.port != -1 && uri.port != 80 && uri.port != 443) {
            add("warn", "Odd port :${uri.port}", "Public sites rarely need an explicit port; kits often do.")
        }
        if (raw.length > 90) {
            add("info", "Very long link", "Length alone is not proof — but phishing links hide payloads in long query strings.")
        }
        if (findings.isEmpty()) {
            add("ok", "No obvious tricks", "Still verify through the official app — absence of tricks is not proof of safety.")
        }
        val risk = findings.sumOf { if (it.level == "bad") 34 else if (it.level == "warn") 14 else 0 }.coerceAtMost(100)
        val worst = if (findings.any { it.level == "bad" }) "bad" else if (findings.any { it.level == "warn" }) "warn" else "ok"
        return Report(if (raw.length > 120) raw.take(120) + "…" else raw, host, findings, worst, risk)
    }

    /** Full X-ray for a block of text: one report per link found. */
    fun xray(text: String): List<Report> = extractLinks(text).map(::analyze)

    private fun hasScheme(raw: String) =
        raw.startsWith("http://", ignoreCase = true) || raw.startsWith("https://", ignoreCase = true)
}
