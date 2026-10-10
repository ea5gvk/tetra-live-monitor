package com.ea5gvk.tetralivemonitor.ui.screens

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.data.Settings
import com.ea5gvk.tetralivemonitor.net.BtsInfo
import com.ea5gvk.tetralivemonitor.net.CallLogEntry
import com.ea5gvk.tetralivemonitor.net.HealthSnapshot
import com.ea5gvk.tetralivemonitor.net.LastHeardEntry
import com.ea5gvk.tetralivemonitor.net.RfCall
import com.ea5gvk.tetralivemonitor.net.SdrHealth
import com.ea5gvk.tetralivemonitor.net.SdsMessage
import com.ea5gvk.tetralivemonitor.net.SysHealth
import com.ea5gvk.tetralivemonitor.net.SystemStats
import com.ea5gvk.tetralivemonitor.net.Terminal
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.TetraState
import com.ea5gvk.tetralivemonitor.net.TgEntry
import com.ea5gvk.tetralivemonitor.net.TxQuality
import com.ea5gvk.tetralivemonitor.ui.StatusDot
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.OnBg
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.SurfaceHi
import com.ea5gvk.tetralivemonitor.ui.theme.Warn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.floor
import kotlin.math.sin

/** Packet data (PDCH / WAP) teal, as the station's own panel. */
private val Teal = Color(0xFF2DD4BF)
private val Violet = Color(0xFFA78BFA)

/** "TG 214 · Spain" from "TG 214" / "214" (name from the DGNA library or BM/ADN); anything else as is. */
private fun TetraState.tgText(raw: String): String {
    val num = raw.removePrefix("TG").trim().toIntOrNull() ?: return raw
    return "TG $num" + (tgName(num)?.let { " · $it" } ?: "")
}

/** "214 · Spain" or "214". */
private fun TetraState.gssiText(gssi: Int): String = "$gssi" + (tgName(gssi)?.let { " · $it" } ?: "")

/** "1001 | EA5GVK" or "1001"; empty for 0 / null. */
private fun TetraState.issiText(issi: Int?): String {
    if (issi == null || issi == 0) return ""
    return callsignOf(issi)?.let { "$issi | $it" } ?: "$issi"
}

@Composable
fun MonitorScreen(state: TetraState, base: String?, password: String) {
    val all = state.terminals.values
    val locals = all.filter { it.isLocal }.sortedWith(
        compareByDescending<Terminal> { it.status == "Online" }.thenBy { it.id }
    )
    val externals = all.filter { !it.isLocal }.sortedBy { it.id }
    val online = locals.count { it.status == "Online" }
    val calls = (state.localHistory + state.externalHistory).sortedByDescending { it.timestamp }

    var stats by remember { mutableStateOf<SystemStats?>(null) }
    LaunchedEffect(base) {
        while (base != null) {
            stats = TetraApi.getStats(base)
            delay(5000)
        }
    }

    // Quick-action dialogs launched from a terminal row.
    var sdsFor by remember { mutableStateOf<String?>(null) }
    var dgnaFor by remember { mutableStateOf<String?>(null) }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    StatChip("LOCALES", "${locals.size}", Cyan, Modifier.weight(1f))
                    StatChip("ONLINE", "$online", Ok, Modifier.weight(1f))
                    StatChip("EXTERNOS", "${externals.size}", Muted, Modifier.weight(1f))
                    StatChip("RF", "${state.rfCalls.size}", Warn, Modifier.weight(1f))
                    StatChip("TX", "${state.txCount}", Danger, Modifier.weight(1f))
                    StatChip("RX", "${state.rxCount}", Cyan, Modifier.weight(1f))
                }
            }

            item { HealthPanel(stats, state) }

            item { BtsDetailsPanel(state.btsInfo) }

            state.txQuality?.let { q -> item { TxQualityCard(q) } }

            item { RfTimeslots(state) }

            if (state.emergencies.isNotEmpty()) {
                item {
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                            .background(Color(0x22EF4444)).border(1.dp, Danger, RoundedCornerShape(10.dp)).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text("⚠ EMERGENCIA", color = Danger, fontWeight = FontWeight.Black, fontSize = 13.sp)
                        state.emergencies.forEach { e ->
                            Text("${state.callsignOf(e.issi)?.let { "$it · " } ?: ""}ISSI ${e.issi} → ${e.destSsi}  (${e.startedSecsAgo}s)",
                                color = OnBg, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                        }
                    }
                }
            }

            item { SectionHeader("EQUIPOS LOCALES (${locals.size})") }
            if (locals.isEmpty()) {
                item { EmptyHint("Sin equipos locales. Comprueba la conexión en Ajustes.") }
            } else {
                items(locals, key = { it.id }) {
                    LocalTerminalCard(it, state, onSds = { sdsFor = it.id }, onDgna = { dgnaFor = it.id })
                }
            }

            if (externals.isNotEmpty()) {
                item { SectionHeader("EXTERNOS (${externals.size})") }
                items(externals, key = { it.id }) { ExternalRow(it, state) }
            }

            if (state.lastHeard.isNotEmpty()) {
                item { LastHeardSection(state) }
            }

            item { SectionHeader("LLAMADAS RECIENTES (${calls.size})") }
            if (calls.isEmpty()) {
                item { EmptyHint("Sin actividad reciente.") }
            } else {
                items(calls.take(30), key = { it.id }) { CallRow(it, state) }
            }

            item { SectionHeader("MENSAJES SDS (${state.sdsMessages.size})") }
            if (state.sdsMessages.isEmpty()) {
                item { EmptyHint("Sin mensajes SDS.") }
            } else {
                items(state.sdsMessages.take(30), key = { it.id }) { SdsRow(it) }
            }
        }
    }

    sdsFor?.let { issi ->
        SdsDialog(issi, base, password, onClose = { sdsFor = null })
    }
    dgnaFor?.let { issi ->
        DgnaDialog(issi, base, password, onClose = { dgnaFor = null })
    }
}

