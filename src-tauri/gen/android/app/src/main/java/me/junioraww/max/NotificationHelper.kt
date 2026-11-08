package me.junioraww.max

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.graphics.Typeface
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject

class NotificationHelper(private val ctx: Context) {
  init {
    try {
      System.loadLibrary("maxplus_lib")
    } catch (e: Throwable) {
      Log.e("MaxPlus", "NotificationHelper: Failed to load maxplus_lib", e)
    }
  }

  private external fun isChatMutedNative(account: Long, chatId: Long, appDir: String): Boolean
  private external fun isNotificationsEnabledNative(account: Long, appDir: String): Boolean
  private external fun isChatGroupNative(account: Long, chatId: Long, appDir: String): Boolean
  private external fun isAccountPrivacyActiveNative(account: Long, appDir: String): Boolean
  private external fun resolveAccountForChatNative(chatId: Long, appDir: String): Long

  fun isNotificationsEnabled(account: Long): Boolean {
    return try {
      isNotificationsEnabledNative(account, ctx.applicationInfo.dataDir)
    } catch (_: Throwable) {
      true
    }
  }

  fun isChatMuted(account: Long, chatId: Long): Boolean {
    return try {
      isChatMutedNative(account, chatId, ctx.applicationInfo.dataDir)
    } catch (_: Throwable) {
      false
    }
  }

  fun resolveAccountForChat(chatId: Long): Long {
    return try {
      resolveAccountForChatNative(chatId, ctx.applicationInfo.dataDir)
    } catch (_: Throwable) {
      0L
    }
  }
  
  companion object {
    const val CHANNEL_ID = "MESSAGES_CHANNEL_ID"
    private const val CHANNEL_NAME = "Сообщения"
    private const val PREFS = "maxplus_notifications_store"
    private const val LEGACY_PREFS = "max_push_history"
    private const val HISTORY_LIMIT = 10

    @Volatile
    var customContext: Context? = null

    @JvmStatic
    fun showNotificationDirect(chatId: Long, title: String, text: String, senderId: String, account: Long) {
      showNotificationDirect(chatId, title, text, senderId, account, "", false)
    }

    @JvmStatic
    fun showNotificationDirect(chatId: Long, title: String, text: String, senderId: String, account: Long, senderName: String) {
      showNotificationDirect(chatId, title, text, senderId, account, senderName, false)
    }

    @JvmStatic
    fun showNotificationDirect(chatId: Long, title: String, text: String, senderId: String, account: Long, senderName: String, isGroup: Boolean) {
      val ctx = customContext ?: MainActivity.appContext ?: MainActivity.instance?.applicationContext
      if (ctx == null) {
        Log.e("MaxPlus", "showNotificationDirect: no Context available")
        return
      }
      Log.d("MaxPlus", "showNotificationDirect: chatId=$chatId, title=$title, senderName=$senderName, account=$account, isGroup=$isGroup")
      val data = mutableMapOf(
        "mc" to chatId.toString(),
        "title" to title,
        "msg" to text,
        "suid" to senderId,
        "c" to account.toString(),
        "isGroup" to isGroup.toString()
      )
      if (senderName.isNotEmpty()) {
        data["userName"] = senderName
      }
      Thread {
        try {
          NotificationHelper(ctx).handleIncomingMessage(data)
        } catch (e: Throwable) {
          Log.e("MaxPlus", "showNotificationDirect error in background thread", e)
        }
      }.start()
    }

    @JvmStatic
    fun cancelNotificationDirect(chatId: Long) {
      val ctx = customContext ?: MainActivity.appContext ?: MainActivity.instance?.applicationContext
      if (ctx == null) {
        Log.e("MaxPlus", "cancelNotificationDirect: no Context available")
        return
      }
      Log.d("MaxPlus", "cancelNotificationDirect: chatId=$chatId")
      val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val notifId = (chatId and 0x7fffffff).toInt()
      mgr.cancel(notifId)
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      prefs.edit()
        .remove("dialog_cache_$chatId")
        .remove("dialog_meta_$chatId")
        .apply()

      try {
        ctx.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE).edit()
          .remove("hist_$chatId")
          .remove("meta_$chatId")
          .apply()
      } catch (_: Throwable) {}
    }

