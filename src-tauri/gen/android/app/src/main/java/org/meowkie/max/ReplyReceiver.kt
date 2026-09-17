package org.meowkie.max

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ReplyReceiver : BroadcastReceiver() {
  init {
    try {
      System.loadLibrary("maxplus_lib")
    } catch (e: Throwable) {
      Log.e("MaxPlus", "ReplyReceiver: Failed to load maxplus_lib", e)
    }
  }
  
  private external fun sendReplyNative(
    account: Long, 
    chatId: Long, 
    mid: Long, 
    text: String, 
    appDir: String
  ): Boolean
    
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != "${context.packageName}.ACTION_REPLY") return
      
    val results = RemoteInput.getResultsFromIntent(intent) ?: return
    val replyText = results.getCharSequence("key_text_reply")?.toString() ?: return
    
    val account = intent.getLongExtra("account", 0L)
    val chatId = intent.getLongExtra("chatId", 0L)
    val mid = intent.getLongExtra("mid", 0L)
    val notificationId = intent.getIntExtra("notificationId", 0)
    
    Log.d("MaxPlus", "ReplyReceiver: processing reply for chatId=$chatId, account=$account, mid=$mid")
    
    val pendingResult = goAsync()
    
    CoroutineScope(Dispatchers.IO).launch {
      try {
        val appDir = context.applicationInfo.dataDir
        val success = sendReplyNative(account, chatId, mid, replyText, appDir)
        Log.d("MaxPlus", "ReplyReceiver: sendReplyNative returned $success")
        
        withContext(Dispatchers.Main) {
          val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          
          if (success) {
            notificationManager.cancel(notificationId)
          } else {
            val errorBuilder = NotificationCompat.Builder(context, NotificationHelper.CHANNEL_ID)
              .setSmallIcon(android.R.drawable.ic_dialog_alert)
              .setContentTitle("Ошибка отправки")
              .setContentText("Не удалось отправить сообщение")
            notificationManager.notify(notificationId, errorBuilder.build())
          }
        }
      } catch (e: Exception) {
        Log.e("MaxPlus", "ReplyReceiver error during sendReply", e)
      } finally {
        pendingResult.finish()
      }
    }
  }
}