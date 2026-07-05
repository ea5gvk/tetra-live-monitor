package com.ea5gvk.tetralivemonitor.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class ApiResult(val ok: Boolean, val message: String)

/**
 * Thin REST client for the privileged tetra-live-monitor endpoints (SDS, DGNA, kick,
 * system power/service). All actions are gated by the appliance `systemPassword`.
 */
object TetraApi {
    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun getBtsInfo(base: String): BtsInfo? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$base/api/btsinfo").get().build()
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: return@use null
                if (!resp.isSuccessful) null else json.decodeFromString<BtsInfo>(body)
            }
        }.getOrNull()
    }

    suspend fun getStats(base: String): SystemStats? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$base/api/system/stats").get().build()
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: return@use null
                if (!resp.isSuccessful) null else json.decodeFromString<SystemStats>(body)
            }
        }.getOrNull()
    }

    suspend fun getWhitelist(base: String): WhitelistInfo? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$base/api/system/whitelist").get().build()
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: return@use null
                json.decodeFromString<WhitelistInfo>(body)
            }
        }.getOrNull()
    }

    suspend fun setWhitelist(
        base: String, password: String, enabled: Boolean, issis: List<Int>,
        path: String, serviceName: String, restart: Boolean,
    ): ApiResult = post(base, "/api/system/whitelist", buildJsonObject {
        put("password", password)
        put("enabled", enabled)
        putJsonArray("issis") { issis.forEach { add(it) } }
        put("path", path)
        put("serviceName", serviceName)
        put("restart", restart)
    })

    suspend fun sendSds(base: String, password: String, destIssi: Int, message: String): ApiResult =
        post(base, "/api/sds/send", buildJsonObject {
            put("password", password); put("dest_issi", destIssi); put("message", message)
        })

    suspend fun dgna(
        base: String, password: String, issi: Int, gssi: Int,
        attach: Boolean, mnemonic: String, attachMode: Int,
    ): ApiResult = post(base, "/api/dgna", buildJsonObject {
        put("password", password); put("issi", issi); put("gssi", gssi)
        put("attach", attach); put("mnemonic", mnemonic); put("attachment_mode", attachMode)
    })

    suspend fun kick(base: String, password: String, issi: Int): ApiResult =
        post(base, "/api/kick", buildJsonObject { put("password", password); put("issi", issi) })

    suspend fun shutdown(base: String, password: String): ApiResult =
        post(base, "/api/system/shutdown", buildJsonObject { put("password", password) })

    suspend fun reboot(base: String, password: String): ApiResult =
        post(base, "/api/system/reboot", buildJsonObject { put("password", password) })

    suspend fun restartService(base: String, password: String, serviceName: String): ApiResult =
        post(base, "/api/system/restart-service", buildJsonObject {
            put("password", password); put("serviceName", serviceName)
        })

    private suspend fun post(base: String, path: String, body: JsonObject): ApiResult =
        withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url("$base$path")
                    .post(json.encodeToString(JsonObject.serializer(), body).toRequestBody(JSON_MEDIA))
                    .build()
                client.newCall(req).execute().use { resp ->
                    val raw = resp.body?.string().orEmpty()
                    val msg = runCatching {
                        (json.decodeFromString<JsonObject>(raw)["message"] as? JsonPrimitive)?.content
                    }.getOrNull() ?: (if (resp.isSuccessful) "OK" else "Error ${resp.code}")
                    ApiResult(resp.isSuccessful, msg)
                }
            }.getOrElse { ApiResult(false, "Sin conexión: ${it.message}") }
        }
}
