package com.ea5gvk.tetralivemonitor.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ea5gvk.tetralivemonitor.net.ApiResult
import com.ea5gvk.tetralivemonitor.net.TetraApi
import com.ea5gvk.tetralivemonitor.net.TetraState
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

@Composable
fun ControlScreen(state: TetraState, base: String?, password: String, hasPassword: Boolean) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var resultOk by remember { mutableStateOf(true) }
    var confirm by remember { mutableStateOf<String?>(null) } // "reboot" | "shutdown"

    fun dispatch(block: suspend () -> ApiResult) {
        if (base == null) { result = "Configura la URL en Ajustes"; resultOk = false; return }
        if (!hasPassword) { result = "Configura la contraseña en Ajustes"; resultOk = false; return }
        scope.launch { busy = true; val r = block(); result = r.message; resultOk = r.ok; busy = false }
    }

    var sdsIssi by remember { mutableStateOf("") }
    var sdsMsg by remember { mutableStateOf("") }
    var kickIssi by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (!hasPassword) {
            Card {
                Text("⚠ Falta la contraseña del sistema", color = Warn, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Text("Ve a Ajustes e introduce la contraseña (systemPassword) para poder enviar SDS, DGNA y gestionar la Pi.",
                    color = Muted, fontSize = 11.sp)
            }
        }

        // ── SDS ──
        Card {
            Text("ENVIAR SDS", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
            CtrlField("ISSI destino", sdsIssi, { sdsIssi = it.filter(Char::isDigit) })
            CtrlField("Mensaje (máx 160)", sdsMsg, { if (it.length <= 160) sdsMsg = it })
            Button(
                onClick = {
                    val i = sdsIssi.trim().toIntOrNull()
                    if (i == null || sdsMsg.isBlank()) { result = "ISSI y mensaje requeridos"; resultOk = false }
                    else dispatch { TetraApi.sendSds(base!!, password, i, sdsMsg.trim()) }
                },
                enabled = !busy, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Surface),
            ) { Text("ENVIAR SDS", fontWeight = FontWeight.Black) }
        }

        // ── Kick ──
        Card {
            Text("EXPULSAR TERMINAL (KICK)", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
            CtrlField("ISSI", kickIssi, { kickIssi = it.filter(Char::isDigit) })
            Button(
                onClick = {
                    val i = kickIssi.trim().toIntOrNull()
                    if (i == null) { result = "ISSI requerido"; resultOk = false }
                    else dispatch { TetraApi.kick(base!!, password, i) }
                },
                enabled = !busy, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Warn, contentColor = Surface),
            ) { Text("EXPULSAR", fontWeight = FontWeight.Black) }
        }

        // ── Sistema ──
        Card {
            Text("SISTEMA / RASPBERRY PI", color = Cyan, fontWeight = FontWeight.Black, fontSize = 12.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { dispatch { TetraApi.restartService(base!!, password, "flowstation.service") } },
                    enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = OnBg),
                ) { Text("REINICIAR FLOW", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
                Button(
                    onClick = { dispatch { TetraApi.restartService(base!!, password, "tmo.service") } },
                    enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = SurfaceHi, contentColor = OnBg),
                ) { Text("REINICIAR TMO", fontWeight = FontWeight.Bold, fontSize = 11.sp) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { confirm = "reboot" }, enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Warn, contentColor = Surface),
                ) { Text("REINICIAR PI", fontWeight = FontWeight.Black, fontSize = 11.sp) }
                Button(
                    onClick = { confirm = "shutdown" }, enabled = !busy, modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Danger, contentColor = Surface),
                ) { Text("APAGAR PI", fontWeight = FontWeight.Black, fontSize = 11.sp) }
            }
        }

        result?.let {
            Text(it, color = if (resultOk) Ok else Danger, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        }
    }

    if (confirm != null) {
        val isReboot = confirm == "reboot"
        AlertDialog(
            onDismissRequest = { confirm = null },
            containerColor = Surface,
            title = { Text(if (isReboot) "¿Reiniciar la Pi?" else "¿Apagar la Pi?", color = OnBg) },
            text = {
                Text(
                    if (isReboot) "La Raspberry Pi se reiniciará. Perderás la conexión unos minutos."
                    else "La Raspberry Pi se apagará. Tendrás que encenderla manualmente.",
                    color = Muted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val action = confirm; confirm = null
                    dispatch { if (action == "reboot") TetraApi.reboot(base!!, password) else TetraApi.shutdown(base!!, password) }
                }) { Text(if (isReboot) "REINICIAR" else "APAGAR", color = if (isReboot) Warn else Danger, fontWeight = FontWeight.Black) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancelar", color = Muted) } },
        )
    }
}

@Composable
private fun Card(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface)
            .border(1.dp, Border, RoundedCornerShape(10.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
private fun CtrlField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true, modifier = Modifier.fillMaxWidth(),
        label = { Text(label, fontSize = 11.sp) },
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Cyan, unfocusedBorderColor = Border,
            focusedTextColor = OnBg, unfocusedTextColor = OnBg, cursorColor = Cyan,
            focusedLabelColor = Cyan, unfocusedLabelColor = Muted,
            focusedContainerColor = SurfaceHi, unfocusedContainerColor = SurfaceHi,
        ),
    )
}
