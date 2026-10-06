package org.meowkie.max

import android.content.Context
import android.util.Log
import org.json.JSONObject

data class ContactInfo(
  val name: String?,
  val avatarPath: String?
)

object ContactHelper {
  init {
    try {
      System.loadLibrary("maxplus_lib")
    } catch (e: Throwable) {
      Log.e("MaxPlus", "ContactHelper: Failed to load maxplus_lib", e)
    }
  }

  private external fun getContactInfoNative(account: Long, id: Long, appDir: String): String?

  fun getContactInfo(context: Context, account: Long, id: Long): ContactInfo? {
    if (id <= 0L) return null
    try {
      val jsonStr = getContactInfoNative(account, id, context.applicationInfo.dataDir)
      if (!jsonStr.isNullOrEmpty()) {
        val json = JSONObject(jsonStr)
        val name = if (json.has("name") && !json.isNull("name")) json.getString("name") else null
        val avatarPath = if (json.has("avatarPath") && !json.isNull("avatarPath")) json.getString("avatarPath") else null
        return ContactInfo(name = name, avatarPath = avatarPath)
      }
    } catch (e: Throwable) {
      Log.e("MaxPlus", "getContactInfo error", e)
    }
    return null
  }
}
