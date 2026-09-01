package com.pytbyte.geoshua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.SmsMessage;
import android.util.Log;

import com.getcapacitor.JSObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsReceiver";

    /*
     * Production GEO-SHUA SMS processing endpoint.
     */
    private static final String PROCESS_URL =
        "https://geoshua.vercel.app/api/sms/process";

    @Override
    public void onReceive(
        final Context context,
        Intent intent
    ) {
        if (
            !"android.provider.Telephony.SMS_RECEIVED"
                .equals(intent.getAction())
        ) {
            return;
        }

        final PendingResult pendingResult =
            goAsync();

        new Thread(() -> {
            try {
                SmsMessage[] messages =
                    android.provider.Telephony.Sms.Intents
                        .getMessagesFromIntent(intent);

                if (
                    messages == null ||
                    messages.length == 0
                ) {
                    Log.d(
                        TAG,
                        "Incoming SMS broadcast contained no messages."
                    );
                    return;
                }

                StringBuilder messageBody =
                    new StringBuilder();

                String address = null;
                long smsDate =
                    System.currentTimeMillis();

                /*
                 * Android may deliver a multipart SMS
                 * as several SmsMessage objects.
                 *
                 * Combine all parts into one bank message.
                 */
                for (SmsMessage sms : messages) {
                    if (sms == null) {
                        continue;
                    }

                    if (address == null) {
                        address =
                            sms.getDisplayOriginatingAddress();
                    }

                    String part =
                        sms.getMessageBody();

                    if (part != null) {
                        messageBody.append(part);
                    }

                    long timestamp =
                        sms.getTimestampMillis();

                    if (timestamp > 0) {
                        smsDate =
                            timestamp;
                    }
                }

                String body =
                    messageBody
                        .toString()
                        .trim();

                if (body.isEmpty()) {
                    Log.d(
                        TAG,
                        "Incoming SMS body is empty."
                    );
                    return;
                }

                /*
                 * Lightweight filter only.
                 *
                 * The SERVER parser remains authoritative.
                 *
                 * This prevents ordinary personal SMS messages
                 * from unnecessarily hitting the API.
                 */
                if (!looksLikeBankTransaction(body)) {
                    Log.d(
                        TAG,
                        "Incoming SMS does not look like a bank transaction."
                    );
                    return;
                }

                String json =
                    buildJson(
                        address,
                        body,
                        smsDate
                    );

                postJson(
                    PROCESS_URL,
                    json
                );

            } catch (Exception e) {
                Log.e(
                    TAG,
                    "Failed to forward incoming SMS.",
                    e
                );
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    /*
     * Do not attempt to determine savings vs loan here.
     *
     * The server parser/classifier does that.
     */
    private boolean looksLikeBankTransaction(
        String body
    ) {
        String normalized =
            body
                .toLowerCase()
                .trim();

        return
            normalized.contains("confirmed") &&
            normalized.contains("kes") &&
            normalized.contains("received from") &&
            normalized.contains("for account");
    }

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
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t")
            + "\"";
    }

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

            connection.setRequestMethod("POST");

            connection.setConnectTimeout(
                10_000
            );

            connection.setReadTimeout(
                15_000
            );

            connection.setDoOutput(true);

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
                readStream(stream);

            Log.d(
                TAG,
                "SMS API response: HTTP "
                    + responseCode
                    + " "
                    + response
            );

        } catch (Exception e) {
            Log.e(
                TAG,
                "Failed POSTing SMS to GEO-SHUA.",
                e
            );
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

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