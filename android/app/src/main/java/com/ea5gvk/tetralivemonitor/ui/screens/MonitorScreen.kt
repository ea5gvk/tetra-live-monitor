package com.ea5gvk.tetralivemonitor.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.BtsInfo
import com.ea5gvk.tetralivemonitor.net.CallLogEntry
import com.ea5gvk.tetralivemonitor.net.RfCall
import com.ea5gvk.tetralivemonitor.net.SystemStats
import com.ea5gvk.tetralivemonitor.net.Terminal
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
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    StatChip("LOCALES", "${locals.size}", Cyan, Modifier.weight(1f))
                    StatChip("ONLINE", "$online", Ok, Modifier.weight(1f))
                    StatChip("EXTERNOS", "${externals.size}", Muted, Modifier.weight(1f))
                    StatChip("RF", "${state.rfCalls.size}", Warn, Modifier.weight(1f))
                }
            }

            item { HealthPanel(stats, state.brewStatus?.connected == true, state.brewStatus?.version) }

            item { RfTimeslots(state, base) }

            if (state.emergencies.isNotEmpty()) {
                item {
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                            .background(Color(0x22EF4444)).border(1.dp, Danger, RoundedCornerShape(10.dp)).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text("⚠ EMERGENCIA", color = Danger, fontWeight = FontWeight.Black, fontSize = 13.sp)
                        state.emergencies.forEach { e ->
                            Text("ISSI ${e.issi} → ${e.destSsi}  (${e.startedSecsAgo}s)", color = OnBg, fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace)
                        }
                    }
                }
            }

            item { SectionHeader("EQUIPOS LOCALES (${locals.size})") }
            if (locals.isEmpty()) {
                item { EmptyHint("Sin equipos locales. Comprueba la conexión en Ajustes.") }
            } else {
                items(locals, key = { it.id }) {
                    LocalTerminalCard(it, onSds = { sdsFor = it.id }, onDgna = { dgnaFor = it.id })
                }
            }

            if (externals.isNotEmpty()) {
                item { SectionHeader("EXTERNOS (${externals.size})") }
                items(externals, key = { it.id }) { ExternalRow(it) }
            }

            item { SectionHeader("LLAMADAS RECIENTES (${calls.size})") }
            if (calls.isEmpty()) {
                item { EmptyHint("Sin actividad reciente.") }
            } else {
                items(calls.take(30), key = { it.id }) { CallRow(it) }
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

@Composable
private fun HealthPanel(stats: SystemStats?, brewOn: Boolean, brewVersion: Int?) {
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
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusDot(if (brewOn) Ok else Danger, 9)
            Text(
                if (brewOn) "Brew conectado" + (brewVersion?.let { " (v$it)" } ?: "") else "Brew desconectado",
                color = if (brewOn) Ok else Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold,
            )
            stats?.hostname?.takeIf { it.isNotBlank() }?.let {
                Text("· $it", color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }
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

// ─── RF carriers / timeslots ────────────────────────────────────────────────

private data class Slot(val ts: Int, val mode: String, val label: String, val sub: String, val timer: String? = null)
private data class Placement(val call: RfCall, val role: String)

// Tiempo de conversación estilo razvan: "7s" bajo un minuto, "1m05s" a partir de ahí.
private fun formatDur(secs: Long): String {
    val s = if (secs < 0) 0 else secs
    return if (s < 60) "${s}s" else "${s / 60}m${(s % 60).toString().padStart(2, '0')}s"
}

@Composable
private fun RfTimeslots(state: TetraState, base: String?) {
    var bts by remember { mutableStateOf<BtsInfo?>(null) }
    LaunchedEffect(base) {
        while (base != null) {
            bts = TetraApi.getBtsInfo(base)
            delay(30000)
        }
    }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(500); now = System.currentTimeMillis() } }

    val mainCarrier = bts?.mainCarrier
    val configured = buildList {
        bts?.carriers?.forEach { c -> c.carrierNum?.let { add(it) } }
        if (isEmpty()) mainCarrier?.let { add(it) }
        if (bts?.dualCarrierActive == true) bts?.secondaryCarrier?.let { if (it !in this) add(it) }
    }

    val byCarrier = HashMap<String, HashMap<Int, Placement>>()
    fun place(carrier: Int?, ts: Int?, call: RfCall, role: String) {
        if (ts == null || ts < 1 || ts > 4) return
        val k = carrier?.toString() ?: "single"
        val m = byCarrier.getOrPut(k) { HashMap() }
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

    val carrierSet = LinkedHashSet<Int>().apply {
        addAll(configured)
        state.rfCalls.forEach { c -> c.carrier?.let { add(it) } }
    }
    val multi = carrierSet.size >= 2

    fun voiceActive(carrier: Int?, ts: Int, isMain: Boolean): Boolean {
        val keys = buildList {
            if (carrier != null) add("$carrier:$ts")
            if (isMain) add("single:$ts")
        }
        return keys.any { k -> state.tsVoiceActivity[k]?.let { now - it < 2000 } == true }
    }

    fun issiName(id: Int): String = state.terminals[id.toString()]?.callsign?.ifBlank { null } ?: id.toString()

    fun buildSlot(carrier: Int?, ts: Int, callByTs: Map<Int, Placement>, isMain: Boolean): Slot {
        val p = if (isMain && ts == 1) null else callByTs[ts]
        if (p != null) {
            val c = p.call
            val timer = c.startedAt?.let { formatDur((now - it) / 1000) }
            return if (c.callType == "individual")
                Slot(ts, "active", "${issiName(c.callerIssi)} → ${issiName(c.calledIssi)}", "PRIVADA", timer)
            else
                Slot(ts, "active", "GSSI ${c.gssi}", issiName(c.callerIssi), timer)
        }
        if (voiceActive(carrier, ts, isMain)) return Slot(ts, "voice", "VOZ RX", "actividad")
        if (ts == 1) return if (isMain) Slot(1, "mcch", "MCCH", "control") else Slot(1, "bcch", "BCCH", "libre")
        return Slot(ts, "idle", "—", "libre")
    }

    val rows: List<Pair<String, List<Slot>>> = if (multi) {
        carrierSet.sortedWith(compareBy({ if (it == mainCarrier) 0 else 1 }, { it })).map { carrier ->
            val isMain = if (mainCarrier != null) carrier == mainCarrier else false
            val cbt = byCarrier[carrier.toString()] ?: emptyMap()
            "RF $carrier" to (1..4).map { buildSlot(carrier, it, cbt, isMain) }
        }
    } else {
        val merged = HashMap<Int, Placement>()
        byCarrier.values.forEach { m -> (1..4).forEach { ts -> m[ts]?.let { merged.putIfAbsent(ts, it) } } }
        listOf("RF" to (1..4).map { buildSlot(mainCarrier, it, merged, true) })
    }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("CANALES RF · TIMESLOTS", color = Muted, fontWeight = FontWeight.Black, fontSize = 10.sp, letterSpacing = 1.sp)
        rows.forEach { (label, slots) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(label, color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
                    modifier = Modifier.width(38.dp))
                slots.forEach { s -> SlotCell(s, Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun SlotCell(s: Slot, modifier: Modifier) {
    val color = when (s.mode) {
        "active" -> Ok
        "voice" -> Warn
        "mcch" -> Cyan
        else -> Muted
    }
    Box(
        modifier.clip(RoundedCornerShape(6.dp)).background(color.copy(alpha = 0.10f))
            .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(6.dp)),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(vertical = 5.dp, horizontal = 3.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("TS${s.ts}", color = Muted, fontSize = 7.sp, fontWeight = FontWeight.Bold)
            Text(s.label, color = color, fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(s.sub, color = Muted, fontSize = 7.sp, maxLines = 1)
        }
        s.timer?.let {
            Text(
                it, color = if (s.mode == "voice") Danger else Warn, fontSize = 7.sp,
                fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 3.dp),
            )
        }
    }
}

// ─── Terminal cards ─────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LocalTerminalCard(t: Terminal, onSds: () -> Unit, onDgna: () -> Unit) {
    val statusColor = when (t.status) {
        "Online" -> Ok
        "External" -> Cyan
        else -> Muted
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusDot(statusColor, 10)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(t.callsign?.ifBlank { t.id } ?: t.id, color = OnBg, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    if (!t.callsign.isNullOrBlank()) {
                        Text(t.id, color = Muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                    }
                }
                Text("TG activo: ${t.selectedTg}", color = Cyan, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
            t.activity?.let { Badge(it, if (it == "TX") Danger else Cyan) }
            ActionPill("SDS", Cyan, onSds)
            ActionPill("DGNA", Ok, onDgna)
        }
        if (t.groups.isNotEmpty()) {
            Text("ESCANEANDO ${t.groups.size} TG", color = Muted, fontSize = 8.sp, fontWeight = FontWeight.Bold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                t.groups.forEach { g ->
                    val active = g == t.selectedTg
                    val c = if (active) Cyan else Muted
                    Text(g, color = c, fontSize = 10.sp, fontWeight = if (active) FontWeight.Black else FontWeight.Normal,
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

@Composable
private fun ExternalRow(t: Terminal) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        StatusDot(Cyan, 8)
        Column(Modifier.weight(1f)) {
            Text(t.callsign?.ifBlank { t.id } ?: t.id, color = OnBg, fontSize = 13.sp)
            Text("TG ${t.selectedTg}", color = Muted, fontSize = 10.sp)
        }
        Badge("EXT", Cyan)
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
private fun CallRow(c: CallLogEntry) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(c.display.ifBlank { c.sourceCallsign ?: c.sourceId }, color = OnBg, fontSize = 13.sp)
            Text("→ TG ${c.targetTg}", color = Muted, fontSize = 10.sp)
        }
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
