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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.platform.LocalContext
import com.ea5gvk.tetralivemonitor.net.DmrCheck
import com.ea5gvk.tetralivemonitor.net.LocalTetraClient
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.UpdateCheck
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Selectable source of an updater (razvan's FlowStation / MiuraStation, each in its own directory and unit). */
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
    Updater("flowstation", "FLOWSTATION / MIURASTATION", "",
        "/api/flowstation/check", "/api/flowstation/apply", "/api/flowstation/install",
        sources = listOf(
            UpdSource("razvan", "FlowStation", "razvanzeces/flowstation · main"),
            UpdSource("miura", "MiuraStation", "ea5gvk/MiuraStation-dist · paquete .deb"),
        )),
    Updater("dashboard", "DASHBOARD", "ea5gvk/tetra-live-monitor · main",
        "/api/update/check", "/api/update/apply", restartsDashboard = true),
)

private val EXIT_RE = Regex("""\[Exit: (-?\d+)]""")

private const val ARCH_NOTE = "arm64: Raspberry Pi 3/4/5 con sistema de 64 bits; amd64: PC con Debian 12/13 o Ubuntu 22.04/24.04."

/**
 * "ACTUALIZACIONES" block of the Control tab: check + update/install each component.
 * [checks] are TetraClient's checks (at connect and hourly): shown first, so entering CTRL runs nothing on the Pi.
 */
@Composable
fun UpdatesSection(
    base: String?, password: String, hasPassword: Boolean,
    checks: Map<String, UpdateCheck> = emptyMap(), dmrCheck: DmrCheck? = null,
) {
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
            UpdaterCard(u, base, password, hasPassword, running, checks[u.key]) { running = it }
        }
        DmrUpdaterCard(base, password, hasPassword, running, dmrCheck) { running = it }
    }
}

/**
 * The dmr-tier3 package (DMR Tier III / Tier II) from ea5gvk/MiuraStation-dist: /api/dmr/check, /api/dmr/install,
 * /api/dmr/apply (an optional version picks another release, also an older one). Nothing is started here: the
 * station selector and CONFIG DMR do that.
 */
