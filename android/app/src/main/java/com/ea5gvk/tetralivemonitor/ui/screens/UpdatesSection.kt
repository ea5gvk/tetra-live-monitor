package com.ea5gvk.tetralivemonitor.ui.screens

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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.UpdateCheck
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Selectable source of an updater (only the public Flowstation: razvan main / ea5gvk miura). */
private data class UpdSource(val id: String, val label: String, val repo: String)

/** One button of the web dashboard's update bar, mirrored in the app (same endpoints). */
private data class Updater(
    val key: String,
    val title: String,
    val repo: String,
    val checkPath: String,
    val applyPath: String,
    val installPath: String? = null,
    val restartsDashboard: Boolean = false,
    val sources: List<UpdSource> = emptyList(),
)

private val UPDATERS = listOf(
    Updater("bluestation", "BLUESTATION", "MidnightBlueLabs/tetra-bluestation · main",
        "/api/bluestation/check", "/api/bluestation/apply"),
    Updater("flowstation", "FLOWSTATION", "",
        "/api/flowstation/check", "/api/flowstation/apply", "/api/flowstation/install",
        sources = listOf(
            UpdSource("razvan", "Original", "razvanzeces/flowstation · main"),
            UpdSource("miura", "EA5GVK", "ea5gvk/flowstation · miura"),
        )),
    Updater("dashboard", "DASHBOARD", "ea5gvk/tetra-live-monitor · main",
        "/api/update/check", "/api/update/apply", restartsDashboard = true),
)

private val EXIT_RE = Regex("""\[Exit: (-?\d+)]""")

/** "ACTUALIZACIONES" block of the Control tab: check + update/install each component. */
@Composable
fun UpdatesSection(base: String?, password: String, hasPassword: Boolean) {
    // Only one updater may run at a time (they share the SDR/services on the Pi).
    var running by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("ACTUALIZACIONES", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
        Text("Los mismos botones que la web: comprueba y actualiza cada componente en la Pi.",
            color = Muted, fontSize = 10.sp)
        UPDATERS.forEach { u ->
            UpdaterCard(u, base, password, hasPassword, running) { running = it }
        }
    }
}

