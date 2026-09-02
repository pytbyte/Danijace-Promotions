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
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

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

    private static final String TAG = "GeoShuaSmsReader";

    /* =========================================================
       READ INBOX
    ========================================================= */

    @PluginMethod
    public void readInbox(PluginCall call) {

        Log.d(TAG, "========== READ INBOX START ==========");

        Context context = getContext();

        if (context == null) {

            Log.e(TAG, "Context is NULL");

            JSObject diagnostic = new JSObject();

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

        boolean readGranted =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) == PackageManager.PERMISSION_GRANTED;

        boolean receiveGranted =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECEIVE_SMS
            ) == PackageManager.PERMISSION_GRANTED;

        Log.d(
            TAG,
            "READ_SMS granted: " + readGranted
        );

        Log.d(
            TAG,
            "RECEIVE_SMS granted: " + receiveGranted
        );

        PermissionState aliasState =
            getPermissionState("sms");

        Log.d(
            TAG,
            "SMS alias state: " + aliasState
        );

        /*
         * Request the SMS permission group when one or both
         * runtime permissions are missing.
         */
        if (!readGranted || !receiveGranted) {

            Log.d(
                TAG,
                "SMS permission missing. Requesting permission..."
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
            "All SMS permissions granted."
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
            "========== PERMISSION CALLBACK =========="
        );

        Context context = getContext();

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

        boolean receiveGranted =
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECEIVE_SMS
            ) == PackageManager.PERMISSION_GRANTED;

        PermissionState aliasState =
            getPermissionState("sms");

        Log.d(
            TAG,
            "Callback READ_SMS: " + readGranted
        );

        Log.d(
            TAG,
            "Callback RECEIVE_SMS: " + receiveGranted
        );

        Log.d(
            TAG,
            "Callback alias state: " + aliasState
        );

        /*
         * Permission request completed, but Android did not
         * grant both permissions.
         */
        if (!readGranted || !receiveGranted) {

            Log.e(
                TAG,
                "SMS permissions were not granted."
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
                "aliasState",
                aliasState != null
                    ? aliasState.toString()
                    : "UNKNOWN"
            );

            diagnostic.put(
                "readSms",
                readGranted
            );

            diagnostic.put(
                "receiveSms",
                receiveGranted
            );

            call.reject(
                "Android SMS permissions were not granted.",
                "SMS_PERMISSION_DENIED",
                diagnostic
            );

            return;
        }

        Log.d(
            TAG,
            "Permissions granted after callback."
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

        Context context = getContext();

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
                    "content://sms/inbox"
                );

            Log.d(
                TAG,
                "Querying URI: "
                    + inboxUri.toString()
            );

            String[] projection = {
                "_id",
                "address",
                "body",
                "date"
            };

            Log.d(
                TAG,
                "Projection: _id,address,body,date"
            );

            cursor =
                context
                    .getContentResolver()
                    .query(
                        inboxUri,
                        projection,
                        null,
                        null,
                        "date DESC"
                    );

            /*
             * A null cursor means the provider could not
             * service the query.
             */
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
                    inboxUri.toString()
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
                "Cursor opened successfully."
            );

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

            JSArray messages =
                new JSArray();

            int count = 0;

            int skippedEmptyBody = 0;

            int skippedInvalidDate = 0;

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
                 */
                if (date <= 0) {

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
                "SMS messages successfully read: "
                    + count
            );

            /*
             * Detailed diagnostic information is returned to
             * JavaScript so the UI can distinguish successful
             * reads from provider/permission failures.
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
                "count",
                count
            );

            diagnostic.put(
                "skippedEmptyBody",
                skippedEmptyBody
            );

            diagnostic.put(
                "skippedInvalidDate",
                skippedInvalidDate
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
                "========== SMS QUERY SUCCESS =========="
            );

            call.resolve(
                result
            );

        } catch (SecurityException e) {

            Log.e(
                TAG,
                "SECURITY EXCEPTION reading SMS inbox",
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
                "GENERAL EXCEPTION reading SMS inbox",
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