package com.ea5gvk.tetralivemonitor

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.ea5gvk.tetralivemonitor.data.Settings
import com.ea5gvk.tetralivemonitor.net.TetraClient
import com.ea5gvk.tetralivemonitor.ui.TetraApp
import com.ea5gvk.tetralivemonitor.ui.theme.Bg
import com.ea5gvk.tetralivemonitor.ui.theme.TetraTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // osmdroid: tile servers reject the default user agent, and the default cache
        // path is not writable on modern Android. Point it at app-internal storage.
        val osm = org.osmdroid.config.Configuration.getInstance()
        osm.load(applicationContext, getSharedPreferences("osmdroid", MODE_PRIVATE))
        osm.userAgentValue = packageName
        osm.osmdroidBasePath = java.io.File(cacheDir, "osmdroid").apply { mkdirs() }
        osm.osmdroidTileCache = java.io.File(osm.osmdroidBasePath, "tiles").apply { mkdirs() }

        val settings = Settings(applicationContext)
        val client = TetraClient(lifecycleScope)

        // Reconnect whenever the saved server URL changes.
        lifecycleScope.launch {
            settings.serverUrl.collect { raw ->
                val base = Settings.normalize(raw)
                if (base != null) client.connectTo(base) else client.disconnect()
            }
        }

        setContent {
            TetraTheme {
                Surface(modifier = Modifier.fillMaxSize().background(Bg), color = Bg) {
                    val state by client.state.collectAsStateWithLifecycle()
                    val url by settings.serverUrl.collectAsStateWithLifecycle(initialValue = "")
                    val pw by settings.password.collectAsStateWithLifecycle(initialValue = "")
                    val profiles by settings.profiles.collectAsStateWithLifecycle(initialValue = emptyList())
                    TetraApp(
                        state = state,
                        serverUrl = url,
                        password = pw,
                        base = Settings.normalize(url),
                        profiles = profiles,
                        onSaveUrl = { lifecycleScope.launch { settings.setServerUrl(it) } },
                        onSavePassword = { lifecycleScope.launch { settings.setPassword(it) } },
                        onSaveProfile = { lifecycleScope.launch { settings.saveProfile(it) } },
                        onDeleteProfile = { lifecycleScope.launch { settings.removeProfile(it) } },
                    )
                }
            }
        }
    }
}
