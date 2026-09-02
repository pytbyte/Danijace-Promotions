package com.pytbyte.geoshua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * =========================================================
 * GEO-SHUA
 * REAL-TIME SMS RECEIVER
 * =========================================================
 *
 * SMS_RECEIVED
 *      ↓
 * local filter
 *      ↓
 * fingerprint
 *      ↓
 * internet?
 *      ├── YES → API → MongoDB
 *      └── NO  → local queue
 *
 * The application UI does NOT need to be open.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsReceiver";

    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

    private static final int CONNECT_TIMEOUT_MS =
        10_000;

    private static final int READ_TIMEOUT_MS =
        15_000;

    private static final int MAX_RESPONSE_LENGTH =
        2_000;

    @Override
    public void onReceive(
        final Context context,
        final Intent intent
    ) {
        if (context == null) {
            return;
        }

        if (
            intent == null ||
            !Telephony.Sms.Intents.SMS_RECEIVED_ACTION
                .equals(intent.getAction())
        ) {
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

                        processIncomingSms(
                            applicationContext,
                            intent
                        );

                    } catch (Exception e) {

                        Log.e(
                            TAG,
                            "Unexpected SMS processing error.",
                            e
                        );

                    } finally {
                        pendingResult.finish();
                    }
                },
                "GeoShuaSmsReceiver"
            );

        worker.start();
    }

    /* =====================================================
       PROCESS SMS
    ===================================================== */

    private void processIncomingSms(
        Context context,
        Intent intent
    ) {
        SmsMessage[] messages =
            Telephony.Sms.Intents
                .getMessagesFromIntent(intent);

        if (
            messages == null ||
            messages.length == 0
        ) {
            Log.w(
                TAG,
                "SMS broadcast contained no messages."
            );

            return;
        }

        StringBuilder bodyBuilder =
            new StringBuilder();

        String address =
            null;

        long smsDate =
            0L;

        for (
            SmsMessage sms : messages
        ) {
            if (sms == null) {
                continue;
            }

            if (address == null) {
                address =
                    sms.getDisplayOriginatingAddress();
            }

            String part =
                sms.getMessageBody();

            if (
                part != null &&
                !part.isEmpty()
            ) {
                bodyBuilder.append(part);
            }

            long timestamp =
                sms.getTimestampMillis();

            if (
                timestamp > smsDate
            ) {
                smsDate = timestamp;
            }
        }

        String body =
            bodyBuilder
                .toString()
                .trim();

        if (body.isEmpty()) {
            return;
        }

        if (smsDate <= 0L) {
            smsDate =
                System.currentTimeMillis();
        }

        if (
            !looksLikeBankTransaction(body)
        ) {
            Log.d(
                TAG,
                "Ignoring non-bank SMS."
            );

            return;
        }

        String smsId =
            createSmsFingerprint(
                address,
                body,
                smsDate
            );

        String json =
            buildJson(
                smsId,
                address,
                body,
                smsDate
            );

        /*
         * Do not waste the HTTP timeout when the device
         * obviously has no usable network.
         */
        if (!hasInternet(context)) {

            SmsQueue.enqueue(
                context,
                smsId,
                address,
                body,
                smsDate
            );

            Log.w(
                TAG,
                "No internet. SMS queued locally. smsId="
                    + smsId
            );

            return;
        }

        boolean success =
            postJson(
                PROCESS_URL,
                json
            );

        if (success) {

            Log.d(
                TAG,
                "Incoming bank SMS submitted successfully. smsId="
                    + smsId
            );

            return;
        }

        /*
         * Server acceptance was not confirmed.
         *
         * Keep the SMS locally for recovery.
         */
        SmsQueue.enqueue(
            context,
            smsId,
            address,
            body,
            smsDate
        );

        Log.w(
            TAG,
            "SMS submission failed. Queued for recovery. smsId="
                + smsId
        );
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

            Log.w(
                TAG,
                "Unable to determine network state.",
                e
            );

            return false;
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
                .toLowerCase();

        return
            normalized.contains("confirmed")
            &&
            normalized.contains("kes")
            &&
            normalized.contains("received from")
            &&
            normalized.contains("for account");
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

            Log.e(
                TAG,
                "Unable to create SMS fingerprint.",
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

            Log.d(
                TAG,
                "SMS API response: HTTP "
                    + responseCode
                    + " "
                    + response
            );

            return
                responseCode >= 200 &&
                responseCode < 300;

        } catch (Exception e) {

            Log.e(
                TAG,
                "Failed POSTing SMS to GEO-SHUA.",
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

                result.append(line);
            }

        } catch (Exception e) {

            Log.e(
                TAG,
                "Unable to read SMS API response.",
                e
            );
        }

        return result.toString();
    }
}

