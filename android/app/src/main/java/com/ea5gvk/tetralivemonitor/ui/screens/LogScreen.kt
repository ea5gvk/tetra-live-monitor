package com.ea5gvk.tetralivemonitor.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.clickable
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.ea5gvk.tetralivemonitor.net.LogLine
import com.ea5gvk.tetralivemonitor.net.StationActive
import com.ea5gvk.tetralivemonitor.ui.StatusDot
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.Warn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

private const val MAX_LINES = 2000
private val json = Json { ignoreUnknownKeys = true; isLenient = true }

@Composable
fun LogScreen(base: String?, station: StationActive?) {
    if (base == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Configura la URL en Ajustes.", color = Muted, fontSize = 12.sp)
        }
        return
    }

    var lines by remember { mutableStateOf<List<String>>(emptyList()) }
    var connected by remember { mutableStateOf(false) }
    // PAUSA freezes what is shown; lines keep arriving underneath.
    var frozen by remember { mutableStateOf<List<String>?>(null) }
    // Unit picked with the chips; null = follow the active station (tmo.service for BlueStation).
    var chosen by remember(base) { mutableStateOf<String?>(null) }
    val logService = chosen ?: station?.activeService
    // Units of the installed stations, for the chips.
    val units = StationActive.STATION_NAMES.mapNotNull { name ->
        val s = station?.services?.get(name)
        if (s?.installed == true) s.service.ifBlank { null } ?: StationActive.STATION_DEFAULT_SERVICE[name] else null
    }.distinct()
    var reconnect by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    // One client for every (re)connection: a new one on each 3 s retry would pile up idle thread pools.
    val client = remember {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
    }
    LaunchedEffect(base, logService) { lines = emptyList(); frozen = null }

    DisposableEffect(base, logService, reconnect) {
        val svc = logService ?: return@DisposableEffect onDispose {}
        var disposed = false
        // journalctl replays its last 50 lines on every connection: skip those already shown after a reconnect.
        val seen = lines.take(60).toHashSet()
        var replayed = 0
        val request = Request.Builder()
            .url("$base/api/log-stream?service=$svc")
            .build()
        fun retry() {
            connected = false
            if (!disposed) scope.launch { delay(3000); if (!disposed) reconnect++ }
        }
        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                if (!disposed) connected = true
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (disposed) return
                val parsed = runCatching { json.decodeFromString<LogLine>(data) }.getOrNull()
                val line = parsed?.line ?: parsed?.error?.let { "[error] $it" } ?: return
                if (replayed++ < 50 && line in seen) return
                lines = (listOf(line) + lines).take(MAX_LINES)
            }

            override fun onClosed(eventSource: EventSource) = retry()

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) = retry()
        }
        val source = EventSources.createFactory(client).newEventSource(request, listener)
        onDispose { disposed = true; source.cancel() }
    }
    val shown = frozen ?: lines

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatusDot(if (connected) Ok else Danger, 9)
            Text(if (connected) "EN VIVO" else "SIN CONEXIÓN", color = if (connected) Ok else Danger,
                fontSize = 10.sp, fontWeight = FontWeight.Black)
            Text("${shown.size} líneas", color = Muted, fontSize = 10.sp, modifier = Modifier.weight(1f))
            Text(
                if (frozen != null) "REANUDAR" else "PAUSA", color = if (frozen != null) Warn else Muted,
                fontSize = 10.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(5.dp))
                    .border(1.dp, if (frozen != null) Warn else Border, RoundedCornerShape(5.dp))
                    .clickable { frozen = if (frozen != null) null else lines }
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
            Text(
                "LIMPIAR", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(Color(0x22EF4444))
                    .border(1.dp, Border, RoundedCornerShape(5.dp)).clickable { lines = emptyList(); frozen = null }
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
        Row(
            Modifier.fillMaxWidth().background(Surface).padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("SERVICIO", color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Black)
            if (units.isEmpty()) {
                Text(logService ?: "esperando /api/station/active…", color = Cyan, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            }
            units.forEach { u ->
                val sel = u == logService
                val active = u == station?.activeService
                Row(
                    Modifier.clip(RoundedCornerShape(5.dp))
                        .background(if (sel) Cyan.copy(alpha = 0.15f) else Color.Transparent)
                        .border(1.dp, if (sel) Cyan.copy(alpha = 0.6f) else Border, RoundedCornerShape(5.dp))
                        .clickable { chosen = if (active) null else u }
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (active) StatusDot(Ok, 6)
                    Text(u.removeSuffix(".service"), color = if (sel) Cyan else Muted, fontSize = 10.sp,
                        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                }
            }
        }

        if (shown.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(if (connected) "Esperando líneas de ${logService ?: ""}…" else "Conectando…",
                    color = Muted, fontSize = 12.sp)
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().background(Color(0xFF05070C)).padding(horizontal = 8.dp, vertical = 4.dp)) {
                items(shown) { line -> LogRow(line) }
            }
        }
    }
}

@Composable
private fun LogRow(line: String) {
    val color = when {
        line.contains("ERROR", true) -> Danger
        line.contains("WARN", true) -> Warn
        line.contains("DEBUG", true) -> Color(0xFF7FB3FF)
        line.contains("TRACE", true) -> Muted
        else -> Color(0xFF86EFAC)
    }
    Text(
        line, color = color, fontSize = 10.sp, fontFamily = FontFamily.Monospace,
        modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp),
    )
}
