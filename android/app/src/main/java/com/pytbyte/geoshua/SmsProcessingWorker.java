package com.pytbyte.geoshua;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.util.Log;

import androidx.annotation.NonNull;
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

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * =========================================================
 * GEO-SHUA
 * NATIVE INCOMING SMS PROCESSING WORKER
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 *
 * Process incoming SMS messages that have already been
 * captured by SmsReceiver and stored in SmsQueueStore.
 *
 * Flow:
 *
 *   Android SMS
 *       ↓
 *   SmsReceiver
 *       ↓
 *   SmsQueueStore
 *       ↓
 *   SmsProcessingWorker
 *       ↓
 *   POST /api/sms/process
 *       ↓
 *   GEO-SHUA financial services
 *       ↓
 *   mark SQLite row processed
 *
 * =========================================================
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * This worker does NOT:
 *
 * - parse bank SMS
 * - resolve members
 * - resolve loans
 * - resolve savings accounts
 * - calculate repayments
 * - modify MongoDB directly
 *
 * All financial processing remains on the server.
 *
 * The existing API remains authoritative:
 *
 *   /api/sms/process
 *
 * =========================================================
 *
 * BACKGROUND OPERATION
 * ---------------------------------------------------------
 *
 * This worker does not depend on:
 *
 * - MainActivity
 * - WebView
 * - React
 * - Capacitor
 * - JavaScript
 * - the GEO-SHUA UI
 *
 * Therefore it can run while:
 *
 * - the app UI is closed
 * - the screen is locked
 * - the user is not looking at the app
 *
 * Subject to normal Android restrictions such as:
 *
 * - app force-stop
 * - revoked permissions
 * - device/network restrictions
 *
 * =========================================================
 *
 * RETRY MODEL
 * ---------------------------------------------------------
 *
 * Terminal result:
 *
 *   success
 *   duplicate
 *   ignored
 *
 * These are marked processed.
 *
 * Retryable result:
 *
 *   network failure
 *   HTTP 5xx
 *
 * These remain pending.
 *
 * The worker returns Result.retry().
 *
 * =========================================================
 */
