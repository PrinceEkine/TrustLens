package com.trustlens.android

import android.app.Application
import android.graphics.Bitmap
import android.net.ConnectivityManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.Firebase
import com.google.firebase.auth.auth
import com.trustlens.android.ai.DemoEngine
import com.trustlens.android.ai.HybridAi
import com.trustlens.android.ai.TriageResult
import com.trustlens.android.data.HistoryItem
import com.trustlens.android.data.HistoryRepo
import com.trustlens.android.data.LinkXray
import com.trustlens.android.data.RcValues
import com.trustlens.android.data.Redact
import com.trustlens.android.data.Remote
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class UiState(
    val mode: String = "scam",
    val input: String = "",
    val bitmap: Bitmap? = null,
    val cloudOn: Boolean = true,
    val busy: Boolean = false,
    val warmup: String? = null,
    val rc: RcValues = RcValues(),
    val uid: String? = null,
    val online: Boolean = true,
    val s1Badge: String = "idle",
    val s1Latency: String = "—",
    val s1: TriageResult? = null,
    val s2Badge: String = "idle",
    val s2Latency: String = "—",
    val deep: String = "",
    val engineNote: String = "",
    val lastInput: String = "",
    val linkReports: List<LinkXray.Report> = emptyList(),
    val redactMode: Int = 0, // 0 redacted | 1 original | 2 side-by-side
    val demoRunning: Boolean = false,
    val demoIndex: Int = 0,
    val demoTitle: String = "",
    val demoCaption: String = "",
    val demoElapsed: Int = 0,
    val toast: String? = null,
    val historyOpen: Boolean = false,
    val history: List<HistoryItem> = emptyList(),
    val historyLocal: Boolean = true,
    val historyNote: String = "",
)

val SAMPLES = mapOf(
    "scam" to listOf(
        "UPI “refund” scam" to "Dear Customer, your account will be BLOCKED today due to KYC expiry. To unblock, open your UPI app and approve the collect request of Rs 1 sent from refunds@okhdfcbank. Or call our officer Rahul Sharma on +91 98220 44513 immediately. Do NOT ignore — last warning!",
        "Part-time job fraud" to "Hi! I'm Priya from Global E-Trade. You are selected for a part-time job: earn Rs 5000/day just by liking videos. First pay Rs 499 registration to hr.verify@paytm to activate your account. Limited slots — reply YES now to start today!",
        "Delivery phishing link" to "IndiaPost: Your parcel is held at the depot. Pay Rs 49 redelivery fee within 24 hours or it will be returned: http://indiap0st-track.xyz/pay?id=88412&user=amit_91. Track: 88412.",
    ),
    "fine" to listOf(
        "Rental auto-renewal trap" to "Clause 9.2: This agreement shall automatically renew for a further term of 11 months unless the Tenant serves written notice of termination by registered post at least 90 days prior to expiry. The security deposit of Rs 60,000 shall be refunded within 180 days of handover, less deductions assessed solely by the Owner. Any dispute shall be resolved exclusively by arbitration in Mumbai at the Tenant's cost.",
        "“0% interest” loan offer" to "Get an instant personal loan of Rs 2,00,000 at 0% interest! Processing fee: 8% deducted upfront. Late payment: Rs 500/day + 42% p.a. penal interest, compounded monthly. By accepting, you authorize auto-debit from all linked accounts and consent to contact-list access for collections. Prepayment allowed after 12 EMIs with 6% foreclosure charge.",
        "App subscription terms" to "Free 3-day trial, then Rs 999/week billed automatically until cancelled. Cancellation requests are processed within 10 business days and do not stop the current billing cycle. Deleting the app does not cancel your subscription. All payments are final and non-refundable. Continued use constitutes acceptance of future price changes without notice.",
    ),
)

/** Guided 3-minute demo script. Step budgets sum to exactly 180 seconds. Mirrors web src/demotour.js. */
const val DEMO_BUDGET_S = 180

data class DemoStep(val id: String, val seconds: Int, val title: String, val caption: String)