// ─── Pi health panel ────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HealthPanel(stats: SystemStats?, state: TetraState) {
    val brewOn = state.brewStatus?.connected == true
    val brewVersion = state.brewStatus?.version
    val health = state.health
    val sdrTemp = state.sdrHealth?.temperatureC
    val power = state.sysHealth?.totalPowerW
    var showHealth by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("ESTADO DE LA RASPBERRY PI", color = Muted, fontWeight = FontWeight.Black, fontSize = 10.sp, letterSpacing = 1.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            val temp = stats?.cpuTemp
            HealthChip("TEMP", temp?.let { "${it}°" } ?: "—",
                colorForTemp(temp), Modifier.weight(1f))
            val cpu = stats?.cpuLoad
            HealthChip("CPU", cpu?.let { "$it%" } ?: "—", colorForPct(cpu), Modifier.weight(1f))
            val ram = stats?.memUsed
            HealthChip("RAM", ram?.let { "$it%" } ?: "—", colorForPct(ram), Modifier.weight(1f))
            val v = stats?.voltage
            HealthChip("VOLT", v?.let { "${"%.2f".format(it)}V" } ?: "—", colorForVolt(v), Modifier.weight(1f))
        }
        // Station side (fs_health / fs_sdr_health / fs_sys_health): tap the health chip for the details.
        if (health != null || sdrTemp != null || power != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                HealthChip(
                    if (health != null) "SALUD ESTACIÓN ▸" else "SALUD ESTACIÓN",
                    health?.let { healthLabel(it.overall) } ?: "—", healthColor(health?.overall),
                    Modifier.weight(2f).clip(RoundedCornerShape(8.dp)).clickable(enabled = health != null) { showHealth = true },
                )
                HealthChip("TEMP. SDR", sdrTemp?.let { "%.1f°".format(Locale.US, it) } ?: "—",
                    if (sdrTemp != null) Cyan else Muted, Modifier.weight(1f))
                HealthChip("POTENCIA", power?.let { "%.1f W".format(Locale.US, it) } ?: "—",
                    if (power != null) Cyan else Muted, Modifier.weight(1f))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusDot(if (brewOn) Ok else Danger, 9)
            Text(
                if (brewOn) "Brew conectado" + (brewVersion?.let { " (v$it)" } ?: "") else "Brew desconectado",
                color = if (brewOn) Ok else Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold,
            )
        }
        // Local IP and mDNS name; the public IP only once the saved system password is accepted.
        val ip = stats?.localIp?.takeIf { it.isNotBlank() }
        val host = stats?.hostname?.takeIf { it.isNotBlank() }
        val publicIp = stats?.publicIp?.takeIf { it.isNotBlank() && state.passwordOk == true }
        if (ip != null || host != null || publicIp != null) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                ip?.let { Text("IP $it", color = Cyan, fontSize = 10.sp, fontFamily = FontFamily.Monospace) }
                host?.let { Text("@$it.local", color = Warn, fontSize = 10.sp, fontFamily = FontFamily.Monospace) }
                publicIp?.let { Text("Pública $it", color = Violet, fontSize = 10.sp, fontFamily = FontFamily.Monospace) }
            }
        }
    }

    if (showHealth && health != null) {
        StationHealthDialog(health, state.sdrHealth, state.sysHealth) { showHealth = false }
    }
}

private fun healthColor(level: String?): Color = when (level) {
    "ok" -> Ok
    "degraded" -> Warn
    "critical" -> Danger
    else -> Muted
}

/** Overall station level (feminine: "la estación"). */
private fun healthLabel(level: String): String = when (level) {
    "ok" -> "OK"
    "degraded" -> "DEGRADADA"
    "critical" -> "CRÍTICA"
    else -> level.uppercase()
}

/** Level of one domain. */
private fun domainLabel(level: String): String = when (level) {
    "ok" -> "OK"
    "degraded" -> "DEGRADADO"
    "critical" -> "CRÍTICO"
    else -> level.uppercase()
}

private fun formatUptime(secs: Long): String {
    val d = secs / 86400
    val h = (secs % 86400) / 3600
    val m = (secs % 3600) / 60
    return when {
        d > 0 -> "${d}d ${h}h ${m}m"
        h > 0 -> "${h}h ${m}m"
        else -> "${m}m ${secs % 60}s"
    }
}

