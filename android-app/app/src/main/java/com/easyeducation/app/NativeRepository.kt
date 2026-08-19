package com.easyeducation.app

import android.content.Context
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest

class NativeRepository(context: Context) {
    private val cache = NativeCacheDb(context.applicationContext)
    private val leaseStore = OfflineLeaseStore(context.applicationContext)
    private val firestore = FirebaseFirestore.getInstance()

    suspend fun cachedProfile(uid: String): NativeUserProfile = withContext(Dispatchers.IO) {
        NativeUserProfile.from(uid, cache.getDoc("users", uid))
    }

    suspend fun refreshProfile(
        uid: String,
        fallbackName: String = "",
        fallbackEmail: String = "",
        fallbackPhotoUrl: String = "",
    ): NativeUserProfile {
        val ref = firestore.collection("users").document(uid)
        var snapshot = ref.get(Source.SERVER).await()
        if (!snapshot.exists()) {
            ref.set(
                mapOf(
                    "name" to fallbackName,
                    "email" to fallbackEmail,
                    "photoURL" to fallbackPhotoUrl,
                    "role" to "user",
                    "banned" to false,
                    "permanentBan" to false,
                    "banCount" to 0,
                    "createdAt" to FieldValue.serverTimestamp(),
                ),
            ).await()
            snapshot = ref.get(Source.SERVER).await()
        }
        val json = snapshot.toCacheJson()
        withContext(Dispatchers.IO) { cache.putDoc("users", uid, json) }
        return NativeUserProfile.from(uid, json)
    }

    suspend fun cachedCourses(uid: String): List<NativeCourse> = withContext(Dispatchers.IO) {
        cachedCourseIds(uid).mapNotNull { id -> cache.getDoc("courses", id)?.let(NativeCourse::from) }
            .sortedBy { it.title.lowercase() }
    }

    suspend fun ensureEnrollments(uid: String): List<NativeCourse> {
        val primed = withContext(Dispatchers.IO) {
            cache.getString(enrollmentPrimeKey(uid)) == "1"
        }
        return if (primed) cachedCourses(uid) else refreshEnrollments(uid)
    }

    suspend fun refreshEnrollments(uid: String): List<NativeCourse> {
        val canonicalSnapshot = firestore.collection("userCourses")
            .whereEqualTo("userId", uid)
            .get(Source.SERVER)
            .await()
        val enrollmentJson = canonicalSnapshot.documents.map(DocumentSnapshot::toCacheJson).toMutableList()
        val canonicalCourseIds = enrollmentJson.map { it.optString("courseId") }.filter { it.isNotBlank() }.toMutableSet()

        // Compatibility for old approved payments that pre-date deterministic userCourses docs.
        val approvedPayments = firestore.collection("payments")
            .whereEqualTo("userId", uid)
            .whereEqualTo("status", "approved")
            .get(Source.SERVER)
            .await()
        val legacyCourseIds = approvedPayments.documents.flatMap(::paymentCourseIds).distinct()
        legacyCourseIds.filter { it !in canonicalCourseIds }.forEach { courseId ->
            enrollmentJson += JSONObject()
                .put("id", "legacy_${stableId("$uid:$courseId")}")
                .put("userId", uid)
                .put("courseId", courseId)
                .put("legacyPaymentAccess", true)
            canonicalCourseIds += courseId
        }

        val courseIds = canonicalCourseIds.filter { it.isNotBlank() }.distinct()
        withContext(Dispatchers.IO) {
            cache.replaceUserCollection("userCourses", uid, enrollmentJson)
            cache.setString(enrollmentPrimeKey(uid), "1")
            cache.setLong(enrollmentValidationKey(uid), System.currentTimeMillis())
            leaseStore.refresh(uid, courseIds)
        }

        for (courseId in courseIds) {
            val cached = withContext(Dispatchers.IO) { cache.getDoc("courses", courseId) }
            if (cached == null) refreshSingleDoc("courses", courseId)
        }
        return cachedCourses(uid)
    }

