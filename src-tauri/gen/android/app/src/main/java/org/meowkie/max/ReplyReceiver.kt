package org.meowkie.max

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ReplyReceiver : BroadcastReceiver() {
  init {
    System.loadLibrary("maxplus_lib")
  }
  
  private external fun sendReplyNative(
    account: Int, 
    chatId: Long, 
    mid: Long, 
    text: String, 
    appDir: String
  ): Boolean
    
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != "org.meowkie.max.ACTION_REPLY") return
        
        val results = RemoteInput.getResultsFromIntent(intent) ?: return
        val replyText = results.getCharSequence("key_text_reply")?.toString() ?: return
        
        val account = intent.getIntExtra("account", 0)
        val chatId = intent.getLongExtra("chatId", 0L)
        val mid = intent.getLongExtra("mid", 0L)
        val notificationId = intent.getIntExtra("notificationId", 0)
        
        val pendingResult = goAsync()
        
        CoroutineScope(Dispatchers.IO).launch {
          try {
            val appDir = context.filesDir.absolutePath 
            val success = sendReplyNative(account, chatId, mid, replyText, appDir)
            
            withContext(Dispatchers.Main) {
              val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
              
              if (success) {
                notificationManager.cancel(notificationId)
              } else {
                val errorBuilder = NotificationCompat.Builder(context, "MESSAGES_CHANNEL_ID")
                  .setSmallIcon(android.R.drawable.ic_dialog_alert)
                  .setContentTitle("Ошибка отправки")
                  .setContentText("Не удалось отправить сообщение")
                notificationManager.notify(notificationId, errorBuilder.build())
              }
            }
          } catch (e: Exception) {
            e.printStackTrace()
          } finally {
            pendingResult.finish()
          }
        }
    }
}