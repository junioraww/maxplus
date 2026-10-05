package org.meowkie.max

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CallDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    CallNotificationManager.cancelCallNotification(context)

    val action = intent?.action ?: return
    if (action.endsWith(".ACTION_DISMISS_CALL")) {
      val conversationId = intent.getStringExtra("conversationId") ?: ""
      val callerId = intent.getStringExtra("callerId") ?: ""
      val vcp = intent.getStringExtra("vcp") ?: ""
      MainActivity.instance?.let { activity ->
        activity.runOnUiThread {
          activity.forwardCallDismiss(conversationId, callerId, vcp)
        }
      }
    }
  }
}
