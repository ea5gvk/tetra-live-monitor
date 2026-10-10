package com.ea5gvk.tetralivemonitor.ui.screens

import android.graphics.Color as AndroidColor
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.ea5gvk.tetralivemonitor.net.GpsPosition
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
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline

private val TRACK_COLORS = intArrayOf(
    0xFF22C55E.toInt(), 0xFF3B82F6.toInt(), 0xFFF59E0B.toInt(), 0xFFEC4899.toInt(),
    0xFFA855F7.toInt(), 0xFF06B6D4.toInt(), 0xFFF97316.toInt(), 0xFFEF4444.toInt(),
)

/** Esri World Imagery serves tiles as z/y/x, which XYZTileSource cannot express. */
private val ESRI_IMAGERY = object : OnlineTileSourceBase(
    "Esri.WorldImagery", 0, 19, 256, "",
    arrayOf("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/"),
    "© Esri — Source: Esri, Maxar, GeoEye, Earthstar Geographics",
) {
    override fun getTileURLString(index: Long): String =
        baseUrl + MapTileIndex.getZoom(index) + "/" + MapTileIndex.getY(index) + "/" + MapTileIndex.getX(index)
}

/** Same three layers as the web's GPS map, with the attribution each provider asks for. */
private enum class MapLayer(val label: String, val source: OnlineTileSourceBase, val attribution: String) {
    MAPA("MAPA", TileSourceFactory.MAPNIK, "© OpenStreetMap contributors"),
    SAT("SAT", ESRI_IMAGERY, "© Esri — Source: Esri, Maxar, GeoEye, Earthstar Geographics"),
    TOPO("TOPO", TileSourceFactory.OpenTopo, "© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)"),
}

