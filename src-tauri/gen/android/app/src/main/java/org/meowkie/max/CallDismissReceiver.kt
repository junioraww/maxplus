package org.meowkie.max

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CallDismissReceiver : BroadcastReceiver() {
  companion object {
    init {
      try {
        System.loadLibrary("maxplus_lib")
      } catch (_: Throwable) {}
    }

    @JvmStatic
    private external fun rejectCallNative(vcp: String, conversationId: String)
  }

  override fun onReceive(context: Context, intent: Intent?) {
    CallNotificationManager.cancelCallNotification(context)

    val action = intent?.action ?: return
    if (action.endsWith(".ACTION_HANGUP_CALL")) {
      CallNotificationManager.cancelOngoingCallNotification(context)
      MainActivity.instance?.let { activity ->
        activity.runOnUiThread {
          activity.forwardCallHangup()
        }
      }
      return
    }
    if (action.endsWith(".ACTION_DISMISS_CALL")) {
      val rawCallData = intent.getStringExtra("call_data")
      var conversationId = intent.getStringExtra("conversationId") ?: ""
      var callerId = intent.getStringExtra("callerId") ?: ""
      var vcp = intent.getStringExtra("vcp") ?: ""

      if (!rawCallData.isNullOrBlank()) {
        try {
          val json = org.json.JSONObject(rawCallData)
          if (conversationId.isEmpty()) conversationId = json.optString("conversationId", "")
          if (callerId.isEmpty()) callerId = json.optString("callerId", "")
          if (vcp.isEmpty()) vcp = json.optString("vcp", "")
        } catch (_: Throwable) {}
      }

      if (vcp.isNotEmpty() || conversationId.isNotEmpty()) {
        Thread {
          try {
            rejectCallNative(vcp, conversationId)
          } catch (_: Throwable) {}
        }.start()
      }

      val activity = MainActivity.instance
      if (activity != null) {
        activity.runOnUiThread {
          activity.forwardCallDismiss(conversationId, callerId, vcp)
        }
      }
    }
  }
}
