package com.pytbyte.danijacepromotions;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.telephony.SmsManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

public class SmsOutboxWorker extends Worker {

    private static final String TAG =
            "SmsOutboxWorker";

    /*
     * =========================================================
     * CONFIGURATION
     * =========================================================
     */

    private static final String API_BASE_URL =
            "https://danijace-promotions.vercel.app";

    private static final String CLAIM_URL =
            API_BASE_URL + "/api/sms/outbox/claim";

    private static final String RESULT_URL =
            API_BASE_URL + "/api/sms/outbox/result";

    private static final int CLAIM_LIMIT = 10;

    private static final int CONNECT_TIMEOUT_MS =
            15_000;

    private static final int READ_TIMEOUT_MS =
            30_000;

    private static final String PREFS_NAME =
            "danijace_sms_worker";

    private static final String DEVICE_ID_KEY =
            "device_id";

    /*
     * Unique work names.
     */

    private static final String IMMEDIATE_WORK_NAME =
            "danijace_sms_outbox_now";

    private static final String PERIODIC_WORK_NAME =
            "danijace_sms_outbox";

    /*
     * =========================================================
     * CONSTRUCTOR
     * =========================================================
     */

    public SmsOutboxWorker(
            @NonNull Context context,
            @NonNull WorkerParameters workerParams
    ) {
        super(
                context,
                workerParams
        );
    }

    /*
     * =========================================================
     * WORK
     * =========================================================
     */

