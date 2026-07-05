package com.ea5gvk.tetralivemonitor.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** Persists the base URL of the tetra-live-monitor server the app connects to. */
class Settings(private val context: Context) {

    val serverUrl: Flow<String> = context.dataStore.data.map { it[KEY_SERVER_URL] ?: "" }
    val password: Flow<String> = context.dataStore.data.map { it[KEY_PASSWORD] ?: "" }

    suspend fun setServerUrl(url: String) {
        context.dataStore.edit { it[KEY_SERVER_URL] = url.trim() }
    }

    suspend fun setPassword(pw: String) {
        context.dataStore.edit { it[KEY_PASSWORD] = pw }
    }

    companion object {
        private val KEY_SERVER_URL = stringPreferencesKey("server_url")
        private val KEY_PASSWORD = stringPreferencesKey("system_password")

        /**
         * Normalizes user input (e.g. `10.33.1.75:5000`, `http://pi:5000`,
         * `https://tetra.arsacnp.eu`) into a clean `scheme://host[:port]` base with no
         * trailing slash. Returns null when the input has no host.
         */
        fun normalize(raw: String): String? {
            var s = raw.trim()
            if (s.isEmpty()) return null
            if (!s.contains("://")) s = "http://$s"
            s = s.trimEnd('/')
            val schemeSep = s.indexOf("://")
            val host = s.substring(schemeSep + 3)
            if (host.isEmpty()) return null
            return s
        }

        /** Derives the `ws(s)://host/ws` endpoint from a normalized base URL. */
        fun wsUrl(base: String): String {
            val wsScheme = if (base.startsWith("https://")) "wss://" else "ws://"
            val hostPart = base.substringAfter("://")
            return "$wsScheme$hostPart/ws"
        }
    }
}