val DEMO_STEPS = listOf(
    DemoStep("upi", 15, "The hook: a UPI refund scam", "0:00 — Scam Shield. A blocked-account threat with a collect request and a callback number. Raw text stays on-device."),
    DemoStep("analyze1", 40, "On-device triage, then cloud depth", "Watch Stage 1: Nano verdict + PII scrub — then the cloud deep-analysis streams on redacted text only."),
    DemoStep("diff", 20, "Proof of privacy: the diff", "Side by side: what stayed on your phone vs the only text the cloud ever saw."),
    DemoStep("privacy", 30, "Maximum-privacy mode", "Cloud OFF, re-run: a pure on-device result. Nothing leaves the phone — the honest SKIPPED badge says so."),
    DemoStep("fine", 40, "Second lens: Fine-Print X-ray", "Cloud back on. Same engine, new lens: the rental auto-renewal trap, X-rayed clause by clause."),
    DemoStep("history", 15, "History syncs across platforms", "Redacted excerpts in Firestore — the same record appears on web. One project, two apps."),
    DemoStep("rc", 10, "Remote Config runs the dials", "Thresholds, model, disclaimer — all live from Remote Config. No redeploy to retune."),
    DemoStep("close", 10, "Private by construction", "TrustLens: ON_DEVICE triage plus IN_CLOUD depth. Thanks for watching — now try your own message."),
)

/** Orchestrates the two-stage hybrid pipeline. Mirrors web src/main.js exactly. */
class TrustLensViewModel(app: Application) : AndroidViewModel(app) {
    private val _s = MutableStateFlow(UiState())
    val s: StateFlow<UiState> = _s.asStateFlow()

    init {
        viewModelScope.launch {
            val rc = Remote.fetch()
            _s.update { it.copy(rc = rc, cloudOn = it.cloudOn && rc.cloudStageEnabled) }
            _s.update { it.copy(online = isOnline()) }
            try {
                if (Firebase.auth.currentUser == null) Firebase.auth.signInAnonymously().await()
                _s.update { it.copy(uid = Firebase.auth.currentUser?.uid) }
            } catch (_: Exception) {
                toast("Signed-out mode: history stays on this device.")
            }
        }
    }

    fun setMode(m: String) = _s.update { it.copy(mode = m, s1 = null, deep = "", engineNote = "") }
    fun setInput(t: String) = _s.update { it.copy(input = t) }
    fun setBitmap(b: Bitmap?) = _s.update { it.copy(bitmap = b) }
    fun setCloudOn(b: Boolean) = _s.update { it.copy(cloudOn = b) }
    fun cycleRedact() = _s.update { it.copy(redactMode = (it.redactMode + 1) % 3) }
    fun setRedactMode(m: Int) = _s.update { it.copy(redactMode = m) }
    fun toast(msg: String?) = _s.update { it.copy(toast = msg) }

    private fun isOnline(): Boolean {
        val cm = getApplication<Application>().getSystemService(ConnectivityManager::class.java)
        return cm?.activeNetwork != null
    }

    fun analyze() {
        val st = _s.value
        if (st.busy) return
        if (st.input.isBlank() && st.bitmap == null) { toast("Paste some text or attach a screenshot first."); return; }
        viewModelScope.launch { runPipeline(st) }
    }

