package me.junioraww.max

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val data = message.data
        if (data.isEmpty()) return

        val type = data["type"]
        if (type == "InboundCall" || data.containsKey("vcp")) {
            if (!AppState.isAppInForeground) {
                NotificationDispatcher.dispatchIncomingCall(this, data)
            }
            return
        }
        if (type == "CallFinished") {
            NotificationDispatcher.dispatchCallFinished(this, data)
            return
        }

        if (AppState.isAppInForeground || MaxBackgroundService.isServiceRunning) {
            return
        }

        val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
        val mid = data["msgid"] ?: data["mid"] ?: ""

        when {
            type == "edit" || data.containsKey("edit") -> {
                val text = data["msg"] ?: data["body"] ?: data["text"] ?: ""
                NotificationDispatcher.dispatchMessageEdited(this, chatId, mid, text)
            }
            type == "delete" || data.containsKey("delete") -> {
                NotificationDispatcher.dispatchMessageRemoved(this, chatId, mid)
            }
            else -> {
                val notifier = NotificationHelper(this)
                val ledgerKey = "msg_${chatId}_$mid"
                if (mid.isNotEmpty() && NotificationDispatcher.isDuplicate(ledgerKey)) {
                    return
                }
                notifier.handleIncomingMessage(data)
            }
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
