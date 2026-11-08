package me.junioraww.max

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class MaxBackgroundService : Service() {

    companion object {
        const val SERVICE_NOTIFICATION_ID = 404040
        const val CHANNEL_ID = "me.junioraww.max.DAEMON_CHANNEL"
        const val ACTION_STOP_DAEMON = "me.junioraww.max.ACTION_STOP_DAEMON"
        private const val PREFS = "me_junioraww_max_daemon"
        private const val KEY_ENABLED = "daemon_enabled"

        @Volatile
        var isServiceRunning = false

        @JvmStatic
        @Volatile
        var isDaemonConnected = false

        fun isEnabled(context: Context): Boolean {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_ENABLED, true)
        }

        fun setEnabled(context: Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ENABLED, enabled)
                .apply()
        }

        fun start(context: Context) {
            if (context.packageName == "ru.oneme.app") return
            if (!isEnabled(context)) return
            val intent = Intent(context, MaxBackgroundService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(context, intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Throwable) {
                Log.e("MaxPlus", "MaxBackgroundService start failed", e)
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, MaxBackgroundService::class.java))
            } catch (e: Throwable) {
                Log.e("MaxPlus", "MaxBackgroundService stop failed", e)
            }
        }

        fun acquireTemporaryWakeLock(context: Context, durationMs: Long = 2000L) {
            try {
                val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val wakeLock = powerManager?.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "MaxPlus:EventWakeLock"
                )
                wakeLock?.acquire(durationMs)
            } catch (e: Throwable) {
                Log.w("MaxPlus", "Failed to acquire temporary WakeLock", e)
            }
        }
    }

    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var serviceWakeLock: PowerManager.WakeLock? = null

    private external fun startDaemonNative(appDir: String, account: Long)
    private external fun stopDaemonNative()
    private external fun onNetworkChangedNative()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        try {
            System.loadLibrary("maxplus_lib")
        } catch (e: Throwable) {
            Log.e("MaxPlus", "MaxBackgroundService: failed to load maxplus_lib", e)
        }

        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            serviceWakeLock = powerManager?.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "MaxPlus:BackgroundServiceLock"
            )?.apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (e: Throwable) {
            Log.w("MaxPlus", "Failed to acquire service wake lock", e)
        }

        if (MainActivity.appContext == null) {
            MainActivity.appContext = applicationContext
        }
        NotificationHelper.customContext = applicationContext
        CallNotificationManager.customContext = applicationContext

        ensureNotificationChannel()
        registerNetworkCallback()
        isServiceRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isEnabled(this)) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundServiceNotification()

        val appDir = applicationInfo.dataDir
        try {
            startDaemonNative(appDir, 0L)
        } catch (e: Throwable) {
            Log.e("MaxPlus", "startDaemonNative error", e)
        }

        return START_STICKY
    }

    override fun onDestroy() {
        isServiceRunning = false
        isDaemonConnected = false
        try {
            serviceWakeLock?.let {
                if (it.isHeld) {
                    it.release()
                }
            }
            serviceWakeLock = null
        } catch (_: Throwable) {}
        unregisterNetworkCallback()
        try {
            stopDaemonNative()
        } catch (e: Throwable) {
            Log.e("MaxPlus", "stopDaemonNative error", e)
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "Служба связи MAX+",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Поддержание соединения для входящих звонков и сообщений"
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                    setSound(null, null)
                }
                manager.createNotificationChannel(channel)
            }
        }
    }

    private fun startForegroundServiceNotification() {
        val stopIntent = PendingIntent.getBroadcast(
            this,
            101,
            Intent(this, DaemonControlReceiver::class.java).apply {
                action = ACTION_STOP_DAEMON
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openIntent = PendingIntent.getActivity(
            this,
            102,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("MAX+")
            .setContentText("Фоновая служба связи активна")
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openIntent)
            .addAction(0, "Отключить", stopIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                SERVICE_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
            )
        } else {
            startForeground(SERVICE_NOTIFICATION_ID, notification)
        }
    }

    private fun registerNetworkCallback() {
        try {
            connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    onNetworkChangedNative()
                }

                override fun onLost(network: Network) {
                    onNetworkChangedNative()
                }
            }
            connectivityManager?.registerNetworkCallback(request, networkCallback!!)
        } catch (e: Throwable) {
            Log.w("MaxPlus", "Failed to register network callback", e)
        }
    }

    private fun unregisterNetworkCallback() {
        try {
            networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) }
            networkCallback = null
        } catch (_: Throwable) {}
    }
}
