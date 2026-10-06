package org.meowkie.max

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList

class ScreenCaptureService : Service() {
    companion object {
        const val NOTIFICATION_ID = 987655
        const val CHANNEL_ID = "org.meowkie.max.SCREEN_CAPTURE"
        const val ACTION_START = "org.meowkie.max.ACTION_START_SCREEN_CAPTURE"
        const val ACTION_STOP = "org.meowkie.max.ACTION_STOP_SCREEN_CAPTURE"

        @Volatile
        var pendingResultCode: Int = 0

        @Volatile
        var pendingResultData: Intent? = null

        fun start(context: Context, resultCode: Int, resultData: Intent) {
            pendingResultCode = resultCode
            pendingResultData = resultData
            val intent = Intent(context, ScreenCaptureService::class.java).apply {
                action = ACTION_START
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ScreenCaptureService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var handlerThread: HandlerThread? = null
    private var serverSocket: ServerSocket? = null
    private var serverThread: Thread? = null
    private val clients = CopyOnWriteArrayList<OutputStream>()
    private var reusableBitmap: Bitmap? = null
    private var targetWidth = 720
    private var targetHeight = 1280
    private var isStreaming = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_STOP) {
            teardown()
            stopSelf()
            return START_NOT_STICKY
        }
        if (action == ACTION_START && !isStreaming) {
            startCaptureSession()
        }
        return START_NOT_STICKY
    }

    private fun startCaptureSession() {
        createNotificationChannel()
        val notification = buildForegroundNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val code = pendingResultCode
        val data = pendingResultData
        if (code == 0 || data == null) {
            MainActivity.instance?.notifyScreenCaptureResultNative(false, 0, 0, 0)
            stopSelf()
            return
        }

        val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        val projection = projectionManager?.getMediaProjection(code, data)
        if (projection == null) {
            MainActivity.instance?.notifyScreenCaptureResultNative(false, 0, 0, 0)
            stopSelf()
            return
        }
        mediaProjection = projection

        calculateDimensions()

        try {
            serverSocket = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
            val port = serverSocket?.localPort ?: 0
            startHttpServer()

            val reader = ImageReader.newInstance(targetWidth, targetHeight, PixelFormat.RGBA_8888, 2)
            imageReader = reader

            val thread = HandlerThread("ScreenCaptureHandler").apply { start() }
            handlerThread = thread
            val handler = Handler(thread.looper)

            val metrics = resources.displayMetrics
            virtualDisplay = projection.createVirtualDisplay(
                "ScreenCapture",
                targetWidth,
                targetHeight,
                metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface,
                null,
                handler
            )

            reader.setOnImageAvailableListener({ ir ->
                handleImageAvailable(ir)
            }, handler)

            isStreaming = true
            MainActivity.instance?.notifyScreenCaptureResultNative(true, port, targetWidth, targetHeight)
        } catch (e: Throwable) {
            teardown()
            MainActivity.instance?.notifyScreenCaptureResultNative(false, 0, 0, 0)
            stopSelf()
        }
    }

    private fun calculateDimensions() {
        val wm = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        val metrics = DisplayMetrics()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm?.currentWindowMetrics?.bounds
            if (bounds != null) {
                metrics.widthPixels = bounds.width()
                metrics.heightPixels = bounds.height()
            } else {
                @Suppress("DEPRECATION")
                wm?.defaultDisplay?.getRealMetrics(metrics)
            }
        } else {
            @Suppress("DEPRECATION")
            wm?.defaultDisplay?.getRealMetrics(metrics)
        }

        val maxDim = 1280
        val rawW = if (metrics.widthPixels > 0) metrics.widthPixels else 720
        val rawH = if (metrics.heightPixels > 0) metrics.heightPixels else 1280
        val scale = if (maxOf(rawW, rawH) > maxDim) maxDim.toFloat() / maxOf(rawW, rawH).toFloat() else 1.0f
        var w = (rawW * scale).toInt()
        var h = (rawH * scale).toInt()
        if (w % 2 != 0) w -= 1
        if (h % 2 != 0) h -= 1
        targetWidth = maxOf(360, w)
        targetHeight = maxOf(640, h)
    }

