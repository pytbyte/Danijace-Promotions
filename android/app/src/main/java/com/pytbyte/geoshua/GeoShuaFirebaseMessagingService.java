package com.pytbyte.geoshua;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.concurrent.TimeUnit;

public class GeoShuaFirebaseMessagingService
        extends FirebaseMessagingService {

    private static final String TAG = "GeoShuaFCM";

    private static final String SMS_WAKE_WORK_NAME =
            "geoshua_sms_outbox_fcm";

    @Override
    public void onMessageReceived(
            @NonNull RemoteMessage remoteMessage
    ) {
        Log.d(
                TAG,
                "FCM message received."
        );

        Map<String, String> data =
                remoteMessage.getData();

        if (data == null || data.isEmpty()) {
            Log.d(
                    TAG,
                    "FCM message has no data."
            );
            return;
        }

        String event =
                data.get("event");

        if (!"sms_outbox".equals(event)) {
            Log.d(
                    TAG,
                    "Ignoring unknown FCM event: " +
                            event
            );
            return;
        }

        scheduleSmsWorker(
                getApplicationContext()
        );
    }

    @Override
    public void onNewToken(
            @NonNull String token
    ) {
        super.onNewToken(token);

        Log.d(
                TAG,
                "FCM token refreshed."
        );

        FcmTokenRegistrar.registerToken(
                getApplicationContext(),
                token
        );
    }

    private void scheduleSmsWorker(
            Context context
    ) {
        Constraints constraints =
                new Constraints.Builder()
                        .setRequiredNetworkType(
                                NetworkType.CONNECTED
                        )
                        .build();

        OneTimeWorkRequest request =
                new OneTimeWorkRequest.Builder(
                        SmsOutboxWorker.class
                )
                        .setConstraints(constraints)
                        .setBackoffCriteria(
                                BackoffPolicy.EXPONENTIAL,
                                10,
                                TimeUnit.SECONDS
                        )
                        .build();

        WorkManager
                .getInstance(context)
                .enqueueUniqueWork(
                        SMS_WAKE_WORK_NAME,
                        ExistingWorkPolicy.KEEP,
                        request
                );
    }
}