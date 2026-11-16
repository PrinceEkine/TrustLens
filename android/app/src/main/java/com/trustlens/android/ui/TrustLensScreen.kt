package com.trustlens.android.ui

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.trustlens.android.DEMO_BUDGET_S
import com.trustlens.android.DEMO_STEPS
import com.trustlens.android.SAMPLES
import com.trustlens.android.TrustLensViewModel
import com.trustlens.android.ai.TriageResult
import com.trustlens.android.data.LinkXray
import com.trustlens.android.data.Redact

private val Muted = Color(0xFF93A1BD)
private val Warn = Color(0xFFFBBF24)
private val Bad = Color(0xFFF87171)
private val Good = Color(0xFF34D399)
private val Info = Color(0xFF60A5FA)

@Composable
fun TrustLensScreen(vm: TrustLensViewModel = viewModel()) {
    val s by vm.s.collectAsState()
    val ctx = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        vm.setBitmap(uri?.let { uriToBitmap(ctx, it) })
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Header + status
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("🛡️ TrustLens", fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            TextButton(onClick = { vm.startDemo() }) { Text(if (s.demoRunning) "■ Stop" else "▶ 3-min demo", fontSize = 12.sp) }
            TextButton(onClick = { vm.openHistory() }) { Text("History") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill(if (s.online) "Net: online" else "Net: OFFLINE", if (s.online) Good else Bad)
            Pill(if (s.cloudOn) "Cloud: ${s.rc.cloudModel}" else "Cloud: off", if (s.cloudOn) Info else Muted)
            Pill(if (s.uid != null) "User: guest" else "User: out", if (s.uid != null) Good else Warn)
        }
        if (s.demoRunning) DemoBar(s, vm)

        // Tabs
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TabButton("🛡️ Scam Shield", s.mode == "scam") { vm.setMode("scam") }
            TabButton("🔍 Fine-Print X-ray", s.mode == "fine") { vm.setMode("fine") }
        }
        Text(
            if (s.mode == "scam") "Suspicious SMS, email, job offer, or forward? Instant private verdict, then a deep breakdown."
            else "Rental clause, loan offer, or subscription terms? Traps flagged privately, then a plain-language X-ray.",
            color = Muted, fontSize = 13.sp
        )

        // Samples
        Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SAMPLES[s.mode].orEmpty().forEach { (title, body) ->
                TextButton(onClick = { vm.setInput(body) }) { Text(title, fontSize = 12.sp) }
            }
        }

        // Input
        OutlinedTextField(
            value = s.input, onValueChange = { vm.setInput(it) },
            label = { Text("Paste the message, email, or clause") },
            modifier = Modifier.fillMaxWidth().height(140.dp),
        )
        Text("${s.input.length} chars", color = Muted, fontSize = 12.sp)

        if (s.rc.imageInputEnabled) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { picker.launch("image/*") }) { Text("+ Screenshot / photo") }
                if (s.bitmap != null) {
                    androidx.compose.foundation.Image(
                        bitmap = s.bitmap!!.asImageBitmap(), contentDescription = "Attached evidence",
                        modifier = Modifier.size(64.dp).clip(RoundedCornerShape(8.dp))
                    )
                    TextButton(onClick = { vm.setBitmap(null) }) { Text("Remove") }
                } else Text("PNG/JPEG · read on-device first", color = Muted, fontSize = 12.sp)
            }
        }

        // Privacy toggle
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Switch(checked = s.cloudOn, onCheckedChange = { vm.setCloudOn(it) }, enabled = s.rc.cloudStageEnabled)
            Text("Cloud deep-analysis (redacted text only)", fontSize = 13.sp)
        }

        Button(onClick = { vm.analyze() }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
            Text(if (s.busy) "Analyzing…" else "Analyze privately →")
        }
        s.warmup?.let {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Text(it, color = Muted, fontSize = 12.sp)
        }

        // Stage 1
        StageCard(num = "1", title = "On-device triage", badge = s.s1Badge, latency = s.s1Latency) {
            val s1 = s.s1
            if (s1 == null) Text("Waiting for input. Raw text never leaves this phone in this stage.", color = Muted, fontSize = 13.sp)
            else {
                VerdictLine(s1)
                Text(s1.summary, fontSize = 13.sp)
                Text("🔒 ${s1.piiCount} PII spans scrubbed on-device before anything left this phone.", color = Muted, fontSize = 12.sp)
            }
        }
        Text("⬇ redacted text only ⬇", color = Good, fontSize = 12.sp, modifier = Modifier.align(Alignment.CenterHorizontally))

        // Stage 2
        StageCard(num = "2", title = "Cloud deep-analysis", badge = s.s2Badge, latency = s.s2Latency) {
            Text(
                when (s.s2Badge) {
                    "IN_CLOUD" -> "✅ ${s.rc.cloudModel} · redacted input · 0 raw PII."
                    "DEMO" -> "Demo engine (see verdict above why). Input-derived heuristic analysis."
                    "SKIPPED" -> "🔒 Skipped — maximum-privacy mode. Nothing left your device."
                    else -> "Runs on redacted text only — names, numbers and IDs stay on your device."
                }, color = Muted, fontSize = 13.sp
            )
        }

        // Results
        s.s1?.let { s1 -> Results(s, s1, vm) }
        if (s.engineNote.isNotEmpty()) Text(s.engineNote, color = Muted, fontSize = 12.sp)
        Text(s.rc.disclaimer, color = Muted, fontSize = 11.sp)

        s.toast?.let {
            Text(it, color = Warn, fontSize = 12.sp)
            vm.toast(null)
        }
    }

    if (s.historyOpen) HistorySheet(vm)
}

