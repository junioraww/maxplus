package me.junioraww.max

import android.content.Context
import android.util.Log
import java.util.Collections
import java.util.LinkedHashMap

object NotificationDispatcher {
    private val processedLedger = Collections.synchronizedMap(
        object : LinkedHashMap<String, Long>(128, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean {
                return size > 256
            }
        }
    )

    private val daemonLedger = Collections.synchronizedMap(
        object : LinkedHashMap<String, Long>(128, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean {
                return size > 256
            }
        }
    )

    fun isDuplicate(key: String): Boolean {
        val now = System.currentTimeMillis()
        if (daemonLedger.containsKey(key)) {
            return true
        }
        val prev = processedLedger[key]
        if (prev != null && (now - prev) < 86400000L) {
            return true
        }
        processedLedger[key] = now
        return false
    }

    fun isDaemonDuplicate(key: String): Boolean {
        val now = System.currentTimeMillis()
        val prev = daemonLedger[key]
        if (prev != null && (now - prev) < 86400000L) {
            return true
        }
        daemonLedger[key] = now
        return false
    }

    @JvmStatic
    fun dispatchMessage(
        ctx: Context,
        chatId: Long,
        mid: String,
        text: String,
        senderId: String,
        account: Long,
        senderName: String,
        chatTitle: String,
        isGroup: Boolean
    ) {
        val ledgerKey = "msg_${chatId}_$mid"
        if (mid.isNotEmpty() && isDaemonDuplicate(ledgerKey)) {
            return
        }

        NotificationHelper.showNotificationDirect(
            chatId,
            chatTitle,
            text,
            senderId,
            account,
            senderName,
            isGroup
        )
    }

    @JvmStatic
    fun dispatchMessage(
        ctx: Context,
        chatId: Long,
        mid: String,
        text: String,
        senderId: String,
        account: Long,
        senderName: String,
        isGroup: Boolean
    ) {
        dispatchMessage(
            ctx,
            chatId,
            mid,
            text,
            senderId,
            account,
            senderName,
            senderName,
            isGroup
        )
    }

    @JvmStatic
    fun dispatchIncomingCall(ctx: Context, data: Map<String, String>) {
        val convId = data["conversationId"] ?: data["cid"] ?: data["vcId"] ?: ""
        val ledgerKey = "call_$convId"
        if (convId.isNotEmpty() && isDuplicate(ledgerKey)) {
            return
        }

        CallNotificationManager.showIncomingCallNotification(ctx, data)
    }

    @JvmStatic
    fun dispatchIncomingCallDirect(
        ctx: Context,
        conversationId: String,
        callerId: Long,
        userName: String,
        vcp: String,
        isVideo: Boolean,
        account: Long
    ) {
        val map = HashMap<String, String>()
        map["conversationId"] = conversationId
        map["callerId"] = callerId.toString()
        map["userName"] = userName
        map["title"] = userName
        map["vcp"] = vcp
        map["account_id"] = account.toString()
        map["iv"] = if (isVideo) "true" else "false"
        dispatchIncomingCall(ctx, map)
    }

    @JvmStatic
    fun dispatchCallFinished(ctx: Context, data: Map<String, String>) {
        CallNotificationManager.cancelCallNotification(ctx)
        val conversationId = data["conversationId"] ?: data["cid"] ?: data["vcId"] ?: ""
        val callerId = data["callerId"] ?: data["suid"] ?: ""
        val vcp = data["vcp"] ?: ""
        MainActivity.instance?.let { activity ->
            activity.runOnUiThread {
                activity.forwardCallDismiss(conversationId, callerId, vcp)
            }
        }
    }

    @JvmStatic
    fun dispatchMessageRemoved(ctx: Context, chatId: Long, mid: String) {
        val notifier = NotificationHelper(ctx)
        notifier.handleRemoveMessage(mapOf("mc" to chatId.toString(), "msgid" to mid))
    }

    @JvmStatic
    fun dispatchMessageEdited(ctx: Context, chatId: Long, mid: String, newText: String) {
        val notifier = NotificationHelper(ctx)
        notifier.handleEditMessage(mapOf("mc" to chatId.toString(), "msgid" to mid, "msg" to newText))
    }
}
