package com.pytbyte.danijacepromotions;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * =========================================================
 * DANIJACE PROMOTIONS
 * SHARED SMS QUEUE STORE
 * =========================================================
 *
 * Single native SQLite storage layer for incoming SMS.
 *
 * Architecture:
 *
 *   Android SMS
 *       ↓
 *   SmsReceiver
 *       ↓
 *   SmsQueueStore
 *       ↓
 *   SmsProcessingWorker
 *       ↓
 *   DANIJACE PROMOTIONS API
 *
 * Shared by:
 *
 *   - SmsReceiver
 *   - SmsProcessingWorker
 *   - SmsReaderPlugin
 *
 * This class ONLY stores and retrieves SMS messages.
 *
 * It does NOT:
 *
 *   - parse bank messages
 *   - call the backend
 *   - process financial transactions
 *   - resolve members
 *   - resolve loans
 *
 * Financial processing remains on the DANIJACE PROMOTIONS server.
 *
 * IMPORTANT:
 *
 * The 36-hour window is a processing/reconciliation window.
 *
 * It is NOT a reason to destroy an unprocessed SMS.
 *
 * Therefore:
 *
 *   processed = 1 + older than retention
 *       → safe to delete
 *
 *   processed = 0
 *       → NEVER delete merely because it is old
 *
 * =========================================================
 */
public final class SmsQueueStore {

    private static final String TAG =
            "DanijaceSmsQueue";

    /* =====================================================
       DATABASE
    ===================================================== */

    private static final String DATABASE_NAME =
            "danijace_sms.db";

    private static final int DATABASE_VERSION =
            1;

    private static final String TABLE_SMS =
            "sms_queue";

    /* =====================================================
       COLUMNS
    ===================================================== */

    private static final String COLUMN_ID =
            "id";

    private static final String COLUMN_ADDRESS =
            "address";

    private static final String COLUMN_BODY =
            "body";

    private static final String COLUMN_SMS_DATE =
            "sms_date";

    private static final String COLUMN_RECEIVED_AT =
            "received_at";

    private static final String COLUMN_PROCESSED =
            "processed";

    /* =====================================================
       DATABASE HELPER
    ===================================================== */

    private final SmsDatabaseHelper databaseHelper;

    public SmsQueueStore(
            @NonNull Context context
    ) {
        Context applicationContext =
                context.getApplicationContext();

        databaseHelper =
                new SmsDatabaseHelper(
                        applicationContext
                );
    }

    /* =====================================================
       DATA MODEL
    ===================================================== */

    /**
     * Represents one queued SMS.
     */
    public static final class SmsMessage {

        private final String id;

        private final String address;

        private final String body;

        private final long smsDate;

        private final long receivedAt;

        private final boolean processed;

        public SmsMessage(
                @NonNull String id,
                @NonNull String address,
                @NonNull String body,
                long smsDate,
                long receivedAt,
                boolean processed
        ) {
            this.id =
                    id;

            this.address =
                    address;

            this.body =
                    body;

            this.smsDate =
                    smsDate;

            this.receivedAt =
                    receivedAt;

            this.processed =
                    processed;
        }

        /* =================================================
           GETTERS
        ================================================= */

        @NonNull
        public String getId() {
            return id;
        }

        @NonNull
        public String getAddress() {
            return address;
        }

        @NonNull
        public String getBody() {
            return body;
        }

        public long getSmsDate() {
            return smsDate;
        }

        public long getReceivedAt() {
            return receivedAt;
        }

        public boolean isProcessed() {
            return processed;
        }
    }

    /* =====================================================
       INSERT
    ===================================================== */

