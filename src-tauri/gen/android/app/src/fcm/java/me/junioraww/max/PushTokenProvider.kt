package me.junioraww.max

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object PushTokenProvider {
    @JvmStatic
    fun getPushToken(context: Context?): String? {
        val ctx = context ?: MainActivity.getApplicationContextStatic()
        val cached = ctx?.getSharedPreferences("maxplus_push", Context.MODE_PRIVATE)
            ?.getString("fcm_token", null)
        if (!cached.isNullOrEmpty()) {
            return cached
        }

        var tokenResult: String? = null
        val latch = CountDownLatch(1)
        try {
            FirebaseMessaging.getInstance().token
                .addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        tokenResult = task.result
                        if (ctx != null && tokenResult != null) {
                            try {
                                ctx.getSharedPreferences("maxplus_push", Context.MODE_PRIVATE)
                                    .edit()
                                    .putString("fcm_token", tokenResult)
                                    .apply()
                            } catch (_: Throwable) {}
                        }
                    }
                    latch.countDown()
                }
            latch.await(5, TimeUnit.SECONDS)
        } catch (e: Throwable) {
            Log.e("MaxPlus", "PushTokenProvider getPushToken error", e)
        }
        return tokenResult
    }
}
