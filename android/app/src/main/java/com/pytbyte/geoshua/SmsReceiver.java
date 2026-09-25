package com.pytbyte.geoshua;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
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
 * This is important because the Android application UI may be:
 *
 * - closed
 * - in the background
 * - not currently loaded
 * - on the lock screen
 *
 * The financial processing happens later in the WorkManager worker.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "GeoShuaSmsReceiver";

    /**
     * Only process SMS messages inside this window.
     *
     * Older messages are deliberately ignored.
     */
    private static final long THIRTY_SIX_HOURS_MS =
            36L * 60L * 60L * 1000L;

    /**
     * Android may provide multiple PDUs for one multipart SMS.
     *
     * We group parts using:
     *
     *     normalized sender + SMS timestamp
     *
     * This matches the way Android normally exposes multipart
     * SMS messages received in the same message.
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
     * Internal representation of a complete SMS after its
     * individual parts have been combined.
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
         * Never perform long-running network or financial work
         * inside BroadcastReceiver.
         *
         * We only decode, persist and enqueue WorkManager.
         */

        if (intent == null) {
            Log.w(TAG, "Received null intent.");
            return;
        }

        final String action = intent.getAction();

        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(action)) {
            Log.d(
                    TAG,
                    "Ignoring unexpected action: " + action
            );
            return;
        }

        final Context appContext =
                context.getApplicationContext();

        final long now = System.currentTimeMillis();

        final long cutoff =
                now - THIRTY_SIX_HOURS_MS;

        try {

            /*
             * Clean up anything older than the supported
             * processing window.
             *
             * This also prevents the local queue from growing
             * indefinitely.
             */
            SmsQueueStore store =
                    new SmsQueueStore(appContext);

            store.deleteOlderThan(cutoff);

            /*
             * Android normally provides the SMS PDUs through
             * Telephony.Sms.Intents.getMessagesFromIntent().
             *
             * Using Android's helper is preferable to manually
             * reading "pdus" because it handles the SMS format
             * supplied by the broadcast.
             */
            SmsMessage[] messages =
                    Telephony.Sms.Intents.getMessagesFromIntent(
                            intent
                    );

            if (messages == null || messages.length == 0) {

                Log.w(
                        TAG,
                        "SMS_RECEIVED contained no SMS messages."
                );

                return;
            }

            /*
             * Convert the Android SMS objects into simple parts.
             */
            List<SmsPart> parts =
                    new ArrayList<>();

            for (SmsMessage message : messages) {

                if (message == null) {
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

                if (address.isEmpty()) {
                    Log.w(
                            TAG,
                            "Ignoring SMS with empty sender."
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
                            "Ignoring SMS with empty body."
                    );
                    continue;
                }

                /*
                 * Protect against malformed/future timestamps.
                 *
                 * We only accept:
                 *
                 *     cutoff <= timestamp <= now
                 *
                 * A small future tolerance is intentionally NOT
                 * added here. Android's SMS timestamp should be
                 * trustworthy enough for this boundary.
                 */
                if (timestamp < cutoff) {

                    Log.d(
                            TAG,
                            "Ignoring SMS older than 36 hours. " +
                            "timestamp=" + timestamp
                    );

                    continue;
                }

                if (timestamp > now) {

                    Log.w(
                            TAG,
                            "Ignoring future SMS. " +
                            "timestamp=" + timestamp +
                            ", now=" + now
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
            }

            if (parts.isEmpty()) {

                Log.d(
                        TAG,
                        "No usable SMS parts found."
                );

                return;
            }

            /*
             * Combine multipart messages.
             */
            List<CombinedSms> combinedMessages =
                    combineParts(parts);

            int insertedCount = 0;

            for (CombinedSms sms : combinedMessages) {

                /*
                 * Re-check the 36-hour window after combining.
                 */
                if (sms.timestamp < cutoff) {
                    continue;
                }

                if (sms.timestamp > now) {
                    continue;
                }

                if (sms.body == null ||
                        sms.body.trim().isEmpty()) {
                    continue;
                }

                String id =
                        createStableSmsId(
                                sms.address,
                                sms.timestamp,
                                sms.body
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
                            "Incoming SMS queued. " +
                            "id=" + id +
                            ", address=" + sms.address +
                            ", timestamp=" + sms.timestamp
                    );

                } else {

                    Log.d(
                            TAG,
                            "SMS already exists in local queue. " +
                            "id=" + id
                    );
                }
            }

            /*
             * Wake the processing worker whenever we received
             * something that could be processed.
             *
             * WorkManager's ExistingWorkPolicy.KEEP prevents
             * multiple immediate workers from being created
             * simultaneously.
             */
            if (insertedCount > 0) {

                SmsProcessingWorker.enqueueNow(
                        appContext
                );

                /*
                 * Also make sure the periodic recovery worker
                 * exists.
                 *
                 * This is safe to call repeatedly because the
                 * worker uses ExistingPeriodicWorkPolicy.KEEP.
                 */
                SmsProcessingWorker.schedule(
                        appContext
                );

                Log.i(
                        TAG,
                        "Queued " +
                        insertedCount +
                        " new SMS message(s). " +
                        "Processing worker enqueued."
                );

            } else {

                Log.d(
                        TAG,
                        "No new SMS inserted."
                );
            }

        } catch (Exception e) {

            /*
             * IMPORTANT:
             *
             * Never allow a malformed SMS or an unexpected
             * decoding/storage exception to crash the entire
             * broadcast receiver.
             *
             * The reconciliation path can recover SMS messages
             * later from Android's inbox.
             */
            Log.e(
                    TAG,
                    "Failed to capture incoming SMS.",
                    e
            );
        }
    }

    /**
     * Combines SMS parts that belong to the same logical message.
     *
     * Android normally delivers multipart SMS parts with the same:
     *
     *     sender
     *     timestamp
     *
     * We preserve the incoming order supplied by Android.
     *
     * If the same sender/timestamp appears more than once, the
     * bodies are concatenated.
     */
    private static List<CombinedSms> combineParts(
            List<SmsPart> parts
    ) {

        /*
         * LinkedHashMap would preserve insertion order, but using
         * a normal HashMap followed by deterministic sorting makes
         * the final result explicit.
         */
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

            /*
             * Android generally already supplies parts in order.
             *
             * This sort is deterministic but does not attempt to
             * invent a multipart sequence number that may not be
             * available from the broadcast.
             */
            Collections.sort(
                    group,
                    new Comparator<SmsPart>() {
                        @Override
                        public int compare(
                                SmsPart first,
                                SmsPart second
                        ) {
                            return 0;
                        }
                    }
            );

            StringBuilder body =
                    new StringBuilder();

            SmsPart first =
                    group.get(0);

            for (SmsPart part : group) {

                if (part.body == null ||
                        part.body.isEmpty()) {
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
         * Oldest first makes processing/recovery deterministic.
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
     * Normalize sender addresses without changing their identity.
     *
     * We deliberately do NOT convert Kenyan numbers here from:
     *
     *     07xxxxxxxx
     *
     * to:
     *
     *     +2547xxxxxxxx
     *
     * because the SMS parser/backend already has its own phone
     * normalization rules.
     *
     * The receiver should preserve what Android actually reported.
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
     *
     * SHA-256 is used instead of String.hashCode() because
     * hashCode() is only 32-bit and collisions are possible.
     *
     * The ID is stable for the same:
     *
     *     sender
     *     timestamp
     *     body
     *
     * This is useful for:
     *
     * - local deduplication
     * - backend idempotency
     * - receiver/recovery reconciliation
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
             * SHA-256 is guaranteed by Android, so reaching here
             * would be extremely unusual.
             *
             * Still provide a deterministic fallback rather than
             * dropping the SMS.
             */
            return "sms-" +
                    Integer.toHexString(
                            identity.hashCode()
                    );
        }
    }
}
