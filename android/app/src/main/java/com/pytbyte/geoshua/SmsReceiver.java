package com.pytbyte.geoshua;

import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

import java.util.HashSet;
import java.util.Set;

public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG =
        "GeoShuaSmsReceiver";

    private static final String SMS_RECEIVED =
        "android.provider.Telephony.SMS_RECEIVED";

    private static final long THIRTY_SIX_HOURS_MS =
        36L * 60L * 60L * 1000L;

    @Override
    public void onReceive(
        Context context,
        Intent intent
    ) {

        if (intent == null) {
            return;
        }

        if (
            !SMS_RECEIVED.equals(
                intent.getAction()
            )
        ) {

            return;
        }

        Log.d(
            TAG,
            "========== SMS RECEIVED =========="
        );

        /*
         * Never perform network calls here.
         *
         * The broadcast receiver has limited execution time.
         *
         * We only capture and persist the SMS.
         */
        try {

            Bundle extras =
                intent.getExtras();

            if (extras == null) {

                Log.w(
                    TAG,
                    "SMS broadcast has no extras."
                );

                return;
            }

            Object[] pdus =
                (Object[]) extras.get("pdus");

            if (
                pdus == null ||
                pdus.length == 0
            ) {

                Log.w(
                    TAG,
                    "SMS broadcast contains no PDUs."
                );

                return;
            }

            String format =
                extras.getString("format");

            SmsReceiverStore store =
                new SmsReceiverStore(
                    context.getApplicationContext()
                );

            /*
             * Multipart SMS messages can contain multiple PDUs.
             *
             * Group them by originating address + timestamp.
             */
            Set<String> handled =
                new HashSet<>();

            for (Object pdu : pdus) {

                if (pdu == null) {
                    continue;
                }

                SmsMessage sms;

                try {

                    if (format != null) {

                        sms =
                            SmsMessage.createFromPdu(
                                (byte[]) pdu,
                                format
                            );

                    } else {

                        sms =
                            SmsMessage.createFromPdu(
                                (byte[]) pdu
                            );
                    }

                } catch (Exception e) {

                    Log.w(
                        TAG,
                        "Failed to decode SMS PDU.",
                        e
                    );

                    continue;
                }

                if (sms == null) {
                    continue;
                }

                String address =
                    sms.getDisplayOriginatingAddress();

                String body =
                    sms.getDisplayMessageBody();

                long timestamp =
                    sms.getTimestampMillis();

                /*
                 * Absolute 36-hour boundary.
                 *
                 * Older SMS are ignored immediately.
                 */
                long now =
                    System.currentTimeMillis();

                long cutoff =
                    now - THIRTY_SIX_HOURS_MS;

                if (
                    timestamp <= 0L ||
                    timestamp < cutoff ||
                    timestamp > now
                ) {

                    Log.d(
                        TAG,
                        "Ignoring SMS outside 36-hour window."
                    );

                    continue;
                }

                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {

                    continue;
                }

                /*
                 * Prevent multiple PDUs from creating duplicate
                 * local entries.
                 */
                String fingerprint =
                    String.valueOf(address)
                        + "|"
                        + timestamp;

                if (
                    handled.contains(
                        fingerprint
                    )
                ) {

                    continue;
                }

                handled.add(
                    fingerprint
                );

                /*
                 * IMPORTANT:
                 *
                 * SmsReceiver does not know Android's inbox _id
                 * yet. We therefore use a stable receiver ID.
                 */
                String id =
                    buildReceiverId(
                        address,
                        timestamp,
                        body
                    );

                boolean inserted =
                    store.insertIfMissing(
                        id,
                        address,
                        body,
                        timestamp
                    );

                Log.d(
                    TAG,
                    "SMS captured."
                        + " inserted="
                        + inserted
                        + " timestamp="
                        + timestamp
                );
            }

        } catch (Exception e) {

            /*
             * Never allow a malformed SMS to crash the receiver.
             */
            Log.e(
                TAG,
                "Failed while receiving SMS.",
                e
            );
        }

        Log.d(
            TAG,
            "========== SMS RECEIVED END =========="
        );
    }

    private static String buildReceiverId(
        String address,
        long timestamp,
        String body
    ) {

        /*
         * Deterministic local ID.
         *
         * The body is included so two SMS from the same sender
         * with the same timestamp do not collide unnecessarily.
         */
        return "RX-"
            + Integer.toHexString(
                (
                    String.valueOf(address)
                        + "|"
                        + timestamp
                        + "|"
                        + body
                ).hashCode()
            );
    }

    /**
     * Small independent SQLite queue used by the receiver.
     *
     * This intentionally does not depend on SmsReaderPlugin
     * being instantiated.
     */
    private static final class SmsReceiverStore
        extends android.database.sqlite.SQLiteOpenHelper {

        private static final String DATABASE_NAME =
            "geoshua_sms.db";

        private static final int DATABASE_VERSION =
            1;

        private static final String TABLE =
            "sms_queue";

        SmsReceiverStore(
            Context context
        ) {

            super(
                context,
                DATABASE_NAME,
                null,
                DATABASE_VERSION
            );
        }

        @Override
        public void onCreate(
            android.database.sqlite.SQLiteDatabase db
        ) {

            db.execSQL(
                "CREATE TABLE IF NOT EXISTS "
                    + TABLE
                    + " ("
                    + "id TEXT PRIMARY KEY,"
                    + "address TEXT NOT NULL,"
                    + "body TEXT NOT NULL,"
                    + "sms_date INTEGER NOT NULL,"
                    + "received_at INTEGER NOT NULL,"
                    + "processed INTEGER NOT NULL DEFAULT 0"
                    + ")"
            );

            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_sms_queue_date "
                    + "ON "
                    + TABLE
                    + "(sms_date)"
            );

            db.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_sms_queue_pending "
                    + "ON "
                    + TABLE
                    + "(processed, sms_date)"
            );
        }

        @Override
        public void onUpgrade(
            android.database.sqlite.SQLiteDatabase db,
            int oldVersion,
            int newVersion
        ) {
            /*
             * Do not destroy SMS data.
             */
        }

        synchronized boolean insertIfMissing(
            String id,
            String address,
            String body,
            long smsDate
        ) {

            android.database.sqlite.SQLiteDatabase db =
                getWritableDatabase();

            ContentValues values =
                new ContentValues();

            values.put(
                "id",
                id
            );

            values.put(
                "address",
                address == null
                    ? ""
                    : address
            );

            values.put(
                "body",
                body
            );

            values.put(
                "sms_date",
                smsDate
            );

            values.put(
                "received_at",
                System.currentTimeMillis()
            );

            values.put(
                "processed",
                0
            );

            long result =
                db.insertWithOnConflict(
                    TABLE,
                    null,
                    values,
                    android.database.sqlite.SQLiteDatabase.CONFLICT_IGNORE
                );

            return result != -1;
        }
    }
}