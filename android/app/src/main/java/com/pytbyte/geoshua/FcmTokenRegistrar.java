package com.pytbyte.geoshua;

import android.content.Context;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class FcmTokenRegistrar {

    private static final String TAG = "GeoShuaFCM";

    private static final String REGISTER_URL =
            "https://geo-shua.vercel.app/api/sms/outbox/device";

    private FcmTokenRegistrar() {
    }

    /**
     * Obtains the current FCM token and registers it
     * against this Android device.
     */
    public static void register(Context context) {
        Context appContext =
                context.getApplicationContext();

        FirebaseMessaging.getInstance()
                .getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful()) {
                        Log.e(
                                TAG,
                                "Unable to obtain FCM token.",
                                task.getException()
                        );
                        return;
                    }

                    String token = task.getResult();

                    if (token == null || token.trim().isEmpty()) {
                        Log.e(
                                TAG,
                                "FCM token is empty."
                        );
                        return;
                    }

                    registerToken(
                            appContext,
                            token.trim()
                    );
                });
    }

    /**
     * Registers a known FCM token.
     *
     * Used both during application startup and when
     * Firebase reports that the token has changed.
     */
    public static void registerToken(
            Context context,
            String token
    ) {
        if (token == null || token.trim().isEmpty()) {
            return;
        }

        String deviceId =
                SmsOutboxWorker.getDeviceId(
                        context.getApplicationContext()
                );

        if (deviceId == null || deviceId.trim().isEmpty()) {
            Log.e(
                    TAG,
                    "Unable to register FCM token: device ID is empty."
            );
            return;
        }

        String normalizedToken =
                token.trim();

        Thread thread = new Thread(
                () -> registerDevice(
                        deviceId,
                        normalizedToken
                ),
                "GeoShua-FCM-Registration"
        );

        thread.start();
    }

    private static void registerDevice(
            String deviceId,
            String token
    ) {
        HttpURLConnection connection = null;

        try {
            URL url =
                    new URL(REGISTER_URL);

            connection =
                    (HttpURLConnection) url.openConnection();

            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(15_000);
            connection.setDoOutput(true);

            connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
            );

            connection.setRequestProperty(
                    "Accept",
                    "application/json"
            );

            connection.setRequestProperty(
                    "x-geoshua-sms-worker",
                    BuildConfig.GEO_SHUA_SMS_WORKER_TOKEN
            );

            JSONObject body =
                    new JSONObject();

            body.put(
                    "deviceId",
                    deviceId
            );

            body.put(
                    "token",
                    token
            );

            body.put(
                    "platform",
                    "android"
            );

            byte[] payload =
                    body.toString()
                            .getBytes(
                                    StandardCharsets.UTF_8
                            );

            try (
                    OutputStream output =
                            connection.getOutputStream()
            ) {
                output.write(payload);
                output.flush();
            }

            int status =
                    connection.getResponseCode();

            if (status < 200 || status >= 300) {
                Log.e(
                        TAG,
                        "FCM device registration failed: HTTP " +
                                status
                );
                return;
            }

            Log.d(
                    TAG,
                    "FCM device registered: " +
                            deviceId
            );

        } catch (Exception exception) {
            Log.e(
                    TAG,
                    "FCM device registration error.",
                    exception
            );
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }
}