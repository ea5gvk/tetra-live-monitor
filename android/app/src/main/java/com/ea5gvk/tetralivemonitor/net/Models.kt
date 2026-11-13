package com.ea5gvk.tetralivemonitor.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * Data model mirroring the WebSocket contract served by tetra-live-monitor at `/ws`
 * (see client/src/hooks/useTetraWebSocket.ts). Unknown fields are ignored by the
 * decoder, so the model only needs the pieces the app renders.
 */

@Serializable
data class WsEnvelope(
    val type: String = "",
    val payload: JsonElement? = null,
)

@Serializable
data class GroupCatalogEntry(
    val gssi: Int = 0,
    val mnemonic: String = "",
    @SerialName("attachment_mode") val attachmentMode: Int = 0,
    @SerialName("is_dynamic") val isDynamic: Boolean = false,
    @SerialName("is_attached") val isAttached: Boolean = false,
)

@Serializable
data class Terminal(
    val id: String = "",
    val callsign: String? = null,
    val status: String = "Offline",
    val selectedTg: String = "",
    val groups: List<String> = emptyList(),
    val groupCatalog: List<GroupCatalogEntry>? = null,
    val lastSeen: String = "",
    val isLocal: Boolean = false,
    val isActive: Boolean? = null,
    val activity: String? = null,
    val activityTg: String? = null,
    val timeSlot: Int? = null,
    val rssiDbfs: Double? = null,
    val energySaving: String? = null,
    /** Air-interface ciphering (flowstation-tea2): true = encrypted, false = clear, null = not reported. */
    val ciphering: Boolean? = null,
)

@Serializable
data class CallLogEntry(
    val id: String = "",
    val timestamp: String = "",
    val sourceId: String = "",
    val sourceCallsign: String? = null,
    val targetTg: String = "",
    val targetIssi: String? = null,
    val display: String = "",
    val isLocal: Boolean = false,
    val activity: String? = null,
    val timeSlot: Int? = null,
    val callType: String? = null,
)

@Serializable
data class EmergencyEntry(
    val issi: Int = 0,
    @SerialName("dest_ssi") val destSsi: Int = 0,
    @SerialName("started_secs_ago") val startedSecsAgo: Int = 0,
)

@Serializable
data class BrewStatus(
    val connected: Boolean = false,
    val version: Int = 0,
)

@Serializable
data class RfCall(
    val callId: Int = 0,
    val callType: String = "",
    val gssi: Int = 0,
    val callerIssi: Int = 0,
    val calledIssi: Int = 0,
    val ts: Double = 0.0,
    val carrier: Int? = null,
    val peerCarrier: Int? = null,
    val peerTs: Int? = null,
    val simplex: Boolean? = null,
    // Epoch ms when the call started (server-stamped); drives the per-cell talk timer.
    val startedAt: Long? = null,
    /** Trunking priority when reported (>= 15 = emergency). */
    val priority: Int? = null,
    /** The party that set the call up (callerIssi follows the current speaker). */
    val origCallerIssi: Int? = null,
    /** Current floor holder, when known. */
    val speakerIssi: Int? = null,
    /** Traffic circuit encrypted (flowstation-tea2 only); null = unknown. */
    val encrypted: Boolean? = null,
)

/** A timeslot the station made a radio's packet-data channel (PDCH: WAP / IP data). */
@Serializable
data class RfPdch(
    val carrier: Int? = null,
    val ts: Int = 0,
    val issi: Int = 0,
    /** Epoch ms of the assignment. */
    val since: Long = 0,
)

/** One element of rf_carrier_air_state / full_state.carrierAir. */
@Serializable
data class CarrierAirEntry(val carrier: Int? = null, val state: String = "")

/** Station Last Heard (fs_last_heard / full_state.lastHeard). activity: call_group | call_individual | sds | ... */
@Serializable
data class LastHeardEntry(
    val ts: String = "",
    val issi: Int = 0,
    val activity: String = "",
    val dest: Int = 0,
)

@Serializable
data class LastHeardWrapper(val list: List<LastHeardEntry> = emptyList())

/** Last TX quality measurement of the station (fs_tx_quality / full_state.txQuality). */
@Serializable
data class TxQuality(
    @SerialName("papr_db") val paprDb: Double? = null,
    @SerialName("evm_pct") val evmPct: Double? = null,
    @SerialName("dc_offset_i") val dcOffsetI: Double? = null,
    @SerialName("dc_offset_q") val dcOffsetQ: Double? = null,
    @SerialName("iq_amplitude_imbalance_db") val iqAmplitudeImbalanceDb: Double? = null,
    @SerialName("iq_phase_imbalance_deg") val iqPhaseImbalanceDeg: Double? = null,
    @SerialName("carrier_leakage_db") val carrierLeakageDb: Double? = null,
    @SerialName("occupied_bandwidth_hz") val occupiedBandwidthHz: Double? = null,
)

