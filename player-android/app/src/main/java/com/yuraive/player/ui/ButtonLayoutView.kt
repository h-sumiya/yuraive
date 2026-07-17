package com.yuraive.player.ui

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.yuraive.player.model.RenderedButton
import com.yuraive.player.model.YuraiveJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

/** JNI entry point for the shared safe HTML/CSS subset interpreter. */
internal object NativeButtonLayoutEngine {
    init {
        System.loadLibrary("yuraive_runtime")
    }

    external fun resolveJsonNative(request: String): String
}

@Serializable
private data class NativeLayoutRequest(
    val source: String,
    val buttons: List<RenderedButton>,
    val canvas: NativeLayoutCanvas,
)

@Serializable
private data class NativeLayoutCanvas(
    val width: Float,
    val height: Float,
    val density: Float = 1f,
    val fontScale: Float = 1f,
    val safeTop: Float = 0f,
    val safeRight: Float = 0f,
    val safeBottom: Float = 0f,
    val safeLeft: Float = 0f,
)

@Serializable
private data class NativeLayoutResponse(
    val buttons: List<NativeLayoutButton> = emptyList(),
    val issues: List<String> = emptyList(),
)

@Serializable
private data class NativeLayoutButton(
    val id: String,
    val text: String,
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
    val zIndex: Int,
    val enabled: Boolean,
    val style: NativeButtonStyle,
)

@Serializable
private data class NativeButtonStyle(
    val backgroundColor: String = "#00000000",
    val backgroundImage: String? = null,
    val backgroundSize: String = "cover",
    val backgroundPosition: String = "center",
    val backgroundRepeat: String = "no-repeat",
    val textColor: String = "#ff000000",
    val opacity: Float = 1f,
    val borderColor: String = "#00000000",
    val borderWidth: Float = 0f,
    val borderRadius: Float = 0f,
    val fontSize: Float = 16f,
    val fontWeight: Int = 400,
    val paddingLeft: Float = 0f,
    val paddingTop: Float = 0f,
    val paddingRight: Float = 0f,
    val paddingBottom: Float = 0f,
    val textAlign: String = "center",
    val verticalAlign: String = "center",
    val lineHeight: Float = 19.2f,
    val letterSpacing: Float = 0f,
    val whiteSpace: String = "normal",
    val textOverflow: String = "clip",
    val overflow: String = "visible",
    val boxShadow: String? = null,
    val filter: String? = null,
    val transform: String? = null,
)

/**
 * Native Compose projection of the shared layout model. The expensive parser/layout pass is
 * memoized by structural button state and canvas dimensions, so playback clock updates do not
 * rebuild the tree. Unlike WebView, this layer composes transparently with the artwork below it.
 */
@Composable
internal fun ButtonLayoutView(
    source: String,
    buttons: List<RenderedButton>,
    onPress: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val width = maxWidth.value
        val height = maxHeight.value
        val response =
            remember(source, buttons, width, height, density.density, density.fontScale) {
                if (width <= 0f || height <= 0f) NativeLayoutResponse()
                else
                    runCatching {
                            val request =
                                NativeLayoutRequest(
                                    source = source,
                                    buttons = buttons,
                                    canvas =
                                        NativeLayoutCanvas(
                                            width,
                                            height,
                                            density.density,
                                            density.fontScale,
                                        ),
                                )
                            YuraiveJson.format.decodeFromString(
                                NativeLayoutResponse.serializer(),
                                NativeButtonLayoutEngine.resolveJsonNative(
                                    YuraiveJson.format.encodeToString(
                                        NativeLayoutRequest.serializer(),
                                        request,
                                    )
                                ),
                            )
                        }
                        .getOrDefault(NativeLayoutResponse())
            }
        response.buttons.forEach { button -> NativeButton(button, onPress) }
    }
}

