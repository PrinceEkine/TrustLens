package com.trustlens.android.ai

import com.trustlens.android.data.RcValues
import com.trustlens.android.data.Redact

/**
 * Honest fallback engine: transparent keyword heuristics used ONLY when
 * Firebase AI Logic is unreachable (no Nano, offline cloud). Always badged
 * "DEMO" in the UI — never passed off as AI. Mirrors web src/demo.js.
 */
object DemoEngine {
    private data class Signal(val label: String, val why: String, val weight: Int, val res: List<Regex>)

    private val scam = listOf(
        Signal("Urgency pressure", "Scams rush you so you cannot think or verify.", 14, listOf(Regex("urgent|immediately|last warning|within \\d+ hours?|today only|act now|expire|blocked today", RegexOption.IGNORE_CASE))),
        Signal("Threat of loss", "Threats (blocked account, arrest, parcel return) force panic compliance.", 16, listOf(Regex("block(ed)?|suspend|arrest|legal action|return(ed)?|deactivat", RegexOption.IGNORE_CASE))),
        Signal("Advance fee", "Real jobs and prizes never ask you to pay first.", 22, listOf(Regex("registration( fee)?|pay rs|processing fee|activate.*pay|advance|refundable deposit", RegexOption.IGNORE_CASE))),
        Signal("Collect request / UPI trick", "Approving a collect request SENDS money — refunds never need your approval.", 24, listOf(Regex("collect request|approve.*request|upi.*(pin|approve)|send.*re 1|rs 1", RegexOption.IGNORE_CASE))),
        Signal("Authority impersonation", "Scammers pose as banks, officers, or brands to borrow trust.", 12, listOf(Regex("\\b(bank|officer|kyc|customs?|indian? ?post|TRAI|RBI|CBI|customer care)\\b", RegexOption.IGNORE_CASE))),
        Signal("Suspicious link", "Lookalike domains and URL shorteners hide phishing pages.", 18, listOf(Regex("https?://\\S*|\\b\\w+\\.(xyz|top|click|link|tk|ml|gq)\\b|bit\\.ly|tinyurl", RegexOption.IGNORE_CASE))),
        Signal("Too good to be true", "Unrealistic income for trivial work is the classic job-scam hook.", 16, listOf(Regex("earn rs ?[\\d,]+/(day|week)|5000/day|work from home.*\\d|no investment.*profit|guaranteed.*return", RegexOption.IGNORE_CASE))),
        Signal("OTP / KYC lure", "Banks never ask for OTPs or KYC over calls, SMS, or links.", 20, listOf(Regex("\\botp\\b|kyc.*(expir|update|verif)|share.*(otp|pin|cvv)", RegexOption.IGNORE_CASE))),
        Signal("Reply pressure", "\"Reply YES now\" / \"limited slots\" short-circuits skepticism.", 10, listOf(Regex("reply (yes|now)|limited slots|only \\d+ left|first \\d+ (people|users)", RegexOption.IGNORE_CASE))),
    )

    private val fine = listOf(
        Signal("Auto-renewal trap", "Silent renewals with hard cancellation windows lock you in.", 22, listOf(Regex("automatically renew|auto.?renew|unless.*notice", RegexOption.IGNORE_CASE))),
        Signal("Harsh cancellation window", "90-day registered-post notice is designed to be missed.", 12, listOf(Regex("\\d{2,3} days?.*notice|registered post|cancellation.*\\d+ business days", RegexOption.IGNORE_CASE))),
        Signal("Excessive penalties", "Per-day fines and 40%+ penal interest compound brutally.", 20, listOf(Regex("rs ?\\d+ ?/ ?day|penal|compounded|late (fee|payment)|4\\d% p\\.?a", RegexOption.IGNORE_CASE))),
        Signal("One-sided deductions", "\"Assessed solely by\" means they decide what you lose.", 16, listOf(Regex("solely by|at (the )?(owner|company|lender)'s (discretion|cost)|less deductions", RegexOption.IGNORE_CASE))),
        Signal("Refund delays / no refunds", "180-day refunds and non-refundable terms trap your money.", 14, listOf(Regex("within \\d{2,3} days|non.?refundable|no refund|all payments are final", RegexOption.IGNORE_CASE))),
        Signal("Jurisdiction lock-in", "Distant exclusive arbitration makes disputes unaffordable.", 16, listOf(Regex("exclusively.*arbitration|sole jurisdiction|resolved.*only in", RegexOption.IGNORE_CASE))),
        Signal("Forced consent", "Auto-debit plus contact-list access is extreme for collections.", 16, listOf(Regex("auto.?debit|contact.?list|consent.*collection|access.*(contacts|sms)", RegexOption.IGNORE_CASE))),
        Signal("Foreclosure / exit fees", "Prepayment locks and foreclosure charges punish early exit.", 12, listOf(Regex("foreclosure|prepayment.*after|exit (fee|charge)|deleting the app does not cancel", RegexOption.IGNORE_CASE))),
        Signal("Unilateral changes", "They can raise prices or change terms without telling you.", 14, listOf(Regex("without notice|future price|constitutes acceptance|may (change|revise).*(terms|price)", RegexOption.IGNORE_CASE))),
        Signal("Zero-cost illusion", "\"0% interest\" hides upfront fees that exceed normal interest.", 14, listOf(Regex("0% interest|no cost|free.*trial|processing fee", RegexOption.IGNORE_CASE))),
    )

