package com.easyeducation.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

class NativeCacheDb(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE docs (
              collection_name TEXT NOT NULL,
              doc_id TEXT NOT NULL,
              course_id TEXT NOT NULL DEFAULT '',
              user_id TEXT NOT NULL DEFAULT '',
              payload TEXT NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY(collection_name, doc_id)
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX docs_collection_course ON docs(collection_name, course_id)")
        db.execSQL("CREATE INDEX docs_collection_user ON docs(collection_name, user_id)")
        db.execSQL(
            """
            CREATE TABLE kv (
              key_name TEXT PRIMARY KEY,
              value_text TEXT NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("CREATE INDEX IF NOT EXISTS docs_collection_course ON docs(collection_name, course_id)")
            db.execSQL("CREATE INDEX IF NOT EXISTS docs_collection_user ON docs(collection_name, user_id)")
        }
    }

    @Synchronized
    fun putDoc(collection: String, id: String, payload: JSONObject) {
        val values = ContentValues().apply {
            put("collection_name", collection)
            put("doc_id", id)
            put("course_id", payload.optString("courseId"))
            put("user_id", payload.optString("userId"))
            put("payload", payload.toString())
            put("updated_at", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("docs", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun deleteDoc(collection: String, id: String) {
        writableDatabase.delete(
            "docs",
            "collection_name = ? AND doc_id = ?",
            arrayOf(collection, id),
        )
    }

    @Synchronized
    fun getDoc(collection: String, id: String): JSONObject? {
        readableDatabase.query(
            "docs",
            arrayOf("payload"),
            "collection_name = ? AND doc_id = ?",
            arrayOf(collection, id),
            null,
            null,
            null,
            "1",
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return runCatching { JSONObject(cursor.getString(0)) }.getOrNull()
        }
    }

    @Synchronized
    fun listDocs(collection: String, courseId: String? = null, userId: String? = null): List<JSONObject> {
        val where = mutableListOf("collection_name = ?")
        val args = mutableListOf(collection)
        if (!courseId.isNullOrBlank()) {
            where += "course_id = ?"
            args += courseId
        }
        if (!userId.isNullOrBlank()) {
            where += "user_id = ?"
            args += userId
        }
        return buildList {
            readableDatabase.query(
                "docs",
                arrayOf("payload"),
                where.joinToString(" AND "),
                args.toTypedArray(),
                null,
                null,
                "updated_at ASC",
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    runCatching { JSONObject(cursor.getString(0)) }.getOrNull()?.let(::add)
                }
            }
        }
    }

    @Synchronized
    fun replaceCollectionForCourse(collection: String, courseId: String, docs: List<JSONObject>) {
        writableDatabase.beginTransaction()
        try {
            writableDatabase.delete(
                "docs",
                "collection_name = ? AND course_id = ?",
                arrayOf(collection, courseId),
            )
            docs.forEach { putDoc(collection, it.optString("id"), it) }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    @Synchronized
    fun replaceUserCollection(collection: String, userId: String, docs: List<JSONObject>) {
        writableDatabase.beginTransaction()
        try {
            writableDatabase.delete(
                "docs",
                "collection_name = ? AND user_id = ?",
                arrayOf(collection, userId),
            )
            docs.forEach { putDoc(collection, it.optString("id"), it) }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    @Synchronized
    fun setString(key: String, value: String) {
        val values = ContentValues().apply {
            put("key_name", key)
            put("value_text", value)
        }
        writableDatabase.insertWithOnConflict("kv", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun setLong(key: String, value: Long) = setString(key, value.toString())

    @Synchronized
    fun getString(key: String, defaultValue: String = ""): String {
        readableDatabase.query(
            "kv",
            arrayOf("value_text"),
            "key_name = ?",
            arrayOf(key),
            null,
            null,
            null,
            "1",
        ).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getString(0) else defaultValue
        }
    }

    fun getLong(key: String, defaultValue: Long = 0L): Long = getString(key).toLongOrNull() ?: defaultValue

    companion object {
        private const val DB_NAME = "easy_education_native_cache.db"
        private const val DB_VERSION = 2
    }
}
