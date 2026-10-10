package com.ea5gvk.tetralivemonitor.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.ApiResult
import com.ea5gvk.tetralivemonitor.net.FlowDashboardStatus
import com.ea5gvk.tetralivemonitor.net.LocalTetraClient
import com.ea5gvk.tetralivemonitor.net.StationActive
import com.ea5gvk.tetralivemonitor.net.StationSwitchResult
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
import kotlinx.coroutines.launch

@Composable
fun ControlScreen(state: TetraState, base: String?, password: String, hasPassword: Boolean) {
    // VPN / WiFi open as sub-screens of CTRL; back returns here.
    var sub by rememberSaveable { mutableStateOf<String?>(null) }
    BackHandler(enabled = sub != null) { sub = null }
    when (sub) {
        "vpn" -> { VpnScreen(base, password, hasPassword) { sub = null }; return }
        "wifi" -> { WifiScreen(base, password, hasPassword) { sub = null }; return }
    }

    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var resultOk by remember { mutableStateOf(true) }
    var confirm by remember { mutableStateOf<String?>(null) } // "reboot" | "shutdown" | "kick"

    fun dispatch(block: suspend () -> ApiResult) {
        if (base == null) { result = "Configura la URL en Ajustes"; resultOk = false; return }
        if (!hasPassword) { result = "Configura la contraseña en Ajustes"; resultOk = false; return }
        scope.launch { busy = true; val r = block(); result = r.message; resultOk = r.ok; busy = false }
    }

    // Unit of the flow-family station in use (miurastation.service or flowstation.service), from the shared poll.
    val flowSvc = state.station?.flowService?.takeIf { it == "miurastation.service" } ?: "flowstation.service"

    var sdsIssi by remember { mutableStateOf("") }
    var sdsMsg by remember { mutableStateOf("") }
    var kickIssi by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (!hasPassword) {
            Card {
                Text("⚠ Falta la contraseña del sistema", color = Warn, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Text("Ve a Ajustes e introduce la contraseña (systemPassword) para poder enviar SDS, DGNA y gestionar la Pi.",
                    color = Muted, fontSize = 11.sp)
            }
        }

        // ── Estación activa ──
        StationCard(state, base, password, hasPassword)

        // ── SDS ──
        Card {
            Text("ENVIAR SDS", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
            CtrlField("ISSI destino", sdsIssi, { sdsIssi = it.filter(Char::isDigit) })
            CtrlField("Mensaje (máx 160)", sdsMsg, { if (it.length <= 160) sdsMsg = it })
            Button(
                onClick = {
                    val i = sdsIssi.trim().toIntOrNull()
                    if (i == null || sdsMsg.isBlank()) { result = "ISSI y mensaje requeridos"; resultOk = false }
                    else dispatch { TetraApi.sendSds(base!!, password, i, sdsMsg.trim()) }
                },
                enabled = !busy, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Surface),
            ) { Text("ENVIAR SDS", fontWeight = FontWeight.Black) }
        }

        // ── Kick ──
        Card {
            Text("EXPULSAR TERMINAL (KICK)", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
            CtrlField("ISSI", kickIssi, { kickIssi = it.filter(Char::isDigit) })
            Button(
                onClick = {
                    val i = kickIssi.trim().toIntOrNull()
                    if (i == null) { result = "ISSI requerido"; resultOk = false }
                    else confirm = "kick"
                },
                enabled = !busy, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Warn, contentColor = Surface),
            ) { Text("EXPULSAR", fontWeight = FontWeight.Black) }
        }

        // ── Whitelist ──
        WhitelistCard(base, password, hasPassword)

        // ── Dual carrier ──
        DualCarrierCard(state, base, password, hasPassword)

        // ── Actualizaciones (misma botonera que la web) ──
        UpdatesSection(base, password, hasPassword, state.updateChecks)

        // ── Red: VPN, WiFi y dashboard propio de la estación ──
        Card {
            Text("RED Y HERRAMIENTAS", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { sub = "vpn" }, enabled = base != null, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Cyan),
                ) { Text("VPN WIREGUARD", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
                Button(
                    onClick = { sub = "wifi" }, enabled = base != null, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Cyan),
                ) { Text("WIFI DE LA PI", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            }
            StationDashboardButton(state, base)
        }

        // ── Sistema ──
        Card {
            Text("SISTEMA / RASPBERRY PI", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { dispatch { TetraApi.restartService(base!!, password, flowSvc) } },
                    enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = OnBg),
                ) {
                    Text(if (flowSvc == "miurastation.service") "REINICIAR MIURA" else "REINICIAR FLOW",
                        fontWeight = FontWeight.Bold, fontSize = 11.sp)
                }
                Button(
                    onClick = { dispatch { TetraApi.restartService(base!!, password, "tmo.service") } },
                    enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = OnBg),
                ) { Text("REINICIAR TMO", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { confirm = "reboot" }, enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Warn, contentColor = Surface),
                ) { Text("REINICIAR PI", fontWeight = FontWeight.Black, fontSize = 11.sp) }
                Button(
                    onClick = { confirm = "shutdown" }, enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Danger, contentColor = Surface),
                ) { Text("APAGAR PI", fontWeight = FontWeight.Black, fontSize = 11.sp) }
            }
        }

        result?.let {
            Text(it, color = if (resultOk) Ok else Danger, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        }
    }

    if (confirm == "kick") {
        val i = kickIssi.trim().toIntOrNull()
        AlertDialog(
            onDismissRequest = { confirm = null },
            containerColor = Surface,
            title = { Text("¿Expulsar ISSI $i?", color = OnBg) },
            text = {
                Text("${i?.let { state.callsignOf(it) }?.let { "$it · " } ?: ""}El terminal se dará de baja de la estación y tendrá que volver a registrarse.",
                    color = Muted)
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    if (i != null) dispatch { TetraApi.kick(base!!, password, i) }
                }) { Text("EXPULSAR", color = Warn, fontWeight = FontWeight.Black) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancelar", color = Muted) } },
        )
    } else if (confirm != null) {
        val isReboot = confirm == "reboot"
        AlertDialog(
            onDismissRequest = { confirm = null },
            containerColor = Surface,
            title = { Text(if (isReboot) "¿Reiniciar la Pi?" else "¿Apagar la Pi?", color = OnBg) },
            text = {
                Text(
                    if (isReboot) "La Raspberry Pi se reiniciará. Perderás la conexión unos minutos."
                    else "La Raspberry Pi se apagará. Tendrás que encenderla manualmente.",
                    color = Muted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val action = confirm; confirm = null
                    dispatch { if (action == "reboot") TetraApi.reboot(base!!, password) else TetraApi.shutdown(base!!, password) }
                }) { Text(if (isReboot) "REINICIAR" else "APAGAR", color = if (isReboot) Warn else Danger, fontWeight = FontWeight.Black) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancelar", color = Muted) } },
        )
    }
}

