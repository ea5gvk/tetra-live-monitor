package com.ea5gvk.tetralivemonitor.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.data.Settings
import com.ea5gvk.tetralivemonitor.net.DgnaLogEntry
import com.ea5gvk.tetralivemonitor.net.Terminal
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.TetraState
import com.ea5gvk.tetralivemonitor.net.TgEntry
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DgnaScreen(state: TetraState, base: String?, password: String) {
    // DGNA solo aplica a equipos locales; los externos no se gestionan aquí.
    val radios = state.terminals.values.filter { it.isLocal }.sortedBy { it.id }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val settings = remember { Settings(context) }
    val tgLib by settings.tgLibrary.collectAsState(initial = emptyList())

    var issi by remember { mutableStateOf("") }
    var gssi by remember { mutableStateOf("") }
    var mnemonic by remember { mutableStateOf("") }
    var attachMode by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var resultOk by remember { mutableStateOf(true) }

    fun run(attach: Boolean) {
        val i = issi.trim().toIntOrNull()
        val g = gssi.trim().toIntOrNull()
        when {
            base == null -> { result = "Configura la URL en Ajustes"; resultOk = false }
            password.isBlank() -> { result = "Configura la contraseña en Ajustes"; resultOk = false }
            i == null || g == null -> { result = "ISSI y GSSI deben ser números"; resultOk = false }
            else -> scope.launch {
                busy = true
                val r = TetraApi.dgna(base, password, i, g, attach, mnemonic.trim(), attachMode)
                result = r.message; resultOk = r.ok; busy = false
                if (r.ok && attach) settings.addTg(TgEntry(g, mnemonic.trim(), attachMode))
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxWidth().padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
                    .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("ASIGNAR / QUITAR DGNA", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Field("ISSI", issi, { issi = it.filter(Char::isDigit) }, Modifier.weight(1f))
                    Field("GSSI (TG)", gssi, { gssi = it.filter(Char::isDigit) }, Modifier.weight(1f))
                }
                Field("Mnemónico (máx 15)", mnemonic, { if (it.length <= 15) mnemonic = it }, Modifier.fillMaxWidth())
                Text("Modo attachment", color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                FlowRowModes(attachMode) { attachMode = it }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { run(true) }, enabled = !busy, modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Ok, contentColor = Surface),
                    ) { Text("ASIGNAR", fontWeight = FontWeight.Black) }
                    Button(
                        onClick = { run(false) }, enabled = !busy, modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = Danger, contentColor = Surface),
                    ) { Text("QUITAR", fontWeight = FontWeight.Black) }
                }
                result?.let {
                    Text(it, color = if (resultOk) Ok else Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Text("Consejo: toca un grupo de un equipo abajo para rellenar el formulario.",
                    color = Muted, fontSize = 10.sp)
            }
        }

        item {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
                    .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("LIBRERÍA DE TGs (${tgLib.size})", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
                if (tgLib.isEmpty()) {
                    Text("Asigna un TG y se guardará aquí para reasignarlo con un toque.",
                        color = Muted, fontSize = 11.sp)
                } else {
                    Text("Toca para rellenar el formulario; ✕ para quitar.", color = Muted, fontSize = 10.sp)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        tgLib.forEach { e ->
                            TgLibChip(
                                e,
                                onPick = { gssi = e.gssi.toString(); mnemonic = e.mnemonic; attachMode = e.attachMode },
                                onRemove = { scope.launch { settings.removeTg(e.gssi) } },
                            )
                        }
                    }
                }
            }
        }

        item { Header("ESTADO DE GRUPOS POR EQUIPO") }
        if (radios.isEmpty()) {
            item { Text("Sin equipos conectados.", color = Muted, fontSize = 12.sp) }
        } else {
            items(radios, key = { it.id }) { r ->
                RadioGroups(r) { pIssi, pGssi, pMnem, pMode ->
                    issi = pIssi
                    pGssi?.let { gssi = it }
                    pMnem?.let { mnemonic = it.take(15) }
                    pMode?.let { attachMode = it }
                }
            }
        }

        item { Header("REGISTRO DGNA (${state.dgnaLog.size})") }
        if (state.dgnaLog.isEmpty()) {
            item { Text("Sin actividad DGNA todavía.", color = Muted, fontSize = 12.sp) }
        } else {
            items(state.dgnaLog.take(50)) { DgnaLogRow(it) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRowModes(selected: Int, onSelect: (Int) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        (0..5).forEach { m ->
            val active = m == selected
            val c = if (active) Cyan else Muted
            Text("$m", color = if (active) Surface else c, fontSize = 12.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.clip(RoundedCornerShape(6.dp))
                    .background(if (active) Cyan else SurfaceHi)
                    .border(1.dp, c.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                    .clickable { onSelect(m) }.padding(horizontal = 12.dp, vertical = 5.dp))
        }
    }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true, modifier = modifier,
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
private fun Header(text: String) {
    Text(text, color = Muted, fontWeight = FontWeight.Black, fontSize = 11.sp, letterSpacing = 1.sp,
        modifier = Modifier.padding(top = 6.dp))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RadioGroups(t: Terminal, onPick: (issi: String, gssi: String?, mnemonic: String?, mode: Int?) -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp))
            .clickable { onPick(t.id, null, null, null) }.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(t.callsign?.ifBlank { t.id } ?: t.id, color = OnBg, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            Text(t.id, color = Muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
        }

        val catalog = t.groupCatalog
        if (!catalog.isNullOrEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                catalog.forEach { g ->
                    val label = (if (g.mnemonic.isNotBlank()) g.mnemonic else g.gssi.toString()) + "  " + g.gssi
                    val color = when {
                        g.isDynamic && g.isAttached -> Ok
                        g.isDynamic -> Warn
                        g.isAttached -> Cyan
                        else -> Muted
                    }
                    GroupChip(label, color, g.isDynamic) {
                        onPick(t.id, g.gssi.toString(), g.mnemonic.ifBlank { null }, g.attachmentMode)
                    }
                }
            }
        } else if (t.groups.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                t.groups.forEach { g -> GroupChip(g, Muted, false) { onPick(t.id, g, null, null) } }
            }
        } else {
            Text("Sin grupos reportados.", color = Muted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun GroupChip(label: String, color: Color, dynamic: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(6.dp)).background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
            .clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (dynamic) Text("◆", color = color, fontSize = 10.sp)
        Text(label, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
    }
}

@Composable
private fun TgLibChip(e: TgEntry, onPick: () -> Unit, onRemove: () -> Unit) {
    val label = e.mnemonic.ifBlank { e.gssi.toString() }
    Row(
        Modifier.clip(RoundedCornerShape(6.dp)).background(Ok.copy(alpha = 0.12f))
            .border(1.dp, Ok.copy(alpha = 0.5f), RoundedCornerShape(6.dp)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "$label · ${e.gssi}", color = Ok, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
            modifier = Modifier.clickable(onClick = onPick).padding(start = 8.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        )
        Text(
            "✕", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.clickable(onClick = onRemove).padding(start = 2.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        )
    }
}

@Composable
private fun DgnaLogRow(e: DgnaLogEntry) {
    val color = if (e.accepted) Ok else Danger
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(SurfaceHi).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.clip(RoundedCornerShape(4.dp)).background(color.copy(alpha = 0.15f)).padding(horizontal = 6.dp, vertical = 1.dp)
            ) { Text(if (e.accepted) "OK" else "FALLO", color = color, fontSize = 9.sp, fontWeight = FontWeight.Black) }
            Text("ISSI ${e.issi} → TG ${e.gssi}", color = OnBg, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            Text(if (e.attach) "attach" else "deattach", color = Muted, fontSize = 10.sp)
        }
        if (e.detail.isNotBlank()) Text(e.detail, color = Muted, fontSize = 10.sp)
    }
}
