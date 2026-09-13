package org.meowkie.max

import android.os.Bundle

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    AppState.isAppAlive = true
  }
  
  override fun onDestroy() {
    super.onDestroy()
    AppState.isAppAlive = false
  }
}