@Composable
internal fun Card(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/** Black monospace box for command output (station switch log, updaters). */
@Composable
internal fun MonoLog(text: String) {
    val scroll = rememberScrollState()
    Text(
        text, color = Color(0xFF86EFAC), fontSize = 9.sp, fontFamily = FontFamily.Monospace,
        modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp).clip(RoundedCornerShape(6.dp))
            .background(Color(0xFF05070C)).verticalScroll(scroll).padding(6.dp),
    )
}

@Composable
internal fun CtrlField(label: String, value: String, onChange: (String) -> Unit) =
    CtrlField(label, value, VisualTransformation.None, onChange)

@Composable
internal fun CtrlField(label: String, value: String, visual: VisualTransformation, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true, modifier = Modifier.fillMaxWidth(),
        visualTransformation = visual,
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
private fun WhitelistCard(base: String?, password: String, hasPassword: Boolean) {
    val scope = rememberCoroutineScope()
    var enabled by remember { mutableStateOf(false) }
    var issisText by remember { mutableStateOf("") }
    var path by remember { mutableStateOf("") }
    var service by remember { mutableStateOf("flowstation.service") }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(true) }

    fun load(announce: Boolean = false) {
        val b = base ?: return
        scope.launch {
            val wl = TetraApi.getWhitelist(b)
            if (wl != null && wl.ok) {
                enabled = wl.enabled
                issisText = wl.issis.joinToString(", ")
                if (wl.path.isNotBlank()) path = wl.path
                if (wl.service.isNotBlank()) service = wl.service
                if (announce) { result = "Datos cargados del config.toml"; ok = true }
            } else if (wl?.message != null) {
                result = wl.message; ok = false
            }
        }
    }
    LaunchedEffect(base) { load() }

    fun save(restart: Boolean) {
        val b = base ?: run { result = "Configura la URL en Ajustes"; ok = false; return }
        if (!hasPassword) { result = "Configura la contraseña en Ajustes"; ok = false; return }
        val issis = Regex("\\d+").findAll(issisText).map { it.value.toInt() }.toList()
        scope.launch {
            busy = true
            val r = TetraApi.setWhitelist(b, password, enabled, issis, path.trim(), service.trim(), restart)
            result = r.message; ok = r.ok; busy = false
        }
    }

    Card {
        Text("LISTA BLANCA ISSI (WHITELIST)", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(
                if (enabled) "Activada · solo estas ISSI se registran" else "Desactivada · red abierta",
                color = if (enabled) Ok else Muted, fontSize = 11.sp, modifier = Modifier.weight(1f),
            )
            Switch(
                checked = enabled, onCheckedChange = { enabled = it },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Surface, checkedTrackColor = Ok,
                    uncheckedTrackColor = SurfaceHi, uncheckedBorderColor = Border,
                ),
            )
        }
        CtrlField("ISSIs permitidas (separadas por coma)", issisText) { issisText = it }
        CtrlField("Ruta config.toml", path) { path = it }
        CtrlField("Servicio a reiniciar", service) { service = it }
        Button(
            onClick = { save(true) }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Surface),
        ) { Text("GUARDAR + REINICIAR", fontWeight = FontWeight.Black, fontSize = 11.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = { save(false) }, enabled = !busy, modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = OnBg),
            ) { Text("SOLO GUARDAR", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            Button(
                onClick = { load(announce = true) }, enabled = base != null && !busy, modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Cyan),
            ) { Text("CARGAR DATOS", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
        }
        result?.let { Text(it, color = if (ok) Ok else Danger, fontWeight = FontWeight.Bold, fontSize = 11.sp) }
    }
}

