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
<<<<<<< HEAD
 * Reads ONLY SMS received within the last 24 hours.
 *
 * Important:
 *
 * - No BroadcastReceiver
 * - No SMS_RECEIVED listener
 * - No background SMS processing
 * - No boot recovery
 * - No periodic sweep
 * - No background HTTP processing
=======
 * Reads ONLY SMS received during the previous 24 hours.
>>>>>>> 028000f (update sms reader 24hr lookback)
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
<<<<<<< HEAD
 *      LAST 24 HOURS ONLY
=======
 *      ONLY last 24 hours
>>>>>>> 028000f (update sms reader 24hr lookback)
 *           ↓
 *      JavaScript receives messages
 *           ↓
 *      JavaScript submits messages to
 *      /api/sms/process
 *
 * Financial decisions are NOT made here.
 * The server remains authoritative.
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

    /*
<<<<<<< HEAD
     * SMS timestamps returned by Android are milliseconds
     * since Unix epoch.
=======
     * Exactly 24 hours in milliseconds.
>>>>>>> 028000f (update sms reader 24hr lookback)
     */
    private static final long TWENTY_FOUR_HOURS_MS =
        24L * 60L * 60L * 1000L;


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
                "Android context is NULL."
            );

            JSObject diagnostic =
                new JSObject();

            diagnostic.put(
                "stage",
                "context"
            );

            diagnostic.put(
                "error",
                "Android context unavailable."
            );

            call.reject(
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                diagnostic
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


<<<<<<< HEAD
        /*
         * Only READ_SMS is required.
         *
         * RECEIVE_SMS is deliberately NOT requested because
         * GEO-SHUA does not listen for incoming SMS broadcasts.
         */
=======
>>>>>>> 028000f (update sms reader 24hr lookback)
        if (!readGranted) {

            Log.d(
                TAG,
                "READ_SMS permission missing. Requesting..."
            );

            requestPermissionForAlias(
                "sms",
                call,
                "smsPermissionCallback"
            );

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

            JSObject diagnostic =
                new JSObject();

            diagnostic.put(
                "stage",
                "permission_callback"
            );

            diagnostic.put(
                "error",
                "Android context unavailable."
            );

            call.reject(
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                diagnostic
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

            Log.e(
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

            JSObject diagnostic =
                new JSObject();

            diagnostic.put(
                "stage",
                "query_context"
            );

            diagnostic.put(
                "error",
                "Android context unavailable."
            );

            call.reject(
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE",
                diagnostic
            );

            return;
        }


        Cursor cursor = null;

        try {

            Uri inboxUri =
                Uri.parse(
                    SMS_INBOX_URI
                );


            /* =================================================
               24-HOUR WINDOW
            ================================================= */

            long now =
                System.currentTimeMillis();

<<<<<<< HEAD
            long cutoff =
=======
            long twentyFourHoursAgo =
>>>>>>> 028000f (update sms reader 24hr lookback)
                now - TWENTY_FOUR_HOURS_MS;


            Log.d(
                TAG,
<<<<<<< HEAD
                "Current time: "
=======
                "Current timestamp: "
>>>>>>> 028000f (update sms reader 24hr lookback)
                    + now
            );

            Log.d(
                TAG,
<<<<<<< HEAD
                "24-hour cutoff: "
                    + cutoff
=======
                "Reading SMS since: "
                    + twentyFourHoursAgo
>>>>>>> 028000f (update sms reader 24hr lookback)
            );


            /* =================================================
<<<<<<< HEAD
               PROJECTION
=======
               SMS PROJECTION
>>>>>>> 028000f (update sms reader 24hr lookback)
            ================================================= */

            String[] projection = {
                "_id",
                "address",
                "body",
                "date"
            };


            /*
             * IMPORTANT:
             *
<<<<<<< HEAD
             * The 24-hour filter is applied directly by the
             * Android SMS ContentProvider.
             *
             * This means Android does NOT return the old
             * messages to GEO-SHUA in the first place.
             *
             * date >= cutoff
             * date <= now
=======
             * The filtering happens inside the Android
             * ContentResolver query.
             *
             * Android therefore does NOT return the entire
             * SMS inbox to GEO-SHUA.
             *
             * Only messages where:
             *
             *     date >= now - 24 hours
             *
             * are returned.
>>>>>>> 028000f (update sms reader 24hr lookback)
             */
            String selection =
                "date >= ? AND date <= ?";


            String[] selectionArgs = {
<<<<<<< HEAD
                String.valueOf(cutoff),
                String.valueOf(now)
=======
                String.valueOf(
                    twentyFourHoursAgo
                ),
                String.valueOf(
                    now
                )
>>>>>>> 028000f (update sms reader 24hr lookback)
            };


            cursor =
                context
                    .getContentResolver()
                    .query(
                        inboxUri,
                        projection,
                        selection,
                        selectionArgs,
                        "date DESC"
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
             * Body and date are required.
<<<<<<< HEAD
             *
             * _id and address are useful but are not considered
             * fatal if a provider does not expose them.
=======
>>>>>>> 028000f (update sms reader 24hr lookback)
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

            int count =
                0;

            int skippedEmptyBody =
                0;

            int skippedInvalidDate =
                0;


            /* =================================================
               READ CURSOR
            ================================================= */

            while (
                cursor.moveToNext()
            ) {

                String id =
                    idIndex >= 0
                        ? cursor.getString(
                            idIndex
                        )
                        : null;


                String address =
                    addressIndex >= 0
                        ? cursor.getString(
                            addressIndex
                        )
                        : null;


                String body =
                    cursor.getString(
                        bodyIndex
                    );


                long date =
                    cursor.getLong(
                        dateIndex
                    );


                /*
                 * Ignore empty SMS rows.
                 */
                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {

                    skippedEmptyBody++;

                    continue;
                }


                /*
                 * Ignore malformed timestamps.
                 *
                 * Normally this should never happen because
                 * the query itself filters the date.
                 */
                if (date <= 0L) {

                    skippedInvalidDate++;

                    continue;
                }


                JSObject message =
                    new JSObject();


                message.put(
                    "id",
                    id
                );


                message.put(
                    "address",
                    address
                );


                message.put(
                    "body",
                    body
                );


                message.put(
                    "date",
                    date
                );


                messages.put(
                    message
                );


                count++;
            }


            Log.d(
                TAG,
                "SMS messages read from last 24 hours: "
                    + count
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
                24
            );


            diagnostic.put(
                "cutoff",
                cutoff
            );


            diagnostic.put(
                "now",
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
                "windowHours",
                24
            );


            diagnostic.put(
                "fromTimestamp",
                twentyFourHoursAgo
            );


            diagnostic.put(
                "toTimestamp",
                now
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
                "Android denied access to the SMS inbox.",
                "SMS_SECURITY_EXCEPTION",
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

                cursor.close();
            }


            Log.d(
                TAG,
                "========== SMS QUERY END =========="
            );
        }
    }
}