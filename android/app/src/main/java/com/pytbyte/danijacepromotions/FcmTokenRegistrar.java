package com.pytbyte.danijacepromotions;

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
 * DANIJACE PROMOTIONS FCM TOKEN REGISTRAR
 * =========================================================
 *
 * Registers this Android installation and its Firebase Cloud
 * Messaging token with the DANIJACE PROMOTIONS backend.
 *
 * The registered device/token is used by the backend to wake
 * the Android SMS outbox worker when new outgoing SMS messages
 * are queued.
 *
 * IMPORTANT:
 *
 * The backend is the source of truth for device registration.
 *
 * This class deliberately does NOT maintain a local
 * "already registered" device/token flag.
 *
 * Why?
 *
 * A device may have previously registered successfully and
 * the corresponding MongoDB document may later be deleted,
 * disabled, or otherwise removed.
 *
 * Local SharedPreferences cannot know that.
 *
 * Therefore every registration attempt sends the current
 * device ID + current FCM token to the backend.
 *
 * The backend uses an upsert:
 *
 *     { upsert: true }
 *
 * so an existing device is updated and a deleted device is
 * recreated automatically.
 *
 * Device identity ALWAYS comes from:
 *
 *     SmsOutboxWorker.getDeviceId(context)
 *
 * This ensures that FCM registration and SMS outbox processing
 * use exactly the same stable device identity.
 *
 * This class is independent of:
 *
 *   - Activity
 *   - WebView
 *   - Capacitor
 *   - JavaScript
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
            "https://danijace-promotions.vercel.app/api/sms/outbox/device";

    private static final String WORKER_TOKEN_HEADER =
            "x-danijace-sms-worker";

    /* =====================================================
       HTTP
    ===================================================== */

    private static final int CONNECT_TIMEOUT_MS =
            15_000;

    private static final int READ_TIMEOUT_MS =
            30_000;

    /* =====================================================
       LOCAL TOKEN STORAGE
    ===================================================== */

    /**
     * We only persist the latest Firebase token.
     *
     * We intentionally do NOT persist:
     *
     *     registered_device_id
     *     registered_token
     *
     * because those values created a local registration cache
     * that could become inconsistent with MongoDB.
     */
    private static final String PREFS_NAME =
            "danijace_fcm_registration";

    private static final String TOKEN_KEY =
            "fcm_token";

    /* =====================================================
       WORKMANAGER
    ===================================================== */

    private static final String REGISTRATION_WORK_NAME =
            "danijace_fcm_device_registration";

    /* =====================================================
       EXECUTOR
    ===================================================== */

    /**
     * Used for immediate backend registration.
     *
     * WorkManager provides durable retry behavior when the
     * immediate request fails.
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
     * MainActivity can safely call:
     *
     *     FcmTokenRegistrar.register(this);
     *
     * repeatedly.
     *
     * Every successful Firebase token retrieval results in a
     * backend registration attempt.
     *
     * There is deliberately NO local "already registered"
     * check here.
     */
    public static void register(
            @NonNull Context context
    ) {

        if (context == null) {

            Log.e(
                    TAG,
                    "REGISTER FAILED: context is null"
            );

            return;
        }

        final Context appContext =
                context.getApplicationContext();

        Log.d(
                TAG,
                "REGISTER STARTED"
        );

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
     *     DanijaceFirebaseMessagingService.onNewToken()
     *
     * and internally after Firebase returns the current
     * token.
     *
     * Every invocation attempts backend registration.
     */
    public static void registerToken(
            Context context,
            String token
    ) {

        if (context == null) {

            Log.e(
                    TAG,
                    "REGISTER TOKEN FAILED: context is null"
            );

            return;
        }

        if (
                token == null ||
                token.trim().isEmpty()
        ) {

            Log.e(
                    TAG,
                    "REGISTER TOKEN FAILED: token is empty"
            );

            return;
        }

        final Context appContext =
                context.getApplicationContext();

        final String cleanToken =
                token.trim();

        /*
         * Persist the latest Firebase token.
         */
        saveToken(
                appContext,
                cleanToken
        );

        Log.d(
                TAG,
                "FCM TOKEN RECEIVED"
        );

        Log.d(
                TAG,
                "FCM token length=" +
                        cleanToken.length()
        );

        /*
         * Do NOT check whether this token was previously
         * registered.
         *
         * The backend is the source of truth.
         *
         * This allows a deleted MongoDB device document to be
         * recreated automatically.
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

        if (context == null) {
            return;
        }

        try {

            Log.d(
                    TAG,
                    "Preparing backend device registration"
            );

            /*
             * IMPORTANT:
             *
             * Never generate another device ID here.
             *
             * FCM registration and SMS outbox processing must
             * use the exact same stable device identity.
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
                        "REGISTRATION FAILED: device ID is empty"
                );

                scheduleRetry(
                        context
                );

                return;
            }

            deviceId =
                    deviceId.trim();

            Log.d(
                    TAG,
                    "Device ID resolved: " +
                            deviceId
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

            Log.d(
                    TAG,
                    "Sending device registration request"
            );

            Log.d(
                    TAG,
                    "Registration URL: " +
                            DEVICE_REGISTRATION_URL
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

                Log.d(
                        TAG,
                        "REGISTRATION SUCCESS"
                );

                Log.d(
                        TAG,
                        "HTTP status=" +
                                response.statusCode
                );

                Log.d(
                        TAG,
                        "Backend response=" +
                                safeResponse(
                                        response.body
                                )
                );

                /*
                 * Do NOT store a local "registered" flag.
                 *
                 * The backend remains the source of truth.
                 */
                return;
            }

            /* =============================================
               SERVER FAILURE
            ============================================= */

            Log.e(
                    TAG,
                    "REGISTRATION FAILED"
            );

            Log.e(
                    TAG,
                    "HTTP status=" +
                            response.statusCode
            );

            Log.e(
                    TAG,
                    "Backend response=" +
                            safeResponse(
                                    response.body
                            )
            );

            scheduleRetry(
                    context
            );

        } catch (Exception exception) {

            /*
             * Network failure, timeout, DNS failure, malformed
             * response, etc.
             *
             * WorkManager will retry the registration.
             */
            Log.e(
                    TAG,
                    "REGISTRATION EXCEPTION",
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
     * Register the most recently persisted Firebase token.
     *
     * This method does NOT perform a local registration check.
     *
     * If the token exists, it is always sent to the backend.
     *
     * If no token exists, Firebase is queried for the current
     * token.
     */
    public static void registerSavedToken(
            Context context
    ) {

        if (context == null) {

            Log.e(
                    TAG,
                    "REGISTER SAVED TOKEN FAILED: context is null"
            );

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

            Log.d(
                    TAG,
                    "No saved FCM token. Requesting current Firebase token."
            );

            requestCurrentFirebaseToken(
                    appContext
            );

            return;
        }

        String cleanToken =
                token.trim();

        Log.d(
                TAG,
                "Saved FCM token found. Registering with backend."
        );

        /*
         * Do not call isRegistered().
         *
         * Always allow the backend to confirm or recreate the
         * device registration.
         */
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
     * the token with the DANIJACE PROMOTIONS backend.
     */
    private static void requestCurrentFirebaseToken(
            Context context
    ) {

        if (context == null) {
            return;
        }

        final Context appContext =
                context.getApplicationContext();

        Log.d(
                TAG,
                "Requesting current FCM token from Firebase"
        );

        FirebaseMessaging
                .getInstance()
                .getToken()
                .addOnCompleteListener(
                        task -> {

                            if (!task.isSuccessful()) {

                                Log.e(
                                        TAG,
                                        "FCM TOKEN REQUEST FAILED",
                                        task.getException()
                                );

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
                                        "FCM TOKEN REQUEST FAILED: Firebase returned empty token"
                                );

                                scheduleRetry(
                                        appContext
                                );

                                return;
                            }

                            Log.d(
                                    TAG,
                                    "FCM TOKEN REQUEST SUCCESS"
                            );

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
         * KEEP prevents multiple simultaneous registration
         * workers from accumulating.
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
             * outbox backend.
             */
            connection.setRequestProperty(
                    WORKER_TOKEN_HEADER,
                    BuildConfig.DANIJACE_SMS_WORKER_TOKEN
            );

            byte[] payload =
                    body.toString()
                            .getBytes(
                                    StandardCharsets.UTF_8
                            );

            Log.d(
                    TAG,
                    "Opening registration HTTP connection"
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

            Log.d(
                    TAG,
                    "Registration request sent. Waiting for response."
            );

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

    /**
     * Prevent enormous server responses from flooding Logcat.
     *
     * We deliberately do not log the FCM token itself.
     */
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
     * It only ensures that the Android installation's current
     * FCM token is registered with DANIJACE PROMOTIONS.
     *
     * IMPORTANT:
     *
     * There is deliberately NO local isRegistered() check.
     *
     * The worker always sends the token to the backend.
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

            Log.d(
                    TAG,
                    "BACKGROUND REGISTRATION WORKER STARTED"
            );

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
                 */
                if (
                        token == null ||
                        token.trim().isEmpty()
                ) {

                    Log.d(
                            TAG,
                            "Background registration: no saved token. Requesting Firebase token."
                    );

                    requestCurrentFirebaseToken(
                            context
                    );

                    /*
                     * Firebase token retrieval is asynchronous.
                     *
                     * The callback will handle registration or
                     * schedule another retry if Firebase fails.
                     */
                    return Result.success();
                }

                token =
                        token.trim();

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
                            "BACKGROUND REGISTRATION FAILED: device ID is empty"
                    );

                    return Result.retry();
                }

                deviceId =
                        deviceId.trim();

                Log.d(
                        TAG,
                        "Background registration device ID: " +
                                deviceId
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

                Log.d(
                        TAG,
                        "Background registration sending HTTP request"
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

                    Log.d(
                            TAG,
                            "BACKGROUND REGISTRATION SUCCESS"
                    );

                    Log.d(
                            TAG,
                            "HTTP status=" +
                                    response.statusCode
                    );

                    Log.d(
                            TAG,
                            "Backend response=" +
                                    safeResponse(
                                            response.body
                                    )
                    );

                    return Result.success();
                }

                Log.e(
                        TAG,
                        "BACKGROUND REGISTRATION FAILED"
                );

                Log.e(
                        TAG,
                        "HTTP status=" +
                                response.statusCode
                );

                Log.e(
                        TAG,
                        "Backend response=" +
                                safeResponse(
                                        response.body
                                )
                );

                return Result.retry();

            } catch (Exception exception) {

                Log.e(
                        TAG,
                        "BACKGROUND REGISTRATION EXCEPTION",
                        exception
                );

                return Result.retry();
            }
        }
    }
}

