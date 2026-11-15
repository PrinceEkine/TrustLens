package com.trustlens.android.ai

import com.trustlens.android.ai.TriageResult

/** Prompt templates — same contract as the web app (see web src/prompts.js). */
object Prompts {
    const val STAGE1_SCAM = """You are TrustLens, an on-device fraud analyst. Analyze this possibly-scammy message (or screenshot) and respond with JSON ONLY.
Fields:
- verdict: "safe" | "suspicious" | "malicious"
- riskScore: 0-100 (how likely this is a scam or fraud attempt)
- summary: one short sentence, max 240 characters
- tactics: up to 5 items {label, why, quote} naming manipulation tactics (urgency, authority impersonation, advance fee, phishing link, threat, too-good-to-be-true, secrecy pressure). quote = short exact snippet evidencing it, or "".
- redactedText: the input rewritten with ALL personal data masked (names->[NAME], phones->[PHONE], emails/UPI->[CONTACT], account/card/ID numbers->[ID], exact addresses->[ADDRESS]). Keep scam evidence (amounts, link domains, wording).
- piiCount: number of spans you masked.
Be decisive. Legitimate delivery/job/bank messages exist — only flag real signals."""

    const val STAGE1_FINE = """You are TrustLens, an on-device contract analyst. Analyze this clause/terms text (or screenshot) and respond with JSON ONLY.
Fields:
- verdict: "safe" | "suspicious" | "malicious" (how hostile is this to the signing party: safe=fair, suspicious=one-sided terms, malicious=predatory trap)
- riskScore: 0-100 (financial/legal risk to the signer)
- summary: one short sentence, max 240 characters
- tactics: up to 5 items {label, why, quote} naming hostile patterns (auto-renewal trap, unilateral changes, excessive penalties, jurisdiction lock-in, refund delays, non-refundable, forced consent, foreclosure fees). quote = short exact snippet, or "".
- redactedText: the input rewritten with personal data masked (names->[NAME], phones->[PHONE], emails->[CONTACT], account numbers->[ID], addresses->[ADDRESS]). Keep money amounts, rates, and time periods — they are needed for analysis.
- piiCount: number of spans you masked."""

    fun stage1(mode: String) = if (mode == "fine") STAGE1_FINE else STAGE1_SCAM

    fun stage2(mode: String, redacted: String, s1: TriageResult): String {
        val flags = s1.tactics.joinToString(", ") { it.label }.ifEmpty { "none" }
        return if (mode == "fine") {
            """You are TrustLens, a plain-language contract explainer (not a lawyer). Our on-device model already judged this clause ${s1.verdict.uppercase()} (risk ${s1.riskScore}/100): "${s1.summary}". Key flags: $flags.

REDACTED TEXT (personal data already masked):
"""
$redacted
"""

Write markdown with these sections:
## What this really means
## Money and time traps (call out every amount, rate, deadline)
## Questions to ask before signing (numbered, copy-paste ready)
## Safer alternatives to propose
Keep it under 350 words. End with one line: consult a professional for high-value agreements."""
        } else {
            """You are TrustLens, a fraud explainer. A user received a message. Our on-device model already judged it ${s1.verdict.uppercase()} (risk ${s1.riskScore}/100): "${s1.summary}". Key flags: $flags.

REDACTED MESSAGE (personal data already masked; never ask for or repeat unmasked PII):
"""
$redacted
"""

Write a clear deep-analysis in markdown with these sections:
## Verdict in plain words
## Tricks being used (explain each like I'm new to this)
## How to verify safely (numbered steps using official channels only)
## What to do next (checklist: do this / never do this)
Keep it under 350 words. Calm, concrete, no jargon."""
        }
    }
}
