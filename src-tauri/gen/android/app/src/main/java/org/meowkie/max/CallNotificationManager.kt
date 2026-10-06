package org.meowkie.max

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat

object CallNotificationManager {
  const val CALL_NOTIFICATION_ID = 987654
  const val CALL_CHANNEL_ID = "org.meowkie.max.CALLS"
  private const val CALL_CHANNEL_NAME = "Входящие вызовы"
  private const val PREFS_NAME = "org_meowkie_max_call_prefs"
  private const val KEY_SOUND = "call_sound"
  private const val KEY_VIBRATION = "call_vibration"

  @Volatile
  private var activeRingtone: Ringtone? = null

  @Volatile
  private var activeVibrator: Vibrator? = null

  fun getPrefs(context: Context): SharedPreferences {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  }

  @JvmStatic
  fun syncCallSettings(sound: Boolean, vibration: Boolean) {
    val ctx = MainActivity.appContext ?: MainActivity.instance?.applicationContext ?: return
    getPrefs(ctx).edit()
      .putBoolean(KEY_SOUND, sound)
      .putBoolean(KEY_VIBRATION, vibration)
      .apply()
  }

  @JvmStatic
  fun cancelCallNotificationFromNative() {
    val ctx = MainActivity.appContext ?: MainActivity.instance?.applicationContext ?: return
    cancelCallNotification(ctx)
  }

  fun showIncomingCallNotification(context: Context, data: Map<String, String>) {
    createCallChannel(context)

    val prefs = getPrefs(context)
    val soundEnabled = prefs.getBoolean(KEY_SOUND, true)
    val vibrationEnabled = prefs.getBoolean(KEY_VIBRATION, true)

    val conversationId = data["conversationId"] ?: data["vcId"] ?: data["conference_id"] ?: ""
    val callerId = data["callerId"] ?: data["suid"] ?: data["caller_id"] ?: ""
    val account = data["c"]?.toLongOrNull() ?: 0L
    val callerIdLong = callerId.toLongOrNull() ?: 0L
    val rawCallerName = data["userName"] ?: data["title"] ?: data["callerName"] ?: data["caller_name"] ?: data["name"]
    val contactInfo = if (callerIdLong > 0L) ContactHelper.getContactInfo(context, account, callerIdLong) else null
    val callerName = contactInfo?.name?.takeIf { it.isNotBlank() }
      ?: rawCallerName?.takeIf { it.isNotBlank() && !it.startsWith("Пользователь ") && !it.startsWith("User ") }
      ?: if (callerId.isNotEmpty()) "Пользователь $callerId" else "Входящий вызов"
    val isVideo = data["isVideo"]?.toBoolean() ?: data["video"]?.toBoolean() ?: (data["iv"] == "1" || data["iv"] == "true")
    val vcp = data["vcp"] ?: data["conversationParams"] ?: ""

    val dismissIntent = Intent(context, CallDismissReceiver::class.java).apply {
      action = "${context.packageName}.ACTION_DISMISS_CALL"
      putExtra("conversationId", conversationId)
      putExtra("callerId", callerId)
      putExtra("vcp", vcp)
    }
    val dismissPendingIntent = PendingIntent.getBroadcast(
      context,
      101,
      dismissIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val answerIntent = Intent(context, MainActivity::class.java).apply {
      action = "${context.packageName}.ACTION_ANSWER_CALL"
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("call_action", "answer")
      putExtra("conversationId", conversationId)
      putExtra("callerId", callerId)
      putExtra("callerName", callerName)
      putExtra("isVideo", isVideo)
      putExtra("vcp", vcp)
    }
    val answerPendingIntent = PendingIntent.getActivity(
      context,
      102,
      answerIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val fullScreenIntent = Intent(context, MainActivity::class.java).apply {
      action = "${context.packageName}.ACTION_INCOMING_CALL"
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("call_action", "show_incoming")
      putExtra("conversationId", conversationId)
      putExtra("callerId", callerId)
      putExtra("callerName", callerName)
      putExtra("isVideo", isVideo)
      putExtra("vcp", vcp)
    }
    val fullScreenPendingIntent = PendingIntent.getActivity(
      context,
      103,
      fullScreenIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val avatarBitmap = AvatarHelper.getAvatar(context, callerIdLong, callerName, contactInfo?.avatarPath, account)
    val callerPerson = Person.Builder()
      .setName(callerName)
      .setKey(callerId)
      .setIcon(IconCompat.createWithBitmap(avatarBitmap))
      .setImportant(true)
      .build()

    val titleText = if (isVideo) "Входящий видеозвонок" else "Входящий звонок"
    val contentText = callerName

    val builder = NotificationCompat.Builder(context, CALL_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setLargeIcon(avatarBitmap)
      .setContentTitle(titleText)
      .setContentText(contentText)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setAutoCancel(false)
      .setOngoing(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setFullScreenIntent(fullScreenPendingIntent, true)
      .setContentIntent(fullScreenPendingIntent)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setStyle(
        NotificationCompat.CallStyle.forIncomingCall(
          callerPerson,
          dismissPendingIntent,
          answerPendingIntent
        )
      )
    } else {
      builder.addAction(
        R.drawable.ic_notification,
        "Отклонить",
        dismissPendingIntent
      )
      builder.addAction(
        R.drawable.ic_notification,
        "Ответить",
        answerPendingIntent
      )
    }

    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.notify(CALL_NOTIFICATION_ID, builder.build())

    playAlerts(context, soundEnabled, vibrationEnabled)
  }

  fun cancelCallNotification(context: Context) {
    stopAlerts()
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.cancel(CALL_NOTIFICATION_ID)
  }

  private fun playAlerts(context: Context, sound: Boolean, vibration: Boolean) {
    stopAlerts()
    if (sound) {
      try {
        val alertUri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
          ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
          ?: android.provider.Settings.System.DEFAULT_RINGTONE_URI
        val ringtone = RingtoneManager.getRingtone(context.applicationContext, alertUri)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          ringtone.audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        }
        ringtone.play()
        activeRingtone = ringtone
      } catch (e: Throwable) {
        android.util.Log.e("MaxPlus", "Failed to play call ringtone", e)
      }
    }

    if (vibration) {
      try {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
          vm.defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 800, 800, 800, 800)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
          @Suppress("DEPRECATION")
          vibrator.vibrate(pattern, 0)
        }
        activeVibrator = vibrator
      } catch (e: Throwable) {
        android.util.Log.e("MaxPlus", "Failed to vibrate for call", e)
      }
    }
  }

  fun stopAlerts() {
    try {
      activeRingtone?.stop()
    } catch (_: Throwable) {}
    activeRingtone = null

    try {
      activeVibrator?.cancel()
    } catch (_: Throwable) {}
    activeVibrator = null
  }

  private fun createCallChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val existing = notificationManager.getNotificationChannel(CALL_CHANNEL_ID)
      if (existing == null) {
        val soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
          ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
          ?: android.provider.Settings.System.DEFAULT_RINGTONE_URI
        val audioAttrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()

        val channel = NotificationChannel(
          CALL_CHANNEL_ID,
          CALL_CHANNEL_NAME,
          NotificationManager.IMPORTANCE_HIGH
        ).apply {
          description = "Уведомления о входящих аудио и видеозвонках"
          enableLights(true)
          lightColor = Color.GREEN
          lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
          setSound(soundUri, audioAttrs)
          enableVibration(true)
        }
        notificationManager.createNotificationChannel(channel)
      }
    }
  }
}
