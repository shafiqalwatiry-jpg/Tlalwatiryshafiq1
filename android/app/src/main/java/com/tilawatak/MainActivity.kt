package com.tilawatak

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
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
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.tilawatak.notification.NotificationHelper
import com.tilawatak.notification.WebAppInterface
import java.util.concurrent.Executor

class MainActivity : FragmentActivity() {

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

        NotificationHelper.createNotificationChannel(this)

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
            val webAppUrl = "https://ais-pre-v4bcft7gk6bne67gjjl3vn-468976760695.europe-west2.run.app"

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
                            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                            cacheMode = WebSettings.LOAD_DEFAULT
                            setSupportZoom(true)
                            builtInZoomControls = false
                            displayZoomControls = false
                        }

                        CookieManager.getInstance().setAcceptCookie(true)
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                        val biometricExecutor: Executor = ContextCompat.getMainExecutor(context)
                        val biometricPrompt = BiometricPrompt(this@MainActivity, biometricExecutor,
                            object : BiometricPrompt.AuthenticationCallback() {
                                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                                    super.onAuthenticationSucceeded(result)
                                    // Notify Web via JavaScript bridge callback that biometric unlock succeeded
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

                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                val url = request?.url?.toString() ?: return false
                                val uri = Uri.parse(url)
                                val host = uri.host ?: ""
                                // Allow same-domain navigation internally to preserve SPA state and prevent blank screen
                                if (host.contains("europe-west2.run.app") || host.contains("tilawatak") || uri.scheme == "file") {
                                    return false
                                }
                                // External links open in browser
                                try {
                                    val intent = Intent(Intent.ACTION_VIEW, uri)
                                    view?.context?.startActivity(intent)
                                    return true
                                } catch (e: Exception) {
                                    return false
                                }
                            }
                        }

                        webChromeClient = object : WebChromeClient() {
                            override fun onShowFileChooser(
                                webView: WebView?,
                                filePathCallback: ValueCallback<Array<Uri>>?,
                                fileChooserParams: FileChooserParams?
                            ): Boolean {
                                this@MainActivity.filePathCallback?.onReceiveValue(null)
                                this@MainActivity.filePathCallback = filePathCallback

                                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                                    type = "*/*"
                                }
                                try {
                                    fileChooserLauncher.launch(intent)
                                } catch (e: Exception) {
                                    this@MainActivity.filePathCallback = null
                                    return false
                                }
                                return true
                            }
                        }

                        loadUrl(webAppUrl)
                    }
                }
            )
        }
    }
}
