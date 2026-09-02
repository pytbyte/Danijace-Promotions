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
                Manifest.permission.READ_SMS
            }
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final String TAG = "GeoShuaSmsReader";

    /* =====================================================
       READ INBOX
    ===================================================== */

    @PluginMethod
    public void readInbox(PluginCall call) {

        Context context = getContext();

        if (context == null) {
            call.reject(
                "Android context unavailable."
            );
            return;
        }

        /*
         * Check READ_SMS permission before querying
         * the Android SMS provider.
         */
        if (
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.READ_SMS
            ) != PackageManager.PERMISSION_GRANTED
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
    private void smsPermissionCallback(PluginCall call) {

        PermissionState state =
            getPermissionState("sms");

        if (
            state != PermissionState.GRANTED
        ) {
            call.reject(
                "READ_SMS permission was not granted."
            );
            return;
        }

        readSms(call);
    }

    /* =====================================================
       READ SMS
    ===================================================== */

    private void readSms(PluginCall call) {

        Context context = getContext();

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

        Cursor cursor = null;

        try {

            Uri uri =
                Uri.parse(
                    "content://sms/inbox"
                );

            /*
             * Include Android's native SMS _id.
             *
             * This is useful for tracing a message through
             * the diagnostic pipeline.
             */
            String[] projection =
                new String[] {
                    "_id",
                    "address",
                    "body",
                    "date"
                };

            /*
             * Read the complete inbox.
             *
             * This is intentional for the diagnostic dashboard.
             * The dashboard itself will decide which messages
             * are candidates for submission.
             */
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

                /*
                 * Explicitly cast null to String.
                 *
                 * Capacitor 8 has both:
                 *
                 * reject(String, Exception, JSObject)
                 * reject(String, String, JSObject)
                 *
                 * Without the cast Java cannot determine
                 * which overload should be used.
                 */
                call.reject(
                    "Unable to query SMS inbox.",
                    (String) null,
                    diagnostic
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

            /*
             * Body and date are required.
             *
             * _id and address are optional because some SMS
             * providers/devices may expose them differently.
             */
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

            while (cursor.moveToNext()) {

                String id =
                    idIndex >= 0
                        ? cursor.getString(idIndex)
                        : null;

                String address =
                    addressIndex >= 0
                        ? cursor.getString(addressIndex)
                        : null;

                String body =
                    cursor.getString(bodyIndex);

                long date =
                    cursor.getLong(dateIndex);

                /*
                 * Ignore malformed SMS rows.
                 */
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

            call.resolve(result);

        } catch (SecurityException e) {

            Log.e(
                TAG,
                "READ_SMS permission/security failure.",
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
                "READ_SMS permission is unavailable.",
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