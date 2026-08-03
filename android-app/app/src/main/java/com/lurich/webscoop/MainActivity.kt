package com.lurich.webscoop

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.lurich.webscoop.presentation.WebScoopApp
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val sharedText = MutableStateFlow("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        sharedText.value = intent.sharedText()
        val services = (application as WebScoopApplication).services
        setContent {
            WebScoopApp(
                sharedText = sharedText,
                parser = services.parser,
                cookieStore = services.cookieStore,
                downloader = services.downloader,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        sharedText.value = intent.sharedText()
    }
}

private fun Intent.sharedText(): String {
    if (action != Intent.ACTION_SEND || type != "text/plain") return ""
    return getStringExtra(Intent.EXTRA_TEXT).orEmpty()
}