@Composable
private fun Pill(text: String, color: Color) {
    Text(text, color = color, fontSize = 11.sp, modifier = Modifier.background(Color(0xFF0E1628), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp))
}

@Composable
private fun TabButton(text: String, active: Boolean, onClick: () -> Unit) {
    val bg = if (active) Color(0xFF13253D) else Color(0xFF0E1628)
    val fg = if (active) Color.White else Muted
    Box(modifier = Modifier.background(bg, RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp)) {
        Text(text, color = fg, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}

@Composable
private fun StageCard(num: String, title: String, badge: String, latency: String, body: @Composable () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111A2E))) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(num, color = Info, fontWeight = FontWeight.Bold)
                Text(title, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Badge(badge)
            }
            Text("latency $latency", color = Muted, fontSize = 11.sp)
            body()
        }
    }
}

@Composable
private fun Badge(text: String) {
    val (bg, fg) = when (text) {
        "ON_DEVICE" -> Good to Color(0xFF06281C)
        "IN_CLOUD" -> Info to Color(0xFF081C33)
        "DEMO" -> Warn to Color(0xFF3A2A05)
        "running" -> Warn to Color(0xFF3A2A05)
        else -> Color(0xFF22304D) to Muted
    }
    Text(text, color = fg, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp))
}

@Composable
private fun VerdictLine(s1: TriageResult) {
    val (icon, label, color) = when (s1.verdict) {
        "safe" -> Triple("✅", "Looks safe", Good)
        "malicious" -> Triple("🚨", "Likely malicious", Bad)
        else -> Triple("⚠️", "Suspicious", Warn)
    }
    Text("$icon $label — ${s1.riskScore}/100 risk", color = color, fontWeight = FontWeight.Bold)
}

@Composable
private fun Results(s: com.trustlens.android.UiState, s1: TriageResult, vm: TrustLensViewModel) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF111A2E))) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            VerdictLine(s1)
            LinearProgressIndicator(progress = { s1.riskScore / 100f }, modifier = Modifier.fillMaxWidth())
            Text("thresholds ${s.rc.riskMedium}/${s.rc.riskHigh} (Remote Config)", color = Muted, fontSize = 11.sp)
            Text("WHY IT LOOKS THIS WAY", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            if (s1.tactics.isEmpty()) Text("No specific manipulation patterns flagged.", color = Muted, fontSize = 13.sp)
            s1.tactics.forEach { t ->
                Text("• ${t.label}", color = Warn, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                if (t.why.isNotEmpty()) Text(t.why, fontSize = 13.sp)
                if (t.quote.isNotEmpty()) Text("“${t.quote}”", color = Muted, fontSize = 12.sp)
            }
            if (s.linkReports.isNotEmpty()) {
                Text("LINK X-RAY · ON-DEVICE CHECKS", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                LinkXrayCard(s.linkReports)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("WHAT THE CLOUD SAW", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                TextButton(onClick = { vm.cycleRedact() }) { Text(redactLabel(s.redactMode), fontSize = 12.sp) }
            }
            if (s.redactMode != 1) {
                Text("CLOUD SAW — REDACTED", color = Good, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                HighlightedRedacted(s1.redactedText)
            }
            if (s.redactMode != 0) {
                Text("STAYED ON DEVICE — YOUR ORIGINAL", color = Warn, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                if (s.lastInput.isEmpty()) Text("Original not stored — redacted record only.", color = Muted, fontSize = 12.sp)
                else HighlightedOriginal(s.lastInput)
            }
            Text("DEEP ANALYSIS", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            if (s.deep.isEmpty() && s.busy) CircularProgressIndicator(modifier = Modifier.size(24.dp))
            else Text(s.deep.ifEmpty { "…" }, fontSize = 13.sp)
        }
    }
}

@Composable
private fun HistorySheet(vm: TrustLensViewModel) {
    val s by vm.s.collectAsState()
    Card(modifier = Modifier.fillMaxSize().padding(24.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF111A2E))) {
        Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("History", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { vm.closeHistory() }) { Text("Close") }
            }
            Text(s.historyNote, color = Muted, fontSize = 12.sp)
            if (s.history.isEmpty()) Text("Nothing yet.", color = Muted)
            s.history.forEach { h ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1628)),
                    modifier = Modifier.fillMaxWidth().clickable { vm.restoreHistory(h) }) {
                    Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${if (h.mode == "fine") "Fine-print" else "Scam shield"} · ${h.riskScore}/100", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text(h.summary, fontSize = 12.sp, maxLines = 2)
                            Text("${h.when_}${if (h.local) " · this device" else ""}", color = Muted, fontSize = 11.sp)
                        }
                        TextButton(onClick = { vm.deleteHistory(h) }) { Text("✕") }
                    }
                }
            }
            Spacer(Modifier.width(1.dp))
        }
    }
}