    /** The full two-stage pipeline as one awaitable unit (also drives the demo tour). */
    private suspend fun runPipeline(st: UiState) {
            val rc = _s.value.rc
            val (text, _) = Redact.truncate(st.input.trim(), rc.maxInputChars)
            val online = isOnline()
            _s.update { it.copy(busy = true, online = online, s1 = null, deep = "", engineNote = "", lastInput = text, linkReports = LinkXray.xray(text), redactMode = 0, s1Badge = "running", s2Badge = "…") }
            try {
                // ---- Stage 1 ----
                var s1: TriageResult
                var s1Badge: String
                var engine1: String
                try {
                    _s.update { it.copy(warmup = "Waking Gemini Nano on-device…") }
                    HybridAi.warmUp(rc.cloudModel, rc.stage2MaxTokens)
                    val run = HybridAi.triageOnDevice(st.mode, text, st.bitmap, rc.cloudModel, rc.stage2MaxTokens)
                    s1 = run.result
                    s1Badge = "ON_DEVICE"
                    _s.update { it.copy(s1Latency = fmtMs(run.ms)) }
                    engine1 = "Gemini Nano on-device (${fmtMs(run.ms)})"
                } catch (e1: CancellationException) {
                    throw e1
                } catch (e1: Exception) {
                    val fe = HybridAi.friendlyError(e1)
                    if (_s.value.cloudOn && rc.cloudStageEnabled && online) {
                        try {
                            val run = HybridAi.triageCloud(st.mode, text, st.bitmap, rc.cloudModel, rc.stage2MaxTokens)
                            s1 = run.result
                            s1Badge = "IN_CLOUD"
                            _s.update { it.copy(s1Latency = fmtMs(run.ms)) }
                            engine1 = "cloud triage fallback (${fmtMs(run.ms)}) — ${fe.first}"
                        } catch (e2: CancellationException) {
                            throw e2
                        } catch (e2: Exception) {
                            s1 = DemoEngine.triage(st.mode, text, rc)
                            s1Badge = "DEMO"
                            _s.update { it.copy(s1Latency = "<5 ms") }
                            engine1 = "demo engine — ${HybridAi.friendlyError(e2).first}"
                            toast("${fe.first}. ${fe.second}")
                        }
                    } else {
                        s1 = DemoEngine.triage(st.mode, text, rc)
                        s1Badge = "DEMO"
                        _s.update { it.copy(s1Latency = "<5 ms") }
                        engine1 = "demo engine — ${fe.first}"
                        toast("${fe.first}. ${fe.second}")
                    }
                } finally {
                    _s.update { it.copy(warmup = null) }
                }
                _s.update { it.copy(s1 = s1, s1Badge = s1Badge) }

                // ---- Stage 2 ----
                val wantCloud = _s.value.cloudOn && rc.cloudStageEnabled
                var deep: String
                var engine2: String
                if (wantCloud && online) {
                    try {
                        val sb = StringBuilder()
                        val t0 = System.currentTimeMillis()
                        HybridAi.deepStream(st.mode, s1.redactedText, s1, rc.cloudModel, rc.stage2MaxTokens)
                            .collect { piece ->
                                sb.append(piece)
                                _s.update { it.copy(deep = sb.toString()) }
                            }
                        deep = sb.toString()
                        _s.update { it.copy(s2Badge = "IN_CLOUD", s2Latency = fmtMs(System.currentTimeMillis() - t0)) }
                        engine2 = "${rc.cloudModel} (${_s.value.s2Latency})"
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        val fe = HybridAi.friendlyError(e)
                        deep = DemoEngine.deepAnalysis(st.mode, s1)
                        _s.update { it.copy(s2Badge = "DEMO", deep = deep) }
                        engine2 = "demo engine — ${fe.first}"
                    }
                } else if (s1Badge == "DEMO") {
                    deep = DemoEngine.deepAnalysis(st.mode, s1)
                    _s.update { it.copy(s2Badge = "DEMO", deep = deep) }
                    engine2 = "demo engine"
                } else {
                    _s.update { it.copy(s2Badge = "SKIPPED") }
                    deep = "## Maximum-privacy mode\nCloud deep-analysis is off, so nothing left your device. The on-device verdict, risk score, and flags above are your full result.\n\nToggle Cloud deep-analysis on to get the deep breakdown — it still only receives redacted text."
                    _s.update { it.copy(deep = deep) }
                    engine2 = "skipped (privacy mode)"
                }
                _s.update { it.copy(engineNote = "Stage 1: $engine1 · Stage 2: $engine2") }

                // ---- Persist (redacted only) ----
                val synced = HistoryRepo.save(
                    _s.value.uid, rc.historyEnabled,
                    HistoryItem(
                        mode = st.mode, verdict = s1.verdict, riskScore = s1.riskScore,
                        summary = s1.summary,
                        tactics = s1.tactics.map { mapOf("label" to it.label, "why" to it.why, "quote" to it.quote) },
                        redactedText = s1.redactedText, deep = _s.value.deep,
                        engines = "$engine1 / $engine2",
                    )
                )
                _s.update {
                    it.copy(engineNote = it.engineNote + if (synced) " · saved to Firestore ✓" else " · kept on this device")
                }
            } catch (e: CancellationException) {
                throw e // demo stop must interrupt; never swallow
            } catch (e: Exception) {
                toast("Analysis failed: ${e.message}")
            } finally {
                _s.update { it.copy(busy = false, warmup = null) }
            }
    }

    // ---------- Guided 3-minute demo tour (same beats as web + judging video) ----------
    private var demoJob: Job? = null
    private var demoToken = 0

