package com.pytbyte.geoshua;

import android.Manifest;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
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
 * BACKGROUND SMS DELIVERY
 * =========================================================
 *
 * SmsReceiver
 *      ↓
 * SmsQueue
 *      ↓
 * SmsBackgroundJobService
 *      ↓
 * /api/sms/process
 *
 * The receiver only captures and queues the SMS.
 * This JobService performs the longer background work.
 */
public class SmsBackgroundJobService extends JobService {

    private static final String TAG =
        "GeoShuaSmsBackground";

    public static final int JOB_ID = 9101;

    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

    private static final int CONNECT_TIMEOUT_MS =
        10_000;

    private static final int READ_TIMEOUT_MS =
        15_000;

    private static final int MAX_RESPONSE_LENGTH =
        2_000;

    private static final int MAX_QUEUE_ITEMS_PER_RUN =
        50;

    private static final long LOOKBACK_MS =
        70L * 60L * 1000L;

    /* =====================================================
       SCHEDULE
    ===================================================== */

    public static void schedule(
        Context context
    ) {
        if (context == null) {
            return;
        }

        android.app.job.JobScheduler scheduler =
            (android.app.job.JobScheduler)
                context.getSystemService(
                    Context.JOB_SCHEDULER_SERVICE
                );

        if (scheduler == null) {
            Log.e(
                TAG,
                "JobScheduler unavailable."
            );

            return;
        }

        android.app.job.JobInfo jobInfo =
            new android.app.job.JobInfo.Builder(
                JOB_ID,
                new android.content.ComponentName(
                    context,
                    SmsBackgroundJobService.class
                )
            )
                .setRequiredNetworkType(
                    android.app.job.JobInfo.NETWORK_TYPE_ANY
                )
                .setPersisted(false)
                .setBackoffCriteria(
                    30_000L,
                    android.app.job.JobInfo.BACKOFF_POLICY_EXPONENTIAL
                )
                .build();

        int result =
            scheduler.schedule(
                jobInfo
            );

        if (
            result ==
            android.app.job.JobScheduler.RESULT_SUCCESS
        ) {
            Log.d(
                TAG,
                "Background SMS job scheduled."
            );
        } else {
            Log.e(
                TAG,
                "Failed to schedule background SMS job."
            );
        }
    }

    /* =====================================================
       JOB START
    ===================================================== */

    @Override
    public boolean onStartJob(
        JobParameters params
    ) {

        Log.d(
            TAG,
            "========== BACKGROUND SMS JOB START =========="
        );

        final Context applicationContext =
            getApplicationContext();

        Thread worker =
            new Thread(
                () -> {

                    boolean needsReschedule =
                        false;

                    try {

                        /*
                         * First send everything that was already
                         * placed in the persistent queue.
                         */
                        flushPendingQueue(
                            applicationContext
                        );

                        /*
                         * Then inspect the recent inbox. This
                         * protects against SMS broadcasts that
                         * were missed while the app process was
                         * unavailable.
                         */
                        sweepRecentInbox(
                            applicationContext
                        );

                    } catch (Exception e) {

                        Log.e(
                            TAG,
                            "Background SMS job failed.",
                            e
                        );

                        needsReschedule = true;

                    } finally {

                        Log.d(
                            TAG,
                            "========== BACKGROUND SMS JOB END =========="
                        );

                        jobFinished(
                            params,
                            needsReschedule
                        );
                    }

                },
                "GeoShuaSmsBackground"
            );

        worker.start();

        /*
         * Work is continuing asynchronously.
         */
        return true;
    }

    /* =====================================================
       JOB STOP
    ===================================================== */

    @Override
    public boolean onStopJob(
        JobParameters params
    ) {

        Log.w(
            TAG,
            "Background SMS job stopped by Android."
        );

        /*
         * Return true so Android may try the job again.
         */
        return true;
    }

    /* =====================================================
       QUEUE
    ===================================================== */

