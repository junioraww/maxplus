package org.meowkie.max

import android.content.Context
import android.graphics.*
import android.util.Log
import java.io.File
import kotlin.math.abs

object AvatarHelper {
  init {
    try {
      System.loadLibrary("maxplus_lib")
    } catch (e: Throwable) {
      Log.e("MaxPlus", "AvatarHelper: Failed to load maxplus_lib", e)
    }
  }

  private external fun getAvatarPathNative(account: Long, id: Long, appDir: String): String?

  private val COLORS = intArrayOf(
    0xFFE17076.toInt(),
    0xFF7BC862.toInt(),
    0xFF65AADD.toInt(),
    0xFFA695E7.toInt(),
    0xFFEE7AAE.toInt(),
    0xFF6EC9CB.toInt()
  )
  
  fun getAvatar(context: Context, id: Long, name: String, avatarPath: String? = null, account: Long = 0L): Bitmap {
    val path = avatarPath ?: try {
      getAvatarPathNative(account, id, context.applicationInfo.dataDir)
    } catch (e: Throwable) {
      Log.e("MaxPlus", "getAvatarPathNative error", e)
      null
    }

    if (!path.isNullOrEmpty()) {
      val file = File(path)
      if (file.exists()) {
        val bitmap = BitmapFactory.decodeFile(file.absolutePath)
        if (bitmap != null) return getCircularBitmap(bitmap)
      }
    }
    return generateInitialsBitmap(id, name)
  }
  
  private fun generateInitialsBitmap(id: Long, name: String): Bitmap {
    val size = 192
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    
    val colorIndex = ((id % COLORS.size + COLORS.size) % COLORS.size).toInt()
    val color = COLORS[colorIndex]
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      this.color = color
      style = Paint.Style.FILL
    }
    
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    
    val initials = name.trim().split("\\s+".toRegex())
      .take(2)
      .mapNotNull { it.firstOrNull()?.uppercaseChar() }
      .joinToString("")
    
    if (initials.isNotEmpty()) {
      val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = Color.WHITE
        textSize = size / 2.3f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textAlign = Paint.Align.CENTER
      }
      val textBounds = Rect()
      textPaint.getTextBounds(initials, 0, initials.length, textBounds)
      val yPos = (size / 2f) - textBounds.exactCenterY()
      canvas.drawText(initials, size / 2f, yPos, textPaint)
    }
    
    return bitmap
  }
  
  private fun getCircularBitmap(bitmap: Bitmap): Bitmap {
    val size = Math.min(bitmap.width, bitmap.height)
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val rect = Rect(0, 0, size, size)
    
    canvas.drawARGB(0, 0, 0, 0)
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    
    val left = (bitmap.width - size) / 2
    val top = (bitmap.height - size) / 2
    val srcRect = Rect(left, top, left + size, top + size)
    canvas.drawBitmap(bitmap, srcRect, rect, paint)
    
    return output
  }
}