package com.ea5gvk.tetralivemonitor.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.DmrChannel
import com.ea5gvk.tetralivemonitor.net.DmrConfKey
import com.ea5gvk.tetralivemonitor.net.DmrConfResp
import com.ea5gvk.tetralivemonitor.net.DmrName
import com.ea5gvk.tetralivemonitor.net.DmrOpResult
import com.ea5gvk.tetralivemonitor.net.DmrRegistered
import com.ea5gvk.tetralivemonitor.net.DmrSlot
import com.ea5gvk.tetralivemonitor.net.DmrState
import com.ea5gvk.tetralivemonitor.net.DmrStateResult
import com.ea5gvk.tetralivemonitor.net.LocalTetraClient
import com.ea5gvk.tetralivemonitor.net.StationActive
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.TetraState
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// The DMR tab: the panel of the DMR station (Tier III: what dmrtc's status server reports, through /api/dmr/state
// and /api/dmr/cmd; Tier II: a conventional repeater without dmrtc, so its networks and the way to its live log) and
// CONFIG DMR (/etc/dmr-tier3/dmr-tier3.conf through /api/dmr/config, as the web's form).

private val DmrCyan = Color(0xFF67E8F9)
private val Violet = Color(0xFFA78BFA)
private val Sky = Color(0xFF7DD3FC)
private const val DMR_ID_MAX = 16777215L
private const val DMR_SMS_MAX = 1000
private const val DMR_DGNA_MAX = 15
private const val POLL_MS = 3000L
private const val POLL_FAST_MS = 1000L
private const val REPLY_WAIT_MS = 6000L
private const val HISTORY_MAX = 300
private val POLL_FORMATS = listOf("nmea", "binary", "address", "4bcd", "iso7", "iso8", "ip", "utf16", "status")
private val CALL_TYPES = setOf("group", "private", "group_packet", "private_packet")

@Composable
fun DmrScreen(state: TetraState, base: String?, password: String, hasPassword: Boolean, onOpenLog: (String) -> Unit) {
    var view by rememberSaveable { mutableStateOf("panel") }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("DMR", color = DmrCyan, fontWeight = FontWeight.Black, fontSize = 13.sp)
            state.station?.takeIf { it.dmr != null }?.let { st ->
                Text(if (st.tier2) "TIER II" else "TIER III", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.weight(1f))
            listOf("panel" to "PANEL", "config" to "CONFIG DMR").forEach { (k, label) ->
                Chip(label, view == k, DmrCyan) { view = k }
            }
        }
        if (base == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Configura la URL en Ajustes.", color = Muted, fontSize = 12.sp) }
            return
        }
        when (view) {
            "config" -> DmrConfigView(base, password, hasPassword, state.station)
            else -> DmrPanel(state, base, password, hasPassword, onOpenLog) { view = "config" }
        }
    }
}

// ─────────────────────────────── panel ───────────────────────────────

private data class HistoryEntry(val key: String, val ts: String, val type: String, val e: JsonObject)

@Composable
private fun DmrPanel(
    state: TetraState, base: String, password: String, hasPassword: Boolean,
    onOpenLog: (String) -> Unit, onOpenConfig: () -> Unit,
) {
    var res by remember(base) { mutableStateOf<DmrStateResult?>(null) }
    var history by remember(base) { mutableStateOf<List<HistoryEntry>>(emptyList()) }
    val names = remember(base) { mutableStateMapOf<String, DmrName>() }
    var poke by remember { mutableIntStateOf(0) }
    // faster polls while an action waits for its reply (ping, position, auth, channel)
    var waiting by remember { mutableStateOf(false) }
    var action by remember { mutableStateOf<ActionSpec?>(null) }
    // a poll that did not reach the dashboard keeps the last state on screen (twice at most), marked as stale
    var stale by remember(base) { mutableStateOf(false) }
    var staleWhy by remember(base) { mutableStateOf("") }

    LaunchedEffect(base, poke) {
        var fails = 0
        while (true) {
            val r = TetraApi.getDmrState(base)
            if (r.reason == "offline" && res?.state != null && ++fails < 3) { stale = true; staleWhy = r.message.orEmpty() }
            else { fails = 0; stale = false; res = r }
            r.state?.let { s ->
                names.putAll(s.names)
                val fresh = s.lastEvents.map { e ->
                    val ts = e.str("ts") ?: ""
                    val type = e.str("type") ?: "?"
                    HistoryEntry("${e.str("id") ?: "x"}:$ts:$type", ts, type, e)
                }
                val seen = history.map { it.key }.toHashSet()
                val add = fresh.filter { it.key !in seen }
                if (add.isNotEmpty()) history = (add + history).sortedByDescending { it.ts }.take(HISTORY_MAX)
            }
            delay(if (waiting) POLL_FAST_MS else POLL_MS)
        }
    }
    val nameOf: (Long?) -> DmrName? = { id -> id?.let { names[it.toString()] } }
    val st = res?.state

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // header: connection, dmrtc, gateway
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val (txt, c) = when {
                res == null -> "CARGANDO…" to Muted
                st != null -> "EN VIVO" to Ok
                res?.reason == "tier2" -> "DMR TIER II" to DmrCyan
                res?.reason == "stopped" -> "PARADA" to Muted
                res?.reason == "offline" -> "SIN CONEXIÓN" to Danger
                else -> "SIN dmrtc" to Warn
            }
            StatusDot(c, 9)
            Text(txt, color = c, fontSize = 11.sp, fontWeight = FontWeight.Black)
            if (st != null) Text("dmrtc ${st.version} · ${hms(st.uptimeS)}", color = Muted, fontSize = 9.sp,
                fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f), maxLines = 1)
            else Spacer(Modifier.weight(1f))
            Chip("ACTUALIZAR", false, Muted) { poke++ }
        }
        if (st != null) {
            val gw = st.gateway
            val (gwText, gwColor) = when {
                !gw.enabled -> "desactivada" to Muted
                gw.loggedIn == true -> "conectada al máster" to Ok
                gw.loggedIn == null -> "estado desconocido" to Muted
                else -> "esperando al máster" to Warn
            }
            Text("Pasarela: $gwText" + (if (gw.enabled && gw.address.isNotBlank()) " · ${gw.address}" else "") +
                (gw.loggedInAt?.let { " · desde ${hhmmss(it)}" } ?: ""), color = gwColor, fontSize = 10.sp)
        }

        if (stale) Text("Sin respuesta del dashboard ($staleWhy): estos son los últimos datos recibidos; reintentando…", color = Danger, fontSize = 10.sp)
        val r = res
        when {
            r == null -> Text("Consultando /api/dmr/state…", color = Muted, fontSize = 11.sp)
            st == null -> StackCard(r, state.station, base, onOpenLog, onOpenConfig) { poke++ }
            else -> {
                Tiles(st)
                ChannelsCard(st, nameOf) { ch, slot ->
                    action = ActionSpec(
                        cmd = "setChannelEnabled",
                        title = (if (slot.enabled) "Desactivar" else "Activar") + " el slot ${slot.slot} del canal ${ch.channelId}",
                        hint = "Un slot desactivado no se asigna a llamadas nuevas; la que esté en curso sigue hasta que acabe.",
                        danger = slot.enabled,
                        fixed = mapOf("channel_id" to JsonPrimitive(ch.channelId), "slot" to JsonPrimitive(slot.slot), "enabled" to JsonPrimitive(!slot.enabled)),
                        reply = "channel",
                    )
                }
                RadiosCard(st, nameOf) { action = it }
                CallsCard(st, nameOf)
                ActionsCard(st) { action = it }
            }
        }
        if (history.isNotEmpty() || st != null) HistoryCard(history, nameOf)
    }

    action?.let { spec ->
        ActionDialog(spec, base, password, hasPassword, history, nameOf,
            onWaiting = { waiting = it; if (it) poke++ }, onClose = { action = null; waiting = false })
    }
}

