package com.pytbyte.geoshua;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.provider.Telephony;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * =========================================================
 * GEO-SHUA
 * SMS RECOVERY SWEEP
 * =========================================================
 *
 * Primary:
 *
 * SmsReceiver
 *      ↓
 * API
 *
 * Recovery:
 *
 * SmsSweepReceiver
 *      ↓
 * pending local queue
 *      ↓
 * recent inbox
 *      ↓
 * API
 */
public class SmsSweepReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsSweep";

    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

    /*
     * Approximately hourly.
     */
    private static final long SWEEP_INTERVAL_MS =
        60L * 60L * 1000L;

    /*
     * Slight overlap protects against delayed alarms.
     */
    private static final long LOOKBACK_MS =
        70L * 60L * 1000L;

    private static final long FIRST_RUN_DELAY_MS =
        60L * 1000L;

    private static final int REQUEST_CODE =
        9001;

    private static final int MAX_MESSAGES_PER_SWEEP =
        50;

    private static final int CONNECT_TIMEOUT_MS =
        10_000;

    private static final int READ_TIMEOUT_MS =
        15_000;

    private static final int MAX_RESPONSE_LENGTH =
        1_000;

    /* =====================================================
       SCHEDULE
    ===================================================== */

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

        if (
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(
                TAG,
                "READ_SMS permission is not granted."
            );

            return;
        }

        final PendingResult pendingResult =
            goAsync();

        final Context applicationContext =
            context.getApplicationContext();

        Thread worker =
            new Thread(
                () -> {
                    try {

                        sweep(
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
       SWEEP
    ===================================================== */

    private void sweep(
        Context context
    ) {
        /*
         * First recover messages that were explicitly queued
         * because the real-time receiver could not deliver them.
         */
        flushPendingQueue(context);

        /*
         * Then inspect the recent inbox as a second recovery
         * mechanism.
         */
        sweepRecentInbox(context);
    }

    /* =====================================================
       QUEUE RECOVERY
    ===================================================== */

    private void flushPendingQueue(
        Context context
    ) {
        if (!hasInternet(context)) {

            Log.d(
                TAG,
                "No internet. Pending SMS queue remains untouched."
            );

            return;
        }

        List<SmsQueue.PendingSms> pending =
            SmsQueue.getPending(context);

        if (pending.isEmpty()) {
            return;
        }

        int successCount =
            0;

        int failedCount =
            0;

        Log.d(
            TAG,
            "Attempting pending SMS recovery. count="
                + pending.size()
        );

        for (
            SmsQueue.PendingSms sms :
            pending
        ) {

            String json =
                buildJson(
                    sms.smsId,
                    sms.address,
                    sms.body,
                    sms.date
                );

            boolean success =
                postJson(
                    PROCESS_URL,
                    json
                );

            if (success) {

                SmsQueue.remove(
                    context,
                    sms.smsId
                );

                successCount++;

            } else {

                failedCount++;

                /*
                 * Stop here rather than hammering the server.
                 */
                break;
            }
        }

        Log.d(
            TAG,
            "Pending SMS recovery completed. "
                + "success="
                + successCount
                + ", failed="
                + failedCount
                + ", remaining="
                + SmsQueue.size(context)
        );
    }

    /* =====================================================
       INBOX RECOVERY
    ===================================================== */

    private void sweepRecentInbox(
        Context context
    ) {
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

        int scannedCount =
            0;

        int submittedCount =
            0;

        int queuedCount =
            0;

        int skippedCount =
            0;

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

                if (
                    scannedCount >
                    MAX_MESSAGES_PER_SWEEP
                ) {

                    Log.w(
                        TAG,
                        "Sweep limit reached."
                    );

                    break;
                }

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

                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {
                    skippedCount++;
                    continue;
                }

                if (date <= 0L) {
                    skippedCount++;
                    continue;
                }

                if (
                    date < cutoff ||
                    date > now
                ) {
                    skippedCount++;
                    continue;
                }

                if (
                    !looksLikeBankTransaction(
                        body
                    )
                ) {
                    skippedCount++;
                    continue;
                }

                /*
                 * IMPORTANT:
                 *
                 * The sweep now generates the SAME fingerprint
                 * as SmsReceiver.
                 *
                 * Therefore:
                 *
                 * real-time SMS ID == recovery SMS ID
                 */
                String smsId =
                    createSmsFingerprint(
                        address,
                        body,
                        date
                    );

                if (
                    submittedSmsIds.contains(
                        smsId
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

                if (!hasInternet(context)) {

                    SmsQueue.enqueue(
                        context,
                        smsId,
                        address,
                        body,
                        date
                    );

                    queuedCount++;

                    continue;
                }

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

                } else {

                    /*
                     * The server was not confirmed to have
                     * accepted the message.
                     */
                    SmsQueue.enqueue(
                        context,
                        smsId,
                        address,
                        body,
                        date
                    );

                    queuedCount++;
                }
            }

            Log.d(
                TAG,
                "SMS recovery sweep completed. "
                    + "scanned="
                    + scannedCount
                    + ", submitted="
                    + submittedCount
                    + ", queued="
                    + queuedCount
                    + ", skipped="
                    + skippedCount
                    + ", pending="
                    + SmsQueue.size(context)
            );

        } catch (SecurityException e) {

            Log.e(
                TAG,
                "SMS permission denied during recovery.",
                e
            );

        } catch (Exception e) {

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
       NETWORK
    ===================================================== */

    private boolean hasInternet(
        Context context
    ) {
        try {

            ConnectivityManager manager =
                (ConnectivityManager)
                    context.getSystemService(
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

            NetworkCapabilities capabilities =
                manager.getNetworkCapabilities(
                    network
                );

            if (capabilities == null) {
                return false;
            }

            return
                capabilities.hasCapability(
                    NetworkCapabilities.NET_CAPABILITY_INTERNET
                )
                &&
                capabilities.hasCapability(
                    NetworkCapabilities.NET_CAPABILITY_VALIDATED
                );

        } catch (Exception e) {

            return false;
        }
    }

    /* =====================================================
       FILTER
    ===================================================== */

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
       FINGERPRINT
    ===================================================== */

    private String createSmsFingerprint(
        String address,
        String body,
        long date
    ) {
        String source =
            safeValue(address)
                + "|"
                + safeValue(body)
                + "|"
                + date;

        try {

            MessageDigest digest =
                MessageDigest.getInstance(
                    "SHA-256"
                );

            byte[] hash =
                digest.digest(
                    source.getBytes(
                        StandardCharsets.UTF_8
                    )
                );

            StringBuilder result =
                new StringBuilder(
                    hash.length * 2
                );

            for (byte value : hash) {

                result.append(
                    String.format(
                        "%02x",
                        value & 0xff
                    )
                );
            }

            return result.toString();

        } catch (Exception e) {

            return String.valueOf(
                source.hashCode()
            );
        }
    }

    private String safeValue(
        String value
    ) {
        return value == null
            ? ""
            : value;
    }

    /* =====================================================
       JSON
    ===================================================== */

    private String buildJson(
        String smsId,
        String address,
        String body,
        long date
    ) {
        return "{"
            + "\"smsId\":"
            + quote(smsId)
            + ","
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
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t")
                .replace("\b", "\\b")
                .replace("\f", "\\f")
            + "\"";
    }

    /* =====================================================
       HTTP
    ===================================================== */

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
                output.write(payload);
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
                readResponse(stream);

            if (
                responseCode >= 200 &&
                responseCode < 300
            ) {

                Log.d(
                    TAG,
                    "Recovery API success. HTTP "
                        + responseCode
                        + " "
                        + truncate(response)
                );

                return true;
            }

            Log.w(
                TAG,
                "Recovery API rejected request. HTTP "
                    + responseCode
                    + " "
                    + truncate(response)
            );

            return false;

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
       RESPONSE
    ===================================================== */

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
                result.append(line);
            }

        } catch (Exception e) {

            Log.e(
                TAG,
                "Unable to read recovery response.",
                e
            );
        }

        return result.toString();
    }

    private String truncate(
        String value
    ) {
        if (value == null) {
            return "";
        }

        if (
            value.length()
                <= MAX_RESPONSE_LENGTH
        ) {
            return value;
        }

        return value.substring(
            0,
            MAX_RESPONSE_LENGTH
        ) + "...";
    }
}
