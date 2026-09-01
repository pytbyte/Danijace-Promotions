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
 * This receiver is ONLY a recovery mechanism.
 *
 * The primary SMS processing path is:
 *
 *     NEW SMS
 *        ↓
 *     SmsReceiver
 *        ↓
 *     /api/sms/process
 *
 * This sweep exists in case Android misses, delays, or
 * suppresses the real-time SMS broadcast.
 *
 * RESPONSIBILITIES
 * ---------------------------------------------------------
 *
 * - Periodically inspect recent SMS inbox messages.
 * - Select only messages that look like bank transactions.
 * - Forward them to the SAME server endpoint used by
 *   SmsReceiver.
 *
 * THIS CLASS DOES NOT:
 *
 * - identify members
 * - classify savings vs loan
 * - create savings transactions
 * - create loan repayments
 * - calculate balances
 * - access MongoDB directly
 *
 * The server remains authoritative.
 *
 * =========================================================
 */
public class SmsBootReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsSweep";

    /**
     * Production GEO-SHUA endpoint.
     */
    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

    /**
     * =====================================================
     * RECOVERY FREQUENCY
     * =====================================================
     *
     * We deliberately do NOT poll aggressively.
     *
     * Real-time SMS_RECEIVED handling is the primary path.
     *
     * This sweep runs approximately every 15 minutes as
     * a recovery mechanism only.
     *
     * Android may delay execution further because of
     * Doze/battery optimization.
     */
    private static final long SWEEP_INTERVAL_MS =
        15 * 60 * 1000L;

    /**
     * Look back 30 minutes.
     *
     * This is deliberately wider than the 15-minute sweep
     * interval so a delayed alarm does not create a gap.
     *
     * Reprocessing an SMS is safe because the existing
     * server financial services are idempotent.
     */
    private static final long LOOKBACK_MS =
        30 * 60 * 1000L;

    /**
     * Stable PendingIntent request code.
     */
    private static final int REQUEST_CODE =
        9001;

    /* =====================================================
       SCHEDULE
    ===================================================== */

    /**
     * Schedule the lightweight recovery sweep.
     *
     * Safe to call multiple times because the same
     * PendingIntent identifies the same alarm.
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
                PendingIntent.FLAG_UPDATE_CURRENT |
                PendingIntent.FLAG_IMMUTABLE
            );

        /**
         * Do not run the sweep immediately.
         *
         * Give the application/device time to settle after
         * startup before scheduling recovery work.
         */
        long firstRun =
            System.currentTimeMillis()
                + 60_000L;

        /**
         * Inexact repeating is intentional.
         *
         * Android may shift execution slightly to conserve
         * battery and group background work.
         */
        alarmManager.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            firstRun,
            SWEEP_INTERVAL_MS,
            pendingIntent
        );

        Log.d(
            TAG,
            "SMS recovery sweep scheduled: approximately every 15 minutes."
        );
    }

    /* =====================================================
       CANCEL
    ===================================================== */

    /**
     * Cancel the recovery sweep.
     *
     * Normally this does not need to be called.
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
                PendingIntent.FLAG_NO_CREATE |
                PendingIntent.FLAG_IMMUTABLE
            );

        if (pendingIntent != null) {
            alarmManager.cancel(
                pendingIntent
            );

            pendingIntent.cancel();

            Log.d(
                TAG,
                "SMS recovery sweep cancelled."
            );
        }
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

        /**
         * AlarmManager callbacks must finish reasonably
         * quickly.
         *
         * goAsync() gives the receiver additional execution
         * time while the network operation runs.
         */
        final PendingResult pendingResult =
            goAsync();

        new Thread(() -> {
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
        }).start();
    }

    /* =====================================================
       RECENT SMS SWEEP
    ===================================================== */

    private void sweepRecentSms(
        Context context
    ) {
        long cutoff =
            System.currentTimeMillis()
                - LOOKBACK_MS;

        Uri uri =
            Uri.parse(
                "content://sms/inbox"
            );

        Cursor cursor =
            null;

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

                        "date >= ?",

                        new String[] {
                            String.valueOf(
                                cutoff
                            )
                        },

                        "date DESC"
                    );

            if (cursor == null) {
                Log.w(
                    TAG,
                    "SMS recovery query returned null cursor."
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

            int submittedCount =
                0;

            while (
                cursor.moveToNext()
            ) {
                String address =
                    addressIndex >= 0
                        ? cursor.getString(
                            addressIndex
                        )
                        : null;

                String body =
                    bodyIndex >= 0
                        ? cursor.getString(
                            bodyIndex
                        )
                        : null;

                long date =
                    dateIndex >= 0
                        ? cursor.getLong(
                            dateIndex
                        )
                        : 0L;

                /*
                 * Ignore malformed inbox rows.
                 */
                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {
                    continue;
                }

                /*
                 * Ignore ordinary SMS messages.
                 *
                 * This is NOT the authoritative parser.
                 * It is only a cheap local filter to avoid
                 * unnecessary network traffic.
                 */
                if (
                    !looksLikeBankTransaction(
                        body
                    )
                ) {
                    continue;
                }

                String json =
                    buildJson(
                        address,
                        body,
                        date
                    );

                postJson(
                    PROCESS_URL,
                    json
                );

                submittedCount++;
            }

            Log.d(
                TAG,
                "SMS recovery sweep completed. "
                    + submittedCount
                    + " bank-like SMS message(s) submitted."
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
     * Cheap local filter only.
     *
     * The real parser still runs on the server.
     *
     * We intentionally do NOT determine whether the payment
     * is savings or loan here.
     */
    private boolean looksLikeBankTransaction(
        String body
    ) {
        String normalized =
            body
                .toLowerCase()
                .trim();

        return
            normalized.contains(
                "confirmed"
            ) &&
            normalized.contains(
                "kes"
            ) &&
            normalized.contains(
                "received from"
            ) &&
            normalized.contains(
                "for account"
            );
    }

    /* =====================================================
       BUILD REQUEST JSON
    ===================================================== */

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
       SEND TO SERVER
    ===================================================== */

    private void postJson(
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
                10_000
            );

            connection.setReadTimeout(
                15_000
            );

            connection.setDoOutput(
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

            byte[] payload =
                json.getBytes(
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

            int responseCode =
                connection.getResponseCode();

            InputStream stream =
                responseCode >= 200 &&
                responseCode < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();

            String response =
                readStream(stream);

            Log.d(
                TAG,
                "SMS recovery API response: HTTP "
                    + responseCode
                    + " "
                    + response
            );

        } catch (Exception e) {
            /**
             * Never crash the application because a recovery
             * request failed.
             *
             * The next recovery sweep can try again.
             */
            Log.e(
                TAG,
                "Failed forwarding recovery SMS.",
                e
            );

        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /* =====================================================
       READ HTTP RESPONSE
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

        } catch (Exception e) {
            Log.e(
                TAG,
                "Unable to read recovery API response.",
                e
            );
        }

        return result.toString();
    }
}