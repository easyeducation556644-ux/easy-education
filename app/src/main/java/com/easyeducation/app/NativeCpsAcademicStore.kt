package com.easyeducation.app

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

private const val CPS_ACADEMIC_MEMORY_TTL_MS = 2 * 60_000L

object NativeCpsAcademicStore {
    private val _bundles = MutableStateFlow<Map<String, NativeCpsAcademicBundle>>(emptyMap())
    val bundles: StateFlow<Map<String, NativeCpsAcademicBundle>> = _bundles.asStateFlow()
    private val verifiedAt = mutableMapOf<String, Long>()
    private val loading = mutableSetOf<String>()

    fun seed(context: Context, courseId: String) {
        if (courseId.isBlank() || _bundles.value.containsKey(courseId)) return
        NativeCpsAcademicRepository(context).cached(courseId)?.let { cached ->
            _bundles.value = _bundles.value + (courseId to cached)
        }
    }

    suspend fun refresh(context: Context, courseId: String, online: Boolean, force: Boolean = false): NativeCpsAcademicBundle? {
        if (courseId.isBlank()) return null
        seed(context, courseId)
        val cached = _bundles.value[courseId]
        if (!online) return cached
        val now = System.currentTimeMillis()
        if (!force && cached != null && now - (verifiedAt[courseId] ?: 0L) < CPS_ACADEMIC_MEMORY_TTL_MS) return cached
        synchronized(loading) {
            if (!loading.add(courseId)) return _bundles.value[courseId]
        }
        return try {
            NativeCpsAcademicRepository(context).refresh(courseId).also { fresh ->
                _bundles.value = _bundles.value + (courseId to fresh)
                verifiedAt[courseId] = System.currentTimeMillis()
            }
        } catch (_: Throwable) {
            _bundles.value[courseId]
        } finally {
            synchronized(loading) { loading.remove(courseId) }
        }
    }

    fun invalidate(courseId: String? = null) {
        if (courseId == null) verifiedAt.clear() else verifiedAt.remove(courseId)
    }

    fun clear() {
        verifiedAt.clear()
        loading.clear()
        _bundles.value = emptyMap()
    }
}
