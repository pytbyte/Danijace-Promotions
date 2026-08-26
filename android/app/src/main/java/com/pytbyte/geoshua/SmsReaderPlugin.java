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

        JSArray messages = new JSArray();

        Uri uri = Uri.parse("content://sms/inbox");

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
            call.reject("Unable to read SMS inbox");
            return;
        }

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
            }

        } finally {
            cursor.close();
        }

        JSObject result = new JSObject();
        result.put("messages", messages);

        call.resolve(result);
    }
}
