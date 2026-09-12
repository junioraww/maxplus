package org.meowkie.max

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class MessagingService : FirebaseMessagingService() {
  
  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)
    
    val data = message.data
    if (data.isEmpty()) return
      
      try {
        if (data.containsKey("chat_id") && data.containsKey("account_id")) {
          val account = data["account_id"]?.toInt() ?: return
          val chatId = data["chat_id"]?.toInt() ?: return
          val mid = data["mid"]?.toInt()
          
          val text = data["text"] ?: "Новое сообщение" 
          
          val payloadJson = JSONObject(data as Map<*, *>).toString()
          
          showNotificationWithReply(this, payloadJson, chatId, account, mid)
        }
      } catch (e: Exception) {
        e.printStackTrace()
      }
  }
  
  override fun onNewToken(token: String) {
    super.onNewToken(token)
  }
}