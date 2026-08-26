package com.tilawatak

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.tilawatak.notification.NotificationHelper
import com.tilawatak.notification.WebAppInterface
import java.util.concurrent.Executor

/**
 * Production-Grade Android WebView Wrapper for Tilawatak LilAlam (تلاوتك للعالم).
 * The Web version (https://tilawataklilalam.vercel.app/) is the Single Source of Truth.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val WEB_PRODUCTION_URL = "https://tilawataklilalam.vercel.app/"
        private const val PRIMARY_HOST = "tilawataklilalam.vercel.app"
    }

    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val data = result.data
            val results = if (data?.dataString != null) {
                arrayOf(Uri.parse(data.dataString))
            } else if (data?.clipData != null) {
                val clip = data.clipData!!
                Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
            } else {
                null
            }
            filePathCallback?.onReceiveValue(results)
        } else {
            filePathCallback?.onReceiveValue(null)
        }
        filePathCallback = null
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    private val audioRecordingPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize Android notification channel
        NotificationHelper.createNotificationChannel(this)

        // Request runtime permissions on modern Android versions
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            audioRecordingPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }

        setContent {
            val webViewRef = remember { mutableStateOf<WebView?>(null) }

            // Back button handling: navigate back inside WebView history first
            BackHandler(enabled = true) {
                val wv = webViewRef.value
                if (wv != null && wv.canGoBack()) {
                    wv.goBack()
                } else {
                    finish()
                }
            }

            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        webViewRef.value = this
                        WebView.setWebContentsDebuggingEnabled(true)

                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            databaseEnabled = true
                            allowFileAccess = true
                            allowContentAccess = true
                            mediaPlaybackRequiresUserGesture = false
                            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            cacheMode = WebSettings.LOAD_DEFAULT
                            setSupportZoom(false)
                            builtInZoomControls = false
                            displayZoomControls = false
                            useWideViewPort = true
                            loadWithOverviewMode = true
                            setSupportMultipleWindows(false)
                        }

                        // Enable cross-site & Supabase cookies
                        val cookieManager = CookieManager.getInstance()
                        cookieManager.setAcceptCookie(true)
                        cookieManager.setAcceptThirdPartyCookies(this, true)

                        // Native Biometric Authentication for Web Admin Portal
                        val biometricExecutor: Executor = ContextCompat.getMainExecutor(context)
                        val biometricPrompt = BiometricPrompt(this@MainActivity, biometricExecutor,
                            object : BiometricPrompt.AuthenticationCallback() {
                                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                                    super.onAuthenticationSucceeded(result)
                                    evaluateJavascript("window.dispatchEvent(new CustomEvent('android-biometric-success'));", null)
                                }

                                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                                    super.onAuthenticationError(errorCode, errString)
                                    evaluateJavascript("window.dispatchEvent(new CustomEvent('android-biometric-error', {detail: '${errString}'}));", null)
                                }

                                override fun onAuthenticationFailed() {
                                    super.onAuthenticationFailed()
                                    Toast.makeText(context, "فشل التحقق بالبصمة", Toast.LENGTH_SHORT).show()
                                }
                            })

                        val promptInfo = BiometricPrompt.PromptInfo.Builder()
                            .setTitle("مصادقة لوحة الإدارة")
                            .setSubtitle("استخدم بصمة الإصبع أو الوجه للتحقق من هويتك")
                            .setNegativeButtonText("إلغاء")
                            .build()

                        // Android JS Bridge for Notifications & Biometric Authentication
                        addJavascriptInterface(
                            WebAppInterface(context) {
                                runOnUiThread {
                                    try {
                                        biometricPrompt.authenticate(promptInfo)
                                    } catch (e: Exception) {
                                        Toast.makeText(context, "المصادقة الحيوية غير متوفرة على هذا الجهاز", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            "AndroidBridge"
                        )

                        // URL Navigation & Routing policy
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                val url = request?.url?.toString() ?: return false
                                val uri = Uri.parse(url)
                                val scheme = uri.scheme?.lowercase() ?: ""
                                val host = uri.host?.lowercase() ?: ""

                                // Keep internal & authentication URLs inside WebView
                                if (isInternalOrAuthUrl(host, scheme, url)) {
                                    return false
                                }

                                // Handle special schemes (tel, mailto, whatsapp, intent)
                                if (scheme == "tel" || scheme == "mailto" || scheme == "whatsapp" || scheme == "sms" || scheme == "market") {
                                    return try {
                                        val intent = Intent(Intent.ACTION_VIEW, uri)
                                        view?.context?.startActivity(intent)
                                        true
                                    } catch (e: Exception) {
                                        false
                                    }
                                }

                                // External links (other domains) open in default external browser
                                return try {
                                    val intent = Intent(Intent.ACTION_VIEW, uri)
                                    view?.context?.startActivity(intent)
                                    true
                                } catch (e: Exception) {
                                    false
                                }
                            }
                        }

                        // WebChromeClient for File Chooser, Permissions & Audio recording
                        webChromeClient = object : WebChromeClient() {
                            override fun onPermissionRequest(request: PermissionRequest?) {
                                request?.let {
                                    val resources = it.resources
                                    val granted = resources.filter { res ->
                                        res == PermissionRequest.RESOURCE_AUDIO_CAPTURE ||
                                        res == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                                    }.toTypedArray()
                                    if (granted.isNotEmpty()) {
                                        it.grant(granted)
                                    } else {
                                        it.deny()
                                    }
                                }
                            }

                            override fun onShowFileChooser(
                                webView: WebView?,
                                filePathCallback: ValueCallback<Array<Uri>>?,
                                fileChooserParams: FileChooserParams?
                            ): Boolean {
                                this@MainActivity.filePathCallback?.onReceiveValue(null)
                                this@MainActivity.filePathCallback = filePathCallback

                                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                                    type = "*/*"
                                    addCategory(Intent.CATEGORY_OPENABLE)
                                }
                                return try {
                                    fileChooserLauncher.launch(intent)
                                    true
                                } catch (e: Exception) {
                                    this@MainActivity.filePathCallback = null
                                    false
                                }
                            }

                            override fun onCreateWindow(
                                view: WebView?,
                                isDialog: Boolean,
                                isUserGesture: Boolean,
                                resultMsg: Message?
                            ): Boolean {
                                val href = view?.handler?.obtainMessage()
                                view?.requestFocusNodeHref(href)
                                val url = href?.data?.getString("url")
                                if (!url.isNullOrBlank()) {
                                    view.loadUrl(url)
                                    return true
                                }
                                return false
                            }
                        }

                        // Load the central Web Production URL
                        loadUrl(WEB_PRODUCTION_URL)
                    }
                }
            )
        }
    }

    /**
     * Checks if a URL should be loaded internally within the WebView.
     * Prevents kicking the user out to Chrome on internal app navigation and Supabase/Google Auth redirects.
     */
    private fun isInternalOrAuthUrl(host: String, scheme: String, url: String): Boolean {
        if (scheme == "file" || scheme == "data" || scheme == "blob" || scheme == "about") {
            return true
        }
        if (host.isEmpty()) {
            return true
        }
        // Main production domain & Vercel deployment aliases
        if (host == PRIMARY_HOST || host.endsWith(".vercel.app") || host.contains("tilawatak")) {
            return true
        }
        // Supabase Auth and Database services
        if (host.endsWith(".supabase.co") || host == "supabase.co") {
            return true
        }
        // Google OAuth login flows (accounts.google.com)
        if (host.endsWith("accounts.google.com") || host.endsWith("accounts.youtube.com") || (host.endsWith("google.com") && url.contains("/oauth"))) {
            return true
        }
        return false
    }
}