@Composable
private fun StationHealthDialog(h: HealthSnapshot, sdr: SdrHealth?, sys: SysHealth?, onClose: () -> Unit) {
    @Composable
    fun info(label: String, value: String) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, color = Muted, fontSize = 11.sp, modifier = Modifier.width(110.dp))
            Text(value, color = OnBg, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
        }
    }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Surface,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusDot(healthColor(h.overall), 10)
                Text("Estación · ${healthLabel(h.overall)}", color = healthColor(h.overall), fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (h.domains.isEmpty()) Text("Sin dominios informados.", color = Muted, fontSize = 11.sp)
                h.domains.forEach { d ->
                    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.padding(top = 4.dp)) { StatusDot(healthColor(d.level), 8) }
                        Column {
                            Text("${d.domain} · ${domainLabel(d.level)}", color = OnBg, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            d.detail?.takeIf { it.isNotBlank() }?.let { Text(it, color = Muted, fontSize = 11.sp) }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                sdr?.temperatureC?.let { info("Temperatura SDR", "%.1f °C".format(Locale.US, it)) }
                sys?.totalPowerW?.let { info("Potencia total", "%.1f W".format(Locale.US, it)) }
                h.lastAction?.takeIf { it.isNotBlank() }?.let { info("Última acción", it) }
                h.uptimeSecs?.let { info("En marcha", formatUptime(it)) }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Cerrar", color = Muted) } },
    )
}

private fun colorForTemp(t: Double?): Color = when {
    t == null -> Muted
    t < 60 -> Ok
    t < 75 -> Warn
    else -> Danger
}

private fun colorForPct(p: Int?): Color = when {
    p == null -> Muted
    p < 70 -> Ok
    p < 90 -> Warn
    else -> Danger
}

private fun colorForVolt(v: Double?): Color = when {
    v == null -> Muted
    v < 4.75 -> Danger
    v < 4.9 -> Warn
    else -> Ok
}

@Composable
private fun HealthChip(label: String, value: String, accent: Color, modifier: Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(8.dp)).background(SurfaceHi).border(1.dp, accent.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
            .padding(vertical = 8.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = accent, fontWeight = FontWeight.Black, fontSize = 15.sp)
        Text(label, color = Muted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
    }
}

// ─── BTS TETRA details ──────────────────────────────────────────────────────

@Composable
private fun BtsDetailsPanel(info: BtsInfo?) {
    fun mhz(hz: Long?): String = if (hz != null) "%.4f MHz".format(java.util.Locale.US, hz / 1_000_000.0) else "—"
    val shift = info?.shiftHz?.let {
        "${if (it >= 0) "+" else ""}${"%.3f".format(java.util.Locale.US, it / 1_000_000.0)} MHz"
    } ?: "—"
    val n = info?.neighborCount ?: 0
    val restricted = info?.whitelistRestricted == true

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("DETALLES BTS TETRA", color = Cyan, fontWeight = FontWeight.Black, fontSize = 10.sp, letterSpacing = 1.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip("Vecina · ${if (n > 0) "ON ($n)" else "OFF"}", if (n > 0) Ok else Muted)
            Chip("HangTime · ${info?.hangtimeSecs ?: "—"}s", Cyan)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            BtsTile("FREC. TX", mhz(info?.txFreqHz), Ok, Modifier.weight(1f))
            BtsTile("FREC. RX", mhz(info?.rxFreqHz), Cyan, Modifier.weight(1f))
            BtsTile("DÚPLEX", shift, OnBg, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            BtsTile("MCC", info?.mcc?.toString() ?: "—", OnBg, Modifier.weight(1f))
            BtsTile("MNC", info?.mnc?.toString() ?: "—", OnBg, Modifier.weight(1f))
            BtsTile("PORTADORA", info?.mainCarrier?.toString() ?: "—", Warn, Modifier.weight(1f))
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi)
                .border(1.dp, (if (restricted) Warn else Ok).copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StatusDot(if (restricted) Warn else Ok, 9)
            Text(
                if (restricted) "Acceso restringido · ${info?.whitelistCount ?: 0} ISSI en lista blanca"
                else "Acceso de registro abierto",
                color = OnBg, fontSize = 11.sp, modifier = Modifier.weight(1f),
            )
            Text(if (restricted) "RESTRINGIDO" else "ABIERTO",
                color = if (restricted) Warn else Ok, fontSize = 10.sp, fontWeight = FontWeight.Black)
        }
    }
}

@Composable
private fun BtsTile(label: String, value: String, accent: Color, modifier: Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(vertical = 7.dp, horizontal = 6.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, color = Muted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
        Text(value, color = accent, fontSize = 12.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace, maxLines = 1)
    }
}

@Composable
private fun Chip(text: String, color: Color) {
    Text(
        text, color = color, fontSize = 9.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.4f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

// ─── TX quality (fs_tx_quality) ─────────────────────────────────────────────

@Composable
private fun TxQualityCard(q: TxQuality) {
    var open by rememberSaveable { mutableStateOf(false) }
    fun f(v: Double?, decimals: Int, unit: String = ""): String =
        v?.let { "%.${decimals}f".format(Locale.US, it) + unit } ?: "—"
    val evm = q.evmPct
    val evmColor = when {
        evm == null -> OnBg
        evm < 5 -> Ok
        evm < 10 -> Warn
        else -> Danger
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("CALIDAD TX", color = Warn, fontWeight = FontWeight.Black, fontSize = 10.sp, letterSpacing = 1.sp)
            Text("EVM ${f(evm, 2, "%")}", color = evmColor, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace)
            Spacer(Modifier.weight(1f))
            Text(if (open) "▾" else "▸", color = Muted, fontSize = 13.sp)
        }
        if (open) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                BtsTile("EVM", f(evm, 2, "%"), evmColor, Modifier.weight(1f))
                BtsTile("PAPR", f(q.paprDb, 2, " dB"), OnBg, Modifier.weight(1f))
                BtsTile("ANCHO OCUP.", q.occupiedBandwidthHz?.let { "%.1f kHz".format(Locale.US, it / 1000) } ?: "—",
                    OnBg, Modifier.weight(1f))
                BtsTile("FUGA PORT.", f(q.carrierLeakageDb, 1, " dB"), OnBg, Modifier.weight(1f))
            }
            Text(
                "IQ amp ${f(q.iqAmplitudeImbalanceDb, 2, " dB")} · IQ fase ${f(q.iqPhaseImbalanceDeg, 2, "°")} · " +
                    "DC I ${f(q.dcOffsetI, 3)} · DC Q ${f(q.dcOffsetQ, 3)}",
                color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace,
            )
        }
    }
}

// ─── RF carriers / timeslots ────────────────────────────────────────────────

/**
 * One timeslot cell. mode: mcch | call | voice | data | idle. who: second line of a private call
 * ("TX LLAMANTE 1001 | EA5GVK"). live: uplink voice / packet data heard in the last 2 s.
 */
