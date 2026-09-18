package com.pytbyte.geoshua;

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

/**
 * =========================================================
 * GEO-SHUA
 * FOREGROUND SMS READER
 * =========================================================
 *
 * Reads SMS messages from the Android inbox within the
 * previous 36 hours.
 *
 * This plugin:
 *
 * - Reads the Android SMS inbox only.
 * - Requires READ_SMS permission.
 * - Does not listen for incoming SMS broadcasts.
 * - Does not process SMS in the background.
 * - Does not perform financial/business decisions.
 * - Does not submit HTTP requests.
 * - Returns raw SMS data to JavaScript.
 *
 * Financial processing remains server-side.
 *
 * Flow:
 *
 *      GEO-SHUA OPEN
 *           ↓
 *      User starts SMS processing
 *           ↓
 *      readInbox()
 *           ↓
 *      READ_SMS permission
 *           ↓
 *      Android SMS inbox
 *           ↓
 *      LAST 36 HOURS
 *           ↓
 *      JavaScript receives messages
 *           ↓
 *      JavaScript submits messages to
 *      /api/sms/process
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = {
                Manifest.permission.READ_SMS
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
     * Exactly 36 hours in milliseconds.
     *
     * 36 hours = 1.5 days.
     */
    private static final long THIRTY_SIX_HOURS_MS =
        36L * 60L * 60L * 1000L;


    /* =========================================================
       READ INBOX
    ========================================================= */

    @PluginMethod
    public void readInbox(
        PluginCall call
    ) {

        Log.d(
            TAG,
            "========== READ INBOX START =========="
        );

        Context context =
            getContext();

        if (context == null) {

            Log.e(
                TAG,
                "Android context is unavailable."
            );

            rejectWithDiagnostic(
                call,
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                "context",
                "Android context is unavailable."
            );

            return;
        }


        /* =====================================================
           READ_SMS PERMISSION
        ===================================================== */

        boolean readGranted =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) == PackageManager.PERMISSION_GRANTED;

        Log.d(
            TAG,
            "READ_SMS granted: "
                + readGranted
        );


        if (!readGranted) {

            Log.d(
                TAG,
                "READ_SMS permission missing. Requesting..."
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
                    "Failed to request READ_SMS permission.",
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


        Log.d(
            TAG,
            "READ_SMS permission already granted."
        );

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

            Log.e(
                TAG,
                "Android context unavailable after permission request."
            );

            rejectWithDiagnostic(
                call,
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                "permission_callback",
                "Android context unavailable."
            );

            return;
        }


        boolean readGranted =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) == PackageManager.PERMISSION_GRANTED;

        Log.d(
            TAG,
            "Callback READ_SMS: "
                + readGranted
        );


        if (!readGranted) {

            Log.w(
                TAG,
                "READ_SMS permission was not granted."
            );

            JSObject diagnostic =
                new JSObject();

            diagnostic.put(
                "stage",
                "permission"
            );

            diagnostic.put(
                "permission",
                "denied"
            );

            diagnostic.put(
                "readSms",
                false
            );

            call.reject(
                "Android SMS read permission was not granted.",
                "SMS_PERMISSION_DENIED",
                diagnostic
            );

            return;
        }


        Log.d(
            TAG,
            "READ_SMS permission granted after callback."
        );

        readSms(call);
    }


    /* =========================================================
       READ SMS
    ========================================================= */

    private void readSms(
        PluginCall call
    ) {

        Log.d(
            TAG,
            "========== SMS QUERY START =========="
        );

        Context context =
            getContext();

        if (context == null) {

            rejectWithDiagnostic(
                call,
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                "query_context",
                "Android context unavailable."
            );

            return;
        }


        Cursor cursor = null;

        /*
         * Capture the scan time once.
         *
         * This gives the entire query one consistent
         * 36-hour reference point.
         */
        final long now =
            System.currentTimeMillis();

        final long cutoff =
            now - THIRTY_SIX_HOURS_MS;


        int count = 0;
        int skippedEmptyBody = 0;
        int skippedInvalidDate = 0;
        int skippedFutureDate = 0;
        int skippedInvalidRow = 0;


        try {

            Uri inboxUri =
                Uri.parse(
                    SMS_INBOX_URI
                );


            /* =================================================
               36-HOUR WINDOW
            ================================================= */

            Log.d(
                TAG,
                "Current timestamp: "
                    + now
            );

            Log.d(
                TAG,
                "36-hour cutoff: "
                    + cutoff
            );


            /*
             * Only request SMS whose timestamp is at least
             * 36 hours old or newer.
             *
             * The individual date is also validated below.
             */
            String selection =
                "date >= ?";


            String[] selectionArgs = {
                String.valueOf(
                    cutoff
                )
            };


            /* =================================================
               SMS PROJECTION
            ================================================= */

            String[] projection = {
                "_id",
                "address",
                "body",
                "date"
            };


            /*
             * Newest messages first.
             *
             * _id is used as a deterministic tie-breaker when
             * multiple SMS records have the same timestamp.
             */
            String sortOrder =
                "date DESC, _id DESC";


            Log.d(
                TAG,
                "Querying Android SMS inbox."
            );


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
                    "ContentResolver returned NULL cursor."
                );

                JSObject diagnostic =
                    new JSObject();

                diagnostic.put(
                    "stage",
                    "query"
                );

                diagnostic.put(
                    "uri",
                    SMS_INBOX_URI
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
                    "error",
                    "ContentResolver returned null cursor."
                );

                call.reject(
                    "Android could not access the SMS inbox.",
                    "SMS_QUERY_FAILED",
                    diagnostic
                );

                return;
            }


            Log.d(
                TAG,
                "SMS cursor opened successfully."
            );


            /* =================================================
               COLUMN INDEXES
            ================================================= */

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


            Log.d(
                TAG,
                "Column indexes: "
                    + "_id=" + idIndex
                    + ", address=" + addressIndex
                    + ", body=" + bodyIndex
                    + ", date=" + dateIndex
            );


            /*
             * Body and date are required because the SMS
             * cannot be meaningfully processed without them.
             *
             * _id and address are optional.
             */
            if (
                bodyIndex < 0 ||
                dateIndex < 0
            ) {

                Log.e(
                    TAG,
                    "Required SMS columns are missing."
                );

                JSObject diagnostic =
                    new JSObject();

                diagnostic.put(
                    "stage",
                    "columns"
                );

                diagnostic.put(
                    "idIndex",
                    idIndex
                );

                diagnostic.put(
                    "addressIndex",
                    addressIndex
                );

                diagnostic.put(
                    "bodyIndex",
                    bodyIndex
                );

                diagnostic.put(
                    "dateIndex",
                    dateIndex
                );

                diagnostic.put(
                    "windowHours",
                    36
                );

                call.reject(
                    "Android SMS inbox has an unexpected format.",
                    "SMS_COLUMNS_INVALID",
                    diagnostic
                );

                return;
            }


            /* =================================================
               MESSAGE ARRAY
            ================================================= */

            JSArray messages =
                new JSArray();


            /* =================================================
               READ CURSOR
            ================================================= */

            while (
                cursor.moveToNext()
            ) {

                try {

                    /*
                     * ID is optional.
                     */
                    String id =
                        idIndex >= 0
                            ? cursor.getString(
                                idIndex
                            )
                            : null;


                    /*
                     * Address is optional.
                     */
                    String address =
                        addressIndex >= 0
                            ? cursor.getString(
                                addressIndex
                            )
                            : null;


                    /*
                     * Body is required.
                     */
                    String body =
                        cursor.getString(
                            bodyIndex
                        );


                    /*
                     * Date is required.
                     */
                    long date =
                        cursor.getLong(
                            dateIndex
                        );


                    /* =========================================
                       VALIDATE BODY
                    ========================================= */

                    if (
                        body == null ||
                        body.trim().isEmpty()
                    ) {

                        skippedEmptyBody++;

                        continue;
                    }


                    /* =========================================
                       VALIDATE DATE
                    ========================================= */

                    if (date <= 0L) {

                        skippedInvalidDate++;

                        continue;
                    }


                    /*
                     * Protect against a provider/device clock
                     * returning a timestamp in the future.
                     *
                     * Such a message is not considered part of
                     * this scan's 36-hour window.
                     */
                    if (date > now) {

                        skippedFutureDate++;

                        continue;
                    }


                    /*
                     * The ContentProvider already applied the
                     * lower 36-hour boundary, but keep this
                     * defensive check at row level.
                     */
                    if (date < cutoff) {

                        skippedInvalidRow++;

                        continue;
                    }


                    /* =========================================
                       BUILD MESSAGE
                    ========================================= */

                    JSObject message =
                        new JSObject();


                    message.put(
                        "id",
                        id
                    );


                    message.put(
                        "address",
                        address == null
                            ? ""
                            : address
                    );


                    message.put(
                        "body",
                        body
                    );


                    /*
                     * Keep Android's original epoch timestamp.
                     *
                     * Do not convert this to a Java Date.
                     * The JavaScript/server layer remains
                     * responsible for application-specific
                     * date handling.
                     */
                    message.put(
                        "date",
                        date
                    );


                    messages.put(
                        message
                    );


                    count++;


                } catch (Exception rowException) {

                    /*
                     * A malformed individual SMS must never
                     * terminate the entire inbox scan.
                     */
                    skippedInvalidRow++;

                    Log.w(
                        TAG,
                        "Skipping malformed SMS row.",
                        rowException
                    );
                }
            }


            Log.d(
                TAG,
                "SMS messages read from last 36 hours: "
                    + count
            );

            Log.d(
                TAG,
                "Skipped empty body: "
                    + skippedEmptyBody
            );

            Log.d(
                TAG,
                "Skipped invalid date: "
                    + skippedInvalidDate
            );

            Log.d(
                TAG,
                "Skipped future date: "
                    + skippedFutureDate
            );

            Log.d(
                TAG,
                "Skipped invalid rows: "
                    + skippedInvalidRow
            );


            /* =================================================
               DIAGNOSTIC
            ================================================= */

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
                "count",
                count
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
                "skippedEmptyBody",
                skippedEmptyBody
            );


            diagnostic.put(
                "skippedInvalidDate",
                skippedInvalidDate
            );


            diagnostic.put(
                "skippedFutureDate",
                skippedFutureDate
            );


            diagnostic.put(
                "skippedInvalidRow",
                skippedInvalidRow
            );


            /* =================================================
               RESULT
            ================================================= */

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
                "========== SMS QUERY SUCCESS =========="
            );


            call.resolve(
                result
            );


        } catch (SecurityException e) {

            Log.e(
                TAG,
                "SECURITY EXCEPTION reading SMS inbox.",
                e
            );


            JSObject diagnostic =
                new JSObject();


            diagnostic.put(
                "stage",
                "security"
            );


            diagnostic.put(
                "permission",
                "READ_SMS"
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
                "exception",
                e.getClass().getName()
            );


            call.reject(
                "Android denied access to the SMS inbox.",
                "SMS_SECURITY_EXCEPTION",
                diagnostic
            );


        } catch (IllegalArgumentException e) {

            Log.e(
                TAG,
                "INVALID ARGUMENT reading SMS inbox.",
                e
            );


            JSObject diagnostic =
                new JSObject();


            diagnostic.put(
                "stage",
                "query"
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
                "exception",
                e.getClass().getName()
            );


            call.reject(
                "Android could not query the SMS inbox.",
                "SMS_QUERY_INVALID",
                diagnostic
            );


        } catch (Exception e) {

            Log.e(
                TAG,
                "GENERAL EXCEPTION reading SMS inbox.",
                e
            );


            JSObject diagnostic =
                new JSObject();


            diagnostic.put(
                "stage",
                "exception"
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
                "exception",
                e.getClass().getName()
            );


            diagnostic.put(
                "message",
                e.getMessage() != null
                    ? e.getMessage()
                    : "No exception message"
            );


            call.reject(
                "Android failed while reading the SMS inbox.",
                "SMS_READ_FAILED",
                diagnostic
            );


        } finally {

            if (cursor != null) {

                try {

                    cursor.close();

                } catch (Exception closeException) {

                    Log.w(
                        TAG,
                        "Failed to close SMS cursor.",
                        closeException
                    );
                }
            }


            Log.d(
                TAG,
                "========== SMS QUERY END =========="
            );
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
}
