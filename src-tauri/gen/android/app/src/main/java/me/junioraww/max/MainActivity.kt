package me.junioraww.max

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import java.net.NetworkInterface
import java.util.Collections

class MainActivity : TauriActivity() {
  companion object {
    @Volatile var instance: MainActivity? = null
    @Volatile var appContext: Context? = null
    @Volatile var currentCamouflageActive: Boolean = false
    @Volatile var currentCamouflageAliasIndex: Int = 1
    @Volatile var pendingDisableComponent: android.content.ComponentName? = null

    @JvmStatic
    fun applyPendingComponentDisable(ctx: Context) {
      val comp = pendingDisableComponent ?: return
      pendingDisableComponent = null
      try {
        val pm = ctx.packageManager
        if (pm.getComponentEnabledSetting(comp) != android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED) {
          pm.setComponentEnabledSetting(
            comp,
            android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            android.content.pm.PackageManager.DONT_KILL_APP
          )
        }
      } catch (e: Throwable) {
        Log.e("MaxPlus", "applyPendingComponentDisable error", e)
      }
    }

    @JvmStatic
    fun isStandaloneBuild(): Boolean {
      return BuildConfig.USE_PUSHLESS_DAEMON
    }

    @JvmStatic
    fun checkVpnTunnelState(): Boolean {
      val ctx = getApplicationContextStatic() ?: return false
      return try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val hasVpnNet = cm?.allNetworks?.any { net ->
          val caps = cm.getNetworkCapabilities(net) ?: return@any false
          caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ||
            !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
        } ?: false

        if (hasVpnNet) return true

        val ifaces = Collections.list(NetworkInterface.getNetworkInterfaces())
        ifaces.any { iface ->
          if (!iface.isUp || iface.isLoopback) return@any false
          val name = iface.name.lowercase()
          name.startsWith("tun") || name.startsWith("ppp") || name.startsWith("wg") || name.startsWith("ipsec")
        }
      } catch (_: Throwable) {
        false
      }
    }

