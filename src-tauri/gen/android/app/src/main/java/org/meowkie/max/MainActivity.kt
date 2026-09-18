package org.meowkie.max

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log

class MainActivity : TauriActivity() {
  companion object {
    @Volatile var instance: MainActivity? = null
    @Volatile var appContext: Context? = null
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
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleChatIntent(intent)
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