    suspend fun cachedCourseContent(courseId: String): NativeCourseContent = withContext(Dispatchers.IO) {
        val course = cache.getDoc("courses", courseId)?.let(NativeCourse::from)
        val classes = cache.listDocs("classes", courseId = courseId)
            .map(NativeClassItem::from)
            .sortedWith(compareBy<NativeClassItem> { it.order }.thenBy { it.title })

        val storedSubjects = cache.listDocs("subjects", courseId = courseId)
            .map(NativeSubject::from)
            .filter { it.title.isNotBlank() }
        val subjectTitles = linkedSetOf<String>()
        storedSubjects.forEach { subjectTitles += it.title }
        classes.flatMap { it.subjects }.filter { it.isNotBlank() }.forEach { subjectTitles += it }
        val subjects = if (storedSubjects.isNotEmpty()) {
            val missing = subjectTitles.filter { title -> storedSubjects.none { it.title.equals(title, true) } }
                .mapIndexed { index, title -> NativeSubject("derived:${stableId(title)}", courseId, title, 10_000 + index) }
            (storedSubjects + missing).sortedWith(compareBy<NativeSubject> { it.order }.thenBy { it.title })
        } else {
            subjectTitles.mapIndexed { index, title -> NativeSubject("derived:${stableId(title)}", courseId, title, index) }
        }

        val storedChapters = cache.listDocs("chapters", courseId = courseId)
            .map(NativeChapter::from)
            .filter { it.title.isNotBlank() }
        val derivedChapters = linkedMapOf<String, NativeChapter>()
        classes.forEach { item ->
            val subject = item.subjects.firstOrNull().orEmpty()
            item.chapters.filter { it.isNotBlank() }.forEach { title ->
                val key = "$subject\u0000$title"
                derivedChapters.putIfAbsent(
                    key,
                    NativeChapter("derived:${stableId(key)}", courseId, subject, title, item.order),
                )
            }
        }
        val missingChapters = derivedChapters.values.filter { candidate ->
            storedChapters.none {
                it.title.equals(candidate.title, true) &&
                    (it.subject.isBlank() || candidate.subject.isBlank() || it.subject.equals(candidate.subject, true))
            }
        }
        val chapters = (storedChapters + missingChapters)
            .sortedWith(compareBy<NativeChapter> { it.order }.thenBy { it.title })

        NativeCourseContent(course, subjects, chapters, classes)
    }

    suspend fun ensureCourseContent(courseId: String, force: Boolean = false): NativeCourseContent {
        val cached = cachedCourseContent(courseId)
        val primed = withContext(Dispatchers.IO) { cache.getString(contentPrimeKey(courseId)) == "1" }
        if (!force && primed && cached.course != null) return cached

        refreshSingleDoc("courses", courseId)
        refreshCourseQuery("subjects", courseId)
        refreshCourseQuery("chapters", courseId)
        refreshCourseQuery("classes", courseId)
        withContext(Dispatchers.IO) { cache.setString(contentPrimeKey(courseId), "1") }
        return cachedCourseContent(courseId)
    }

    suspend fun syncChangedOnly(uid: String) {
        syncPublicFeed(uid)
        syncUserFeed(uid)
    }

    fun hasOfflineLease(uid: String, courseId: String): Boolean = leaseStore.isValid(uid, courseId)

    fun offlineLeaseExpiry(uid: String, courseId: String): Long = leaseStore.expiresAt(uid, courseId)

    private suspend fun syncPublicFeed(uid: String) {
        val snapshot = firestore.collection("settings").document("contentSync").get(Source.SERVER).await()
        if (!snapshot.exists()) return
        val currentSeq = snapshot.getLong("seq") ?: 0L
        val key = "sync:public:v1"
        val lastSeq = withContext(Dispatchers.IO) { cache.getLong(key) }
        if (lastSeq == 0L) {
            withContext(Dispatchers.IO) { cache.setLong(key, currentSeq) }
            return
        }
        if (currentSeq < lastSeq) {
            recoverCachedCourseContent(uid)
            withContext(Dispatchers.IO) { cache.setLong(key, currentSeq) }
            return
        }
        val events = feedEvents(snapshot, lastSeq)
        if (events.isEmpty()) {
            if (currentSeq > lastSeq) recoverCachedCourseContent(uid)
            withContext(Dispatchers.IO) { cache.setLong(key, currentSeq) }
            return
        }
        if (events.first().seq != lastSeq + 1 || !isContiguous(events)) {
            recoverCachedCourseContent(uid)
            withContext(Dispatchers.IO) { cache.setLong(key, currentSeq) }
            return
        }
        for (event in events) {
            if (event.collection in setOf("courses", "classes", "subjects", "chapters")) {
                if (event.action == "deleted") {
                    withContext(Dispatchers.IO) { cache.deleteDoc(event.collection, event.docId) }
                } else {
                    refreshSingleDoc(event.collection, event.docId)
                }
            }
            withContext(Dispatchers.IO) { cache.setLong(key, event.seq) }
        }
    }

