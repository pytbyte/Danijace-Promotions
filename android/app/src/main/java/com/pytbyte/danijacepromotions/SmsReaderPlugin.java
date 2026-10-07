package com.pytbyte.danijacepromotions;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
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

import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * =========================================================
 * DANIJACE PROMOTIONS
 * SMS READER
 * =========================================================
 *
 * RECOVERY / RECONCILIATION PATH
 *
 * This plugin reads the Android SMS inbox as a recovery
 * mechanism for SMS that may not have been captured by the
 * primary SmsReceiver.
 *
 * PRIMARY PATH
 *
 *     SMS arrives
 *          |
 *          v
 *     SmsReceiver
 *          |
 *          v
 *     SmsQueueStore
 *          |
 *          v
 *     SmsProcessingWorker
 *
 *
 * RECOVERY PATH
 *
 *     readInbox()
 *          |
 *          v
 *     Android SMS inbox
 *          |
 *          v
 *     last 36 hours only
 *          |
 *          v
 *     SmsQueueStore
 *
 *
 * =========================================================
 * SHARED STORAGE
 * =========================================================
 *
 * This class deliberately does NOT contain its own SQLite
 * implementation.
 *
 * All SMS paths use:
 *
 *     SmsQueueStore
 *
 * which owns:
 *
 *     danijace_sms.db
 *     sms_queue
 *
 * This prevents the receiver, worker and reconciliation
 * plugin from accidentally using different databases or
 * schemas.
 *
 *
 * =========================================================
 * IMPORTANT
 * =========================================================
 *
 * This class does NOT:
 *
 * - receive SMS broadcasts
 * - call the backend
 * - parse bank SMS
 * - perform financial processing
 *
 * Those responsibilities belong to:
 *
 *     SmsReceiver
 *     SmsProcessingWorker
 *     backend /api/sms/process
 *
 *
 * The plugin only:
 *
 * - reconciles the Android inbox
 * - exposes pending queue entries to JavaScript
 * - acknowledges processed queue entries
 * - reports pending count
 *
 *
 * =========================================================
 * 36-HOUR RULE
 * =========================================================
 *
 * Only SMS satisfying:
 *
 *     now - 36 hours <= smsDate <= now
 *
 * are eligible.
 *
 * Older local queue entries are removed.
 *
 * Older Android inbox messages are never queried.
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
        "DanijaceSmsReader";

    /*
     * Android inbox provider.
     */
    private static final String SMS_INBOX_URI =
        "content://sms/inbox";

    /*
     * Exactly 36 hours.
     */
    private static final long THIRTY_SIX_HOURS_MS =
        36L * 60L * 60L * 1000L;

    /*
     * Shared local SMS queue.
     *
     * IMPORTANT:
     *
     * Do not replace this with another SQLiteOpenHelper.
     *
     * SmsReceiver and SmsProcessingWorker use the same store.
     */
    private SmsQueueStore smsStore;


    /* =========================================================
       LIFECYCLE
    ========================================================= */

    @Override
    public void load() {

        super.load();

        ensureStore();

        Log.d(
            TAG,
            "SmsReaderPlugin loaded."
        );
    }


    /* =========================================================
       READ / RECONCILE SMS
    ========================================================= */

    /**
     * Reads the Android SMS inbox as a recovery mechanism.
     *
     * Only the previous 36 hours are queried.
     *
     * The Android inbox itself is never scanned historically.
     */
    @PluginMethod
    public void readInbox(
        PluginCall call
    ) {

        Log.d(
            TAG,
            "========== READ SMS START =========="
        );

        Context context =
            getContext();

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

        /*
         * The reconciliation path requires READ_SMS.
         *
         * RECEIVE_SMS is also required because the application
         * uses the SMS_RECEIVED broadcast through SmsReceiver.
         */
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

        Context context =
            getContext();

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

        Context context =
            getContext();

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

        if (smsStore == null) {

            rejectWithDiagnostic(
                call,
                "SMS store unavailable.",
                "SMS_STORE_UNAVAILABLE",
                "store",
                "Unable to initialize shared local SMS database."
            );

            return;
        }

        /*
         * Capture one timestamp for the entire reconciliation
         * operation.
         *
         * This guarantees that:
         *
         * - cleanup
         * - Android inbox query
         * - pending retrieval
         *
         * all use the same 36-hour boundary.
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
            "Cutoff: " + cutoff
        );

        /*
         * Remove queue entries that are no longer inside the
         * 36-hour processing window.
         */
        int deleted =
            smsStore.deleteOlderThan(
                cutoff
            );

        Log.d(
            TAG,
            "Old local SMS removed: "
                + deleted
        );

        /*
         * Recover SMS that may have been missed by SmsReceiver.
         */
        ReconciliationResult reconciliation =
            reconcileAndroidInbox(
                context,
                cutoff,
                now
            );

        /*
         * Retrieve all still-pending entries from the SHARED
         * queue.
         *
         * The shared store controls database ordering.
         *
         * The Capacitor API exposes newest SMS first, so sort
         * the returned list here without changing processing
         * order inside SmsProcessingWorker.
         */
        List<SmsQueueStore.SmsMessage> pendingMessages =
            smsStore.getPendingMessages(
                cutoff,
                now
            );

        Collections.sort(
            pendingMessages,
            new Comparator<SmsQueueStore.SmsMessage>() {

                @Override
                public int compare(
                    SmsQueueStore.SmsMessage first,
                    SmsQueueStore.SmsMessage second
                ) {

                    int dateComparison =
                        Long.compare(
                            second.getSmsDate(),
                            first.getSmsDate()
                        );

                    if (dateComparison != 0) {
                        return dateComparison;
                    }

                    return Long.compare(
                        second.getReceivedAt(),
                        first.getReceivedAt()
                    );
                }
            }
        );

        JSArray messages =
            new JSArray();

        for (
            SmsQueueStore.SmsMessage sms :
            pendingMessages
        ) {

            JSObject message =
                new JSObject();

            message.put(
                "id",
                sms.getId()
            );

            message.put(
                "address",
                sms.getAddress()
            );

            message.put(
                "body",
                sms.getBody()
            );

            message.put(
                "date",
                sms.getSmsDate()
            );

            messages.put(
                message
            );
        }

        /*
         * Diagnostic information is useful when testing Android
         * SMS behaviour.
         */
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
            "scanned",
            reconciliation.scanned
        );

        diagnostic.put(
            "stored",
            reconciliation.stored
        );

        diagnostic.put(
            "duplicates",
            reconciliation.duplicates
        );

        diagnostic.put(
            "skipped",
            reconciliation.skipped
        );

        diagnostic.put(
            "deletedOld",
            deleted
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
            "Reconciliation complete."
                + " scanned="
                + reconciliation.scanned
                + " stored="
                + reconciliation.stored
                + " duplicates="
                + reconciliation.duplicates
                + " skipped="
                + reconciliation.skipped
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

        call.resolve(
            result
        );
    }


    /* =========================================================
       ANDROID INBOX RECONCILIATION
    ========================================================= */

    /**
     * Reads ONLY Android inbox SMS inside the supplied
     * 36-hour window.
     *
     * It does not scan older SMS.
     *
     * It inserts recovered messages into the same shared
     * SmsQueueStore used by SmsReceiver.
     */
    private ReconciliationResult reconcileAndroidInbox(
        Context context,
        long cutoff,
        long now
    ) {

        ReconciliationResult result =
            new ReconciliationResult();

        Cursor cursor = null;

        try {

            Uri inboxUri =
                Uri.parse(
                    SMS_INBOX_URI
                );

            /*
             * Android ContentResolver receives only the desired
             * 36-hour window.
             */
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

            /*
             * Newest Android inbox SMS first.
             */
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
                    "Android SMS inbox returned null cursor."
                );

                return result;
            }

            int idIndex =
                cursor.getColumnIndex(
                    "_id"
                );

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

            /*
             * _id is required for reconciliation because it gives
             * the Android inbox a stable local identifier.
             */
            if (
                idIndex < 0 ||
                bodyIndex < 0 ||
                dateIndex < 0
            ) {

                Log.e(
                    TAG,
                    "Required Android SMS columns are missing."
                );

                return result;
            }

            while (
                cursor.moveToNext()
            ) {

                result.scanned++;

                try {

                    String androidId =
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

                    long smsDate =
                        cursor.getLong(
                            dateIndex
                        );

                    /*
                     * Defensive 36-hour validation.
                     *
                     * Even though the ContentResolver already
                     * filtered the query, validate again before
                     * writing to the queue.
                     */
                    if (
                        smsDate <= 0L ||
                        smsDate < cutoff ||
                        smsDate > now
                    ) {

                        result.skipped++;

                        continue;
                    }

                    if (
                        address == null ||
                        address.trim().isEmpty()
                    ) {

                        result.skipped++;

                        continue;
                    }

                    if (
                        body == null ||
                        body.trim().isEmpty()
                    ) {

                        result.skipped++;

                        continue;
                    }

                    /*
                     * SmsReceiver does not have Android's inbox
                     * _id, therefore _id cannot be used as the
                     * cross-path duplicate identity.
                     *
                     * SmsQueueStore checks:
                     *
                     *     address
                     *     body
                     *     smsDate
                     */
                    if (
                        smsStore.exists(
                            address,
                            body,
                            smsDate
                        )
                    ) {

                        result.duplicates++;

                        continue;
                    }

                    /*
                     * The shared store requires receivedAt.
                     *
                     * Use the current reconciliation time rather
                     * than the SMS timestamp because receivedAt is
                     * a local queue timestamp, not the financial
                     * transaction timestamp.
                     */
                    boolean inserted =
                        smsStore.insertIfMissing(
                            androidId,
                            address,
                            body,
                            smsDate,
                            System.currentTimeMillis()
                        );

                    if (inserted) {

                        result.stored++;

                        /*
                         * A recovered SMS has now entered the same
                         * queue used by SmsReceiver.
                         *
                         * Wake the native worker immediately.
                         *
                         * This means reconciliation does not need
                         * JavaScript to submit the SMS to the
                         * backend.
                         */
                        SmsProcessingWorker.enqueueNow(
                            context.getApplicationContext()
                        );

                        /*
                         * Keep the periodic safety net scheduled.
                         */
                        SmsProcessingWorker.schedule(
                            context.getApplicationContext()
                        );

                    } else {

                        /*
                         * Usually means the SMS was inserted by
                         * another path between the duplicate check
                         * and insert attempt.
                         */
                        result.duplicates++;
                    }

                } catch (Exception rowException) {

                    result.skipped++;

                    Log.w(
                        TAG,
                        "Skipping malformed Android SMS row.",
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
                "Failed to reconcile Android SMS inbox.",
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

        return result;
    }


    /* =========================================================
       ACKNOWLEDGE PROCESSED SMS
    ========================================================= */

    /**
     * Acknowledges SMS entries in the shared queue.
     *
     * Normally the native SmsProcessingWorker handles
     * acknowledgement itself.
     *
     * This method remains for compatibility with the existing
     * JavaScript/API surface.
     */
    @PluginMethod
    public void markProcessed(
        PluginCall call
    ) {

        ensureStore();

        if (smsStore == null) {

            rejectWithDiagnostic(
                call,
                "SMS store unavailable.",
                "SMS_STORE_UNAVAILABLE",
                "mark_processed",
                "Unable to initialize shared local SMS database."
            );

            return;
        }

        JSArray ids =
            call.getArray(
                "ids"
            );

        if (
            ids == null ||
            ids.length() == 0
        ) {

            JSObject result =
                new JSObject();

            result.put(
                "acknowledged",
                0
            );

            call.resolve(
                result
            );

            return;
        }

        int acknowledged = 0;

        for (
            int i = 0;
            i < ids.length();
            i++
        ) {

            try {

                String id =
                    ids.getString(i);

                if (
                    id == null ||
                    id.trim().isEmpty()
                ) {

                    continue;
                }

                if (
                    smsStore.markProcessed(
                        id
                    )
                ) {

                    acknowledged++;
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

        call.resolve(
            result
        );
    }


    /* =========================================================
       PENDING COUNT
    ========================================================= */

    @PluginMethod
    public void getPendingCount(
        PluginCall call
    ) {

        ensureStore();

        if (smsStore == null) {

            rejectWithDiagnostic(
                call,
                "SMS store unavailable.",
                "SMS_STORE_UNAVAILABLE",
                "pending_count",
                "Unable to initialize shared local SMS database."
            );

            return;
        }

        final long now =
            System.currentTimeMillis();

        final long cutoff =
            now - THIRTY_SIX_HOURS_MS;

        /*
         * Remove anything outside the active processing window
         * before reporting the pending count.
         */
        smsStore.deleteOlderThan(
            cutoff
        );

        JSObject result =
            new JSObject();

        result.put(
            "count",
            smsStore.countPending(
                cutoff,
                now
            )
        );

        call.resolve(
            result
        );
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
       SHARED STORE INITIALIZATION
    ========================================================= */

    /**
     * Initializes the ONE shared SMS queue used by:
     *
     *     SmsReceiver
     *     SmsProcessingWorker
     *     SmsReaderPlugin
     */
    private void ensureStore() {

        if (smsStore != null) {
            return;
        }

        Context context =
            getContext();

        if (context == null) {
            return;
        }

        smsStore =
            new SmsQueueStore(
                context.getApplicationContext()
            );
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
       RECONCILIATION RESULT
    ========================================================= */

    /**
     * Internal diagnostic object used only to report the
     * reconciliation operation back to JavaScript.
     */
    private static final class ReconciliationResult {

        int scanned = 0;

        int stored = 0;

        int duplicates = 0;

        int skipped = 0;
    }
}
