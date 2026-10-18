package org.meowkie.max

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class MessagingService : FirebaseMessagingService() {
  
  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)
    
    val data = message.data
    if (data.isEmpty()) return

    val type = data["type"]
    if (type == "InboundCall" || data.containsKey("vcp")) {
      if (!AppState.isAppInForeground) {
        try {
          CallNotificationManager.showIncomingCallNotification(this, data)
        } catch (e: Throwable) {
          Log.e("MaxPlus", "Failed to show incoming call notification", e)
        }
      }
      return
    }
    if (type == "CallFinished") {
      CallNotificationManager.cancelCallNotification(this)
      val conversationId = data["conversationId"] ?: data["cid"] ?: data["vcId"] ?: ""
      val callerId = data["callerId"] ?: data["suid"] ?: ""
      val vcp = data["vcp"] ?: ""
      MainActivity.instance?.let { activity ->
        activity.runOnUiThread {
          activity.forwardCallDismiss(conversationId, callerId, vcp)
        }
      }
      return
    }

    if (AppState.isAppInForeground) {
      return
    }
      
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
      
    val notifier = NotificationHelper(this)
    
    when {
      type == "edit" || data.containsKey("edit") -> notifier.handleEditMessage(data)
      type == "delete" || data.containsKey("delete") -> notifier.handleRemoveMessage(data)
      else -> notifier.handleIncomingMessage(data)
    }
  }
  
  override fun onNewToken(token: String) {
    super.onNewToken(token)
    try {
      getSharedPreferences("maxplus_push", Context.MODE_PRIVATE)
        .edit()
        .putString("fcm_token", token)
        .apply()
    } catch (_: Throwable) {}
    app.tauri.notification.NotificationPlugin.instance?.handleNewToken(token)
  }
}