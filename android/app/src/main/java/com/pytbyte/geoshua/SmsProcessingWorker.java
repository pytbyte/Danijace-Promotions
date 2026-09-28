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
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
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
 * PRODUCTION FINANCIAL SMS PIPELINE
 * ---------------------------------------------------------
 *
 * This worker processes SMS messages captured by the native
 * Android SMS receiver and stored in SmsQueueStore.
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
 *   GEO-SHUA API
 *       ↓
 *   Financial processing
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
 * - identify members
 * - identify loans
 * - identify savings accounts
 * - calculate repayments
 * - modify MongoDB
 *
 * All financial intelligence remains on the server.
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
 *
 * It can therefore process queued SMS while the UI is
 * closed or the screen is locked, subject to Android system
 * restrictions.
 *
 * =========================================================
 *
 * 36-HOUR WINDOW
 * ---------------------------------------------------------
 *
 * The 36-hour period is used to select recent pending SMS
 * for automatic Android reconciliation/processing.
 *
 * It is NOT a financial validity decision.
 *
 * The API remains authoritative regarding whether a
 * transaction is financially valid.
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

    /**
     * REAL production financial processing endpoint.
     *
     * This is NOT the diagnostic endpoint.
     */
    private static final String API_BASE_URL =
            "https://geo-shua.vercel.app";

    private static final String PROCESS_ENDPOINT =
            API_BASE_URL + "/api/sms/process";

    /* =====================================================
       WORK NAMES
    ===================================================== */

    private static final String IMMEDIATE_WORK_NAME =
            "geoshua_sms_processing_now";

    private static final String PERIODIC_WORK_NAME =
            "geoshua_sms_processing_periodic";

    /* =====================================================
       TIMING
    ===================================================== */

    /**
     * Android automatically processes/reconciles SMS from
     * the most recent 36 hours.
     *
     * This is NOT the server's financial validity rule.
     */
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
     * Maximum messages processed in one batch.
     */
    private static final int BATCH_SIZE =
            10;

    /**
     * Maximum batches processed by a single Worker
     * invocation.
     *
     * This prevents a pathological queue from keeping one
     * Worker alive indefinitely.
     */
    private static final int MAX_BATCHES_PER_RUN =
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
                "================================================"
        );

        Log.d(
                TAG,
                "Incoming SMS processing worker started"
        );

        Log.d(
                TAG,
                "Production endpoint: "
                        + PROCESS_ENDPOINT
        );

        try {

            /*
             * WorkManager already requires a connected
             * network, but perform a defensive check because
             * connectivity can disappear between scheduling
             * and actual execution.
             */
            if (!isNetworkAvailable()) {

                Log.d(
                        TAG,
                        "Network unavailable; requesting retry"
                );

                return Result.retry();
            }

            SmsQueueStore store =
                    new SmsQueueStore(
                            getApplicationContext()
                    );

            /*
             * Use one processing window for this worker
             * invocation.
             *
             * The 36-hour window determines which recent
             * pending SMS are automatically submitted.
             */
            final long now =
                    System.currentTimeMillis();

            final long cutoff =
                    now - SMS_LOOKBACK_MS;

            /*
             * Cleanup is safe because SmsQueueStore now deletes
             * ONLY processed rows.
             *
             * Unprocessed financial SMS are preserved.
             */
            int deleted =
                    store.deleteOlderThan(
                            cutoff
                    );

            if (deleted > 0) {

                Log.d(
                        TAG,
                        "Cleaned up "
                                + deleted
                                + " old processed SMS rows"
                );
            }

            int totalAttempted =
                    0;

            int totalCompleted =
                    0;

            /*
             * =================================================
             * DRAIN THE QUEUE
             * =================================================
             *
             * Instead of:
             *
             *   process 10
             *   enqueue another Worker
             *   finish
             *
             * we process several controlled batches inside
             * this Worker invocation.
             *
             * This avoids the ExistingWorkPolicy.KEEP race
             * where a new enqueue can be ignored while the
             * current Worker is still running.
             */
            for (
                    int batchNumber = 1;
                    batchNumber <= MAX_BATCHES_PER_RUN;
                    batchNumber++
            ) {

                List<SmsQueueStore.SmsMessage> messages =
                        store.getPendingMessages(
                                cutoff,
                                now
                        );

                if (messages.isEmpty()) {

                    Log.d(
                            TAG,
                            "No pending incoming SMS messages remain"
                    );

                    break;
                }

                Log.d(
                        TAG,
                        "Processing batch "
                                + batchNumber
                                + " with "
                                + messages.size()
                                + " pending SMS"
                );

                int limit =
                        Math.min(
                                messages.size(),
                                BATCH_SIZE
                        );

                boolean retryRequested =
                        false;

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

                    totalAttempted++;

                    Log.d(
                            TAG,
                            "Processing SMS "
                                    + sms.getId()
                    );

                    ProcessingResult result =
                            processSms(
                                    sms
                            );

                    /*
                     * =================================================
                     * TERMINAL
                     * =================================================
                     *
                     * The API has made a terminal decision.
                     *
                     * success
                     * duplicate
                     * ignored
                     *
                     * are currently terminal API states.
                     */
                    if (result.terminal) {

                        boolean marked =
                                store.markProcessed(
                                        sms.getId()
                                );

                        if (!marked) {

                            /*
                             * The backend already received the
                             * request and returned a terminal
                             * result.
                             *
                             * Do NOT send the financial operation
                             * again merely because the local SQLite
                             * flag could not be updated.
                             *
                             * The row remains pending and can be
                             * reconciled later.
                             */
                            Log.w(
                                    TAG,
                                    "Backend returned terminal result "
                                            + "but SQLite row could not be "
                                            + "marked processed: "
                                            + sms.getId()
                            );

                        } else {

                            totalCompleted++;

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
                     * =================================================
                     * RETRYABLE
                     * =================================================
                     *
                     * Do not mark the SMS processed.
                     */
                    if (result.retryable) {

                        Log.w(
                                TAG,
                                "Retryable SMS processing failure: "
                                        + sms.getId()
                                        + " - "
                                        + result.message
                        );

                        retryRequested =
                                true;

                        break;
                    }

                    /*
                     * Defensive fallback.
                     */
                    Log.w(
                            TAG,
                            "Unhandled processing result for SMS: "
                                    + sms.getId()
                    );

                    retryRequested =
                            true;

                    break;
                }

                /*
                 * If one SMS needs retrying, stop immediately.
                 *
                 * Its SQLite row remains processed=0.
                 */
                if (retryRequested) {

                    Log.w(
                            TAG,
                            "Worker stopping because a retryable "
                                    + "SMS processing failure occurred"
                    );

                    return Result.retry();
                }

                /*
                 * If fewer than BATCH_SIZE messages were returned,
                 * we have drained the current queue.
                 */
                if (messages.size() < BATCH_SIZE) {

                    break;
                }
            }

            /*
             * Check whether messages still remain inside the
             * current 36-hour processing window.
             *
             * If so, schedule another immediate pass.
             *
             * Because this Worker is currently finishing, the
             * enqueue is safe and KEEP will allow the next work
             * item to be created.
             */
            List<SmsQueueStore.SmsMessage> remaining =
                    store.getPendingMessages(
                            cutoff,
                            now
                    );

            if (!remaining.isEmpty()) {

                Log.d(
                        TAG,
                        "Pending SMS remain after worker safety limit: "
                                + remaining.size()
                );

                enqueueNow(
                        getApplicationContext()
                );
            }

            Log.d(
                    TAG,
                    "Incoming SMS processing worker finished. "
                            + "attempted="
                            + totalAttempted
                            + ", completed="
                            + totalCompleted
            );

            return Result.success();

        } catch (Exception exception) {

            Log.e(
                    TAG,
                    "Unexpected SMS worker failure",
                    exception
            );

            /*
             * No SMS is marked processed because of this
             * exception.
             *
             * WorkManager will retry the Worker.
             */
            return Result.retry();

        } finally {

            Log.d(
                    TAG,
                    "================================================"
            );
        }
    }

    /* =====================================================
       PROCESS ONE SMS
    ===================================================== */

    @NonNull
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

            connection.setRequestProperty(
                    "Cache-Control",
                    "no-cache"
            );

            /*
             * =================================================
             * PRODUCTION API CONTRACT
             * =================================================
             *
             * POST /api/sms/process
             *
             * {
             *   "smsId": "...",
             *   "address": "...",
             *   "body": "...",
             *   "date": 123456789
             * }
             */
            JSONObject requestBody =
                    new JSONObject();

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

            Log.d(
                    TAG,
                    "API response for "
                            + sms.getId()
                            + ": HTTP "
                            + responseCode
            );

            return classifyResponse(
                    responseCode,
                    responseBody
            );

        } catch (
                SocketTimeoutException exception
        ) {

            return ProcessingResult.retry(
                    "SMS API request timed out: "
                            + exception.getMessage()
            );

        } catch (
                UnknownHostException exception
        ) {

            return ProcessingResult.retry(
                    "SMS API host could not be resolved."
            );

        } catch (
                ConnectException exception
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
             * Unexpected local failure.
             *
             * The SMS remains safely stored as pending, so
             * retrying is safer than marking it processed.
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
         */
        if (
                responseCode >= 200 &&
                responseCode < 300
        ) {

            String status =
                    extractApiStatus(
                            responseBody
                    );

            /*
             * REAL FINANCIAL SUCCESS
             */
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

            /*
             * SERVER-SIDE IDEMPOTENCY
             *
             * The server says this transaction already exists.
             * It is therefore safe to stop submitting this SMS.
             */
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

            /*
             * CURRENT API CONTRACT
             *
             * At this stage of the Android work, the existing
             * API still returns "ignored" for terminal cases.
             *
             * We will refine this contract when we modify
             * /api/sms/process.
             */
            if (
                    "ignored".equals(
                            status
                    )
            ) {

                return ProcessingResult.terminal(
                        "ignored",
                        extractApiMessage(
                                responseBody,
                                "SMS was intentionally ignored."
                        )
                );
            }

            /*
             * FUTURE API STATUS
             *
             * We intentionally recognize "unresolved" here so
             * the Android worker is prepared for the API contract
             * we will implement next.
             *
             * IMPORTANT:
             *
             * The current API does not yet return this status.
             */
            if (
                    "unresolved".equals(
                            status
                    )
            ) {

                /*
                 * For now this remains retryable.
                 *
                 * When the API is changed to persist an
                 * unresolved financial event server-side, this
                 * can become a terminal result.
                 */
                return ProcessingResult.retry(
                        extractApiMessage(
                                responseBody,
                                "SMS could not yet be resolved."
                        )
                );
            }

            /*
             * HTTP 2xx without a recognized status is NOT safe
             * to mark processed.
             */
            return ProcessingResult.retry(
                    "SMS API returned HTTP "
                            + responseCode
                            + " with an unrecognized response status."
            );
        }

        /*
         * =================================================
         * HTTP 4xx
         * =================================================
         *
         * The API rejected the request itself.
         *
         * Do not retry indefinitely.
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
         * Server failure.
         *
         * Keep the SMS pending.
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
         * Unexpected HTTP status.
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
             * Let the actual HTTP request determine whether
             * the network works.
             */
            return true;
        }
    }

    /* =====================================================
       ENQUEUE IMMEDIATELY
    ===================================================== */

    /**
     * Wake the production SMS processor immediately.
     *
     * Multiple SMS broadcasts can arrive close together.
     *
     * KEEP prevents a new worker from being created when
     * one is already running.
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
                "Immediate production SMS processing work queued"
        );
    }

    /* =====================================================
       PERIODIC FALLBACK
    ===================================================== */

    /**
     * Schedule periodic recovery processing.
     *
     * WorkManager controls the exact execution time.
     *
     * The 15-minute interval is a minimum scheduling
     * interval, not a guaranteed exact execution time.
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
                "Periodic production SMS processing fallback scheduled"
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

