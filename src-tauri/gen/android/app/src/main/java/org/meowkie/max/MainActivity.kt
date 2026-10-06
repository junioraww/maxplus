package org.meowkie.max

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : TauriActivity() {
  companion object {
    @Volatile var instance: MainActivity? = null
    @Volatile var appContext: Context? = null

    @JvmStatic
    fun startScreenCaptureStatic() {
      val inst = instance
      if (inst != null) {
        inst.requestScreenCapture()
      } else {
        notifyScreenCaptureResultStatic(false, 0, 0, 0)
      }
    }

    @JvmStatic
    fun stopScreenCaptureStatic() {
      instance?.stopScreenCapture()
    }

    @JvmStatic
    fun notifyScreenCaptureResultStatic(success: Boolean, port: Int, width: Int, height: Int) {
      instance?.notifyScreenCaptureResultNative(success, port, width, height)
    }
  }

  init {
    try {
      System.loadLibrary("maxplus_lib")
    } catch (e: Throwable) {
      Log.e("MaxPlus", "Failed to load maxplus_lib", e)
    }
  }

  private external fun initJni()
  private external fun notifyChatClickedNative(chatId: Long)
  private external fun notifyCallActionNative(action: String, payload: String)
  external fun notifyScreenCaptureResultNative(success: Boolean, port: Int, width: Int, height: Int)
  external fun notifyScreenCaptureStoppedNative()

  private val screenCaptureLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) { result ->
    if (result.resultCode == Activity.RESULT_OK && result.data != null) {
      ScreenCaptureService.start(this, result.resultCode, result.data!!)
    } else {
      notifyScreenCaptureResultNative(false, 0, 0, 0)
    }
  }

  fun requestScreenCapture() {
    runOnUiThread {
      val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
      if (mgr != null) {
        val intent = mgr.createScreenCaptureIntent()
        screenCaptureLauncher.launch(intent)
      } else {
        notifyScreenCaptureResultNative(false, 0, 0, 0)
      }
    }
  }

  fun stopScreenCapture() {
    runOnUiThread {
      ScreenCaptureService.stop(this)
    }
  }

  fun forwardCallDismiss(conversationId: String, callerId: String, vcp: String) {
    try {
      val json = org.json.JSONObject().apply {
        put("conversationId", conversationId)
        put("callerId", callerId)
        put("vcp", vcp)
      }
      notifyCallActionNative("dismiss", json.toString())
    } catch (e: Throwable) {
      Log.e("MaxPlus", "forwardCallDismiss error", e)
    }
  }

  private fun handleCallIntent(intent: Intent?) {
    if (intent == null) return
    val callAction = intent.getStringExtra("call_action")
    if (callAction != null) {
      CallNotificationManager.stopAlerts()
      CallNotificationManager.cancelCallNotification(this)
      val conversationId = intent.getStringExtra("conversationId") ?: ""
      val callerId = intent.getStringExtra("callerId") ?: ""
      val isVideo = intent.getBooleanExtra("isVideo", false)
      val vcp = intent.getStringExtra("vcp") ?: ""
      intent.removeExtra("call_action")
      try {
        val json = org.json.JSONObject().apply {
          put("conversationId", conversationId)
          put("callerId", callerId)
          put("isVideo", isVideo)
          put("vcp", vcp)
        }
        notifyCallActionNative(callAction, json.toString())
      } catch (e: Throwable) {
        Log.e("MaxPlus", "handleCallIntent error", e)
      }
    }
  }

  private fun handleChatIntent(intent: Intent?) {
    if (intent != null && intent.hasExtra("chatId")) {
      val chatId = intent.getLongExtra("chatId", 0L)
      intent.removeExtra("chatId")
      if (chatId != 0L) {
        try {
          notifyChatClickedNative(chatId)
        } catch (e: Throwable) {
          Log.e("MaxPlus", "notifyChatClickedNative error", e)
        }
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    instance = this
    appContext = applicationContext
    AppState.isAppAlive = true
    Log.d("MaxPlus", "MainActivity.onCreate")
    try {
      initJni()
    } catch (e: Throwable) {
      Log.e("MaxPlus", "Failed to call initJni", e)
    }
    handleChatIntent(intent)
    handleCallIntent(intent)
  }

  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    webView.settings.mediaPlaybackRequiresUserGesture = false
    webView.webChromeClient = object : android.webkit.WebChromeClient() {
      override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
        runOnUiThread {
          request.grant(request.resources)
        }
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleChatIntent(intent)
    handleCallIntent(intent)
  }

  override fun onResume() {
    super.onResume()
    AppState.isAppInForeground = true
  }

  override fun onPause() {
    super.onPause()
    AppState.isAppInForeground = false
  }
  
  override fun onDestroy() {
    super.onDestroy()
    if (instance == this) {
      instance = null
    }
    AppState.isAppAlive = false
    AppState.isAppInForeground = false
  }
}