private data class Slot(
    val ts: Int,
    val mode: String,
    val label: String,
    val sub: String,
    val who: String? = null,
    val timer: String? = null,
    val durFrac: Float = 0f,
    val emergency: Boolean = false,
    val encrypted: Boolean? = null,
    val wave: List<Int> = IDLE_WAVE,
    val live: Boolean = false,
)
private data class Placement(val call: RfCall, val role: String)
private data class CarrierRow(
    val carrier: Int?,
    val main: Boolean,
    val txHz: Long?,
    val rxHz: Long?,
    val air: String?,
    val slots: List<Slot>,
)

private val IDLE_WAVE = listOf(3, 3, 3, 3, 3)
private val DATA_IDLE_WAVE = listOf(4, 5, 4, 6, 4)
/** A slot stays voice / data this long after the last rf_ts_voice / rf_ts_data. */
private const val TS_ACTIVITY_MS = 2000L
/** The thin bar at the bottom of a cell fills up in 2 minutes. */
private const val CALL_BAR_MS = 120_000.0

/** Deterministic bar heights (4..13 dp): every new voice / data ping reshuffles them. */
private fun waveHeights(seed: Long): List<Int> = List(5) { i ->
    val x = sin(seed * 0.001 + (i + 1) * 12.9898) * 43758.5453
    4 + floor((x - floor(x)) * 10).toInt()
}

// Tiempo de conversación estilo razvan: "7s" bajo un minuto, "1m05s" a partir de ahí.
private fun formatDur(secs: Long): String {
    val s = if (secs < 0) 0 else secs
    return if (s < 60) "${s}s" else "${s / 60}m${(s % 60).toString().padStart(2, '0')}s"
}

private fun roleSub(role: String): String = when (role) {
    "caller" -> "SLOT LLAMANTE"
    "called" -> "SLOT LLAMADO"
    "shared" -> "SLOT COMPARTIDO"
    else -> "P2P"
}

/**
 * Same panel as the web's RfChannelTimeslots: one row per carrier ("RF #n · MAIN", DL/UL), the
 * carrier-on-demand mark, TS1 = MCCH on the main carrier / BCCH on the others, amber while a call
 * is allocated, red while a local radio is keyed up, teal for a packet-data channel (PDCH / WAP).
 */
