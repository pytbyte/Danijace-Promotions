package com.pytbyte.geoshua;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.telephony.SmsManager;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
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


/*
 * =========================================================
 * CONFIGURATION
 * =========================================================
 */

private static final String API_BASE_URL =
        "https://geo-shua.vercel.app";

private static final String CLAIM_URL =
        API_BASE_URL + "/api/sms/outbox/claim";

private static final String RESULT_URL =
        API_BASE_URL + "/api/sms/outbox/result";

private static final int CLAIM_LIMIT = 10;

private static final int CONNECT_TIMEOUT_MS = 15_000;

private static final int READ_TIMEOUT_MS = 30_000;

private static final String PREFS_NAME =
        "geoshua_sms_worker";

private static final String DEVICE_ID_KEY =
        "device_id";

private static final String IMMEDIATE_WORK_NAME =
        "geoshua_sms_outbox_now";

private static final String PERIODIC_WORK_NAME =
        "geoshua_sms_outbox";

/*
 * =========================================================
 * CONSTRUCTOR
 * =========================================================
 */

public SmsOutboxWorker(
        @NonNull Context context,
        @NonNull WorkerParameters workerParams
) {
    super(context, workerParams);
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

    try {
        ClaimResponse claim =
                claimMessages(deviceId);

        if (!claim.success) {
            return Result.retry();
        }

        /*
         * Nothing waiting.
         */
        if (claim.messages.length() == 0) {
            return Result.success();
        }

        boolean reportFailure = false;

        for (
                int i = 0;
                i < claim.messages.length();
                i++
        ) {
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
             * A malformed claimed record should not
             * remain stuck in "processing".
             */
            if (
                    smsId.isEmpty() ||
                    recipient.isEmpty() ||
                    message.isEmpty()
            ) {
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
             *
             * This deliberately uses SmsManager directly.
             * It does not depend on the Capacitor WebView or
             * SmsSenderPlugin.
             * =================================================
             */

            SendResult sendResult =
                    sendSms(
                            context,
                            recipient,
                            message
                    );

            if (sendResult.success) {
                boolean reported =
                        reportResult(
                                deviceId,
                                smsId,
                                "sent",
                                "android-sms-accepted",
                                null
                        );

                if (!reported) {
                    reportFailure = true;
                }
            } else {
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
         * If reporting failed, retry the worker.
         *
         * The server-side claim timeout/retry mechanism
         * protects messages that were already claimed.
         */
        if (reportFailure) {
            return Result.retry();
        }

        return Result.success();

    } catch (Exception exception) {
        return Result.retry();
    }
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
 * This does two things:
 *
 * 1. Runs the worker immediately.
 * 2. Registers persistent periodic background polling.
 *
 * WorkManager requires a minimum periodic interval of
 * 15 minutes.
 */

public static void schedule(
        Context context
) {
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
                    .build();

    WorkManager
            .getInstance(context)
            .enqueueUniqueWork(
                    IMMEDIATE_WORK_NAME,
                    ExistingWorkPolicy.REPLACE,
                    immediateWork
            );

    /*
     * =====================================================
     * PERIODIC BACKGROUND CHECK
     * =====================================================
     *
     * This remains registered after the application UI
     * is closed.
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
            .getInstance(context)
            .enqueueUniquePeriodicWork(
                    PERIODIC_WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    periodicWork
            );
}

/*
 * =========================================================
 * DEVICE ID
 * =========================================================
 *
 * Stable for this Android installation.
 *
 * This method is shared by:
 *
 * - SmsOutboxWorker
 * - FcmTokenRegistrar
 *
 * Keeping device identity in one place prevents the FCM
 * registration and SMS worker from accidentally using
 * different device IDs.
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

    String normalizedPhone =
            normalizePhone(phone);

    if (normalizedPhone.isEmpty()) {
        return SendResult.failure(
                "Recipient phone number is empty."
        );
    }

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
         * Single-part SMS.
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
         * Multipart SMS.
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
        return "0" + value.substring(4);
    }

    if (value.startsWith("254")) {
        return "0" + value.substring(3);
    }

    return value;
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

        return response.statusCode >= 200 &&
                response.statusCode < 300;

    } catch (Exception exception) {
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
         * Later this will be replaced with proper
         * registered-device authentication.
         */
        connection.setRequestProperty(
                "x-geoshua-sms-worker",
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
        this.success = success;
        this.messages = messages;
    }
}

private static final class SendResult {

    final boolean success;

    final String error;

    private SendResult(
            boolean success,
            String error
    ) {
        this.success = success;
        this.error = error;
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
        this.statusCode = statusCode;
        this.body = body;
    }
}


}
