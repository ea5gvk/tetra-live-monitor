package com.ea5gvk.tetralivemonitor.ui.screens

import android.graphics.Color as AndroidColor
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.material3.Text
import com.ea5gvk.tetralivemonitor.net.GpsPosition
import com.ea5gvk.tetralivemonitor.net.TetraState
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline

private val TRACK_COLORS = intArrayOf(
    0xFF22C55E.toInt(), 0xFF3B82F6.toInt(), 0xFFF59E0B.toInt(), 0xFFEC4899.toInt(),
    0xFFA855F7.toInt(), 0xFF06B6D4.toInt(), 0xFFF97316.toInt(), 0xFFEF4444.toInt(),
)

@Composable
fun MapScreen(state: TetraState) {
    val positions = state.gpsPositions.values.toList()
    val withFix = positions.filter { it.hasFix }

    val colorByIssi = HashMap<String, Int>().apply {
        state.gpsPositions.keys.forEachIndexed { i, issi -> put(issi, TRACK_COLORS[i % TRACK_COLORS.size]) }
    }

    val mapView = rememberMapView()
    DisposableEffect(Unit) {
        mapView.onResume()
        onDispose { mapView.onPause() }
    }
    val didCenter = remember { mutableStateOf(false) }
    LaunchedEffect(withFix.size) {
        if (!didCenter.value && withFix.isNotEmpty()) {
            mapView.controller.setZoom(12.0)
            mapView.controller.setCenter(GeoPoint(withFix.first().lat, withFix.first().lon))
            didCenter.value = true
        }
    }

    Column(Modifier.fillMaxSize()) {
        androidx.compose.foundation.layout.Row(
            Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("CON FIX: ${withFix.size}", color = Ok, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
            Text("TOTAL: ${positions.size}", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
            if (positions.isEmpty()) {
                Text("· sin posiciones (llegan por SDS/LIP)", color = Muted, fontSize = 10.sp)
            }
        }

        AndroidView(
            factory = { mapView },
            modifier = Modifier.fillMaxWidth().weight(1f),
            update = { map ->
                map.overlays.clear()

                state.gpsHistory.forEach { (issi, track) ->
                    if (track.size >= 2) {
                        val line = Polyline(map)
                        line.setPoints(track.map { GeoPoint(it.lat, it.lon) })
                        line.outlinePaint.color = colorByIssi[issi] ?: AndroidColor.CYAN
                        line.outlinePaint.strokeWidth = 5f
                        map.overlays.add(line)
                    }
                }

                withFix.forEach { pos ->
                    val m = Marker(map)
                    m.position = GeoPoint(pos.lat, pos.lon)
                    m.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    m.title = buildString {
                        append("ISSI ${pos.issi}")
                        pos.callsign?.let { append("  $it") }
                    }
                    m.snippet = "${"%.5f".format(pos.lat)}, ${"%.5f".format(pos.lon)}" +
                        (pos.speed?.let { "  ${it.toInt()} km/h" } ?: "")
                    map.overlays.add(m)
                }

                map.invalidate()
            },
        )
    }
}

@Composable
private fun rememberMapView(): MapView {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    return androidx.compose.runtime.remember {
        MapView(ctx).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            controller.setZoom(6.0)
            controller.setCenter(GeoPoint(40.0, -3.7)) // Spain default
        }
    }
}
