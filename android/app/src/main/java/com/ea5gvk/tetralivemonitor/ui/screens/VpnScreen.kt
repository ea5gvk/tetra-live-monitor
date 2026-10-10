package com.ea5gvk.tetralivemonitor.ui.screens

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.ApiResult
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.VpnClient
import com.ea5gvk.tetralivemonitor.net.VpnStatus
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.OnBg
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.SurfaceHi
import com.ea5gvk.tetralivemonitor.ui.theme.Warn
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** "← VOLVER" bar of the CTRL sub-screens (VPN, WiFi). */
@Composable
internal fun SubHeader(title: String, onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("← VOLVER", color = Cyan, fontSize = 11.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onBack).padding(4.dp))
        Text(title, color = OnBg, fontSize = 13.sp, fontWeight = FontWeight.Black)
    }
}

/** A confirmation step before an action that changes the Pi. */
internal data class Pending(val title: String, val text: String, val verb: String, val danger: Boolean, val run: suspend () -> ApiResult)

@Composable
internal fun PendingDialog(p: Pending?, onDismiss: () -> Unit, onConfirm: (Pending) -> Unit) {
    if (p == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Surface,
        title = { Text(p.title, color = OnBg) },
        text = { Text(p.text, color = Muted) },
        confirmButton = {
            TextButton(onClick = { onConfirm(p) }) { Text(p.verb, color = if (p.danger) Danger else Cyan, fontWeight = FontWeight.Black) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar", color = Muted) } },
    )
}

private fun qrBitmap(text: String, size: Int = 640): Bitmap? = runCatching {
    val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
    val px = IntArray(m.width * m.height) { if (m.get(it % m.width, it / m.width)) 0xFF000000.toInt() else 0xFFFFFFFF.toInt() }
    Bitmap.createBitmap(px, m.width, m.height, Bitmap.Config.ARGB_8888)
}.getOrNull()

/** Hands the client's wg-quick .conf to the WireGuard app (or any other) through the share sheet. */
private fun shareConfig(ctx: Context, name: String, conf: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, "$name.conf")
        putExtra(Intent.EXTRA_TEXT, conf)
    }
    runCatching { ctx.startActivity(Intent.createChooser(send, "Compartir configuración de $name")) }
}

