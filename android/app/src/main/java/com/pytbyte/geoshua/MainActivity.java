package com.pytbyte.geoshua;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int SMS_PERMISSION_REQUEST_CODE = 7100;

    private static final String[] REQUIRED_PERMISSIONS = {
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.SEND_SMS,
            Manifest.permission.READ_PHONE_STATE
    };

    @Override
    public void onCreate(
            Bundle savedInstanceState
    ) {
        registerPlugin(SmsReaderPlugin.class);
        registerPlugin(SmsSenderPlugin.class);
        registerPlugin(DeviceSecurityPlugin.class);

        super.onCreate(savedInstanceState);

        /*
         * Ask for the required Android permissions on
         * first launch.
         *
         * Android will only display permissions that have
         * not already been granted.
         */
        requestRequiredPermissions();

        /*
         * Start the native background SMS outbox worker
         * only when all required permissions are granted.
         *
         * Permission requests are asynchronous. Therefore,
         * the worker must not start while the permission
         * dialog is still being displayed.
         */
        if (hasRequiredPermissions()) {
            SmsOutboxWorker.schedule(this);
        }

        /*
         * Register the current FCM token.
         *
         * This handles existing installations where
         * Firebase does not need to issue a new token.
         */
        FcmTokenRegistrar.register(this);

        handleDeepLink(getIntent());
    }

    private boolean hasRequiredPermissions() {
        if (
                android.os.Build.VERSION.SDK_INT <
                android.os.Build.VERSION_CODES.M
        ) {
            return true;
        }

        for (String permission : REQUIRED_PERMISSIONS) {
            if (
                    ContextCompat.checkSelfPermission(
                            this,
                            permission
                    ) != PackageManager.PERMISSION_GRANTED
            ) {
                return false;
            }
        }

        return true;
    }

    /**
     * Request all permissions required by the native
     * SMS functionality.
     *
     * Already-granted permissions are skipped.
     */
    private void requestRequiredPermissions() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M) {
            return;
        }

        java.util.ArrayList<String> missingPermissions =
                new java.util.ArrayList<>();

        for (String permission : REQUIRED_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    permission
            ) != PackageManager.PERMISSION_GRANTED) {

                missingPermissions.add(permission);
            }
        }

        if (missingPermissions.isEmpty()) {
            return;
        }

        ActivityCompat.requestPermissions(
                this,
                missingPermissions.toArray(
                        new String[0]
                ),
                SMS_PERMISSION_REQUEST_CODE
        );
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(
                requestCode,
                permissions,
                grantResults
        );

        if (requestCode != SMS_PERMISSION_REQUEST_CODE) {
            return;
        }

        /*
         * Do not assume that the user granted everything.
         *
         * Individual permissions can be accepted or denied.
         */

        if (hasRequiredPermissions()) {
            /*
             * The permission request has completed and all
             * required permissions are now actually granted.
             */
            SmsOutboxWorker.schedule(this);
        }

        for (int i = 0; i < permissions.length; i++) {
            boolean granted =
                    grantResults.length > i &&
                    grantResults[i] ==
                            PackageManager.PERMISSION_GRANTED;

            if (granted) {
                android.util.Log.d(
                        "GeoShuaPermissions",
                        "Permission granted: " +
                                permissions[i]
                );
            } else {
                android.util.Log.w(
                        "GeoShuaPermissions",
                        "Permission denied: " +
                                permissions[i]
                );
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        setIntent(intent);

        handleDeepLink(intent);
    }

    private void handleDeepLink(Intent intent) {
        if (intent == null) {
            return;
        }

        if (!Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }

        if (intent.getData() == null) {
            return;
        }

        String url =
                intent.getData().toString();

        String escapedUrl =
                jsonString(url);

        String javascript =
                "window.dispatchEvent(" +
                "new CustomEvent(" +
                "'capacitorDeepLink'," +
                "{ detail: " +
                escapedUrl +
                " }" +
                ")" +
                ");";

        getBridge()
                .getWebView()
                .evaluateJavascript(
                        javascript,
                        null
                );
    }

    private String jsonString(String value) {
        return "\"" +
                value
                        .replace("\\", "\\\\")
                        .replace("\"", "\\\"")
                        .replace("\n", "\\n")
                        .replace("\r", "\\r")
                        .replace("\t", "\\t") +
                "\"";
    }
}
