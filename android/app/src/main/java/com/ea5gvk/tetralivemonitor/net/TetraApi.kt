package com.ea5gvk.tetralivemonitor.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
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

    // Updaters stream git + cargo build (minutes of silence possible): no read timeout.
    private val streamClient = client.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()

    // Calls that run slow commands on the Pi before answering (systemctl, nmcli, wg-quick, BM/ADN download).
    private val slowClient = client.newBuilder().readTimeout(90, TimeUnit.SECONDS).build()

    /** GET of an updater's check endpoint (/api/update/check, /api/bluestation/check, …). */
    suspend fun checkUpdate(base: String, path: String): UpdateCheck? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$base$path").get().build()
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: return@use null
                if (!resp.isSuccessful) null else json.decodeFromString<UpdateCheck>(body)
            }
        }.getOrNull()
    }

    /** POST whose text/plain response is streamed line by line (updater apply/install). */
    fun streamPost(base: String, path: String, body: JsonObject): Flow<String> = flow {
        val req = Request.Builder()
            .url("$base$path")
            .post(json.encodeToString(JsonObject.serializer(), body).toRequestBody(JSON_MEDIA))
            .build()
        streamClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                val raw = resp.body?.string().orEmpty()
                val msg = runCatching {
                    (json.decodeFromString<JsonObject>(raw)["message"] as? JsonPrimitive)?.content
                }.getOrNull()
                throw IOException(msg ?: "Error ${resp.code}")
            }
            val src = resp.body?.source() ?: return@use
            while (true) {
                val line = src.readUtf8Line() ?: break
                emit(line)
            }
        }
    }.flowOn(Dispatchers.IO)

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

    suspend fun getDualCarrier(base: String): DualCarrierInfo? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$base/api/system/dualcarrier").get().build()
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: return@use null
                json.decodeFromString<DualCarrierInfo>(body)
            }
        }.getOrNull()
    }

    suspend fun setDualCarrier(
        base: String, password: String, enabled: Boolean,
        path: String, serviceName: String, restart: Boolean,
    ): ApiResult = post(base, "/api/system/dualcarrier", buildJsonObject {
        put("password", password)
        put("enabled", enabled)
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

    /**
     * Unit of the flow-family station in use, as the dashboard decides it (`flowService` of
     * /api/station/active: the selected or running one, never the other one installed next to it).
     * A dashboard without that field only knows flowstation.service.
     */
    suspend fun flowService(base: String): String = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url("$base/api/station/active").get().build()
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string() ?: return@use null
                if (!resp.isSuccessful) return@use null
                val svc = (json.decodeFromString<JsonObject>(body)["flowService"] as? JsonPrimitive)?.content
                svc?.takeIf { it == "flowstation.service" || it == "miurastation.service" }
            }
        }.getOrNull() ?: "flowstation.service"
    }

    suspend fun restartService(base: String, password: String, serviceName: String): ApiResult =
        post(base, "/api/system/restart-service", buildJsonObject {
            put("password", password); put("serviceName", serviceName)
        })

    // ─── 1.4: station selector, verify password, station dashboard ─────────────

    /** GET /api/station/active (null when unreachable). TetraClient polls it into TetraState.station. */
    suspend fun getStationActive(base: String): StationActive? = getJson(base, "/api/station/active")

    /**
     * POST /api/station/switch {password, station}: starts [station] (bluestation | flowstation | miurastation) and
     * then stops and disables the other installed ones. `log` holds the systemctl output, also on failure.
     */
    suspend fun switchStation(base: String, password: String, station: String): StationSwitchResult =
        withContext(Dispatchers.IO) {
            val r = call(slowClient, "POST", base, "/api/station/switch", buildJsonObject {
                put("password", password); put("station", station)
            })
            val o = r.obj
            val ok = r.ok && (o?.get("ok") as? JsonPrimitive)?.booleanOrNull != false
            StationSwitchResult(
                ok = ok,
                message = o.str("message") ?: r.error ?: (if (ok) "OK" else "Error ${r.code}"),
                station = o.str("station"),
                service = o.str("service"),
                configPath = o.str("configPath"),
                log = o.str("log").orEmpty(),
            )
        }

    /** POST /api/system/verify-password: true accepted, false rejected (401), null no answer. */
    suspend fun verifyPassword(base: String, password: String): Boolean? = withContext(Dispatchers.IO) {
        if (password.isEmpty()) return@withContext false
        val r = call(client, "POST", base, "/api/system/verify-password", buildJsonObject { put("password", password) })
        when {
            r.ok -> true
            r.code == 401 -> false
            else -> null
        }
    }

    /** GET /api/flowstation/dashboard-status: the station's own dashboard (opened at ${base}/flow-iframe/). */
    suspend fun getFlowDashboardStatus(base: String): FlowDashboardStatus? =
        getJson(base, "/api/flowstation/dashboard-status")

    // ─── 1.4: talkgroup names ─────────────────────────────────────────────────

    /** GET /api/talkgroups?source=bm|adn (server cache 1 h; the first download can take ~30 s). */
    suspend fun getTalkgroups(base: String, source: String): TalkgroupNames? =
        getJson(base, "/api/talkgroups?source=${enc(source)}", slowClient)

    // ─── 1.4: DGNA in bulk + log ──────────────────────────────────────────────

    /**
     * Same DGNA to several radios, one POST /api/dgna after the other (as the web's DGNA centre).
     * [onProgress] is called after each radio with (done, ok, total).
     */
    suspend fun dgnaBulk(
        base: String, password: String, issis: List<Int>, gssi: Int,
        attach: Boolean, mnemonic: String, attachMode: Int,
        onProgress: suspend (done: Int, ok: Int, total: Int) -> Unit = { _, _, _ -> },
    ): DgnaBulkResult {
        var ok = 0
        val errors = mutableListOf<String>()
        issis.forEachIndexed { i, issi ->
            val r = dgna(base, password, issi, gssi, attach, mnemonic, attachMode)
            if (r.ok) ok++ else errors += "$issi: ${r.message}"
            onProgress(i + 1, ok, issis.size)
        }
        return DgnaBulkResult(ok, issis.size, errors)
    }

    /** DELETE /api/dgna-log (no password, as the web). The WS then sends fs_dgna_log_cleared. */
    suspend fun clearDgnaLog(base: String): ApiResult = withContext(Dispatchers.IO) { call(client, "DELETE", base, "/api/dgna-log").result() }

    // ─── 1.4: VPN WireGuard ───────────────────────────────────────────────────

    suspend fun getVpnStatus(base: String): VpnStatus? = getJson(base, "/api/vpn/status", slowClient)

    suspend fun getVpnClients(base: String): List<VpnClient>? = getJson(base, "/api/vpn/clients")

    /** POST /api/vpn/{action} {password}; action = install | connect | disconnect | uninstall. */
    suspend fun vpnAction(base: String, password: String, action: String): ApiResult = withContext(Dispatchers.IO) {
        call(slowClient, "POST", base, "/api/vpn/$action", buildJsonObject { put("password", password) }).result()
    }

    /** POST /api/vpn/setup: server keys + wg0.conf (web defaults: 10.8.0.1/24, 51820, 8.8.8.8). */
    suspend fun vpnSetup(
        base: String, password: String, serverAddress: String, serverPort: Int, clientDns: String,
    ): ApiResult = withContext(Dispatchers.IO) {
        call(slowClient, "POST", base, "/api/vpn/setup", buildJsonObject {
            put("password", password); put("serverAddress", serverAddress)
            put("serverPort", serverPort.toString()); put("clientDns", clientDns)
        }).result()
    }

    /** POST /api/vpn/clients {password, name}; name: letters, digits, _ and - only. */
    suspend fun vpnAddClient(base: String, password: String, name: String): ApiResult = withContext(Dispatchers.IO) {
        call(slowClient, "POST", base, "/api/vpn/clients", buildJsonObject {
            put("password", password); put("name", name)
        }).result()
    }

    suspend fun vpnDeleteClient(base: String, password: String, name: String): ApiResult = withContext(Dispatchers.IO) {
        call(slowClient, "DELETE", base, "/api/vpn/clients/${enc(name)}", buildJsonObject { put("password", password) }).result()
    }

    /** GET /api/vpn/clients/:name/config → the client's wg-quick .conf text (null on error). */
    suspend fun getVpnClientConfig(base: String, name: String): String? = withContext(Dispatchers.IO) {
        call(client, "GET", base, "/api/vpn/clients/${enc(name)}/config").takeIf { it.ok }?.obj.str("config")
    }

    // ─── 1.4: WiFi of the Pi ──────────────────────────────────────────────────

    suspend fun getWifiStatus(base: String): WifiStatus? = getJson(base, "/api/wifi/status")

    /** GET /api/wifi/scan (rescans: up to ~20 s), strongest first. */
    suspend fun wifiScan(base: String): List<WifiNetwork>? = withContext(Dispatchers.IO) {
        call(slowClient, "GET", base, "/api/wifi/scan").takeIf { it.ok }?.obj?.get("networks")
            ?.let { runCatching { json.decodeFromJsonElement<List<WifiNetwork>>(it) }.getOrNull() }
    }

    suspend fun wifiSaved(base: String): List<WifiSaved>? = withContext(Dispatchers.IO) {
        call(client, "GET", base, "/api/wifi/saved").takeIf { it.ok }?.obj?.get("networks")
            ?.let { runCatching { json.decodeFromJsonElement<List<WifiSaved>>(it) }.getOrNull() }
    }

    /** POST /api/wifi/connect {password, ssid, wifiPassword}; empty wifiPassword = open network. */
    suspend fun wifiConnect(base: String, password: String, ssid: String, wifiPassword: String): ApiResult =
        withContext(Dispatchers.IO) {
            call(slowClient, "POST", base, "/api/wifi/connect", buildJsonObject {
                put("password", password); put("ssid", ssid); put("wifiPassword", wifiPassword)
            }).result()
        }

    suspend fun wifiDisconnect(base: String, password: String): ApiResult = withContext(Dispatchers.IO) {
        call(slowClient, "POST", base, "/api/wifi/disconnect", buildJsonObject { put("password", password) }).result()
    }

    /** POST /api/wifi/forget {password, name}: deletes a saved connection (name from wifiSaved). */
    suspend fun wifiForget(base: String, password: String, name: String): ApiResult = withContext(Dispatchers.IO) {
        call(slowClient, "POST", base, "/api/wifi/forget", buildJsonObject {
            put("password", password); put("name", name)
        }).result()
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /** Raw answer of [call]: HTTP code (-1 without connection), body and its JSON object if it is one. */
    private class Http(val code: Int, val raw: String, val error: String? = null) {
        val ok get() = code in 200..299
        val obj: JsonObject? by lazy { runCatching { json.decodeFromString<JsonObject>(raw) }.getOrNull() }
        /** Same rules as [post]: HTTP 2xx and no {"ok": false}; message from the body. */
        fun result(): ApiResult {
            if (error != null) return ApiResult(false, "Sin conexión: $error")
            val okField = (obj?.get("ok") as? JsonPrimitive)?.booleanOrNull
            val good = ok && okField != false
            return ApiResult(good, obj.str("message") ?: (if (good) "OK" else "Error $code"))
        }
    }

    private fun JsonObject?.str(key: String): String? =
        (this?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun enc(v: String): String = java.net.URLEncoder.encode(v, "UTF-8").replace("+", "%20")

    /** Blocking request (call from Dispatchers.IO). */
    private fun call(c: OkHttpClient, method: String, base: String, path: String, body: JsonObject? = null): Http =
        runCatching {
            val url = "$base$path".toHttpUrlOrNull() ?: return Http(-1, "", "URL inválida")
            val rb = body?.let { json.encodeToString(JsonObject.serializer(), it).toRequestBody(JSON_MEDIA) }
            val req = Request.Builder().url(url).method(method, rb).build()
            c.newCall(req).execute().use { resp -> Http(resp.code, resp.body?.string().orEmpty()) }
        }.getOrElse { Http(-1, "", it.message ?: it.javaClass.simpleName) }

    private suspend inline fun <reified T> getJson(base: String, path: String, c: OkHttpClient = client): T? =
        withContext(Dispatchers.IO) {
            val r = call(c, "GET", base, path)
            if (!r.ok) null else runCatching { json.decodeFromString<T>(r.raw) }.getOrNull()
        }

    private suspend fun post(base: String, path: String, body: JsonObject): ApiResult =
        withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url("$base$path")
                    .post(json.encodeToString(JsonObject.serializer(), body).toRequestBody(JSON_MEDIA))
                    .build()
                client.newCall(req).execute().use { resp ->
                    val raw = resp.body?.string().orEmpty()
                    val obj = runCatching { json.decodeFromString<JsonObject>(raw) }.getOrNull()
                    val msg = (obj?.get("message") as? JsonPrimitive)?.content
                        ?: (if (resp.isSuccessful) "OK" else "Error ${resp.code}")
                    // Like the web: an HTTP 200 with {"ok": false} is a failure too.
                    val okField = (obj?.get("ok") as? JsonPrimitive)?.booleanOrNull
                    ApiResult(resp.isSuccessful && okField != false, msg)
                }
            }.getOrElse { ApiResult(false, "Sin conexión: ${it.message}") }
        }
}
