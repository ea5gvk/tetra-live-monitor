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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.ea5gvk.tetralivemonitor.ui.StatusDot
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.Warn
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit

private const val LOG_SERVICE = "flowstation.service"
private const val MAX_LINES = 2000
private val json = Json { ignoreUnknownKeys = true; isLenient = true }

@Composable
fun LogScreen(base: String?) {
    if (base == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Configura la URL en Ajustes.", color = Muted, fontSize = 12.sp)
        }
        return
    }

    var lines by remember { mutableStateOf<List<String>>(emptyList()) }
    var connected by remember { mutableStateOf(false) }

    DisposableEffect(base) {
        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
        val request = Request.Builder()
            .url("$base/api/log-stream?service=$LOG_SERVICE")
            .build()
        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                connected = true
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                val parsed = runCatching { json.decodeFromString<LogLine>(data) }.getOrNull()
                val line = parsed?.line ?: parsed?.error?.let { "[error] $it" } ?: return
                lines = (listOf(line) + lines).take(MAX_LINES)
            }

            override fun onClosed(eventSource: EventSource) {
                connected = false
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                connected = false
            }
        }
        val source = EventSources.createFactory(client).newEventSource(request, listener)
        onDispose { source.cancel() }
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatusDot(if (connected) Ok else Danger, 9)
            Text(if (connected) "EN VIVO" else "SIN CONEXIÓN", color = if (connected) Ok else Danger,
                fontSize = 10.sp, fontWeight = FontWeight.Black)
            Text(LOG_SERVICE, color = Cyan, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            Text("${lines.size} líneas", color = Muted, fontSize = 10.sp)
            Text(
                "LIMPIAR", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(5.dp)).background(Color(0x22EF4444))
                    .border(1.dp, Border, RoundedCornerShape(5.dp)).clickable { lines = emptyList() }
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }

        if (lines.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(if (connected) "Esperando líneas de $LOG_SERVICE…" else "Conectando…",
                    color = Muted, fontSize = 12.sp)
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().background(Color(0xFF05070C)).padding(horizontal = 8.dp, vertical = 4.dp)) {
                items(lines) { line -> LogRow(line) }
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