/** SDR health (fs_sdr_health / full_state.sdrHealth). Gains arrive as [name, dB] pairs. */
@Serializable
data class SdrHealth(
    @SerialName("temperature_c") val temperatureC: Double? = null,
    @SerialName("tx_gains") val txGainsRaw: JsonElement? = null,
    @SerialName("rx_gains") val rxGainsRaw: JsonElement? = null,
) {
    val txGains: List<Pair<String, Double>> get() = gainPairs(txGainsRaw)
    val rxGains: List<Pair<String, Double>> get() = gainPairs(rxGainsRaw)
}

private fun gainPairs(e: JsonElement?): List<Pair<String, Double>> =
    (e as? JsonArray)?.mapNotNull { item ->
        val a = item as? JsonArray ?: return@mapNotNull null
        val name = (a.getOrNull(0) as? JsonPrimitive)?.content ?: return@mapNotNull null
        val v = (a.getOrNull(1) as? JsonPrimitive)?.content?.toDoubleOrNull() ?: return@mapNotNull null
        name to v
    } ?: emptyList()

@Serializable
data class SysSensor(val name: String = "", val kind: String = "", val value: Double = 0.0)

/** Host sensors of the station (fs_sys_health / full_state.sysHealth). */
@Serializable
data class SysHealth(
    @SerialName("total_power_w") val totalPowerW: Double? = null,
    val sensors: List<SysSensor> = emptyList(),
)

/** level: ok | degraded | critical. */
@Serializable
data class HealthDomain(val domain: String = "", val level: String = "ok", val detail: String? = null)

/** Station health / watchdog (fs_health / full_state.health). overall: ok | degraded | critical. */
@Serializable
data class HealthSnapshot(
    val overall: String = "ok",
    val domains: List<HealthDomain> = emptyList(),
    @SerialName("last_action") val lastAction: String? = null,
    @SerialName("uptime_secs") val uptimeSecs: Long? = null,
)

@Serializable
data class DgnaLogEntry(
    val ts: String = "",
    val issi: Int = 0,
    val gssi: Int = 0,
    val accepted: Boolean = false,
    val detail: String = "",
    val attach: Boolean = false,
    val source: String = "",
)

@Serializable
data class SdsLipData(
    val lat: Double = 0.0,
    val lon: Double = 0.0,
    val speed: Double? = null,
    val heading: Double? = null,
)

@Serializable
data class SdsMessage(
    val id: String = "",
    val timestamp: String = "",
    val srcIssi: String = "",
    val srcCallsign: String? = null,
    val dstIssi: String = "",
    val dstCallsign: String? = null,
    val direction: String = "incoming",
    /** "data" | "status" */
    val messageType: String = "data",
    val statusCode: String? = null,
    val sdsType: Int = 0,
    val size: Int = 0,
    /** "bits" | "bytes" */
    val sizeUnit: String = "bits",
    val textContent: String? = null,
    val lipData: SdsLipData? = null,
)

@Serializable
data class GpsPosition(
    val issi: String = "",
    val callsign: String? = null,
    val lat: Double = 0.0,
    val lon: Double = 0.0,
    val speed: Double? = null,
    val heading: Double? = null,
    val timestamp: String = "",
    val hasFix: Boolean = false,
)

@Serializable
data class FullStatePayload(
    val terminals: Map<String, Terminal> = emptyMap(),
    val localHistory: List<CallLogEntry> = emptyList(),
    val externalHistory: List<CallLogEntry> = emptyList(),
    val emergencies: List<EmergencyEntry> = emptyList(),
    val brewStatus: BrewStatus? = null,
    val fsDashboardActive: Boolean = false,
    val rfCalls: List<RfCall> = emptyList(),
    val dgnaLog: List<DgnaLogEntry> = emptyList(),
    val gpsPositions: Map<String, GpsPosition> = emptyMap(),
    val gpsHistory: Map<String, List<GpsPosition>> = emptyMap(),
    val sdsMessages: List<SdsMessage> = emptyList(),
    // Newer fields kept raw and decoded one by one, so a shape change in one of them never drops the whole snapshot.
    val pdch: JsonElement? = null,
    val carrierAir: JsonElement? = null,
    val lastHeard: JsonElement? = null,
    val txQuality: JsonElement? = null,
    val health: JsonElement? = null,
    val sdrHealth: JsonElement? = null,
    val sysHealth: JsonElement? = null,
)

