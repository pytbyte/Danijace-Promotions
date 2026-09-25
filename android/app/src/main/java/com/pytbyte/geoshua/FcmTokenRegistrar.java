package com.pytbyte.geoshua;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * =========================================================
 * GEO-SHUA FCM TOKEN REGISTRAR
 * =========================================================
 *
 * Registers this Android installation and its Firebase
 * Cloud Messaging token with the GEO-SHUA backend.
 *
 * The registered device/token is used by the backend to
 * wake the Android SMS outbox worker when new outgoing SMS
 * messages are queued.
 *
 * This class is independent of:
 *
 *   - Activity
 *   - WebView
 *   - Capacitor
 *   - JavaScript
 *
 * Device identity ALWAYS comes from:
 *
 *     SmsOutboxWorker.getDeviceId(context)
 *
 * This ensures that the device ID used for FCM registration
 * is exactly the same device ID used by SmsOutboxWorker.
 *
 * =========================================================
 */
public final class FcmTokenRegistrar {

    private static final String TAG =
            "FcmTokenRegistrar";

    /* =====================================================
       API
    ===================================================== */

    private static final String DEVICE_REGISTRATION_URL =
            "https://geo-shua.vercel.app/api/sms/outbox/device";

    private static final String WORKER_TOKEN_HEADER =
            "x-geoshua-sms-worker";

    /* =====================================================
       HTTP
    ===================================================== */

    private static final int CONNECT_TIMEOUT_MS =
            15_000;

    private static final int READ_TIMEOUT_MS =
            30_000;

    /* =====================================================
       LOCAL STATE
    ===================================================== */

    private static final String PREFS_NAME =
            "geoshua_fcm_registration";

    private static final String TOKEN_KEY =
            "fcm_token";

    private static final String REGISTERED_DEVICE_ID_KEY =
            "registered_device_id";

    private static final String REGISTERED_TOKEN_KEY =
            "registered_token";

    /* =====================================================
       WORKMANAGER
    ===================================================== */

    private static final String REGISTRATION_WORK_NAME =
            "geoshua_fcm_device_registration";

    /* =====================================================
       EXECUTOR
    ===================================================== */

    /**
     * Used for immediate backend registration.
     *
     * WorkManager handles durable retries when the immediate
     * request fails.
     */
    private static final ExecutorService EXECUTOR =
            Executors.newSingleThreadExecutor();

    /* =====================================================
       CONSTRUCTOR
    ===================================================== */

    private FcmTokenRegistrar() {
    }

    /* =====================================================
       PUBLIC REGISTER ENTRY POINT
    ===================================================== */

    /**
     * Register the current Firebase installation.
     *
     * This is the method MainActivity calls:
     *
     *     FcmTokenRegistrar.register(this);
     *
     * It is safe to call repeatedly.
     *
     * Firebase returns the current token. If that token has
     * already been registered for this exact device ID,
     * no unnecessary backend registration is performed.
     *
     * If registration fails, WorkManager is scheduled by
     * the existing retry mechanism.
     */
    public static void register(
            @NonNull Context context
    ) {

        if (context == null) {

            Log.e(
                    TAG,
                    "Cannot register FCM device: context is null"
            );

            return;
        }

        final Context appContext =
                context.getApplicationContext();

        /*
         * Ask Firebase for the current token.
         *
         * This also covers:
         *
         * - first installation
         * - token refreshes
         * - app reinstall
         * - cases where onNewToken() was not observed
         */
        requestCurrentFirebaseToken(
                appContext
        );
    }

    /* =====================================================
       REGISTER TOKEN
    ===================================================== */

    /**
     * Register a specific Firebase token.
     *
     * Called from:
     *
     *     GeoShuaFirebaseMessagingService.onNewToken()
     *
     * It may also be called internally after Firebase
     * returns the current token.
     */
    public static void registerToken(
            Context context,
            String token
    ) {

        if (context == null) {

            Log.e(
                    TAG,
                    "Cannot register FCM token: context is null"
            );

            return;
        }

        if (
                token == null ||
                token.trim().isEmpty()
        ) {

            Log.e(
                    TAG,
                    "Cannot register FCM token: token is empty"
            );

            return;
        }

        final Context appContext =
                context.getApplicationContext();

        final String cleanToken =
                token.trim();

        /*
         * Always persist the latest Firebase token before
         * attempting network registration.
         */
        saveToken(
                appContext,
                cleanToken
        );

        /*
         * If this exact device/token pair has already been
         * successfully registered, there is nothing else
         * to do.
         */
        if (
                isRegistered(
                        appContext,
                        cleanToken
                )
        ) {

            Log.d(
                    TAG,
                    "FCM token is already registered"
            );

            return;
        }

        /*
         * Attempt registration immediately.
         */
        EXECUTOR.execute(
                () -> registerWithBackend(
                        appContext,
                        cleanToken
                )
        );
    }

