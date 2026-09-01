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
 * GEO-SHUA
 *
 * SMS RECOVERY SWEEP
 *
 * Responsibility:
 *
 *  - Periodically inspect the Android SMS inbox.
 *  - Find recent bank transaction messages.
 *  - Forward them to the SAME server endpoint used by
 *    SmsReceiver.
 *
 * This class does NOT:
 *
 *  - classify savings vs loan
 *  - identify members
 *  - calculate balances
 *  - write MongoDB
 *  - create financial transactions
 *
 * The server remains authoritative:
 *
 * inbox
 *   ↓
 * /api/sms/process
 *   ↓
 * parser
 *   ↓
 * processIncomingTransaction()
 *   ↓
 * savings / loan service
 *
 * Duplicate submissions are intentionally safe because
 * the existing financial services provide idempotency.
 */
public class SmsSweepReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsSweep";

    /**
     * Production GEO-SHUA API.
     */
    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

    /**
     * Requested sweep interval.
     *
     * Android may defer this because of battery/doze
     * restrictions. It is therefore a recovery interval,
     * not a guaranteed exact execution time.
     */
    private static final long SWEEP_INTERVAL_MS =
        5 * 60 * 1000L;

    /**
     * Look back farther than the sweep interval so a delayed
     * alarm does not leave a gap.
     */
    private static final long LOOKBACK_MS =
        10 * 60 * 1000L;

    private static final int REQUEST_CODE =
        9001;

    /* =====================================================
       SCHEDULE
    ===================================================== */

    /**
     * Start the repeating SMS recovery sweep.
     *
     * Safe to call repeatedly.
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
                "AlarmManager is unavailable."
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

        /*
         * Run the first recovery shortly after the app
         * starts, then continue periodically.
         */
        long firstRun =
            System.currentTimeMillis()
                + 30_000L;

        /*
         * Inexact repeating is deliberate.
         *
         * Android may move execution for battery efficiency.
         */
        alarmManager.setInexactRepeating(
            AlarmManager.RTC_WAKEUP,
            firstRun,
            SWEEP_INTERVAL_MS,
            pendingIntent
        );

        Log.d(
            TAG,
            "SMS recovery sweep scheduled."
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
        /*
         * A manifest-declared receiver is allowed to receive
         * this callback from AlarmManager without requiring
         * a special custom action.
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
       SWEEP
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
                    "SMS sweep returned a null cursor."
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

            int count =
                0;

            while (cursor.moveToNext()) {

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

                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {
                    continue;
                }

                /*
                 * Cheap local filter only.
                 *
                 * The actual parser on the server decides
                 * whether the message is valid.
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

                count++;
            }

            Log.d(
                TAG,
                "SMS recovery sweep completed. "
                    + count
                    + " bank-like message(s) submitted."
            );

        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    /* =====================================================
       BANK SMS FILTER
    ===================================================== */

    /**
     * This is deliberately broad.
     *
     * We do NOT determine savings or loan here.
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
       JSON
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
       HTTP POST
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
                "Sweep API response: HTTP "
                    + responseCode
                    + " "
                    + response
            );

        } catch (Exception e) {
            /*
             * A failed sweep must never crash the app.
             *
             * The next sweep will try again.
             */
            Log.e(
                TAG,
                "Failed forwarding sweep SMS.",
                e
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
                "Unable to read sweep API response.",
                e
            );
        }

        return result.toString();
    }
}