package com.pytbyte.danijacepromotions;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Receives Firebase Cloud Messaging events for DANIJACE PROMOTIONS.
 *
 * IMPORTANT:
 *
 * This service is intentionally independent of:
 *
 * - Activity
 * - WebView
 * - Capacitor
 * - JavaScript
 * - foreground UI
 *
 * FCM is only used as a wake-up signal.
 *
 * The actual SMS processing is performed by
 * SmsOutboxWorker.
 */
public class DanijaceFirebaseMessagingService
        extends FirebaseMessagingService {

    private static final String TAG =
            "DanijaceFCM";

    /*
     * Event sent by the DANIJACE PROMOTIONS backend when there
     * are SMS messages waiting in the outbox.
     */
    private static final String EVENT_SMS_OUTBOX =
            "sms_outbox";

    /*
     * =========================================================
     * FCM MESSAGE
     * =========================================================
     */

    @Override
    public void onMessageReceived(
            @NonNull RemoteMessage remoteMessage
    ) {

        super.onMessageReceived(
                remoteMessage
        );

        Log.d(
                TAG,
                "FCM message received"
        );

        /*
         * We intentionally expect a DATA-ONLY message.
         *
         * Example:
         *
         * {
         *     "event": "sms_outbox"
         * }
         */

        if (
                remoteMessage.getData() == null ||
                remoteMessage.getData().isEmpty()
        ) {

            Log.d(
                    TAG,
                    "Ignoring FCM message with no data"
            );

            return;
        }

        String event =
                remoteMessage
                        .getData()
                        .get("event");

        Log.d(
                TAG,
                "FCM event: " + event
        );

        /*
         * Ignore all events that are unrelated to the
         * SMS outbox.
         */

        if (!EVENT_SMS_OUTBOX.equals(event)) {

            Log.d(
                    TAG,
                    "Ignoring unrelated FCM event"
            );

            return;
        }

        /*
         * =====================================================
         * WAKE SMS OUTBOX
         * =====================================================
         *
         * Do NOT:
         *
         * - start an Activity
         * - open the WebView
         * - execute JavaScript
         * - use Capacitor
         * - send SMS directly from this service
         *
         * Just ask WorkManager to run SmsOutboxWorker.
         */

        wakeSmsOutboxWorker();
    }

    /*
     * =========================================================
     * WAKE WORKER
     * =========================================================
     */

    private void wakeSmsOutboxWorker() {

        try {

            Context context =
                    getApplicationContext();

            /*
             * SmsOutboxWorker owns the WorkManager
             * scheduling logic.
             *
             * This prevents FCM and the worker from having
             * two different scheduling implementations.
             */

            SmsOutboxWorker.enqueueNow(
                    context
            );

            Log.d(
                    TAG,
                    "SMS outbox worker wake requested"
            );

        } catch (Exception exception) {

            /*
             * Never allow an FCM processing failure to
             * crash the Firebase service.
             *
             * The persistent WorkManager fallback can
             * still process the outbox later.
             */

            Log.e(
                    TAG,
                    "Unable to wake SMS outbox worker",
                    exception
            );
        }
    }

    /*
     * =========================================================
     * TOKEN REFRESH
     * =========================================================
     *
     * Firebase can rotate the FCM token.
     *
     * Whenever that happens, immediately register the
     * new token with the DANIJACE PROMOTIONS backend.
     */

    @Override
    public void onNewToken(
            @NonNull String token
    ) {

        super.onNewToken(
                token
        );

        Log.d(
                TAG,
                "FCM token refreshed"
        );

        try {

            FcmTokenRegistrar.registerToken(
                    getApplicationContext(),
                    token
            );

        } catch (Exception exception) {

            /*
             * Token registration failure must not crash
             * FirebaseMessagingService.
             *
             * FcmTokenRegistrar keeps the token locally,
             * allowing registration to be retried later.
             */

            Log.e(
                    TAG,
                    "Unable to register refreshed FCM token",
                    exception
            );
        }
    }
}
