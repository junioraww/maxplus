package me.junioraww.max

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DaemonControlReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == MaxBackgroundService.ACTION_STOP_DAEMON) {
            MaxBackgroundService.setEnabled(context, false)
            MaxBackgroundService.stop(context)
        }
    }
}
