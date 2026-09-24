package com.pytbyte.geoshua;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.HashSet;
import java.util.Set;

/**
 * =========================================================
 * GEO-SHUA
 * SMS READER
 * =========================================================
 *
 * Responsibilities:
 *
 * 1. Receive SMS continuously through SmsReceiver.
 * 2. Persist every received SMS locally.
 * 3. Never depend on the Capacitor WebView being open.
 * 4. Reconcile against the Android inbox.
 * 5. Never process SMS older than 36 hours.
 * 6. Keep locally queued SMS until JavaScript confirms processing.
 *
 * Important:
 *
 * The SMS_RECEIVED receiver stores the message immediately.
 *
 * It does NOT:
 * - call the backend
 * - perform financial processing
 * - depend on JavaScript
 * - depend on the WebView
 * - depend on FCM
 *
 * This makes SMS capture independent from the rest of the
 * GEO-SHUA application.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = {
                Manifest.permission.READ_SMS,
                Manifest.permission.RECEIVE_SMS
            }
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final String TAG =
        "GeoShuaSmsReader";

    private static final String SMS_INBOX_URI =
        "content://sms/inbox";

    /**
     * Exactly 36 hours.
     *
     * SMS older than this must never be returned for processing.
     */
    private static final long THIRTY_SIX_HOURS_MS =
        36L * 60L * 60L * 1000L;

    private SmsStore smsStore;

    /* =========================================================
       LIFECYCLE
    ========================================================= */

    @Override
    public void load() {
        super.load();

        Context context = getContext();

        if (context != null) {
            smsStore = new SmsStore(context.getApplicationContext());
        }

        Log.d(
            TAG,
            "SmsReaderPlugin loaded."
        );
    }

    /* =========================================================
       READ SMS
    ========================================================= */

    @PluginMethod
    public void readInbox(
        PluginCall call
    ) {

        Log.d(
            TAG,
            "========== READ SMS START =========="
        );

        Context context = getContext();

        if (context == null) {

            rejectWithDiagnostic(
                call,
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                "context",
                "Android context is unavailable."
            );

            return;
        }

        if (!hasSmsPermissions(context)) {

            Log.d(
                TAG,
                "SMS permissions missing. Requesting..."
            );

            try {

                requestPermissionForAlias(
                    "sms",
                    call,
                    "smsPermissionCallback"
                );

            } catch (Exception e) {

                Log.e(
                    TAG,
                    "Failed to request SMS permissions.",
                    e
                );

                rejectWithDiagnostic(
                    call,
                    "Unable to request SMS permission.",
                    "SMS_PERMISSION_REQUEST_FAILED",
                    "permission",
                    e.getClass().getName()
                );
            }

            return;
        }

        readSms(call);
    }

    /* =========================================================
       PERMISSION CALLBACK
    ========================================================= */

    @PermissionCallback
    private void smsPermissionCallback(
        PluginCall call
    ) {

        Log.d(
            TAG,
            "========== SMS PERMISSION CALLBACK =========="
        );

        Context context = getContext();

        if (context == null) {

            rejectWithDiagnostic(
                call,
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                "permission_callback",
                "Android context is unavailable."
            );

            return;
        }

        if (!hasSmsPermissions(context)) {

            JSObject diagnostic =
                new JSObject();

            diagnostic.put(
                "stage",
                "permission"
            );

            diagnostic.put(
                "readSms",
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.READ_SMS
                ) == PackageManager.PERMISSION_GRANTED
            );

            diagnostic.put(
                "receiveSms",
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.RECEIVE_SMS
                ) == PackageManager.PERMISSION_GRANTED
            );

            call.reject(
                "Android SMS permissions were not granted.",
                "SMS_PERMISSION_DENIED",
                diagnostic
            );

            return;
        }

        readSms(call);
    }

    /* =========================================================
       READ / RECONCILE
    ========================================================= */

    private void readSms(
        PluginCall call
    ) {

        Context context = getContext();

        if (context == null) {

            rejectWithDiagnostic(
                call,
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                "query_context",
                "Android context is unavailable."
            );

            return;
        }

        ensureStore();

        /*
         * Capture ONE timestamp for the entire reconciliation.
         */
        final long now =
            System.currentTimeMillis();

        final long cutoff =
            now - THIRTY_SIX_HOURS_MS;

        Log.d(
            TAG,
            "SMS reconciliation started."
        );

        Log.d(
            TAG,
            "Now: " + now
        );

        Log.d(
            TAG,
            "36-hour cutoff: " + cutoff
        );

        /*
         * First remove locally queued messages that are now
         * outside the allowed 36-hour processing window.
         *
         * We intentionally do not keep old SMS forever.
         */
        smsStore.deleteOlderThan(cutoff);

        /*
         * Reconcile the Android inbox.
         *
         * This catches SMS that may have arrived while:
         *
         * - the app was closed
         * - the WebView was unavailable
         * - the receiver was temporarily unavailable
         * - Android delayed delivery
         */
        reconcileAndroidInbox(
            context,
            cutoff,
            now
        );

        /*
         * Return only pending SMS that are still inside the
         * 36-hour window.
         */
        JSArray messages =
            smsStore.getPendingMessages(
                cutoff,
                now
            );

        JSObject diagnostic =
            new JSObject();

        diagnostic.put(
            "stage",
            "complete"
        );

        diagnostic.put(
            "permission",
            "granted"
        );

        diagnostic.put(
            "windowHours",
            36
        );

        diagnostic.put(
            "fromTimestamp",
            cutoff
        );

        diagnostic.put(
            "toTimestamp",
            now
        );

        diagnostic.put(
            "pendingCount",
            messages.length()
        );

        JSObject result =
            new JSObject();

        result.put(
            "messages",
            messages
        );

        result.put(
            "diagnostic",
            diagnostic
        );

        Log.d(
            TAG,
            "Pending SMS returned: "
                + messages.length()
        );

        Log.d(
            TAG,
            "========== READ SMS END =========="
        );

        call.resolve(result);
    }

    /* =========================================================
       RECONCILE ANDROID INBOX
    ========================================================= */

    private void reconcileAndroidInbox(
        Context context,
        long cutoff,
        long now
    ) {

        Cursor cursor = null;

        int scanned = 0;
        int stored = 0;
        int skipped = 0;

        try {

            Uri inboxUri =
                Uri.parse(
                    SMS_INBOX_URI
                );

            String selection =
                "date >= ? AND date <= ?";

            String[] selectionArgs = {
                String.valueOf(cutoff),
                String.valueOf(now)
            };

            String[] projection = {
                "_id",
                "address",
                "body",
                "date"
            };

            String sortOrder =
                "date DESC, _id DESC";

            cursor =
                context
                    .getContentResolver()
                    .query(
                        inboxUri,
                        projection,
                        selection,
                        selectionArgs,
                        sortOrder
                    );

            if (cursor == null) {

                Log.e(
                    TAG,
                    "SMS inbox returned NULL cursor."
                );

                return;
            }

            int idIndex =
                cursor.getColumnIndex("_id");

            int addressIndex =
                cursor.getColumnIndex("address");

            int bodyIndex =
                cursor.getColumnIndex("body");

            int dateIndex =
                cursor.getColumnIndex("date");

            if (
                idIndex < 0 ||
                bodyIndex < 0 ||
                dateIndex < 0
            ) {

                Log.e(
                    TAG,
                    "Required SMS columns missing."
                );

                return;
            }

            while (cursor.moveToNext()) {

                scanned++;

                try {

                    String id =
                        cursor.getString(
                            idIndex
                        );

                    String address =
                        addressIndex >= 0
                            ? cursor.getString(
                                addressIndex
                            )
                            : "";

                    String body =
                        cursor.getString(
                            bodyIndex
                        );

                    long date =
                        cursor.getLong(
                            dateIndex
                        );

                    /*
                     * Absolute 36-hour protection.
                     */
                    if (
                        date <= 0L ||
                        date < cutoff ||
                        date > now ||
                        body == null ||
                        body.trim().isEmpty()
                    ) {

                        skipped++;

                        continue;
                    }

                    boolean inserted =
                        smsStore.insertIfMissing(
                            id,
                            address,
                            body,
                            date
                        );

                    if (inserted) {
                        stored++;
                    }

                } catch (Exception rowException) {

                    skipped++;

                    Log.w(
                        TAG,
                        "Skipping malformed SMS row.",
                        rowException
                    );
                }
            }

        } catch (SecurityException e) {

            Log.e(
                TAG,
                "READ_SMS permission/security error.",
                e
            );

        } catch (Exception e) {

            Log.e(
                TAG,
                "Failed to reconcile SMS inbox.",
                e
            );

        } finally {

            if (cursor != null) {

                try {
                    cursor.close();
                } catch (Exception e) {

                    Log.w(
                        TAG,
                        "Failed to close SMS cursor.",
                        e
                    );
                }
            }
        }

        Log.d(
            TAG,
            "Inbox reconciliation:"
                + " scanned=" + scanned
                + " stored=" + stored
                + " skipped=" + skipped
        );
    }

    /* =========================================================
       ACKNOWLEDGE PROCESSED SMS
    ========================================================= */

    /**
     * JavaScript should call this ONLY after the backend has
     * successfully accepted/processed the SMS.
     *
     * Example:
     *
     * await SmsReader.markProcessed({
     *     ids: ["123", "124"]
     * });
     *
     * The SMS is then permanently removed from the local queue.
     */
    @PluginMethod
    public void markProcessed(
        PluginCall call
    ) {

        ensureStore();

        JSArray ids =
            call.getArray("ids");

        if (ids == null || ids.length() == 0) {

            call.resolve();

            return;
        }

        int acknowledged = 0;

        for (int i = 0; i < ids.length(); i++) {

            try {

                String id =
                    ids.getString(i);

                if (
                    id != null &&
                    !id.trim().isEmpty()
                ) {

                    if (
                        smsStore.markProcessed(id)
                    ) {

                        acknowledged++;
                    }
                }

            } catch (Exception e) {

                Log.w(
                    TAG,
                    "Failed to acknowledge SMS.",
                    e
                );
            }
        }

        JSObject result =
            new JSObject();

        result.put(
            "acknowledged",
            acknowledged
        );

        call.resolve(result);
    }

    /* =========================================================
       PENDING COUNT
    ========================================================= */

    @PluginMethod
    public void getPendingCount(
        PluginCall call
    ) {

        ensureStore();

        long cutoff =
            System.currentTimeMillis()
                - THIRTY_SIX_HOURS_MS;

        long now =
            System.currentTimeMillis();

        smsStore.deleteOlderThan(cutoff);

        JSObject result =
            new JSObject();

        result.put(
            "count",
            smsStore.countPending(
                cutoff,
                now
            )
        );

        call.resolve(result);
    }

    /* =========================================================
       PERMISSIONS
    ========================================================= */

    private boolean hasSmsPermissions(
        Context context
    ) {

        boolean readSms =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) == PackageManager.PERMISSION_GRANTED;

        boolean receiveSms =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECEIVE_SMS
            ) == PackageManager.PERMISSION_GRANTED;

        return readSms && receiveSms;
    }

    /* =========================================================
       STORE
    ========================================================= */

    private void ensureStore() {

        if (smsStore == null) {

            Context context =
                getContext();

            if (context != null) {

                smsStore =
                    new SmsStore(
                        context.getApplicationContext()
                    );
            }
        }
    }

    /* =========================================================
       ERROR HELPER
    ========================================================= */

    private void rejectWithDiagnostic(
        PluginCall call,
        String message,
        String code,
        String stage,
        String error
    ) {

        JSObject diagnostic =
            new JSObject();

        diagnostic.put(
            "stage",
            stage
        );

        diagnostic.put(
            "error",
            error
        );

        call.reject(
            message,
            code,
            diagnostic
        );
    }

    /* =========================================================
       LOCAL SMS STORE
    ========================================================= */

    /**
     * Persistent SQLite queue.
     *
     * This is deliberately independent from the Capacitor
     * WebView and JavaScript.
     */
    private static final class SmsStore
        extends SQLiteOpenHelper {

        private static final String DATABASE_NAME =
            "geoshua_sms.db";

        private static final int DATABASE_VERSION =
            1;

        private static final String TABLE =
            "sms_queue";

        SmsStore(
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
            SQLiteDatabase db
        ) {

            db.execSQL(
                "CREATE TABLE "
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
                "CREATE INDEX idx_sms_queue_date "
                    + "ON "
                    + TABLE
                    + "(sms_date)"
            );

            db.execSQL(
                "CREATE INDEX idx_sms_queue_pending "
                    + "ON "
                    + TABLE
                    + "(processed, sms_date)"
            );
        }

        @Override
        public void onUpgrade(
            SQLiteDatabase db,
            int oldVersion,
            int newVersion
        ) {

            /*
             * Keep existing SMS data during upgrades.
             *
             * Future schema changes should use proper migrations.
             */
        }

        /**
         * Inserts an SMS only if it does not already exist.
         *
         * Android's SMS _id is used as the primary identifier.
         */
        synchronized boolean insertIfMissing(
            String id,
            String address,
            String body,
            long smsDate
        ) {

            if (
                id == null ||
                id.trim().isEmpty()
            ) {

                return false;
            }

            if (
                body == null ||
                body.trim().isEmpty()
            ) {

                return false;
            }

            SQLiteDatabase db =
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
                    SQLiteDatabase.CONFLICT_IGNORE
                );

            return result != -1;
        }

        /**
         * Returns only unprocessed SMS within 36 hours.
         */
        synchronized JSArray getPendingMessages(
            long cutoff,
            long now
        ) {

            JSArray result =
                new JSArray();

            SQLiteDatabase db =
                getReadableDatabase();

            Cursor cursor = null;

            try {

                cursor =
                    db.query(
                        TABLE,
                        new String[] {
                            "id",
                            "address",
                            "body",
                            "sms_date"
                        },
                        "processed = 0"
                            + " AND sms_date >= ?"
                            + " AND sms_date <= ?",
                        new String[] {
                            String.valueOf(cutoff),
                            String.valueOf(now)
                        },
                        null,
                        null,
                        "sms_date DESC, id DESC"
                    );

                while (
                    cursor.moveToNext()
                ) {

                    JSObject message =
                        new JSObject();

                    message.put(
                        "id",
                        cursor.getString(0)
                    );

                    message.put(
                        "address",
                        cursor.getString(1)
                    );

                    message.put(
                        "body",
                        cursor.getString(2)
                    );

                    message.put(
                        "date",
                        cursor.getLong(3)
                    );

                    result.put(
                        message
                    );
                }

            } finally {

                if (cursor != null) {
                    cursor.close();
                }
            }

            return result;
        }

        synchronized boolean markProcessed(
            String id
        ) {

            SQLiteDatabase db =
                getWritableDatabase();

            ContentValues values =
                new ContentValues();

            values.put(
                "processed",
                1
            );

            int rows =
                db.update(
                    TABLE,
                    values,
                    "id = ?",
                    new String[] {
                        id
                    }
                );

            return rows > 0;
        }

        /**
         * SMS older than 36 hours must never remain in the
         * processing queue.
         */
        synchronized void deleteOlderThan(
            long cutoff
        ) {

            SQLiteDatabase db =
                getWritableDatabase();

            db.delete(
                TABLE,
                "sms_date < ?",
                new String[] {
                    String.valueOf(cutoff)
                }
            );
        }

        synchronized int countPending(
            long cutoff,
            long now
        ) {

            SQLiteDatabase db =
                getReadableDatabase();

            Cursor cursor = null;

            try {

                cursor =
                    db.rawQuery(
                        "SELECT COUNT(*)"
                            + " FROM "
                            + TABLE
                            + " WHERE processed = 0"
                            + " AND sms_date >= ?"
                            + " AND sms_date <= ?",
                        new String[] {
                            String.valueOf(cutoff),
                            String.valueOf(now)
                        }
                    );

                if (
                    cursor.moveToFirst()
                ) {

                    return cursor.getInt(0);
                }

            } finally {

                if (cursor != null) {
                    cursor.close();
                }
            }

            return 0;
        }
    }
}