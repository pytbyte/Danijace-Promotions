package com.pytbyte.geoshua;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * =========================================================
 * GEO-SHUA
 * SMS RECOVERY SWEEP
 * =========================================================
 *
 * PURPOSE
 * ---------------------------------------------------------
 *
 * Recovery mechanism for bank SMS messages that may have
 * been missed by the real-time SMS_RECEIVED receiver.
 *
 * PRIMARY FLOW
 *
 *     Bank SMS
 *        ↓
 *     SmsReceiver
 *        ↓
 *     /api/sms/process
 *
 * RECOVERY FLOW
 *
 *     AlarmManager
 *        ↓
 *     SmsSweepReceiver
 *        ↓
 *     Recent SMS inbox
 *        ↓
 *     lightweight local filter
 *        ↓
 *     /api/sms/process
 *
 * =========================================================
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * This class does NOT:
 *
 * - identify members
 * - classify savings vs loan
 * - calculate balances
 * - create financial records
 * - access MongoDB
 *
 * The server remains authoritative.
 *
 * =========================================================
 */
public class SmsSweepReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsSweep";

    /**
     * =====================================================
     * PRODUCTION API
     * =====================================================
     */
    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

    /**
     * =====================================================
     * SWEEP CONFIGURATION
     * =====================================================
     *
     * Run approximately once every hour.
     *
     * Android may delay execution because of:
     *
     * - Doze
     * - battery optimization
     * - device sleep
     * - OEM background restrictions
     *
     * Therefore this should be treated as approximate.
     */
    private static final long SWEEP_INTERVAL_MS =
        60L * 60L * 1000L;

    /**
     * Look back two hours.
     *
     * The sweep runs approximately every hour, but Android
     * can delay alarms.
     *
     * A two-hour window protects against a delayed sweep
     * leaving an SMS unprocessed.
     *
     * Server-side idempotency MUST prevent duplicate
     * financial transactions.
     */
    private static final long LOOKBACK_MS =
        2L * 60L * 60L * 1000L;

    /**
     * First execution after scheduling.
     *
     * One minute gives the application time to finish
     * startup before the first recovery operation.
     */
    private static final long FIRST_RUN_DELAY_MS =
        60L * 1000L;

    /**
     * Stable PendingIntent request code.
     */
    private static final int REQUEST_CODE =
        9001;

    /**
     * HTTP connection timeout.
     */
    private static final int CONNECT_TIMEOUT_MS =
        10_000;

    /**
     * HTTP response timeout.
     */
    private static final int READ_TIMEOUT_MS =
        15_000;

    /* =====================================================
       SCHEDULE
    ===================================================== */

    /**
     * Schedule the hourly SMS recovery sweep.
     *
     * Safe to call repeatedly because the same
     * PendingIntent identity is used.
     */
    public static void schedule(
        Context context
    ) {
        if (context == null) {
            return;
        }

        Context applicationContext =
            context.getApplicationContext();

        AlarmManager alarmManager =
            (AlarmManager)
                applicationContext.getSystemService(
                    Context.ALARM_SERVICE
                );

        if (alarmManager == null) {
            Log.w(
                TAG,
                "AlarmManager unavailable."
            );

            return;
        }

        Intent intent =
            new Intent(
                applicationContext,
                SmsSweepReceiver.class
            );

        PendingIntent pendingIntent =
            PendingIntent.getBroadcast(
                applicationContext,
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT
                    | PendingIntent.FLAG_IMMUTABLE
            );

        long firstRun =
            System.currentTimeMillis()
                + FIRST_RUN_DELAY_MS;

        /*
         * Inexact repeating is preferred here.
         *
         * This allows Android to batch the alarm with other
         * background work and therefore reduces battery use.
         */
        alarmManager.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            firstRun,
            SWEEP_INTERVAL_MS,
            pendingIntent
        );

        Log.d(
            TAG,
            "Hourly SMS recovery sweep scheduled."
        );
    }

    /* =====================================================
       CANCEL
    ===================================================== */

    /**
     * Cancel the hourly recovery sweep.
     */
    public static void cancel(
        Context context
    ) {
        if (context == null) {
            return;
        }

        Context applicationContext =
            context.getApplicationContext();

        AlarmManager alarmManager =
            (AlarmManager)
                applicationContext.getSystemService(
                    Context.ALARM_SERVICE
                );

        if (alarmManager == null) {
            return;
        }

        Intent intent =
            new Intent(
                applicationContext,
                SmsSweepReceiver.class
            );

        PendingIntent pendingIntent =
            PendingIntent.getBroadcast(
                applicationContext,
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_NO_CREATE
                    | PendingIntent.FLAG_IMMUTABLE
            );

        if (pendingIntent == null) {
            return;
        }

        alarmManager.cancel(
            pendingIntent
        );

        pendingIntent.cancel();

        Log.d(
            TAG,
            "SMS recovery sweep cancelled."
        );
    }

    /* =====================================================
       RECEIVE
    ===================================================== */

    @Override
    public void onReceive(
        final Context context,
        Intent intent
    ) {
        if (context == null) {
            return;
        }

        /*
         * Network and ContentResolver operations should not
         * execute directly on the BroadcastReceiver thread.
         */
        final PendingResult pendingResult =
            goAsync();

        final Context applicationContext =
            context.getApplicationContext();

        Thread worker =
            new Thread(
                () -> {
                    try {
                        sweepRecentSms(
                            applicationContext
                        );

                    } catch (Exception e) {
                        Log.e(
                            TAG,
                            "SMS recovery sweep failed.",
                            e
                        );

                    } finally {
                        pendingResult.finish();
                    }
                },
                "GeoShuaSmsRecovery"
            );

        worker.start();
    }

    /* =====================================================
       SMS SWEEP
    ===================================================== */

    private void sweepRecentSms(
        Context context
    ) {
        final long now =
            System.currentTimeMillis();

        final long cutoff =
            now - LOOKBACK_MS;

        Uri uri =
            Uri.parse(
                "content://sms/inbox"
            );

        Cursor cursor =
            null;

        int scannedCount =
            0;

        int matchedCount =
            0;

        int submittedCount =
            0;

        int failedCount =
            0;

        try {
            cursor =
                context
                    .getContentResolver()
                    .query(
                        uri,

                        /*
                         * Only request columns that we actually
                         * need.
                         */
                        new String[] {
                            "_id",
                            "address",
                            "body",
                            "date"
                        },

                        /*
                         * Restrict the query at the ContentProvider
                         * level instead of retrieving the entire
                         * inbox.
                         */
                        "date >= ?",

                        new String[] {
                            String.valueOf(
                                cutoff
                            )
                        },

                        /*
                         * Oldest first.
                         *
                         * This allows recovery to submit older
                         * missed messages before newer ones.
                         */
                        "date ASC"
                    );

            if (cursor == null) {
                Log.w(
                    TAG,
                    "SMS inbox query returned null."
                );

                return;
            }

            int addressIndex =
                cursor.getColumnIndex(
                    "address"
                );

            int bodyIndex =
                cursor.getColumnIndex(
                    "body"
                );

            int dateIndex =
                cursor.getColumnIndex(
                    "date"
                );

            while (
                cursor.moveToNext()
            ) {
                scannedCount++;

                /*
                 * Read address.
                 */
                String address =
                    addressIndex >= 0
                        ? cursor.getString(
                            addressIndex
                        )
                        : null;

                /*
                 * Read message body.
                 */
                String body =
                    bodyIndex >= 0
                        ? cursor.getString(
                            bodyIndex
                        )
                        : null;

                /*
                 * Read SMS timestamp.
                 */
                long date =
                    dateIndex >= 0
                        ? cursor.getLong(
                            dateIndex
                        )
                        : 0L;

                /*
                 * Reject malformed messages immediately.
                 */
                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {
                    continue;
                }

                if (date <= 0L) {
                    continue;
                }

                /*
                 * Lightweight local filter.
                 *
                 * This prevents unrelated SMS messages from
                 * being sent over the network.
                 */
                if (
                    !looksLikeBankTransaction(
                        body
                    )
                ) {
                    continue;
                }

                matchedCount++;

                /*
                 * Build request only after the message has
                 * passed the local filter.
                 */
                String json =
                    buildJson(
                        address,
                        body,
                        date
                    );

                /*
                 * Do not count failed requests as submitted.
                 */
                if (
                    postJson(
                        PROCESS_URL,
                        json
                    )
                ) {
                    submittedCount++;

                } else {
                    failedCount++;
                }
            }

        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        Log.d(
            TAG,
            "SMS recovery completed. "
                + "scanned="
                + scannedCount
                + ", matched="
                + matchedCount
                + ", submitted="
                + submittedCount
                + ", failed="
                + failedCount
        );
    }

    /* =====================================================
       LOCAL BANK FILTER
    ===================================================== */

    /**
     * Lightweight pre-filter.
     *
     * IMPORTANT:
     *
     * This method does NOT decide whether a transaction
     * belongs to savings or loans.
     *
     * It does NOT identify the member.
     *
     * It does NOT create financial records.
     *
     * Its only purpose is to avoid sending obviously
     * unrelated SMS messages to the server.
     */
    private boolean looksLikeBankTransaction(
        String body
    ) {
        if (body == null) {
            return false;
        }

        String normalized =
            body
                .replaceAll(
                    "\\s+",
                    " "
                )
                .trim()
                .toLowerCase();

        /*
         * GEO-SHUA currently expects bank transaction SMS
         * containing these characteristics.
         */
        return
            normalized.contains(
                "confirmed"
            )
            &&
            normalized.contains(
                "kes"
            )
            &&
            normalized.contains(
                "received from"
            )
            &&
            normalized.contains(
                "for account"
            );
    }

    /* =====================================================
       BUILD JSON
    ===================================================== */

    /**
     * Build the minimal payload required by the server.
     */
    private String buildJson(
        String address,
        String body,
        long date
    ) {
        return "{"
            + "\"address\":"
            + quote(address)
            + ","
            + "\"body\":"
            + quote(body)
            + ","
            + "\"date\":"
            + date
            + "}";
    }

    /* =====================================================
       JSON ESCAPING
    ===================================================== */

    /**
     * Safely escape an SMS field for JSON.
     *
     * This avoids introducing a JSON dependency solely for
     * three simple fields.
     */
    private String quote(
        String value
    ) {
        if (value == null) {
            return "null";
        }

        return "\""
            + value
                .replace(
                    "\\",
                    "\\\\"
                )
                .replace(
                    "\"",
                    "\\\""
                )
                .replace(
                    "\n",
                    "\\n"
                )
                .replace(
                    "\r",
                    "\\r"
                )
                .replace(
                    "\t",
                    "\\t"
                )
            + "\"";
    }

    /* =====================================================
       HTTP POST
    ===================================================== */

    /**
     * Send one SMS to the authoritative server.
     *
     * Returns:
     *
     *     true  = HTTP response received
     *     false = request failed
     *
     * A HTTP 4xx/5xx response is still considered a completed
     * HTTP request, but is NOT treated as a successful
     * submission.
     */
    private boolean postJson(
        String endpoint,
        String json
    ) {
        HttpURLConnection connection =
            null;

        try {
            URL url =
                new URL(endpoint);

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
                "application/json; charset=UTF-8"
            );

            connection.setRequestProperty(
                "Accept",
                "application/json"
            );

            byte[] payload =
                json.getBytes(
                    StandardCharsets.UTF_8
                );

            connection.setFixedLengthStreamingMode(
                payload.length
            );

            try (
                OutputStream output =
                    connection.getOutputStream()
            ) {
                output.write(
                    payload
                );
            }

            int responseCode =
                connection.getResponseCode();

            /*
             * Read the response only for logging/debugging.
             *
             * The response is capped to avoid wasting memory
             * if the server ever returns an unexpectedly large
             * response.
             */
            InputStream stream =
                responseCode >= 200
                    && responseCode < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();

            String response =
                readResponse(
                    stream
                );

            Log.d(
                TAG,
                "API response: HTTP "
                    + responseCode
                    + " "
                    + response
            );

            /*
             * Only HTTP 2xx is considered successful.
             */
            return
                responseCode >= 200
                &&
                responseCode < 300;

        } catch (Exception e) {
            Log.e(
                TAG,
                "Failed forwarding recovery SMS.",
                e
            );

            return false;

        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /* =====================================================
       READ RESPONSE
    ===================================================== */

    /**
     * Read a small server response.
     *
     * The server response is not needed for financial logic.
     * It is only useful for diagnostics.
     */
    private String readResponse(
        InputStream stream
    ) {
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
                (line = reader.readLine()) != null
            ) {
                /*
                 * Prevent an unexpectedly large response
                 * from consuming excessive memory.
                 */
                if (
                    result.length()
                        >= 2_000
                ) {
                    result.append(
                        "...[truncated]"
                    );

                    break;
                }

                result.append(
                    line
                );
            }

        } catch (Exception e) {
            Log.e(
                TAG,
                "Unable to read API response.",
                e
            );
        }

        return result.toString();
    }
}