@Serializable
data class TsVoicePayload(val ts: Int = 0, val carrier: Int? = null, val speakerIssi: Int? = null)

/** rf_ts_data: packet-data activity ping on a PDCH (dir: ul | dl). */
@Serializable
data class TsDataPayload(val ts: Int = 0, val carrier: Int? = null, val issi: Int? = null, val dir: String = "ul")

/** BTS carrier from GET /api/btsinfo: exact DL (tx) / UL (rx) frequency in Hz when known. */
@Serializable
data class BtsCarrier(
    @SerialName("carrier_num") val carrierNum: Int? = null,
    @SerialName("tx_freq_hz") val txFreqHz: Long? = null,
    @SerialName("rx_freq_hz") val rxFreqHz: Long? = null,
)

/** Raspberry Pi vitals from GET /api/system/stats. */
@Serializable
data class SystemStats(
    val cpuTemp: Double? = null,
    val cpuLoad: Int? = null,
    val memUsed: Int? = null,
    val voltage: Double? = null,
    val hostname: String = "",
    val localIp: String? = null,
    val publicIp: String? = null,
)

@Serializable
data class BtsInfo(
    @SerialName("main_carrier") val mainCarrier: Int? = null,
    @SerialName("secondary_carrier") val secondaryCarrier: Int? = null,
    @SerialName("dual_carrier_active") val dualCarrierActive: Boolean = false,
    val carriers: List<BtsCarrier> = emptyList(),
    @SerialName("tx_freq_hz") val txFreqHz: Long? = null,
    @SerialName("rx_freq_hz") val rxFreqHz: Long? = null,
    @SerialName("shift_hz") val shiftHz: Long? = null,
    val mcc: Int? = null,
    val mnc: Int? = null,
    @SerialName("neighbor_count") val neighborCount: Int = 0,
    @SerialName("hangtime_secs") val hangtimeSecs: Int? = null,
    @SerialName("whitelist_restricted") val whitelistRestricted: Boolean = false,
    @SerialName("whitelist_count") val whitelistCount: Int = 0,
    /** Station whose config.toml was read: bluestation | flowstation | miurastation. */
    val station: String? = null,
)

/** ISSI whitelist state from GET/POST /api/system/whitelist. */
@Serializable
data class WhitelistInfo(
    val ok: Boolean = false,
    val enabled: Boolean = false,
    val issis: List<Int> = emptyList(),
    val path: String = "",
    val service: String = "",
    val message: String? = null,
)

/** Dual carrier state from GET/POST /api/system/dualcarrier. */
@Serializable
data class DualCarrierInfo(
    val ok: Boolean = false,
    val configured: Boolean = false,
    val enabled: Boolean = false,
    @SerialName("secondary_carrier") val secondaryCarrier: Int? = null,
    /** 3rd/4th carriers (FlowStation miura of 04-10-2026 or later); empty when none. */
    @SerialName("extra_carriers") val extraCarriers: List<Int> = emptyList(),
    val path: String = "",
    val service: String = "",
    val message: String? = null,
)

/** One line from the SSE /api/log-stream endpoint (`data: {"line":"..."}`). */
@Serializable
data class LogLine(
    val line: String? = null,
    val error: String? = null,
    val demo: Boolean? = null,
)

/** Updater state, same shape for /api/update/check, /api/bluestation/check, /api/flowstation/check. */
@Serializable
data class UpdateCheck(
    val demo: Boolean = false,
    val dirNotFound: Boolean = false,
    val upToDate: Boolean? = null,
    val switching: Boolean = false,
    val localHash: String = "",
    val remoteHash: String = "",
    val remoteMessage: String = "",
    val remoteDate: String = "",
    val remoteAuthor: String = "",
    val apiError: String? = null,
    val active: String? = null,
    /** /api/flowstation/check?source=miura: the miura FlowStation still has to move to MiuraStation. */
    val needsMigration: Boolean = false,
    /** With needsMigration: "legacy" (miura FlowStation -> MiuraStation) or "source" (compiled MiuraStation -> .deb). */
    val migrationKind: String? = null,
    /** source=miura: MiuraStation installed from its .deb package (localHash is then "v<version>"). */
    val packaged: Boolean = false,
    /** /api/flowstation/check: source the answer is about (razvan | miura). */
    val source: String? = null,
    /** /api/flowstation/check: product name of that source (FlowStation | MiuraStation). */
    val product: String? = null,
    /** source=miura: URL of the remote release on GitHub. */
    val releaseUrl: String? = null,
) {
    /** Same rule as the web's update dot: a newer version of what is installed (not a source switch). */
    val hasUpdate: Boolean get() = !demo && !dirNotFound && upToDate == false && !switching
}