public final class SmsProcessingWorker
        extends Worker {

    private static final String TAG =
            "GeoShuaSmsWorker";

    /* =====================================================
       API
    ===================================================== */

    private static final String API_BASE_URL =
            "https://geo-shua.vercel.app";

    private static final String PROCESS_ENDPOINT =
            API_BASE_URL + "/api/sms/process";

    /* =====================================================
       WORK NAMES
    ===================================================== */

    /**
     * Unique immediate work.
     *
     * Multiple SMS_RECEIVED broadcasts can arrive close
     * together. KEEP causes them to share one worker instead
     * of creating a separate worker for every SMS.
     */
    private static final String IMMEDIATE_WORK_NAME =
            "geoshua_sms_processing_now";

    /**
     * Periodic fallback.
     *
     * This catches SMS that remain pending because an
     * immediate worker was delayed or the device temporarily
     * lacked network connectivity.
     */
    private static final String PERIODIC_WORK_NAME =
            "geoshua_sms_processing_periodic";

    /* =====================================================
       TIMING
    ===================================================== */

    private static final long SMS_LOOKBACK_HOURS =
            36L;

    private static final long SMS_LOOKBACK_MS =
            SMS_LOOKBACK_HOURS
                    * 60L
                    * 60L
                    * 1000L;

    /**
     * HTTP connection timeout.
     */
    private static final int CONNECT_TIMEOUT_MS =
            15_000;

    /**
     * HTTP response timeout.
     */
    private static final int READ_TIMEOUT_MS =
            30_000;

    /**
     * Maximum number of queued messages handled by one
     * worker invocation.
     *
     * If more remain, the worker schedules another immediate
     * pass before finishing.
     */
    private static final int BATCH_SIZE =
            10;

    /**
     * WorkManager retry backoff.
     */
    private static final long RETRY_DELAY_SECONDS =
            30L;

    /* =====================================================
       CONSTRUCTOR
    ===================================================== */

    public SmsProcessingWorker(
            @NonNull Context context,
            @NonNull WorkerParameters workerParams
    ) {
        super(
                context,
                workerParams
        );
    }

    /* =====================================================
       DO WORK
    ===================================================== */

    @NonNull
    @Override
    public Result doWork() {

        Log.d(
                TAG,
                "Incoming SMS processing worker started"
        );

        try {

            /*
             * WorkManager already has a network constraint,
             * but this defensive check prevents unnecessary
             * HTTP attempts if the network disappeared between
             * scheduling and execution.
             */
            if (!isNetworkAvailable()) {

                Log.d(
                        TAG,
                        "Network unavailable; requesting retry"
                );

                return Result.retry();
            }

            final long now =
                    System.currentTimeMillis();

            final long cutoff =
                    now - SMS_LOOKBACK_MS;

            /*
             * Enforce the 36-hour retention window before
             * loading pending messages.
             */
            SmsQueueStore store =
                    new SmsQueueStore(
                            getApplicationContext()
                    );

            store.deleteOlderThan(
                    cutoff
            );

            /*
             * Load pending messages in chronological order.
             */
            List<SmsQueueStore.SmsMessage> messages =
                    store.getPendingMessages(
                            cutoff,
                            now
                    );

            if (messages.isEmpty()) {

                Log.d(
                        TAG,
                        "No pending incoming SMS messages"
                );

                return Result.success();
            }

            Log.d(
                    TAG,
                    "Pending SMS count: "
                            + messages.size()
            );

            int processedCount =
                    0;

            int attemptedCount =
                    0;

            /*
             * Only process a bounded batch per worker
             * invocation.
             */
            int limit =
                    Math.min(
                            messages.size(),
                            BATCH_SIZE
                    );

            for (
                    int index = 0;
                    index < limit;
                    index++
            ) {

                SmsQueueStore.SmsMessage sms =
                        messages.get(index);

                if (sms == null) {
                    continue;
                }

                attemptedCount++;

                ProcessingResult result =
                        processSms(
                                sms
                        );

                /*
                 * Terminal outcome.
                 *
                 * The backend has either:
                 *
                 * - processed the financial transaction
                 * - confirmed it was already processed
                 * - deliberately ignored it
                 *
                 * Therefore it is safe to remove this SMS
                 * from the pending financial queue.
                 */
                if (result.terminal) {

                    boolean marked =
                            store.markProcessed(
                                    sms.getId()
                            );

                    if (!marked) {

                        /*
                         * The backend already responded with a
                         * terminal result, so we do NOT retry the
                         * financial operation simply because the
                         * local SQLite update failed.
                         *
                         * The SMS remains locally pending and can
                         * be reconciled later. Backend idempotency
                         * protects against duplicate financial
                         * processing if it is sent again.
                         */
                        Log.w(
                                TAG,
                                "Backend accepted SMS but local "
                                        + "processed flag could not be updated: "
                                        + sms.getId()
                        );
                    } else {

                        processedCount++;

                        Log.d(
                                TAG,
                                "SMS completed: "
                                        + sms.getId()
                                        + " status="
                                        + result.apiStatus
                        );
                    }

                    continue;
                }

                /*
                 * Retryable failure.
                 *
                 * Do NOT mark the SMS processed.
                 */
                if (result.retryable) {

                    Log.w(
                            TAG,
                            "Retryable SMS processing failure for "
                                    + sms.getId()
                                    + ": "
                                    + result.message
                    );

                    return Result.retry();
                }

                /*
                 * Defensive fallback.
                 */
                Log.w(
                        TAG,
                        "Unhandled SMS processing result for "
                                + sms.getId()
                );

                return Result.retry();
            }

            /*
             * If there are more messages than this worker's
             * batch size, schedule another immediate pass.
             */
            if (messages.size() > BATCH_SIZE) {

                Log.d(
                        TAG,
                        "More pending SMS remain; scheduling next batch"
                );

                enqueueNow(
                        getApplicationContext()
                );
            }

            Log.d(
                    TAG,
                    "Incoming SMS processing worker finished. "
                            + "attempted="
                            + attemptedCount
                            + ", completed="
                            + processedCount
            );

            return Result.success();

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Unexpected SMS worker failure",
                    exception
            );

            /*
             * The queue remains untouched.
             *
             * WorkManager will retry.
             */
            return Result.retry();
        }
    }

    /* =====================================================
       PROCESS ONE SMS
    ===================================================== */

    private ProcessingResult processSms(
            @NonNull SmsQueueStore.SmsMessage sms
    ) {

        HttpURLConnection connection =
                null;

        try {

            URL url =
                    new URL(
                            PROCESS_ENDPOINT
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

            connection.setDoInput(
                    true
            );

            connection.setUseCaches(
                    false
            );

            connection.setRequestProperty(
                    "Content-Type",
                    "application/json; charset=UTF-8"
            );

            connection.setRequestProperty(
                    "Accept",
                    "application/json"
            );

            /*
             * Prevent accidental proxy/cache behaviour from
             * interfering with transaction processing.
             */
            connection.setRequestProperty(
                    "Cache-Control",
                    "no-cache"
            );

            JSONObject requestBody =
                    new JSONObject();

            /*
             * EXACT CONTRACT expected by:
             *
             * /api/sms/process
             */
            requestBody.put(
                    "smsId",
                    sms.getId()
            );

            requestBody.put(
                    "address",
                    sms.getAddress()
            );

            requestBody.put(
                    "body",
                    sms.getBody()
            );

            requestBody.put(
                    "date",
                    sms.getSmsDate()
            );

            byte[] bodyBytes =
                    requestBody
                            .toString()
                            .getBytes(
                                    StandardCharsets.UTF_8
                            );

            connection.setFixedLengthStreamingMode(
                    bodyBytes.length
            );

            try (
                    OutputStream outputStream =
                            connection.getOutputStream()
            ) {
                outputStream.write(
                        bodyBytes
                );

                outputStream.flush();
            }

            int responseCode =
                    connection.getResponseCode();

            String responseBody =
                    readResponseBody(
                            connection,
                            responseCode
                    );

            return classifyResponse(
                    responseCode,
                    responseBody
            );

        } catch (
                java.net.SocketTimeoutException exception
        ) {

            return ProcessingResult.retry(
                    "SMS API request timed out: "
                            + exception.getMessage()
            );

        } catch (
                java.net.UnknownHostException exception
        ) {

            return ProcessingResult.retry(
                    "SMS API host could not be resolved."
            );

        } catch (
                java.net.ConnectException exception
        ) {

            return ProcessingResult.retry(
                    "Unable to connect to SMS API: "
                            + exception.getMessage()
            );

        } catch (
                IOException exception
        ) {

            return ProcessingResult.retry(
                    "SMS API network failure: "
                            + exception.getMessage()
            );

        } catch (
                Exception exception
        ) {

            /*
             * JSON construction or another unexpected local
             * failure is treated as retryable because the SMS
             * remains safely stored in SQLite.
             */
            return ProcessingResult.retry(
                    "Unexpected SMS API processing failure: "
                            + exception.getMessage()
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

    @NonNull
    private String readResponseBody(
            @NonNull HttpURLConnection connection,
            int responseCode
    ) throws IOException {

        InputStream inputStream;

        if (
                responseCode >= 200 &&
                responseCode < 400
        ) {
            inputStream =
                    connection.getInputStream();

        } else {

            inputStream =
                    connection.getErrorStream();

            /*
             * Some HTTP implementations may not provide an
             * error stream. Return an empty body rather than
             * throwing another exception and losing the
             * original HTTP status.
             */
            if (inputStream == null) {
                return "";
            }
        }

        StringBuilder builder =
                new StringBuilder();

        try (
                BufferedReader reader =
                        new BufferedReader(
                                new InputStreamReader(
                                        inputStream,
                                        StandardCharsets.UTF_8
                                )
                        )
        ) {

            String line;

            while (
                    (line =
                            reader.readLine()) != null
            ) {

                builder.append(
                        line
                );
            }
        }

        return builder.toString();
    }

    /* =====================================================
       CLASSIFY API RESPONSE
    ===================================================== */

    @NonNull
    private ProcessingResult classifyResponse(
            int responseCode,
            @NonNull String responseBody
    ) {

        /*
         * =================================================
         * HTTP 2xx
         * =================================================
         *
         * The API deliberately uses HTTP 200 for:
         *
         *   success
         *   duplicate
         *   ignored
         *
         * We inspect the JSON status.
         */
        if (
                responseCode >= 200 &&
                responseCode < 300
        ) {

            String status =
                    extractApiStatus(
                            responseBody
                    );

            if (
                    "success".equals(
                            status
                    )
            ) {

                return ProcessingResult.terminal(
                        "success",
                        "SMS financial transaction processed."
                );
            }

            if (
                    "duplicate".equals(
                            status
                    )
            ) {

                return ProcessingResult.terminal(
                        "duplicate",
                        "SMS transaction was already processed."
                );
            }

            if (
                    "ignored".equals(
                            status
                    )
            ) {

                /*
                 * The API explicitly classifies these as
                 * ignored rather than failed.
                 *
                 * Examples:
                 *
                 * - non-bank SMS
                 * - future SMS
                 * - unknown bank destination
                 * - member resolution failure
                 * - loan resolution failure
                 * - savings-account resolution failure
                 *
                 * These are terminal decisions from the API.
                 */
                return ProcessingResult.terminal(
                        "ignored",
                        extractApiMessage(
                                responseBody,
                                "SMS was intentionally ignored."
                        )
                );
            }

            /*
             * HTTP 200 without a recognized API status is not
             * safe to treat as success.
             *
             * Leave the message pending and retry.
             */
            return ProcessingResult.retry(
                    "SMS API returned HTTP 200 with an "
                            + "unrecognized response status."
            );
        }

        /*
         * =================================================
         * HTTP 4xx
         * =================================================
         *
         * The request itself is invalid.
         *
         * Since the SMS was generated by our native queue,
         * this normally indicates a permanent request/data
         * problem rather than a temporary network failure.
         *
         * Do not endlessly retry it.
         */
        if (
                responseCode >= 400 &&
                responseCode < 500
        ) {

            return ProcessingResult.terminal(
                    "ignored",
                    "SMS API rejected the request with HTTP "
                            + responseCode
                            + ": "
                            + extractApiMessage(
                                    responseBody,
                                    "Client request rejected."
                            )
            );
        }

        /*
         * =================================================
         * HTTP 5xx
         * =================================================
         *
         * Server-side failure.
         *
         * Keep the SMS pending and retry.
         */
        if (
                responseCode >= 500 &&
                responseCode <= 599
        ) {

            return ProcessingResult.retry(
                    "SMS API server error HTTP "
                            + responseCode
                            + ": "
                            + extractApiMessage(
                                    responseBody,
                                    "Server error."
                            )
            );
        }

        /*
         * Any unexpected HTTP status is treated as
         * retryable.
         */
        return ProcessingResult.retry(
                "Unexpected SMS API HTTP status: "
                        + responseCode
        );
    }

    /* =====================================================
       EXTRACT API STATUS
    ===================================================== */

    @NonNull
    private String extractApiStatus(
            @NonNull String responseBody
    ) {

        if (
                responseBody.trim().isEmpty()
        ) {
            return "";
        }

        try {

            JSONObject json =
                    new JSONObject(
                            responseBody
                    );

            String status =
                    json.optString(
                            "status",
                            ""
                    );

            return status
                    .trim()
                    .toLowerCase(
                            Locale.US
                    );

        } catch (Exception exception) {

            Log.w(
                    TAG,
                    "Unable to parse SMS API response: "
                            + responseBody,
                    exception
            );

            return "";
        }
    }

    /* =====================================================
       EXTRACT API MESSAGE
    ===================================================== */

    @NonNull
    private String extractApiMessage(
            @NonNull String responseBody,
            @NonNull String fallback
    ) {

        if (
                responseBody.trim().isEmpty()
        ) {
            return fallback;
        }

        try {

            JSONObject json =
                    new JSONObject(
                            responseBody
                    );

            String message =
                    json.optString(
                            "message",
                            ""
                    );

            if (
                    message != null &&
                    !message.trim().isEmpty()
            ) {
                return message.trim();
            }

            String reason =
                    json.optString(
                            "reason",
                            ""
                    );

            if (
                    reason != null &&
                    !reason.trim().isEmpty()
            ) {
                return reason.trim();
            }

            return fallback;

        } catch (Exception exception) {

            return fallback;
        }
    }

    /* =====================================================
       NETWORK CHECK
    ===================================================== */

    private boolean isNetworkAvailable() {

        try {

            ConnectivityManager manager =
                    (ConnectivityManager)
                            getApplicationContext()
                                    .getSystemService(
                                            Context.CONNECTIVITY_SERVICE
                                    );

            if (manager == null) {
                return false;
            }

            Network network =
                    manager.getActiveNetwork();

            if (network == null) {
                return false;
            }

            android.net.NetworkCapabilities capabilities =
                    manager.getNetworkCapabilities(
                            network
                    );

            if (capabilities == null) {
                return false;
            }

            return capabilities.hasCapability(
                    android.net.NetworkCapabilities
                            .NET_CAPABILITY_INTERNET
            );

        } catch (Exception exception) {

            Log.w(
                    TAG,
                    "Unable to determine network state",
                    exception
            );

            /*
             * Let the HTTP request determine whether the
             * network actually works.
             */
            return true;
        }
    }

    /* =====================================================
       ENQUEUE IMMEDIATELY
    ===================================================== */

    /**
     * Wake the incoming SMS processor immediately.
     *
     * ExistingWorkPolicy.KEEP is intentional.
     *
     * If several SMS arrive at almost the same time, we do
     * not want ten independent workers processing the same
     * queue.
     */
    public static void enqueueNow(
            @NonNull Context context
    ) {

        Constraints constraints =
                new Constraints.Builder()
                        .setRequiredNetworkType(
                                NetworkType.CONNECTED
                        )
                        .build();

        OneTimeWorkRequest request =
                new OneTimeWorkRequest.Builder(
                        SmsProcessingWorker.class
                )
                        .setConstraints(
                                constraints
                        )
                        .setBackoffCriteria(
                                BackoffPolicy.EXPONENTIAL,
                                RETRY_DELAY_SECONDS,
                                TimeUnit.SECONDS
                        )
                        .build();

        WorkManager
                .getInstance(
                        context.getApplicationContext()
                )
                .enqueueUniqueWork(
                        IMMEDIATE_WORK_NAME,
                        ExistingWorkPolicy.KEEP,
                        request
                );

        Log.d(
                TAG,
                "Immediate SMS processing work queued"
        );
    }

    /* =====================================================
       PERIODIC FALLBACK
    ===================================================== */

    /**
     * Schedule the periodic fallback worker.
     *
     * WorkManager controls the exact execution time.
     * Android does not guarantee exact 15-minute execution.
     *
     * Its purpose is recovery, not precise scheduling.
     */
    public static void schedule(
            @NonNull Context context
    ) {

        Constraints constraints =
                new Constraints.Builder()
                        .setRequiredNetworkType(
                                NetworkType.CONNECTED
                        )
                        .build();

        PeriodicWorkRequest request =
                new PeriodicWorkRequest.Builder(
                        SmsProcessingWorker.class,
                        15,
                        TimeUnit.MINUTES
                )
                        .setConstraints(
                                constraints
                        )
                        .setBackoffCriteria(
                                BackoffPolicy.EXPONENTIAL,
                                RETRY_DELAY_SECONDS,
                                TimeUnit.SECONDS
                        )
                        .build();

        WorkManager
                .getInstance(
                        context.getApplicationContext()
                )
                .enqueueUniquePeriodicWork(
                        PERIODIC_WORK_NAME,
                        ExistingPeriodicWorkPolicy.KEEP,
                        request
                );

        Log.d(
                TAG,
                "Periodic SMS processing fallback scheduled"
        );
    }

    /* =====================================================
       PROCESSING RESULT
    ===================================================== */

    private static final class ProcessingResult {

        private final boolean terminal;

        private final boolean retryable;

        private final String apiStatus;

        private final String message;

        private ProcessingResult(
                boolean terminal,
                boolean retryable,
                @NonNull String apiStatus,
                @NonNull String message
        ) {
            this.terminal =
                    terminal;

            this.retryable =
                    retryable;

            this.apiStatus =
                    apiStatus;

            this.message =
                    message;
        }

        @NonNull
        static ProcessingResult terminal(
                @NonNull String status,
                @NonNull String message
        ) {
            return new ProcessingResult(
                    true,
                    false,
                    status,
                    message
            );
        }

        @NonNull
        static ProcessingResult retry(
                @NonNull String message
        ) {
            return new ProcessingResult(
                    false,
                    true,
                    "retry",
                    message
            );
        }
    }
}