/** WireGuard manager of the Pi, as the web's VpnManager (/api/vpn/...). */
@Composable
fun VpnScreen(base: String?, password: String, hasPassword: Boolean, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var status by remember { mutableStateOf<VpnStatus?>(null) }
    var clients by remember { mutableStateOf<List<VpnClient>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    var msgOk by remember { mutableStateOf(true) }
    var pending by remember { mutableStateOf<Pending?>(null) }
    var addr by remember { mutableStateOf("10.8.0.1/24") }
    var port by remember { mutableStateOf("51820") }
    var dns by remember { mutableStateOf("8.8.8.8") }
    var newClient by remember { mutableStateOf("") }
    var qr by remember { mutableStateOf<Pair<String, String>?>(null) } // name to config

    fun load() {
        val b = base ?: return
        scope.launch {
            loading = true
            coroutineScope {
                val s = async { TetraApi.getVpnStatus(b) }
                val c = async { TetraApi.getVpnClients(b) }
                status = s.await()
                c.await()?.let { clients = it }
            }
            status?.let { st ->
                st.serverAddress?.let { addr = it }
                st.serverPort?.let { port = it.toString() }
                st.clientDns?.let { dns = it }
            }
            loading = false
        }
    }
    LaunchedEffect(base) { load() }

    fun run(p: Pending) {
        pending = null
        if (base == null) return
        if (!hasPassword) { msg = "Configura la contraseña en Ajustes"; msgOk = false; return }
        scope.launch {
            busy = true
            val r = p.run()
            msg = r.message; msgOk = r.ok; busy = false
            load()
        }
    }

    fun fetchConfig(name: String, then: (String) -> Unit) {
        val b = base ?: return
        if (!hasPassword) { msg = "Configura la contraseña en Ajustes"; msgOk = false; return }
        scope.launch {
            busy = true
            val conf = TetraApi.getVpnClientConfig(b, password, name)
            busy = false
            if (conf == null) { msg = "Error al obtener la configuración de $name"; msgOk = false } else then(conf)
        }
    }

    if (base == null) {
        Column(Modifier.fillMaxWidth()) {
            SubHeader("VPN WIREGUARD", onBack)
            Text("Configura la URL en Ajustes.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(12.dp))
        }
        return
    }
    Column(Modifier.fillMaxWidth()) {
        SubHeader("VPN WIREGUARD", onBack)
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val st = status
            val installed = st?.installed == true
            val configured = st?.configured == true

            Card {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("ESTADO VPN", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text(if (loading) "…" else "ACTUALIZAR", color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable(enabled = !loading) { load() }.padding(4.dp))
                }
                if (st == null) {
                    Text(if (loading) "Cargando…" else "No se pudo leer el estado de la VPN.", color = Muted, fontSize = 11.sp)
                } else {
                    InfoRow("Instalado", if (installed) "Sí" else "No", if (installed) Ok else Muted)
                    InfoRow("Activo", if (st.active) "Sí" else "No", if (st.active) Ok else Muted)
                    st.wgInfo?.let { wg ->
                        InfoRow("Interfaz", wg.iface.ifBlank { "wg0" }, OnBg)
                        wg.listenPort?.let { InfoRow("Puerto de escucha", it.toString(), OnBg) }
                        InfoRow("Pares", "${wg.peers.size}", OnBg)
                    }
                    st.serverAddress?.let { InfoRow("IP del servidor", it, OnBg) }
                    st.serverPort?.let { InfoRow("Puerto", "$it/UDP", OnBg) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    if (st != null && !installed) {
                        ActionButton("INSTALAR WIREGUARD", Cyan, !busy, Modifier.weight(1f)) {
                            pending = Pending("¿Instalar WireGuard?", "Se instalan wireguard, wireguard-tools e iptables con apt-get en segundo plano (~1-2 min). Pulsa ACTUALIZAR después.",
                                "INSTALAR", false) { TetraApi.vpnAction(base, password, "install") }
                        }
                    }
                    if (installed && configured && !st!!.active) {
                        ActionButton("CONECTAR", Ok, !busy, Modifier.weight(1f)) {
                            pending = Pending("¿Activar WireGuard VPN?", "Se levanta wg0 (wg-quick up).", "CONECTAR", false) {
                                TetraApi.vpnAction(base, password, "connect")
                            }
                        }
                    }
                    if (installed && st!!.active) {
                        ActionButton("DESCONECTAR", Warn, !busy, Modifier.weight(1f)) {
                            pending = Pending("¿Detener WireGuard VPN?",
                                "Se baja wg0 (wg-quick down). Si la app llega a la Pi por esta VPN, perderás la conexión.",
                                "DESCONECTAR", true) { TetraApi.vpnAction(base, password, "disconnect") }
                        }
                    }
                }
                if (installed) {
                    ActionButton("DESINSTALAR WIREGUARD", Danger, !busy, Modifier.fillMaxWidth()) {
                        pending = Pending("¿Desinstalar WireGuard?",
                            "Se eliminará la configuración y todos los datos de clientes. Si la app llega a la Pi por esta VPN, perderás la conexión.",
                            "DESINSTALAR", true) { TetraApi.vpnAction(base, password, "uninstall") }
                    }
                }
                if (!hasPassword) Text("Falta la contraseña del sistema (Ajustes).", color = Warn, fontSize = 10.sp)
                msg?.let { Text(it, color = if (msgOk) Ok else Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            }

            Card {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("CONFIGURACIÓN DEL SERVIDOR", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
                    if (configured) Text("CONFIGURADO", color = Ok, fontSize = 9.sp, fontWeight = FontWeight.Black)
                }
                if (!installed) {
                    Text("Instala WireGuard primero. Tardará ~1-2 min.", color = Muted, fontSize = 11.sp)
                } else {
                    st?.serverPublicKey?.let {
                        Text("Clave pública del servidor", color = Muted, fontSize = 10.sp)
                        Text(it, color = OnBg, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                    }
                    CtrlField("IP WireGuard del servidor", addr, { addr = it.trim() })
                    CtrlField("Puerto de escucha", port, { port = it.filter(Char::isDigit).take(5) })
                    CtrlField("DNS para clientes", dns, { dns = it.trim() })
                    ActionButton(if (configured) "RECONFIGURAR" else "CONFIGURAR SERVIDOR", if (configured) Warn else Cyan, !busy, Modifier.fillMaxWidth()) {
                        val p = port.toIntOrNull() ?: 51820
                        pending = if (configured) Pending("¿Reconfigurar el servidor VPN?",
                            "Se regenerarán las claves del servidor: los clientes actuales tendrán que volver a importar su configuración.",
                            "RECONFIGURAR", true) { TetraApi.vpnSetup(base, password, addr, p, dns) }
                        else Pending("¿Configurar el servidor VPN?", "Se generan las claves y /etc/wireguard/wg0.conf ($addr, puerto $p).",
                            "CONFIGURAR", false) { TetraApi.vpnSetup(base, password, addr, p, dns) }
                    }
                    Text("El puerto ${port.ifBlank { "51820" }} UDP debe estar abierto en el router (reenvío a la IP local de la Pi).",
                        color = Muted, fontSize = 10.sp)
                }
            }

            Card {
                Text("CLIENTES VPN (${clients.size})", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
                if (!configured) {
                    Text("Configura el servidor primero.", color = Muted, fontSize = 11.sp)
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            CtrlField("Nombre del cliente (ej: movil, tablet)", newClient,
                                { newClient = it.filter { c -> c.isLetterOrDigit() && c.code < 128 || c == '_' || c == '-' } })
                        }
                        ActionButton("AÑADIR", Ok, !busy && newClient.isNotBlank(), Modifier) {
                            val n = newClient
                            if (!hasPassword) { msg = "Configura la contraseña en Ajustes"; msgOk = false; return@ActionButton }
                            scope.launch {
                                busy = true
                                val r = TetraApi.vpnAddClient(base, password, n)
                                msg = r.message; msgOk = r.ok; busy = false
                                if (r.ok) { newClient = ""; load() }
                            }
                        }
                    }
                    Text("Para conectarte: comparte la configuración a la app WireGuard o escanea el QR desde otro equipo.",
                        color = Muted, fontSize = 10.sp)
                }
                if (configured && clients.isEmpty()) Text("No hay clientes. Añade uno arriba.", color = Muted, fontSize = 11.sp)
                clients.forEach { c ->
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(c.name, color = OnBg, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            Text(c.address, color = Muted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            ActionButton("COMPARTIR", Cyan, !busy, Modifier.weight(1f)) { fetchConfig(c.name) { shareConfig(ctx, c.name, it) } }
                            ActionButton("VER QR", Cyan, !busy, Modifier.weight(1f)) { fetchConfig(c.name) { qr = c.name to it } }
                            ActionButton("BORRAR", Danger, !busy, Modifier.weight(1f)) {
                                pending = Pending("¿Eliminar el cliente ${c.name}?",
                                    "Su configuración dejará de funcionar y habrá que crear otra.", "ELIMINAR", true) {
                                    TetraApi.vpnDeleteClient(base, password, c.name)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    PendingDialog(pending, onDismiss = { pending = null }) { run(it) }

    qr?.let { (name, conf) ->
        val bmp = remember(conf) { qrBitmap(conf) }
        AlertDialog(
            onDismissRequest = { qr = null },
            containerColor = Surface,
            title = { Text("Cliente $name", color = OnBg) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (bmp != null) {
                        Image(bmp.asImageBitmap(), contentDescription = "QR de $name",
                            modifier = Modifier.fillMaxWidth().aspectRatio(1f).background(Color.White))
                    } else {
                        Text("No se pudo generar el QR.", color = Danger)
                    }
                    Text("Escanéalo con la app WireGuard de otro equipo.", color = Muted, fontSize = 11.sp)
                }
            },
            confirmButton = { TextButton(onClick = { shareConfig(ctx, name, conf) }) { Text("COMPARTIR", color = Cyan, fontWeight = FontWeight.Black) } },
            dismissButton = { TextButton(onClick = { qr = null }) { Text("Cerrar", color = Muted) } },
        )
    }
}

@Composable
internal fun InfoRow(label: String, value: String, color: Color) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, color = Muted, fontSize = 11.sp, modifier = Modifier.weight(1f))
        Text(value, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
    }
}

@Composable
internal fun ActionButton(label: String, color: Color, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier,
        colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = color),
    ) { Text(label, fontWeight = FontWeight.Black, fontSize = 10.sp, maxLines = 1) }
}
