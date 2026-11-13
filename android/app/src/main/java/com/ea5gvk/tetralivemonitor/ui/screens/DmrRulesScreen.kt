package com.ea5gvk.tetralivemonitor.ui.screens

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.ea5gvk.tetralivemonitor.ui.theme.Bg
import com.ea5gvk.tetralivemonitor.ui.theme.Border
import com.ea5gvk.tetralivemonitor.ui.theme.Danger
import com.ea5gvk.tetralivemonitor.ui.theme.Muted
import com.ea5gvk.tetralivemonitor.ui.theme.OnBg
import com.ea5gvk.tetralivemonitor.ui.theme.Surface
import com.ea5gvk.tetralivemonitor.ui.theme.SurfaceHi

private fun css(c: Color): String = "#%06X".format(c.toArgb() and 0xFFFFFF)

/**
 * dmr-rules.html follows the panel's theme only inside the panel's iframe: here it gets the dark one
 * (data-theme="dark") with the app's background, surfaces, text and borders.
 */
private val DARK_THEME_JS = """
    (function () {
      var r = document.documentElement;
      r.setAttribute("data-theme", "dark");
      if (document.getElementById("app-theme")) return;
      var s = document.createElement("style");
      s.id = "app-theme";
      s.textContent = ':root[data-theme="dark"] { --bg: ${css(Bg)}; --surface: ${css(Surface)}; --ink: ${css(OnBg)}; --muted: ${css(Muted)}; --line: ${css(Border)}; --code: ${css(SurfaceHi)}; }';
      (document.head || r).appendChild(s);
    })();
""".trimIndent()

/**
 * REGLAS DMR: the panel's guide to the DMRGateway network rules ($base/dmr-rules.html, the web's REGLAS DMR tab) in
 * a WebView, as the calculator. Its link to the panel's CONFIG DMR opens the app's; other sites open in the browser.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun DmrRulesView(base: String, onOpenConfig: () -> Unit) {
    var error by remember(base) { mutableStateOf<String?>(null) }
    val openConfig by rememberUpdatedState(onOpenConfig)
    Column(Modifier.fillMaxSize()) {
        error?.let {
            Text("No se pudo cargar la guía de reglas: $it", color = Danger, fontSize = 11.sp,
                modifier = Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 4.dp))
        }
        // another dashboard (profile): a new page
        key(base) { AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { c ->
                WebView(c).apply {
                    setBackgroundColor(Bg.toArgb())
                    settings.javaScriptEnabled = true
                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { error = null }

                        // as soon as the page is in the DOM (no light flash) and again once loaded
                        override fun onPageCommitVisible(view: WebView, url: String?) { view.evaluateJavascript(DARK_THEME_JS, null) }

                        override fun onPageFinished(view: WebView, url: String?) { view.evaluateJavascript(DARK_THEME_JS, null) }

                        override fun onReceivedError(view: WebView, request: WebResourceRequest, err: WebResourceError) {
                            if (request.isForMainFrame) error = err.description?.toString() ?: "error"
                        }

                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val url = request.url
                            val own = Uri.parse(base).host
                            if (url.host == own && url.path?.trimEnd('/') == "/dmr-config") { openConfig(); return true }
                            if (url.host == own) return false
                            runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, url)) }
                            return true
                        }
                    }
                    loadUrl("$base/dmr-rules.html")
                }
            },
            onRelease = { it.destroy() },
        ) }
    }
}
