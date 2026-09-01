package com.pytbyte.geoshua;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * =========================================================
 * GEO-SHUA
 * SMS RECOVERY SWEEP
 * =========================================================
 *
 * PRIMARY SMS FLOW
 * ---------------------------------------------------------
 *
 * NEW SMS
 *   ↓
 * SmsReceiver
 *   ↓
 * /api/sms/process
 *
 *
 * RECOVERY FLOW
 * ---------------------------------------------------------
 *
 * Approximately every hour
 *   ↓
 * SmsBootReceiver
 *   ↓
 * Read recent inbox SMS
 *   ↓
 * Lightweight local filter
 *   ↓
 * /api/sms/process
 *
 *
 * =========================================================
 * PURPOSE
 * =========================================================
 *
 * This receiver exists ONLY as a recovery mechanism.
 *
 * It protects against situations where:
 *
 * - Android delays SMS delivery.
 * - SMS_RECEIVED is temporarily suppressed.
 * - The application was not running normally.
 * - The real-time receiver missed an SMS.
 *
 *
 * The server remains authoritative.
 *
 *
 * THIS CLASS DOES NOT:
 *
 * - resolve members
 * - identify SACCO members
 * - classify savings vs loan
 * - create savings transactions
 * - create loan repayments
 * - calculate balances
 * - access MongoDB
 *
 *
 * =========================================================
 * IMPORTANT
 * =========================================================
 *
 * Filename:
 *
 *     SmsBootReceiver.java
 *
 * Class:
 *
 *     SmsBootReceiver
 *
 * These MUST remain identical.
 */
