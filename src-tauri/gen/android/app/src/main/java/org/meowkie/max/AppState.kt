package org.meowkie.max

object AppState {
  @Volatile var isAppAlive: Boolean = false
  @Volatile var isAppInForeground: Boolean = false
}