    @JvmStatic
    fun routeProcessDirectPhysicalNetwork(): Boolean {
      val ctx = getApplicationContextStatic() ?: return false
      return try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val physicalNetworks = cm.allNetworks.filter { net ->
          val caps = cm.getNetworkCapabilities(net) ?: return@filter false
          !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        }

        val prioritized = physicalNetworks.sortedWith(
          compareByDescending<Network> { net ->
            val caps = cm.getNetworkCapabilities(net) ?: return@compareByDescending 0
            var rank = 0
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) rank += 10
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) rank += 5
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) rank += 3
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) rank += 2
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) rank += 1
            rank
          }
        )

        val targetNetwork = prioritized.firstOrNull() ?: return false
        cm.bindProcessToNetwork(targetNetwork)
      } catch (_: Throwable) {
        false
      }
    }

    @JvmStatic
    fun detachProcessNetworkRoute(): Boolean {
      val ctx = getApplicationContextStatic() ?: return false
      return try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        cm.bindProcessToNetwork(null)
      } catch (_: Throwable) {
        false
      }
    }

    @JvmStatic
    fun getPushTokenStatic(): String? {
      return PushTokenProvider.getPushToken(getApplicationContextStatic())
    }

    @JvmStatic
    fun getApplicationContextStatic(): Context? {
      return appContext ?: instance?.applicationContext
    }

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

    @JvmStatic
    fun getInsetsStatic(): IntArray {
      val inst = instance
      return if (inst != null) {
        intArrayOf(inst.cachedTopDp, inst.cachedBottomDp, inst.cachedLeftDp, inst.cachedRightDp)
      } else {
        intArrayOf(0, 0, 0, 0)
      }
    }

    @JvmStatic
    fun setScreenBrightnessStatic(brightness: Float) {
      val inst = instance ?: return
      inst.runOnUiThread {
        try {
          val w = inst.window ?: return@runOnUiThread
          val attrs = w.attributes ?: return@runOnUiThread
          attrs.screenBrightness = brightness
          w.attributes = attrs
        } catch (_: Throwable) {}
      }
    }

    @JvmStatic
    fun updateTaskDescription(act: Activity, active: Boolean, aliasIndex: Int) {
      try {
        val pm = act.packageManager
        val pkg = act.packageName
        val targetComponent = if (active) {
          val safeIndex = if (aliasIndex in 1..40) aliasIndex else 1
          val targetAliasName = if (safeIndex == 1) "$pkg.MainActivityCalculator" else "$pkg.MainActivityDecoy$safeIndex"
          android.content.ComponentName(pkg, targetAliasName)
        } else {
          android.content.ComponentName(pkg, "$pkg.MainActivity")
        }
        val info = pm.getActivityInfo(targetComponent, 0)
        val label = info.loadLabel(pm).toString()
        val iconRes = info.icon
        val taskDesc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          android.app.ActivityManager.TaskDescription.Builder()
            .setLabel(label)
            .setIcon(iconRes)
            .build()
        } else {
          @Suppress("DEPRECATION")
          android.app.ActivityManager.TaskDescription(label, iconRes)
        }
        act.setTaskDescription(taskDesc)
      } catch (_: Throwable) {}
    }

    @JvmStatic
    fun setCamouflageState(active: Boolean, aliasIndex: Int) {
      val ctx = getApplicationContextStatic() ?: return
      try {
        val pm = ctx.packageManager
        val pkg = ctx.packageName
        val defaultComponent = android.content.ComponentName(pkg, "$pkg.MainActivity")
        val allDecoys = (1..40).map { if (it == 1) "$pkg.MainActivityCalculator" else "$pkg.MainActivityDecoy$it" }
        val runningComp = instance?.componentName

        val targetComponent = if (active) {
          val safeIndex = if (aliasIndex in 1..40) aliasIndex else 1
          val targetAliasName = if (safeIndex == 1) "$pkg.MainActivityCalculator" else "$pkg.MainActivityDecoy$safeIndex"
          android.content.ComponentName(pkg, targetAliasName)
        } else {
          defaultComponent
        }

        if (pendingDisableComponent == targetComponent) {
          pendingDisableComponent = null
        }

        if (pm.getComponentEnabledSetting(targetComponent) != android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
          pm.setComponentEnabledSetting(
            targetComponent,
            android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            android.content.pm.PackageManager.DONT_KILL_APP
          )
        }

        val componentsToDisable = if (active) {
          allDecoys.filter { it != targetComponent.className }.map { android.content.ComponentName(pkg, it) } + listOf(defaultComponent)
        } else {
          allDecoys.map { android.content.ComponentName(pkg, it) }
        }

        for (comp in componentsToDisable) {
          if (runningComp != null && comp == runningComp && AppState.isAppInForeground) {
            pendingDisableComponent = comp
          } else {
            if (pm.getComponentEnabledSetting(comp) != android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED) {
              pm.setComponentEnabledSetting(
                comp,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                android.content.pm.PackageManager.DONT_KILL_APP
              )
            }
          }
        }

        currentCamouflageActive = active
        currentCamouflageAliasIndex = aliasIndex
        instance?.let { act ->
          act.runOnUiThread {
            updateTaskDescription(act, active, aliasIndex)
          }
        }
      } catch (e: Throwable) {
        Log.e("MaxPlus", "setCamouflageState error", e)
      }
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
  private external fun notifyChatClickedNative(chatId: Long, account: Long)
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

  fun forwardCallHangup() {
    try {
      notifyCallActionNative("hangup", "{}")
    } catch (e: Throwable) {
      Log.e("MaxPlus", "forwardCallHangup error", e)
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
      resetScreenLockFlags()
    } catch (e: Throwable) {
      Log.e("MaxPlus", "forwardCallDismiss error", e)
    }
  }

  fun resetScreenLockFlags() {
    runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        setShowWhenLocked(false)
        setTurnScreenOn(false)
      } else {
        @Suppress("DEPRECATION")
        window.clearFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
      }
    }
  }

  private fun handleCallIntent(intent: Intent?) {
    if (intent == null) return
    val expectedPrefix = "${packageName}.ACTION_"
    val action = intent.action
    if (action == null || !action.startsWith(expectedPrefix)) return
    val callAction = intent.getStringExtra("call_action")
    if (callAction != null) {
      if (callAction == "show_incoming" || callAction == "answer") {
        runOnUiThread {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
          } else {
            @Suppress("DEPRECATION")
            window.addFlags(
              WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
              WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
          }
        }
      }
      CallNotificationManager.stopAlerts()
      CallNotificationManager.cancelCallNotification(this)
      val rawCallData = intent.getStringExtra("call_data")
      val json = if (!rawCallData.isNullOrBlank()) {
        try {
          org.json.JSONObject(rawCallData)
        } catch (_: Throwable) {
          org.json.JSONObject()
        }
      } else {
        org.json.JSONObject()
      }
      val cid = intent.getStringExtra("conversationId")
      if (!cid.isNullOrBlank() && (!json.has("conversationId") || json.optString("conversationId").isEmpty())) {
        json.put("conversationId", cid)
      }
      val uid = intent.getStringExtra("callerId")
      if (!uid.isNullOrBlank() && (!json.has("callerId") || json.optString("callerId").isEmpty())) {
        json.put("callerId", uid)
      }
      val vcp = intent.getStringExtra("vcp")
      if (!vcp.isNullOrBlank() && (!json.has("vcp") || json.optString("vcp").isEmpty())) {
        json.put("vcp", vcp)
      }
      if (!json.has("isVideo")) {
        json.put("isVideo", intent.getBooleanExtra("isVideo", false))
      }
      intent.removeExtra("call_action")
      intent.removeExtra("call_data")
      try {
        notifyCallActionNative(callAction, json.toString())
      } catch (e: Throwable) {
        Log.e("MaxPlus", "handleCallIntent error", e)
      }
    }
  }

  private fun handleChatIntent(intent: Intent?) {
    if (intent != null && intent.hasExtra("chatId")) {
      val chatId = intent.getLongExtra("chatId", 0L)
      val account = intent.getLongExtra("account", 0L)
      intent.removeExtra("chatId")
      intent.removeExtra("account")
      if (chatId != 0L) {
        try {
          notifyChatClickedNative(chatId, account)
        } catch (e: Throwable) {
          Log.e("MaxPlus", "notifyChatClickedNative error", e)
        }
      }
    }
  }

  private val keyboardPrefs by lazy {
    getSharedPreferences("keyboard_prefs", Context.MODE_PRIVATE)
  }

  private var currentWebView: android.webkit.WebView? = null
  private var cachedTopDp = 0
  private var cachedBottomDp = 0
  private var cachedLeftDp = 0
  private var cachedRightDp = 0
  private var lastDispatchedKeyboardOpen = false
  private var lastDispatchedKeyboardHeightDp = 0
  private var lastKnownKeyboardHeightDp = 0

  private fun getEstimatedKeyboardHeightDp(): Int {
    try {
      val saved = keyboardPrefs.getInt("last_keyboard_height_dp", 0)
      if (saved in 120..600) return saved
    } catch (_: Throwable) {}

    val displayMetrics = resources.displayMetrics
    val screenHeightDp = if (displayMetrics.density > 0f) {
      (displayMetrics.heightPixels / displayMetrics.density).toInt()
    } else {
      800
    }
    return (screenHeightDp / 3).coerceIn(260, 340)
  }

  private fun saveKeyboardHeightDp(heightDp: Int) {
    if (heightDp in 120..600) {
      try {
        if (heightDp != keyboardPrefs.getInt("last_keyboard_height_dp", 0)) {
          keyboardPrefs.edit().putInt("last_keyboard_height_dp", heightDp).apply()
        }
      } catch (_: Throwable) {}
    }
  }

  private fun dispatchKeyboardState(isOpen: Boolean, heightDp: Int) {
    val effectiveHeight = if (heightDp > 0) {
      heightDp
    } else if (isOpen) {
      if (lastKnownKeyboardHeightDp > 0) lastKnownKeyboardHeightDp else getEstimatedKeyboardHeightDp()
    } else {
      0
    }

    if (effectiveHeight > 0) {
      lastKnownKeyboardHeightDp = effectiveHeight
      saveKeyboardHeightDp(effectiveHeight)
    }

    val targetDispatchedHeight = if (isOpen) lastKnownKeyboardHeightDp else 0
    if (lastDispatchedKeyboardOpen == isOpen && lastDispatchedKeyboardHeightDp == targetDispatchedHeight) {
      return
    }
    lastDispatchedKeyboardOpen = isOpen
    lastDispatchedKeyboardHeightDp = targetDispatchedHeight

    val wv = currentWebView ?: return
    val insetDp = if (isOpen) lastKnownKeyboardHeightDp else 0
    val script = "document.documentElement.style.setProperty('--keyboard-inset', '${insetDp}px');" +
      (if (lastKnownKeyboardHeightDp > 0) "document.documentElement.style.setProperty('--keyboard-height', '${lastKnownKeyboardHeightDp}px');" else "") +
      "window.dispatchEvent(new CustomEvent('native-keyboard', { detail: { isOpen: $isOpen, height: $lastKnownKeyboardHeightDp } }));"
    wv.post {
      try {
        wv.evaluateJavascript(script, null)
      } catch (e: Throwable) {
        Log.e("MaxPlus", "dispatchKeyboardState error", e)
      }
    }
  }

  private fun applyInsetsToWebView() {
    val wv = currentWebView ?: return
    val kbHeight = if (lastKnownKeyboardHeightDp > 0) lastKnownKeyboardHeightDp else getEstimatedKeyboardHeightDp()
    val kbInset = if (lastDispatchedKeyboardOpen) (if (lastKnownKeyboardHeightDp > 0) lastKnownKeyboardHeightDp else kbHeight) else 0
    val script = "document.documentElement.style.setProperty('--safe-top', '${cachedTopDp}px');" +
      "document.documentElement.style.setProperty('--safe-bottom', '${cachedBottomDp}px');" +
      "document.documentElement.style.setProperty('--safe-left', '${cachedLeftDp}px');" +
      "document.documentElement.style.setProperty('--safe-right', '${cachedRightDp}px');" +
      "document.documentElement.style.setProperty('--safe-area-top', '${cachedTopDp}px');" +
      "document.documentElement.style.setProperty('--safe-area-bottom', '${cachedBottomDp}px');" +
      "document.documentElement.style.setProperty('--keyboard-inset', '${kbInset}px');" +
      "document.documentElement.style.setProperty('--keyboard-height', '${kbHeight}px');" +
      "window.dispatchEvent(new CustomEvent('safe-area-changed', { detail: { top: $cachedTopDp, bottom: $cachedBottomDp, left: $cachedLeftDp, right: $cachedRightDp } }));"
    wv.post {
      try {
        wv.evaluateJavascript(script, null)
      } catch (e: Throwable) {
        Log.e("MaxPlus", "applyInsetsToWebView error", e)
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = android.graphics.Color.TRANSPARENT
    window.navigationBarColor = android.graphics.Color.TRANSPARENT
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = false
    controller.isAppearanceLightNavigationBars = false

    super.onCreate(savedInstanceState)
    instance = this
    appContext = applicationContext
    NotificationHelper.customContext = applicationContext
    CallNotificationManager.customContext = applicationContext
    AppState.isAppAlive = true
    if (BuildConfig.USE_PUSHLESS_DAEMON) {
      MaxBackgroundService.start(applicationContext)
      MaxDaemonWatchdogWorker.schedule(applicationContext)
    }
    Log.d("MaxPlus", "MainActivity.onCreate")

    val animCallback = object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_STOP) {
      override fun onStart(
        animation: WindowInsetsAnimationCompat,
        bounds: WindowInsetsAnimationCompat.BoundsCompat
      ): WindowInsetsAnimationCompat.BoundsCompat {
        if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
          val rootInsets = ViewCompat.getRootWindowInsets(window.decorView)
          val isImeVisible = rootInsets?.isVisible(WindowInsetsCompat.Type.ime()) ?: false
          val imeHeightPx = bounds.upperBound.bottom - bounds.lowerBound.bottom
          val density = resources.displayMetrics.density
          val targetHeightDp = if (density > 0f) (imeHeightPx / density).toInt() else 0
          if (isImeVisible) {
            dispatchKeyboardState(true, targetHeightDp)
          } else {
            dispatchKeyboardState(false, 0)
          }
        }
        return super.onStart(animation, bounds)
      }

      override fun onProgress(
        insets: WindowInsetsCompat,
        runningAnimations: MutableList<WindowInsetsAnimationCompat>
      ): WindowInsetsCompat {
        return insets
      }

      override fun onEnd(animation: WindowInsetsAnimationCompat) {
        super.onEnd(animation)
        if ((animation.typeMask and WindowInsetsCompat.Type.ime()) != 0) {
          val rootInsets = ViewCompat.getRootWindowInsets(window.decorView)
          val isImeVisible = rootInsets?.isVisible(WindowInsetsCompat.Type.ime()) ?: false
          val imeHeightPx = rootInsets?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
          val density = resources.displayMetrics.density
          val heightDp = if (density > 0f) (imeHeightPx / density).toInt() else 0
          if (isImeVisible) {
            dispatchKeyboardState(true, heightDp)
          } else {
            dispatchKeyboardState(false, 0)
          }
        }
      }
    }
    ViewCompat.setWindowInsetsAnimationCallback(window.decorView, animCallback)

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, windowInsets ->
      val insets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val density = resources.displayMetrics.density
      if (density > 0f) {
        cachedTopDp = (insets.top / density).toInt()
        cachedBottomDp = (insets.bottom / density).toInt()
        cachedLeftDp = (insets.left / density).toInt()
        cachedRightDp = (insets.right / density).toInt()
        applyInsetsToWebView()

        val imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
        val isImeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime())
        val imeHeightDp = (imeInsets.bottom / density).toInt()
        if (isImeVisible) {
          dispatchKeyboardState(true, imeHeightDp)
        } else {
          dispatchKeyboardState(false, 0)
        }
      }
      windowInsets
    }

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
    currentWebView = webView
    applyInsetsToWebView()
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
    AppState.setAppInForeground(true)
    applyInsetsToWebView()
    updateTaskDescription(this, currentCamouflageActive, currentCamouflageAliasIndex)
  }

  override fun onPause() {
    super.onPause()
    AppState.setAppInForeground(false)
    dispatchKeyboardState(false, 0)
  }

  override fun onStop() {
    super.onStop()
    applyPendingComponentDisable(this)
  }
  
  override fun onDestroy() {
    super.onDestroy()
    applyPendingComponentDisable(this)
    currentWebView = null
    if (instance == this) {
      instance = null
    }
    AppState.isAppAlive = false
    AppState.setAppInForeground(false)
  }
}
