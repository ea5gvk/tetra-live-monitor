package com.ea5gvk.tetralivemonitor.net

import androidx.compose.runtime.staticCompositionLocalOf
import com.ea5gvk.tetralivemonitor.data.Settings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
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
    private var pollJob: Job? = null
    @Volatile private var socket: WebSocket? = null
    @Volatile private var base: String? = null
    @Volatile private var password: String = ""

    /** (Re)connects to the given normalized base URL (e.g. `http://10.33.1.75:5000`). */
    fun connectTo(base: String) {
        job?.cancel()
        socket?.cancel()
        this.base = base
        // Another server: nothing polled from the previous one is valid any more.
        _state.update {
            it.copy(connected = false, mode = "connecting", btsInfo = null, station = null,
                updateChecks = emptyMap(), passwordOk = null)
        }
        startPolling(base)
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
        pollJob?.cancel()
        socket?.cancel()
        socket = null
        base = null
        _state.update { it.copy(connected = false, mode = "disconnected") }
    }

    // --- REST polls shared by every screen ---

    private fun startPolling(base: String) {
        pollJob?.cancel()
        pollJob = scope.launch(Dispatchers.IO) {
            launch { while (isActive) { pollStation(base); delay(STATION_POLL_MS) } }
            // Each check runs git/curl on the Pi next to the station: at connect and once an hour, as the web.
            launch { while (isActive) { pollUpdates(base); delay(UPDATE_POLL_MS) } }
            launch { pollPassword(base) }
        }
    }

    private suspend fun pollStation(base: String) = coroutineScope {
        val st = async { TetraApi.getStationActive(base) }
        val bts = async { TetraApi.getBtsInfo(base) }
        val (s, b) = st.await() to bts.await()
        // Keep the last good answer through a failed poll.
        if (this@TetraClient.base == base) {
            _state.update { it.copy(station = s ?: it.station, btsInfo = b ?: it.btsInfo) }
        }
    }

    private suspend fun pollUpdates(base: String) = coroutineScope {
        val checks = UPDATE_CHECKS.map { (key, path) -> key to async { TetraApi.checkUpdate(base, path) } }
            .mapNotNull { (key, d) -> d.await()?.let { key to it } }.toMap()
        if (this@TetraClient.base == base) {
            _state.update { it.copy(updateChecks = it.updateChecks + checks) }
        }
    }

    private suspend fun pollPassword(base: String) {
        val pw = password
        val ok = if (pw.isEmpty()) null else TetraApi.verifyPassword(base, pw)
        if (this.base == base && password == pw) _state.update { it.copy(passwordOk = ok) }
    }

    /** Re-reads /api/station/active and /api/btsinfo now (after a station switch, dual carrier change...). */
    fun refreshStation() {
        val b = base ?: return
        scope.launch(Dispatchers.IO) { pollStation(b) }
    }

    /** Re-runs the three updater checks now (after an update or install finished). */
    fun refreshUpdates() {
        val b = base ?: return
        scope.launch(Dispatchers.IO) { pollUpdates(b) }
    }

    /** Saved system password (MainActivity feeds it in): checked against the server into state.passwordOk. */
    fun setPassword(pw: String) {
        password = pw
        val b = base
        if (b == null || pw.isEmpty()) { _state.update { it.copy(passwordOk = null) }; return }
        scope.launch(Dispatchers.IO) { pollPassword(b) }
    }

    /** Local names from DataStore: GSSI -> name (library mnemonics already merged over BM/ADN) and ISSI -> name. */
    fun setNames(tgNames: Map<Int, String>, issiNames: Map<String, String>) {
        _state.update { it.copy(tgNames = tgNames, issiNames = issiNames) }
    }

    private fun handle(text: String) {
        val env = runCatching { json.decodeFromString<WsEnvelope>(text) }.getOrNull() ?: return
        _state.update { reduce(it, env.type, env.payload) }
    }

    private inline fun <reified T> decode(payload: JsonElement?): T? {
        if (payload == null || payload is JsonNull) return null
        return runCatching { json.decodeFromJsonElement<T>(payload) }.getOrNull()
    }

    /** rf_carrier_air_state / full_state.carrierAir -> carrier -> off | warming | on (as toCarrierAir in the web). */
    private fun carrierAir(payload: JsonElement?): Map<String, String> =
        (if (payload is JsonArray) decode<List<CarrierAirEntry>>(payload) else null)
            ?.filter { it.carrier != null && it.state in AIR_STATES }
            ?.associate { it.carrier.toString() to it.state }
            ?: emptyMap()

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
                pdchSlots = if (p.pdch is JsonArray) decode<List<RfPdch>>(p.pdch) ?: s.pdchSlots else s.pdchSlots,
                carrierAir = carrierAir(p.carrierAir),
                lastHeard = (if (p.lastHeard is JsonArray) decode<List<LastHeardEntry>>(p.lastHeard) else null) ?: emptyList(),
                txQuality = decode<TxQuality>(p.txQuality),
                health = decode<HealthSnapshot>(p.health),
                sdrHealth = decode<SdrHealth>(p.sdrHealth),
                sysHealth = decode<SysHealth>(p.sysHealth),
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
                val key = "${p.carrier?.toString() ?: "single"}:${p.ts}"
                s.copy(
                    tsVoiceActivity = s.tsVoiceActivity + (key to System.currentTimeMillis()),
                    tsVoiceSpeaker = s.tsVoiceSpeaker + (key to p.speakerIssi),
                )
            } else s
        } ?: s

        "rf_ts_data" -> decode<TsDataPayload>(payload)?.let { p ->
            if (p.ts in 1..4) {
                val key = "${p.carrier?.toString() ?: "single"}:${p.ts}"
                s.copy(tsDataActivity = s.tsDataActivity + (key to System.currentTimeMillis()))
            } else s
        } ?: s

        "rf_pdch_state" -> s.copy(pdchSlots = if (payload is JsonArray) decode<List<RfPdch>>(payload) ?: emptyList() else emptyList())

        "rf_carrier_air_state" -> s.copy(carrierAir = carrierAir(payload))

        "fs_last_heard" -> s.copy(lastHeard = decode<LastHeardWrapper>(payload)?.list ?: emptyList())

        "fs_tx_quality" -> s.copy(txQuality = decode<TxQuality>(payload))

        "fs_health" -> s.copy(health = decode<HealthSnapshot>(payload))

        "fs_sdr_health" -> s.copy(sdrHealth = decode<SdrHealth>(payload))

        "fs_sys_health" -> s.copy(sysHealth = decode<SysHealth>(payload))

        "sds_message" -> decode<SdsMessage>(payload)?.let { sds ->
            // Same as the web: an update of a known SDS replaces it in place, a new one goes first.
            val msgs = if (s.sdsMessages.any { it.id == sds.id }) s.sdsMessages.map { if (it.id == sds.id) sds else it }
            else (listOf(sds) + s.sdsMessages).take(50)
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

    private companion object {
        const val STATION_POLL_MS = 30_000L
        const val UPDATE_POLL_MS = 60 * 60 * 1000L
        val AIR_STATES = setOf("off", "warming", "on")
        /** state.updateChecks key -> check endpoint (flowstation: the source in use, chosen by the server). */
        val UPDATE_CHECKS = listOf(
            "bluestation" to "/api/bluestation/check",
            "flowstation" to "/api/flowstation/check",
            "dashboard" to "/api/update/check",
        )
    }
}

/**
 * The app's [TetraClient] for screens that need to force a REST refresh (refreshStation / refreshUpdates).
 * Provided by MainActivity; null only in previews.
 */
val LocalTetraClient = staticCompositionLocalOf<TetraClient?> { null }
