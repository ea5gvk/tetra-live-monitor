package com.ea5gvk.tetralivemonitor.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.data.ServerProfile
import com.ea5gvk.tetralivemonitor.data.Settings
import com.ea5gvk.tetralivemonitor.net.TetraApi
import java.util.UUID
import kotlinx.coroutines.launch
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.OnBg
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.SurfaceHi

private val PRESETS = listOf("10.33.1.75:5000", "tetra.arsacnp.eu", "192.168.1.100:5000")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    serverUrl: String,
    password: String,
    profiles: List<ServerProfile>,
    onSaveUrl: (String) -> Unit,
    onSavePassword: (String) -> Unit,
    onSaveProfile: (ServerProfile) -> Unit,
    onDeleteProfile: (String) -> Unit,
    passwordOk: Boolean? = null,
) {
    val context = LocalContext.current
    val settings = remember { Settings(context) }
    val scope = rememberCoroutineScope()
    val tgNames by settings.tgNames.collectAsState(initial = emptyMap())
    val tgSource by settings.tgNamesSource.collectAsState(initial = "")
    var tgPick by remember { mutableStateOf("bm") }
    var tgBusy by remember { mutableStateOf(false) }
    var tgMsg by remember { mutableStateOf<String?>(null) }
    var tgMsgOk by remember { mutableStateOf(true) }
    var text by remember { mutableStateOf(serverUrl) }
    LaunchedEffect(serverUrl) { if (text.isBlank()) text = serverUrl }
    var pw by remember { mutableStateOf(password) }
    LaunchedEffect(password) { if (pw.isBlank()) pw = password }
    var profileName by remember { mutableStateOf("") }
    LaunchedEffect(serverUrl, profiles) {
        if (profileName.isBlank()) profileName = profiles.firstOrNull { it.url == serverUrl }?.name ?: ""
    }

    val normalized = Settings.normalize(text)
    val wsPreview = normalized?.let { Settings.wsUrl(it) }

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("SERVIDOR", color = Muted, fontWeight = FontWeight.Black, fontSize = 11.sp, letterSpacing = 1.sp)
        Text(
            "Dirección de tu tetra-live-monitor (IP:puerto o dominio). Ej: 10.33.1.75:5000",
            color = Muted, fontSize = 12.sp,
        )

        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("10.33.1.75:5000", color = Muted) },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Cyan,
                unfocusedBorderColor = Border,
                focusedTextColor = OnBg,
                unfocusedTextColor = OnBg,
                cursorColor = Cyan,
                focusedContainerColor = Surface,
                unfocusedContainerColor = Surface,
            ),
        )

        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PRESETS.forEach { p ->
                Text(
                    p,
                    color = Cyan,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(SurfaceHi)
                        .border(1.dp, Border, RoundedCornerShape(6.dp))
                        .clickable { text = p }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
        }

        if (wsPreview != null) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Surface)
                    .border(1.dp, Border, RoundedCornerShape(8.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text("Se conectará a:", color = Muted, fontSize = 10.sp)
                Text(wsPreview, color = Cyan, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
            }
        }

        Text("CONTRASEÑA DEL SISTEMA", color = Muted, fontWeight = FontWeight.Black, fontSize = 11.sp,
            letterSpacing = 1.sp, modifier = Modifier.padding(top = 6.dp))
        Text("La misma que el dashboard pide para SDS, DGNA, reiniciar/apagar (systemPassword).",
            color = Muted, fontSize = 12.sp)
        OutlinedTextField(
            value = pw,
            onValueChange = { pw = it },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            placeholder = { Text("••••••", color = Muted) },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Cyan,
                unfocusedBorderColor = Border,
                focusedTextColor = OnBg,
                unfocusedTextColor = OnBg,
                cursorColor = Cyan,
                focusedContainerColor = Surface,
                unfocusedContainerColor = Surface,
            ),
        )

        when {
            pw != password -> {}
            passwordOk == false -> Text("⚠ El servidor rechaza esta contraseña: revísala.",
                color = Danger, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            passwordOk == true -> Text("✓ Contraseña aceptada por el servidor.", color = Ok, fontSize = 11.sp)
        }

        Button(
            onClick = {
                normalized?.let { onSaveUrl(it) }
                onSavePassword(pw)
            },
            enabled = normalized != null,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Surface),
        ) {
            Text("GUARDAR Y CONECTAR", fontWeight = FontWeight.Black)
        }

        Text(
            "La app se reconecta automáticamente. HTTP en claro está permitido para redes locales.",
            color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp),
        )

        Text("PERFILES", color = Muted, fontWeight = FontWeight.Black, fontSize = 11.sp,
            letterSpacing = 1.sp, modifier = Modifier.padding(top = 10.dp))
        Text(
            "Guarda varias flowstations (dirección + contraseña) y cambia entre ellas con un toque.",
            color = Muted, fontSize = 12.sp,
        )

        OutlinedTextField(
            value = profileName,
            onValueChange = { profileName = it },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Nombre del perfil", color = Muted, fontSize = 12.sp) },
            placeholder = { Text("Casa, Repetidor, VPS…", color = Muted) },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Cyan,
                unfocusedBorderColor = Border,
                focusedTextColor = OnBg,
                unfocusedTextColor = OnBg,
                cursorColor = Cyan,
                focusedContainerColor = Surface,
                unfocusedContainerColor = Surface,
            ),
        )

        Button(
            onClick = {
                val url = normalized ?: return@Button
                val name = profileName.trim()
                val existing = profiles.firstOrNull { it.name.equals(name, ignoreCase = true) }
                onSaveProfile(
                    ServerProfile(
                        id = existing?.id ?: UUID.randomUUID().toString(),
                        name = name, url = url, password = pw,
                    )
                )
            },
            enabled = normalized != null && profileName.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Cyan),
        ) {
            Text("GUARDAR ESTA CONFIGURACIÓN COMO PERFIL", fontWeight = FontWeight.Black, fontSize = 12.sp)
        }

        if (profiles.isEmpty()) {
            Text("Todavía no hay perfiles guardados.", color = Muted, fontSize = 11.sp)
        } else {
            profiles.forEach { p ->
                val active = p.url == serverUrl
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Surface)
                        .border(1.dp, if (active) Cyan else Border, RoundedCornerShape(8.dp))
                        .clickable {
                            text = p.url
                            pw = p.password
                            profileName = p.name
                            onSaveUrl(p.url)
                            onSavePassword(p.password)
                        }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(p.name, color = if (active) Cyan else OnBg, fontSize = 13.sp, fontWeight = FontWeight.Black)
                        Text(p.url, color = Muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                    }
                    if (active) Text("ACTIVO", color = Cyan, fontSize = 9.sp, fontWeight = FontWeight.Black)
                    Text(
                        "✕", color = Muted, fontSize = 14.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp))
                            .clickable { onDeleteProfile(p.id) }
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }
        }

        Text("NOMBRES DE TG", color = Muted, fontWeight = FontWeight.Black, fontSize = 11.sp,
            letterSpacing = 1.sp, modifier = Modifier.padding(top = 10.dp))
        Text(
            "Descarga los nombres de los talkgroups de BrandMeister o ADN (a través de tu servidor) para verlos " +
                "junto al número. Los mnemónicos de tu librería DGNA tienen prioridad.",
            color = Muted, fontSize = 12.sp,
        )
        Text(
            if (tgNames.isEmpty()) "Sin nombres cargados."
            else "${tgNames.size} nombres cargados de ${tgSource.uppercase().ifBlank { "?" }}.",
            color = if (tgNames.isEmpty()) Muted else Ok, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            listOf("bm" to "BRANDMEISTER", "adn" to "ADN").forEach { (id, label) ->
                val sel = tgPick == id
                Text(
                    label, color = if (sel) Cyan else Muted, fontSize = 11.sp, fontWeight = FontWeight.Black,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp))
                        .background(if (sel) Cyan.copy(alpha = 0.15f) else Surface)
                        .border(1.dp, if (sel) Cyan.copy(alpha = 0.6f) else Border, RoundedCornerShape(6.dp))
                        .clickable(enabled = !tgBusy) { tgPick = id }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = {
                    val b = Settings.normalize(serverUrl) ?: run { tgMsg = "Configura la URL primero"; tgMsgOk = false; return@Button }
                    val src = tgPick
                    scope.launch {
                        tgBusy = true; tgMsg = "Descargando… (la primera vez puede tardar ~30 s)"; tgMsgOk = true
                        val r = TetraApi.getTalkgroups(b, src)
                        if (r != null && r.data.isNotEmpty()) {
                            settings.setTgNames(src, r.data)
                            tgMsg = "✓ ${r.data.size} nombres de ${src.uppercase()}" + if (r.cached) " (caché del servidor)" else ""
                            tgMsgOk = true
                        } else {
                            tgMsg = "No se pudieron descargar los nombres de ${src.uppercase()}"; tgMsgOk = false
                        }
                        tgBusy = false
                    }
                },
                enabled = !tgBusy && serverUrl.isNotBlank(), modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Cyan),
            ) { Text(if (tgBusy) "CARGANDO…" else "CARGAR", fontWeight = FontWeight.Black, fontSize = 12.sp) }
            Button(
                onClick = { scope.launch { settings.clearTgNames(); tgMsg = "Nombres borrados"; tgMsgOk = true } },
                enabled = !tgBusy && tgNames.isNotEmpty(), modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = Danger),
            ) { Text("BORRAR", fontWeight = FontWeight.Black, fontSize = 12.sp) }
        }
        tgMsg?.let { Text(it, color = if (tgMsgOk) Muted else Danger, fontSize = 11.sp) }

        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(SurfaceHi).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("AGRADECIMIENTOS", color = Cyan, fontWeight = FontWeight.Black, fontSize = 11.sp, letterSpacing = 1.sp)
            Text(
                "Gracias a Rafa EA7KEN e Iñaki EA8DJI por su gran apoyo y dedicación.",
                color = OnBg, fontSize = 12.sp,
            )
        }

        Text(
            "Copyright © @EA5GVK-Joaquín",
            color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
        )
    }
}