    /* =====================================================
       REGISTER WITH BACKEND
    ===================================================== */

    private static void registerWithBackend(
            Context context,
            String token
    ) {

        try {

            /*
             * IMPORTANT:
             *
             * Never generate a second device ID here.
             *
             * FCM registration and SMS outbox must use the
             * exact same stable device identity.
             */
            String deviceId =
                    SmsOutboxWorker.getDeviceId(
                            context
                    );

            if (
                    deviceId == null ||
                    deviceId.trim().isEmpty()
            ) {

                Log.e(
                        TAG,
                        "Unable to register FCM token: device ID is empty"
                );

                scheduleRetry(
                        context
                );

                return;
            }

            /*
             * Another registration may have succeeded while
             * this request was running.
             */
            if (
                    isRegistered(
                            context,
                            token
                    )
            ) {

                return;
            }

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

            HttpResponse response =
                    postJson(
                            DEVICE_REGISTRATION_URL,
                            body
                    );

            /* =============================================
               SUCCESS
            ============================================= */

            if (
                    response.statusCode >= 200 &&
                    response.statusCode < 300
            ) {

                markRegistered(
                        context,
                        deviceId,
                        token
                );

                Log.d(
                        TAG,
                        "FCM device registration successful"
                );

                return;
            }

            /* =============================================
               SERVER FAILURE
            ============================================= */

            Log.e(
                    TAG,
                    "FCM device registration failed. HTTP " +
                            response.statusCode +
                            " response=" +
                            safeResponse(
                                    response.body
                            )
            );

            scheduleRetry(
                    context
            );

        } catch (Exception exception) {

            /*
             * Network failure, timeout, DNS failure, etc.
             *
             * The token remains persisted.
             *
             * WorkManager will retry registration.
             */
            Log.e(
                    TAG,
                    "FCM device registration error",
                    exception
            );

            scheduleRetry(
                    context
            );
        }
    }

    /* =====================================================
       REGISTER SAVED TOKEN
    ===================================================== */

    /**
     * Register a previously persisted Firebase token.
     *
     * Useful during startup and from the background worker.
     */
    public static void registerSavedToken(
            Context context
    ) {

        if (context == null) {
            return;
        }

        Context appContext =
                context.getApplicationContext();

        SharedPreferences preferences =
                getPreferences(
                        appContext
                );

        String token =
                preferences.getString(
                        TOKEN_KEY,
                        null
                );

        if (
                token == null ||
                token.trim().isEmpty()
        ) {

            /*
             * No token has been persisted yet.
             *
             * Ask Firebase for the current token.
             */
            requestCurrentFirebaseToken(
                    appContext
            );

            return;
        }

        String cleanToken =
                token.trim();

        if (
                isRegistered(
                        appContext,
                        cleanToken
                )
        ) {

            return;
        }

        registerToken(
                appContext,
                cleanToken
        );
    }

    /* =====================================================
       GET CURRENT FIREBASE TOKEN
    ===================================================== */

    /**
     * Obtain the current Firebase token.
     *
     * Firebase owns token generation and refresh.
     *
     * Once obtained, registerToken() persists and registers
     * the token with the GEO-SHUA backend.
     */
    private static void requestCurrentFirebaseToken(
            Context context
    ) {

        if (context == null) {
            return;
        }

        final Context appContext =
                context.getApplicationContext();

        FirebaseMessaging
                .getInstance()
                .getToken()
                .addOnCompleteListener(
                        task -> {

                            if (!task.isSuccessful()) {

                                Log.e(
                                        TAG,
                                        "Unable to obtain current FCM token",
                                        task.getException()
                                );

                                /*
                                 * The token may become available
                                 * later. Keep registration durable.
                                 */
                                scheduleRetry(
                                        appContext
                                );

                                return;
                            }

                            String token =
                                    task.getResult();

                            if (
                                    token == null ||
                                    token.trim().isEmpty()
                            ) {

                                Log.e(
                                        TAG,
                                        "Firebase returned an empty FCM token"
                                );

                                scheduleRetry(
                                        appContext
                                );

                                return;
                            }

                            registerToken(
                                    appContext,
                                    token
                            );
                        }
                );
    }

