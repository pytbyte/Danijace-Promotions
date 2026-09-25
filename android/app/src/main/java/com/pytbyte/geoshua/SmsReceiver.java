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
 * Native incoming SMS receiver.
 *
 * =========================================================
 * RESPONSIBILITY
 * =========================================================
 *
 * This receiver has ONE job:
 *
 *     SMS_RECEIVED
 *          ↓
 *     validate/decode SMS
 *          ↓
 *     save to SmsQueueStore
 *          ↓
 *     wake SmsProcessingWorker
 *
 * It does NOT:
 *
 * - call the backend
 * - parse bank transactions
 * - perform financial operations
 * - depend on the WebView
 * - depend on JavaScript
 *
 * This receiver is specifically designed to work when the
 * application UI is:
 *
 * - closed
 * - in the background
 * - not currently loaded
 * - on the lock screen
 *
 * =========================================================
 * DIAGNOSTICS
 * =========================================================
 *
 * This class deliberately logs every important stage of the
 * incoming SMS pipeline.
 *
 * The purpose is to determine exactly where an SMS stops:
 *
 *     Android
 *       ↓
 *     SmsReceiver invoked
 *       ↓
 *     SMS decoded
 *       ↓
 *     SQLite queue
 *       ↓
 *     WorkManager
 *
 * If there is NO:
 *
 *     "RECEIVER INVOKED"
 *
 * log at all, the problem is before this class:
 *
 *     Android broadcast delivery / permission / device state
 *
 * If the receiver is invoked but no SMS is decoded, the
 * problem is in the broadcast payload.
 *
 * If the SMS is decoded but not inserted, the problem is
 * in validation or SmsQueueStore.
 *
 * If it is inserted but processing does not happen, the
 * problem is downstream in WorkManager/SmsProcessingWorker.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG =
            "GeoShuaSmsReceiver";

    /**
     * Only process SMS messages inside this window.
     */
    private static final long THIRTY_SIX_HOURS_MS =
            36L * 60L * 60L * 1000L;

    /**
     * Android may provide multiple PDUs for one multipart SMS.
     */
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

    /**
     * Complete SMS after multipart parts have been combined.
     */
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
         * =====================================================
         * STAGE 1
         * =====================================================
         *
         * This MUST be the first meaningful log.
         *
         * If this message never appears when a bank SMS arrives,
         * Android did not invoke this receiver.
         */
        Log.i(
                TAG,
                "=================================================="
        );

        Log.i(
                TAG,
                "SMS RECEIVER INVOKED"
        );

        Log.i(
                TAG,
                "context="
                        + (context == null
                        ? "NULL"
                        : context.getClass().getName())
        );

        Log.i(
                TAG,
                "intent="
                        + (intent == null
                        ? "NULL"
                        : "present")
        );

        /*
         * =====================================================
         * STAGE 2
         * =====================================================
         *
         * Validate the incoming broadcast.
         */
        if (intent == null) {

            Log.e(
                    TAG,
                    "STOP: Received null intent."
            );

            return;
        }

        final String action =
                intent.getAction();

        Log.i(
                TAG,
                "Broadcast action="
                        + action
        );

        if (
                !Telephony.Sms.Intents.SMS_RECEIVED_ACTION
                        .equals(action)
        ) {

            Log.w(
                    TAG,
                    "STOP: Unexpected broadcast action."
            );

            return;
        }

        Log.i(
                TAG,
                "STAGE PASSED: SMS_RECEIVED action confirmed."
        );

        /*
         * =====================================================
         * STAGE 3
         * =====================================================
         *
         * Capture timing information.
         */
        final long now =
                System.currentTimeMillis();

        final long cutoff =
                now - THIRTY_SIX_HOURS_MS;

        Log.i(
                TAG,
                "Receiver time="
                        + now
        );

        Log.i(
                TAG,
                "36-hour cutoff="
                        + cutoff
        );

        final Context appContext =
                context.getApplicationContext();

        try {

            /*
             * =================================================
             * STAGE 4
             * =================================================
             *
             * Initialize the shared SQLite queue.
             */
            Log.i(
                    TAG,
                    "Opening SmsQueueStore..."
            );

            SmsQueueStore store =
                    new SmsQueueStore(
                            appContext
                    );

            Log.i(
                    TAG,
                    "SmsQueueStore opened successfully."
            );

            /*
             * Remove old queue entries.
             */
            try {

                int deleted =
                        store.deleteOlderThan(
                                cutoff
                        );

                Log.i(
                        TAG,
                        "Old queue cleanup completed. " +
                        "deleted=" +
                        deleted
                );

            } catch (Exception cleanupException) {

                /*
                 * Cleanup is not allowed to prevent capture.
                 */
                Log.e(
                        TAG,
                        "WARNING: Queue cleanup failed. " +
                        "Continuing with SMS capture.",
                        cleanupException
                );
            }

            /*
             * =================================================
             * STAGE 5
             * =================================================
             *
             * Decode SMS broadcast.
             */
            Log.i(
                    TAG,
                    "Extracting SMS messages from broadcast..."
            );

            SmsMessage[] messages =
                    Telephony.Sms.Intents
                            .getMessagesFromIntent(
                                    intent
                            );

            if (
                    messages == null ||
                    messages.length == 0
            ) {

                Log.e(
                        TAG,
                        "STOP: SMS_RECEIVED broadcast " +
                        "contained no decoded SMS messages."
                );

                return;
            }

            Log.i(
                    TAG,
                    "SMS messages decoded from broadcast. " +
                    "count="
                            + messages.length
            );

            /*
             * =================================================
             * STAGE 6
             * =================================================
             *
             * Convert Android SMS objects into simple parts.
             */
            List<SmsPart> parts =
                    new ArrayList<>();

            int messageIndex = 0;

            for (
                    SmsMessage message :
                    messages
            ) {

                messageIndex++;

                if (message == null) {

                    Log.w(
                            TAG,
                            "SMS part #"
                                    + messageIndex
                                    + " is NULL. Skipping."
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

                Log.i(
                        TAG,
                        "Decoded SMS part #"
                                + messageIndex
                                + ": "
                                + "address="
                                + address
                                + ", "
                                + "timestamp="
                                + timestamp
                                + ", "
                                + "bodyLength="
                                + (body == null
                                ? 0
                                : body.length())
                );

                if (address.isEmpty()) {

                    Log.w(
                            TAG,
                            "SMS part #"
                                    + messageIndex
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
                                    + messageIndex
                                    + " rejected: empty body."
                    );

                    continue;
                }

                /*
                 * 36-hour validation.
                 */
                if (timestamp < cutoff) {

                    Log.w(
                            TAG,
                            "SMS part #"
                                    + messageIndex
                                    + " rejected: "
                                    + "older than 36 hours. "
                                    + "timestamp="
                                    + timestamp
                                    + ", cutoff="
                                    + cutoff
                    );

                    continue;
                }

                if (timestamp > now) {

                    Log.w(
                            TAG,
                            "SMS part #"
                                    + messageIndex
                                    + " rejected: "
                                    + "future timestamp. "
                                    + "timestamp="
                                    + timestamp
                                    + ", now="
                                    + now
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
                                + messageIndex
                                + " accepted."
                );
            }

            /*
             * =================================================
             * STAGE 7
             * =================================================
             */
            if (parts.isEmpty()) {

                Log.w(
                        TAG,
                        "STOP: Broadcast was received, but " +
                        "zero usable SMS parts passed validation."
                );

                return;
            }

            Log.i(
                    TAG,
                    "Usable SMS parts="
                            + parts.size()
            );

            /*
             * =================================================
             * STAGE 8
             * =================================================
             *
             * Combine multipart messages.
             */
            List<CombinedSms> combinedMessages =
                    combineParts(
                            parts
                    );

            Log.i(
                    TAG,
                    "Combined logical SMS messages="
                            + combinedMessages.size()
            );

            if (combinedMessages.isEmpty()) {

                Log.w(
                        TAG,
                        "STOP: No logical SMS remained after " +
                        "multipart combination."
                );

                return;
            }

            /*
             * =================================================
             * STAGE 9
             * =================================================
             *
             * Persist each SMS into SQLite.
             */
            int insertedCount = 0;
            int duplicateCount = 0;

            for (
                    CombinedSms sms :
                    combinedMessages
            ) {

                Log.i(
                        TAG,
                        "Preparing SMS for local queue: "
                                + "address="
                                + sms.address
                                + ", "
                                + "timestamp="
                                + sms.timestamp
                                + ", "
                                + "bodyLength="
                                + (sms.body == null
                                ? 0
                                : sms.body.length())
                );

                if (sms.timestamp < cutoff) {

                    Log.w(
                            TAG,
                            "Skipping combined SMS: "
                                    + "older than 36 hours."
                    );

                    continue;
                }

                if (sms.timestamp > now) {

                    Log.w(
                            TAG,
                            "Skipping combined SMS: "
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
                            "Skipping combined SMS: empty body."
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
                        "Generated local SMS ID="
                                + id
                );

                /*
                 * =================================================
                 * ACTUAL SQLITE INSERT
                 * =================================================
                 */
                Log.i(
                        TAG,
                        "Attempting SmsQueueStore.insertIfMissing()..."
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

                    insertedCount++;

                    Log.i(
                            TAG,
                            "SUCCESS: SMS INSERTED INTO LOCAL QUEUE. "
                                    + "id="
                                    + id
                    );

                } else {

                    duplicateCount++;

                    Log.i(
                            TAG,
                            "SMS WAS NOT INSERTED BECAUSE IT " +
                            "ALREADY EXISTS IN LOCAL QUEUE. "
                                    + "id="
                                    + id
                    );
                }
            }

            Log.i(
                    TAG,
                    "Queue persistence complete. "
                            + "inserted="
                            + insertedCount
                            + ", duplicates="
                            + duplicateCount
            );

            /*
             * =================================================
             * STAGE 10
             * =================================================
             *
             * Wake the processing worker.
             */
            if (insertedCount > 0) {

                Log.i(
                        TAG,
                        "Attempting to enqueue SmsProcessingWorker..."
                );

                try {

                    SmsProcessingWorker.enqueueNow(
                            appContext
                    );

                    Log.i(
                            TAG,
                            "SUCCESS: SmsProcessingWorker.enqueueNow() " +
                            "completed."
                    );

                } catch (Exception workerException) {

                    Log.e(
                            TAG,
                            "ERROR: SmsProcessingWorker.enqueueNow() " +
                            "failed.",
                            workerException
                    );
                }

                /*
                 * Make sure the periodic safety net remains
                 * scheduled.
                 */
                try {

                    Log.i(
                            TAG,
                            "Ensuring periodic SMS worker is scheduled..."
                    );

                    SmsProcessingWorker.schedule(
                            appContext
                    );

                    Log.i(
                            TAG,
                            "SUCCESS: Periodic SMS worker schedule " +
                            "completed."
                    );

                } catch (Exception scheduleException) {

                    Log.e(
                            TAG,
                            "ERROR: Failed to schedule periodic " +
                            "SMS worker.",
                            scheduleException
                    );
                }

            } else {

                Log.i(
                        TAG,
                        "No newly inserted SMS. Worker was not " +
                        "explicitly enqueued by this receiver."
                );
            }

            /*
             * =================================================
             * COMPLETE
             * =================================================
             */
            Log.i(
                    TAG,
                    "SMS RECEIVER COMPLETE. "
                            + "inserted="
                            + insertedCount
                            + ", duplicates="
                            + duplicateCount
            );

        } catch (Exception e) {

            /*
             * This catches failures anywhere in the receiver
             * pipeline.
             *
             * Most importantly, the initial "SMS RECEIVER
             * INVOKED" message has already been logged, so we
             * can distinguish:
             *
             *     receiver never invoked
             *
             * from:
             *
             *     receiver invoked but failed internally.
             */
            Log.e(
                    TAG,
                    "FATAL RECEIVER ERROR: Failed to capture " +
                    "incoming SMS.",
                    e
            );

        } finally {

            Log.i(
                    TAG,
                    "=================================================="
            );
        }
    }

    /**
     * Combines SMS parts that belong to the same logical message.
     *
     * Android normally supplies multipart parts in their
     * appropriate order.
     *
     * Since the broadcast does not reliably expose a portable
     * multipart sequence number through this code path, we retain
     * Android's supplied order rather than pretending to sort by
     * information we do not have.
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

        for (
                List<SmsPart> group :
                grouped.values()
        ) {

            if (group.isEmpty()) {
                continue;
            }

            /*
             * Do NOT use a fake comparator returning 0.
             *
             * The Android broadcast order is retained.
             */
            StringBuilder body =
                    new StringBuilder();

            SmsPart first =
                    group.get(0);

            for (
                    SmsPart part :
                    group
            ) {

                if (
                        part.body == null ||
                        part.body.isEmpty()
                ) {
                    continue;
                }

                body.append(
                        part.body
                );
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
         * Process logical SMS oldest first.
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
     * Preserve the sender exactly as Android reported it.
     *
     * Phone normalization happens elsewhere.
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
     * Generates a deterministic ID for an SMS.
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
                    MessageDigest.getInstance(
                            "SHA-256"
                    );

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
             * SHA-256 should always be available on Android.
             *
             * Keep a deterministic fallback anyway.
             */
            return "sms-" +
                    Integer.toHexString(
                            identity.hashCode()
                    );
        }
    }
}