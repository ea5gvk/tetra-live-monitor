package com.ea5gvk.tetralivemonitor.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.ea5gvk.tetralivemonitor.net.TgEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

/** A saved flowstation: friendly name + server URL + system password. */
@kotlinx.serialization.Serializable
data class ServerProfile(
    val id: String,
    val name: String,
    val url: String,
    val password: String = "",
)

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

    /** Saved server profiles (varias flowstations). The active one is whichever URL is loaded. */
    val profiles: Flow<List<ServerProfile>> = context.dataStore.data.map { prefs ->
        decodeProfiles(prefs[KEY_PROFILES])
    }

    /** Inserts or updates a profile (by id) keeping the list order. */
    suspend fun saveProfile(entry: ServerProfile) {
        context.dataStore.edit { prefs ->
            val cur = decodeProfiles(prefs[KEY_PROFILES])
            val updated = if (cur.any { it.id == entry.id }) cur.map { if (it.id == entry.id) entry else it }
            else cur + entry
            prefs[KEY_PROFILES] = JSON.encodeToString(PROFILE_LIST, updated)
        }
    }

    suspend fun removeProfile(id: String) {
        context.dataStore.edit { prefs ->
            val cur = decodeProfiles(prefs[KEY_PROFILES])
            prefs[KEY_PROFILES] = JSON.encodeToString(PROFILE_LIST, cur.filter { it.id != id })
        }
    }

    private fun decodeProfiles(raw: String?): List<ServerProfile> =
        if (raw.isNullOrBlank()) emptyList()
        else runCatching { JSON.decodeFromString(PROFILE_LIST, raw) }.getOrDefault(emptyList())

    /** DGNA quick-assign library: talkgroups saved after a successful assignment. */
    val tgLibrary: Flow<List<TgEntry>> = context.dataStore.data.map { prefs ->
        decodeTgs(prefs[KEY_TG_LIBRARY])
    }

    suspend fun addTg(entry: TgEntry) {
        context.dataStore.edit { prefs ->
            val cur = decodeTgs(prefs[KEY_TG_LIBRARY])
            val updated = listOf(entry) + cur.filter { it.gssi != entry.gssi } // newest first, dedupe by GSSI
            prefs[KEY_TG_LIBRARY] = JSON.encodeToString(TG_LIST, updated)
        }
    }

    suspend fun removeTg(gssi: Int) {
        context.dataStore.edit { prefs ->
            val cur = decodeTgs(prefs[KEY_TG_LIBRARY])
            prefs[KEY_TG_LIBRARY] = JSON.encodeToString(TG_LIST, cur.filter { it.gssi != gssi })
        }
    }

    private fun decodeTgs(raw: String?): List<TgEntry> =
        if (raw.isNullOrBlank()) emptyList()
        else runCatching { JSON.decodeFromString(TG_LIST, raw) }.getOrDefault(emptyList())

    /** Talkgroup names loaded from BrandMeister / ADN (GET /api/talkgroups): GSSI (as string) -> name. */
    val tgNames: Flow<Map<String, String>> = context.dataStore.data.map { it[KEY_TG_NAMES] }
        .distinctUntilChanged().map { decodeNames(it) }

    /** Source of [tgNames]: "bm" | "adn", or "" when none loaded. */
    val tgNamesSource: Flow<String> = context.dataStore.data.map { it[KEY_TG_NAMES_SOURCE] ?: "" }.distinctUntilChanged()

    suspend fun setTgNames(source: String, names: Map<String, String>) {
        context.dataStore.edit {
            it[KEY_TG_NAMES] = JSON.encodeToString(NAME_MAP, names)
            it[KEY_TG_NAMES_SOURCE] = source
        }
    }

    suspend fun clearTgNames() {
        context.dataStore.edit { it.remove(KEY_TG_NAMES); it.remove(KEY_TG_NAMES_SOURCE) }
    }

    /** The user's own ISSI names (shown when the radio has no callsign): ISSI (as string) -> name. */
    val issiNames: Flow<Map<String, String>> = context.dataStore.data.map { it[KEY_ISSI_NAMES] }
        .distinctUntilChanged().map { decodeNames(it) }

    /** Sets (or, with a blank name, removes) the own name of an ISSI. */
    suspend fun setIssiName(issi: String, name: String) {
        context.dataStore.edit { prefs ->
            val cur = decodeNames(prefs[KEY_ISSI_NAMES])
            val updated = if (name.isBlank()) cur - issi else cur + (issi to name.trim())
            prefs[KEY_ISSI_NAMES] = JSON.encodeToString(NAME_MAP, updated)
        }
    }

    private fun decodeNames(raw: String?): Map<String, String> =
        if (raw.isNullOrBlank()) emptyMap()
        else runCatching { JSON.decodeFromString(NAME_MAP, raw) }.getOrDefault(emptyMap())

    companion object {
        private val KEY_SERVER_URL = stringPreferencesKey("server_url")
        private val KEY_PASSWORD = stringPreferencesKey("system_password")
        private val KEY_TG_LIBRARY = stringPreferencesKey("tg_library")
        private val KEY_PROFILES = stringPreferencesKey("server_profiles")
        private val KEY_TG_NAMES = stringPreferencesKey("tg_names")
        private val KEY_TG_NAMES_SOURCE = stringPreferencesKey("tg_names_source")
        private val KEY_ISSI_NAMES = stringPreferencesKey("issi_names")
        private val NAME_MAP = MapSerializer(String.serializer(), String.serializer())
        private val JSON = Json { ignoreUnknownKeys = true }
        private val TG_LIST = ListSerializer(TgEntry.serializer())
        private val PROFILE_LIST = ListSerializer(ServerProfile.serializer())

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
