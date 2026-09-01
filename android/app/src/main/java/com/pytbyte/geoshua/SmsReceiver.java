package com.pytbyte.geoshua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
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
 * PURPOSE
 * ---------------------------------------------------------
 *
 * Primary path for processing incoming bank SMS messages.
 *
 *     Bank SMS
 *        ↓
 *     SMS_RECEIVED
 *        ↓
 *     SmsReceiver
 *        ↓
 *     lightweight local filter
 *        ↓
 *     /api/sms/process
 *        ↓
 *     server parser
 *        ↓
 *     member resolution
 *        ↓
 *     savings / loan classification
 *        ↓
 *     financial transaction
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
 * - write MongoDB
 * - create financial records
 *
 * The server remains authoritative.
 *
 * =========================================================
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsReceiver";

    /**
     * Production SMS processing endpoint.
     */
    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

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

    /**
     * Maximum response body retained for logging.
     *
     * The response itself is not required for financial
     * processing on the Android side.
     */
    private static final int MAX_RESPONSE_LENGTH =
        2_000;

    /* =====================================================
       RECEIVE
    ===================================================== */

    @Override
    public void onReceive(
        final Context context,
        final Intent intent
    ) {
        if (context == null) {
            return;
        }

        /*
         * Only process the Android SMS_RECEIVED broadcast.
         */
        if (
            intent == null ||
            !Telephony.Sms.Intents.SMS_RECEIVED_ACTION
                .equals(intent.getAction())
        ) {
            return;
        }

        /*
         * BroadcastReceiver has a limited execution window.
         *
         * goAsync() allows the HTTP operation to continue
         * briefly without blocking the main receiver thread.
         */
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
                .getMessagesFromIntent(
                    intent
                );

        if (
            messages == null ||
            messages.length == 0
        ) {
            Log.d(
                TAG,
                "SMS broadcast contained no messages."
            );

            return;
        }

        /*
         * Multipart SMS messages can arrive as multiple
         * SmsMessage objects.
         */
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

            /*
             * Use the originating address from the first
             * valid SMS part.
             */
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
                bodyBuilder.append(
                    part
                );
            }

            /*
             * Use the most recent valid timestamp.
             */
            long timestamp =
                sms.getTimestampMillis();

            if (
                timestamp > smsDate
            ) {
                smsDate =
                    timestamp;
            }
        }

        String body =
            bodyBuilder
                .toString()
                .trim();

        if (body.isEmpty()) {
            Log.d(
                TAG,
                "Ignoring SMS with empty body."
            );

            return;
        }

        /*
         * Extremely unlikely fallback.
         *
         * Normally SmsMessage supplies a timestamp.
         */
        if (smsDate <= 0L) {
            smsDate =
                System.currentTimeMillis();
        }

        /*
         * Do not send ordinary SMS messages to the server.
         */
        if (
            !looksLikeBankTransaction(
                body
            )
        ) {
            Log.d(
                TAG,
                "Ignoring non-bank SMS."
            );

            return;
        }

        /*
         * Generate a deterministic identifier.
         *
         * This is important because the same SMS can be seen
         * by:
         *
         * 1. real-time SmsReceiver
         * 2. hourly SmsSweepReceiver
         *
         * Both must ultimately resolve to the same server-side
         * idempotency key.
         */
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

        boolean success =
            postJson(
                PROCESS_URL,
                json
            );

        if (success) {
            Log.d(
                TAG,
                "Incoming bank SMS submitted successfully. "
                    + "smsId="
                    + smsId
            );
        } else {
            Log.w(
                TAG,
                "Incoming bank SMS submission failed. "
                    + "Recovery sweep may retry it. "
                    + "smsId="
                    + smsId
            );
        }
    }

    /* =====================================================
       LOCAL BANK FILTER
    ===================================================== */

    /**
     * Lightweight filter only.
     *
     * This method must NOT attempt to determine:
     *
     * - member
     * - savings
     * - loan
     * - amount
     * - account ownership
     *
     * Those decisions belong to the server.
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
       SMS FINGERPRINT
    ===================================================== */

    /**
     * Create a deterministic SHA-256 fingerprint.
     *
     * The fingerprint allows the server to recognize the
     * same SMS when it arrives through both:
     *
     *     SmsReceiver
     *
     * and:
     *
     *     SmsSweepReceiver
     *
     * This is NOT the financial transaction ID.
     *
     * It is the source-message idempotency key.
     */
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
            /*
             * SHA-256 is guaranteed by Android/Java.
             *
             * This fallback should therefore practically
             * never execute.
             */
            Log.e(
                TAG,
                "Unable to create SMS fingerprint.",
                e
            );

            return
                String.valueOf(
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

    /**
     * Build the minimal server payload.
     *
     * smsId is included specifically for idempotency.
     */
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
            + "\"";
    }

    /* =====================================================
       HTTP POST
    ===================================================== */

    /**
     * Submit SMS to the server.
     *
     * Returns true only for a successful HTTP 2xx response.
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
                "SMS API response: HTTP "
                    + responseCode
                    + " "
                    + response
            );

            return
                responseCode >= 200
                &&
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

    /**
     * Read only a small diagnostic response.
     *
     * Financial processing does not depend on the response
     * body inside Android.
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
                "Unable to read SMS API response.",
                e
            );
        }

        return result.toString();
    }
}