/** One station of GET /api/station/active -> services[name]. */
@Serializable
data class StationService(
    val exists: Boolean = false,
    val active: Boolean = false,
    val enabled: Boolean = false,
    val installed: Boolean = false,
    val dir: String = "",
    val configPath: String = "",
    val service: String = "",
    val product: String = "",
    /** dmr only: the target is up but some core unit (missing) is not. */
    val degraded: Boolean = false,
    val missing: List<String> = emptyList(),
)

/** GET /api/station/active -> dmr: the DMR stack as the selector needs it. */
@Serializable
data class StationDmr(
    val degraded: Boolean = false,
    val missing: List<String> = emptyList(),
    /** SDR_COMPARTIDO applied: the stack runs next to MiuraStation (MIURA+DMR). */
    val shared: Boolean = false,
    /** MIURA+DMR can be chosen (dmr-tier3 0.4.0 + MiuraStation 1.4.0 or later). */
    val sharedAvailable: Boolean = false,
    /** DMR tier applied: 2 = conventional repeater (DMR_TIER=2), 3 = trunking. */
    val tier: Int = 3,
)

/** GET /api/station/active. station/persisted: bluestation | flowstation | miurastation | dmr. */
@Serializable
data class StationActive(
    val station: String = "bluestation",
    val persisted: String = "",
    val services: Map<String, StationService> = emptyMap(),
    /** Unit of the flow-family station in use (flowstation.service | miurastation.service). */
    val flowService: String? = null,
    /** null from a panel without the DMR station. */
    val dmr: StationDmr? = null,
) {
    val current: StationService? get() = services[station]
    /** Unit of the active station (tmo.service for BlueStation): what LOG follows ("dmr" = the stack's journal). */
    val activeService: String
        get() = if (station == "dmr") DMR_LOG_SERVICE
            else current?.service?.ifBlank { null } ?: STATION_DEFAULT_SERVICE[station] ?: "tmo.service"
    val shared: Boolean get() = dmr?.shared == true
    val tier2: Boolean get() = dmr?.tier == 2
    val dmrInstalled: Boolean get() = services["dmr"]?.installed == true
    /** Button of the station in use: MiuraStation with SDR_COMPARTIDO applied is MIURA+DMR. */
    val activeButton: String get() = if (station == "miurastation" && shared) "miuradmr" else station
    /** Short label BLUE / FLOW / MIURA / MIURA+DMR / DMR (with the tier when the DMR is involved). */
    val label: String get() = buttonLabel(activeButton) + when (activeButton) {
        "miuradmr", "dmr" -> if (tier2) " T2" else " T3"
        else -> ""
    }

    /** The button's units are on air: MIURA+DMR only with the stack up too; MIURA and DMR only alone on the SDR. */
    fun onAir(button: String): Boolean = when (button) {
        "miuradmr" -> shared && services["miurastation"]?.active == true && services["dmr"]?.active == true
        "miurastation", "dmr" -> !shared && services[button]?.active == true
        else -> services[button]?.active == true
    }

    companion object {
        val STATION_NAMES = listOf("bluestation", "flowstation", "miurastation")
        /** The selector's buttons: the four stations and MIURA+DMR (MiuraStation with the DMR stack on its SDR). */
        val BUTTONS = listOf("bluestation", "flowstation", "miurastation", "miuradmr", "dmr")
        /** The live log of the DMR station: the journal of its units (/api/log-stream?service=dmr). */
        const val DMR_LOG_SERVICE = "dmr"
        /** dmrtc's own log file (/api/log-stream?file=dmrtc), Tier III only. */
        const val DMRTC_LOG_FILE = "file:dmrtc"
        val STATION_DEFAULT_SERVICE = mapOf(
            "bluestation" to "tmo.service",
            "flowstation" to "flowstation.service",
            "miurastation" to "miurastation.service",
            "dmr" to "dmr-tier3.target",
        )
        fun unitOf(button: String): String = if (button == "miuradmr") "miurastation" else button
        fun stationLabel(name: String): String = buttonLabel(name)
        fun buttonLabel(name: String): String = when (name) {
            "bluestation" -> "BLUE"
            "flowstation" -> "FLOW"
            "miurastation" -> "MIURA"
            "miuradmr" -> "MIURA+DMR"
            "dmr" -> "DMR"
            else -> name.uppercase()
        }
    }
}

/** POST /api/station/switch answer (also on failure: message + log). */
data class StationSwitchResult(
    val ok: Boolean,
    val message: String,
    val station: String? = null,
    val service: String? = null,
    val configPath: String? = null,
    val log: String = "",
)