/** No-fix positions at 0,0 are "no position at all", not a point in the Gulf of Guinea. */
private fun GpsPosition.placeable() = hasFix || lat != 0.0 || lon != 0.0

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun MapScreen(state: TetraState) {
    val positions = state.gpsPositions.values.toList()
    val withFix = positions.filter { it.hasFix }

    var layer by rememberSaveable { mutableStateOf(MapLayer.MAPA) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var allTracks by rememberSaveable { mutableStateOf(false) }
    var showNoFix by rememberSaveable { mutableStateOf(true) }
    var listOpen by remember { mutableStateOf(false) }

    val colorByIssi = HashMap<String, Int>().apply {
        state.gpsPositions.keys.forEachIndexed { i, issi -> put(issi, TRACK_COLORS[i % TRACK_COLORS.size]) }
    }
    val visible = (if (showNoFix) positions else withFix).filter { it.placeable() }

    val mapView = rememberMapView()
    DisposableEffect(Unit) {
        mapView.onResume()
        onDispose { mapView.onPause() }
    }

    fun fit(points: List<GeoPoint>) {
        if (points.isEmpty()) return
        val box = BoundingBox.fromGeoPointsSafe(points)
        if (points.size == 1 || (box.latitudeSpan < 1e-4 && box.longitudeSpanWithDateLine < 1e-4)) {
            if (mapView.zoomLevelDouble < 14.0) mapView.controller.setZoom(15.0)
            mapView.controller.animateTo(points.first())
        } else {
            mapView.zoomToBoundingBox(box.increaseByScale(1.3f), true, 60)
        }
    }
    fun fitIssi(issi: String) {
        val track = state.gpsHistory[issi].orEmpty().map { GeoPoint(it.lat, it.lon) }
        val pos = state.gpsPositions[issi]?.takeIf { it.placeable() }?.let { GeoPoint(it.lat, it.lon) }
        fit(track.ifEmpty { listOfNotNull(pos) })
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
        Column(
            Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("CON FIX: ${withFix.size}", color = Ok, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                Text("TOTAL: ${positions.size}", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                if (positions.isEmpty()) {
                    Text("· sin posiciones (llegan por SDS/LIP)", color = Muted, fontSize = 10.sp, modifier = Modifier.weight(1f))
                } else {
                    Box(Modifier.weight(1f))
                }
                MapChip("LISTA", false, Cyan) { listOpen = true }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                MapLayer.entries.forEach { l -> MapChip(l.label, layer == l, Cyan) { layer = l } }
                MapChip("TODAS LAS TRAZAS", allTracks, Ok) { allTracks = !allTracks }
                MapChip("MOSTRAR SIN FIX", showNoFix, Warn) { showNoFix = !showNoFix }
                selected?.let { s ->
                    MapChip("✕ ${state.callsignOf(s) ?: s}", true, Danger) { selected = null }
                }
            }
        }

        Box(Modifier.fillMaxWidth().weight(1f)) {
            AndroidView(
                factory = { mapView },
                modifier = Modifier.fillMaxSize(),
                update = { map ->
                    if (map.tileProvider.tileSource != layer.source) map.setTileSource(layer.source)
                    map.overlays.clear()

                    // Like the web: one selected track, or every track (the selected one thicker).
                    state.gpsHistory.forEach { (issi, track) ->
                        val isSel = issi == selected
                        if (track.size >= 2 && (allTracks || isSel)) {
                            val line = Polyline(map)
                            line.setPoints(track.map { GeoPoint(it.lat, it.lon) })
                            line.outlinePaint.color = colorByIssi[issi] ?: AndroidColor.CYAN
                            line.outlinePaint.strokeWidth = if (isSel) 7f else 4f
                            if (allTracks && selected != null && !isSel) line.outlinePaint.alpha = 110
                            map.overlays.add(line)
                        }
                    }

                    visible.forEach { pos ->
                        val m = Marker(map)
                        m.position = GeoPoint(pos.lat, pos.lon)
                        m.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                        if (!pos.hasFix) m.alpha = 0.45f
                        m.title = buildString {
                            append("ISSI ${pos.issi}")
                            (state.callsignOf(pos.issi) ?: pos.callsign)?.let { append("  $it") }
                            if (!pos.hasFix) append("  (sin fix)")
                        }
                        m.snippet = "${"%.5f".format(pos.lat)}, ${"%.5f".format(pos.lon)}" +
                            (pos.speed?.let { "  ${it.toInt()} km/h" } ?: "")
                        m.setOnMarkerClickListener { marker, _ ->
                            selected = pos.issi
                            marker.showInfoWindow()
                            true
                        }
                        map.overlays.add(m)
                    }

                    map.invalidate()
                },
            )
            Text(
                layer.attribution, color = Color(0xFF1F2937), fontSize = 9.sp,
                modifier = Modifier.align(Alignment.BottomStart)
                    .background(Color(0xCCFFFFFF)).padding(horizontal = 4.dp, vertical = 1.dp),
            )
            SmallFloatingActionButton(
                onClick = {
                    val s = selected
                    if (s != null) fitIssi(s) else fit(visible.map { GeoPoint(it.lat, it.lon) })
                },
                containerColor = SurfaceHi, contentColor = Cyan,
                modifier = Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 24.dp),
            ) { Icon(Icons.Filled.CenterFocusStrong, contentDescription = "Encuadrar") }
        }
    }

    if (listOpen) {
        ModalBottomSheet(onDismissRequest = { listOpen = false }, containerColor = Surface) {
            Text("ESTACIONES (${positions.size})", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            if (positions.isEmpty()) {
                Text("Sin posiciones todavía: llegan por SDS/LIP.", color = Muted, fontSize = 12.sp,
                    modifier = Modifier.padding(16.dp).navigationBarsPadding())
            } else {
                LazyColumn(Modifier.fillMaxWidth().navigationBarsPadding()) {
                    items(positions.sortedWith(compareByDescending<GpsPosition> { it.hasFix }.thenBy { it.issi }), key = { it.issi }) { pos ->
                        StationRow(
                            pos, state.callsignOf(pos.issi) ?: pos.callsign,
                            Color(colorByIssi[pos.issi] ?: AndroidColor.CYAN),
                            state.gpsHistory[pos.issi]?.size ?: 0, pos.issi == selected,
                        ) {
                            if (selected == pos.issi) selected = null
                            else { selected = pos.issi; fitIssi(pos.issi) }
                            listOpen = false
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MapChip(label: String, on: Boolean, color: Color, onClick: () -> Unit) {
    Text(
        label, color = if (on) color else Muted, fontSize = 10.sp, fontWeight = FontWeight.Black,
        modifier = Modifier.clip(RoundedCornerShape(6.dp))
            .background(if (on) color.copy(alpha = 0.15f) else SurfaceHi)
            .border(1.dp, if (on) color.copy(alpha = 0.6f) else Border, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick).padding(horizontal = 9.dp, vertical = 5.dp),
    )
}

@Composable
private fun StationRow(pos: GpsPosition, name: String?, color: Color, points: Int, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(if (selected) Cyan.copy(alpha = 0.1f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        StatusDot(if (pos.hasFix) color else Danger, 10)
        Column(Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(pos.issi, color = OnBg, fontSize = 13.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                name?.let { Text(it, color = Warn, fontSize = 12.sp, fontFamily = FontFamily.Monospace) }
            }
            Text(
                buildString {
                    if (points > 1) append("$points puntos")
                    pos.speed?.let { if (isNotEmpty()) append(" · "); append("${it.toInt()} km/h") }
                },
                color = Muted, fontSize = 10.sp,
            )
        }
        if (pos.hasFix) {
            Column(horizontalAlignment = Alignment.End) {
                Text("%.4f°".format(pos.lat), color = color, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                Text("%.4f°".format(pos.lon), color = color, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
            }
        } else {
            Text("SIN FIX", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Black)
        }
    }
}

@Composable
private fun rememberMapView(): MapView {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    return remember {
        MapView(ctx).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            controller.setZoom(6.0)
            controller.setCenter(GeoPoint(40.0, -3.7)) // Spain default
        }
    }
}