    /* =====================================================
       BACKGROUND RETRY
    ===================================================== */

    /**
     * Schedule durable registration retry.
     *
     * WorkManager can execute this even when the application
     * UI is closed.
     */
    private static void scheduleRetry(
            Context context
    ) {

        if (context == null) {
            return;
        }

        Context appContext =
                context.getApplicationContext();

        Constraints constraints =
                new Constraints.Builder()
                        .setRequiredNetworkType(
                                NetworkType.CONNECTED
                        )
                        .build();

        OneTimeWorkRequest request =
                new OneTimeWorkRequest.Builder(
                        FcmRegistrationWorker.class
                )
                        .setConstraints(
                                constraints
                        )
                        .setBackoffCriteria(
                                BackoffPolicy.EXPONENTIAL,
                                30,
                                TimeUnit.SECONDS
                        )
                        .build();

        /*
         * KEEP prevents repeated failures from creating
         * many simultaneous registration workers.
         */
        WorkManager
                .getInstance(
                        appContext
                )
                .enqueueUniqueWork(
                        REGISTRATION_WORK_NAME,
                        ExistingWorkPolicy.KEEP,
                        request
                );

        Log.d(
                TAG,
                "FCM registration retry scheduled"
        );
    }

    /* =====================================================
       CHECK REGISTRATION
    ===================================================== */

    /**
     * Returns true only when both:
     *
     *   - device ID matches
     *   - FCM token matches
     *
     * the last successfully registered pair.
     */
    public static boolean isRegistered(
            Context context,
            String token
    ) {

        if (
                context == null ||
                token == null ||
                token.trim().isEmpty()
        ) {

            return false;
        }

        Context appContext =
                context.getApplicationContext();

        SharedPreferences preferences =
                getPreferences(
                        appContext
                );

        String deviceId =
                SmsOutboxWorker.getDeviceId(
                        appContext
                );

        String registeredDeviceId =
                preferences.getString(
                        REGISTERED_DEVICE_ID_KEY,
                        null
                );

        String registeredToken =
                preferences.getString(
                        REGISTERED_TOKEN_KEY,
                        null
                );

        return deviceId.equals(
                registeredDeviceId
        ) &&
                token.trim().equals(
                        registeredToken
                );
    }

    /* =====================================================
       SAVE TOKEN
    ===================================================== */

    private static void saveToken(
            Context context,
            String token
    ) {

        getPreferences(
                context
        )
                .edit()
                .putString(
                        TOKEN_KEY,
                        token
                )
                .apply();
    }

    /* =====================================================
       MARK REGISTERED
    ===================================================== */

    private static void markRegistered(
            Context context,
            String deviceId,
            String token
    ) {

        getPreferences(
                context
        )
                .edit()
                .putString(
                        REGISTERED_DEVICE_ID_KEY,
                        deviceId
                )
                .putString(
                        REGISTERED_TOKEN_KEY,
                        token
                )
                .apply();
    }

    /* =====================================================
       PREFERENCES
    ===================================================== */

    private static SharedPreferences getPreferences(
            Context context
    ) {

        return context
                .getApplicationContext()
                .getSharedPreferences(
                        PREFS_NAME,
                        Context.MODE_PRIVATE
                );
    }

    /* =====================================================
       HTTP POST
    ===================================================== */