// --- DMR Tier III / Tier II (dmr-tier3 package: /api/dmr/*) ---

/** The stack's units as the panel sees them (state of /api/dmr/check, /api/dmr/state 503 answers). */
@Serializable
data class DmrStack(
    val installed: Boolean = false,
    val exists: Boolean = false,
    val enabled: Boolean = false,
    val version: String? = null,
    val active: Boolean = false,
    val degraded: Boolean = false,
    val missing: List<String> = emptyList(),
)

@Serializable
data class DmrRelease(
    val tag: String = "",
    val version: String = "",
    val name: String = "",
    val date: String = "",
    val url: String = "",
    val prerelease: Boolean = false,
)

/** GET /api/dmr/check: the installed dmr-tier3 and the highest release of ea5gvk/MiuraStation-dist. */
@Serializable
data class DmrCheck(
    val product: String = "DMR Tier III",
    val repo: String = "",
    val demo: Boolean = false,
    val installed: Boolean = false,
    val version: String? = null,
    val state: DmrStack? = null,
    val configExists: Boolean = false,
    val release: DmrRelease? = null,
    val noReleases: Boolean = false,
    val upToDate: Boolean = false,
    val apiError: String? = null,
) {
    /** Installed and a newer release published (the CTRL badge); never for a stack that is not installed. */
    val hasUpdate: Boolean get() = !demo && installed && release != null && !upToDate
}

/** One key of dmr-tier3.conf in GET /api/dmr/config (order, help and section from the package's example). */
@Serializable
data class DmrConfKey(
    val key: String = "",
    val value: String = "",
    val help: String = "",
    val section: String = "",
    val default: String = "",
    /** Passwords: the value never comes; empty on save = keep the stored one. */
    val secret: Boolean = false,
    /** secret only: a value is stored in the conf. */
    val set: Boolean = false,
    /** The values its help lists as "2 = ..." / "3 = ..." lines (DMR_TIER). */
    val choices: List<String>? = null,
)

@Serializable
data class DmrConfResp(
    val exists: Boolean = false,
    val installed: Boolean = false,
    val active: Boolean = false,
    val degraded: Boolean = false,
    val missing: List<String> = emptyList(),
    val shared: Boolean = false,
    val path: String = "",
    val examplePath: String = "",
    val keys: List<DmrConfKey> = emptyList(),
)

/** POST /api/dmr/config and /api/dmr/regenerate: gen-config.py's errors and log. */
@Serializable
data class DmrOpResult(
    val ok: Boolean = false,
    val errors: List<String> = emptyList(),
    val log: List<String> = emptyList(),
    val applied: Boolean? = null,
)

@Serializable
data class DmrName(val callsign: String = "", val name: String? = null, val city: String? = null, val country: String? = null)

@Serializable
data class DmrSlotCall(
    val src: Long = 0, val dst: Long = 0, val type: String = "", val network: Boolean = false,
    @SerialName("call_time_s") val callTimeS: Double = 0.0,
)

@Serializable
data class DmrSlot(
    val slot: Int = 0, val control: Boolean = false, val enabled: Boolean = true, val busy: Boolean = false,
    /** control | disabled | busy | idle */
    val state: String = "idle", val text: String = "", val call: DmrSlotCall? = null,
)

@Serializable
data class DmrChannel(
    @SerialName("channel_id") val channelId: Int = 0,
    @SerialName("logical_channel") val logicalChannel: Int = 0,
    @SerialName("tx_freq") val txFreq: Long = 0,
    @SerialName("rx_freq") val rxFreq: Long = 0,
    @SerialName("colour_code") val colourCode: Int = 0,
    val control: Boolean = false,
    val slots: List<DmrSlot> = emptyList(),
)

@Serializable
data class DmrRegistered(
    val id: Long = 0,
    val talkgroups: List<Long> = emptyList(),
    val dgna: List<Long> = emptyList(),
    @SerialName("registered_at") val registeredAt: String = "",
    @SerialName("last_seen") val lastSeen: String = "",
)

@Serializable
data class DmrCall(
    @SerialName("channel_id") val channelId: Int = 0, val slot: Int = 0, val index: Int = 0,
    val src: Long = 0, val dst: Long = 0, val type: String = "", val network: Boolean = false,
    @SerialName("call_time_s") val callTimeS: Double = 0.0,
    val rssi: Double = 0.0, val ber: Double = 0.0, @SerialName("max_ber") val maxBer: Double = 0.0,
    val started: String? = null,
)

@Serializable
data class DmrGatewayEntry(@SerialName("gateway_name") val gatewayName: String = "")