@Composable
private fun DemoBar(s: com.trustlens.android.UiState, vm: TrustLensViewModel) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0B1322))) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Step ${s.demoIndex + 1}/${DEMO_STEPS.size}", color = Color(0xFF06281C), fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(Good, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp))
                Text("${fmtClock(s.demoElapsed)} / ${fmtClock(DEMO_BUDGET_S)}",
                    color = if (s.demoElapsed > DEMO_BUDGET_S) Warn else Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f))
            }
            Text(s.demoTitle, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Good)
            Text(s.demoCaption, fontSize = 13.sp)
            LinearProgressIndicator(progress = { (s.demoElapsed / DEMO_BUDGET_S.toFloat()).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { vm.demoPrev() }) { Text("← Prev") }
                TextButton(onClick = { vm.demoNext() }) { Text("Next →") }
                TextButton(onClick = { vm.stopDemo() }) { Text("Stop") }
            }
        }
    }
}

@Composable
private fun LinkXrayCard(reports: List<LinkXray.Report>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        reports.forEach { r ->
            val tone = if (r.worst == "bad") Bad else if (r.worst == "warn") Warn else Good
            Column(Modifier.background(Color(0xFF0E1628), RoundedCornerShape(8.dp)).padding(10.dp).fillMaxWidth()) {
                Text("${if (r.worst == "ok") "✅" else "⚠️"} ${r.host.ifEmpty { r.url }} · ${r.risk}/100 link risk",
                    fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = tone)
                Text(r.url, color = Muted, fontSize = 11.sp)
                r.findings.forEach { f ->
                    val c = if (f.level == "bad") Bad else if (f.level == "warn") Warn else Good
                    Text("• ${f.label}", color = c, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    Text(f.detail, fontSize = 12.sp, color = Muted)
                }
            }
        }
        Text("🔒 Deterministic checks, computed on-device — not an AI verdict.", color = Muted, fontSize = 11.sp)
    }
}

private fun redactLabel(mode: Int) = when (mode) {
    1 -> "show side-by-side"
    2 -> "show redacted"
    else -> "show my original"
}

@Composable
private fun HighlightedRedacted(text: String) {
    val ann = buildAnnotatedString {
        append(text)
        for (r in Redact.maskSpans(text)) {
            addStyle(SpanStyle(background = Color(0xFF0E3B2C), color = Color(0xFF7DF0C4)), r.first, r.last + 1)
        }
    }
    Text(ann, fontSize = 12.sp, color = Color(0xFFC9D5EF),
        modifier = Modifier.background(Color(0xFF070D1A), RoundedCornerShape(8.dp)).padding(10.dp).fillMaxWidth())
}

@Composable
private fun HighlightedOriginal(text: String) {
    val ann = buildAnnotatedString {
        append(text)
        for (sp in Redact.prescrubSpans(text)) {
            if (sp.start >= 0 && sp.end <= text.length && sp.end > sp.start) {
                addStyle(SpanStyle(background = Color(0xFF3A2A05), color = Color(0xFFFCD34D)), sp.start, sp.end)
            }
        }
    }
    Text(ann, fontSize = 12.sp, color = Color(0xFFC9D5EF),
        modifier = Modifier.background(Color(0xFF070D1A), RoundedCornerShape(8.dp)).padding(10.dp).fillMaxWidth())
}

private fun fmtClock(totalS: Int) = "${totalS / 60}:${(totalS % 60).toString().padStart(2, '0')}"

private fun uriToBitmap(ctx: android.content.Context, uri: Uri): Bitmap? = try {
    if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, uri))
    } else {
        @Suppress("DEPRECATION")
        MediaStore.Images.Media.getBitmap(ctx.contentResolver, uri)
    }
} catch (_: Exception) { null }