@Composable
private fun NativeButton(button: NativeLayoutButton, onPress: (String) -> Unit) {
    val style = button.style
    val shape = RoundedCornerShape(style.borderRadius.coerceAtLeast(0f).dp)
    var modifier =
        Modifier.offset(button.x.dp, button.y.dp)
            .size(button.width.coerceAtLeast(0f).dp, button.height.coerceAtLeast(0f).dp)
            .zIndex(button.zIndex.toFloat())
    shadowElevation(style.boxShadow)?.let { elevation ->
        modifier = modifier.shadow(elevation.dp, shape, clip = false)
    }
    modifier =
        modifier
            .graphicsLayer { applyCssTransform(style.transform) }
            .alpha((style.opacity * filterOpacity(style.filter)).coerceIn(0f, 1f))
            .clip(shape)
            .background(cssColor(style.backgroundColor, Color.Transparent), shape)
    if (style.borderWidth > 0f) {
        modifier =
            modifier.border(
                style.borderWidth.dp,
                cssColor(style.borderColor, Color.Transparent),
                shape,
            )
    }
    if (button.enabled) modifier = modifier.clickable(role = Role.Button) { onPress(button.id) }

    Box(modifier = modifier, contentAlignment = verticalAlignment(style.verticalAlign)) {
        ButtonBackground(style)
        Text(
            text = button.text,
            color = cssColor(style.textColor, Color.Black),
            fontSize = style.fontSize.coerceAtLeast(1f).sp,
            fontWeight = FontWeight(style.fontWeight.coerceIn(1, 1000)),
            lineHeight = style.lineHeight.coerceAtLeast(style.fontSize).sp,
            letterSpacing = style.letterSpacing.sp,
            textAlign = textAlign(style.textAlign),
            softWrap = !style.whiteSpace.equals("nowrap", ignoreCase = true),
            maxLines =
                if (style.whiteSpace.equals("nowrap", ignoreCase = true)) 1 else Int.MAX_VALUE,
            overflow =
                if (style.textOverflow.equals("ellipsis", ignoreCase = true)) TextOverflow.Ellipsis
                else TextOverflow.Clip,
            modifier =
                Modifier.fillMaxWidth()
                    .padding(
                        start = style.paddingLeft.coerceAtLeast(0f).dp,
                        top = style.paddingTop.coerceAtLeast(0f).dp,
                        end = style.paddingRight.coerceAtLeast(0f).dp,
                        bottom = style.paddingBottom.coerceAtLeast(0f).dp,
                    ),
        )
    }
}

@Composable
private fun ButtonBackground(style: NativeButtonStyle) {
    val uriString = style.backgroundImage
    val context = LocalContext.current
    val bitmap by
        produceState<android.graphics.Bitmap?>(initialValue = null, uriString) {
            value =
                if (uriString.isNullOrBlank()) null
                else
                    withContext(Dispatchers.IO) {
                        runCatching {
                                context.contentResolver
                                    .openInputStream(Uri.parse(uriString))
                                    ?.use(BitmapFactory::decodeStream)
                            }
                            .getOrNull()
                    }
        }
    bitmap?.let {
        Image(
            bitmap = it.asImageBitmap(),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = backgroundScale(style.backgroundSize),
            alignment = backgroundAlignment(style.backgroundPosition),
        )
    }
}

private fun backgroundScale(value: String): ContentScale =
    when {
        value.equals("contain", ignoreCase = true) -> ContentScale.Fit
        value.equals("auto", ignoreCase = true) -> ContentScale.None
        value.contains("100% 100%", ignoreCase = true) -> ContentScale.FillBounds
        else -> ContentScale.Crop
    }

private fun backgroundAlignment(value: String): Alignment {
    val lower = value.lowercase()
    return when {
        "top" in lower && "left" in lower -> Alignment.TopStart
        "top" in lower && "right" in lower -> Alignment.TopEnd
        "bottom" in lower && "left" in lower -> Alignment.BottomStart
        "bottom" in lower && "right" in lower -> Alignment.BottomEnd
        "top" in lower -> Alignment.TopCenter
        "bottom" in lower -> Alignment.BottomCenter
        "left" in lower -> Alignment.CenterStart
        "right" in lower -> Alignment.CenterEnd
        else -> Alignment.Center
    }
}

private fun verticalAlignment(value: String): Alignment =
    when (value.lowercase()) {
        "start",
        "flex-start" -> Alignment.TopCenter
        "end",
        "flex-end" -> Alignment.BottomCenter
        else -> Alignment.Center
    }

