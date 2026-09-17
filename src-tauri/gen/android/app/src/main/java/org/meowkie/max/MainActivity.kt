package org.meowkie.max

import android.content.Context
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