@Composable
private fun DualCarrierCard(state: TetraState, base: String?, password: String, hasPassword: Boolean) {
    val scope = rememberCoroutineScope()
    val client = LocalTetraClient.current
    var configured by remember { mutableStateOf(false) }
    var enabled by remember { mutableStateOf(false) }
    var secondary by remember { mutableStateOf<Int?>(null) }
    var extra by remember { mutableStateOf<List<Int>>(emptyList()) }
    var path by remember { mutableStateOf("") }
    var service by remember { mutableStateOf("flowstation.service") }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(true) }
    var confirmTo by remember { mutableStateOf<Boolean?>(null) }

    fun load(announce: Boolean = false) {
        val b = base ?: return
        scope.launch {
            val dc = TetraApi.getDualCarrier(b)
            if (dc != null && dc.ok) {
                configured = dc.configured; enabled = dc.enabled; secondary = dc.secondaryCarrier
                extra = dc.extraCarriers
                if (dc.path.isNotBlank()) path = dc.path
                if (dc.service.isNotBlank()) service = dc.service
                if (announce) { result = "Datos cargados del config.toml"; ok = true }
            } else if (dc?.message != null) { result = dc.message; ok = false }
        }
    }
    LaunchedEffect(base) { load() }

    fun apply(newEnabled: Boolean) {
        val b = base ?: run { result = "Configura la URL en Ajustes"; ok = false; return }
        if (!hasPassword) { result = "Configura la contraseña en Ajustes"; ok = false; return }
        scope.launch {
            busy = true
            val r = TetraApi.setDualCarrier(b, password, newEnabled, path.trim(), service.trim(), true)
            result = r.message; ok = r.ok; busy = false
            if (r.ok) { enabled = newEnabled; client?.refreshStation() }
        }
    }

    Card {
        Text("DUAL CARRIER", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
        if (!configured) {
            Text("No hay dual carrier configurado en el config.toml (falta secondary_carrier / dual_carrier_enabled). Botón bloqueado.",
                color = Muted, fontSize = 11.sp)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    buildString {
                        append("Portadoras: principal ${state.btsInfo?.mainCarrier ?: "—"} + secundaria ${secondary ?: "—"}")
                        if (extra.isNotEmpty()) append(" + extra ${extra.joinToString(", ", "[", "]")}")
                    },
                    color = OnBg, fontSize = 12.sp, modifier = Modifier.weight(1f),
                )
                Text(if (enabled) "ACTIVADO" else "DESACTIVADO", color = if (enabled) Ok else Muted,
                    fontSize = 10.sp, fontWeight = FontWeight.Black)
            }
            if (state.carrierAir.isNotEmpty()) {
                Text("Portadoras bajo demanda: " + state.carrierAir.entries.sortedBy { it.key.toIntOrNull() }
                    .joinToString(" · ") { (c, s) -> "$c ${s.uppercase()}" }, color = Muted, fontSize = 10.sp)
            }
            Text("El interruptor solo cambia dual_carrier_enabled; las portadoras y el modo bajo demanda se editan en CALC.",
                color = Muted, fontSize = 10.sp)
        }
        Button(
            onClick = { confirmTo = !enabled },
            enabled = configured && !busy && base != null && hasPassword,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = if (enabled) Warn else Ok, contentColor = Surface),
        ) {
            Text(if (enabled) "DESHABILITAR + REINICIAR" else "ACTIVAR + REINICIAR",
                fontWeight = FontWeight.Black, fontSize = 11.sp)
        }
        Button(
            onClick = { load(announce = true) }, enabled = base != null && !busy, modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Cyan),
        ) { Text("CARGAR DATOS", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
        result?.let { Text(it, color = if (ok) Ok else Danger, fontWeight = FontWeight.Bold, fontSize = 11.sp) }
    }

    confirmTo?.let { to ->
        AlertDialog(
            onDismissRequest = { confirmTo = null },
            containerColor = Surface,
            title = { Text(if (to) "¿Activar dual carrier?" else "¿Deshabilitar dual carrier?", color = OnBg) },
            text = {
                Text("Se escribe dual_carrier_enabled = $to en $path y se reinicia $service: la estación dejará de emitir unos segundos.",
                    color = Muted)
            },
            confirmButton = {
                TextButton(onClick = { confirmTo = null; apply(to) }) {
                    Text(if (to) "ACTIVAR" else "DESHABILITAR", color = if (to) Ok else Warn, fontWeight = FontWeight.Black)
                }
            },
            dismissButton = { TextButton(onClick = { confirmTo = null }) { Text("Cancelar", color = Muted) } },
        )
    }
}

