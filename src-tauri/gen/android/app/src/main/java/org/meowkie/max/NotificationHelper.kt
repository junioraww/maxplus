package org.meowkie.max

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput

fun showNotificationWithReply(context: Context, payloadJson: String, chatId: Int, account: Int, mid: Int?) {
  val notificationId = chatId
  
  val replyIntent = Intent(context, ReplyReceiver::class.java).apply {
    action = "org.meowkie.max.ACTION_REPLY"
    putExtra("account", account)
    putExtra("chatId", chatId.toLong())
    putExtra("mid", mid?.toLong() ?: 0L)
    putExtra("notificationId", notificationId)
  }
  
  val pendingIntent = PendingIntent.getBroadcast(
    context,
    chatId,
    replyIntent,
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
  )
  
  val remoteInput = RemoteInput.Builder("key_text_reply")
    .setLabel("Введите ответ...")
    .build()
  
  val replyAction = NotificationCompat.Action.Builder(
    android.R.drawable.ic_menu_send,
    "Ответить",
    pendingIntent
  ).addRemoteInput(remoteInput).build()
  
  val builder = NotificationCompat.Builder(context, "MESSAGES_CHANNEL_ID")
    .setSmallIcon(android.R.drawable.ic_dialog_email)
    .setContentTitle("Новое сообщение")
    .setContentText("Текст входящего сообщения...")
    .addAction(replyAction)
    .setAutoCancel(true)
  
  NotificationManagerCompat.from(context).notify(notificationId, builder.build())
}