@Composable
private fun RfTimeslots(state: TetraState) {
    val bts = state.btsInfo
    val wall = System.currentTimeMillis()
    val busy = state.rfCalls.isNotEmpty() || state.pdchSlots.isNotEmpty() ||
        state.tsVoiceActivity.values.any { wall - it < 2 * TS_ACTIVITY_MS } ||
        state.tsDataActivity.values.any { wall - it < 2 * TS_ACTIVITY_MS }
    var now by remember { mutableLongStateOf(wall) }
    LaunchedEffect(busy) {
        while (true) { now = System.currentTimeMillis(); delay(if (busy) 250 else 1000) }
    }
    val mcchWave = remember { waveHeights(System.currentTimeMillis()) }

    // Configured carriers with their DL/UL frequencies (from /api/btsinfo).
    val mainCarrier = bts?.mainCarrier
    val freqs = LinkedHashMap<Int, Pair<Long?, Long?>>()
    bts?.carriers?.forEach { c -> c.carrierNum?.let { freqs[it] = c.txFreqHz to c.rxFreqHz } }
    if (freqs.isEmpty() && mainCarrier != null) freqs[mainCarrier] = bts?.txFreqHz to bts?.rxFreqHz
    if (bts?.dualCarrierActive == true) bts?.secondaryCarrier?.let { if (it !in freqs) freqs[it] = null to null }

    // Calls keyed by carrier + ts; a duplex private call takes two slots (caller + called).
    val byCarrier = HashMap<String, HashMap<Int, Placement>>()
    fun place(carrier: Int?, ts: Int?, call: RfCall, role: String) {
        if (ts == null || ts < 1 || ts > 4) return
        val m = byCarrier.getOrPut(carrier?.toString() ?: "single") { HashMap() }
        if (!m.containsKey(ts)) m[ts] = Placement(call, role)
    }
    state.rfCalls.forEach { c ->
        val individual = c.callType == "individual"
        val hasPeer = c.peerCarrier != null || c.peerTs != null
        if (individual && hasPeer && c.simplex != true) {
            place(c.carrier, c.ts.toInt(), c, "caller")
            place(c.peerCarrier ?: c.carrier, c.peerTs ?: c.ts.toInt(), c, "called")
        } else {
            place(c.carrier, c.ts.toInt(), c, if (individual) "shared" else "group")
        }
    }

    // Carriers to draw: configured ones plus any seen on a call or a PDCH, ascending.
    val carrierSet = sortedSetOf<Int>().apply {
        addAll(freqs.keys)
        state.rfCalls.forEach { c -> c.carrier?.let { add(it) } }
        state.pdchSlots.forEach { p -> p.carrier?.let { add(it) } }
        mainCarrier?.let { add(it) }
    }
    val carriers: List<Int?> = if (carrierSet.isEmpty()) listOf(null) else carrierSet.toList()
    // Main carrier unknown (no btsinfo yet): the first carrier hosts the MCCH.
    fun isMain(n: Int?): Boolean = n == null || (if (mainCarrier == null) n == carriers.first() else n == mainCarrier)

    // Uplink voice keyed "$carrier:$ts"; carrier-less pings ("single:$ts") belong to the main carrier.
    fun recentVoice(carrier: Int?, ts: Int, main: Boolean): Pair<String, Long>? {
        val keys = buildList {
            if (carrier != null) add("$carrier:$ts")
            if (main) add("single:$ts")
        }
        var best: Pair<String, Long>? = null
        for (k in keys) {
            val at = state.tsVoiceActivity[k] ?: continue
            if (best == null || at > best.second) best = k to at
        }
        return best?.takeIf { now - it.second < TS_ACTIVITY_MS }
    }
    fun pdchAt(carrier: Int?, ts: Int, main: Boolean) = state.pdchSlots.firstOrNull { p ->
        p.ts == ts && (carrier == null || p.carrier == carrier || (p.carrier == null && main))
    }
    fun recentData(carrier: Int?, ts: Int, main: Boolean): Long? {
        var at: Long? = null
        state.tsDataActivity.forEach { (k, v) ->
            val kc = k.substringBefore(':')
            if (k.substringAfter(':').toIntOrNull() != ts) return@forEach
            if (carrier == null || kc == carrier.toString() || (kc == "single" && main)) at = maxOf(at ?: 0L, v)
        }
        return at?.takeIf { now - it < TS_ACTIVITY_MS }
    }
    fun fraction(elapsedMs: Long): Float = (elapsedMs / CALL_BAR_MS).toFloat().coerceIn(0f, 1f)

    fun slot(carrier: Int?, ts: Int, byTs: Map<Int, Placement>, main: Boolean): Slot {
        // The main carrier's TS1 is the MCCH and never carries an assigned call.
        if (main && ts == 1) return Slot(1, "mcch", "MCCH", "control", wave = mcchWave)
        val voice = recentVoice(carrier, ts, main)
        val p = byTs[ts]
        if (p != null) {
            val c = p.call
            val elapsed = c.startedAt?.let { (now - it).coerceAtLeast(0) } ?: 0L
            val timer = if (c.startedAt != null && elapsed >= 1000) formatDur(elapsed / 1000) else null
            val dur = if (c.startedAt != null) fraction(elapsed) else 0f
            val emergency = (c.priority ?: 0) >= 15
            val mode = if (voice != null) "voice" else "call"
            val wave = voice?.let { waveHeights(it.second) } ?: IDLE_WAVE
            val heard = voice?.let { state.tsVoiceSpeaker[it.first] }
            if (c.callType == "individual") {
                val caller = c.origCallerIssi ?: c.callerIssi
                val label = "${caller.takeIf { it != 0 } ?: "?"} ↔ ${c.calledIssi.takeIf { it != 0 } ?: "?"}"
                // The party keyed up (or the last floor holder), else the party this slot belongs to.
                val shown = heard ?: c.speakerIssi ?: (if (p.role == "called") c.calledIssi else caller)
                val role = when {
                    shown != 0 && shown == caller -> "LLAMANTE"
                    shown != 0 && shown == c.calledIssi -> "LLAMADO"
                    else -> "HABLA"
                }
                val who = state.issiText(shown).takeIf { it.isNotEmpty() }?.let { "TX $role $it" }
                return Slot(ts, mode, label, roleSub(p.role), who, timer, dur, emergency, c.encrypted, wave, voice != null)
            }
            val sp = state.issiText(heard ?: c.speakerIssi ?: c.callerIssi)
            val label = if (c.gssi != 0) "GSSI ${state.gssiText(c.gssi)}" else "GRUPO"
            val sub = if (voice != null) "TX $sp".trim() else sp.ifEmpty { "GRUPO" }
            return Slot(ts, mode, label, sub, null, timer, dur, emergency, c.encrypted, wave, voice != null)
        }
        if (voice != null) {
            // Uplink voice with no allocation reported: still a local TX.
            val sp = state.issiText(state.tsVoiceSpeaker[voice.first])
            return Slot(ts, "voice", "VOZ RX", "TX $sp".trim(), wave = waveHeights(voice.second), live = true)
        }
        // Packet-data channel with no call on it (voice always takes the slot back).
        val pd = pdchAt(carrier, ts, main)
        if (pd != null) {
            val elapsed = if (pd.since > 0) (now - pd.since).coerceAtLeast(0) else 0L
            val dataAt = recentData(carrier, ts, main)
            return Slot(
                ts, "data", "WAP · DATOS", "PDCH | ${state.issiText(pd.issi)}",
                timer = if (elapsed >= 1000) formatDur(elapsed / 1000) else null,
                durFrac = fraction(elapsed),
                wave = dataAt?.let { waveHeights(it) } ?: DATA_IDLE_WAVE,
                live = dataAt != null,
            )
        }
        if (ts == 1) return Slot(1, "idle", "BCCH", "secundaria")
        return Slot(ts, "idle", "—", "libre")
    }

    val rows = carriers.map { carrier ->
        val main = isMain(carrier)
        val byTs = HashMap<Int, Placement>()
        if (carrier == null) {
            // No RF info at all: every placement goes into the one row.
            byCarrier.values.forEach { m -> m.forEach { (ts, p) -> byTs.putIfAbsent(ts, p) } }
        } else {
            byCarrier[carrier.toString()]?.let { byTs.putAll(it) }
            if (main) byCarrier["single"]?.forEach { (ts, p) -> byTs.putIfAbsent(ts, p) }
        }
        val f = carrier?.let { freqs[it] }
        CarrierRow(
            carrier, main, f?.first, f?.second,
            carrier?.let { state.carrierAir[it.toString()] },
            (1..4).map { slot(carrier, it, byTs, main) },
        )
    }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("CANALES RF · TIMESLOTS", color = Muted, fontWeight = FontWeight.Black, fontSize = 10.sp, letterSpacing = 1.sp)
        rows.forEach { CarrierBlock(it) }
    }
}

