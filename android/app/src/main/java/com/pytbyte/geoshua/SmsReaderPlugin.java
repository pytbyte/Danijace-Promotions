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
import com.getcapacitor.PermissionCallback;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

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

    /* =====================================================
       READ INBOX
    ===================================================== */

    @PluginMethod
    public void readInbox(
        PluginCall call
    ) {

        Context context =
            getContext();

        if (context == null) {

            call.reject(
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE"
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
            "readInbox() permissions: " +
            "READ_SMS=" + readGranted +
            ", RECEIVE_SMS=" + receiveGranted
        );

        /*
         * The GEO-SHUA SMS system uses READ_SMS to inspect
         * the device inbox.
         *
         * RECEIVE_SMS is also declared because the native
         * SMS listener can use it for incoming SMS events.
         *
         * We request the complete declared SMS permission set
         * before reading the inbox.
         */
        if (
            !readGranted ||
            !receiveGranted
        ) {

            Log.d(
                TAG,
                "SMS permissions missing. Requesting permission alias 'sms'."
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
            "SMS permissions already granted. Reading inbox."
        );

        readSms(call);
    }

    /* =====================================================
       PERMISSION CALLBACK
    ===================================================== */

    @PermissionCallback
    private void smsPermissionCallback(
        PluginCall call
    ) {

        Context context =
            getContext();

        if (context == null) {

            call.reject(
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE"
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
            "SMS permission callback: " +
            "alias=" + aliasState +
            ", READ_SMS=" + readGranted +
            ", RECEIVE_SMS=" + receiveGranted
        );

        /*
         * Do not proceed unless the permissions actually exist
         * at the Android level.
         */
        if (
            !readGranted ||
            !receiveGranted
        ) {

            Log.w(
                TAG,
                "SMS permission request was not fully granted."
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
                aliasState.toString()
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
                "READ_SMS and RECEIVE_SMS permissions were not granted.",
                "SMS_PERMISSION_DENIED",
                diagnostic
            );

            return;
        }

        Log.d(
            TAG,
            "SMS permissions granted. Continuing with inbox read."
        );

        readSms(call);
    }

    /* =====================================================
       READ SMS INBOX
    ===================================================== */

    private void readSms(
        PluginCall call
    ) {

        Context context =
            getContext();

        if (context == null) {

            call.reject(
                "Android context unavailable.",
                "SMS_CONTEXT_UNAVAILABLE"
            );

            return;
        }

        JSObject diagnostic =
            new JSObject();

        diagnostic.put(
            "stage",
            "starting"
        );

        diagnostic.put(
            "permission",
            "granted"
        );

        Cursor cursor =
            null;

        try {

            Log.d(
                TAG,
                "Opening SMS inbox query."
            );

            Uri uri =
                Uri.parse(
                    "content://sms/inbox"
                );

            String[] projection =
                new String[] {
                    "_id",
                    "address",
                    "body",
                    "date"
                };

            cursor =
                context
                    .getContentResolver()
                    .query(
                        uri,
                        projection,
                        null,
                        null,
                        "date DESC"
                    );

            if (cursor == null) {

                Log.e(
                    TAG,
                    "SMS inbox query returned null."
                );

                diagnostic.put(
                    "stage",
                    "query"
                );

                diagnostic.put(
                    "error",
                    "SMS inbox query returned null."
                );

                call.reject(
                    "Unable to query SMS inbox.",
                    "SMS_QUERY_FAILED",
                    diagnostic
                );

                return;
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

            Log.d(
                TAG,
                "SMS columns: " +
                "_id=" + idIndex +
                ", address=" + addressIndex +
                ", body=" + bodyIndex +
                ", date=" + dateIndex
            );

            if (
                bodyIndex < 0 ||
                dateIndex < 0
            ) {

                Log.e(
                    TAG,
                    "Required SMS columns are unavailable."
                );

                diagnostic.put(
                    "stage",
                    "columns"
                );

                diagnostic.put(
                    "error",
                    "Required SMS columns are unavailable."
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
                    "SMS provider does not expose required columns.",
                    "SMS_COLUMNS_MISSING",
                    diagnostic
                );

                return;
            }

            JSArray messages =
                new JSArray();

            int skippedEmptyBody =
                0;

            int skippedInvalidDate =
                0;

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

                if (
                    body == null ||
                    body.trim().isEmpty()
                ) {

                    skippedEmptyBody++;

                    continue;
                }

                if (
                    date <= 0L
                ) {

                    skippedInvalidDate++;

                    continue;
                }

                JSObject message =
                    new JSObject();

                if (id != null) {

                    message.put(
                        "id",
                        id
                    );

                } else {

                    message.put(
                        "id",
                        (Object) null
                    );
                }

                if (address != null) {

                    message.put(
                        "address",
                        address
                    );

                } else {

                    message.put(
                        "address",
                        (Object) null
                    );
                }

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
            }

            diagnostic.put(
                "stage",
                "complete"
            );

            diagnostic.put(
                "count",
                messages.length()
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
                "permission",
                "granted"
            );

            Log.d(
                TAG,
                "SMS inbox read complete. " +
                "Messages=" + messages.length() +
                ", skippedEmptyBody=" +
                skippedEmptyBody +
                ", skippedInvalidDate=" +
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

            call.resolve(
                result
            );

        } catch (SecurityException e) {

            Log.e(
                TAG,
                "SMS permission/security failure.",
                e
            );

            diagnostic.put(
                "stage",
                "security"
            );

            diagnostic.put(
                "error",
                e.getMessage() != null
                    ? e.getMessage()
                    : "SecurityException while reading SMS."
            );

            call.reject(
                "Android denied access to the SMS inbox.",
                "SMS_SECURITY_EXCEPTION",
                diagnostic
            );

        } catch (Exception e) {

            Log.e(
                TAG,
                "Failed reading SMS inbox.",
                e
            );

            diagnostic.put(
                "stage",
                "exception"
            );

            diagnostic.put(
                "error",
                e.getMessage() != null
                    ? e.getMessage()
                    : "Unknown SMS reader exception."
            );

            call.reject(
                "Failed to read SMS inbox.",
                "SMS_READ_FAILED",
                diagnostic
            );

        } finally {

            if (cursor != null) {

                cursor.close();

                Log.d(
                    TAG,
                    "SMS cursor closed."
                );
            }
        }
    }
}