@Serializable
data class DmrGateway(
    val enabled: Boolean = false,
    val address: String = "",
    val gateways: List<DmrGatewayEntry> = emptyList(),
    @SerialName("logged_in") val loggedIn: Boolean? = null,
    @SerialName("logged_in_at") val loggedInAt: String? = null,
)

@Serializable
data class DmrControlChannel(@SerialName("channel_id") val channelId: Int = 0, val slot: Int = 0)

@Serializable
data class DmrConfig(
    @SerialName("system_code") val systemCode: Long? = null,
    @SerialName("control_channel") val controlChannel: DmrControlChannel? = null,
    @SerialName("channel_number") val channelNumber: Int? = null,
    @SerialName("registration_required") val registrationRequired: Boolean = false,
    @SerialName("authentication_required") val authenticationRequired: Boolean = false,
    @SerialName("system_announcement_message") val systemAnnouncementMessage: String = "",
    @SerialName("freq_base") val freqBase: Long = 0,
    @SerialName("freq_separation") val freqSeparation: Long = 0,
    @SerialName("freq_duplexsplit") val freqDuplexsplit: Long = 0,
    @SerialName("local_tg_ids") val localTgIds: List<Long> = emptyList(),
)

/** GET /api/dmr/state: dmrtc's /state (Tier III) plus the callsigns the panel's cache knows. */
@Serializable
data class DmrState(
    val version: String = "",
    @SerialName("uptime_s") val uptimeS: Double = 0.0,
    val config: DmrConfig = DmrConfig(),
    val channels: List<DmrChannel> = emptyList(),
    val registered: List<DmrRegistered> = emptyList(),
    @SerialName("subscribed_talkgroups") val subscribedTalkgroups: List<Long> = emptyList(),
    @SerialName("calls_active") val callsActive: List<DmrCall> = emptyList(),
    val gateway: DmrGateway = DmrGateway(),
    /** dmrtc's recent events as they come (heterogeneous: read by type). */
    @SerialName("last_events") val lastEvents: List<kotlinx.serialization.json.JsonObject> = emptyList(),
    val names: Map<String, DmrName> = emptyMap(),
)

/**
 * One poll of /api/dmr/state: [state] when dmrtc answered; otherwise [reason] (stopped | unreachable | tier2 |
 * offline), the panel's [message] and the stack's units.
 */
data class DmrStateResult(
    val state: DmrState? = null,
    val reason: String? = null,
    val message: String? = null,
    val stack: DmrStack? = null,
)

// --- DMR Tier II monitor (GET /api/dmr/tier2/state, server/dmrTier2.ts): MMDVM-Host, DMRGateway and MMDVM-Multi's
// journal. Times are ms of the Pi's clock. ---

@Serializable
data class Tier2Rssi(val min: Double = 0.0, val max: Double = 0.0, val ave: Double = 0.0)

/** One call: a timeslot's on the air or one of the last heard. */
@Serializable
data class Tier2Call(
    val key: String = "",
    val slot: Int = 0,
    /** rf | net */
    val src: String = "rf",
    /** voice | data */
    val kind: String = "voice",
    /** As MMDVM-Host logs it: the callsign of DMRIds.dat, else the number. */
    val from: String = "",
    @SerialName("from_id") val fromId: Long? = null,
    /** The TG or radio ("ALL" = 16777215). */
    val to: String = "",
    @SerialName("to_id") val toId: Long? = null,
    val group: Boolean = false,
    /** The DMRGateway network of a network call (NET_ROUTES / NETn_ROUTES). */
    val net: String? = null,
    val start: Long = 0,
    val end: Long? = null,
    val dur: Double? = null,
    val ber: Double? = null,
    val loss: Double? = null,
    val rssi: Tier2Rssi? = null,
    /** end | lost | watchdog | timeout | restart; null while on the air. */
    @SerialName("end_kind") val endKind: String? = null,
    val blocks: Int? = null,
    /** Talker Alias. */
    val ta: String? = null,
    val late: Boolean = false,
)

@Serializable
data class Tier2Net(
    val n: Int = 0,
    val name: String = "",
    val address: String? = null,
    val port: Int? = null,
    val routes: String? = null,
    val enabled: Boolean = false,
    /** up | down | connecting | unknown | off */
    val status: String = "unknown",
    val since: Long? = null,
    val reason: String? = null,
)

