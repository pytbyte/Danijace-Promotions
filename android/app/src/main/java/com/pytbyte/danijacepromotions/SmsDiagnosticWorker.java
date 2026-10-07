package com.pytbyte.danijacepromotions;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
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
import java.util.concurrent.TimeUnit;

/**
 * =========================================================
 * DANIJACE PROMOTIONS
 * ANDROID SMS DIAGNOSTIC WORKER
 * =========================================================
 *
 * TEMPORARY diagnostic worker.
 *
 * Purpose:
 *
 *   SmsReceiver
 *       ↓
 *   SmsQueueStore
 *       ↓
 *   this worker
 *       ↓
 *   /api/sms/android-diagnostic
 *       ↓
 *   MongoDB
 *
 * This worker intentionally does NOT:
 *
 *   - parse bank SMS
 *   - resolve members
 *   - resolve loans
 *   - resolve savings
 *   - create repayments
 *   - create deposits
 *   - send notifications
 *
 * =========================================================
 */
public final class SmsDiagnosticWorker
        extends Worker {

    private static final String TAG =
            "DanijaceSmsDiagnostic";

    /* =====================================================
       API
    ===================================================== */

    private static final String API_BASE_URL =
            "https://danijace-promotions.vercel.app";

    private static final String API_ENDPOINT =
            API_BASE_URL +
                    "/api/sms/android-diagnostic";

    /* =====================================================
       WORK
    ===================================================== */

    private static final String UNIQUE_WORK_NAME =
            "danijace_sms_diagnostic_now";

    /* =====================================================
       SMS WINDOW
    ===================================================== */

    private static final long LOOKBACK_MS =
            36L
                    * 60L
                    * 60L
                    * 1000L;

    /* =====================================================
       BATCHING
    ===================================================== */

    private static final int BATCH_SIZE =
            10;

    /* =====================================================
       HTTP
    ===================================================== */

    private static final int CONNECT_TIMEOUT_MS =
            15_000;

    private static final int READ_TIMEOUT_MS =
            30_000;

    /* =====================================================
       CONSTRUCTOR
    ===================================================== */

    public SmsDiagnosticWorker(
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

        final long workerStartedAt =
                System.currentTimeMillis();

        Log.i(
                TAG,
                "================================================"
        );

        Log.i(
                TAG,
                "SMS DIAGNOSTIC WORKER STARTED"
        );

        Log.i(
                TAG,
                "Worker started at: "
                        + workerStartedAt
        );

        Log.i(
                TAG,
                "Endpoint: "
                        + API_ENDPOINT
        );

        Log.i(
                TAG,
                "================================================"
        );

        SmsQueueStore store =
                new SmsQueueStore(
                        getApplicationContext()
                );

        try {

            final long now =
                    System.currentTimeMillis();

            final long cutoff =
                    now - LOOKBACK_MS;

            Log.i(
                    TAG,
                    "Now: " + now
            );

            Log.i(
                    TAG,
                    "36-hour cutoff: " + cutoff
            );

            /* =================================================
               LOAD PENDING SMS
            ================================================= */

            List<SmsQueueStore.SmsMessage> messages =
                    store.getPendingMessages(
                            cutoff,
                            now
                    );

            if (
                    messages == null ||
                    messages.isEmpty()
            ) {

                Log.i(
                        TAG,
                        "No pending SMS messages."
                );

                Log.i(
                        TAG,
                        "Diagnostic worker finished."
                );

                return Result.success();
            }

            Log.i(
                    TAG,
                    "Pending SMS count: "
                            + messages.size()
            );

            /* =================================================
               BATCH
            ================================================= */

            int processedThisRun =
                    0;

            for (
                    SmsQueueStore.SmsMessage sms
                    : messages
            ) {

                if (
                        processedThisRun >=
                                BATCH_SIZE
                ) {

                    Log.i(
                            TAG,
                            "Batch limit reached."
                    );

                    break;
                }

                Log.i(
                        TAG,
                        "------------------------------------------------"
                );

                Log.i(
                        TAG,
                        "Processing diagnostic SMS:"
                );

                Log.i(
                        TAG,
                        "ID: "
                                + sms.getId()
                );

                Log.i(
                        TAG,
                        "Address: "
                                + sms.getAddress()
                );

                Log.i(
                        TAG,
                        "SMS date: "
                                + sms.getSmsDate()
                );

                Log.i(
                        TAG,
                        "Received at: "
                                + sms.getReceivedAt()
                );

                Log.i(
                        TAG,
                        "Body: "
                                + sms.getBody()
                );

                /* =============================================
                   SEND TO DIAGNOSTIC API
                ============================================= */

                long workerSentAt =
                        System.currentTimeMillis();

                DiagnosticResult result =
                        sendDiagnostic(
                                sms,
                                workerStartedAt,
                                workerSentAt
                        );

                Log.i(
                        TAG,
                        "API HTTP status: "
                                + result.httpStatus
                );

                Log.i(
                        TAG,
                        "API response: "
                                + result.responseBody
                );

                /* =============================================
                   TERMINAL SUCCESS
                ============================================= */

                if (
                        result.httpStatus >= 200 &&
                        result.httpStatus < 300
                ) {

                    boolean marked =
                            store.markProcessed(
                                    sms.getId()
                            );

                    Log.i(
                            TAG,
                            "Diagnostic API accepted SMS."
                    );

                    Log.i(
                            TAG,
                            "Marked processed: "
                                    + marked
                    );

                    processedThisRun++;

                    continue;
                }

                /* =============================================
                   CLIENT ERROR
                ============================================= */

                if (
                        result.httpStatus >= 400 &&
                        result.httpStatus < 500
                ) {

                    Log.e(
                            TAG,
                            "Diagnostic API returned terminal "
                                    + "client error: "
                                    + result.httpStatus
                    );

                    /*
                     * We intentionally leave the SMS
                     * unprocessed here.
                     *
                     * This keeps the diagnostic evidence
                     * available for another attempt.
                     */
                    return Result.failure();
                }

                /* =============================================
                   SERVER ERROR
                ============================================= */

                if (
                        result.httpStatus >= 500
                ) {

                    Log.w(
                            TAG,
                            "Diagnostic API server error."
                                    + " Retrying."
                    );

                    return Result.retry();
                }

                /* =============================================
                   NETWORK / UNKNOWN ERROR
                ============================================= */

                Log.w(
                        TAG,
                        "No valid HTTP response."
                                + " Retrying."
                );

                return Result.retry();
            }

            /* =================================================
               CHECK FOR REMAINING PENDING SMS
            ================================================= */

            int remaining =
                    store.countPending(
                            cutoff,
                            now
                    );

            Log.i(
                    TAG,
                    "Remaining pending SMS: "
                            + remaining
            );

            if (
                    remaining > 0 &&
                    processedThisRun > 0
            ) {

                Log.i(
                        TAG,
                        "More diagnostic SMS remain."
                                + " Enqueuing another run."
                );

                enqueueNow(
                        getApplicationContext()
                );
            }

            Log.i(
                    TAG,
                    "================================================"
            );

            Log.i(
                    TAG,
                    "SMS DIAGNOSTIC WORKER FINISHED"
            );

            Log.i(
                    TAG,
                    "Processed this run: "
                            + processedThisRun
            );

            Log.i(
                    TAG,
                    "================================================"
            );

            return Result.success();

        } catch (Exception error) {

            Log.e(
                    TAG,
                    "Diagnostic worker failed.",
                    error
            );

            return Result.retry();

        } finally {

            /*
             * SmsQueueStore does not expose a close()
             * method. Do not call store.close().
             *
             * Its SQLiteOpenHelper is owned by the store.
             */
        }
    }

    /* =====================================================
       SEND DIAGNOSTIC SMS
    ===================================================== */

    private DiagnosticResult sendDiagnostic(
            @NonNull SmsQueueStore.SmsMessage sms,
            long workerStartedAt,
            long workerSentAt
    ) {

        HttpURLConnection connection =
                null;

        try {

            URL url =
                    new URL(
                            API_ENDPOINT
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

            connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
            );

            connection.setRequestProperty(
                    "Accept",
                    "application/json"
            );

            /* =================================================
               JSON
            ================================================= */

            JSONObject json =
                    new JSONObject();

            json.put(
                    "smsId",
                    sms.getId()
            );

            json.put(
                    "address",
                    sms.getAddress()
            );

            json.put(
                    "body",
                    sms.getBody()
            );

            json.put(
                    "date",
                    sms.getSmsDate()
            );

            json.put(
                    "receivedAt",
                    sms.getReceivedAt()
            );

            json.put(
                    "workerStartedAt",
                    workerStartedAt
            );

            json.put(
                    "workerSentAt",
                    workerSentAt
            );

            String payload =
                    json.toString();

            Log.d(
                    TAG,
                    "Sending JSON: "
                            + payload
            );

            /* =================================================
               WRITE REQUEST
            ================================================= */

            byte[] requestBytes =
                    payload.getBytes(
                            StandardCharsets.UTF_8
                    );

            connection.setFixedLengthStreamingMode(
                    requestBytes.length
            );

            try (
                    OutputStream output =
                            connection.getOutputStream()
            ) {

                output.write(
                        requestBytes
                );

                output.flush();
            }

            /* =================================================
               RESPONSE
            ================================================= */

            int status =
                    connection.getResponseCode();

            InputStream inputStream;

            if (
                    status >= 200 &&
                    status < 400
            ) {

                inputStream =
                        connection.getInputStream();

            } else {

                inputStream =
                        connection.getErrorStream();
            }

            String responseBody =
                    readResponse(
                            inputStream
                    );

            return new DiagnosticResult(
                    status,
                    responseBody
            );

        } catch (
                IOException error
        ) {

            Log.e(
                    TAG,
                    "HTTP/network failure.",
                    error
            );

            return new DiagnosticResult(
                    -1,
                    error.getMessage() != null
                            ? error.getMessage()
                            : "Network error"
            );

        } catch (
                Exception error
        ) {

            Log.e(
                    TAG,
                    "Unexpected HTTP failure.",
                    error
            );

            return new DiagnosticResult(
                    -1,
                    error.getMessage() != null
                            ? error.getMessage()
                            : "Unexpected error"
            );

        } finally {

            if (
                    connection != null
            ) {

                connection.disconnect();
            }
        }
    }

    /* =====================================================
       READ RESPONSE
    ===================================================== */

    @NonNull
    private String readResponse(
            InputStream inputStream
    ) {

        if (
                inputStream == null
        ) {

            return "";
        }

        StringBuilder result =
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

                result.append(
                        line
                );
            }

        } catch (
                IOException error
        ) {

            Log.e(
                    TAG,
                    "Failed reading API response.",
                    error
            );

            return "Unable to read response: "
                    + error.getMessage();
        }

        return result.toString();
    }

    /* =====================================================
       ENQUEUE NOW
    ===================================================== */

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
                        SmsDiagnosticWorker.class
                )
                        .setConstraints(
                                constraints
                        )
                        .setBackoffCriteria(
                                androidx.work.BackoffPolicy.EXPONENTIAL,
                                30,
                                TimeUnit.SECONDS
                        )
                        .build();

        WorkManager
                .getInstance(
                        context.getApplicationContext()
                )
                .enqueueUniqueWork(
                        UNIQUE_WORK_NAME,
                        ExistingWorkPolicy.KEEP,
                        request
                );

        Log.i(
                TAG,
                "Diagnostic worker enqueued."
        );
    }

    /* =====================================================
       RESULT
    ===================================================== */

    private static final class DiagnosticResult {

        final int httpStatus;

        final String responseBody;

        DiagnosticResult(
                int httpStatus,
                @NonNull String responseBody
        ) {
            this.httpStatus =
                    httpStatus;

            this.responseBody =
                    responseBody;
        }
    }
}