    private static HttpResponse postJson(
            String urlString,
            JSONObject body
    ) throws Exception {

        HttpURLConnection connection =
                null;

        try {

            URL url =
                    new URL(
                            urlString
                    );

            connection =
                    (HttpURLConnection)
                            url.openConnection();

            connection.setRequestMethod(
                    "POST"
            );

            connection.setConnectTimeout(
                    CONNECT_TIMEOUT_MS
            );

            connection.setReadTimeout(
                    READ_TIMEOUT_MS
            );

            connection.setDoOutput(
                    true
            );

            connection.setUseCaches(
                    false
            );

            connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
            );

            connection.setRequestProperty(
                    "Accept",
                    "application/json"
            );

            /*
             * Same worker authentication used by the SMS
             * outbox system.
             */
            connection.setRequestProperty(
                    WORKER_TOKEN_HEADER,
                    BuildConfig.GEO_SHUA_SMS_WORKER_TOKEN
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

                output.write(
                        payload
                );

                output.flush();
            }

            int statusCode =
                    connection.getResponseCode();

            InputStream stream;

            if (
                    statusCode >= 200 &&
                    statusCode < 400
            ) {

                stream =
                        connection.getInputStream();

            } else {

                stream =
                        connection.getErrorStream();
            }

            String responseBody =
                    readStream(
                            stream
                    );

            return new HttpResponse(
                    statusCode,
                    responseBody
            );

        } finally {

            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /* =====================================================
       READ RESPONSE
    ===================================================== */

    private static String readStream(
            InputStream stream
    ) throws Exception {

        if (stream == null) {
            return "";
        }

        StringBuilder result =
                new StringBuilder();

        try (
                BufferedReader reader =
                        new BufferedReader(
                                new InputStreamReader(
                                        stream,
                                        StandardCharsets.UTF_8
                                )
                        )
        ) {

            String line;

            while (
                    (line = reader.readLine())
                            != null
            ) {

                result.append(
                        line
                );
            }
        }

        return result.toString();
    }

    /* =====================================================
       SAFE RESPONSE
    ===================================================== */

    private static String safeResponse(
            String response
    ) {

        if (
                response == null ||
                response.trim().isEmpty()
        ) {

            return "";
        }

        String value =
                response.trim();

        if (value.length() > 500) {

            return value.substring(
                    0,
                    500
            );
        }

        return value;
    }

    /* =====================================================
       HTTP RESPONSE
    ===================================================== */

    private static final class HttpResponse {

        final int statusCode;

        final String body;

        HttpResponse(
                int statusCode,
                String body
        ) {

            this.statusCode =
                    statusCode;

            this.body =
                    body;
        }
    }

    /* =====================================================
       BACKGROUND REGISTRATION WORKER
    ===================================================== */

    /**
     * Durable FCM registration worker.
     *
     * This worker does NOT send SMS.
     *
     * It only ensures that the Android installation's
     * current FCM token is registered with GEO-SHUA.
     */
    public static class FcmRegistrationWorker
            extends Worker {

        public FcmRegistrationWorker(
                @NonNull Context context,
                @NonNull WorkerParameters params
        ) {

            super(
                    context,
                    params
            );
        }

        @NonNull
        @Override
        public Result doWork() {

            Context context =
                    getApplicationContext();

            try {

                SharedPreferences preferences =
                        getPreferences(
                                context
                        );

                String token =
                        preferences.getString(
                                TOKEN_KEY,
                                null
                        );

                /*
                 * No locally saved token.
                 *
                 * Ask Firebase for the current token.
                 *
                 * The Firebase callback will eventually call
                 * registerToken().
                 */
                if (
                        token == null ||
                        token.trim().isEmpty()
                ) {

                    requestCurrentFirebaseToken(
                            context
                    );

                    /*
                     * Firebase token retrieval is asynchronous.
                     *
                     * Do not retry immediately here because the
                     * callback itself will schedule another retry
                     * if Firebase fails.
                     */
                    return Result.success();
                }

                token =
                        token.trim();

                /*
                 * Already registered for this exact device/token.
                 */
                if (
                        isRegistered(
                                context,
                                token
                        )
                ) {

                    return Result.success();
                }

                /*
                 * Device ID must remain identical to the ID used
                 * by SmsOutboxWorker.
                 */
                String deviceId =
                        SmsOutboxWorker.getDeviceId(
                                context
                        );

                if (
                        deviceId == null ||
                        deviceId.trim().isEmpty()
                ) {

                    Log.e(
                            TAG,
                            "Background registration: device ID is empty"
                    );

                    return Result.retry();
                }

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

                HttpResponse response =
                        postJson(
                                DEVICE_REGISTRATION_URL,
                                body
                        );

                /*
                 * Successful HTTP response means the backend
                 * accepted the device registration.
                 */
                if (
                        response.statusCode >= 200 &&
                        response.statusCode < 300
                ) {

                    markRegistered(
                            context,
                            deviceId,
                            token
                    );

                    Log.d(
                            TAG,
                            "Background FCM registration successful"
                    );

                    return Result.success();
                }

                Log.e(
                        TAG,
                        "Background FCM registration failed. HTTP " +
                                response.statusCode +
                                " response=" +
                                safeResponse(
                                        response.body
                                )
                );

                return Result.retry();

            } catch (Exception exception) {

                Log.e(
                        TAG,
                        "Background FCM registration error",
                        exception
                );

                return Result.retry();
            }
        }
    }
}
