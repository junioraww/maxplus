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
import java.util.concurrent.ConcurrentHashMap

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
  private external fun resolveLocalAccountNative(account: Long, appDir: String): Long
  private external fun isAccountEncryptedNative(account: Long, appDir: String): Boolean
  private external fun getAccountLabelNative(account: Long, appDir: String): String?

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
    private const val HISTORY_LIMIT = 10
    private const val GROUP_KEY = "maxplus_messages_group"
    private const val SUMMARY_ID = 500001
    private val inMemoryHistory = ConcurrentHashMap<String, List<NotificationMessage>>()
    private val inMemoryMeta = ConcurrentHashMap<String, Pair<String, Boolean>>()

    @Volatile
    var customContext: Context? = null

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
        "account_id" to account.toString(),
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

    private fun notifIdFor(account: Long, chatId: Long): Int {
      if (account == 0L) return (chatId and 0x7fffffffL).toInt()
      val mixed = (account * 31L) xor chatId
      val id = (mixed and 0x7fffffffL).toInt()
      return if (id == 0) 1 else id
    }

    private fun tagFor(account: Long, chatId: Long) = "acct_${account}_${chatId}"

    private fun groupKeyFor(account: Long) = if (account > 0L) "maxplus_messages_group_$account" else GROUP_KEY

    private fun summaryIdFor(account: Long) = if (account > 0L) (SUMMARY_ID + (account % 1000L).toInt()) else SUMMARY_ID

    @JvmStatic
    fun cancelNotificationDirect(account: Long, chatId: Long) {
      val ctx = customContext ?: MainActivity.appContext ?: MainActivity.instance?.applicationContext
      if (ctx == null) {
        Log.e("MaxPlus", "cancelNotificationDirect: no Context available")
        return
      }
      val helper = NotificationHelper(ctx)
      val acct = if (account > 0L) helper.normalizeAccount(account) else 0L
      Log.d("MaxPlus", "cancelNotificationDirect: account=$acct (raw=$account), chatId=$chatId")
      val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val editor = prefs.edit()
        .remove("dialog_cache_$chatId")
        .remove("dialog_meta_$chatId")

      if (acct > 0L) {
        val notifId = notifIdFor(acct, chatId)
        val tag = tagFor(acct, chatId)
        mgr.cancel(tag, notifId)
        mgr.cancel(notifId)
        val cKey = "dialog_cache_${acct}_${chatId}"
        val mKey = "dialog_meta_${acct}_${chatId}"
        inMemoryHistory.remove(cKey)
        inMemoryMeta.remove(mKey)
        editor.remove(cKey).remove(mKey)
      } else {
        val notifId = (chatId and 0x7fffffff).toInt()
        mgr.cancel(notifId)
        val suffix = "_$chatId"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          for (sbn in mgr.activeNotifications) {
            if (sbn.tag != null && sbn.tag.endsWith(suffix)) {
              mgr.cancel(sbn.tag, sbn.id)
            }
          }
        }
        inMemoryHistory.keys.filter { it.endsWith(suffix) }.forEach { inMemoryHistory.remove(it) }
        inMemoryMeta.keys.filter { it.endsWith(suffix) }.forEach { inMemoryMeta.remove(it) }
        for (key in prefs.all.keys) {
          if ((key.startsWith("dialog_cache_") || key.startsWith("dialog_meta_")) && key.endsWith(suffix)) {
            editor.remove(key)
          }
        }
      }
      editor.apply()

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        if (acct > 0L) {
          helper.updateGroupSummary(acct)
        } else {
          val groups = mgr.activeNotifications
            .mapNotNull { it.notification.group }
            .filter { it.startsWith(GROUP_KEY) }
            .distinct()
          for (g in groups) {
            val gAcct = g.removePrefix("${GROUP_KEY}_").toLongOrNull() ?: 0L
            helper.updateGroupSummary(gAcct)
          }
          val remaining = mgr.activeNotifications.count {
            it.id != SUMMARY_ID && it.notification.group == GROUP_KEY
          }
          if (remaining < 2) {
            mgr.cancel(SUMMARY_ID)
          }
        }
      }
    }

    @JvmStatic
    fun resetPrivacyNotificationsDirect(account: Long) {
      val ctx = customContext ?: MainActivity.appContext ?: MainActivity.instance?.applicationContext ?: return
      val prefs = ctx.getSharedPreferences("maxplus_privacy_notifications", Context.MODE_PRIVATE)
      val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (account > 0L) {
        val acct = NotificationHelper(ctx).normalizeAccount(account)
        resetSecurePrivacyNotification(ctx, acct)
        if (acct != account) {
          resetSecurePrivacyNotification(ctx, account)
        }
        return
      }
      val editor = prefs.edit()
      for (key in prefs.all.keys) {
        if (key.startsWith("hidden_count_")) {
          editor.putInt(key, 0)
          val acct = key.removePrefix("hidden_count_").toLongOrNull() ?: 0L
          mgr.cancel((777000L + (acct % 1000L)).toInt())
        }
      }
      editor.apply()
      mgr.cancel(777000)
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
    val account = resolveAccount(data, chatId)

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
    
    val history = appendMessage(account, chatId, NotificationMessage(text, senderId, senderName, ts, mid, false))
    saveMeta(account, chatId, chatTitle, isGroup)
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

    val accountLabel = getAccountLabel(account)
    val text = "У вас новые сообщения ($count)"
    val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("Max+")
      .setContentText(text)
      .setContentIntent(contentIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
    if (accountLabel.isNotEmpty()) {
      builder.setSubText(accountLabel)
    }

    manager().notify(notifId, builder.build())
  }
  
  fun handleEditMessage(data: Map<String, String>) {
    Log.d("MaxPlus", "handleEditMessage: data=$data")
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
    val mid = data["msgid"] ?: data["mid"] ?: return
    val newText = data["msg"] ?: data["body"] ?: data["text"] ?: return
    val account = resolveAccount(data, chatId)
    
    val history = loadMessages(account, chatId).toMutableList()
    val index = history.indexOfLast { it.messageId == mid }
    if (index < 0) return
      
    val old = history[index]
    if (old.isDeleted || old.text == newText) return
      
    history[index] = old.copy(text = newText)
    saveMessages(account, chatId, history)
    
    val (title, isGroup) = loadMeta(account, chatId)
    render(chatId, title, account, isGroup, history, alertOnce = true)
  }
  
  fun handleRemoveMessage(data: Map<String, String>) {
    Log.d("MaxPlus", "handleRemoveMessage: data=$data")
    val chatId = (data["mc"] ?: data["chat_id"])?.toLongOrNull() ?: return
    val mid = data["msgid"] ?: data["mid"] ?: return
    val account = resolveAccount(data, chatId)
    
    val history = loadMessages(account, chatId).toMutableList()
    val index = history.indexOfLast { it.messageId == mid }
    if (index < 0) return
      
    history[index] = history[index].copy(isDeleted = true)
    saveMessages(account, chatId, history)
    
    val (title, isGroup) = loadMeta(account, chatId)
    render(chatId, title, account, isGroup, history, alertOnce = true)
  }
  
  fun handleOutgoingReply(account: Long, chatId: Long, replyText: String) {
    val acct = normalizeAccount(account)
    val (title, isGroup) = loadMeta(acct, chatId)
    val history = appendMessage(
      acct,
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
    render(chatId, title, acct, isGroup, history, alertOnce = true)
  }

  fun handleNotificationDismissed(account: Long, chatId: Long) {
    val acct = normalizeAccount(account)
    clearDialogCache(acct, chatId)
    updateGroupSummary(acct)
  }

  private fun getAccountLabel(account: Long): String {
    if (account <= 0L) return ""
    return try {
      getAccountLabelNative(account, ctx.applicationInfo.dataDir)?.trim() ?: ""
    } catch (_: Throwable) {
      ""
    }
  }

  internal fun normalizeAccount(account: Long): Long {
    if (account <= 0L) return 0L
    return try {
      resolveLocalAccountNative(account, ctx.applicationInfo.dataDir)
    } catch (_: Throwable) {
      account
    }
  }

  private fun isEncryptedAccount(account: Long): Boolean {
    if (account <= 0L) return false
    return try {
      isAccountEncryptedNative(account, ctx.applicationInfo.dataDir)
    } catch (_: Throwable) {
      false
    }
  }

  private fun resolveAccount(data: Map<String, String>, chatId: Long): Long {
    val explicitAccount = (data["account_id"] ?: data["explicit_account"])?.toLongOrNull()
    val raw = if (explicitAccount != null && explicitAccount > 0L) {
      explicitAccount
    } else {
      try {
        resolveAccountForChatNative(chatId, ctx.applicationInfo.dataDir)
      } catch (_: Throwable) {
        0L
      }
    }
    return normalizeAccount(raw)
  }

  private fun updateConversationShortcut(account: Long, chatId: Long, chatTitle: String, conversationPerson: Person) {
    val shortcutKey = shortcutKey(account, chatId)
    try {
      val openIntent = (ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(ctx, MainActivity::class.java)).apply {
        action = Intent.ACTION_VIEW
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra("chatId", chatId)
        if (account != 0L) {
          putExtra("account", account)
        }
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
    val notifId = notifIdFor(account, chatId)
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
    val shortcutKey = shortcutKey(account, chatId)
    val conversationPerson = newestPerson ?: Person.Builder()
      .setName(title)
      .setKey(chatId.toString())
      .setIcon(IconCompat.createWithBitmap(chatAvatar))
      .build()
    updateConversationShortcut(account, chatId, title, conversationPerson)
    
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

    val accountLabel = getAccountLabel(account)
    val groupKey = groupKeyFor(account)

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
      .setGroup(groupKey)
      .setAllowSystemGeneratedContextualActions(false)
    if (accountLabel.isNotEmpty()) {
      builder.setSubText(accountLabel)
    }
    
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
    
    val dismissIntent = Intent(ctx, ReplyReceiver::class.java).apply {
      action = "${ctx.packageName}.ACTION_DISMISS"
      putExtra("account", account)
      putExtra("chatId", chatId)
    }
    val deletePendingIntent = PendingIntent.getBroadcast(
      ctx,
      notifId xor 0x40000000,
      dismissIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    builder.setDeleteIntent(deletePendingIntent)

    manager().notify(tagFor(account, chatId), notifId, builder.build())
    updateGroupSummary(account, accountLabel)
  }

  internal fun updateGroupSummary(account: Long, accountLabel: String = getAccountLabel(account)) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val mgr = manager()
    val groupKey = groupKeyFor(account)
    val summaryId = summaryIdFor(account)
    val active = mgr.activeNotifications.filter {
      it.id != summaryId && it.notification.group == groupKey
    }
    if (active.size < 2) {
      mgr.cancel(summaryId)
      return
    }
    val inbox = NotificationCompat.InboxStyle()
    for (sbn in active.take(5)) {
      val extras = sbn.notification.extras
      val lineTitle = extras.getCharSequence(NotificationCompat.EXTRA_CONVERSATION_TITLE)
        ?: extras.getCharSequence(NotificationCompat.EXTRA_TITLE)
        ?: "Чат"
      val lineText = extras.getCharSequence(NotificationCompat.EXTRA_TEXT) ?: ""
      inbox.addLine("$lineTitle: $lineText")
    }
    val summaryBuilder = NotificationCompat.Builder(ctx, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle("Max+")
      .setContentText("Новые сообщения (${active.size})")
      .setStyle(inbox)
      .setGroup(groupKey)
      .setGroupSummary(true)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
    if (accountLabel.isNotEmpty()) {
      summaryBuilder.setSubText(accountLabel)
    }
    mgr.notify(summaryId, summaryBuilder.build())
  }
  
  private fun prefs() = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun cacheKey(account: Long, chatId: Long) = "dialog_cache_${account}_${chatId}"

  private fun metaKey(account: Long, chatId: Long) = "dialog_meta_${account}_${chatId}"

  private fun shortcutKey(account: Long, chatId: Long) = "dialog_${account}_${chatId}"
  
  private fun isNotificationActive(account: Long, chatId: Long): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val notifId = notifIdFor(account, chatId)
    val tag = tagFor(account, chatId)
    return manager().activeNotifications.any {
      (it.tag == tag && it.id == notifId) || (it.tag == null && it.id == notifId)
    }
  }

  private fun clearDialogCache(account: Long, chatId: Long) {
    val cKey = cacheKey(account, chatId)
    val mKey = metaKey(account, chatId)
    inMemoryHistory.remove(cKey)
    inMemoryMeta.remove(mKey)
    prefs().edit().remove(cKey).remove(mKey).apply()
  }

  private fun loadMessages(account: Long, chatId: Long): List<NotificationMessage> {
    val cKey = cacheKey(account, chatId)
    if (isEncryptedAccount(account)) {
      return inMemoryHistory[cKey] ?: emptyList()
    }
    val raw = prefs().getString(cKey, "[]") ?: "[]"

    val arr = JSONArray(raw)
    val list = mutableListOf<NotificationMessage>()
    for (i in 0 until arr.length()) {
      val obj = arr.getJSONObject(i)
      val text = obj.optString("text", "")
      val senderId = obj.optString("sender_id", "")
      val senderName = obj.optString("sender_name", "")
      val timestamp = obj.optLong("timestamp", 0L)
      val messageId = obj.optString("message_id", "")
      val isDeleted = obj.optBoolean("is_deleted", false)

      list.add(NotificationMessage(text, senderId, senderName, timestamp, messageId, isDeleted))
    }
    return list
  }
  
  private fun saveMessages(account: Long, chatId: Long, items: List<NotificationMessage>) {
    val cKey = cacheKey(account, chatId)
    if (isEncryptedAccount(account)) {
      inMemoryHistory[cKey] = items
      prefs().edit().remove(cKey).apply()
      return
    }
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
    prefs().edit().putString(cKey, arr.toString()).apply()
  }
  
  private fun appendMessage(account: Long, chatId: Long, item: NotificationMessage): List<NotificationMessage> {
    if (!isNotificationActive(account, chatId)) {
      clearDialogCache(account, chatId)
    }
    val queue = ArrayDeque(loadMessages(account, chatId))
    queue.addLast(item)
    while (queue.size > HISTORY_LIMIT) {
      queue.removeFirst()
    }
    val result = queue.toList()
    saveMessages(account, chatId, result)
    return result
  }
  
  private fun saveMeta(account: Long, chatId: Long, title: String, isGroup: Boolean) {
    val mKey = metaKey(account, chatId)
    if (isEncryptedAccount(account)) {
      inMemoryMeta[mKey] = Pair(title, isGroup)
      prefs().edit().remove(mKey).apply()
      return
    }
    prefs().edit().putString(mKey, JSONObject().apply {
      put("title", title)
      put("account", account)
      put("isGroup", isGroup)
    }.toString()).apply()
  }
  
  private fun loadMeta(account: Long, chatId: Long): Pair<String, Boolean> {
    val mKey = metaKey(account, chatId)
    if (isEncryptedAccount(account)) {
      return inMemoryMeta[mKey] ?: Pair("Чат", false)
    }
    val raw = prefs().getString(mKey, null) ?: return Pair("Чат", false)
    val obj = JSONObject(raw)
    return Pair(
      obj.optString("title", "Чат"),
      obj.optBoolean("isGroup", false)
    )
  }
}
