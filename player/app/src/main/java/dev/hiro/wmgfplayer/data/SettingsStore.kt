package dev.hiro.wmgfplayer.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class PlayerSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val accentIndex: Int = 0,
    val scriptTimeoutMs: Long = 1_200,
    val forceShowPlayerControls: Boolean = false,
)

class SettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(read())
    val state: StateFlow<PlayerSettings> = mutable

    fun update(transform: (PlayerSettings) -> PlayerSettings) {
        val transformed = transform(mutable.value)
        val value = transformed.copy(scriptTimeoutMs = transformed.scriptTimeoutMs.coerceIn(100, 10_000))
        preferences.edit()
            .putString("theme", value.themeMode.name)
            .putInt("accent", value.accentIndex)
            .putLong("scriptTimeout", value.scriptTimeoutMs)
            .putBoolean("forceShowPlayerControls", value.forceShowPlayerControls)
            .apply()
        mutable.value = value
    }

    private fun read() = PlayerSettings(
        themeMode = runCatching { ThemeMode.valueOf(preferences.getString("theme", null) ?: "SYSTEM") }.getOrDefault(ThemeMode.SYSTEM),
        accentIndex = preferences.getInt("accent", 0),
        scriptTimeoutMs = preferences.getLong("scriptTimeout", 1_200).coerceIn(100, 10_000),
        forceShowPlayerControls = preferences.getBoolean("forceShowPlayerControls", false),
    )
}
