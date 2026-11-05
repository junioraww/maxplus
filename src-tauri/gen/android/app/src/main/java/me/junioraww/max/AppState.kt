package me.junioraww.max

object AppState {
  @Volatile var isAppAlive: Boolean = false
  @Volatile private var inForeground: Boolean = false

  val isAppInForeground: Boolean
    get() = inForeground

  private external fun notifyAppStateNative(inForeground: Boolean)

  fun setAppInForeground(inForeground: Boolean) {
    this.inForeground = inForeground
    try {
      notifyAppStateNative(inForeground)
    } catch (_: Throwable) {}
  }
}