    @JvmStatic
    fun resetSecurePrivacyNotification(ctx: Context, account: Long) {
      val prefs = ctx.getSharedPreferences("maxplus_privacy_notifications", Context.MODE_PRIVATE)
      prefs.edit().putInt("hidden_count_$account", 0).apply()
      val notifId = (777000L + (account % 1000L)).toInt()
      val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      mgr.cancel(notifId)
    }
  }
  
  private data class NotificationMessage(
    val text: String,
    val senderId: String,
    val senderName: String,
    val timestamp: Long,
    val messageId: String,
    val isDeleted: Boolean
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
    Log.d("MaxPlus", "handleIncomingMessage: data=$data")
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull()
    if (chatId == null) {
      Log.w("MaxPlus", "handleIncomingMessage: missing chatId")
      return
    }
    val explicitAccount = (data["account_id"] ?: data["explicit_account"])?.toLongOrNull()
    val account = if (explicitAccount != null && explicitAccount > 0L) {
      explicitAccount
    } else {
      try {
        resolveAccountForChatNative(chatId, ctx.applicationInfo.dataDir)
      } catch (_: Throwable) {
        0L
      }
    }

    try {
      if (!isNotificationsEnabledNative(account, ctx.applicationInfo.dataDir)) {
        Log.d("MaxPlus", "handleIncomingMessage: notifications disabled for account $account")
        return
      }
    } catch (e: Throwable) {
      Log.e("MaxPlus", "isNotificationsEnabledNative error", e)
    }

    try {
      if (isChatMutedNative(account, chatId, ctx.applicationInfo.dataDir)) {
        Log.d("MaxPlus", "handleIncomingMessage: chat $chatId is muted")
        return
      }
    } catch (e: Throwable) {
      Log.e("MaxPlus", "isChatMutedNative error", e)
    }

    val mid = data["msgid"] ?: data["mid"] ?: ""
    val text = data["msg"] ?: data["body"] ?: data["text"] ?: "Сообщение"
    val senderId = data["suid"] ?: ""
    val senderIdLong = senderId.toLongOrNull() ?: 0L
    val contactInfo = if (senderIdLong > 0L) ContactHelper.getContactInfo(ctx, account, senderIdLong) else null
    val chatInfo = if (senderIdLong <= 0L || data["title"].isNullOrEmpty() || data["title"] == "Собеседник") {
      ContactHelper.getContactInfo(ctx, account, chatId)
    } else {
      null
    }
    val rawSenderName = data["userName"] ?: data["title"]
    val senderName = contactInfo?.name?.takeIf { it.isNotBlank() }
      ?: chatInfo?.name?.takeIf { it.isNotBlank() }
      ?: rawSenderName?.takeIf { it.isNotBlank() && !it.startsWith("Пользователь ") && !it.startsWith("User ") && it != "Собеседник" }
      ?: "Собеседник"
    val chatTitle = data["title"]?.takeIf { it.isNotBlank() && it != "Собеседник" }
      ?: chatInfo?.name?.takeIf { it.isNotBlank() }
      ?: senderName
    val ts = data["ctime"]?.toLongOrNull() ?: System.currentTimeMillis()
    
    val isGroup = (if (data.containsKey("isGroup")) {
      data["isGroup"] == "true"
    } else {
      try {
        isChatGroupNative(account, chatId, ctx.applicationInfo.dataDir)
      } catch (e: Throwable) {
        false
      }
    }) && (chatTitle != senderName)

    ensureChannel()

    val isPrivacyActive = try {
      isAccountPrivacyActiveNative(account, ctx.applicationInfo.dataDir)
    } catch (_: Throwable) {
      false
    }
    val isCurrentlyLocked = !AppState.isAppInForeground || AppState.isAppLocked
    if (isPrivacyActive && isCurrentlyLocked) {
      showSecurePrivacyNotification(account)
      return
    }
    
    val history = appendMessage(chatId, NotificationMessage(text, senderId, senderName, ts, mid, false))
    saveMeta(chatId, chatTitle, account, isGroup)
    render(chatId, chatTitle, account, isGroup, history, alertOnce = false)
  }

  private fun showSecurePrivacyNotification(account: Long) {
    ensureChannel()
    val prefs = ctx.getSharedPreferences("maxplus_privacy_notifications", Context.MODE_PRIVATE)
    val countKey = "hidden_count_$account"
    val count = prefs.getInt(countKey, 0) + 1
    prefs.edit().putInt(countKey, count).apply()

    val notifId = (777000L + (account % 1000L)).toInt()
    val launchIntent = (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(ctx, MainActivity::class.java)).apply {
      action = Intent.ACTION_VIEW
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("account", account)
    }
    val contentIntent = PendingIntent.getActivity(
      ctx,
      notifId,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val text = "У вас новые сообщения ($count)"
    val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("Max+")
      .setContentText(text)
      .setContentIntent(contentIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)

    manager().notify(notifId, builder.build())
  }
  
  fun handleEditMessage(data: Map<String, String>) {
    Log.d("MaxPlus", "handleEditMessage: data=$data")
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
    val mid = data["msgid"] ?: data["mid"] ?: return
    val newText = data["msg"] ?: data["body"] ?: data["text"] ?: return
    
    val history = loadMessages(chatId).toMutableList()
    val index = history.indexOfLast { it.messageId == mid }
    if (index < 0) return
      
    val old = history[index]
    if (old.isDeleted || old.text == newText) return
      
    history[index] = old.copy(text = newText)
    saveMessages(chatId, history)
    
    val (title, account, isGroup) = loadMeta(chatId)
    render(chatId, title, account, isGroup, history, alertOnce = true)
  }
  
  fun handleRemoveMessage(data: Map<String, String>) {
    Log.d("MaxPlus", "handleRemoveMessage: data=$data")
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
    val mid = data["msgid"] ?: data["mid"] ?: return
    
    val history = loadMessages(chatId).toMutableList()
    val index = history.indexOfLast { it.messageId == mid }
    if (index < 0) return
      
    history[index] = history[index].copy(isDeleted = true)
    saveMessages(chatId, history)
    
    val (title, account, isGroup) = loadMeta(chatId)
    render(chatId, title, account, isGroup, history, alertOnce = true)
  }
  
  fun handleOutgoingReply(chatId: Long, replyText: String) {
    val (title, account, isGroup) = loadMeta(chatId)
    val history = appendMessage(
      chatId,
      NotificationMessage(
        text = replyText,
        senderId = "me",
        senderName = "Вы",
        timestamp = System.currentTimeMillis(),
        messageId = "",
        isDeleted = false
      )
    )
    render(chatId, title, account, isGroup, history, alertOnce = true)
  }

  private fun updateConversationShortcut(chatId: Long, chatTitle: String, conversationPerson: Person) {
    val shortcutKey = "dialog_$chatId"
    try {
      val openIntent = (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(ctx, MainActivity::class.java)).apply {
        action = Intent.ACTION_VIEW
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra("chatId", chatId)
      }
      val shortcut = ShortcutInfoCompat.Builder(ctx, shortcutKey)
        .setShortLabel(chatTitle)
        .setLongLived(true)
        .setIntent(openIntent)
        .setPerson(conversationPerson)
        .setIcon(conversationPerson.icon)
        .setCategories(setOf(ShortcutInfo.SHORTCUT_CATEGORY_CONVERSATION))
        .setLocusId(LocusIdCompat(shortcutKey))
        .build()
      ShortcutManagerCompat.pushDynamicShortcut(ctx, shortcut)
    } catch (e: Throwable) {
      Log.w("MaxPlus", "updateConversationShortcut error", e)
    }
  }

  private fun render(chatId: Long, title: String, account: Long, isGroup: Boolean, history: List<NotificationMessage>, alertOnce: Boolean) {
    if (history.isEmpty()) return
    val notifId = (chatId and 0x7fffffff).toInt()
    Log.d("MaxPlus", "render: chatId=$chatId, notifId=$notifId, account=$account, isGroup=$isGroup, count=${history.size}")
    val newest = history.last()
    
    val isActuallyGroup = isGroup && (title != newest.senderName) && newest.senderName.isNotEmpty()

    val userPerson = Person.Builder().setName("Вы").build()
    
    val style = NotificationCompat.MessagingStyle(userPerson)
      .setGroupConversation(isActuallyGroup)
    if (isActuallyGroup) {
      style.conversationTitle = title
    }
    
    var newestPerson: Person? = null
    for (m in history) {
      val isMe = m.senderId == "me" || m.senderName == "Вы"
      val person = if (isMe) {
        null
      } else {
        val senderIdLong = m.senderId.toLongOrNull() ?: chatId
        val avatarBitmap = AvatarHelper.getAvatar(ctx, senderIdLong, m.senderName, null, account)
        val displayName = if (isActuallyGroup) {
          if (m.senderName.isNotEmpty() && m.senderName != title) m.senderName else null
        } else {
          title
        }
        val p = Person.Builder()
          .setName(displayName)
          .setKey(m.senderId)
          .setIcon(IconCompat.createWithBitmap(avatarBitmap))
          .build()
        if (m == newest) {
          newestPerson = p
        }
        p
      }
      
      val textFormatted = if (m.isDeleted) {
        SpannableStringBuilder("Удалено: ${m.text}").apply {
          setSpan(StrikethroughSpan(), 9, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          setSpan(StyleSpan(Typeface.ITALIC), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
      } else {
        m.text
      }
      
      style.addMessage(textFormatted, m.timestamp, person)
    }
    
    val chatAvatar = AvatarHelper.getAvatar(ctx, chatId, title, null, account)
    val shortcutKey = "dialog_$chatId"
    val conversationPerson = newestPerson ?: Person.Builder()
      .setName(title)
      .setKey(chatId.toString())
      .setIcon(IconCompat.createWithBitmap(chatAvatar))
      .build()
    updateConversationShortcut(chatId, title, conversationPerson)
    
    val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(ctx, MainActivity::class.java)
    launchIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    launchIntent.putExtra("chatId", chatId)
    if (account != 0L) {
      launchIntent.putExtra("account", account)
    }
    val contentIntent = PendingIntent.getActivity(
      ctx,
      notifId,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setLargeIcon(chatAvatar)
      .setStyle(style)
      .setContentIntent(contentIntent)
      .setAutoCancel(true)
      .setOnlyAlertOnce(alertOnce)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setShortcutId(shortcutKey)
      .setLocusId(LocusIdCompat(shortcutKey))
      .setAllowSystemGeneratedContextualActions(false)
    
    if (account != 0L) {
      val replyIntent = Intent(ctx, ReplyReceiver::class.java).apply {
        action = "${ctx.packageName}.ACTION_REPLY"
        putExtra("account", account)
        putExtra("chatId", chatId)
        putExtra("mid", newest.messageId.toLongOrNull() ?: 0L)
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
  
  private fun loadMessages(chatId: Long): List<NotificationMessage> {
    var raw = prefs().getString("dialog_cache_$chatId", null)
    if (raw == null) {
      raw = try {
        ctx.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE).getString("hist_$chatId", "[]")
      } catch (_: Throwable) {
        "[]"
      } ?: "[]"
    }

    val arr = JSONArray(raw)
    val list = mutableListOf<NotificationMessage>()
    for (i in 0 until arr.length()) {
      val obj = arr.getJSONObject(i)
      val text = obj.optString("text", obj.optString("t", ""))
      val senderId = obj.optString("sender_id", obj.optString("k", ""))
      val senderName = obj.optString("sender_name", obj.optString("n", ""))
      val timestamp = if (obj.has("timestamp")) obj.getLong("timestamp") else obj.optLong("ts", 0L)
      val messageId = obj.optString("message_id", obj.optString("m", ""))
      val isDeleted = if (obj.has("is_deleted")) obj.getBoolean("is_deleted") else obj.optBoolean("d", false)

      list.add(NotificationMessage(text, senderId, senderName, timestamp, messageId, isDeleted))
    }
    return list
  }
  
  private fun saveMessages(chatId: Long, items: List<NotificationMessage>) {
    val arr = JSONArray()
    for (m in items) {
      arr.put(JSONObject().apply {
        put("text", m.text)
        put("sender_id", m.senderId)
        put("sender_name", m.senderName)
        put("timestamp", m.timestamp)
        put("message_id", m.messageId)
        put("is_deleted", m.isDeleted)
      })
    }
    prefs().edit().putString("dialog_cache_$chatId", arr.toString()).apply()
  }
  
  private fun appendMessage(chatId: Long, item: NotificationMessage): List<NotificationMessage> {
    val queue = ArrayDeque(loadMessages(chatId))
    queue.addLast(item)
    while (queue.size > HISTORY_LIMIT) {
      queue.removeFirst()
    }
    val result = queue.toList()
    saveMessages(chatId, result)
    return result
  }
  
  private fun saveMeta(chatId: Long, title: String, account: Long, isGroup: Boolean) {
    prefs().edit().putString("dialog_meta_$chatId", JSONObject().apply {
      put("title", title)
      put("account", account)
      put("isGroup", isGroup)
    }.toString()).apply()
  }
  
  private fun loadMeta(chatId: Long): Triple<String, Long, Boolean> {
    var raw = prefs().getString("dialog_meta_$chatId", null)
    if (raw == null) {
      raw = try {
        ctx.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE).getString("meta_$chatId", null)
      } catch (_: Throwable) {
        null
      }
    }
    if (raw == null) return Triple("Чат", 0L, false)
    val obj = JSONObject(raw)
    return Triple(
      obj.optString("title", "Чат"),
      obj.optLong("account", 0L),
      obj.optBoolean("isGroup", false)
    )
  }
}
