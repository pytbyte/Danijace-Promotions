package com.pytbyte.geoshua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Receives incoming SMS broadcasts, stores valid messages in the
 * local SQLite queue, and wakes the SMS processing worker.
 *
 * This receiver does not:
 * - call the backend
 * - perform financial processing
 * - depend on the WebView
 * - depend on JavaScript
 *
 * It is designed to work even when the application UI is closed
 * or not currently running.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "GeoShuaSmsReceiver";

    /**
     * Only capture SMS messages from the last 36 hours.
     */
    private static final long SMS_WINDOW_MS =
            36L * 60L * 60L * 1000L;

    private static final class SmsPart {

        final String address;
        final long timestamp;
        final String body;

        SmsPart(
                String address,
                long timestamp,
                String body
        ) {
            this.address = address;
            this.timestamp = timestamp;
            this.body = body;
        }
    }

    private static final class CombinedSms {

        final String address;
        final long timestamp;
        final String body;

        CombinedSms(
                String address,
                long timestamp,
                String body
        ) {
            this.address = address;
            this.timestamp = timestamp;
            this.body = body;
        }
    }

    @Override
    public void onReceive(
            Context context,
            Intent intent
    ) {

        /*
         * Keep this as the first important log.
         *
         * If this never appears when an SMS arrives, the problem
         * is before this class:
         *
         * Android broadcast delivery
         * permissions
         * manifest registration
         * device/OS restrictions
         */
        Log.i(TAG, "==================================================");
        Log.i(TAG, "SMS RECEIVER INVOKED");

        if (context == null) {
            Log.e(TAG, "STOP: Context is null.");
            return;
        }

        if (intent == null) {
            Log.e(TAG, "STOP: Intent is null.");
            return;
        }

        String action = intent.getAction();

        Log.i(TAG, "Broadcast action=" + action);

        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(action)) {
            Log.w(TAG, "STOP: Unexpected broadcast action.");
            return;
        }

        Log.i(TAG, "SMS_RECEIVED action confirmed.");

        final long now = System.currentTimeMillis();
        final long cutoff = now - SMS_WINDOW_MS;

        Log.i(TAG, "Receiver time=" + now);
        Log.i(TAG, "36-hour cutoff=" + cutoff);

        Context appContext = context.getApplicationContext();

        try {

            SmsQueueStore store =
                    new SmsQueueStore(appContext);

            Log.i(TAG, "SmsQueueStore opened.");

            cleanupOldMessages(store, cutoff);

            SmsMessage[] messages =
                    Telephony.Sms.Intents.getMessagesFromIntent(
                            intent
                    );

            if (messages == null || messages.length == 0) {

                Log.e(
                        TAG,
                        "STOP: SMS_RECEIVED contained no SMS messages."
                );

                return;
            }

            Log.i(
                    TAG,
                    "SMS messages decoded. count="
                            + messages.length
            );

            List<SmsPart> parts =
                    decodeParts(
                            messages,
                            cutoff,
                            now
                    );

            if (parts.isEmpty()) {

                Log.w(
                        TAG,
                        "STOP: No usable SMS parts passed validation."
                );

                return;
            }

            Log.i(
                    TAG,
                    "Usable SMS parts=" + parts.size()
            );

            List<CombinedSms> messagesToQueue =
                    combineParts(parts);

            if (messagesToQueue.isEmpty()) {

                Log.w(
                        TAG,
                        "STOP: No logical SMS remained after combining."
                );

                return;
            }

            Log.i(
                    TAG,
                    "Logical SMS messages="
                            + messagesToQueue.size()
            );

            QueueResult result =
                    persistMessages(
                            store,
                            messagesToQueue,
                            cutoff,
                            now
                    );

            Log.i(
                    TAG,
                    "Queue persistence complete. "
                            + "inserted="
                            + result.inserted
                            + ", duplicates="
                            + result.duplicates
            );

            if (result.inserted > 0) {

                wakeProcessingWorker(appContext);

            } else {

                Log.i(
                        TAG,
                        "No new SMS inserted. "
                                + "Processing worker not explicitly "
                                + "enqueued by this receiver."
                );
            }

            Log.i(
                    TAG,
                    "SMS RECEIVER COMPLETE. "
                            + "inserted="
                            + result.inserted
                            + ", duplicates="
                            + result.duplicates
            );

        } catch (Exception e) {

            /*
             * Never allow an exception here to take down the
             * broadcast processing silently.
             */
            Log.e(
                    TAG,
                    "FATAL RECEIVER ERROR: Failed to capture SMS.",
                    e
            );

        } finally {

            Log.i(TAG, "==================================================");
        }
    }

    /**
     * Removes queue entries older than the capture window.
     *
     * Cleanup failure must never prevent the current SMS from
     * being captured.
     */
    private static void cleanupOldMessages(
            SmsQueueStore store,
            long cutoff
    ) {

        try {

            int deleted =
                    store.deleteOlderThan(cutoff);

            Log.i(
                    TAG,
                    "Old queue cleanup completed. deleted="
                            + deleted
            );

        } catch (Exception e) {

            Log.e(
                    TAG,
                    "WARNING: Queue cleanup failed. "
                            + "Continuing with SMS capture.",
                    e
            );
        }
    }

    /**
     * Converts Android SmsMessage objects into validated SMS parts.
     */
    private static List<SmsPart> decodeParts(
            SmsMessage[] messages,
            long cutoff,
            long now
    ) {

        List<SmsPart> parts =
                new ArrayList<>();

        for (int i = 0; i < messages.length; i++) {

            SmsMessage message = messages[i];

            int partNumber = i + 1;

            if (message == null) {

                Log.w(
                        TAG,
                        "SMS part #" + partNumber + " is null."
                );

                continue;
            }

            String address =
                    normalizeAddress(
                            message.getOriginatingAddress()
                    );

            String body =
                    message.getMessageBody();

            long timestamp =
                    message.getTimestampMillis();

            int bodyLength =
                    body == null
                            ? 0
                            : body.length();

            Log.i(
                    TAG,
                    "Decoded SMS part #"
                            + partNumber
                            + ": address="
                            + address
                            + ", timestamp="
                            + timestamp
                            + ", bodyLength="
                            + bodyLength
            );

            if (address.isEmpty()) {

                Log.w(
                        TAG,
                        "SMS part #"
                                + partNumber
                                + " rejected: empty sender."
                );

                continue;
            }

            if (body == null) {
                body = "";
            }

            body = body.trim();

            if (body.isEmpty()) {

                Log.w(
                        TAG,
                        "SMS part #"
                                + partNumber
                                + " rejected: empty body."
                );

                continue;
            }

            if (timestamp < cutoff) {

                Log.w(
                        TAG,
                        "SMS part #"
                                + partNumber
                                + " rejected: older than 36 hours."
                );

                continue;
            }

            if (timestamp > now) {

                Log.w(
                        TAG,
                        "SMS part #"
                                + partNumber
                                + " rejected: future timestamp."
                );

                continue;
            }

            parts.add(
                    new SmsPart(
                            address,
                            timestamp,
                            body
                    )
            );

            Log.i(
                    TAG,
                    "SMS part #"
                            + partNumber
                            + " accepted."
            );
        }

        return parts;
    }

    /**
     * Result of local queue persistence.
     */
    private static final class QueueResult {

        int inserted;
        int duplicates;
    }

    /**
     * Persists logical SMS messages into SQLite.
     */
    private static QueueResult persistMessages(
            SmsQueueStore store,
            List<CombinedSms> messages,
            long cutoff,
            long now
    ) {

        QueueResult result =
                new QueueResult();

        for (CombinedSms sms : messages) {

            if (sms.timestamp < cutoff) {

                Log.w(
                        TAG,
                        "Skipping SMS during persistence: "
                                + "older than 36 hours."
                );

                continue;
            }

            if (sms.timestamp > now) {

                Log.w(
                        TAG,
                        "Skipping SMS during persistence: "
                                + "future timestamp."
                );

                continue;
            }

            if (
                    sms.body == null ||
                    sms.body.trim().isEmpty()
            ) {

                Log.w(
                        TAG,
                        "Skipping SMS during persistence: "
                                + "empty body."
                );

                continue;
            }

            String id =
                    createStableSmsId(
                            sms.address,
                            sms.timestamp,
                            sms.body
                    );

            Log.i(
                    TAG,
                    "Queue insert attempt: id="
                            + id
                            + ", address="
                            + sms.address
                            + ", timestamp="
                            + sms.timestamp
            );

            boolean inserted =
                    store.insertIfMissing(
                            id,
                            sms.address,
                            sms.body,
                            sms.timestamp,
                            now
                    );

            if (inserted) {

                result.inserted++;

                Log.i(
                        TAG,
                        "SUCCESS: SMS INSERTED INTO LOCAL QUEUE. "
                                + "id="
                                + id
                );

            } else {

                result.duplicates++;

                Log.i(
                        TAG,
                        "SMS already exists in local queue. "
                                + "id="
                                + id
                );
            }
        }

        return result;
    }

    /**
     * Wakes the processing worker and makes sure the periodic
     * safety-net worker remains scheduled.
     */
    private static void wakeProcessingWorker(
            Context context
    ) {

        try {

            Log.i(
                    TAG,
                    "Enqueuing SmsProcessingWorker..."
            );

            SmsProcessingWorker.enqueueNow(context);

            Log.i(
                    TAG,
                    "SUCCESS: SmsProcessingWorker.enqueueNow() completed."
            );

        } catch (Exception e) {

            Log.e(
                    TAG,
                    "ERROR: SmsProcessingWorker.enqueueNow() failed.",
                    e
            );
        }

        try {

            Log.i(
                    TAG,
                    "Ensuring periodic SMS worker is scheduled..."
            );

            SmsProcessingWorker.schedule(context);

            Log.i(
                    TAG,
                    "SUCCESS: Periodic SMS worker schedule completed."
            );

        } catch (Exception e) {

            Log.e(
                    TAG,
                    "ERROR: Failed to schedule periodic SMS worker.",
                    e
            );
        }
    }

    /**
     * Combines SMS parts belonging to the same logical SMS.
     *
     * Android supplies multipart messages through the broadcast.
     * We group using sender + timestamp because this code path does
     * not expose a reliable multipart sequence number.
     *
     * The supplied Android order is retained inside each group.
     */
    private static List<CombinedSms> combineParts(
            List<SmsPart> parts
    ) {

        Map<String, List<SmsPart>> grouped =
                new HashMap<>();

        for (SmsPart part : parts) {

            String key =
                    part.address +
                    "|" +
                    part.timestamp;

            List<SmsPart> group =
                    grouped.get(key);

            if (group == null) {

                group = new ArrayList<>();

                grouped.put(
                        key,
                        group
                );
            }

            group.add(part);
        }

        List<CombinedSms> result =
                new ArrayList<>();

        for (List<SmsPart> group : grouped.values()) {

            if (group.isEmpty()) {
                continue;
            }

            SmsPart first =
                    group.get(0);

            StringBuilder body =
                    new StringBuilder();

            for (SmsPart part : group) {

                if (
                        part.body != null &&
                        !part.body.isEmpty()
                ) {
                    body.append(part.body);
                }
            }

            String combinedBody =
                    body.toString().trim();

            if (combinedBody.isEmpty()) {
                continue;
            }

            result.add(
                    new CombinedSms(
                            first.address,
                            first.timestamp,
                            combinedBody
                    )
            );
        }

        /*
         * Process older messages first.
         */
        Collections.sort(
                result,
                new Comparator<CombinedSms>() {

                    @Override
                    public int compare(
                            CombinedSms first,
                            CombinedSms second
                    ) {

                        return Long.compare(
                                first.timestamp,
                                second.timestamp
                        );
                    }
                }
        );

        return result;
    }

    /**
     * Keeps the sender exactly as Android supplied it.
     *
     * Phone-number normalization belongs to the backend/processor.
     */
    private static String normalizeAddress(
            String address
    ) {

        if (address == null) {
            return "";
        }

        return address.trim();
    }

    /**
     * Creates a deterministic ID for local deduplication.
     */
    private static String createStableSmsId(
            String address,
            long timestamp,
            String body
    ) {

        String identity =
                address +
                "|" +
                timestamp +
                "|" +
                body;

        try {

            MessageDigest digest =
                    MessageDigest.getInstance("SHA-256");

            byte[] hash =
                    digest.digest(
                            identity.getBytes(
                                    StandardCharsets.UTF_8
                            )
                    );

            StringBuilder hex =
                    new StringBuilder(
                            hash.length * 2
                    );

            for (byte value : hash) {

                hex.append(
                        String.format(
                                Locale.US,
                                "%02x",
                                value & 0xff
                        )
                );
            }

            return "sms-" + hex;

        } catch (Exception e) {

            /*
             * SHA-256 is expected to be available on Android.
             * Keep a deterministic fallback regardless.
             */
            return "sms-" +
                    Integer.toHexString(
                            identity.hashCode()
                    );
        }
    }
}