public class SmsBootReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsSweep";

    /* =====================================================
       SERVER
    ===================================================== */

    /**
     * Production API endpoint.
     *
     * Replace this with the real GEO-SHUA deployment.
     */
    private static final String PROCESS_URL =
        "https://YOUR-PUBLIC-DOMAIN.vercel.app/api/sms/process";

    /* =====================================================
       RECOVERY CONFIGURATION
    ===================================================== */

    /**
     * Recovery frequency.
     *
     * Approximately once every hour.
     *
     * Android may move the exact execution time because
     * this uses an inexact alarm.
     */
    private static final long SWEEP_INTERVAL_MS =
        60L * 60L * 1000L;

    /**
     * Look back one hour plus a small safety overlap.
     *
     * The overlap protects against:
     *
     * - delayed alarms
     * - device sleep
     * - Doze
     * - temporary scheduling delays
     *
     * Duplicate submission is safe because the server
     * must enforce SMS idempotency using smsId.
     */
    private static final long LOOKBACK_MS =
        70L * 60L * 1000L;

    /**
     * First execution after scheduling.
     *
     * We do not need to run immediately because the
     * real-time SmsReceiver is the primary path.
     */
    private static final long FIRST_RUN_DELAY_MS =
        60L * 1000L;

    /**
     * Stable PendingIntent request code.
     */
    private static final int REQUEST_CODE =
        9001;

    /**
     * Maximum number of SMS records processed in one sweep.
     *
     * This prevents a pathological inbox or unusually delayed
     * sweep from creating excessive network work.
     */
    private static final int MAX_MESSAGES_PER_SWEEP =
        50;

    /**
     * Network connect timeout.
     */
    private static final int CONNECT_TIMEOUT_MS =
        10_000;

    /**
     * Network read timeout.
     */
    private static final int READ_TIMEOUT_MS =
        15_000;

    /**
     * Maximum response characters written to Logcat.
     */
    private static final int MAX_LOG_RESPONSE_LENGTH =
        1000;

    /* =====================================================
       SCHEDULE
    ===================================================== */

    /**
     * Schedule the hourly recovery sweep.
     *
     * Safe to call repeatedly.
     *
     * The same PendingIntent identifies the same alarm.
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
                SmsBootReceiver.class
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
     * Cancel the recovery sweep.
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
                SmsBootReceiver.class
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
         * SMS inbox access requires READ_SMS.
         *
         * Do not attempt the query when permission is missing.
         */
        if (
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(
                TAG,
                "READ_SMS permission is not granted. "
                    + "Skipping recovery sweep."
            );

            return;
        }

        /*
         * AlarmManager receivers have a limited execution
         * window.
         *
         * goAsync() allows our worker to finish while keeping
         * the BroadcastReceiver alive temporarily.
         */
        final PendingResult pendingResult =
            goAsync();

        Thread worker =
            new Thread(
                () -> {
                    try {
                        sweepRecentSms(
                            context.getApplicationContext()
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
        /*
         * Use wall-clock time because the SMS provider's
         * "date" column uses epoch milliseconds.
         */
        long now =
            System.currentTimeMillis();

        long cutoff =
            now - LOOKBACK_MS;

        Uri uri =
            Uri.parse(
                "content://sms/inbox"
            );

        Cursor cursor =
            null;

        int submittedCount =
            0;

        int skippedCount =
            0;

        int scannedCount =
            0;

        /*
         * Prevent accidental duplicate submission inside
         * the same cursor iteration.
         *
         * The server still remains the real idempotency layer.
         */
        Set<String> submittedSmsIds =
            new HashSet<>();

        try {
            cursor =
                context
                    .getContentResolver()
                    .query(
                        uri,

                        new String[] {
                            "_id",
                            "address",
                            "body",
                            "date"
                        },

                        "date >= ? AND date <= ?",

                        new String[] {
                            String.valueOf(
                                cutoff
                            ),
                            String.valueOf(
                                now
                            )
                        },

                        "date ASC"
                    );

            if (cursor == null) {
                Log.w(
                    TAG,
                    "SMS provider returned null cursor."
                );

                return;
            }

            int idIndex =
                cursor.getColumnIndex(
                    "_id"
                );

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

            if (
                idIndex < 0 ||
                bodyIndex < 0 ||
                dateIndex < 0
            ) {
                Log.e(
                    TAG,
                    "Required SMS columns are unavailable."
                );

                return;
            }

            while (
                cursor.moveToNext()
            ) {
                scannedCount++;

                /*
                 * Protect the worker from an unexpectedly large
                 * inbox result.
                 */
                if (
                    scannedCount >
                    MAX_MESSAGES_PER_SWEEP
                ) {
                    Log.w(
                        TAG,
                        "Sweep message limit reached: "
                            + MAX_MESSAGES_PER_SWEEP
                    );

                    break;
                }

                String smsId =
                    cursor.getString(
                        idIndex
                    );

                String address =
                    addressIndex >= 0
                        ? cursor.getString(
                            addressIndex
                        )
                        : null;

                String body =
                    cursor.getString(
                        bodyIndex
                    );

                long date =
                    cursor.getLong(
                        dateIndex
                    );

                /*
                 * Malformed SMS row.
                 */
                if (
                    smsId == null ||
                    smsId.trim().isEmpty()
                ) {
                    skippedCount++;
                    continue;
                }

                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {
                    skippedCount++;
                    continue;
                }

                if (
                    date <= 0L
                ) {
                    skippedCount++;
                    continue;
                }

                /*
                 * Additional timestamp protection.
                 */
                if (
                    date < cutoff ||
                    date > now
                ) {
                    skippedCount++;
                    continue;
                }

                /*
                 * Prevent duplicate submission during the same
                 * sweep.
                 */
                if (
                    submittedSmsIds.contains(
                        smsId
                    )
                ) {
                    skippedCount++;
                    continue;
                }

                /*
                 * Cheap local filter.
                 *
                 * This is deliberately conservative.
                 *
                 * The server remains responsible for deciding
                 * whether this is an actual GEO-SHUA transaction.
                 */
                if (
                    !looksLikeBankTransaction(
                        body
                    )
                ) {
                    skippedCount++;
                    continue;
                }

                String json =
                    buildJson(
                        smsId,
                        address,
                        body,
                        date
                    );

                /*
                 * Network call occurs on the worker thread,
                 * never on Android's main thread.
                 */
                boolean submitted =
                    postJson(
                        PROCESS_URL,
                        json
                    );

                if (submitted) {
                    submittedSmsIds.add(
                        smsId
                    );

                    submittedCount++;
                }
            }

            Log.d(
                TAG,
                "SMS recovery sweep completed. "
                    + "Scanned="
                    + scannedCount
                    + ", submitted="
                    + submittedCount
                    + ", skipped="
                    + skippedCount
            );

        } catch (
            SecurityException e
        ) {
            /*
             * Permission may have been revoked between the
             * initial permission check and the query.
             */
            Log.e(
                TAG,
                "SMS permission denied during recovery sweep.",
                e
            );

        } catch (
            Exception e
        ) {
            Log.e(
                TAG,
                "Unexpected SMS recovery error.",
                e
            );

        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    /* =====================================================
       LIGHTWEIGHT BANK FILTER
    ===================================================== */

    /**
     * Cheap local filter.
     *
     * IMPORTANT:
     *
     * This method does NOT determine:
     *
     * - member identity
     * - savings
     * - loan repayment
     * - transaction validity
     *
     * It only prevents obviously unrelated SMS messages from
     * being sent to the API.
     *
     * The server parser remains authoritative.
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
                .toLowerCase(
                    Locale.ROOT
                );

        /*
         * GEO-SHUA's current bank SMS pattern.
         *
         * Example structure:
         *
         * Confirmed
         * KES ...
         * received from ...
         * for account ...
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
     * Build the request sent to /api/sms/process.
     *
     * smsId is the Android SMS provider's stable row ID.
     *
     * This should be persisted server-side and used as part
     * of the idempotency strategy.
     */
    private String buildJson(
        String smsId,
        String address,
        String body,
        long date
    ) {
        return "{"
            + "\"smsId\":"
            + quote(
                smsId
            )
            + ","
            + "\"address\":"
            + quote(
                address
            )
            + ","
            + "\"body\":"
            + quote(
                body
            )
            + ","
            + "\"date\":"
            + date
            + "}";
    }

    /* =====================================================
       JSON ESCAPING
    ===================================================== */

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
                .replace(
                    "\b",
                    "\\b"
                )
                .replace(
                    "\f",
                    "\\f"
                )
            + "\"";
    }

    /* =====================================================
       HTTP POST
    ===================================================== */

    /**
     * Forward one SMS to the authoritative server.
     *
     * Returns true ONLY for a successful 2xx HTTP response.
     *
     * This is important.
     *
     * A 400, 401, 404, 409, 500 etc. is NOT considered a
     * successful submission.
     */
    private boolean postJson(
        String endpoint,
        String json
    ) {
        HttpURLConnection connection =
            null;

        try {
            URL url =
                new URL(
                    endpoint
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

                output.flush();
            }

            int responseCode =
                connection.getResponseCode();

            InputStream stream =
                responseCode >= 200
                    && responseCode < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();

            String response =
                readStream(
                    stream
                );

            String safeResponse =
                truncateForLog(
                    response
                );

            if (
                responseCode >= 200
                    && responseCode < 300
            ) {
                Log.d(
                    TAG,
                    "SMS recovery API success. HTTP "
                        + responseCode
                        + " "
                        + safeResponse
                );

                return true;
            }

            Log.w(
                TAG,
                "SMS recovery API rejected request. HTTP "
                    + responseCode
                    + " "
                    + safeResponse
            );

            return false;

        } catch (
            Exception e
        ) {
            /*
             * Network failure is non-fatal.
             *
             * The next hourly sweep will retry the SMS because
             * the server was not confirmed to have accepted it.
             */
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

    private String readStream(
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
                result.append(
                    line
                );
            }

        } catch (
            Exception e
        ) {
            Log.e(
                TAG,
                "Unable to read recovery API response.",
                e
            );
        }

        return result.toString();
    }

    /* =====================================================
       LOG RESPONSE LIMIT
    ===================================================== */

    private String truncateForLog(
        String value
    ) {
        if (value == null) {
            return "";
        }

        if (
            value.length()
            <= MAX_LOG_RESPONSE_LENGTH
        ) {
            return value;
        }

        return value.substring(
            0,
            MAX_LOG_RESPONSE_LENGTH
        ) + "...";
    }
}