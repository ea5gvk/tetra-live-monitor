package com.ea5gvk.tetralivemonitor.net

import com.ea5gvk.tetralivemonitor.data.Settings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * Connects as a WebSocket client to a tetra-live-monitor server and reduces the
 * incoming message stream into an observable [TetraState]. Mirrors the reducer in
 * client/src/hooks/useTetraWebSocket.ts. Auto-reconnects every 2s on drop.
 */
class TetraClient(private val scope: CoroutineScope) {

    private val _state = MutableStateFlow(TetraState())
    val state: StateFlow<TetraState> = _state.asStateFlow()

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    private var job: Job? = null
    @Volatile private var socket: WebSocket? = null

    /** (Re)connects to the given normalized base URL (e.g. `http://10.33.1.75:5000`). */
    fun connectTo(base: String) {
        job?.cancel()
        socket?.cancel()
        _state.update { it.copy(connected = false, mode = "connecting") }
        val wsUrl = Settings.wsUrl(base)
        job = scope.launch(Dispatchers.IO) {
            while (isActive) {
                val closed = CompletableDeferred<Unit>()
                val request = Request.Builder().url(wsUrl).build()
                val ws = client.newWebSocket(request, object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        _state.update { it.copy(connected = true) }
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        handle(text)
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        _state.update { it.copy(connected = false) }
                        if (!closed.isCompleted) closed.complete(Unit)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        _state.update { it.copy(connected = false) }
                        if (!closed.isCompleted) closed.complete(Unit)
                    }
                })
                socket = ws
                closed.await()
                if (isActive) delay(2000)
            }
        }
    }

    fun disconnect() {
        job?.cancel()
        socket?.cancel()
        socket = null
        _state.update { it.copy(connected = false, mode = "disconnected") }
    }

    private fun handle(text: String) {
        val env = runCatching { json.decodeFromString<WsEnvelope>(text) }.getOrNull() ?: return
        _state.update { reduce(it, env.type, env.payload) }
    }

    private inline fun <reified T> decode(payload: JsonElement?): T? {
        if (payload == null || payload is JsonNull) return null
        return runCatching { json.decodeFromJsonElement<T>(payload) }.getOrNull()
    }

    private fun reduce(s: TetraState, type: String, payload: JsonElement?): TetraState = when (type) {
        "full_state" -> decode<FullStatePayload>(payload)?.let { p ->
            s.copy(
                terminals = p.terminals,
                localHistory = p.localHistory,
                externalHistory = p.externalHistory,
                emergencies = p.emergencies,
                brewStatus = p.brewStatus,
                fsDashboardActive = p.fsDashboardActive,
                rfCalls = p.rfCalls,
                dgnaLog = p.dgnaLog,
                gpsPositions = p.gpsPositions,
                gpsHistory = p.gpsHistory,
                sdsMessages = p.sdsMessages,
            )
        } ?: s

        "update_terminal" -> decode<Terminal>(payload)?.let { t ->
            s.copy(terminals = s.terminals + (t.id to t))
        } ?: s

        "new_call" -> decode<CallLogEntry>(payload)?.let { c ->
            if (c.isLocal) s.copy(localHistory = (listOf(c) + s.localHistory).take(50))
            else s.copy(externalHistory = (listOf(c) + s.externalHistory).take(50))
        } ?: s

        "update_call" -> decode<CallLogEntry>(payload)?.let { c ->
            if (c.isLocal) s.copy(localHistory = s.localHistory.map { if (it.id == c.id) c else it })
            else s.copy(externalHistory = s.externalHistory.map { if (it.id == c.id) c else it })
        } ?: s

        "status" -> s.copy(mode = decode<StatusPayload>(payload)?.mode ?: s.mode)

        "fs_emergency" -> s.copy(emergencies = decode<EmergencyWrapper>(payload)?.emergencies ?: emptyList())

        "fs_brew_status" -> s.copy(brewStatus = decode<BrewStatus>(payload))

        "fs_dashboard_status" -> s.copy(fsDashboardActive = decode<DashboardStatusPayload>(payload)?.active ?: false)

        "rf_calls_state" -> s.copy(rfCalls = if (payload is JsonArray) decode<List<RfCall>>(payload) ?: emptyList() else emptyList())

        "rf_call_started" -> decode<RfCall>(payload)?.let { c ->
            s.copy(rfCalls = s.rfCalls.filter { it.callId != c.callId } + c)
        } ?: s

        "rf_call_ended" -> decode<CallEndedPayload>(payload)?.let { p ->
            s.copy(rfCalls = s.rfCalls.filter { it.callId != p.callId })
        } ?: s

        "fs_dgna_status" -> decode<DgnaLogEntry>(payload)?.let { e ->
            s.copy(dgnaLog = (listOf(e) + s.dgnaLog).take(200))
        } ?: s

        "fs_dgna_log" -> s.copy(dgnaLog = decode<DgnaLogWrapper>(payload)?.log ?: emptyList())

        "fs_dgna_log_cleared" -> s.copy(dgnaLog = emptyList())

        "rf_ts_voice" -> decode<TsVoicePayload>(payload)?.let { p ->
            if (p.ts in 1..4) {
                val vc = p.carrier?.toString() ?: "single"
                s.copy(tsVoiceActivity = s.tsVoiceActivity + ("$vc:${p.ts}" to System.currentTimeMillis()))
            } else s
        } ?: s

        "sds_message" -> decode<SdsMessage>(payload)?.let { sds ->
            val msgs = (listOf(sds) + s.sdsMessages).distinctBy { it.id }.take(50)
            val lip = sds.lipData
            if (lip != null && sds.srcIssi.isNotBlank()) {
                val pos = GpsPosition(
                    issi = sds.srcIssi,
                    callsign = sds.srcCallsign ?: s.gpsPositions[sds.srcIssi]?.callsign,
                    lat = lip.lat, lon = lip.lon, speed = lip.speed, heading = lip.heading,
                    timestamp = java.time.Instant.now().toString(), hasFix = true,
                )
                val history = (s.gpsHistory[sds.srcIssi] ?: emptyList()) + pos
                s.copy(
                    sdsMessages = msgs,
                    gpsPositions = s.gpsPositions + (sds.srcIssi to pos),
                    gpsHistory = s.gpsHistory + (sds.srcIssi to history.takeLast(200)),
                )
            } else s.copy(sdsMessages = msgs)
        } ?: s

        else -> s
    }
}
