package com.trustlens.android.data

import com.google.firebase.Firebase
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.firestore
import kotlinx.coroutines.tasks.await

/**
 * Analysis history in the SHARED 'analyses' collection (same as web — history
 * syncs across platforms). Redacted excerpts only, per-user rules.
 */
data class HistoryItem(
    val id: String = "",
    val local: Boolean = true,
    val mode: String = "scam",
    val verdict: String = "suspicious",
    val riskScore: Int = 0,
    val summary: String = "",
    val tactics: List<Map<String, String>> = emptyList(),
    val redactedText: String = "",
    val deep: String = "",
    val engines: String = "",
    val when_: String = "",
)

object HistoryRepo {
    private const val CAP = 20
    private val memory = mutableListOf<HistoryItem>()

    suspend fun save(uid: String?, historyEnabled: Boolean, item: HistoryItem): Boolean {
        if (uid == null || !historyEnabled) {
            memory.add(0, item.copy(id = "m${System.currentTimeMillis()}", local = true))
            if (memory.size > CAP) memory.removeLast()
            return false
        }
        return try {
            Firebase.firestore.collection("analyses").add(
                mapOf(
                    "uid" to uid,
                    "mode" to item.mode,
                    "verdict" to item.verdict,
                    "riskScore" to item.riskScore,
                    "summary" to item.summary,
                    "tactics" to item.tactics,
                    "redactedText" to item.redactedText,
                    "redactedExcerpt" to item.redactedText.take(160),
                    "deep" to item.deep,
                    "engines" to item.engines,
                    "createdAt" to FieldValue.serverTimestamp(),
                )
            ).await()
            true
        } catch (_: Exception) {
            memory.add(0, item.copy(id = "m${System.currentTimeMillis()}", local = true))
            false
        }
    }

    suspend fun list(uid: String?, historyEnabled: Boolean): Pair<List<HistoryItem>, Boolean> {
        if (uid == null || !historyEnabled) return memory.toList() to true
        return try {
            val snap = Firebase.firestore.collection("analyses")
                .whereEqualTo("uid", uid)
                .orderBy("createdAt", Query.Direction.DESCENDING)
                .limit(CAP.toLong())
                .get().await()
            val items = snap.documents.map { d ->
                HistoryItem(
                    id = d.id, local = false,
                    mode = d.getString("mode") ?: "scam",
                    verdict = d.getString("verdict") ?: "suspicious",
                    riskScore = d.getLong("riskScore")?.toInt() ?: 0,
                    summary = d.getString("summary").orEmpty(),
                    tactics = (d.get("tactics") as? List<*>)?.mapNotNull { t ->
                        @Suppress("UNCHECKED_CAST")
                        (t as? Map<String, String>)
                    }.orEmpty(),
                    redactedText = d.getString("redactedText") ?: d.getString("redactedExcerpt").orEmpty(),
                    deep = d.getString("deep").orEmpty(),
                    engines = d.getString("engines").orEmpty(),
                    when_ = d.getTimestamp("createdAt")?.toDate()?.toString().orEmpty(),
                )
            }
            items to false
        } catch (_: Exception) {
            memory.toList() to true
        }
    }

    suspend fun delete(item: HistoryItem) {
        memory.removeAll { it.id == item.id }
        if (!item.local) {
            try {
                Firebase.firestore.collection("analyses").document(item.id).delete().await()
            } catch (_: Exception) { }
        }
    }
}