/** The MiuraStation DMR window (shared SDR): MMDVM-Multi's attach line and its minute stats. */
@Serializable
data class Tier2Window(
    val attached: Boolean = false,
    @SerialName("sdr_rate") val sdrRate: Double? = null,
    @SerialName("rx_hz") val rxHz: Double? = null,
    @SerialName("tx_hz") val txHz: Double? = null,
    @SerialName("tx_gain") val txGain: Double? = null,
    @SerialName("rx_lost") val rxLost: Int? = null,
    @SerialName("tx_late") val txLate: Int? = null,
    @SerialName("min_margin_ms") val minMarginMs: Double? = null,
    val at: Long? = null,
)

@Serializable
data class Tier2Alert(
    val ts: Long = 0,
    /** info | warn | error */
    val level: String = "info",
    val text: String = "",
)

/** MMDVM-Host-1.ini and dmr-tier3.conf. */
@Serializable
data class Tier2Station(
    val callsign: String? = null,
    val id: Long? = null,
    @SerialName("rx_hz") val rxHz: Long? = null,
    @SerialName("tx_hz") val txHz: Long? = null,
    @SerialName("color_code") val colorCode: Int? = null,
    @SerialName("timeout_s") val timeoutS: Int? = null,
    val shared: Boolean = false,
    /** With 0, or 3 or more, MMDVM-Host no longer logs the calls. */
    @SerialName("display_level") val displayLevel: Int? = null,
)

@Serializable
data class Tier2Modem(val tx: Boolean = false, val mode: String? = null, val since: Long? = null)

@Serializable
data class Tier2Slots(
    @SerialName("1") val ts1: Tier2Call? = null,
    @SerialName("2") val ts2: Tier2Call? = null,
)

@Serializable
data class Tier2State(
    val ok: Boolean = false,
    val demo: Boolean = false,
    /** The Pi's clock when it answered. */
    val now: Long = 0,
    val stack: DmrStack = DmrStack(),
    val station: Tier2Station = Tier2Station(),
    val slots: Tier2Slots = Tier2Slots(),
    /** The last 100 calls, most recent first. */
    val heard: List<Tier2Call> = emptyList(),
    val nets: List<Tier2Net> = emptyList(),
    val modem: Tier2Modem = Tier2Modem(),
    /** Only with the SDR shared with MiuraStation. */
    val window: Tier2Window? = null,
    val alerts: List<Tier2Alert> = emptyList(),
    val names: Map<String, DmrName> = emptyMap(),
)

/**
 * One poll of /api/dmr/tier2/state: [state], or [reason]: tier3 | stopped | not_installed (the panel's 503),
 * unsupported (a panel without the monitor), offline (no connection) or error.
 */
data class Tier2Result(
    val state: Tier2State? = null,
    val reason: String? = null,
    val message: String? = null,
    val stack: DmrStack? = null,
)

/** GET /api/flowstation/dashboard-status: the station's own web dashboard ([dashboard] in config.toml). */
@Serializable
data class FlowDashboardStatus(
    val enabled: Boolean = false,
    val port: Int = 0,
    val flowstationActive: Boolean = false,
    val product: String = "",
    val configPath: String = "",
    val service: String = "",
)

/** GET /api/talkgroups?source=bm|adn -> gssi (as string) -> name. */
@Serializable
data class TalkgroupNames(
    val source: String = "",
    val data: Map<String, String> = emptyMap(),
    val cached: Boolean = false,
    val count: Int = 0,
)

/** Sequential DGNA over several radios: how many the server accepted, and the failures ("ISSI: message"). */
data class DgnaBulkResult(val ok: Int, val total: Int, val errors: List<String> = emptyList())

// --- VPN WireGuard (/api/vpn/*) ---

@Serializable
data class WgPeer(
    val publicKey: String = "",
    val endpoint: String? = null,
    val allowedIps: String = "",
    val latestHandshake: String? = null,
    val transfer: String? = null,
)

@Serializable
data class WgInfo(
    @SerialName("interface") val iface: String = "",
    val listenPort: Int? = null,
    val publicKey: String = "",
    val peers: List<WgPeer> = emptyList(),
)

@Serializable
data class VpnStatus(
    val installed: Boolean = false,
    val active: Boolean = false,
    val wgInfo: WgInfo? = null,
    val configured: Boolean = false,
    val serverPublicKey: String? = null,
    val serverAddress: String? = null,
    val serverPort: Int? = null,
    val clientDns: String? = null,
)

@Serializable
data class VpnClient(
    val name: String = "",
    val address: String = "",
    val publicKey: String = "",
    val createdAt: String = "",
)

// --- WiFi of the Pi (/api/wifi/*) ---

@Serializable
data class WifiStatus(
    val connected: Boolean = false,
    val demo: Boolean = false,
    val ssid: String = "",
    val signal: Int = 0,
    val security: String = "",
    @SerialName("interface") val iface: String = "",
    val ip: String = "",
)