    /**
     * Insert an SMS if it does not already exist.
     *
     * Returns:
     *
     *   true  = inserted
     *   false = already existed / invalid
     *
     * Duplicate detection uses both:
     *
     *   1. supplied ID
     *   2. logical identity:
     *      address + body + smsDate
     *
     * This allows the SMS broadcast receiver and inbox
     * reconciliation path to safely discover the same SMS.
     */
    public boolean insertIfMissing(
            @NonNull String id,
            @NonNull String address,
            @NonNull String body,
            long smsDate,
            long receivedAt
    ) {
        String cleanId =
                id.trim();

        String cleanAddress =
                address.trim();

        String cleanBody =
                body.trim();

        if (
                cleanId.isEmpty() ||
                cleanAddress.isEmpty() ||
                cleanBody.isEmpty()
        ) {
            return false;
        }

        if (smsDate <= 0L) {
            return false;
        }

        if (receivedAt <= 0L) {
            receivedAt =
                    System.currentTimeMillis();
        }

        SQLiteDatabase db =
                databaseHelper.getWritableDatabase();

        /* ================================================
           EXACT ID DUPLICATE
        ================================================= */

        try (
                Cursor cursor =
                        db.query(
                                TABLE_SMS,
                                new String[]{
                                        COLUMN_ID
                                },
                                COLUMN_ID + " = ?",
                                new String[]{
                                        cleanId
                                },
                                null,
                                null,
                                null,
                                "1"
                        )
        ) {
            if (cursor.moveToFirst()) {
                return false;
            }
        }

        /* ================================================
           LOGICAL DUPLICATE
        ================================================= */

        try (
                Cursor cursor =
                        db.query(
                                TABLE_SMS,
                                new String[]{
                                        COLUMN_ID
                                },
                                COLUMN_ADDRESS + " = ?"
                                        + " AND "
                                        + COLUMN_BODY + " = ?"
                                        + " AND "
                                        + COLUMN_SMS_DATE + " = ?",
                                new String[]{
                                        cleanAddress,
                                        cleanBody,
                                        String.valueOf(smsDate)
                                },
                                null,
                                null,
                                null,
                                "1"
                        )
        ) {
            if (cursor.moveToFirst()) {
                return false;
            }
        }

        /* ================================================
           INSERT
        ================================================= */

        ContentValues values =
                new ContentValues();

        values.put(
                COLUMN_ID,
                cleanId
        );

        values.put(
                COLUMN_ADDRESS,
                cleanAddress
        );

        values.put(
                COLUMN_BODY,
                cleanBody
        );

        values.put(
                COLUMN_SMS_DATE,
                smsDate
        );

        values.put(
                COLUMN_RECEIVED_AT,
                receivedAt
        );

        values.put(
                COLUMN_PROCESSED,
                0
        );

        long result =
                db.insertWithOnConflict(
                        TABLE_SMS,
                        null,
                        values,
                        SQLiteDatabase.CONFLICT_IGNORE
                );

        boolean inserted =
                result != -1L;

        if (inserted) {
            Log.d(
                    TAG,
                    "SMS queued: " + cleanId
            );
        }

        return inserted;
    }

    /* =====================================================
       EXISTS
    ===================================================== */

    /**
     * Check whether an SMS exists using its logical
     * identity.
     */
    public boolean exists(
            @NonNull String address,
            @NonNull String body,
            long smsDate
    ) {
        SQLiteDatabase db =
                databaseHelper.getReadableDatabase();

        try (
                Cursor cursor =
                        db.query(
                                TABLE_SMS,
                                new String[]{
                                        COLUMN_ID
                                },
                                COLUMN_ADDRESS + " = ?"
                                        + " AND "
                                        + COLUMN_BODY + " = ?"
                                        + " AND "
                                        + COLUMN_SMS_DATE + " = ?",
                                new String[]{
                                        address,
                                        body,
                                        String.valueOf(smsDate)
                                },
                                null,
                                null,
                                null,
                                "1"
                        )
        ) {
            return cursor.moveToFirst();
        }
    }

    /* =====================================================
       GET PENDING MESSAGES
    ===================================================== */

    /**
     * Return all unprocessed SMS messages inside the
     * supplied time window.
     *
     * Results are returned oldest first so that delayed
     * bank messages are submitted to the backend in
     * chronological order.
     *
     * IMPORTANT:
     *
     * This time window controls which pending messages are
     * automatically selected for processing.
     *
     * It does NOT delete anything outside the window.
     */
    @NonNull
    public List<SmsMessage> getPendingMessages(
            long oldestAllowed,
            long newestAllowed
    ) {
        List<SmsMessage> messages =
                new ArrayList<>();

        SQLiteDatabase db =
                databaseHelper.getReadableDatabase();

        String selection =
                COLUMN_PROCESSED + " = ?"
                        + " AND "
                        + COLUMN_SMS_DATE + " >= ?"
                        + " AND "
                        + COLUMN_SMS_DATE + " <= ?";

        String[] selectionArgs =
                new String[]{
                        "0",
                        String.valueOf(oldestAllowed),
                        String.valueOf(newestAllowed)
                };

        try (
                Cursor cursor =
                        db.query(
                                TABLE_SMS,
                                new String[]{
                                        COLUMN_ID,
                                        COLUMN_ADDRESS,
                                        COLUMN_BODY,
                                        COLUMN_SMS_DATE,
                                        COLUMN_RECEIVED_AT,
                                        COLUMN_PROCESSED
                                },
                                selection,
                                selectionArgs,
                                null,
                                null,
                                COLUMN_SMS_DATE + " ASC, "
                                        + COLUMN_ID + " ASC"
                        )
        ) {
            while (cursor.moveToNext()) {

                String id =
                        cursor.getString(
                                cursor.getColumnIndexOrThrow(
                                        COLUMN_ID
                                )
                        );

                String address =
                        cursor.getString(
                                cursor.getColumnIndexOrThrow(
                                        COLUMN_ADDRESS
                                )
                        );

                String body =
                        cursor.getString(
                                cursor.getColumnIndexOrThrow(
                                        COLUMN_BODY
                                )
                        );

                long smsDate =
                        cursor.getLong(
                                cursor.getColumnIndexOrThrow(
                                        COLUMN_SMS_DATE
                                )
                        );

                long receivedAt =
                        cursor.getLong(
                                cursor.getColumnIndexOrThrow(
                                        COLUMN_RECEIVED_AT
                                )
                        );

                boolean processed =
                        cursor.getInt(
                                cursor.getColumnIndexOrThrow(
                                        COLUMN_PROCESSED
                                )
                        ) != 0;

                messages.add(
                        new SmsMessage(
                                id,
                                address,
                                body,
                                smsDate,
                                receivedAt,
                                processed
                        )
                );
            }
        }

        return messages;
    }