@Composable
private fun UpdaterCard(
    u: Updater, base: String?, password: String, hasPassword: Boolean,
    running: String?, setRunning: (String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<UpdateCheck?>(null) }
    var checking by remember { mutableStateOf(false) }
    var source by remember { mutableStateOf<String?>(null) }
    var log by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(true) }
    var confirm by remember { mutableStateOf(false) }
    val busy = running == u.key

    // src == null → the server answers for the source currently installed (and we adopt it).
    fun check(src: String?) {
        val b = base ?: return
        scope.launch {
            checking = true
            val q = if (u.sources.isNotEmpty() && src != null) "?source=$src" else ""
            val c = TetraApi.checkUpdate(b, u.checkPath + q)
            info = c
            if (u.sources.isNotEmpty() && src == null) source = c?.active ?: u.sources.first().id
            checking = false
        }
    }
    LaunchedEffect(base) { check(null) }

    val install = info?.dirNotFound == true && u.installPath != null
    val repo = u.sources.firstOrNull { it.id == source }?.repo ?: u.repo

    fun run() {
        val b = base ?: return
        val path = if (install) u.installPath!! else u.applyPath
        val body = buildJsonObject {
            put("password", password)
            source?.let { if (u.sources.isNotEmpty()) put("source", it) }
        }
        setRunning(u.key); log = ""; result = null
        scope.launch {
            var exit: Int? = null
            try {
                TetraApi.streamPost(b, path, body).collect { line ->
                    log = (log + line + "\n").takeLast(20_000)
                    EXIT_RE.find(line)?.let { exit = it.groupValues[1].toIntOrNull() }
                }
                ok = exit == null || exit == 0
                result = if (ok) "✓ Terminado" else "✗ Falló (código $exit)"
            } catch (e: Exception) {
                // Update Dashboard ends with `pm2 restart`: the connection drops mid-stream by design.
                if (u.restartsDashboard && log.length > 50) {
                    ok = true; result = "✓ El dashboard se está reiniciando; la app se reconecta sola."
                } else {
                    ok = false; result = e.message ?: "Error"
                }
            }
            setRunning(null)
            if (u.restartsDashboard) delay(8000)
            check(null)
        }
    }

    val i = info
    val (status, color) = when {
        base == null -> "Configura la URL en Ajustes" to Muted
        i == null -> (if (checking) "Comprobando…" else "No se pudo comprobar") to (if (checking) Muted else Danger)
        i.demo -> "Modo demo (sin git en el servidor)" to Warn
        i.dirNotFound -> (if (u.installPath != null) "No instalado — puedes instalarlo" else "No instalado en la Pi") to Warn
        i.switching -> "Cambiar a esta versión · ${i.remoteHash}" to Cyan
        i.upToDate == true -> "Al día · ${i.localHash}" to Ok
        else -> "Nueva versión disponible" to Cyan
    }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(u.title, color = OnBg, fontWeight = FontWeight.Black, fontSize = 12.sp)
            Text(repo, color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
        }
        if (u.sources.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                u.sources.forEach { s ->
                    val sel = source == s.id
                    val active = i?.active == s.id
                    Text(
                        s.label + if (active) " · activa" else "",
                        color = if (sel) Cyan else Muted, fontSize = 10.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp))
                            .background(if (sel) Cyan.copy(alpha = 0.15f) else Surface)
                            .border(1.dp, if (sel) Cyan.copy(alpha = 0.6f) else Border, RoundedCornerShape(6.dp))
                            .clickable(enabled = running == null) { source = s.id; check(s.id) }
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                    )
                }
            }
        }
        Text(status, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        if (i != null && !i.demo && !i.dirNotFound && i.upToDate != true) {
            if (i.remoteMessage.isNotBlank()) Text(i.remoteMessage, color = OnBg, fontSize = 10.sp, maxLines = 2)
            if (i.localHash.isNotBlank()) Text("local ${i.localHash} → remoto ${i.remoteHash}",
                color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
        }
        i?.apiError?.let { Text(it, color = Danger, fontSize = 9.sp, maxLines = 2) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = { check(if (u.sources.isNotEmpty()) source else null) },
                enabled = base != null && running == null && !checking, modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Surface, contentColor = Cyan),
            ) { Text(if (checking) "…" else "COMPROBAR", fontWeight = FontWeight.Bold, fontSize = 10.sp) }
            val hasNew = i?.upToDate == false || i?.switching == true || install
            Button(
                onClick = { confirm = true },
                enabled = base != null && hasPassword && running == null && i != null && !i.demo &&
                    !(i.dirNotFound && u.installPath == null),
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (hasNew) Cyan else Surface, contentColor = if (hasNew) Surface else OnBg,
                ),
            ) {
                Text(
                    when { busy -> "EN CURSO…"; install -> "INSTALAR"; i?.switching == true -> "CAMBIAR VERSIÓN"; else -> "ACTUALIZAR" },
                    fontWeight = FontWeight.Black, fontSize = 10.sp,
                )
            }
        }
        if (!hasPassword) Text("Falta la contraseña del sistema (Ajustes).", color = Warn, fontSize = 9.sp)
        if (log.isNotEmpty()) {
            val scroll = rememberScrollState()
            LaunchedEffect(log) { scroll.scrollTo(scroll.maxValue) }
            Text(
                log, color = Color(0xFF86EFAC), fontSize = 9.sp, fontFamily = FontFamily.Monospace,
                modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp).clip(RoundedCornerShape(6.dp))
                    .background(Color(0xFF05070C)).verticalScroll(scroll).padding(6.dp),
            )
        }
        result?.let { Text(it, color = if (ok) Ok else Danger, fontWeight = FontWeight.Bold, fontSize = 11.sp) }
    }

    if (confirm) {
        val verb = when { install -> "Instalar"; i?.switching == true -> "Cambiar de versión"; else -> "Actualizar" }
        AlertDialog(
            onDismissRequest = { confirm = false },
            containerColor = Surface,
            title = { Text("¿$verb ${u.title}?", color = OnBg) },
            text = {
                Text(
                    if (u.restartsDashboard) "Se descarga el código, se recompila y se reinicia el dashboard. La app perderá la conexión unos segundos."
                    else "Se descarga el código ($repo), se recompila y se reinicia el servicio si estaba activo. Puede tardar varios minutos.",
                    color = Muted,
                )
            },
            confirmButton = {
                TextButton(onClick = { confirm = false; run() }) { Text(verb.uppercase(), color = Cyan, fontWeight = FontWeight.Black) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancelar", color = Muted) } },
        )
    }
}
