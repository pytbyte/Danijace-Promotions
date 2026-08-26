package com.pytbyte.geoshua;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.READ_SMS }
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    @com.getcapacitor.PluginMethod
    public void readInbox(PluginCall call) {

        if (
            ContextCompat.checkSelfPermission(
                getContext(),
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

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {

        if (getPermissionState("sms") == PermissionState.GRANTED) {
            readSms(call);
        } else {
            call.reject("SMS permission was denied");
        }
    }

    private void readSms(PluginCall call) {

        JSObject diagnostic = new JSObject();

        diagnostic.put("stage", "starting");
        diagnostic.put("permission", "READ_SMS granted");

        try {

            Uri uri = Uri.parse("content://sms/inbox");

            diagnostic.put("stage", "querying_sms_inbox");
            diagnostic.put("uri", uri.toString());

            Cursor cursor = getContext()
                .getContentResolver()
                .query(
                    uri,
                    new String[] {
                        "address",
                        "body",
                        "date"
                    },
                    null,
                    null,
                    "date DESC"
                );

            if (cursor == null) {

                diagnostic.put("stage", "query_returned_null");
                diagnostic.put("cursor", "null");

                call.reject(
                    "SMS query returned null cursor",
                    diagnostic
                );

                return;
            }

            diagnostic.put("stage", "cursor_received");
            diagnostic.put("cursor", "not null");

            JSArray messages = new JSArray();

            int count = 0;

            try {

                while (cursor.moveToNext()) {

                    JSObject message = new JSObject();

                    message.put(
                        "address",
                        cursor.getString(
                            cursor.getColumnIndexOrThrow("address")
                        )
                    );

                    message.put(
                        "body",
                        cursor.getString(
                            cursor.getColumnIndexOrThrow("body")
                        )
                    );

                    message.put(
                        "date",
                        cursor.getLong(
                            cursor.getColumnIndexOrThrow("date")
                        )
                    );

                    messages.put(message);

                    count++;
                }

            } finally {
                cursor.close();
            }

            diagnostic.put("stage", "reading_complete");
            diagnostic.put("messageCount", count);

            JSObject result = new JSObject();

            result.put("messages", messages);
            result.put("diagnostic", diagnostic);

            call.resolve(result);

        } catch (Exception e) {

            diagnostic.put("stage", "exception");
            diagnostic.put(
                "exceptionType",
                e.getClass().getName()
            );
            diagnostic.put(
                "exceptionMessage",
                e.getMessage() != null
                    ? e.getMessage()
                    : "No exception message"
            );

            call.reject(
                "SMS inbox exception",
                e.getMessage() != null
                    ? e.getMessage()
                    : "Unknown exception",
                diagnostic
            );
        }
    }
}