    /* =====================================================
       GET SINGLE MESSAGE
    ===================================================== */

    /**
     * Retrieve one queued SMS by ID.
     */
    @Nullable
    public SmsMessage getMessage(
            @NonNull String id
    ) {
        SQLiteDatabase db =
                databaseHelper.getReadableDatabase();

        try (
                Cursor cursor =
                        db.query(
                                TABLE_SMS,
                                new String[]{
                                        COLUMN_ID,
                                        COLUMN_ADDRESS,
                                        COLUMN_BODY,
                                        COLUMN_SMS_DATE,
                                        COLUMN_RECEIVED_AT,
                                        COLUMN_PROCESSED
                                },
                                COLUMN_ID + " = ?",
                                new String[]{
                                        id
                                },
                                null,
                                null,
                                null,
                                "1"
                        )
        ) {
            if (!cursor.moveToFirst()) {
                return null;
            }

            String messageId =
                    cursor.getString(
                            cursor.getColumnIndexOrThrow(
                                    COLUMN_ID
                            )
                    );

            String address =
                    cursor.getString(
                            cursor.getColumnIndexOrThrow(
                                    COLUMN_ADDRESS
                            )
                    );

            String body =
                    cursor.getString(
                            cursor.getColumnIndexOrThrow(
                                    COLUMN_BODY
                            )
                    );

            long smsDate =
                    cursor.getLong(
                            cursor.getColumnIndexOrThrow(
                                    COLUMN_SMS_DATE
                            )
                    );

            long receivedAt =
                    cursor.getLong(
                            cursor.getColumnIndexOrThrow(
                                    COLUMN_RECEIVED_AT
                            )
                    );

            boolean processed =
                    cursor.getInt(
                            cursor.getColumnIndexOrThrow(
                                    COLUMN_PROCESSED
                            )
                    ) != 0;

            return new SmsMessage(
                    messageId,
                    address,
                    body,
                    smsDate,
                    receivedAt,
                    processed
            );
        }
    }

    /* =====================================================
       MARK PROCESSED
    ===================================================== */

    /**
     * Mark an SMS as successfully processed.
     *
     * This should only happen after the backend has:
     *
     *   - successfully processed the SMS, OR
     *   - confirmed it is already a duplicate, OR
     *   - returned another terminal result.
     *
     * The SMS remains in the local database after this call.
     * It is removed later by deleteOlderThan() once it is
     * outside the retention period.
     */
    public boolean markProcessed(
            @NonNull String id
    ) {
        SQLiteDatabase db =
                databaseHelper.getWritableDatabase();

        ContentValues values =
                new ContentValues();

        values.put(
                COLUMN_PROCESSED,
                1
        );

        int updated =
                db.update(
                        TABLE_SMS,
                        values,
                        COLUMN_ID + " = ?",
                        new String[]{
                                id
                        }
                );

        if (updated > 0) {
            Log.d(
                    TAG,
                    "SMS marked processed: " + id
            );
        }

        return updated > 0;
    }

    /* =====================================================
       MARK PROCESSED BY LOGICAL IDENTITY
    ===================================================== */

    /**
     * Mark an SMS processed using:
     *
     *   address + body + smsDate
     */
    public boolean markProcessed(
            @NonNull String address,
            @NonNull String body,
            long smsDate
    ) {
        SQLiteDatabase db =
                databaseHelper.getWritableDatabase();

        ContentValues values =
                new ContentValues();

        values.put(
                COLUMN_PROCESSED,
                1
        );

        int updated =
                db.update(
                        TABLE_SMS,
                        values,
                        COLUMN_ADDRESS + " = ?"
                                + " AND "
                                + COLUMN_BODY + " = ?"
                                + " AND "
                                + COLUMN_SMS_DATE + " = ?",
                        new String[]{
                                address,
                                body,
                                String.valueOf(smsDate)
                        }
                );

        if (updated > 0) {
            Log.d(
                    TAG,
                    "SMS marked processed by identity"
                            + ": "
                            + address
                            + " @ "
                            + smsDate
            );
        }

        return updated > 0;
    }