    @NonNull
    @Override
    public Result doWork() {

        Context context =
                getApplicationContext();

        String deviceId =
                getDeviceId(context);

        Log.d(
                TAG,
                "SMS outbox worker started. deviceId=" +
                        deviceId
        );

        try {

            /*
             * =================================================
             * CLAIM
             * =================================================
             */

            ClaimResponse claim =
                    claimMessages(deviceId);

            if (!claim.success) {

                Log.e(
                        TAG,
                        "Unable to claim SMS outbox messages"
                );

                return Result.retry();
            }

            /*
             * Nothing waiting.
             */

            if (
                    claim.messages == null ||
                    claim.messages.length() == 0
            ) {

                Log.d(
                        TAG,
                        "SMS outbox is empty"
                );

                return Result.success();
            }

            Log.d(
                    TAG,
                    "Claimed " +
                            claim.messages.length() +
                            " SMS message(s)"
            );

            boolean reportFailure =
                    false;

            /*
             * =================================================
             * PROCESS CLAIMED MESSAGES
             * =================================================
             */

            for (
                    int i = 0;
                    i < claim.messages.length();
                    i++
            ) {

                /*
                 * If Android stops this worker, stop processing
                 * immediately.
                 */

                if (isStopped()) {

                    Log.w(
                            TAG,
                            "Worker stopped while processing SMS"
                    );

                    return Result.retry();
                }

                JSONObject sms =
                        claim.messages.getJSONObject(i);

                String smsId =
                        sms.optString(
                                "id",
                                ""
                        ).trim();

                String recipient =
                        sms.optString(
                                "recipient",
                                ""
                        ).trim();

                String message =
                        sms.optString(
                                "message",
                                ""
                        );

                /*
                 * =================================================
                 * VALIDATE CLAIMED RECORD
                 * =================================================
                 */

                if (
                        smsId.isEmpty() ||
                        recipient.isEmpty() ||
                        message.trim().isEmpty()
                ) {

                    Log.e(
                            TAG,
                            "Malformed SMS outbox record. smsId=" +
                                    smsId
                    );

                    /*
                     * Do not leave malformed records permanently
                     * stuck in processing.
                     */

                    if (!smsId.isEmpty()) {

                        boolean reported =
                                reportResult(
                                        deviceId,
                                        smsId,
                                        "failed",
                                        null,
                                        "SMS outbox record is missing recipient or message."
                                );

                        if (!reported) {
                            reportFailure = true;
                        }
                    }

                    continue;
                }

                /*
                 * =================================================
                 * SEND SMS NATIVELY
                 * =================================================
                 *
                 * This deliberately does NOT depend on:
                 *
                 * - Capacitor
                 * - WebView
                 * - MainActivity
                 * - SmsSenderPlugin
                 *
                 * The worker can therefore operate while the
                 * application UI is completely closed.
                 */

                Log.d(
                        TAG,
                        "Sending SMS. smsId=" +
                                smsId +
                                " recipient=" +
                                maskPhone(recipient)
                );

                SendResult sendResult =
                        sendSms(
                                context,
                                recipient,
                                message
                        );

                /*
                 * =================================================
                 * SMS ACCEPTED BY ANDROID
                 * =================================================
                 */

                if (sendResult.success) {

                    Log.d(
                            TAG,
                            "SMS accepted by Android. smsId=" +
                                    smsId
                    );

                    boolean reported =
                            reportResult(
                                    deviceId,
                                    smsId,
                                    "sent",
                                    "android-sms-accepted",
                                    null
                            );

                    if (!reported) {

                        /*
                         * The SMS may already have been accepted
                         * by Android. We still retry reporting so
                         * the backend can eventually reconcile it.
                         */

                        Log.e(
                                TAG,
                                "Unable to report successful SMS. smsId=" +
                                        smsId
                        );

                        reportFailure = true;
                    }

                } else {

                    /*
                     * =================================================
                     * SMS FAILED LOCALLY
                     * =================================================
                     */

                    Log.e(
                            TAG,
                            "SMS failed. smsId=" +
                                    smsId +
                                    " error=" +
                                    sendResult.error
                    );

                    boolean reported =
                            reportResult(
                                    deviceId,
                                    smsId,
                                    "failed",
                                    null,
                                    sendResult.error
                            );

                    if (!reported) {
                        reportFailure = true;
                    }
                }
            }

            /*
             * =================================================
             * REPORTING FAILURE
             * =================================================
             *
             * If backend reporting failed, retry the worker.
             *
             * The server-side claim timeout/recovery mechanism
             * is responsible for messages that remain in a
             * processing state.
             */

            if (reportFailure) {

                Log.w(
                        TAG,
                        "At least one SMS result could not be reported"
                );

                return Result.retry();
            }

            Log.d(
                    TAG,
                    "SMS outbox worker completed successfully"
            );

            return Result.success();

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "SMS outbox worker failed",
                    exception
            );

            return Result.retry();
        }
    }

    /*
     * =========================================================
     * FCM WAKE
     * =========================================================
     *
     * Called by DanijaceFirebaseMessagingService when the
     * backend sends:
     *
     *     event=sms_outbox
     *
     * This does NOT require the application UI to be open.
     *
     * FCM wakes the Android process.
     * WorkManager performs the actual SMS work.
     */

    public static void enqueueNow(
            Context context
    ) {

        if (context == null) {
            Log.e(
                    TAG,
                    "enqueueNow called with null context"
            );
            return;
        }

        Context applicationContext =
                context.getApplicationContext();

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
         * KEEP is intentional.
         *
         * If an SMS worker is already running, another FCM
         * notification should not cancel and replace it.
         *
         * The existing worker claims multiple messages in
         * one run.
         */

        WorkManager
                .getInstance(applicationContext)
                .enqueueUniqueWork(
                        IMMEDIATE_WORK_NAME,
                        ExistingWorkPolicy.KEEP,
                        request
                );

        Log.d(
                TAG,
                "SMS outbox worker wake requested"
        );
    }

    /*
     * =========================================================
     * WORKMANAGER SCHEDULING
     * =========================================================
     *
     * Called from MainActivity:
     *
     *     SmsOutboxWorker.schedule(this);
     *
     * This registers:
     *
     * 1. An immediate check.
     * 2. A persistent 15-minute fallback.
     *
     * The periodic worker is important because FCM is a wake-up
     * mechanism, not an absolute delivery guarantee.
     */

    public static void schedule(
            Context context
    ) {

        if (context == null) {
            return;
        }

        Context applicationContext =
                context.getApplicationContext();

        Constraints constraints =
                new Constraints.Builder()
                        .setRequiredNetworkType(
                                NetworkType.CONNECTED
                        )
                        .build();

        /*
         * =====================================================
         * IMMEDIATE CHECK
         * =====================================================
         */

        OneTimeWorkRequest immediateWork =
                new OneTimeWorkRequest.Builder(
                        SmsOutboxWorker.class
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

        WorkManager
                .getInstance(applicationContext)
                .enqueueUniqueWork(
                        IMMEDIATE_WORK_NAME,
                        ExistingWorkPolicy.KEEP,
                        immediateWork
                );

        /*
         * =====================================================
         * PERIODIC FALLBACK
         * =====================================================
         *
         * Android requires at least 15 minutes for periodic
         * WorkManager work.
         *
         * KEEP means we do not recreate the periodic worker
         * every time MainActivity starts.
         */

        PeriodicWorkRequest periodicWork =
                new PeriodicWorkRequest.Builder(
                        SmsOutboxWorker.class,
                        15,
                        TimeUnit.MINUTES
                )
                        .setConstraints(
                                constraints
                        )
                        .build();

        WorkManager
                .getInstance(applicationContext)
                .enqueueUniquePeriodicWork(
                        PERIODIC_WORK_NAME,
                        ExistingPeriodicWorkPolicy.KEEP,
                        periodicWork
                );

        Log.d(
                TAG,
                "SMS outbox background scheduling registered"
        );
    }

    /*
     * =========================================================
     * DEVICE ID
     * =========================================================
     *
     * Stable for this Android installation.
     *
     * Shared by:
     *
     * - SmsOutboxWorker
     * - FcmTokenRegistrar
     *
     * This is important because the backend must see the same
     * device identity when:
     *
     * 1. Registering the FCM token.
     * 2. Claiming SMS messages.
     */

    public static synchronized String getDeviceId(
            Context context
    ) {

        Context applicationContext =
                context.getApplicationContext();

        SharedPreferences preferences =
                applicationContext.getSharedPreferences(
                        PREFS_NAME,
                        Context.MODE_PRIVATE
                );

        String deviceId =
                preferences.getString(
                        DEVICE_ID_KEY,
                        null
                );

        if (
                deviceId != null &&
                !deviceId.trim().isEmpty()
        ) {
            return deviceId.trim();
        }

        deviceId =
                "android-" +
                        UUID.randomUUID()
                                .toString();

        preferences
                .edit()
                .putString(
                        DEVICE_ID_KEY,
                        deviceId
                )
                .apply();

        Log.d(
                TAG,
                "Created new SMS worker device ID"
        );

        return deviceId;
    }

    /*
     * =========================================================
     * CLAIM
     * =========================================================
     */

    private ClaimResponse claimMessages(
            String deviceId
    ) throws Exception {

        JSONObject body =
                new JSONObject();

        body.put(
                "deviceId",
                deviceId
        );

        body.put(
                "limit",
                CLAIM_LIMIT
        );

        HttpResponse response =
                postJson(
                        CLAIM_URL,
                        body
                );

        if (
                response.statusCode < 200 ||
                response.statusCode >= 300
        ) {

            Log.e(
                    TAG,
                    "SMS claim failed. HTTP " +
                            response.statusCode
            );

            return new ClaimResponse(
                    false,
                    new JSONArray()
            );
        }

        JSONObject json =
                new JSONObject(
                        response.body
                );

        boolean success =
                json.optBoolean(
                        "success",
                        false
                );

        JSONArray messages =
                json.optJSONArray(
                        "messages"
                );

        if (messages == null) {
            messages =
                    new JSONArray();
        }

        return new ClaimResponse(
                success,
                messages
        );
    }

    /*
     * =========================================================
     * SEND SMS
     * =========================================================
     */

    private SendResult sendSms(
            Context context,
            String phone,
            String message
    ) {

        /*
         * =====================================================
         * PERMISSION
         * =====================================================
         */

        if (
                ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.SEND_SMS
                )
                        != PackageManager.PERMISSION_GRANTED
        ) {

            return SendResult.failure(
                    "SEND_SMS permission is not granted."
            );
        }

        /*
         * =====================================================
         * PHONE
         * =====================================================
         */

        String normalizedPhone =
                normalizePhone(phone);

        if (normalizedPhone.isEmpty()) {

            return SendResult.failure(
                    "Recipient phone number is empty."
            );
        }

        /*
         * =====================================================
         * MESSAGE
         * =====================================================
         */

        if (
                message == null ||
                message.trim().isEmpty()
        ) {

            return SendResult.failure(
                    "SMS message is empty."
            );
        }

        try {

            SmsManager smsManager =
                    SmsManager.getDefault();

            ArrayList<String> parts =
                    smsManager.divideMessage(
                            message
                    );

            if (
                    parts == null ||
                    parts.isEmpty()
            ) {

                return SendResult.failure(
                        "Unable to divide SMS message."
                );
            }

            /*
             * =================================================
             * SINGLE-PART SMS
             * =================================================
             */

            if (parts.size() == 1) {

                smsManager.sendTextMessage(
                        normalizedPhone,
                        null,
                        parts.get(0),
                        null,
                        null
                );

                return SendResult.success();
            }

            /*
             * =================================================
             * MULTIPART SMS
             * =================================================
             */

            smsManager.sendMultipartTextMessage(
                    normalizedPhone,
                    null,
                    parts,
                    null,
                    null
            );

            return SendResult.success();

        } catch (SecurityException exception) {

            return SendResult.failure(
                    "SMS security error: " +
                            safeError(exception)
            );

        } catch (IllegalArgumentException exception) {

            return SendResult.failure(
                    "SMS argument error: " +
                            safeError(exception)
            );

        } catch (Exception exception) {

            return SendResult.failure(
                    "SMS send error: " +
                            safeError(exception)
            );
        }
    }

    /*
     * =========================================================
     * PHONE NORMALIZATION
     * =========================================================
     */

    private String normalizePhone(
            String phone
    ) {

        if (phone == null) {
            return "";
        }

        String value =
                phone.trim()
                        .replace(" ", "")
                        .replace("-", "")
                        .replace("(", "")
                        .replace(")", "");

        if (value.startsWith("+254")) {

            return "0" +
                    value.substring(4);
        }

        if (value.startsWith("254")) {

            return "0" +
                    value.substring(3);
        }

        return value;
    }

    /*
     * =========================================================
     * MASK PHONE FOR LOGGING
     * =========================================================
     */

    private String maskPhone(
            String phone
    ) {

        if (
                phone == null ||
                phone.length() < 4
        ) {
            return "***";
        }

        return "***" +
                phone.substring(
                        Math.max(
                                0,
                                phone.length() - 4
                        )
                );
    }

    /*
     * =========================================================
     * RESULT
     * =========================================================
     */

    private boolean reportResult(
            String deviceId,
            String smsId,
            String status,
            String providerMessageId,
            String error
    ) {

        if (
                smsId == null ||
                smsId.trim().isEmpty()
        ) {
            return false;
        }

        try {

            JSONObject body =
                    new JSONObject();

            body.put(
                    "deviceId",
                    deviceId
            );

            body.put(
                    "smsId",
                    smsId
            );

            body.put(
                    "status",
                    status
            );

            if (
                    providerMessageId != null &&
                    !providerMessageId
                            .trim()
                            .isEmpty()
            ) {

                body.put(
                        "providerMessageId",
                        providerMessageId
                );
            }

            if (
                    error != null &&
                    !error.trim().isEmpty()
            ) {

                body.put(
                        "error",
                        error
                );
            }

            HttpResponse response =
                    postJson(
                            RESULT_URL,
                            body
                    );

            boolean successful =
                    response.statusCode >= 200 &&
                            response.statusCode < 300;

            if (!successful) {

                Log.e(
                        TAG,
                        "Unable to report SMS result. " +
                                "smsId=" +
                                smsId +
                                " HTTP=" +
                                response.statusCode
                );
            }

            return successful;

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Exception while reporting SMS result. smsId=" +
                            smsId,
                    exception
            );

            return false;
        }
    }

    /*
     * =========================================================
     * HTTP
     * =========================================================
     */

    private HttpResponse postJson(
            String urlString,
            JSONObject body
    ) throws Exception {

        HttpURLConnection connection =
                null;

        try {

            URL url =
                    new URL(urlString);

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

            connection.setDoOutput(true);

            connection.setUseCaches(false);

            connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
            );

            connection.setRequestProperty(
                    "Accept",
                    "application/json"
            );

            /*
             * Temporary background-worker authentication.
             *
             * This is shared by:
             *
             * - claim
             * - result
             * - device registration
             *
             * The registered-device authentication system can
             * replace this later.
             */

            connection.setRequestProperty(
                    "x-danijace-sms-worker",
                    BuildConfig.DANIJACE_SMS_WORKER_TOKEN
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
                    readStream(stream);

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

    /*
     * =========================================================
     * STREAM
     * =========================================================
     */

    private String readStream(
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

                result.append(line);
            }
        }

        return result.toString();
    }

    /*
     * =========================================================
     * ERROR
     * =========================================================
     */

    private String safeError(
            Exception exception
    ) {

        if (exception == null) {
            return "Unknown error";
        }

        String message =
                exception.getMessage();

        if (
                message == null ||
                message.trim().isEmpty()
        ) {

            return exception
                    .getClass()
                    .getSimpleName();
        }

        return message.trim();
    }

    /*
     * =========================================================
     * INTERNAL RESULT TYPES
     * =========================================================
     */

    private static final class ClaimResponse {

        final boolean success;

        final JSONArray messages;

        ClaimResponse(
                boolean success,
                JSONArray messages
        ) {

            this.success =
                    success;

            this.messages =
                    messages;
        }
    }

    private static final class SendResult {

        final boolean success;

        final String error;

        private SendResult(
                boolean success,
                String error
        ) {

            this.success =
                    success;

            this.error =
                    error;
        }

        static SendResult success() {

            return new SendResult(
                    true,
                    null
            );
        }

        static SendResult failure(
                String error
        ) {

            return new SendResult(
                    false,
                    error
            );
        }
    }

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
}