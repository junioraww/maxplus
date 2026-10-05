package org.meowkie.max

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
        CallNotificationManager.showIncomingCallNotification(this, data)
      }
      return
    }
    if (type == "CallFinished") {
      CallNotificationManager.cancelCallNotification(this)
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
    app.tauri.notification.NotificationPlugin.instance?.handleNewToken(token)
  }
}