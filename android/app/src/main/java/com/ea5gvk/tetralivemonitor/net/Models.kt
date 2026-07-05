package com.ea5gvk.tetralivemonitor.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

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
    val direction: String = "incoming",
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
)

@Serializable
data class TsVoicePayload(val ts: Int = 0, val carrier: Int? = null)

/** BTS carrier configuration from GET /api/btsinfo. */
@Serializable
data class BtsCarrier(@SerialName("carrier_num") val carrierNum: Int? = null)

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
    val sdsMessages: List<SdsMessage> = emptyList(),
    val mode: String = "connecting",
    val connected: Boolean = false,
)
