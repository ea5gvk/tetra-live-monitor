package com.ea5gvk.tetralivemonitor.ui.screens

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.ea5gvk.tetralivemonitor.net.LocalTetraClient
import com.ea5gvk.tetralivemonitor.net.StationActive
import com.ea5gvk.tetralivemonitor.net.TetraState
import com.ea5gvk.tetralivemonitor.ui.StatusDot
import com.ea5gvk.tetralivemonitor.ui.theme.Bg
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Cyan
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.Ok
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The web calculator's defaults when /api/station/active gives no path or unit (Calculator.tsx STATION_DEFAULTS). */
private val DEFAULT_CONFIG_PATH = mapOf(
    "bluestation" to "/root/tetra-bluestation/config.toml",
    "flowstation" to "/root/flowstation/config.toml",
    "miurastation" to "/root/miurastation/config.toml",
)

/**
 * The calculator's WebView lives here, owned by TetraApp, so switching tabs keeps what was typed in it.
 * Fields are Compose state so the screen redraws when the page reports something.
 */
class CalcWebHolder {
    var web: WebView? = null
    var base: String? = null
    /** Station chosen with the chips (null = follow the active one). */
    var station by mutableStateOf<String?>(null)
    /** Station last sent with setStation to the loaded page (null = page not ready or reloaded). */
    var pushed: String? = null
    var loaded by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var canGoBack by mutableStateOf(false)
    /** Set by CalcScreen on every composition: what to send once the page has loaded. */
    var onLoaded: (WebView) -> Unit = {}

    fun destroy() {
        web?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        web = null
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CalcScreen(state: TetraState, base: String?, password: String, holder: CalcWebHolder) {
    if (base == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Configura la URL en Ajustes.", color = Muted, fontSize = 12.sp)
        }
        return
    }
    val ctx = LocalContext.current
    val client = LocalTetraClient.current
    val st = state.station
    val sel = holder.station ?: st?.station ?: "bluestation"
    val svc = st?.services?.get(sel)
    val configPath = svc?.configPath?.ifBlank { null } ?: DEFAULT_CONFIG_PATH[sel].orEmpty()
    val serviceName = svc?.service?.ifBlank { null } ?: StationActive.STATION_DEFAULT_SERVICE[sel].orEmpty()

    fun pushStation(web: WebView) {
        if (holder.pushed == sel) return
        holder.pushed = sel
        // Same message as the web's Calculator.tsx: the page then loads that config.toml by itself.
        val msg = buildJsonObject {
            put("type", "setStation"); put("station", sel)
            put("configPath", configPath); put("serviceName", serviceName)
        }
        web.evaluateJavascript("window.postMessage($msg, '*');", null)
    }
    holder.onLoaded = { web ->
        web.evaluateJavascript("window.postMessage({type:'setLang',lang:'es'}, '*');", null)
        if (password.isNotEmpty()) {
            // JsonPrimitive gives a valid, escaped JS string literal.
            web.evaluateJavascript(
                "(function(){var e=document.getElementById('applyPassword');if(e&&!e.value)e.value=${JsonPrimitive(password)};})();",
                null,
            )
        }
        pushStation(web)
    }
    // Another station picked (or the active one known once /api/station/active answers).
    LaunchedEffect(sel, holder.loaded) { holder.web?.takeIf { holder.loaded }?.let { pushStation(it) } }

    // The keyboard must shrink the page (the apply password and many fields sit low on it).
    DisposableEffect(ctx) {
        val w = (ctx as? Activity)?.window
        val prev = w?.attributes?.softInputMode
        @Suppress("DEPRECATION") w?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        onDispose {
            if (w != null && prev != null) w.setSoftInputMode(prev)
            // Applying in the calculator restarts the station: refresh the shared station/btsinfo poll.
            client?.refreshStation()
        }
    }
    BackHandler(enabled = holder.canGoBack) { holder.web?.goBack() }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(
            Modifier.fillMaxWidth().background(Surface).padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            StationActive.STATION_NAMES.forEach { name ->
                val info = st?.services?.get(name)
                // Without /api/station/active every chip is usable, as in the web.
                val enabled = st == null || info?.installed == true
                val selected = sel == name
                val c = stationColor(name)
                Row(
                    Modifier.alpha(if (enabled) 1f else 0.4f).clip(RoundedCornerShape(6.dp))
                        .background(if (selected) c.copy(alpha = 0.18f) else Bg)
                        .border(1.dp, if (selected) c.copy(alpha = 0.7f) else Border, RoundedCornerShape(6.dp))
                        .clickable(enabled = enabled && !selected) { holder.station = name }
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(StationActive.stationLabel(name), color = if (selected) c else Muted,
                        fontSize = 10.sp, fontWeight = FontWeight.Black)
                    if (info?.active == true) StatusDot(Ok, 6)
                }
            }
            Text(
                configPath, color = Muted, fontSize = 9.sp, fontFamily = FontFamily.Monospace,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            Text(
                "↻", color = Cyan, fontSize = 16.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable { holder.web?.reload() }
                    .padding(horizontal = 6.dp),
            )
        }
        holder.error?.let {
            Text("No se pudo cargar la calculadora: $it", color = Danger, fontSize = 11.sp,
                modifier = Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 4.dp))
        }
        Box(Modifier.fillMaxWidth().weight(1f)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { c ->
                    val web = holder.web ?: WebView(c).apply {
                        setBackgroundColor(Bg.toArgb())
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webChromeClient = WebChromeClient() // alert() / confirm() as native dialogs
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                                holder.loaded = false; holder.pushed = null; holder.error = null
                            }

                            override fun onPageFinished(view: WebView, url: String?) {
                                holder.loaded = true
                                holder.onLoaded(view)
                            }

                            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                                holder.canGoBack = view.canGoBack()
                            }

                            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                                if (request.isForMainFrame) holder.error = error.description?.toString() ?: "error"
                            }

                            // Links to other sites (GitHub, docs...) open in the browser.
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                val own = holder.base?.let { Uri.parse(it).host }
                                if (request.url.host == own) return false
                                runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                                return true
                            }
                        }
                    }
                    holder.web = web
                    (web.parent as? ViewGroup)?.removeView(web)
                    web
                },
                update = { web ->
                    if (holder.base != base) {
                        holder.base = base
                        holder.station = null
                        web.loadUrl("$base/calculator.html")
                    }
                },
            )
        }
    }
}