    private suspend fun syncUserFeed(uid: String) {
        val snapshot = firestore.collection("users").document(uid).get(Source.SERVER).await()
        if (!snapshot.exists()) return
        withContext(Dispatchers.IO) { cache.putDoc("users", uid, snapshot.toCacheJson()) }
        val syncFeed = snapshot.get("syncFeed") as? Map<*, *>
        if (syncFeed == null) {
            // Legacy profile with no event feed: do a cheap periodic authoritative check.
            val lastValidation = withContext(Dispatchers.IO) { cache.getLong(enrollmentValidationKey(uid)) }
            if (System.currentTimeMillis() - lastValidation >= LEGACY_ENTITLEMENT_RECHECK_MS) {
                refreshEnrollments(uid)
            } else {
                renewCachedLeases(uid)
            }
            return
        }

        val currentSeq = (syncFeed["seq"] as? Number)?.toLong() ?: 0L
        val key = "sync:user:$uid:v1"
        val lastSeq = withContext(Dispatchers.IO) { cache.getLong(key) }
        if (lastSeq == 0L) {
            withContext(Dispatchers.IO) {
                cache.setLong(key, currentSeq)
                cache.setLong(enrollmentValidationKey(uid), System.currentTimeMillis())
            }
            renewCachedLeases(uid)
            return
        }
        if (currentSeq < lastSeq) {
            refreshEnrollments(uid)
            withContext(Dispatchers.IO) { cache.setLong(key, currentSeq) }
            return
        }
        val events = feedEvents(syncFeed, lastSeq)
        if (events.isEmpty()) {
            if (currentSeq > lastSeq) {
                // Sequence advanced but the retained feed cannot prove continuity.
                refreshEnrollments(uid)
            } else {
                renewCachedLeases(uid)
                withContext(Dispatchers.IO) { cache.setLong(enrollmentValidationKey(uid), System.currentTimeMillis()) }
            }
            withContext(Dispatchers.IO) { cache.setLong(key, currentSeq) }
            return
        }
        if (events.first().seq != lastSeq + 1 || !isContiguous(events)) {
            refreshEnrollments(uid)
            withContext(Dispatchers.IO) { cache.setLong(key, currentSeq) }
            return
        }

        var paymentEntitlementChanged = false
        for (event in events) {
            if (event.collection == "userCourses") {
                val courseId = event.docId.removePrefix("${uid}_")
                if (event.action == "deleted") {
                    withContext(Dispatchers.IO) {
                        cache.deleteDoc("userCourses", event.docId)
                        leaseStore.revoke(uid, courseId)
                    }
                } else {
                    refreshSingleDoc("userCourses", event.docId)
                    withContext(Dispatchers.IO) { leaseStore.grant(uid, courseId) }
                    val cachedCourse = withContext(Dispatchers.IO) { cache.getDoc("courses", courseId) }
                    if (cachedCourse == null) refreshSingleDoc("courses", courseId)
                }
            }
            if (event.collection == "payments") paymentEntitlementChanged = true
            if (event.collection == "userProgress") {
                if (event.action == "deleted") {
                    withContext(Dispatchers.IO) { cache.deleteDoc("userProgress", event.docId) }
                } else {
                    refreshSingleDoc("userProgress", event.docId)
                }
            }
            withContext(Dispatchers.IO) { cache.setLong(key, event.seq) }
        }

        if (paymentEntitlementChanged) refreshEnrollments(uid) else renewCachedLeases(uid)
        withContext(Dispatchers.IO) { cache.setLong(enrollmentValidationKey(uid), System.currentTimeMillis()) }
    }

