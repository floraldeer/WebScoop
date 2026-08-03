package com.lurich.webscoop.presentation.login

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Message
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.lurich.webscoop.data.cookie.WebViewCookieStore
import com.lurich.webscoop.domain.login.AllowedLoginHost
import com.lurich.webscoop.domain.model.Platform
import java.net.URI

@Composable
fun PlatformLoginDialog(
    platform: Platform,
    cookieStore: WebViewCookieStore,
    onDismiss: () -> Unit,
) {
    val webViews = remember { mutableListOf<WebView>() }
    BackHandler(onBack = onDismiss)

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(Modifier.fillMaxSize()) {
                Button(
                    onClick = onDismiss,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                ) {
                    Text("完成登录并返回")
                }
                AndroidView(
                    factory = { context ->
                        FrameLayout(context).also { frame ->
                            val webView = WebView(context)
                            webViews += webView
                            configureWebView(webView, frame, webViews, platform, cookieStore)
                            frame.addView(
                                webView,
                                FrameLayout.LayoutParams(
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                    ViewGroup.LayoutParams.MATCH_PARENT,
                                ),
                            )
                            webView.loadUrl(platform.loginUrl.toString())
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                )
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            webViews.toList().forEach { webView ->
                (webView.parent as? ViewGroup)?.removeView(webView)
                webView.destroy()
            }
            webViews.clear()
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun configureWebView(
    webView: WebView,
    container: FrameLayout,
    webViews: MutableList<WebView>,
    platform: Platform,
    cookieStore: WebViewCookieStore,
) {
    WebView.setWebContentsDebuggingEnabled(false)
    webView.settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        javaScriptCanOpenWindowsAutomatically = true
        setSupportMultipleWindows(true)
    }
    webView.webViewClient = LoginWebViewClient(platform, cookieStore)
    webView.webChromeClient = LoginWebChromeClient(container, webViews, platform, cookieStore)
}

private class LoginWebViewClient(
    private val platform: Platform,
    private val cookieStore: WebViewCookieStore,
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url.toSafeURI() ?: return true
        if (AllowedLoginHost.accepts(platform, uri)) return false
        Toast.makeText(view.context, "已阻止非授权登录域名", Toast.LENGTH_SHORT).show()
        return true
    }

    override fun onPageFinished(view: WebView, url: String) {
        cookieStore.flush()
    }
}

private class LoginWebChromeClient(
    private val container: FrameLayout,
    private val webViews: MutableList<WebView>,
    private val platform: Platform,
    private val cookieStore: WebViewCookieStore,
) : WebChromeClient() {
    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        if (!isUserGesture) return false
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
        val popup = WebView(view.context)
        webViews += popup
        configureWebView(popup, container, webViews, platform, cookieStore)
        container.addView(
            popup,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        transport.webView = popup
        resultMsg.sendToTarget()
        return true
    }

    override fun onCloseWindow(window: WebView) {
        container.removeView(window)
        webViews.remove(window)
        window.destroy()
    }
}

private fun Uri.toSafeURI(): URI? = runCatching { URI(toString()) }.getOrNull()