private fun textAlign(value: String): TextAlign =
    when (value.lowercase()) {
        "left",
        "start" -> TextAlign.Start
        "right",
        "end" -> TextAlign.End
        "justify" -> TextAlign.Justify
        else -> TextAlign.Center
    }

private fun cssColor(value: String?, fallback: Color): Color {
    if (value.isNullOrBlank()) return fallback
    val text = value.trim().lowercase()
    if (text == "transparent") return Color.Transparent
    val named =
        mapOf(
            "black" to Color.Black,
            "white" to Color.White,
            "red" to Color.Red,
            "green" to Color.Green,
            "blue" to Color.Blue,
        )
    named[text]?.let {
        return it
    }
    if (text.startsWith('#')) {
        var hex = text.drop(1)
        if (hex.length == 3 || hex.length == 4)
            hex = hex.flatMap { listOf(it, it) }.joinToString("")
        runCatching {
                when (hex.length) {
                    6 -> Color(0xff000000L or hex.toLong(16))
                    8 -> { // CSS #RRGGBBAA -> Compose ARGB
                        val raw = hex.toLong(16)
                        Color(((raw and 0xff) shl 24) or (raw ushr 8))
                    }
                    else -> fallback
                }
            }
            .getOrNull()
            ?.let {
                return it
            }
    }
    val components =
        Regex("rgba?\\(([^)]*)\\)")
            .matchEntire(text)
            ?.groupValues
            ?.get(1)
            ?.split(',')
            ?.map(String::trim)
    if (components != null && components.size >= 3) {
        val red = components[0].toFloatOrNull()?.div(255f) ?: return fallback
        val green = components[1].toFloatOrNull()?.div(255f) ?: return fallback
        val blue = components[2].toFloatOrNull()?.div(255f) ?: return fallback
        val alpha = components.getOrNull(3)?.toFloatOrNull() ?: 1f
        return Color(
            red.coerceIn(0f, 1f),
            green.coerceIn(0f, 1f),
            blue.coerceIn(0f, 1f),
            alpha.coerceIn(0f, 1f),
        )
    }
    return fallback
}

private fun androidx.compose.ui.graphics.GraphicsLayerScope.applyCssTransform(value: String?) {
    if (value.isNullOrBlank() || value.equals("none", ignoreCase = true)) return
    Regex("([a-zA-Z]+)\\(([^)]*)\\)").findAll(value).forEach { match ->
        val name = match.groupValues[1].lowercase()
        val numbers =
            match.groupValues[2].split(',', ' ').filter(String::isNotBlank).map {
                it.trim().removeSuffix("px").removeSuffix("deg").toFloatOrNull() ?: 0f
            }
        when (name) {
            "translate" -> {
                translationX = numbers.getOrElse(0) { 0f }
                translationY = numbers.getOrElse(1) { 0f }
            }
            "translatex" -> translationX = numbers.getOrElse(0) { 0f }
            "translatey" -> translationY = numbers.getOrElse(0) { 0f }
            "scale" -> {
                scaleX = numbers.getOrElse(0) { 1f }
                scaleY = numbers.getOrElse(1) { scaleX }
            }
            "rotate" -> rotationZ = numbers.getOrElse(0) { 0f }
        }
    }
}

private fun shadowElevation(value: String?): Float? {
    if (value.isNullOrBlank() || value.equals("none", ignoreCase = true)) return null
    val lengths =
        Regex("-?\\d+(?:\\.\\d+)?px")
            .findAll(value)
            .map { it.value.removeSuffix("px").toFloat() }
            .toList()
    return lengths.getOrNull(2)?.coerceAtLeast(0f) ?: lengths.lastOrNull()?.coerceAtLeast(0f)
}

private fun filterOpacity(value: String?): Float {
    val raw =
        value?.let {
            Regex("opacity\\(([^)]*)\\)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)
        } ?: return 1f
    return if (raw.trim().endsWith('%'))
        raw.trim().removeSuffix("%").toFloatOrNull()?.div(100f) ?: 1f
    else raw.toFloatOrNull() ?: 1f
}
