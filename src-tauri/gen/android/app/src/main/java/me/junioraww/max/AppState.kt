package me.junioraww.max

object AppState {
  @Volatile var isAppAlive: Boolean = false
  @Volatile private var appLocked: Boolean = false
  @Volatile private var inForeground: Boolean = false

  val isAppLocked: Boolean
    get() = appLocked

  val isAppInForeground: Boolean
    get() = inForeground

  @JvmStatic
  fun setAppLocked(locked: Boolean) {
    this.appLocked = locked
  }

  private external fun notifyAppStateNative(inForeground: Boolean)

  fun setAppInForeground(inForeground: Boolean) {
    this.inForeground = inForeground
    try {
      notifyAppStateNative(inForeground)
    } catch (_: Throwable) {}
  }
}