@Serializable
data class WifiNetwork(
    val active: Boolean = false,
    val ssid: String = "",
    val signal: Int = 0,
    val security: String = "",
    val freq: String = "",
)

@Serializable
data class WifiSaved(val name: String = "", val type: String = "")

/** A talkgroup saved in the DGNA library for quick re-assignment. */
@Serializable
data class TgEntry(
    val gssi: Int,
    val mnemonic: String = "",
    val attachMode: Int = 0,
)

@Serializable
data class StatusPayload(val mode: String = "unknown")

@Serializable
data class DgnaLogWrapper(val log: List<DgnaLogEntry> = emptyList())

@Serializable
data class EmergencyWrapper(val emergencies: List<EmergencyEntry> = emptyList())

@Serializable
data class DashboardStatusPayload(val active: Boolean = false)

@Serializable
data class CallEndedPayload(val callId: Int = 0)

/** Immutable snapshot of everything the UI observes. */
data class TetraState(
    val terminals: Map<String, Terminal> = emptyMap(),
    val localHistory: List<CallLogEntry> = emptyList(),
    val externalHistory: List<CallLogEntry> = emptyList(),
    val emergencies: List<EmergencyEntry> = emptyList(),
    val brewStatus: BrewStatus? = null,
    val fsDashboardActive: Boolean = false,
    val rfCalls: List<RfCall> = emptyList(),
    val dgnaLog: List<DgnaLogEntry> = emptyList(),
    val gpsPositions: Map<String, GpsPosition> = emptyMap(),
    val gpsHistory: Map<String, List<GpsPosition>> = emptyMap(),
    val tsVoiceActivity: Map<String, Long> = emptyMap(),
    /** ISSI last heard on the uplink of "$carrier:$ts" ("single:$ts" without carrier); null if unknown. */
    val tsVoiceSpeaker: Map<String, Int?> = emptyMap(),
    /** PDCH (WAP / packet data) slots in use. */
    val pdchSlots: List<RfPdch> = emptyList(),
    /** Last data ping (epoch ms) per "$carrier:$ts" ("single:$ts" without carrier). */
    val tsDataActivity: Map<String, Long> = emptyMap(),
    /** Carriers on demand: carrier number (as string) -> "off" | "warming" | "on". Empty when unused. */
    val carrierAir: Map<String, String> = emptyMap(),
    val lastHeard: List<LastHeardEntry> = emptyList(),
    val txQuality: TxQuality? = null,
    val health: HealthSnapshot? = null,
    val sdrHealth: SdrHealth? = null,
    val sysHealth: SysHealth? = null,
    val sdsMessages: List<SdsMessage> = emptyList(),
    val mode: String = "connecting",
    val connected: Boolean = false,

    // --- Polled over REST by TetraClient (not from the WebSocket) ---
    /** GET /api/btsinfo every 30 s: the one shared poll for every panel. */
    val btsInfo: BtsInfo? = null,
    /** GET /api/station/active every 30 s. */
    val station: StationActive? = null,
    /** Updater checks at connect and every hour, keyed "bluestation", "flowstation", "dashboard". */
    val updateChecks: Map<String, UpdateCheck> = emptyMap(),
    /** GET /api/dmr/check with the other updater checks (null: no answer or a panel without DMR). */
    val dmrCheck: DmrCheck? = null,
    /** Saved system password checked with /api/system/verify-password: null unknown/none, true ok, false wrong. */
    val passwordOk: Boolean? = null,

    // --- Local names (DataStore), pushed in by MainActivity ---
    /** GSSI -> name: DGNA library mnemonics over the BM/ADN names (tg_names). */
    val tgNames: Map<Int, String> = emptyMap(),
    /** ISSI (as string) -> the user's own name (issi_names). */
    val issiNames: Map<String, String> = emptyMap(),
) {
    /** Some updater has a newer version (badge on CTRL). */
    val updateAvailable: Boolean get() = updateChecks.values.any { it.hasUpdate } || dmrCheck?.hasUpdate == true
    val txCount: Int get() = terminals.values.count { it.activity == "TX" }
    val rxCount: Int get() = terminals.values.count { it.activity == "RX" }
    fun tgName(gssi: Int): String? = tgNames[gssi]
    /** Callsign of the terminal, else the user's own name for that ISSI, else null. */
    fun callsignOf(issi: Int): String? = callsignOf(issi.toString())
    fun callsignOf(issi: String): String? =
        terminals[issi]?.callsign?.ifBlank { null } ?: issiNames[issi]?.ifBlank { null }
}