    private fun startHttpServer() {
        val server = serverSocket ?: return
        serverThread = Thread {
            while (!server.isClosed) {
                try {
                    val socket = server.accept()
                    handleClient(socket)
                } catch (_: Throwable) {
                    break
                }
            }
        }.apply { start() }
    }

    private fun handleClient(socket: Socket) {
        Thread {
            try {
                val input = socket.getInputStream().bufferedReader()
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                }
                val out = socket.getOutputStream()
                val header = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Cache-Control: no-cache, private\r\n" +
                    "Pragma: no-cache\r\n\r\n"
                out.write(header.toByteArray(Charsets.US_ASCII))
                out.flush()
                clients.add(out)
            } catch (_: Throwable) {
                try { socket.close() } catch (_: Throwable) {}
            }
        }.start()
    }

    private fun handleImageAvailable(reader: ImageReader) {
        val image = reader.acquireLatestImage() ?: return
        try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * targetWidth

            val fullWidth = targetWidth + rowPadding / pixelStride
            var bitmap = reusableBitmap
            if (bitmap == null || bitmap.width != fullWidth || bitmap.height != targetHeight) {
                bitmap?.recycle()
                bitmap = Bitmap.createBitmap(fullWidth, targetHeight, Bitmap.Config.ARGB_8888)
                reusableBitmap = bitmap
            }
            buffer.rewind()
            bitmap.copyPixelsFromBuffer(buffer)

            val frameBitmap = if (rowPadding == 0) {
                bitmap
            } else {
                Bitmap.createBitmap(bitmap, 0, 0, targetWidth, targetHeight)
            }

            val baos = ByteArrayOutputStream()
            frameBitmap.compress(Bitmap.CompressFormat.JPEG, 65, baos)
            val jpegBytes = baos.toByteArray()
            if (frameBitmap !== bitmap) {
                frameBitmap.recycle()
            }

            broadcastFrame(jpegBytes)
        } catch (_: Throwable) {
        } finally {
            image.close()
        }
    }

    private fun broadcastFrame(bytes: ByteArray) {
        if (clients.isEmpty()) return
        val boundaryHeader = "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.size}\r\n\r\n"
        val headerBytes = boundaryHeader.toByteArray(Charsets.US_ASCII)
        val endBytes = "\r\n".toByteArray(Charsets.US_ASCII)
        for (client in clients) {
            try {
                client.write(headerBytes)
                client.write(bytes)
                client.write(endBytes)
                client.flush()
            } catch (_: Throwable) {
                clients.remove(client)
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Трансляция экрана",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Уведомление об активной демонстрации экрана"
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            nm?.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): android.app.Notification {
        val stopIntent = Intent(this, ScreenCaptureService::class.java).apply {
            action = ACTION_STOP
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val stopPendingIntent = PendingIntent.getService(this, 102, stopIntent, flags)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Демонстрация экрана")
            .setContentText("Идет трансляция экрана в звонке")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(R.drawable.ic_notification, "Остановить", stopPendingIntent)
            .build()
    }

    private fun teardown() {
        isStreaming = false
        pendingResultCode = 0
        pendingResultData = null

        for (client in clients) {
            try { client.close() } catch (_: Throwable) {}
        }
        clients.clear()

        try { serverSocket?.close() } catch (_: Throwable) {}
        serverSocket = null

        try { virtualDisplay?.release() } catch (_: Throwable) {}
        virtualDisplay = null

        try { imageReader?.close() } catch (_: Throwable) {}
        imageReader = null

        try { mediaProjection?.stop() } catch (_: Throwable) {}
        mediaProjection = null

        reusableBitmap?.recycle()
        reusableBitmap = null

        handlerThread?.quitSafely()
        handlerThread = null

        MainActivity.instance?.notifyScreenCaptureStoppedNative()
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }
}
