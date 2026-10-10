package com.ea5gvk.tetralivemonitor.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.WifiNetwork
import com.ea5gvk.tetralivemonitor.net.WifiSaved
import com.ea5gvk.tetralivemonitor.net.WifiStatus
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.OnBg
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.SurfaceHi
import com.ea5gvk.tetralivemonitor.ui.theme.Warn
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

private fun isOpen(security: String) = security.isBlank() || security == "--"

/** WiFi of the Pi, as the web's WifiManager (/api/wifi/...): read-only until unlocked with the system password. */
@Composable
fun WifiScreen(base: String?, password: String, hasPassword: Boolean, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<WifiStatus?>(null) }
    var networks by remember { mutableStateOf<List<WifiNetwork>?>(null) }
    var saved by remember { mutableStateOf<List<WifiSaved>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var unlocked by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    var msgOk by remember { mutableStateOf(true) }
    var pending by remember { mutableStateOf<Pending?>(null) }
    var connectTo by remember { mutableStateOf<WifiNetwork?>(null) }
    var wifiPw by remember { mutableStateOf("") }

    fun load() {
        val b = base ?: return
        scope.launch {
            loading = true
            coroutineScope {
                val s = async { TetraApi.getWifiStatus(b) }
                val v = async { TetraApi.wifiSaved(b) }
                status = s.await()
                v.await()?.let { saved = it }
            }
            loading = false
        }
    }
    LaunchedEffect(base) { load() }

    fun act(p: Pending) {
        pending = null
        scope.launch {
            busy = true
            val r = p.run()
            msg = r.message; msgOk = r.ok; busy = false
            load()
        }
    }

    if (base == null) {
        Column(Modifier.fillMaxWidth()) {
            SubHeader("WIFI DE LA PI", onBack)
            Text("Configura la URL en Ajustes.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(12.dp))
        }
        return
    }
    val st = status
    val current = st?.ssid?.takeIf { st.connected && it.isNotBlank() }
    val lossWarning = current?.let { "Si la app llega a la Pi por esta WiFi ($it), perderás la conexión con ella." } ?: ""

    Column(Modifier.fillMaxWidth()) {
        SubHeader("WIFI DE LA PI", onBack)
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("ESTADO WIFI", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text(if (loading) "…" else "ACTUALIZAR", color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable(enabled = !loading) { load() }.padding(4.dp))
                }
                when {
                    st == null -> Text(if (loading) "Cargando…" else "No se pudo leer el estado de la WiFi.", color = Muted, fontSize = 11.sp)
                    st.demo -> Text("nmcli no está disponible en este servidor: aquí no se puede gestionar la WiFi.", color = Warn, fontSize = 11.sp)
                    !st.connected -> Text("Sin conexión WiFi", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    else -> {
                        InfoRow("Conectado a", st.ssid, Ok)
                        InfoRow("Señal", "${st.signal}%", OnBg)
                        InfoRow("Seguridad", st.security.ifBlank { "—" }, OnBg)
                        InfoRow("Interfaz", st.iface.ifBlank { "wlan0" }, OnBg)
                        if (st.ip.isNotBlank()) InfoRow("Dirección IP", st.ip, OnBg)
                    }
                }
                if (!unlocked) {
                    Text("Solo lectura: desbloquea para hacer cambios.", color = Muted, fontSize = 10.sp)
                    ActionButton("DESBLOQUEAR", Cyan, hasPassword && !busy, Modifier.fillMaxWidth()) {
                        scope.launch {
                            busy = true
                            when (TetraApi.verifyPassword(base, password)) {
                                true -> { unlocked = true; msg = "WiFi desbloqueado"; msgOk = true }
                                false -> { msg = "Contraseña incorrecta (revísala en Ajustes)"; msgOk = false }
                                null -> { msg = "El servidor no responde"; msgOk = false }
                            }
                            busy = false
                        }
                    }
                    if (!hasPassword) Text("Falta la contraseña del sistema (Ajustes).", color = Warn, fontSize = 10.sp)
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        if (current != null) {
                            ActionButton("DESCONECTAR", Warn, !busy, Modifier.weight(1f)) {
                                pending = Pending("¿Desconectar del WiFi?", "La Pi se desconecta de $current. $lossWarning",
                                    "DESCONECTAR", true) { TetraApi.wifiDisconnect(base, password) }
                            }
                        }
                        ActionButton("BLOQUEAR", Muted, !busy, Modifier.weight(1f)) { unlocked = false; msg = "WiFi bloqueado"; msgOk = true }
                    }
                }
                msg?.let { Text(it, color = if (msgOk) Ok else Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            }

            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("REDES DISPONIBLES", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    ActionButton(if (scanning) "ESCANEANDO…" else "ESCANEAR", Cyan, !scanning && st?.demo != true, Modifier) {
                        scope.launch {
                            scanning = true
                            networks = TetraApi.wifiScan(base) ?: emptyList()
                            scanning = false
                        }
                    }
                }
                val nets = networks
                when {
                    nets == null -> Text("Pulsa ESCANEAR (tarda unos 20 s).", color = Muted, fontSize = 11.sp)
                    nets.isEmpty() -> Text("No se encontraron redes.", color = Muted, fontSize = 11.sp)
                    else -> nets.forEach { n ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi)
                                .border(1.dp, if (n.active) Ok.copy(alpha = 0.6f) else Border, RoundedCornerShape(8.dp))
                                .clickable(enabled = unlocked && !n.active && !busy) { wifiPw = ""; connectTo = n }
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(n.ssid, color = OnBg, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Text(
                                    (if (isOpen(n.security)) "Abierta" else n.security) + (n.freq.ifBlank { null }?.let { " · $it" } ?: ""),
                                    color = Muted, fontSize = 10.sp,
                                )
                            }
                            if (n.active) Text("CONECTADO", color = Ok, fontSize = 9.sp, fontWeight = FontWeight.Black)
                            Text("${n.signal}%", color = if (n.signal >= 60) Ok else if (n.signal >= 30) Warn else Danger,
                                fontSize = 11.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                if (!unlocked && !nets.isNullOrEmpty()) Text("Desbloquea para conectar a una red.", color = Muted, fontSize = 10.sp)
            }

            Card {
                Text("REDES GUARDADAS (${saved.size})", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
                if (saved.isEmpty()) Text("No hay redes guardadas.", color = Muted, fontSize = 11.sp)
                saved.forEach { s ->
                    val inUse = s.name == current
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(s.name, color = OnBg, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        if (inUse) Text("EN USO", color = Ok, fontSize = 9.sp, fontWeight = FontWeight.Black)
                        ActionButton("OLVIDAR", Danger, unlocked && !busy, Modifier) {
                            pending = Pending("¿Olvidar ${s.name}?",
                                "Se borra la conexión guardada y su contraseña." + if (inUse) " Es la red en uso: $lossWarning" else "",
                                "OLVIDAR", true) { TetraApi.wifiForget(base, password, s.name) }
                        }
                    }
                }
            }
        }
    }

    PendingDialog(pending, onDismiss = { pending = null }) { act(it) }

    connectTo?.let { n ->
        val open = isOpen(n.security)
        AlertDialog(
            onDismissRequest = { connectTo = null },
            containerColor = Surface,
            title = { Text("¿Conectar a ${n.ssid}?", color = OnBg) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!open) CtrlField("Contraseña WiFi", wifiPw, PasswordVisualTransformation()) { wifiPw = it }
                    else Text("Red abierta, sin contraseña.", color = Muted, fontSize = 11.sp)
                    if (current != null) Text("La Pi dejará $current. $lossWarning", color = Warn, fontSize = 11.sp)
                }
            },
            confirmButton = {
                TextButton(
                    enabled = open || wifiPw.isNotEmpty(),
                    onClick = {
                        connectTo = null
                        val pw = if (open) "" else wifiPw
                        act(Pending("", "", "", false) { TetraApi.wifiConnect(base, password, n.ssid, pw) })
                    },
                ) { Text("CONECTAR", color = Cyan, fontWeight = FontWeight.Black) }
            },
            dismissButton = { TextButton(onClick = { connectTo = null }) { Text("Cancelar", color = Muted) } },
        )
    }
}