/** BLUE violet, FLOW green, MIURA amber: the web's station colours. */
internal fun stationColor(name: String): Color = when (name) {
    "bluestation" -> Color(0xFFA78BFA)
    "flowstation" -> Ok
    else -> Warn
}

/** BLUE / FLOW / MIURA selector, as the web's StationSwitcher (POST /api/station/switch). */
@Composable
private fun StationCard(state: TetraState, base: String?, password: String, hasPassword: Boolean) {
    val scope = rememberCoroutineScope()
    val client = LocalTetraClient.current
    val st = state.station
    var target by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<StationSwitchResult?>(null) }

    Card {
        Text("ESTACIÓN ACTIVA", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
        if (st == null) {
            Text("Sin datos de /api/station/active todavía.", color = Muted, fontSize = 11.sp)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                StationActive.STATION_NAMES.forEach { name ->
                    val info = st.services[name]
                    val installed = info?.installed == true
                    val isActive = st.station == name
                    val c = stationColor(name)
                    Column(
                        Modifier.weight(1f).alpha(if (installed) 1f else 0.45f).clip(RoundedCornerShape(8.dp))
                            .background(if (isActive) c.copy(alpha = 0.18f) else SurfaceHi)
                            .border(1.dp, if (isActive) c.copy(alpha = 0.7f) else Border, RoundedCornerShape(8.dp))
                            .clickable(enabled = installed && !isActive && !busy && base != null) { result = null; target = name }
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(StationActive.stationLabel(name), color = if (isActive) c else OnBg,
                                fontSize = 13.sp, fontWeight = FontWeight.Black)
                            StatusDot(if (info?.active == true) Ok else Muted.copy(alpha = 0.4f), 7)
                        }
                        Text(
                            when { !installed -> "no instalada"; isActive -> "activa"; info?.active == true -> "en marcha"; else -> "parada" },
                            color = if (isActive) c else Muted, fontSize = 9.sp,
                        )
                    }
                }
            }
            Text("${st.activeService}" + (st.current?.configPath?.ifBlank { null }?.let { " · $it" } ?: ""),
                color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
        }
        if (busy) Text("Cambiando de estación…", color = Cyan, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        result?.let { r ->
            Text((if (r.ok) "✓ " else "✗ ") + r.message, color = if (r.ok) Ok else Danger, fontWeight = FontWeight.Bold, fontSize = 11.sp)
            if (r.log.isNotBlank()) MonoLog(r.log)
        }
    }

    val t = target
    if (t != null && st != null) {
        val targetSvc = st.services[t]?.service?.ifBlank { null } ?: StationActive.STATION_DEFAULT_SERVICE[t].orEmpty()
        val others = StationActive.STATION_NAMES.filter { it != t && st.services[it]?.exists == true }
            .mapNotNull { st.services[it]?.service?.ifBlank { null } }
        AlertDialog(
            onDismissRequest = { target = null },
            containerColor = Surface,
            title = { Text("¿Pasar a ${StationActive.stationLabel(t)}?", color = OnBg) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Se arranca $targetSvc y se paran y deshabilitan las demás" +
                        (if (others.isEmpty()) "." else ": ${others.joinToString(", ")}.") +
                        " La red se corta unos segundos.", color = Muted)
                    if (!hasPassword) Text("Falta la contraseña del sistema (Ajustes).", color = Warn, fontSize = 11.sp)
                }
            },
            confirmButton = {
                TextButton(
                    enabled = hasPassword,
                    onClick = {
                        target = null
                        val b = base ?: return@TextButton
                        scope.launch {
                            busy = true; result = null
                            result = TetraApi.switchStation(b, password, t)
                            busy = false
                            client?.refreshStation()
                        }
                    },
                ) { Text("CAMBIAR", color = stationColor(t), fontWeight = FontWeight.Black) }
            },
            dismissButton = { TextButton(onClick = { target = null }) { Text("Cancelar", color = Muted) } },
        )
    }
}