@Composable
private fun DmrUpdaterCard(
    base: String?, password: String, hasPassword: Boolean,
    running: String?, polled: DmrCheck?, setRunning: (String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val client = LocalTetraClient.current
    var info by remember { mutableStateOf<DmrCheck?>(null) }
    var checking by remember { mutableStateOf(false) }
    var version by remember { mutableStateOf("") }
    var log by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(true) }
    var confirm by remember { mutableStateOf(false) }
    val busy = running == "dmr"
    LaunchedEffect(polled) { if (polled != null) info = polled }

    fun check() {
        val b = base ?: return
        scope.launch { checking = true; TetraApi.getDmrCheck(b)?.let { info = it }; checking = false }
    }
    val i = info
    val install = i != null && !i.installed
    val wanted = version.trim().removePrefix("v")
    val versionOk = wanted.isEmpty() || Regex("""^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$""").matches(wanted)

    fun run() {
        val b = base ?: return
        val body = buildJsonObject { put("password", password); if (wanted.isNotEmpty()) put("version", wanted) }
        setRunning("dmr"); log = ""; result = null
        scope.launch {
            var exit: Int? = null
            try {
                TetraApi.streamPost(b, if (install) "/api/dmr/install" else "/api/dmr/apply", body).collect { line ->
                    log = (log + line + "\n").takeLast(20_000)
                    EXIT_RE.find(line)?.let { exit = it.groupValues[1].toIntOrNull() }
                }
                ok = exit == null || exit == 0
                result = if (ok) "✓ Terminado" else "✗ Falló (código $exit)"
            } catch (e: Exception) {
                ok = false; result = e.message?.let { if (it == "dmr_not_installed") "La pila DMR no está instalada" else it } ?: "Error"
            }
            setRunning(null)
            check()
            client?.refreshStation()
        }
    }

    val (status, color) = when {
        base == null -> "Configura la URL en Ajustes" to Muted
        i == null -> (if (checking) "Comprobando…" else "Sin datos (pulsa COMPROBAR)") to Muted
        i.demo -> "Modo demo (el servidor no es Linux)" to Warn
        i.apiError != null && i.release == null -> "No se ha podido consultar GitHub" to Danger
        i.noReleases -> "Sin versiones publicadas" to Muted
        !i.installed -> "No instalada — puedes instalarla" to Warn
        i.upToDate -> "Al día · ${i.version}" to Ok
        else -> "Nueva versión disponible · ${i.version} → ${i.release?.version}" to Cyan
    }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("DMR TIER III / II", color = OnBg, fontWeight = FontWeight.Black, fontSize = 12.sp)
            when {
                i?.hasUpdate == true -> StatusDot(Cyan)
                install -> StatusDot(Warn)
            }
            Text("${i?.repo?.ifBlank { null } ?: "ea5gvk/MiuraStation-dist"} · paquete dmr-tier3", color = Muted, fontSize = 9.sp,
                fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
        }
        Text(status, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        i?.release?.let { r ->
            Text("última publicada: ${r.tag}" + (if (r.prerelease) " (pre-release)" else "") + r.date.take(10).let { if (it.isBlank()) "" else " · $it" },
                color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
        }
        i?.state?.takeIf { i.installed }?.let { s ->
            Text("dmr-tier3.target: " + when {
                s.degraded -> "a medias (falta ${s.missing.joinToString(", ")})"
                s.active -> "en marcha"
                else -> "parada"
            } + (if (!i.configExists) " · sin dmr-tier3.conf" else ""), color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace)
        }
        i?.apiError?.let { Text(it, color = Danger, fontSize = 9.sp, maxLines = 2) }
        i?.release?.url?.takeIf { it.isNotBlank() }?.let { url ->
            Text(
                "Ver release ↗", color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
            )
        }
        if (i != null && !i.demo) {
            OutlinedTextField(
                value = version, onValueChange = { version = it.trim() }, singleLine = true,
                enabled = running == null, modifier = Modifier.fillMaxWidth(),
                label = { Text("Versión (vacío = la última publicada)", fontSize = 10.sp) },
                isError = !versionOk,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Cyan, unfocusedBorderColor = Border,
                    focusedTextColor = OnBg, unfocusedTextColor = OnBg, cursorColor = Cyan,
                    focusedLabelColor = Cyan, unfocusedLabelColor = Muted,
                ),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = { check() }, enabled = base != null && running == null && !checking, modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Surface, contentColor = Cyan),
            ) { Text(if (checking) "…" else "COMPROBAR", fontWeight = FontWeight.Bold, fontSize = 10.sp) }
            val hasNew = i?.hasUpdate == true || install || wanted.isNotEmpty()
            Button(
                onClick = { confirm = true },
                enabled = base != null && hasPassword && running == null && i != null && !i.demo && versionOk &&
                    (i.release != null || wanted.isNotEmpty()),
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (hasNew) Cyan else Surface, contentColor = if (hasNew) Surface else OnBg,
                ),
            ) { Text(if (busy) "EN CURSO…" else if (install) "INSTALAR" else "ACTUALIZAR", fontWeight = FontWeight.Black, fontSize = 10.sp) }
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
        val what = if (wanted.isNotEmpty()) "la versión $wanted" else "la última versión publicada"
        AlertDialog(
            onDismissRequest = { confirm = false },
            containerColor = Surface,
            title = { Text(if (install) "¿Instalar la pila DMR?" else "¿Actualizar la pila DMR?", color = OnBg) },
            text = {
                Text(
                    if (install) "Se descarga el paquete dmr-tier3 ($what de ea5gvk/MiuraStation-dist, arm64), se comprueba su SHA-256 y se instala con apt-get. No se arranca nada: después configúrala en DMR → CONFIG y actívala con el selector de estación."
                    else "Se descarga el paquete dmr-tier3 ($what), se comprueba su SHA-256 y se instala con apt-get. Si la pila está en marcha, el paquete la reinicia (la DMR se corta unos segundos). Actualiza antes el dashboard si la versión nueva lo pide.",
                    color = Muted,
                )
            },
            confirmButton = {
                TextButton(onClick = { confirm = false; run() }) { Text(if (install) "INSTALAR" else "ACTUALIZAR", color = Cyan, fontWeight = FontWeight.Black) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancelar", color = Muted) } },
        )
    }
}

@Composable
private fun UpdaterCard(
    u: Updater, base: String?, password: String, hasPassword: Boolean,
    running: String?, polled: UpdateCheck?, setRunning: (String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val client = LocalTetraClient.current
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
    // The shared check (flowstation: the source in use) unless another source was picked here.
    LaunchedEffect(base, polled) {
        when {
            polled == null -> if (info == null) check(null)
            u.sources.isEmpty() || source == null || source == polled.active -> {
                info = polled
                if (u.sources.isNotEmpty()) source = polled.active ?: u.sources.first().id
            }
        }
    }

    val install = info?.dirNotFound == true && u.installPath != null
    val repo = u.sources.firstOrNull { it.id == source }?.repo ?: u.repo
    val miura = source == "miura"
    val migrateSource = info?.needsMigration == true && info?.migrationKind == "source"
    val title = when (info?.product) {
        "MiuraStation" -> "MIURASTATION"
        "FlowStation" -> "FLOWSTATION"
        else -> u.title
    }

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
            check(if (u.sources.isNotEmpty()) source else null)
            // The CTRL badge and the station selector follow what was installed / updated.
            client?.refreshUpdates()
            client?.refreshStation()
        }
    }

    val i = info
    val (status, color) = when {
        base == null -> "Configura la URL en Ajustes" to Muted
        i == null -> (if (checking) "Comprobando…" else "No se pudo comprobar") to (if (checking) Muted else Danger)
        i.demo -> "Modo demo (sin git en el servidor)" to Warn
        i.dirNotFound -> (if (u.installPath != null) "No instalado — puedes instalarlo" else "No instalado en la Pi") to Warn
        i.needsMigration && migrateSource -> "Pasar MiuraStation compilada al paquete .deb · ${i.remoteHash}" to Warn
        i.needsMigration -> "Migrar la FlowStation miura a MiuraStation · ${i.remoteHash}" to Warn
        i.switching -> "Cambiar a esta versión · ${i.remoteHash}" to Cyan
        i.upToDate == true -> "Al día · ${i.localHash}" to Ok
        else -> "Nueva versión disponible" to Cyan
    }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, color = OnBg, fontWeight = FontWeight.Black, fontSize = 12.sp)
            // Same dots as the web's navbar button: update available / not installed.
            when {
                i?.hasUpdate == true -> StatusDot(Cyan)
                i?.dirNotFound == true && u.installPath != null -> StatusDot(Warn)
            }
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
        if (miura && (install || i?.needsMigration == true)) Text(ARCH_NOTE, color = Warn, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        i?.releaseUrl?.takeIf { it.isNotBlank() }?.let { url ->
            Text(
                "Ver release ↗", color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
            )
        }
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
                    when {
                        busy -> "EN CURSO…"
                        install -> "INSTALAR"
                        migrateSource -> "PASAR AL PAQUETE .DEB"
                        i?.needsMigration == true -> "MIGRAR A MIURASTATION"
                        i?.switching == true -> "CAMBIAR VERSIÓN"
                        else -> "ACTUALIZAR"
                    },
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
        val verb = when {
            install -> "Instalar"
            migrateSource -> "Pasar al paquete .deb"
            i?.needsMigration == true -> "Migrar a MiuraStation"
            i?.switching == true -> "Cambiar de versión"
            else -> "Actualizar"
        }
        AlertDialog(
            onDismissRequest = { confirm = false },
            containerColor = Surface,
            title = { Text(if (migrateSource || i?.needsMigration == true) "¿$verb?" else "¿$verb $title?", color = OnBg) },
            text = {
                Text(
                    // Same texts as the web's FlowstationUpdater for each case.
                    if (u.restartsDashboard) "Se descarga el código, se recompila y se reinicia el dashboard. La app perderá la conexión unos segundos."
                    else if (migrateSource) "Se instala el paquete miurastation y se retira la unidad compilada /etc/systemd/system/miurastation.service (los drop-ins se quedan); config.toml, logs y cachés siguen en /root/miurastation. Si algo falla se deshace solo y la MiuraStation compilada sigue como estaba. $ARCH_NOTE"
                    else if (i?.needsMigration == true) "/root/flowstation pasa a /root/miurastation con su config.toml, logs y cachés (queda un enlace /root/flowstation → /root/miurastation), se instala el paquete miurastation, miurastation.service recibe los drop-ins de flowstation.service y esta se deshabilita. Si algo falla se deshace solo y la FlowStation miura sigue como estaba. $ARCH_NOTE"
                    else if (install && miura) "Descargará el paquete .deb de la última versión de ea5gvk/MiuraStation-dist ($ARCH_NOTE), comprobará su SHA-256 y lo instalará con apt-get. config.toml queda en /root/miurastation."
                    else if (miura) "Se descarga el paquete .deb ($repo), se comprueba su SHA-256, se instala con apt-get y se reinicia el servicio si estaba activo."
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