@Composable
private fun StackCard(r: DmrStateResult, station: StationActive?, base: String, onOpenLog: (String) -> Unit, onOpenConfig: () -> Unit, onRetry: () -> Unit) {
    val stack = r.stack
    Card {
        when {
            r.reason == "tier2" && stack?.active == true -> {
                Text("DMR TIER II · REPETIDOR CONVENCIONAL", color = DmrCyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
                Text("En Tier II no hay dmrtc: la estación es un repetidor de 2 slots y DMRGateway lleva las llamadas a una o varias redes DMR. " +
                    "No hay panel de llamadas y registros: lo que pasa se ve en el LOG de la pila (DMRGateway dice «Logged into the master» al entrar en cada red).",
                    color = Muted, fontSize = 11.sp)
                stack.version?.let { Text("dmr-tier3 $it" + if (station?.shared == true) " · SDR compartida con MiuraStation" else "",
                    color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace) }
                Tier2Networks(base)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    SmallButton("VER LOG DMR", DmrCyan, Modifier.weight(1f)) { onOpenLog(StationActive.DMR_LOG_SERVICE) }
                    SmallButton("CONFIG DMR", OnBg, Modifier.weight(1f)) { onOpenConfig() }
                }
            }
            r.reason == "offline" -> {
                Text("SIN CONEXIÓN CON EL DASHBOARD", color = Danger, fontWeight = FontWeight.Black, fontSize = 12.sp)
                Text(r.message.orEmpty(), color = Muted, fontSize = 10.sp)
            }
            stack != null && !stack.installed -> {
                Text("LA PILA DMR NO ESTÁ INSTALADA", color = Warn, fontWeight = FontWeight.Black, fontSize = 12.sp)
                Text("Instálala en CTRL → ACTUALIZACIONES → DMR TIER III / II, configúrala en CONFIG DMR y actívala con el selector de estación (MIURA+DMR o DMR).",
                    color = Muted, fontSize = 11.sp)
            }
            r.reason == "unreachable" -> {
                Text("dmrtc NO CONTESTA", color = Warn, fontWeight = FontWeight.Black, fontSize = 12.sp)
                Text("La pila está en marcha pero el servidor de estado de dmrtc no contesta (arrancando, o un dmr-tier3 antiguo: actualízalo en CTRL → ACTUALIZACIONES).",
                    color = Muted, fontSize = 11.sp)
                r.message?.let { Text(it, color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace) }
            }
            stack?.degraded == true && stack.missing.isNotEmpty() -> {
                Text("PILA DMR A MEDIAS", color = Warn, fontWeight = FontWeight.Black, fontSize = 12.sp)
                Text("El target está arriba pero falta: ${stack.missing.joinToString(", ")}. Mira el LOG de la pila y vuelve a activarla con el selector de estación.",
                    color = Muted, fontSize = 11.sp)
            }
            else -> {
                Text("PILA DMR PARADA", color = OnBg, fontWeight = FontWeight.Black, fontSize = 12.sp)
                Text(if (station?.shared == true) "Con la SDR compartida la pila arranca con MiuraStation: elige MIURA+DMR en el selector de estación (CTRL)."
                    else "Actívala con el selector de estación (CTRL): DMR (sola en la SDR) o MIURA+DMR (con la TETRA a la vez).",
                    color = Muted, fontSize = 11.sp)
            }
        }
        stack?.version?.takeIf { r.reason != "tier2" }?.let { Text("dmr-tier3 $it", color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace) }
        if (r.reason != "tier2" || stack?.active != true) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                SmallButton("REINTENTAR", OnBg, Modifier.weight(1f)) { onRetry() }
                SmallButton("VER LOG DMR", DmrCyan, Modifier.weight(1f)) { onOpenLog(StationActive.DMR_LOG_SERVICE) }
            }
        }
    }
}

/** Tier II: the DMR networks of the conf (NET_* and NET2..4_*) and which calls go to each. */
@Composable
private fun Tier2Networks(base: String) {
    var conf by remember(base) { mutableStateOf<DmrConfResp?>(null) }
    LaunchedEffect(base) { conf = TetraApi.getDmrConfig(base) }
    val v = conf?.keys?.associate { it.key to it.value } ?: return
    val nets = buildList {
        add(Triple(v["NET_NAME"]?.ifBlank { null } ?: "ADN", "${v["NET_ADDRESS"].orEmpty()}:${v["NET_PORT"].orEmpty()}", v["NET_ROUTES"]?.ifBlank { null } ?: "S1,S2"))
        for (n in 2..4) if (v["NET${n}_ENABLED"] == "1") {
            add(Triple(v["NET${n}_NAME"]?.ifBlank { null } ?: "Red $n",
                "${v["NET${n}_ADDRESS"].orEmpty()}:${v["NET${n}_PORT"]?.ifBlank { null } ?: "62031"}", v["NET${n}_ROUTES"].orEmpty()))
        }
    }
    Text("REDES DMR", color = DmrCyan, fontWeight = FontWeight.Black, fontSize = 10.sp)
    nets.forEachIndexed { i, (name, addr, routes) ->
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${i + 1}", color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            Text(name, color = OnBg, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text(addr, color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
            Text(routes, color = Warn, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
        }
    }
    Text("Rutas: S1/S2 = slot entero · S1:9 = TG · S2:214-219 = rango · S1:P8 = prefijo (estilo Pi-Star). Primero casan las reglas por TG o prefijo de todas las redes y luego los slots enteros.",
        color = Muted, fontSize = 9.sp)
}

