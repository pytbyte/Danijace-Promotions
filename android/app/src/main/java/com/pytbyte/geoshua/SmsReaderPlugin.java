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
                "Android context unavailable."
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

        /*
         * The dashboard requires READ_SMS.
         *
         * RECEIVE_SMS is requested at the same time so the
         * background listener can operate after the user grants
         * the SMS permission set.
         */
        if (
            !readGranted ||
            !receiveGranted
        ) {

            requestPermissionForAlias(
                "sms",
                call,
                "smsPermissionCallback"
            );

            return;
        }

        readSms(call);
    }

    /* =====================================================
       PERMISSION CALLBACK
    ===================================================== */

    @SuppressWarnings("unused")
    private void smsPermissionCallback(
        PluginCall call
    ) {

        PermissionState state =
            getPermissionState("sms");

        if (
            state != PermissionState.GRANTED
        ) {

            call.reject(
                "READ_SMS and RECEIVE_SMS permissions were not granted."
            );

            return;
        }

        readSms(call);
    }

    /* =====================================================
       READ SMS
    ===================================================== */

    private void readSms(
        PluginCall call
    ) {

        Context context =
            getContext();

        if (context == null) {

            call.reject(
                "Android context unavailable."
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
                    (String) null,
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

            if (
                bodyIndex < 0 ||
                dateIndex < 0
            ) {

                diagnostic.put(
                    "stage",
                    "columns"
                );

                diagnostic.put(
                    "error",
                    "Required SMS columns are unavailable."
                );

                call.reject(
                    "SMS provider does not expose required columns.",
                    (String) null,
                    diagnostic
                );

                return;
            }

            JSArray messages =
                new JSArray();

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
                    continue;
                }

                if (date <= 0L) {
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
            }

            diagnostic.put(
                "stage",
                "complete"
            );

            diagnostic.put(
                "count",
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
                "SMS permission is unavailable.",
                (String) null,
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
                (String) null,
                diagnostic
            );

        } finally {

            if (cursor != null) {
                cursor.close();
            }
        }
    }
}