    fun triage(mode: String, text: String, rc: RcValues): TriageResult {
        val signals = if (mode == "fine") fine else scam
        val tactics = mutableListOf<Tactic>()
        var score = 0
        for (s in signals) {
            val hit = s.res.firstOrNull { it.containsMatchIn(text) }
            if (hit != null) {
                score += s.weight
                val m = hit.find(text)
                val quote = if (m != null) {
                    val start = maxOf(0, m.range.first - 30)
                    (if (start > 0) "…" else "") + text.substring(start, minOf(text.length, m.range.last + 31)).replace(Regex("\\s+"), " ").take(140)
                } else ""
                tactics += Tactic(s.label, s.why, quote)
            }
        }
        val risk = score.coerceIn(2, 97)
        val verdict = if (risk >= rc.riskHigh) "malicious" else if (risk >= rc.riskMedium) "suspicious" else "safe"
        val noun = if (mode == "fine") "clause" else "message"
        val summary = if (tactics.isEmpty()) "No classic red flags detected in this $noun — stay cautious anyway."
        else "Detected ${tactics.size} red flag${if (tactics.size > 1) "s" else ""}: ${tactics.joinToString(", ") { it.label.lowercase() }}."
        val scrub = Redact.prescrub(text)
        return TriageResult(verdict, risk, summary.take(240), tactics.take(6), scrub.text, scrub.count)
    }

    fun deepAnalysis(mode: String, s1: TriageResult): String {
        val flags = s1.tactics.mapIndexed { i, t ->
            "${i + 1}. **${t.label}** — ${t.why}" + (if (t.quote.isNotEmpty()) "\n   > \"${t.quote}\"" else "")
        }.joinToString("\n")
        return if (mode == "fine") {
            """## What this really means
Risk ${s1.riskScore}/100 (${s1.verdict}). ${s1.summary}

## Money and time traps
${flags.ifEmpty { "None detected — but read every number twice." }}

## Questions to ask before signing
1. Which of these terms are negotiable, in writing?
2. What is the total cost including all fees if I exit early?
3. What notice, in what form, stops renewal or billing?

## Safer alternatives to propose
- Shorter term or trial period with written exit terms.
- Penalties capped at actual loss, not per-day compounding.
- Disputes in your home jurisdiction.

Consult a professional for high-value agreements.

*(Demo-engine analysis — connect Firebase for full AI reasoning.)*"""
        } else {
            """## Verdict in plain words
Risk ${s1.riskScore}/100 (${s1.verdict}). ${s1.summary}

## Tricks being used
${flags.ifEmpty { "None detected — verify independently anyway." }}

## How to verify safely
1. Never use links or numbers from the message itself.
2. Open the official app/site directly or call the number on your card.
3. Ask a trusted person to read it before you act.

## What to do next
- Do: report and block the sender; screenshot for evidence.
- Never: share OTPs, approve collect requests, or pay to "unlock" money.

*(Demo-engine analysis — connect Firebase for full AI reasoning.)*"""
        }
    }
}