    private suspend fun renewCachedLeases(uid: String) {
        val courseIds = withContext(Dispatchers.IO) { cachedCourseIds(uid) }
        withContext(Dispatchers.IO) { leaseStore.refresh(uid, courseIds) }
    }

    private fun cachedCourseIds(uid: String): List<String> = cache.listDocs("userCourses", userId = uid)
        .map(NativeEnrollment::from)
        .map { it.courseId }
        .filter { it.isNotBlank() }
        .distinct()

    private fun paymentCourseIds(snapshot: DocumentSnapshot): List<String> = buildList {
        snapshot.getString("courseId")?.takeIf { it.isNotBlank() }?.let(::add)
        val courses = snapshot.get("courses") as? List<*> ?: return@buildList
        for (entry in courses) {
            when (entry) {
                is String -> entry.takeIf { it.isNotBlank() }?.let(::add)
                is Map<*, *> -> {
                    val id = entry["id"]?.toString()?.takeIf { it.isNotBlank() }
                        ?: entry["courseId"]?.toString()?.takeIf { it.isNotBlank() }
                    if (id != null) add(id)
                }
            }
        }
    }

    private suspend fun recoverCachedCourseContent(uid: String) {
        val courseIds = withContext(Dispatchers.IO) { cachedCourseIds(uid) }
        for (courseId in courseIds) {
            val wasPrimed = withContext(Dispatchers.IO) { cache.getString(contentPrimeKey(courseId)) == "1" }
            if (wasPrimed) ensureCourseContent(courseId, force = true)
            else refreshSingleDoc("courses", courseId)
        }
    }

    private suspend fun refreshCourseQuery(collection: String, courseId: String) {
        val snapshot = firestore.collection(collection)
            .whereEqualTo("courseId", courseId)
            .get(Source.SERVER)
            .await()
        val docs = snapshot.documents.map(DocumentSnapshot::toCacheJson)
        withContext(Dispatchers.IO) { cache.replaceCollectionForCourse(collection, courseId, docs) }
    }

    private suspend fun refreshSingleDoc(collection: String, docId: String) {
        if (docId.isBlank()) return
        val snapshot = firestore.collection(collection).document(docId).get(Source.SERVER).await()
        withContext(Dispatchers.IO) {
            if (snapshot.exists()) cache.putDoc(collection, docId, snapshot.toCacheJson())
            else cache.deleteDoc(collection, docId)
        }
    }

    private data class FeedEvent(val seq: Long, val collection: String, val docId: String, val action: String)

    private fun feedEvents(snapshot: DocumentSnapshot, afterSeq: Long): List<FeedEvent> {
        val events = snapshot.get("events") as? List<*> ?: return emptyList()
        return parseEvents(events, afterSeq)
    }

    private fun feedEvents(feed: Map<*, *>, afterSeq: Long): List<FeedEvent> {
        val events = feed["events"] as? List<*> ?: return emptyList()
        return parseEvents(events, afterSeq)
    }

    private fun parseEvents(events: List<*>, afterSeq: Long): List<FeedEvent> = events.mapNotNull { raw ->
        val item = raw as? Map<*, *> ?: return@mapNotNull null
        val seq = (item["seq"] as? Number)?.toLong() ?: return@mapNotNull null
        if (seq <= afterSeq) return@mapNotNull null
        FeedEvent(
            seq = seq,
            collection = item["collection"]?.toString().orEmpty(),
            docId = item["docId"]?.toString().orEmpty(),
            action = item["action"]?.toString().orEmpty(),
        )
    }.sortedBy { it.seq }

    private fun isContiguous(events: List<FeedEvent>): Boolean =
        events.zipWithNext().all { (a, b) -> b.seq == a.seq + 1 }

    private fun enrollmentPrimeKey(uid: String) = "prime:enrollments:v3:$uid"
    private fun enrollmentValidationKey(uid: String) = "validation:enrollments:v3:$uid"
    private fun contentPrimeKey(courseId: String) = "prime:course-content:v2:$courseId"

    companion object {
        private const val LEGACY_ENTITLEMENT_RECHECK_MS = 24L * 60L * 60L * 1000L

        private fun stableId(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(20)
    }
}
