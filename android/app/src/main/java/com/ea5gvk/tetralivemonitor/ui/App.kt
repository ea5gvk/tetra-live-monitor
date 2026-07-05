package com.ea5gvk.tetralivemonitor.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Podcasts
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.TetraState
import com.ea5gvk.tetralivemonitor.ui.screens.ControlScreen
import com.ea5gvk.tetralivemonitor.ui.screens.DgnaScreen
import com.ea5gvk.tetralivemonitor.ui.screens.LogScreen
import com.ea5gvk.tetralivemonitor.ui.screens.MapScreen
import com.ea5gvk.tetralivemonitor.ui.screens.MonitorScreen
import com.ea5gvk.tetralivemonitor.ui.screens.SettingsScreen
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.SurfaceHi

private data class Tab(val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab("MON", Icons.Filled.Podcasts),
    Tab("MAPA", Icons.Filled.Map),
    Tab("DGNA", Icons.Filled.Hub),
    Tab("LOG", Icons.Filled.Terminal),
    Tab("CTRL", Icons.Filled.Tune),
    Tab("AJUSTES", Icons.Filled.Settings),
)

@Composable
fun TetraApp(
    state: TetraState,
    serverUrl: String,
    password: String,
    base: String?,
    onSaveUrl: (String) -> Unit,
    onSavePassword: (String) -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(0) }

    Scaffold(
        containerColor = com.ea5gvk.tetralivemonitor.ui.theme.Bg,
        topBar = { TopStatusBar(state) },
        bottomBar = {
            NavigationBar(containerColor = Surface) {
                TABS.forEachIndexed { i, t ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = { tab = i },
                        icon = { Icon(t.icon, contentDescription = t.label, modifier = Modifier.size(20.dp)) },
                        label = { Text(t.label, fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Cyan,
                            selectedTextColor = Cyan,
                            indicatorColor = SurfaceHi,
                            unselectedIconColor = Muted,
                            unselectedTextColor = Muted,
                        ),
                    )
                }
            }
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            when (tab) {
                0 -> MonitorScreen(state, base, password)
                1 -> MapScreen(state)
                2 -> DgnaScreen(state, base, password)
                3 -> LogScreen(base)
                4 -> ControlScreen(state, base, password, hasPassword = password.isNotBlank())
                else -> SettingsScreen(serverUrl, password, onSaveUrl, onSavePassword)
            }
        }
    }
}

@Composable
private fun TopStatusBar(state: TetraState) {
    val dotColor = if (state.connected) Ok else Danger
    val statusText = if (state.connected) "CONECTADO" else "SIN CONEXIÓN"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface)
            .statusBarsPadding()
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "TETRA LIVE MONITOR",
            color = Cyan,
            fontWeight = FontWeight.Black,
            fontFamily = FontFamily.Monospace,
            fontSize = 14.sp,
            letterSpacing = 1.5.sp,
        )
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(SurfaceHi)
                .border(1.dp, Border, RoundedCornerShape(6.dp))
                .padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            StatusDot(dotColor)
            Text(statusText, color = if (state.connected) Ok else Danger, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
        if (state.fsDashboardActive) {
            Text("FLOW", color = Ok, fontSize = 9.sp, fontWeight = FontWeight.Black)
        }
    }
}

/** Small helper reused across screens. */
@Composable
fun StatusDot(color: Color, size: Int = 8) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(color))
}