    /* =====================================================
       DELETE OLD SMS
    ===================================================== */

    /**
     * Delete processed SMS older than the supplied
     * timestamp.
     *
     * IMPORTANT:
     *
     * NEVER delete an unprocessed SMS here.
     *
     * An unprocessed SMS may represent a legitimate
     * financial event that has not yet reached the backend.
     *
     * The 36-hour window is used for automatic processing
     * and inbox reconciliation. It is NOT a destructive
     * retention rule for pending financial events.
     *
     * Therefore:
     *
     *   processed = 1 AND sms_date < cutoff
     *       → delete
     *
     *   processed = 0
     *       → preserve
     */
    public int deleteOlderThan(
            long cutoff
    ) {
        SQLiteDatabase db =
                databaseHelper.getWritableDatabase();

        int deleted =
                db.delete(
                        TABLE_SMS,
                        COLUMN_PROCESSED + " = ?"
                                + " AND "
                                + COLUMN_SMS_DATE + " < ?",
                        new String[]{
                                "1",
                                String.valueOf(cutoff)
                        }
                );

        if (deleted > 0) {
            Log.d(
                    TAG,
                    "Deleted old processed SMS rows: "
                            + deleted
            );
        }

        return deleted;
    }

    /* =====================================================
       COUNT PENDING
    ===================================================== */

    /**
     * Count unprocessed SMS messages inside a time window.
     */
    public int countPending(
            long oldestAllowed,
            long newestAllowed
    ) {
        SQLiteDatabase db =
                databaseHelper.getReadableDatabase();

        String selection =
                COLUMN_PROCESSED + " = ?"
                        + " AND "
                        + COLUMN_SMS_DATE + " >= ?"
                        + " AND "
                        + COLUMN_SMS_DATE + " <= ?";

        String[] selectionArgs =
                new String[]{
                        "0",
                        String.valueOf(oldestAllowed),
                        String.valueOf(newestAllowed)
                };

        try (
                Cursor cursor =
                        db.query(
                                TABLE_SMS,
                                new String[]{
                                        "COUNT(*)"
                                },
                                selection,
                                selectionArgs,
                                null,
                                null,
                                null
                        )
        ) {
            if (cursor.moveToFirst()) {
                return cursor.getInt(0);
            }
        }

        return 0;
    }

    /* =====================================================
       DATABASE HELPER
    ===================================================== */

    private static final class SmsDatabaseHelper
            extends SQLiteOpenHelper {

        SmsDatabaseHelper(
                @NonNull Context context
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
                @NonNull SQLiteDatabase db
        ) {
            db.execSQL(
                    "CREATE TABLE IF NOT EXISTS "
                            + TABLE_SMS
                            + " ("
                            + COLUMN_ID
                            + " TEXT PRIMARY KEY, "

                            + COLUMN_ADDRESS
                            + " TEXT NOT NULL, "

                            + COLUMN_BODY
                            + " TEXT NOT NULL, "

                            + COLUMN_SMS_DATE
                            + " INTEGER NOT NULL, "

                            + COLUMN_RECEIVED_AT
                            + " INTEGER NOT NULL, "

                            + COLUMN_PROCESSED
                            + " INTEGER NOT NULL DEFAULT 0"
                            + ")"
            );

            /* ============================================
               SMS DATE INDEX
            ============================================ */

            db.execSQL(
                    "CREATE INDEX IF NOT EXISTS "
                            + "idx_sms_queue_date "
                            + "ON "
                            + TABLE_SMS
                            + " ("
                            + COLUMN_SMS_DATE
                            + ")"
            );

            /* ============================================
               PENDING SMS INDEX
            ============================================ */

            db.execSQL(
                    "CREATE INDEX IF NOT EXISTS "
                            + "idx_sms_queue_pending "
                            + "ON "
                            + TABLE_SMS
                            + " ("
                            + COLUMN_PROCESSED
                            + ", "
                            + COLUMN_SMS_DATE
                            + ")"
            );

            /* ============================================
               LOGICAL IDENTITY INDEX
            ============================================ */

            db.execSQL(
                    "CREATE INDEX IF NOT EXISTS "
                            + "idx_sms_queue_identity "
                            + "ON "
                            + TABLE_SMS
                            + " ("
                            + COLUMN_ADDRESS
                            + ", "
                            + COLUMN_SMS_DATE
                            + ")"
            );
        }

        @Override
        public void onUpgrade(
                @NonNull SQLiteDatabase db,
                int oldVersion,
                int newVersion
        ) {
            /*
             * Version 1 is currently the complete schema.
             *
             * There is intentionally no destructive
             * migration here.
             *
             * Future schema versions should use explicit
             * ALTER TABLE / CREATE INDEX migrations.
             */
        }
    }
}