    fun startDemo() {
        if (_s.value.demoRunning) { stopDemo(); return }
        if (_s.value.busy) { toast("Wait for the current analysis to finish, then start the tour."); return }
        demoJob?.cancel()
        _s.update { it.copy(demoRunning = true, demoIndex = 0, demoElapsed = 0, historyOpen = false) }
        demoJob = viewModelScope.launch {
            val t0 = System.currentTimeMillis()
            val ticker = launch {
                while (true) {
                    delay(1000)
                    _s.update { it.copy(demoElapsed = ((System.currentTimeMillis() - t0) / 1000).toInt()) }
                }
            }
            try {
                val token = ++demoToken
                while (_s.value.demoRunning && token == demoToken) {
                    val i = _s.value.demoIndex.coerceIn(0, DEMO_STEPS.size - 1)
                    val step = DEMO_STEPS[i]
                    _s.update { it.copy(demoIndex = i, demoTitle = step.title, demoCaption = step.caption) }
                    val a0 = System.currentTimeMillis()
                    try {
                        demoAction(step.id)
                    } catch (e: CancellationException) { throw e } catch (_: Exception) { }
                    if (token != demoToken || !_s.value.demoRunning) break
                    if (_s.value.demoIndex != i) continue // user jumped steps
                    val deadline = System.currentTimeMillis() + maxOf(3000L, step.seconds * 1000L - (System.currentTimeMillis() - a0))
                    while (System.currentTimeMillis() < deadline) {
                        if (token != demoToken || !_s.value.demoRunning || _s.value.demoIndex != i) break
                        delay(250)
                    }
                    if (token != demoToken || !_s.value.demoRunning) break
                    if (_s.value.demoIndex != i) continue
                    if (i >= DEMO_STEPS.size - 1) break
                    _s.update { it.copy(demoIndex = i + 1) }
                }
                if (_s.value.demoRunning && _s.value.demoIndex >= DEMO_STEPS.size - 1) {
                    toast("Demo complete — now try your own message.")
                }
            } finally {
                ticker.cancel()
                _s.update { it.copy(demoRunning = false) }
            }
        }
    }

    fun stopDemo() {
        demoToken++
        demoJob?.cancel()
        demoJob = null
        _s.update { it.copy(demoRunning = false) }
    }

    fun demoNext() = _s.update { it.copy(demoIndex = (it.demoIndex + 1).coerceIn(0, DEMO_STEPS.size - 1)) }
    fun demoPrev() = _s.update { it.copy(demoIndex = (it.demoIndex - 1).coerceIn(0, DEMO_STEPS.size - 1)) }

    private suspend fun demoAnalyze() {
        var waited = 0
        while (_s.value.busy && waited < 60_000) { delay(500); waited += 500 }
        if (!_s.value.busy) runPipeline(_s.value)
    }

    private suspend fun demoAction(id: String) {
        when (id) {
            "upi" -> { setMode("scam"); setInput(SAMPLES["scam"]!!.first().second) }
            "analyze1" -> demoAnalyze()
            "diff" -> if (_s.value.s1 != null) setRedactMode(2)
            "privacy" -> { setCloudOn(false); demoAnalyze() }
            "fine" -> {
                if (_s.value.rc.cloudStageEnabled) setCloudOn(true)
                setMode("scam") // reset first so the lens switch is visible
                setMode("fine"); setInput(SAMPLES["fine"]!!.first().second); demoAnalyze()
            }
            "history" -> openHistory()
            "rc" -> closeHistory()
            "close" -> { }
        }
    }

    fun openHistory() {
        viewModelScope.launch {
            val (items, local) = HistoryRepo.list(_s.value.uid, _s.value.rc.historyEnabled)
            _s.update {
                it.copy(
                    historyOpen = true, history = items, historyLocal = local,
                    historyNote = if (local) "Local session history (sign-in + Firestore for synced history). Redacted only."
                    else "Synced from your private Firestore history — shared with the web app. Redacted only."
                )
            }
        }
    }

    fun closeHistory() = _s.update { it.copy(historyOpen = false) }

    fun deleteHistory(item: HistoryItem) {
        viewModelScope.launch {
            HistoryRepo.delete(item)
            openHistory()
        }
    }

    fun restoreHistory(item: HistoryItem) {
        _s.update {
            it.copy(
                historyOpen = false, mode = item.mode,
                s1 = TriageResult(item.verdict, item.riskScore, item.summary,
                    item.tactics.map { t -> com.trustlens.android.ai.Tactic(t["label"].orEmpty(), t["why"].orEmpty(), t["quote"].orEmpty()) },
                    item.redactedText, 0),
                deep = item.deep, s1Badge = "history", s2Badge = "history",
                lastInput = "", linkReports = LinkXray.xray(item.redactedText), redactMode = 0,
                engineNote = "Restored from history · originally: ${item.engines.ifEmpty { "unknown engines" }}",
            )
        }
    }

    private fun fmtMs(ms: Long) = if (ms < 1500) "$ms ms" else "${"%.1f".format(ms / 1000.0)} s"
}