@Composable
private fun CarrierBlock(r: CarrierRow) {
    fun mhz(hz: Long?): String? = hz?.let { "%.4f".format(Locale.US, it / 1_000_000.0) }
    val dl = mhz(r.txHz)
    val ul = mhz(r.rxHz)
    val meta = listOfNotNull(dl?.let { "DL $it" }, ul?.let { "UL $it" }).joinToString(" | ")
        .let { if (it.isEmpty()) "Esperando datos RF" else "$it MHz" }
    val title = "RF" + (r.carrier?.let { " #$it" } ?: "") + (if (r.main && r.carrier != null) " · MAIN" else "")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, maxLines = 1)
            r.air?.let { AirPill(it) }
            Text(meta, color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace, maxLines = 1,
                overflow = TextOverflow.Ellipsis, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
        }
        // A carrier on demand that is off keeps its row, dimmed.
        Column(
            Modifier.alpha(if (r.air == "off") 0.4f else 1f),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            r.slots.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    pair.forEach { SlotCell(it, Modifier.weight(1f).fillMaxHeight()) }
                }
            }
        }
    }
}

/** Carrier on demand: on the air (Ok), warming up (Warn), off (Muted). */
@Composable
private fun AirPill(air: String) {
    val (text, color) = when (air) {
        "on" -> "ON AIR" to Ok
        "warming" -> "CALENTANDO" to Warn
        "off" -> "APAGADA" to Muted
        else -> air.uppercase() to Muted
    }
    Text(
        text, color = color, fontSize = 8.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(color.copy(alpha = 0.10f))
            .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 2.dp),
    )
}

