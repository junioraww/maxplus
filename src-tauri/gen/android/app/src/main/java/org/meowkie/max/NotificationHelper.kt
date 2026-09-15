package org.meowkie.max

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject

class NotificationHelper(private val ctx: Context) {
  init {
    try {
      System.loadLibrary("maxplus_lib")
    } catch (e: Throwable) {
      e.printStackTrace()
    }
  }

  private external fun isChatMutedNative(account: Int, chatId: Long, appDir: String): Boolean
  
  companion object {
    const val CHANNEL_ID = "MESSAGES_CHANNEL_ID"
    private const val CHANNEL_NAME = "Сообщения"
    private const val PREFS = "max_push_history"
    private const val HISTORY_LIMIT = 10
  }
  
  private data class Hist(
    val text: String,
    val senderId: String,
    val senderName: String,
    val ts: Long,
    val mid: String,
    val deleted: Boolean
  )
  
  private fun manager() = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  
  fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val mgr = manager()
      if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
          description = "Уведомления чатов"
          enableVibration(true)
        }
        mgr.createNotificationChannel(channel)
      }
    }
  }
  
  fun handleIncomingMessage(data: Map<String, String>) {
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
    val account = (data["c"] ?: data["account_id"])?.toIntOrNull() ?: 0

    try {
      if (isChatMutedNative(account, chatId, ctx.filesDir.absolutePath)) {
        return
      }
    } catch (e: Throwable) {
    }

    val mid = data["msgid"] ?: data["mid"] ?: ""
    val text = data["msg"] ?: data["body"] ?: data["text"] ?: "Сообщение"
    val senderId = data["suid"] ?: ""
    val senderName = data["userName"] ?: data["title"] ?: "Собеседник"
    val chatTitle = data["title"] ?: senderName
    val ts = data["ctime"]?.toLongOrNull() ?: System.currentTimeMillis()
    
    ensureChannel()
    
    val history = appendHistory(chatId, Hist(text, senderId, senderName, ts, mid, false))
    saveMeta(chatId, chatTitle, account)
    render(chatId, chatTitle, account, history, alertOnce = false)
  }
  
  fun handleEditMessage(data: Map<String, String>) {
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
    val mid = data["msgid"] ?: data["mid"] ?: return
    val newText = data["msg"] ?: data["body"] ?: data["text"] ?: return
    
    val history = loadHistory(chatId).toMutableList()
    val index = history.indexOfLast { it.mid == mid }
    if (index < 0) return
      
      val old = history[index]
      if (old.deleted || old.text == newText) return
        
        history[index] = old.copy(text = newText)
        saveHistory(chatId, history)
        
        val (title, account) = loadMeta(chatId)
        render(chatId, title, account, history, alertOnce = true)
  }
  
  fun handleRemoveMessage(data: Map<String, String>) {
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
    val mid = data["msgid"] ?: data["mid"] ?: return
    
    val history = loadHistory(chatId).toMutableList()
    val index = history.indexOfLast { it.mid == mid }
    if (index < 0) return
      
      // Помечаем удаленным со зачеркиванием текста
      history[index] = history[index].copy(deleted = true)
      saveHistory(chatId, history)
      
      val (title, account) = loadMeta(chatId)
      render(chatId, title, account, history, alertOnce = true)
  }
  
  private fun render(chatId: Long, title: String, account: Int, history: List<Hist>, alertOnce: Boolean) {
    if (history.isEmpty()) return
      val notifId = (chatId and 0x7fffffff).toInt()
      val newest = history.last()
      
      val userPerson = Person.Builder().setName("Вы").build()
      
      val isGroup = title != newest.senderName
      val style = NotificationCompat.MessagingStyle(userPerson)
        .setConversationTitle(title)
        .setGroupConversation(isGroup)
      
      for (h in history) {
        val senderIdLong = h.senderId.toLongOrNull() ?: chatId
        val avatarBitmap = AvatarHelper.getAvatar(ctx, senderIdLong, h.senderName, null, account)
        val person = Person.Builder()
          .setName(h.senderName)
          .setKey(h.senderId)
          .setIcon(IconCompat.createWithBitmap(avatarBitmap))
          .build()
        
        val textFormatted = if (h.deleted) {
          SpannableStringBuilder("Удалено: ${h.text}").apply {
            setSpan(StrikethroughSpan(), 9, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            setSpan(StyleSpan(Typeface.ITALIC), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          }
        } else {
          h.text
        }
        
        style.addMessage(textFormatted, h.ts, person)
      }
      
      val chatAvatar = AvatarHelper.getAvatar(ctx, chatId, title, null, account)
      
      val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_email)
        .setContentTitle(title)
        .setContentText(newest.text)
        .setLargeIcon(chatAvatar)
        .setStyle(style)
        .setAutoCancel(true)
        .setOnlyAlertOnce(alertOnce)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
      
      if (account != 0) {
        val replyIntent = Intent(ctx, ReplyReceiver::class.java).apply {
          action = "org.meowkie.max.ACTION_REPLY"
          putExtra("account", account)
          putExtra("chatId", chatId)
          putExtra("mid", newest.mid.toLongOrNull() ?: 0L)
          putExtra("notificationId", notifId)
        }
        
        val pendingIntent = PendingIntent.getBroadcast(
          ctx,
          notifId,
          replyIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        
        val remoteInput = RemoteInput.Builder("key_text_reply")
          .setLabel("Ответить...")
          .build()
        
        val action = NotificationCompat.Action.Builder(
          android.R.drawable.ic_menu_send,
          "Ответить",
          pendingIntent
        ).addRemoteInput(remoteInput)
          .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
          .build()
        
        builder.addAction(action)
      }
      
      manager().notify(notifId, builder.build())
  }
  
  private fun prefs() = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  
  private fun loadHistory(chatId: Long): List<Hist> {
    val raw = prefs().getString("hist_$chatId", "[]") ?: "[]"
    val arr = JSONArray(raw)
    val list = mutableListOf<Hist>()
    for (i in 0 until arr.length()) {
      val obj = arr.getJSONObject(i)
      list.add(Hist(
        obj.getString("t"),
        obj.getString("k"),
        obj.getString("n"),
        obj.getLong("ts"),
        obj.getString("m"),
        obj.getBoolean("d")
      ))
    }
    return list
  }
  
  private fun saveHistory(chatId: Long, items: List<Hist>) {
    val arr = JSONArray()
    for (h in items) {
      arr.put(JSONObject().apply {
        put("t", h.text)
        put("k", h.senderId)
        put("n", h.senderName)
        put("ts", h.ts)
        put("m", h.mid)
        put("d", h.deleted)
      })
    }
    prefs().edit().putString("hist_$chatId", arr.toString()).apply()
  }
  
  private fun appendHistory(chatId: Long, item: Hist): List<Hist> {
    val items = loadHistory(chatId).toMutableList()
    items.add(item)
    while (items.size > HISTORY_LIMIT) items.removeAt(0)
      saveHistory(chatId, items)
      return items
  }
  
  private fun saveMeta(chatId: Long, title: String, account: Int) {
    prefs().edit().putString("meta_$chatId", JSONObject().apply {
      put("title", title)
      put("account", account)
    }.toString()).apply()
  }
  
  private fun loadMeta(chatId: Long): Pair<String, Int> {
    val raw = prefs().getString("meta_$chatId", null) ?: return Pair("Чат", 0)
    val obj = JSONObject(raw)
    return Pair(obj.optString("title", "Чат"), obj.optInt("account", 0))
  }
}