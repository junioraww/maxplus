package me.junioraww.max

object AppState {
  @Volatile var isAppAlive: Boolean = false
  @Volatile var isAppLocked: Boolean = false
  @Volatile private var inForeground: Boolean = false

  val isAppInForeground: Boolean
    get() = inForeground

  @JvmStatic
  fun setAppLocked(locked: Boolean) {
    this.isAppLocked = locked
  }

  private external fun notifyAppStateNative(inForeground: Boolean)

  fun setAppInForeground(inForeground: Boolean) {
    this.inForeground = inForeground
    try {
      notifyAppStateNative(inForeground)
    } catch (_: Throwable) {}
  }
}