@Composable
private fun SlotCell(s: Slot, modifier: Modifier) {
    val color = when (s.mode) {
        "call" -> Warn
        "voice" -> Danger
        "data" -> Teal
        "mcch" -> Cyan
        else -> Muted
    }
    val accent = if (s.emergency) Danger else color
    val subColor = when (s.mode) {
        "voice" -> Danger.copy(alpha = 0.8f)
        "data" -> Teal.copy(alpha = 0.8f)
        else -> Muted
    }
    val bg = when {
        s.emergency -> Danger.copy(alpha = 0.18f)
        s.live -> color.copy(alpha = 0.16f)
        else -> color.copy(alpha = 0.07f)
    }
    Box(
        modifier.clip(RoundedCornerShape(6.dp)).background(bg)
            .border(if (s.emergency) 2.dp else 1.dp, accent.copy(alpha = if (s.mode == "idle") 0.3f else 0.55f), RoundedCornerShape(6.dp)),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(start = 7.dp, end = 7.dp, top = 4.dp, bottom = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("TS${s.ts}", color = accent, fontSize = 8.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                Spacer(Modifier.weight(1f))
                s.timer?.let {
                    Text(it, color = color, fontSize = 8.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace)
                }
            }
            WaveBars(
                s.wave, color,
                when {
                    s.live -> 1f
                    s.mode == "call" || s.mode == "data" -> 0.45f
                    else -> 0.25f
                },
            )
            Text(s.label, color = accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            s.encrypted?.let { CipherBadge(it) }
            Text(s.sub, color = subColor, fontSize = 8.sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
            s.who?.let {
                Text(it, color = subColor, fontSize = 8.sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (s.durFrac > 0f) {
            val bar = when (s.mode) {
                "voice" -> Danger
                "data" -> Teal
                else -> Warn
            }
            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth(s.durFrac).height(2.dp).background(bar))
        }
    }
}

@Composable
private fun WaveBars(heights: List<Int>, color: Color, alpha: Float) {
    Row(
        Modifier.height(14.dp).alpha(alpha),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        heights.forEach { h ->
            Box(Modifier.width(3.dp).height(h.dp).clip(RoundedCornerShape(topStart = 1.dp, topEnd = 1.dp)).background(color))
        }
    }
}

/** Air-interface ciphering (flowstation-tea2 only): padlock TEA2 / CLEAR; nothing when not reported. */
@Composable
private fun CipherBadge(on: Boolean) {
    Badge(if (on) "🔒 TEA2" else "🔓 CLEAR", if (on) Ok else Danger)
}

// ─── Terminal cards ─────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LocalTerminalCard(t: Terminal, state: TetraState, onSds: () -> Unit, onDgna: () -> Unit) {
    val statusColor = when (t.status) {
        "Online" -> Ok
        "External" -> Cyan
        else -> Muted
    }
    val callsign = t.callsign?.ifBlank { null }
    // Own name for the ISSI (Settings) when the radio has no callsign.
    val custom = if (callsign == null) state.issiNames[t.id]?.ifBlank { null } else null
    val selectedNum = t.selectedTg.removePrefix("TG").trim()
    // Energy Economy mode "EgN" -> "EGN" (StayAlive is not shown).
    val eg = t.energySaving?.let { Regex("Eg(\\d)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusDot(statusColor, 10)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(callsign ?: custom ?: t.id, color = if (custom != null) Warn else OnBg,
                        fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (callsign != null || custom != null) {
                        Text(t.id, color = Muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
                    }
                }
                Text("TG activo: ${state.tgText(t.selectedTg)}", color = Cyan, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    t.rssiDbfs?.let { RssiChip(it) }
                    eg?.let { Badge("EG$it", Muted) }
                    t.ciphering?.let { CipherBadge(it) }
                    if (t.lastSeen.isNotBlank()) {
                        Text("visto ${seenTime(t.lastSeen)}", color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace,
                            modifier = Modifier.align(Alignment.CenterVertically))
                    }
                }
            }
            t.activity?.let { a -> Badge(a + (t.timeSlot?.let { " TS$it" } ?: ""), if (a == "TX") Danger else Cyan) }
            ActionPill("SDS", Cyan, onSds)
            ActionPill("DGNA", Ok, onDgna)
        }
        if (t.groups.isNotEmpty()) {
            Text("ESCANEANDO ${t.groups.size} TG", color = Muted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                t.groups.forEach { g ->
                    val active = g == selectedNum
                    val c = if (active) Cyan else Muted
                    val text = if (active) g.toIntOrNull()?.let { state.gssiText(it) } ?: g else g
                    Text(text, color = c, fontSize = 10.sp, fontWeight = if (active) FontWeight.Black else FontWeight.Normal,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(c.copy(alpha = if (active) 0.18f else 0.08f))
                            .border(1.dp, c.copy(alpha = 0.4f), RoundedCornerShape(5.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                }
            }
        }
    }
}

@Composable
private fun ActionPill(text: String, color: Color, onClick: () -> Unit) {
    Text(
        text, color = color, fontSize = 10.sp, fontWeight = FontWeight.Black,
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(color.copy(alpha = 0.15f))
            .border(1.dp, color.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
            .clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 5.dp),
    )
}

/** Terminal lastSeen: "HH:MM:SS" from the station, or an ISO timestamp. */
private fun seenTime(raw: String): String =
    if (raw.contains('T')) raw.substringAfter('T').take(8) else raw.take(8)

@Composable
private fun ExternalRow(t: Terminal, state: TetraState) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StatusDot(Cyan, 8)
        Column(Modifier.weight(1f)) {
            Text(state.callsignOf(t.id) ?: t.id, color = OnBg, fontSize = 13.sp)
            Text(state.tgText(t.selectedTg), color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Badge("EXT", Cyan)
    }
}

/** Terminal RSSI in dBFS, same thresholds/colours as the dashboard's RssiBadge (LimeSDR Mini 2.0). */
@Composable
private fun RssiChip(dbfs: Double) {
    val color = when {
        dbfs < -45 -> Danger
        dbfs < -35 -> Color(0xFFFB923C)
        dbfs < -20 -> Ok
        else -> Cyan
    }
    Box(
        Modifier.clip(RoundedCornerShape(4.dp)).background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 1.dp)
    ) {
        Text("📶 ${String.format(java.util.Locale.US, "%.1f", dbfs)}", color = color, fontSize = 9.sp,
            fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun StatChip(label: String, value: String, accent: Color, modifier: Modifier = Modifier) {
    Column(
        modifier.clip(RoundedCornerShape(10.dp)).background(Surface).border(1.dp, Border, RoundedCornerShape(10.dp))
            .padding(vertical = 10.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = accent, fontWeight = FontWeight.Black, fontSize = 20.sp)
        Text(label, color = Muted, fontSize = 8.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(text, color = Muted, fontWeight = FontWeight.Black, fontSize = 11.sp, letterSpacing = 1.sp,
        modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun EmptyHint(text: String) {
    Text(text, color = Muted, fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp))
}

@Composable
private fun CollapsibleHeader(text: String, open: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = Muted, fontWeight = FontWeight.Black, fontSize = 11.sp, letterSpacing = 1.sp, modifier = Modifier.weight(1f))
        Text(if (open) "▾" else "▸", color = Muted, fontSize = 13.sp)
    }
}

/** Last Heard as kept by the station itself (fs_last_heard), newest first. */
@Composable
private fun LastHeardSection(state: TetraState) {
    var open by rememberSaveable { mutableStateOf(true) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        CollapsibleHeader("LAST HEARD · ESTACIÓN (${state.lastHeard.size})", open) { open = !open }
        if (open) state.lastHeard.take(20).forEach { LastHeardRow(it, state) }
    }
}

@Composable
private fun LastHeardRow(e: LastHeardEntry, state: TetraState) {
    val (act, color) = when (e.activity) {
        "call_group" -> "GRUPO" to Ok
        "call_individual" -> "PRIVADA" to Cyan
        "sds" -> "SDS" to Violet
        else -> e.activity.uppercase() to Muted
    }
    val cs = state.callsignOf(e.issi)
    val dest = when {
        e.dest == 0 -> null
        e.activity == "call_group" -> "→ TG ${state.gssiText(e.dest)}"
        else -> "→ ${e.dest}" + (state.callsignOf(e.dest)?.let { " ($it)" } ?: "")
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(cs ?: "ISSI ${e.issi}", color = OnBg, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(if (cs != null) "ISSI ${e.issi}" else null, dest).joinToString("  "),
                color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Badge(act, color)
        if (e.ts.isNotBlank()) Text(e.ts, color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun CallRow(c: CallLogEntry, state: TetraState) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(c.display.ifBlank { c.sourceCallsign ?: c.sourceId }, color = OnBg, fontSize = 13.sp)
            if (c.callType == "private") {
                val dst = c.targetIssi?.ifBlank { null } ?: c.targetTg
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Badge("PRIV", Cyan)
                    Text("→ $dst" + (state.callsignOf(dst)?.let { " ($it)" } ?: ""), color = Cyan, fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            } else {
                Text("→ ${state.tgText(c.targetTg)}", color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        c.timeSlot?.let { Badge("TS$it", Cyan) }
        if (!c.isLocal) Badge("EXT", Cyan)
        Text(c.timestamp.takeLast(8), color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Box(
        Modifier.clip(RoundedCornerShape(4.dp)).background(color.copy(alpha = 0.15f))
            .border(1.dp, color.copy(alpha = 0.5f), RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(text, color = color, fontSize = 9.sp, fontWeight = FontWeight.Black)
    }
}

/** Opens the position in the phone's map app (geo:), else in Google Maps on the web. */
private fun openGeo(context: Context, lat: Double, lon: Double) {
    val ll = "%.6f,%.6f".format(Locale.US, lat, lon)
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$ll?q=$ll")))
    } catch (_: ActivityNotFoundException) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.google.com/?q=$ll")))
        } catch (_: ActivityNotFoundException) {
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SdsRow(m: SdsMessage) {
    val context = LocalContext.current
    val out = m.direction == "outgoing"
    val status = m.messageType == "status"
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (status) Warn.copy(alpha = 0.08f) else SurfaceHi)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (m.timestamp.isNotBlank()) {
                Text("[${m.timestamp}]", color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace,
                    modifier = Modifier.align(Alignment.CenterVertically))
            }
            if (status) Badge("ESTADO", Warn) else Badge(if (out) "TX" else "RX", if (out) Cyan else Ok)
            Text(m.srcIssi + (m.srcCallsign?.let { " ($it)" } ?: ""), color = Cyan, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            Text("→", color = Muted, fontSize = 11.sp)
            Text(m.dstIssi + (m.dstCallsign?.let { " ($it)" } ?: ""), color = Warn, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
            Text(
                if (status && !m.statusCode.isNullOrBlank()) m.statusCode
                else "T${m.sdsType} · ${m.size}${if (m.sizeUnit == "bits") "b" else "B"}",
                color = if (status) Warn else Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace,
                modifier = Modifier.align(Alignment.CenterVertically),
            )
        }
        m.textContent?.takeIf { it.isNotBlank() }?.let {
            Text(it, color = OnBg, fontSize = 11.sp)
        }
        m.lipData?.let { lip ->
            Text(
                "📍 ${"%.5f".format(Locale.US, lip.lat)}, ${"%.5f".format(Locale.US, lip.lon)}" +
                    (lip.speed?.let { "  ${it.toInt()} km/h" } ?: "") +
                    (lip.heading?.let { " · ${it.toInt()}°" } ?: "") + "  ↗ Mapa",
                color = Cyan, fontSize = 10.sp, fontFamily = FontFamily.Monospace,
                modifier = Modifier.clickable { openGeo(context, lip.lat, lip.lon) },
            )
        }
    }
}

// ─── Quick-action dialogs (SDS / DGNA) ──────────────────────────────────────

@Composable
private fun DialogField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true, modifier = Modifier.fillMaxWidth(),
        label = { Text(label, fontSize = 11.sp) },
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Cyan, unfocusedBorderColor = Border,
            focusedTextColor = OnBg, unfocusedTextColor = OnBg, cursorColor = Cyan,
            focusedLabelColor = Cyan, unfocusedLabelColor = Muted,
            focusedContainerColor = SurfaceHi, unfocusedContainerColor = SurfaceHi,
        ),
    )
}

@Composable
private fun SdsDialog(issi: String, base: String?, password: String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var msg by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(true) }
    val ready = base != null && password.isNotBlank()

    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Surface,
        title = { Text("Enviar SDS a $issi", color = OnBg, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!ready) Text("Configura URL y contraseña en Ajustes.", color = Warn, fontSize = 11.sp)
                DialogField("Mensaje (máx 160)", msg) { if (it.length <= 160) msg = it }
                result?.let { Text(it, color = if (ok) Ok else Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = ready && !busy && msg.isNotBlank(),
                onClick = {
                    val i = issi.toIntOrNull() ?: return@TextButton
                    scope.launch {
                        busy = true
                        val r = TetraApi.sendSds(base!!, password, i, msg.trim())
                        result = r.message; ok = r.ok; busy = false
                        if (r.ok) onClose()
                    }
                },
            ) { Text("ENVIAR", color = Cyan, fontWeight = FontWeight.Black) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cerrar", color = Muted) } },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DgnaDialog(issi: String, base: String?, password: String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val settings = remember { Settings(context) }
    var gssi by remember { mutableStateOf("") }
    var mnemonic by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(true) }
    val ready = base != null && password.isNotBlank()

    fun run(attach: Boolean) {
        val g = gssi.trim().toIntOrNull()
        val i = issi.toIntOrNull()
        if (!ready || g == null || i == null) { result = "GSSI inválido"; ok = false; return }
        scope.launch {
            busy = true
            val r = TetraApi.dgna(base!!, password, i, g, attach, mnemonic.trim(), mode)
            // Same as the DGNA tab: an assigned TG goes to the library for quick re-assignment.
            if (r.ok && attach) settings.addTg(TgEntry(g, mnemonic.trim(), mode))
            result = r.message; ok = r.ok; busy = false
            if (r.ok) onClose()
        }
    }

    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Surface,
        title = { Text("DGNA · ISSI $issi", color = OnBg, fontSize = 15.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!ready) Text("Configura URL y contraseña en Ajustes.", color = Warn, fontSize = 11.sp)
                DialogField("GSSI (TG)", gssi) { gssi = it.filter(Char::isDigit) }
                DialogField("Mnemónico (máx 15)", mnemonic) { if (it.length <= 15) mnemonic = it }
                Text("Modo attachment", color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (0..5).forEach { m ->
                        val active = m == mode
                        val c = if (active) Cyan else Muted
                        Text("$m", color = if (active) Surface else c, fontSize = 12.sp, fontWeight = FontWeight.Black,
                            modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(if (active) Cyan else SurfaceHi)
                                .border(1.dp, c.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                                .clickable { mode = m }.padding(horizontal = 11.dp, vertical = 5.dp))
                    }
                }
                result?.let { Text(it, color = if (ok) Ok else Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            }
        },
        confirmButton = {
            TextButton(enabled = ready && !busy, onClick = { run(true) }) {
                Text("ASIGNAR", color = Ok, fontWeight = FontWeight.Black)
            }
        },
        dismissButton = {
            Row {
                TextButton(enabled = ready && !busy, onClick = { run(false) }) {
                    Text("QUITAR", color = Danger, fontWeight = FontWeight.Black)
                }
                TextButton(onClick = onClose) { Text("Cerrar", color = Muted) }
            }
        },
    )
}
