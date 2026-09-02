package com.pytbyte.geoshua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * =========================================================
 * GEO-SHUA
 * SMS RECOVERY BOOT RECEIVER
 * =========================================================
 *
 * Restores the hourly SMS recovery alarm after:
 *
 * - device boot
 * - application replacement/update
 */
public class SmsBootReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsBoot";

    @Override
    public void onReceive(
        Context context,
        Intent intent
    ) {
        if (context == null) {
            return;
        }

        if (intent == null) {
            return;
        }

        String action =
            intent.getAction();

        if (
            Intent.ACTION_BOOT_COMPLETED.equals(
                action
            )
            ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(
                action
            )
        ) {

            Log.d(
                TAG,
                "System event received: "
                    + action
                    + ". Scheduling SMS recovery."
            );

            SmsSweepReceiver.schedule(
                context
            );
        }
    }
}