@Composable
private fun Tiles(s: DmrState) {
    val cc = s.config.controlChannel
    val tiles = listOf(
        Triple("CÓDIGO DE SISTEMA", s.config.systemCode?.toString() ?: "—", OnBg),
        Triple("CANAL DE CONTROL", cc?.let { "${it.channelId} / slot ${it.slot}" } ?: "—", DmrCyan),
        Triple("CANALES", (s.channels.size.takeIf { it > 0 } ?: s.config.channelNumber)?.toString() ?: "—", OnBg),
        Triple("REGISTRADAS", s.registered.size.toString(), Ok),
        Triple("LLAMADAS", s.callsActive.size.toString(), if (s.callsActive.isNotEmpty()) Danger else OnBg),
        Triple("TG LOCALES", s.config.localTgIds.joinToString(", ").ifBlank { "—" }, Warn),
        Triple("TG SUSCRITOS", s.subscribedTalkgroups.joinToString(", ").ifBlank { "—" }, Sky),
        Triple("REGISTRO / AUTH", "${if (s.config.registrationRequired) "oblig." else "opc."} / ${if (s.config.authenticationRequired) "oblig." else "opc."}", OnBg),
    )
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        tiles.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                row.forEach { (label, value, c) ->
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(Surface)
                        .border(1.dp, Border, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) {
                        Text(label, color = Muted, fontSize = 8.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                        Text(value, color = c, fontSize = 13.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun ChannelsCard(s: DmrState, nameOf: (Long?) -> DmrName?, onToggle: (DmrChannel, DmrSlot) -> Unit) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("CANALES", color = DmrCyan, fontWeight = FontWeight.Black, fontSize = 12.sp, modifier = Modifier.weight(1f))
            if (s.config.freqBase > 0) Text("${mhz(s.config.freqBase)} + n×${"%.1f".format(s.config.freqSeparation / 1e3)} kHz",
                color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
        }
        if (s.channels.isEmpty()) Text("Sin canales.", color = Muted, fontSize = 11.sp)
        s.channels.forEach { ch ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("CANAL ${ch.channelId}", color = OnBg, fontWeight = FontWeight.Black, fontSize = 11.sp)
                    if (ch.control) Text("CONTROL", color = DmrCyan, fontSize = 8.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.border(1.dp, DmrCyan.copy(alpha = 0.5f), RoundedCornerShape(4.dp)).padding(horizontal = 4.dp, vertical = 1.dp))
                    Spacer(Modifier.weight(1f))
                    Text("TX ${mhz(ch.txFreq)} · RX ${mhz(ch.rxFreq)} · CC ${ch.colourCode} · LCN ${ch.logicalChannel}",
                        color = Muted, fontSize = 8.sp, fontFamily = FontFamily.Monospace)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    for (n in 1..2) {
                        val slot = ch.slots.firstOrNull { it.slot == n }
                        Box(Modifier.weight(1f)) { SlotCell(ch, slot, nameOf, onToggle) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SlotCell(ch: DmrChannel, slot: DmrSlot?, nameOf: (Long?) -> DmrName?, onToggle: (DmrChannel, DmrSlot) -> Unit) {
    if (slot == null) { Text("—", color = Muted); return }
    val (label, c) = when (slot.state) {
        "control" -> "CONTROL" to DmrCyan
        "busy" -> "OCUPADO" to Danger
        "disabled" -> "DESACTIVADO" to Muted
        else -> "LIBRE" to Ok
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(c.copy(alpha = 0.08f))
        .border(1.dp, c.copy(alpha = 0.35f), RoundedCornerShape(6.dp)).padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("S${slot.slot} $label", color = c, fontSize = 10.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f),
                textDecoration = if (slot.state == "disabled") TextDecoration.LineThrough else null)
            if (!slot.control) Text(if (slot.enabled) "OFF" else "ON", color = if (slot.enabled) Muted else Ok, fontSize = 9.sp,
                fontWeight = FontWeight.Black, modifier = Modifier.clip(RoundedCornerShape(4.dp))
                    .border(1.dp, Border, RoundedCornerShape(4.dp)).clickable { onToggle(ch, slot) }.padding(horizontal = 5.dp, vertical = 2.dp))
        }
        val call = slot.call
        if (call != null && slot.state == "busy") {
            Text("${radio(call.src, nameOf)} > ${dst(call.dst, !call.type.startsWith("private"), nameOf)}", color = OnBg, fontSize = 10.sp)
            Text("${callType(call.type)} · ${if (call.network) "red" else "local"}" + (if (call.callTimeS > 0) " · ${hms(call.callTimeS)}" else ""),
                color = Muted, fontSize = 9.sp)
        } else if (slot.text.isNotBlank()) Text(slot.text, color = Muted, fontSize = 9.sp, maxLines = 1)
    }
}

@Composable
private fun RadiosCard(s: DmrState, nameOf: (Long?) -> DmrName?, onAction: (ActionSpec) -> Unit) {
    val radios = s.registered.sortedWith(compareByDescending<DmrRegistered> { it.lastSeen }.thenBy { it.id })
    var open by remember { mutableStateOf<Long?>(null) }
    Card {
        Text("RADIOS REGISTRADAS · ${radios.size}", color = Ok, fontWeight = FontWeight.Black, fontSize = 12.sp)
        if (radios.isEmpty()) Text("Ninguna radio registrada.", color = Muted, fontSize = 11.sp)
        radios.forEach { r ->
            val n = nameOf(r.id)
            val busy = s.callsActive.any { it.src == r.id || (it.type.startsWith("private") && it.dst == r.id) }
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (busy) Danger.copy(alpha = 0.08f) else SurfaceHi)
                .clickable { open = if (open == r.id) null else r.id }.padding(8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (busy) StatusDot(Danger, 7)
                    Text("${r.id}", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                    n?.let { Text(it.callsign, color = OnBg, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
                    n?.name?.let { Text(it, color = Muted, fontSize = 10.sp, maxLines = 1, modifier = Modifier.weight(1f)) } ?: Spacer(Modifier.weight(1f))
                    Text("hace ${ago(r.lastSeen)}", color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
                }
                if (r.talkgroups.isNotEmpty() || r.dgna.isNotEmpty()) {
                    Text((if (r.talkgroups.isNotEmpty()) "TG ${r.talkgroups.joinToString(", ")}" else "") +
                        (if (r.dgna.isNotEmpty()) "   DGNA ${r.dgna.joinToString(", ")}" else ""), color = Warn, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                }
                if (open == r.id) {
                    val who = "radio ${r.id}" + (n?.callsign?.let { " ($it)" } ?: "")
                    val fixedId = mapOf("id" to JsonPrimitive(r.id))
                    val acts = listOf(
                        "PING" to ActionSpec("pingRadio", "Ping · $who", fields = listOf(Field("group", "Ping a grupo", "bool", value = "false")), fixed = fixedId, reply = "ping", replyRadio = r.id),
                        "ESTADO" to ActionSpec("pollStatus", "Pedir estado · $who", hint = "La radio contesta con su estado si lo admite.", fixed = fixedId),
                        "POSICIÓN" to ActionSpec("pollData", "Pedir posición · $who", fields = listOf(Field("poll_format", "Formato", "select", options = POLL_FORMATS)), fixed = fixedId, reply = "position", replyRadio = r.id),
                        "SMS" to ActionSpec("sendUDTShortMessage", "SMS · $who", fields = listOf(Field("text", "Texto", "text", required = true, hint = "Hasta $DMR_SMS_MAX caracteres (se trocea en mensajes de 46).")),
                            fixed = mapOf("dst" to JsonPrimitive(r.id), "group" to JsonPrimitive(false))),
                        "DGNA" to ActionSpec("sendUDTDGNA", "DGNA · $who", fields = listOf(
                            Field("dgids", "Grupos (TG)", "ids", value = r.dgna.joinToString(", "), hint = "Hasta $DMR_DGNA_MAX TG separados por comas; vacío = quitar las DGNA de la radio."),
                            Field("attach", "Adjuntar (attach)", "bool", value = "true")), fixed = mapOf("dst" to JsonPrimitive(r.id))),
                        "AUTH" to ActionSpec("sendAuthCheck", "Comprobar autenticación · $who", hint = "dmrtc reta a la radio con su clave (AUTH_KEYS).", fixed = fixedId, reply = "auth"),
                    )
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        acts.forEach { (label, spec) -> Chip(label, false, DmrCyan) { onAction(spec) } }
                    }
                }
            }
        }
        if (radios.isNotEmpty()) Text("Toca una radio para ver sus acciones.", color = Muted, fontSize = 9.sp)
    }
}

@Composable
private fun CallsCard(s: DmrState, nameOf: (Long?) -> DmrName?) {
    Card {
        Text("LLAMADAS EN CURSO · ${s.callsActive.size}", color = if (s.callsActive.isNotEmpty()) Danger else Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
        if (s.callsActive.isEmpty()) Text("Ninguna llamada en curso.", color = Muted, fontSize = 11.sp)
        s.callsActive.forEach { c ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Danger.copy(alpha = 0.08f)).padding(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusDot(Danger, 7)
                    Text("${c.channelId}/${c.slot}", color = OnBg, fontSize = 11.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                    Text("${radio(c.src, nameOf)} > ${dst(c.dst, !c.type.startsWith("private"), nameOf)}", color = OnBg, fontSize = 11.sp, modifier = Modifier.weight(1f))
                    Text(c.started?.let { since(it) } ?: if (c.callTimeS > 0) hms(c.callTimeS) else "—", color = Warn, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                }
                Text("${callType(c.type)} · ${if (c.network) "red" else "local"}" +
                    (if (c.rssi != 0.0) " · RSSI ${"%.0f".format(c.rssi)} dBm" else "") +
                    (if (c.ber != 0.0 || c.maxBer != 0.0) " · BER ${"%.2f".format(c.ber)}% (máx ${"%.2f".format(c.maxBer)}%)" else ""),
                    color = Muted, fontSize = 9.sp)
            }
        }
    }
}

private val FILTERS = listOf(
    "all" to "TODO", "registration" to "REGISTROS", "call" to "LLAMADAS", "sms" to "SMS",
    "ping" to "PING/GPS", "site" to "SITIO", "command" to "COMANDOS", "log" to "LOG",
)
private val FILTER_TYPES = mapOf(
    "registration" to setOf("registration", "deregistration", "mass_registration"),
    "call" to setOf("call_start", "call_end", "call_stats", "call_rejected"),
    "sms" to setOf("sms"),
    "ping" to setOf("ping", "position", "auth"),
    "site" to setOf("announce", "gateway", "subscriptions", "channel"),
    "command" to setOf("command"),
    "log" to setOf("log"),
)

@Composable
private fun HistoryCard(history: List<HistoryEntry>, nameOf: (Long?) -> DmrName?) {
    var filter by rememberSaveable { mutableStateOf("all") }
    val shown = if (filter == "all") history else history.filter { it.type in FILTER_TYPES[filter].orEmpty() }
    Card {
        Text("HISTORIAL · ${shown.size}", color = Warn, fontWeight = FontWeight.Black, fontSize = 12.sp)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            FILTERS.forEach { (k, label) -> Chip(label, filter == k, Warn) { filter = k } }
        }
        if (shown.isEmpty()) Text("Sin eventos.", color = Muted, fontSize = 11.sp)
        Column(Modifier.fillMaxWidth().heightIn(max = 420.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF05070C))
            .verticalScroll(rememberScrollState()).padding(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            shown.take(200).forEach { h ->
                val (txt, c) = describe(h.e, nameOf)
                Text("[${hhmmss(h.ts)}] $txt", color = c, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
private fun ActionsCard(s: DmrState, onAction: (ActionSpec) -> Unit) {
    val tgs = s.config.localTgIds
    val actions = listOf(
        "RE-REGISTRO MASIVO" to ActionSpec("requestMassRegistration", "Re-registro masivo", danger = true,
            hint = "Se borran todas las radios registradas y se les pide que se registren de nuevo."),
        "HORA" to ActionSpec("announceLocalTime", "Anunciar la hora local", reply = "announce"),
        "FRECUENCIAS" to ActionSpec("announceSystemFreqs", "Anunciar las frecuencias del sistema", reply = "announce"),
        "MENSAJE" to ActionSpec("announceSystemMessage", "Anunciar el mensaje del sistema",
            hint = s.config.systemAnnouncementMessage.ifBlank { null }?.let { "«$it»" }, reply = "announce"),
        "SITIOS ADYACENTES" to ActionSpec("announceAdjacentSites", "Anunciar los sitios adyacentes", reply = "announce"),
        "SMS" to ActionSpec("sendUDTShortMessage", "SMS desde el sitio", fields = listOf(
            Field("dst", "Destino (radio o TG)", "id", required = true, value = tgs.firstOrNull()?.toString().orEmpty(),
                hint = "ID de la radio o TG" + if (tgs.isNotEmpty()) " · TG locales: ${tgs.joinToString(", ")}" else ""),
            Field("group", "Es un grupo (TG)", "bool", value = (tgs.isNotEmpty()).toString()),
            Field("text", "Texto", "text", required = true, hint = "Hasta $DMR_SMS_MAX caracteres."))),
        "DGNA" to ActionSpec("sendUDTDGNA", "DGNA a una radio", fields = listOf(
            Field("dst", "Radio", "id", required = true),
            Field("dgids", "Grupos (TG)", "ids", hint = "Hasta $DMR_DGNA_MAX TG separados por comas; vacío = quitar las DGNA."),
            Field("attach", "Adjuntar (attach)", "bool", value = "true"))),
        "INSTANTÁNEA" to ActionSpec("requestStatusSnapshot", "Pedir una instantánea del estado", hint = "dmrtc vuelca su estado completo al servidor de estado."),
    )
    Card {
        Text("ACCIONES DEL SITIO", color = DmrCyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
        actions.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                row.forEach { (label, spec) -> SmallButton(label, if (spec.danger) Warn else DmrCyan, Modifier.weight(1f)) { onAction(spec) } }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

// ── actions (dialog with arguments; the system password saved in Ajustes) ──

private data class Field(
    val name: String, val label: String,
    /** id | text | bool | ids | select */
    val kind: String,
    val required: Boolean = false, val hint: String? = null,
    val options: List<String> = emptyList(), val value: String = "",
)

private data class ActionSpec(
    val cmd: String, val title: String, val hint: String? = null,
    val fields: List<Field> = emptyList(),
    val fixed: Map<String, JsonElement> = emptyMap(),
    val danger: Boolean = false,
    /** Event type that answers the command (ping, position, auth, announce, channel). */
    val reply: String? = null,
    /** The radio the reply should come from. */
    val replyRadio: Long? = null,
)

@Composable
private fun ActionDialog(
    spec: ActionSpec, base: String, password: String, hasPassword: Boolean,
    history: List<HistoryEntry>, nameOf: (Long?) -> DmrName?,
    onWaiting: (Boolean) -> Unit, onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val values = remember(spec) { mutableStateMapOf<String, String>().apply { spec.fields.forEach { put(it.name, it.value.ifEmpty { it.options.firstOrNull().orEmpty() }) } } }
    var errors by remember(spec) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busy by remember(spec) { mutableStateOf(false) }
    var error by remember(spec) { mutableStateOf<String?>(null) }
    var sent by remember(spec) { mutableStateOf(false) }
    var seenAtSend by remember(spec) { mutableStateOf<Set<String>?>(null) }
    var timedOut by remember(spec) { mutableStateOf(false) }

    // the reply: the first event of that type after the send, from that radio (or an unidentified one)
    val reply = seenAtSend?.let { seen ->
        spec.reply?.let { type ->
            history.lastOrNull { h -> h.type == type && h.key !in seen && (spec.replyRadio == null || radioIdOf(h.e).let { it == null || it == spec.replyRadio }) }
        }
    }
    LaunchedEffect(sent, reply) {
        if (sent && spec.reply != null && reply == null) {
            onWaiting(true); delay(REPLY_WAIT_MS); timedOut = true; onWaiting(false)
        } else onWaiting(false)
    }

    fun build(): JsonObject? {
        val out = spec.fixed.toMutableMap()
        val errs = mutableMapOf<String, String>()
        spec.fields.forEach { f ->
            val v = values[f.name].orEmpty().trim()
            when (f.kind) {
                "id" -> if (v.isNotEmpty() || f.required) {
                    val n = v.toLongOrNull()
                    if (n == null || n < 1 || n > DMR_ID_MAX) errs[f.name] = "ID no válido (1..$DMR_ID_MAX)" else out[f.name] = JsonPrimitive(n)
                }
                "text" -> if (v.isEmpty() || v.length > DMR_SMS_MAX) errs[f.name] = "1..$DMR_SMS_MAX caracteres" else out[f.name] = JsonPrimitive(v)
                "bool" -> out[f.name] = JsonPrimitive(v == "true")
                "ids" -> {
                    val parts = v.split(Regex("[\\s,;]+")).filter { it.isNotEmpty() }
                    val ids = parts.map { it.toLongOrNull()?.takeIf { n -> n in 1..DMR_ID_MAX } }
                    if (ids.any { it == null } || ids.size > DMR_DGNA_MAX) errs[f.name] = "hasta $DMR_DGNA_MAX ID separados por comas"
                    else out[f.name] = JsonArray(ids.map { JsonPrimitive(it!!) })
                }
                "select" -> out[f.name] = JsonPrimitive(v)
            }
        }
        errors = errs
        return if (errs.isEmpty()) JsonObject(out) else null
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        containerColor = Surface,
        title = { Text(spec.title, color = OnBg, fontSize = 15.sp) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                spec.hint?.let { Text(it, color = if (spec.danger) Warn else Muted, fontSize = 11.sp) }
                Text("POST /api/dmr/cmd · ${spec.cmd}" + spec.fixed.entries.joinToString("") { " · ${it.key}=${it.value}" },
                    color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
                spec.fields.forEach { f ->
                    when (f.kind) {
                        "bool" -> Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = values[f.name] == "true", onCheckedChange = { values[f.name] = it.toString() }, enabled = !sent && !busy,
                                colors = CheckboxDefaults.colors(checkedColor = DmrCyan))
                            Text(f.label, color = OnBg, fontSize = 12.sp)
                        }
                        "select" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(f.label, color = Muted, fontSize = 10.sp)
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                f.options.forEach { o -> Chip(o, values[f.name] == o, DmrCyan) { if (!sent && !busy) values[f.name] = o } }
                            }
                        }
                        else -> Column {
                            OutlinedTextField(
                                value = values[f.name].orEmpty(), onValueChange = { values[f.name] = it }, enabled = !sent && !busy,
                                singleLine = f.kind != "text", minLines = if (f.kind == "text") 3 else 1,
                                label = { Text(f.label + if (f.required) " *" else "", fontSize = 11.sp) },
                                isError = errors[f.name] != null,
                                keyboardOptions = if (f.kind == "id") KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
                                modifier = Modifier.fillMaxWidth(), colors = fieldColors(),
                            )
                            f.hint?.let { Text(it, color = Muted, fontSize = 9.sp) }
                            errors[f.name]?.let { Text("${f.label}: $it", color = Danger, fontSize = 10.sp) }
                        }
                    }
                }
                if (!hasPassword) Text("Falta la contraseña del sistema (Ajustes).", color = Warn, fontSize = 11.sp)
                error?.let { Text(it, color = Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                if (sent) {
                    Text("✓ Comando enviado", color = Ok, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    if (spec.reply != null) {
                        val (txt, c) = when {
                            reply != null -> describe(reply.e, nameOf).let { (t, col) -> "[${hhmmss(reply.ts)}] $t" to col }
                            timedOut -> "Sin respuesta en ${REPLY_WAIT_MS / 1000} s." to Warn
                            else -> "Esperando respuesta…" to Muted
                        }
                        Text(txt, color = c, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                    }
                }
            }
        },
        confirmButton = {
            if (!sent) TextButton(
                enabled = hasPassword && !busy,
                onClick = {
                    val args = build() ?: return@TextButton
                    scope.launch {
                        busy = true; error = null
                        val r = TetraApi.dmrCmd(base, password, spec.cmd, args)
                        busy = false
                        if (!r.ok) { error = r.message; return@launch }
                        seenAtSend = history.map { it.key }.toSet()
                        sent = true
                    }
                },
            ) { Text(if (busy) "ENVIANDO…" else "ENVIAR", color = if (spec.danger) Warn else DmrCyan, fontWeight = FontWeight.Black) }
        },
        dismissButton = { TextButton(onClick = { if (!busy) onClose() }) { Text(if (sent) "Cerrar" else "Cancelar", color = Muted) } },
    )
}

// ── events as text ──

private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.contentOrNull
private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() }
private fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.booleanOrNull
private fun JsonObject.dbl(k: String): Double? = (this[k] as? JsonPrimitive)?.doubleOrNull

/** The radio of a registration/deregistration/ping/position event, or null when only the event counter is there. */
private fun radioIdOf(e: JsonObject): Long? = when {
    e.containsKey("radio_id") -> e.long("radio_id")
    e.containsKey("event_id") -> e.long("id")
    else -> null
}

private fun callTypeOf(e: JsonObject): String? = (e.str("call_type") ?: e.str("type"))?.takeIf { it in CALL_TYPES }

private fun describe(e: JsonObject, nameOf: (Long?) -> DmrName?): Pair<String, Color> {
    val r = { id: Long? -> if (id == null) "radio ?" else radio(id, nameOf) }
    fun call(label: String, extra: String = ""): String {
        val type = callTypeOf(e)
        return "$label ${r(e.long("src"))} > ${dst(e.long("dst") ?: 0, type?.startsWith("private") != true, nameOf)}" +
            (type?.let { " · ${callType(it)}" } ?: "") +
            (e.bool("network")?.let { if (it) " · red" else " · local" } ?: "") +
            (e.str("channel_id")?.let { " · ch $it/${e.str("slot")}" } ?: "") + extra
    }
    return when (e.str("type")) {
        "registration" -> "Registro ${r(radioIdOf(e))} (${if (e.bool("new") == false) "de nuevo" else "nueva"})" to Ok
        "deregistration" -> "Baja ${r(radioIdOf(e))}" to Warn
        "mass_registration" -> "Re-registro masivo: ${(e["cleared"] as? JsonArray)?.size ?: 0} radios borradas" to Ok
        "call_start" -> call("Llamada") to OnBg
        "call_end" -> call("Fin", e.dbl("duration_s")?.let { " · ${hms(it)}" } ?: "") to Muted
        "call_stats" -> call("Calidad", " · RSSI ${"%.0f".format(e.dbl("rssi") ?: 0.0)} dBm · BER ${"%.2f".format(e.dbl("ber") ?: 0.0)}%") to Muted
        "channel" -> "Canal ${e.str("channel_id")}/${e.str("slot")}: ${e.str("previous") ?: "?"} > ${e.str("state")}" +
            (if (e.bool("enabled") == false) " · desactivado" else "") to DmrCyan
        "sms" -> "SMS ${r(e.long("src"))} > ${dst(e.long("dst") ?: 0, e.bool("group") == true, nameOf)}: «${e.str("text").orEmpty()}»" to Sky
        "call_rejected" -> "Rechazada ${r(e.long("src"))} > ${e.str("dst")} (${if (e.bool("local") == true) "local" else "red"})" to Danger
        "ping" -> if (e.bool("ok") == true) "Ping ${r(radioIdOf(e))}: ${e.str("ms")} ms" to Violet else "Ping sin respuesta" to Violet.copy(alpha = 0.7f)
        "position" -> "Posición ${r(radioIdOf(e))}: ${e.str("text").orEmpty()}" to Violet
        "auth" -> if (e.bool("success") == true) "Autenticación correcta" to Ok else "Autenticación fallida" to Danger
        "subscriptions" -> "TG suscritos: ${(e["talkgroups"] as? JsonArray)?.joinToString(", ") { (it as? JsonPrimitive)?.content.orEmpty() }?.ifBlank { null } ?: "—"}" to DmrCyan
        "gateway" -> "Pasarela conectada al máster" to Ok
        "announce" -> "Anuncio: ${e.str("text").orEmpty()}" to DmrCyan
        "command" -> if (e.bool("local") == true) "Comando ${e.str("cmd")} rechazado" + (e.str("error")?.let { ": $it" } ?: "") to Danger
            else "Comando ${e.str("cmd")}" + ((e["args"] as? JsonObject)?.takeIf { it.isNotEmpty() }?.let { " $it" } ?: "") to Warn
        "log" -> {
            val level = e.str("level") ?: "info"
            "[$level] ${e.str("msg").orEmpty()}" to when (level) { "critical", "fatal" -> Danger; "warning" -> Warn; else -> Muted }
        }
        else -> "${e.str("type")} ${JsonObject(e.filterKeys { it !in setOf("ts", "type", "id") })}" to Muted
    }
}

private fun radio(id: Long, nameOf: (Long?) -> DmrName?): String = nameOf(id)?.callsign?.let { "$id $it" } ?: "$id"
private fun dst(id: Long, group: Boolean, nameOf: (Long?) -> DmrName?): String = if (group) "TG $id" else radio(id, nameOf)
private fun callType(t: String): String = when (t) {
    "group" -> "grupo"; "private" -> "privada"; "group_packet" -> "datos a grupo"; "private_packet" -> "datos privados"; else -> "?"
}

private fun mhz(hz: Long): String = if (hz <= 0) "—" else "%.${if (hz % 1000 == 0L) 4 else 5}f".format(hz / 1e6)

private fun hms(totalS: Double): String {
    val s = totalS.toLong().coerceAtLeast(0)
    val h = s / 3600; val m = (s % 3600) / 60; val r = s % 60
    return when { h > 0 -> "${h}h ${"%02d".format(m)}m"; m > 0 -> "${m}m ${"%02d".format(r)}s"; else -> "${r}s" }
}

private val TIME = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())
private fun instant(iso: String): Instant? = runCatching { Instant.parse(iso) }.getOrNull()
private fun hhmmss(iso: String): String = instant(iso)?.let { TIME.format(it) } ?: "—"
private fun since(iso: String): String = instant(iso)?.let { hms((System.currentTimeMillis() - it.toEpochMilli()) / 1000.0) } ?: "—"
private fun ago(iso: String): String {
    val t = instant(iso) ?: return "—"
    val s = ((System.currentTimeMillis() - t.toEpochMilli()) / 1000).coerceAtLeast(0)
    return when { s < 60 -> "$s s"; s < 3600 -> "${s / 60} min"; s < 86400 -> "${s / 3600} h"; else -> "${s / 86400} d" }
}

// ─────────────────────────────── CONFIG DMR ───────────────────────────────

private data class Kind(val kind: String, val min: Int? = null, val max: Int? = null, val options: List<String> = emptyList())

private val RANGE_RE = Regex("""(\d+)\.\.(\d+|N_CHANNELS)\)""")
private val BOOL_RE = Regex("""(^|\s)[01] = """)
private const val MAX_CHANNELS = 4
/** Keys that rewrite MiuraStation's [dmr_window] block (SDR_COMPARTIDO): the server then restarts MiuraStation too. */
private val MIURA_KEYS = setOf("SDR_COMPARTIDO", "TX_FREQUENCY", "RX_FREQUENCY", "N_CHANNELS")

private fun channels(values: Map<String, String>): Int = values["N_CHANNELS"]?.toIntOrNull()?.takeIf { it in 1..MAX_CHANNELS } ?: MAX_CHANNELS

private fun kindOf(k: DmrConfKey, values: Map<String, String>): Kind {
    if (k.secret) return Kind("secret")
    val value = values[k.key].orEmpty()
    if (BOOL_RE.containsMatchIn(k.help) && Regex("^[01]?$").matches(value)) return Kind("switch")
    if (k.choices != null && value in k.choices) return Kind("select", options = k.choices)
    if (k.key == "N_CHANNELS") return Kind("number", 1, MAX_CHANNELS)
    // Tier II has no control channel (gen-config only checks 1..4 then): N_CHANNELS=1 must not hold it back
    if (k.key == "CONTROL_CHANNEL") return Kind("number", 1, if (values["DMR_TIER"] == "2") MAX_CHANNELS else channels(values))
    RANGE_RE.find(k.help)?.let { m ->
        return Kind("number", m.groupValues[1].toInt(), if (m.groupValues[2] == "N_CHANNELS") channels(values) else m.groupValues[2].toIntOrNull())
    }
    if (Regex("^-?\\d+$").matches(k.default) && Regex("^-?\\d*$").matches(value)) return Kind("number")
    return Kind("text")
}

private fun outOfRange(value: String, kind: Kind): Boolean {
    if (kind.kind != "number" || value.isEmpty()) return false
    val n = value.toLongOrNull() ?: return true
    return (kind.min != null && n < kind.min) || (kind.max != null && n > kind.max)
}

@Composable
private fun DmrConfigView(base: String, password: String, hasPassword: Boolean, station: StationActive?) {
    val scope = rememberCoroutineScope()
    val client = LocalTetraClient.current
    var data by remember(base) { mutableStateOf<DmrConfResp?>(null) }
    var loadError by remember(base) { mutableStateOf<String?>(null) }
    val values = remember(base) { mutableStateMapOf<String, String>() }
    var original by remember(base) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var pendingOp by remember { mutableStateOf<String?>(null) } // apply | save | regenerate
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<Pair<String, DmrOpResult>?>(null) }
    val showSecret = remember { mutableStateMapOf<String, Boolean>() }
    val openHelp = remember { mutableStateMapOf<String, Boolean>() }

    fun load() {
        scope.launch {
            loadError = null
            val r = TetraApi.getDmrConfig(base)
            if (r == null) { loadError = "No se ha podido leer /api/dmr/config"; return@launch }
            val vals = r.keys.associate { it.key to if (it.secret) "" else it.value }
            data = r; values.clear(); values.putAll(vals); original = vals
        }
    }
    LaunchedEffect(base) { load() }

    val d = data
    val keys = d?.keys.orEmpty()
    // a secret counts as changed only when something was typed (empty = keep the stored one)
    val changed = keys.filter { values[it.key].orEmpty() != original[it.key].orEmpty() }.map { it.key }
    val invalid = keys.filter { outOfRange(values[it.key].orEmpty(), kindOf(it, values)) }.map { it.key }
    val installed = d?.installed == true
    val canSave = installed && !busy && invalid.isEmpty() && (changed.isNotEmpty() || d?.exists == false)

    fun runOp(op: String) {
        scope.launch {
            busy = true
            val r = if (op == "regenerate") TetraApi.regenerateDmr(base, password)
                else TetraApi.saveDmrConfig(base, password, changed.associateWith { values[it].orEmpty() }, restart = op == "apply")
            busy = false
            result = op to r
            if (r.ok || op == "regenerate") { load(); client?.refreshStation() }
        }
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("CONFIG DMR", color = DmrCyan, fontWeight = FontWeight.Black, fontSize = 13.sp)
                    d?.let {
                        val (t, c) = when { it.active -> "en marcha" to Ok; it.degraded -> "a medias: ${it.missing.joinToString(", ")}" to Warn; else -> "parada" to Muted }
                        Text(t, color = c, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.weight(1f))
                    if (changed.isNotEmpty()) Chip("DESCARTAR ${changed.size}", false, Warn) { if (!busy) { values.clear(); values.putAll(original) } }
                    Chip("RECARGAR", false, Muted) { if (!busy) load() }
                }
                Text("${d?.path?.ifBlank { null } ?: "/etc/dmr-tier3/dmr-tier3.conf"}: al guardar, gen-config.py comprueba la configuración en una copia (una configuración que no vale nunca llega a la estación) y regenera los ficheros de la pila.",
                    color = Muted, fontSize = 10.sp)
                when {
                    loadError != null -> Text(loadError!!, color = Danger, fontSize = 11.sp)
                    d == null -> Text("Cargando…", color = Muted, fontSize = 11.sp)
                    !d.installed -> Text("La pila DMR no está instalada: instálala en CTRL → ACTUALIZACIONES → DMR TIER III / II.", color = Warn, fontSize = 11.sp)
                    !d.exists -> Text("Todavía no hay dmr-tier3.conf: se creará a partir del ejemplo del paquete al guardar.", color = Warn, fontSize = 11.sp)
                }
                if (!hasPassword) Text("Falta la contraseña del sistema (Ajustes): sin ella no se puede guardar.", color = Warn, fontSize = 10.sp)
            }
        }
        if (installed) {
            var lastSection: String? = null
            keys.forEach { k ->
                if (k.section != lastSection) {
                    lastSection = k.section
                    val sec = k.section
                    item(key = "sec-$sec") {
                        val tier2Only = Regex("solo Tier II", RegexOption.IGNORE_CASE).containsMatchIn(sec) && values["DMR_TIER"] != "2"
                        Row(Modifier.padding(top = 6.dp).alpha(if (tier2Only) 0.6f else 1f), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(sec.ifBlank { "Otros" }.uppercase(), color = DmrCyan, fontSize = 10.sp, fontWeight = FontWeight.Black)
                            if (tier2Only) Text("solo se usa con DMR_TIER=2", color = Muted, fontSize = 9.sp)
                        }
                    }
                }
                item(key = k.key) {
                    val tier2Only = Regex("solo Tier II", RegexOption.IGNORE_CASE).containsMatchIn(k.section) && values["DMR_TIER"] != "2"
                    ConfRow(k, values, changed.contains(k.key), invalid.contains(k.key), busy, tier2Only,
                        showSecret[k.key] == true, { showSecret[k.key] = !(showSecret[k.key] ?: false) },
                        openHelp[k.key] == true, { openHelp[k.key] = !(openHelp[k.key] ?: false) })
                }
            }
            item {
                Column(Modifier.fillMaxWidth().padding(vertical = 10.dp).clip(RoundedCornerShape(10.dp)).background(Surface)
                    .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("GUARDAR Y APLICAR para la pila si está en marcha, regenera sus ficheros y la vuelve a arrancar: la DMR se corta unos segundos.",
                        color = Warn, fontSize = 10.sp)
                    if (invalid.isNotEmpty()) Text("Fuera de rango: ${invalid.joinToString(", ")}", color = Danger, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                    Button(
                        onClick = { pendingOp = "apply" }, enabled = canSave && hasPassword, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = DmrCyan, contentColor = Surface),
                    ) { Text(if (busy) "APLICANDO…" else "GUARDAR Y APLICAR" + if (changed.isNotEmpty()) " (${changed.size})" else "", fontWeight = FontWeight.Black, fontSize = 11.sp) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        Button(
                            onClick = { pendingOp = "save" }, enabled = canSave && hasPassword, modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = OnBg),
                        ) { Text("SOLO GUARDAR", fontWeight = FontWeight.Bold, fontSize = 10.sp) }
                        Button(
                            onClick = { pendingOp = "regenerate" }, enabled = !busy && hasPassword && d?.exists == true, modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = OnBg),
                        ) { Text("REGENERAR", fontWeight = FontWeight.Bold, fontSize = 10.sp) }
                    }
                    result?.let { (op, r) ->
                        if (r.ok) Text("✓ " + when { op == "regenerate" -> "Ficheros regenerados"; r.applied == true -> "Guardado y aplicado"; else -> "Guardado (se aplica al regenerar o al guardar con reinicio)" },
                            color = Ok, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        else Column {
                            Text("✗ La configuración no se ha aplicado:", color = Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            r.errors.forEach { Text("• $it", color = Danger, fontSize = 10.sp, fontFamily = FontFamily.Monospace) }
                        }
                        if (r.log.isNotEmpty()) MonoLog(r.log.joinToString("\n"))
                    }
                }
            }
        }
    }

    pendingOp?.let { op ->
        val restarts = op != "save" && d?.active == true
        val restartsMiura = if (op == "regenerate") d?.shared == true || original["SDR_COMPARTIDO"] == "1"
            else (d?.shared == true || values["SDR_COMPARTIDO"] == "1") && changed.any { it in MIURA_KEYS }
        AlertDialog(
            onDismissRequest = { pendingOp = null },
            containerColor = Surface,
            title = { Text(when (op) { "apply" -> "¿Guardar y aplicar?"; "save" -> "¿Solo guardar?"; else -> "¿Regenerar la pila?" }, color = OnBg) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (op != "regenerate") Text("Cambios: ${changed.joinToString(", ").ifBlank { "ninguno (se crea el conf)" }}", color = OnBg, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                    if (op == "regenerate") Text("Vuelve a escribir los ficheros de la pila a partir de dmr-tier3.conf (por si se editó a mano).", color = Muted, fontSize = 11.sp)
                    if (op == "save") Text("Se guarda el conf validado pero no se toca la pila: se aplica al regenerar o al guardar con reinicio.", color = Muted, fontSize = 11.sp)
                    if (restarts) Text("La pila DMR se para y se vuelve a arrancar: la DMR se corta unos segundos.", color = Warn, fontSize = 11.sp)
                    if (restartsMiura) Text("Con la SDR compartida también se reinicia MiuraStation: la TETRA se corta unos segundos.", color = Warn, fontSize = 11.sp)
                }
            },
            confirmButton = { TextButton(onClick = { pendingOp = null; runOp(op) }) { Text("CONFIRMAR", color = DmrCyan, fontWeight = FontWeight.Black) } },
            dismissButton = { TextButton(onClick = { pendingOp = null }) { Text("Cancelar", color = Muted) } },
        )
    }
}

@Composable
private fun ConfRow(
    k: DmrConfKey, values: MutableMap<String, String>, isChanged: Boolean, bad: Boolean, busy: Boolean, dimmed: Boolean,
    secretShown: Boolean, toggleSecret: () -> Unit, helpOpen: Boolean, toggleHelp: () -> Unit,
) {
    val kind = kindOf(k, values)
    val value = values[k.key].orEmpty()
    Column(Modifier.fillMaxWidth().alpha(if (dimmed) 0.6f else 1f).clip(RoundedCornerShape(8.dp)).background(Surface)
        .border(1.dp, if (bad) Danger.copy(alpha = 0.6f) else if (isChanged) Warn.copy(alpha = 0.6f) else Border, RoundedCornerShape(8.dp))
        .padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(k.key, color = if (isChanged) Warn else OnBg, fontWeight = FontWeight.Black, fontSize = 11.sp,
                fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
            when (kind.kind) {
                "switch" -> Switch(
                    checked = value == "1", onCheckedChange = { values[k.key] = if (it) "1" else "0" }, enabled = !busy,
                    colors = SwitchDefaults.colors(checkedThumbColor = Surface, checkedTrackColor = DmrCyan, uncheckedTrackColor = SurfaceHi, uncheckedBorderColor = Border),
                )
                "select" -> Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    kind.options.forEach { o -> Chip(o, value == o, DmrCyan) { if (!busy) values[k.key] = o } }
                }
                "secret" -> Text(if (k.set) "guardada" else "sin clave", color = if (k.set) Ok else Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
            }
        }
        if (kind.kind == "secret" || kind.kind == "number" || kind.kind == "text") {
            OutlinedTextField(
                value = value, onValueChange = { values[k.key] = it }, enabled = !busy, singleLine = true,
                modifier = Modifier.fillMaxWidth(), isError = bad,
                placeholder = if (kind.kind == "secret" && k.set) ({ Text("•••••••• (vacío = no cambiarla)", fontSize = 11.sp, color = Muted) }) else null,
                visualTransformation = if (kind.kind == "secret" && !secretShown) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = when (kind.kind) {
                    "number" -> KeyboardOptions(keyboardType = KeyboardType.Number)
                    "secret" -> KeyboardOptions(keyboardType = KeyboardType.Password)
                    else -> KeyboardOptions.Default
                },
                trailingIcon = if (kind.kind == "secret") ({
                    Text(if (secretShown) "OCULTAR" else "VER", color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable { toggleSecret() }.padding(8.dp))
                }) else null,
                colors = fieldColors(),
            )
            if (kind.min != null && kind.max != null) Text("rango ${kind.min}..${kind.max}", color = if (bad) Danger else Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
        }
        if (k.help.isNotBlank()) {
            Text(
                if (helpOpen) k.help else k.help.lineSequence().first().let { if (k.help.contains('\n')) "$it …" else it },
                color = Muted, fontSize = 10.sp, modifier = Modifier.clickable { toggleHelp() },
            )
        }
    }
}

// ── small widgets ──

@Composable
private fun Chip(label: String, selected: Boolean, color: Color, onClick: () -> Unit) {
    Text(
        label, color = if (selected) color else Muted, fontSize = 10.sp, fontWeight = FontWeight.Black, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(6.dp))
            .background(if (selected) color.copy(alpha = 0.15f) else Color.Transparent)
            .border(1.dp, if (selected) color.copy(alpha = 0.6f) else Border, RoundedCornerShape(6.dp))
            .clickable { onClick() }.padding(horizontal = 9.dp, vertical = 5.dp),
    )
}

@Composable
private fun SmallButton(label: String, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = modifier, colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = color)) {
        Text(label, fontWeight = FontWeight.Bold, fontSize = 10.sp, maxLines = 1)
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = DmrCyan, unfocusedBorderColor = Border,
    focusedTextColor = OnBg, unfocusedTextColor = OnBg, cursorColor = DmrCyan,
    focusedLabelColor = DmrCyan, unfocusedLabelColor = Muted,
    focusedContainerColor = SurfaceHi, unfocusedContainerColor = SurfaceHi,
)