/** Shortcut to the station's own web dashboard ([dashboard] in config.toml), through the /flow-iframe/ proxy. */
@Composable
private fun StationDashboardButton(state: TetraState, base: String?) {
    val ctx = LocalContext.current
    var status by remember { mutableStateOf<FlowDashboardStatus?>(null) }
    var checked by remember { mutableStateOf(false) }
    LaunchedEffect(base, state.station?.station) {
        status = base?.let { TetraApi.getFlowDashboardStatus(it) }
        checked = true
    }
    val s = status
    val usable = base != null && s != null && s.enabled && s.flowstationActive
    Button(
        onClick = { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$base/flow-iframe/"))) } },
        enabled = usable, modifier = Modifier.fillMaxWidth(),
        colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Ok),
    ) {
        Text("ABRIR DASHBOARD DE LA ESTACIÓN" + (if (usable) " · :${s!!.port} ✓" else ""),
            fontWeight = FontWeight.Bold, fontSize = 11.sp)
    }
    when {
        !checked -> {}
        s == null -> Text("No se pudo consultar el dashboard de la estación.", color = Muted, fontSize = 10.sp)
        !s.flowstationActive -> Text("Solo disponible cuando FLOWSTATION / MIURASTATION es la estación activa.",
            color = Muted, fontSize = 10.sp)
        !s.enabled -> Text("Activa [dashboard] port = 8080 en ${s.configPath.ifBlank { "config.toml" }} y reinicia " +
            "${s.service.ifBlank { "el servicio" }}.", color = Muted, fontSize = 10.sp)
    }
}
