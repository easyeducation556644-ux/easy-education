package com.easyeducation.app

/**
 * Small process-local queue for the chapter currently being watched. It intentionally contains only
 * classes from the same subject/chapter scope so player previous/next never jumps across chapters.
 */
data class PlayerQueueItem(
    val courseId: String,
    val classId: String,
    val title: String,
    val sourceUrl: String,
    val height: Int = 480,
)

object PlayerChapterQueue {
    private val lock = Any()
    private var items: List<PlayerQueueItem> = emptyList()
    private var scopeKey: String = ""

    fun set(scope: String, newItems: List<PlayerQueueItem>) {
        synchronized(lock) {
            scopeKey = scope
            items = newItems.filter { it.classId.isNotBlank() && it.sourceUrl.isNotBlank() }
                .distinctBy { it.classId }
        }
    }

    fun scope(): String = synchronized(lock) { scopeKey }

    fun all(): List<PlayerQueueItem> = synchronized(lock) { items.toList() }

    fun contains(classId: String): Boolean = synchronized(lock) { items.any { it.classId == classId } }

    fun item(classId: String): PlayerQueueItem? = synchronized(lock) { items.firstOrNull { it.classId == classId } }

    fun previous(classId: String): PlayerQueueItem? = synchronized(lock) {
        val index = items.indexOfFirst { it.classId == classId }
        if (index > 0) items[index - 1] else null
    }

    fun next(classId: String): PlayerQueueItem? = synchronized(lock) {
        val index = items.indexOfFirst { it.classId == classId }
        if (index >= 0 && index < items.lastIndex) items[index + 1] else null
    }

    fun hasPrevious(classId: String): Boolean = previous(classId) != null

    fun hasNext(classId: String): Boolean = next(classId) != null

    fun clear() {
        synchronized(lock) {
            scopeKey = ""
            items = emptyList()
        }
    }
}