    private void flushPendingQueue(
        Context context
    ) {

        if (!hasInternet(context)) {

            Log.d(
                TAG,
                "No internet. Leaving SMS queue untouched."
            );

            return;
        }

        List<SmsQueue.PendingSms> pending =
            SmsQueue.getPending(
                context
            );

        if (
            pending == null ||
            pending.isEmpty()
        ) {

            Log.d(
                TAG,
                "SMS queue is empty."
            );

            return;
        }

        int processed =
            0;

        Log.d(
            TAG,
            "Pending SMS count: "
                + pending.size()
        );

        for (
            SmsQueue.PendingSms sms :
            pending
        ) {

            if (
                processed >=
                MAX_QUEUE_ITEMS_PER_RUN
            ) {
                break;
            }

            if (sms == null) {
                continue;
            }

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

                processed++;

                Log.d(
                    TAG,
                    "Queued SMS delivered. smsId="
                        + sms.smsId
                );

            } else {

                Log.w(
                    TAG,
                    "Queued SMS delivery failed. "
                        + "Keeping in queue. smsId="
                        + sms.smsId
                );

                /*
                 * Stop after the first failed request.
                 * We do not want to hammer the API.
                 */
                break;
            }
        }

        Log.d(
            TAG,
            "Queue processing complete. "
                + "delivered="
                + processed
                + ", remaining="
                + SmsQueue.size(context)
        );
    }

    /* =====================================================
       RECENT INBOX
    ===================================================== */

    private void sweepRecentInbox(
        Context context
    ) {

        if (
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) != PackageManager.PERMISSION_GRANTED
        ) {

            Log.w(
                TAG,
                "READ_SMS permission unavailable."
            );

            return;
        }

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

        int scanned =
            0;

        int submitted =
            0;

        int queued =
            0;

        Set<String> seen =
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
                            String.valueOf(cutoff),
                            String.valueOf(now)
                        },
                        "date ASC"
                    );

            if (cursor == null) {

                Log.w(
                    TAG,
                    "SMS inbox returned null cursor."
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
                    "Required SMS columns unavailable."
                );

                return;
            }

            while (
                cursor.moveToNext()
            ) {

                scanned++;

                if (
                    scanned >
                    MAX_QUEUE_ITEMS_PER_RUN
                ) {
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
                    continue;
                }

                if (date <= 0L) {
                    continue;
                }

                if (
                    !looksLikeBankTransaction(
                        body
                    )
                ) {
                    continue;
                }

                String smsId =
                    createSmsFingerprint(
                        address,
                        body,
                        date
                    );

                if (
                    seen.contains(smsId)
                ) {
                    continue;
                }

                seen.add(
                    smsId
                );

                String json =
                    buildJson(
                        smsId,
                        address,
                        body,
                        date
                    );

                /*
                 * If connectivity disappears during the run,
                 * preserve the message locally.
                 */
                if (!hasInternet(context)) {

                    SmsQueue.enqueue(
                        context,
                        smsId,
                        address,
                        body,
                        date
                    );

                    queued++;

                    continue;
                }

                boolean success =
                    postJson(
                        PROCESS_URL,
                        json
                    );

                if (success) {

                    submitted++;

                } else {

                    SmsQueue.enqueue(
                        context,
                        smsId,
                        address,
                        body,
                        date
                    );

                    queued++;
                }
            }

            Log.d(
                TAG,
                "Recent inbox sweep complete. "
                    + "scanned="
                    + scanned
                    + ", submitted="
                    + submitted
                    + ", queued="
                    + queued
            );

        } catch (SecurityException e) {

            Log.e(
                TAG,
                "SMS permission denied.",
                e
            );

        } catch (Exception e) {

            Log.e(
                TAG,
                "Recent inbox sweep failed.",
                e
            );

        } finally {

            if (cursor != null) {
                cursor.close();
            }
        }
    }

    /* =====================================================
       BANK FILTER
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
                        Locale.ROOT,
                        "%02x",
                        value & 0xff
                    )
                );
            }

            return result.toString();

        } catch (Exception e) {

            Log.e(
                TAG,
                "Fingerprint generation failed.",
                e
            );

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
                );

        } catch (Exception e) {

            Log.w(
                TAG,
                "Could not determine network state.",
                e
            );

            return false;
        }
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
                readResponse(
                    stream
                );

            Log.d(
                TAG,
                "API response HTTP "
                    + responseCode
                    + ": "
                    + response
            );

            return
                responseCode >= 200 &&
                responseCode < 300;

        } catch (Exception e) {

            Log.e(
                TAG,
                "SMS API request failed.",
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

                if (
                    result.length()
                        >= MAX_RESPONSE_LENGTH
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