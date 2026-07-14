package dev.hiro.wmgfplayer.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import dev.hiro.wmgfplayer.model.RenderedButton
import dev.hiro.wmgfplayer.model.WmgJson
import dev.hiro.wmgfplayer.model.WmgLayout
import kotlinx.serialization.builtins.ListSerializer
import java.io.ByteArrayInputStream

private class LayoutBridge(private val view: LayoutWebView) {
    @JavascriptInterface
    fun press(buttonId: String) {
        view.post { view.onPress(buttonId) }
    }
}

@SuppressLint("ViewConstructor", "SetJavaScriptEnabled")
private class LayoutWebView(context: Context) : WebView(context) {
    var onPress: (String) -> Unit = {}
    private var loadedSource: String? = null
    private var buttonsJson: String = "[]"

    init {
        setBackgroundColor(Color.TRANSPARENT)
        setLayerType(View.LAYER_TYPE_HARDWARE, null)
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = false
        settings.allowFileAccess = false
        settings.allowContentAccess = true
        settings.blockNetworkLoads = true
        settings.cacheMode = WebSettings.LOAD_NO_CACHE
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        addJavascriptInterface(LayoutBridge(this), BRIDGE_NAME)
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                installRuntime()
                syncButtons()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.url.scheme in setOf("http", "https")) {
                    WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
                } else null
        }
    }

    fun update(source: String, buttons: List<RenderedButton>, press: (String) -> Unit) {
        onPress = press
        buttonsJson = WmgJson.format.encodeToString(ListSerializer(RenderedButton.serializer()), buttons)
        if (source != loadedSource) {
            loadedSource = source
            loadDataWithBaseURL(BASE_URL, WmgLayout.buildDocument(source), "text/html", "utf-8", null)
        } else {
            syncButtons()
        }
    }

    private fun installRuntime() {
        evaluateJavascript(RUNTIME_SCRIPT, null)
    }

    private fun syncButtons() {
        evaluateJavascript("window.wmgfSetButtons && window.wmgfSetButtons($buttonsJson)", null)
    }

    private companion object {
        const val BASE_URL = "https://wmgf.invalid/"
        const val BRIDGE_NAME = "WMGFButtonBridge"
        val RUNTIME_SCRIPT = """
            (() => {
              const canvasVars = () => {
                const root = document.documentElement;
                root.style.setProperty('--wmg-canvas-width', innerWidth + 'px');
                root.style.setProperty('--wmg-canvas-height', innerHeight + 'px');
                root.style.setProperty('--wmg-safe-top', '0px');
                root.style.setProperty('--wmg-safe-right', '0px');
                root.style.setProperty('--wmg-safe-bottom', '0px');
                root.style.setProperty('--wmg-safe-left', '0px');
                root.style.setProperty('--wmg-density', String(devicePixelRatio || 1));
                root.style.setProperty('--wmg-font-scale', '1');
              };
              window.wmgfSetButtons = (buttons) => {
                document.querySelectorAll('.wmg-button[data-wmg-injected]').forEach(node => node.remove());
                const slots = Array.from(document.querySelectorAll('slot'));
                const slotId = slot => (slot.getAttribute('name') || slot.id || '').trim();
                const defaultSlot = slots.find(slot => !slotId(slot));
                buttons.filter(button => button.visible).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(button => {
                  const requested = String(button.targetSlot || '').trim();
                  const target = (requested ? slots.find(slot => slotId(slot) === requested) : defaultSlot) || defaultSlot;
                  if (!target) return;
                  const node = document.createElement('button');
                  node.type = 'button';
                  node.className = 'wmg-button';
                  node.dataset.wmgInjected = 'true';
                  node.dataset.buttonId = button.id;
                  node.style.order = String(button.order || 0);
                  node.style.zIndex = String(button.zIndex || 0);
                  node.textContent = button.text;
                  const style = button.style || {};
                  if (style.backgroundColor != null) node.style.backgroundColor = style.backgroundColor;
                  if (style.backgroundImage != null) {
                    node.style.backgroundImage = `url(${'$'}{JSON.stringify(style.backgroundImage)})`;
                    node.style.backgroundSize = 'cover';
                    node.style.backgroundPosition = 'center';
                  }
                  if (style.textColor != null) node.style.color = style.textColor;
                  if (style.opacity != null) node.style.opacity = String(style.opacity);
                  if (style.borderColor != null) node.style.borderColor = style.borderColor;
                  if (style.borderWidth != null) { node.style.borderWidth = style.borderWidth + 'px'; node.style.borderStyle = 'solid'; }
                  if (style.borderRadius != null) node.style.borderRadius = style.borderRadius + 'px';
                  if (style.fontSize != null) node.style.fontSize = style.fontSize + 'px';
                  if (style.fontWeight != null) node.style.fontWeight = String(style.fontWeight);
                  if (style.paddingHorizontal != null) { node.style.paddingLeft = style.paddingHorizontal + 'px'; node.style.paddingRight = style.paddingHorizontal + 'px'; }
                  if (style.paddingVertical != null) { node.style.paddingTop = style.paddingVertical + 'px'; node.style.paddingBottom = style.paddingVertical + 'px'; }
                  node.addEventListener('click', () => window.$BRIDGE_NAME.press(button.id));
                  target.appendChild(node);
                });
                canvasVars();
              };
              if (!window.wmgfCanvasListener) {
                window.addEventListener('resize', canvasVars);
                window.wmgfCanvasListener = true;
              }
              canvasVars();
            })();
        """.trimIndent()
    }
}

@Composable
internal fun ButtonLayoutView(
    source: String,
    buttons: List<RenderedButton>,
    onPress: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    AndroidView(
        factory = { LayoutWebView(it) },
        update = { it.update(source, buttons, onPress) },
        modifier = modifier,
    )
}
