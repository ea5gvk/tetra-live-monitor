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
)

/** GET /api/station/active. station/persisted: bluestation | flowstation | miurastation. */
@Serializable
data class StationActive(
    val station: String = "bluestation",
    val persisted: String = "",
    val services: Map<String, StationService> = emptyMap(),
    /** Unit of the flow-family station in use (flowstation.service | miurastation.service). */
    val flowService: String? = null,
) {
    val current: StationService? get() = services[station]
    /** Unit of the active station (tmo.service for BlueStation): what LOG follows. */
    val activeService: String
        get() = current?.service?.ifBlank { null } ?: STATION_DEFAULT_SERVICE[station] ?: "tmo.service"
    /** Short label BLUE / FLOW / MIURA. */
    val label: String get() = stationLabel(station)

    companion object {
        val STATION_NAMES = listOf("bluestation", "flowstation", "miurastation")
        val STATION_DEFAULT_SERVICE = mapOf(
            "bluestation" to "tmo.service",
            "flowstation" to "flowstation.service",
            "miurastation" to "miurastation.service",
        )
        fun stationLabel(name: String): String = when (name) {
            "bluestation" -> "BLUE"
            "flowstation" -> "FLOW"
            "miurastation" -> "MIURA"
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
    /** Saved system password checked with /api/system/verify-password: null unknown/none, true ok, false wrong. */
    val passwordOk: Boolean? = null,

    // --- Local names (DataStore), pushed in by MainActivity ---
    /** GSSI -> name: DGNA library mnemonics over the BM/ADN names (tg_names). */
    val tgNames: Map<Int, String> = emptyMap(),
    /** ISSI (as string) -> the user's own name (issi_names). */
    val issiNames: Map<String, String> = emptyMap(),
) {
    /** Some updater has a newer version (badge on CTRL). */
    val updateAvailable: Boolean get() = updateChecks.values.any { it.hasUpdate }
    val txCount: Int get() = terminals.values.count { it.activity == "TX" }
    val rxCount: Int get() = terminals.values.count { it.activity == "RX" }
    fun tgName(gssi: Int): String? = tgNames[gssi]
    /** Callsign of the terminal, else the user's own name for that ISSI, else null. */
    fun callsignOf(issi: Int): String? = callsignOf(issi.toString())
    fun callsignOf(issi: String): String? =
        terminals[issi]?.callsign?.ifBlank { null } ?: issiNames[issi]?.ifBlank { null }
}
