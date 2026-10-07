package com.pytbyte.danijacepromotions;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "SmsSender",
    permissions = {
        @Permission(
            alias = "sms",
            strings = {
                Manifest.permission.SEND_SMS
            }
        ),
        @Permission(
            alias = "phone",
            strings = {
                Manifest.permission.READ_PHONE_STATE
            }
        )
    }
)
public class SmsSenderPlugin extends Plugin {

    /* =====================================================
       SMS PERMISSION
    ===================================================== */

    @PluginMethod
    public void requestPermission(
        PluginCall call
    ) {
        if (
            hasAndroidPermission(
                Manifest.permission.SEND_SMS
            )
        ) {
            resolveSmsPermission(call);
            return;
        }

        requestPermissionForAlias(
            "sms",
            call,
            "smsPermissionCallback"
        );
    }

    @PluginMethod
    public void checkPermission(
        PluginCall call
    ) {
        resolveSmsPermission(call);
    }

    @PermissionCallback
    public void smsPermissionCallback(
        PluginCall call
    ) {
        resolveSmsPermission(call);
    }

    private void resolveSmsPermission(
        PluginCall call
    ) {
        JSObject result =
            new JSObject();

        result.put(
            "granted",
            hasAndroidPermission(
                Manifest.permission.SEND_SMS
            )
        );

        call.resolve(result);
    }

    /* =====================================================
       PHONE / SIM PERMISSION
    ===================================================== */

    @PluginMethod
    public void requestPhonePermission(
        PluginCall call
    ) {
        if (
            hasAndroidPermission(
                Manifest.permission.READ_PHONE_STATE
            )
        ) {
            resolvePhonePermission(call);
            return;
        }

        requestPermissionForAlias(
            "phone",
            call,
            "phonePermissionCallback"
        );
    }

    @PluginMethod
    public void checkPhonePermission(
        PluginCall call
    ) {
        resolvePhonePermission(call);
    }

    @PermissionCallback
    public void phonePermissionCallback(
        PluginCall call
    ) {
        resolvePhonePermission(call);
    }

    private void resolvePhonePermission(
        PluginCall call
    ) {
        JSObject result =
            new JSObject();

        result.put(
            "granted",
            hasAndroidPermission(
                Manifest.permission.READ_PHONE_STATE
            )
        );

        call.resolve(result);
    }

    /**
     * Do not call this hasPermission().
     *
     * Capacitor's Plugin class already exposes
     * a public hasPermission(String) method.
     */
    private boolean hasAndroidPermission(
        String permission
    ) {
        return getContext()
            .checkSelfPermission(
                permission
            )
            == PackageManager.PERMISSION_GRANTED;
    }

    /* =====================================================
       SEND SMS
    ===================================================== */

    @PluginMethod
    public void send(
        PluginCall call
    ) {
        String phone =
            call.getString(
                "phone"
            );

        String message =
            call.getString(
                "message"
            );

        Integer subscriptionId =
            call.getInt(
                "subscriptionId"
            );

        /* -------------------------------------------------
           VALIDATION
        ------------------------------------------------- */

        if (
            phone == null ||
            phone.trim().isEmpty()
        ) {
            call.reject(
                "Recipient phone number is required.",
                "SMS_INVALID_RECIPIENT"
            );

            return;
        }

        if (
            message == null ||
            message.trim().isEmpty()
        ) {
            call.reject(
                "SMS message is required.",
                "SMS_INVALID_MESSAGE"
            );

            return;
        }

        if (
            !hasAndroidPermission(
                Manifest.permission.SEND_SMS
            )
        ) {
            call.reject(
                "SEND_SMS permission has not been granted.",
                "SMS_PERMISSION_REQUIRED"
            );

            return;
        }

        String normalizedPhone =
            phone.trim();

        String normalizedMessage =
            message.trim();

        /* -------------------------------------------------
           SEND
        ------------------------------------------------- */

        try {
            SmsManager smsManager =
                getSmsManager(
                    subscriptionId
                );

            ArrayList<String> parts =
                smsManager.divideMessage(
                    normalizedMessage
                );

            if (
                parts == null ||
                parts.isEmpty()
            ) {
                call.reject(
                    "Android could not divide the SMS message.",
                    "SMS_ENCODING_FAILED"
                );

                return;
            }

            /*
             * IMPORTANT:
             *
             * We intentionally do NOT wait for an SMS_SENT
             * BroadcastReceiver here.
             *
             * Android's sendTextMessage() and
             * sendMultipartTextMessage() hand the SMS to
             * the Android telephony subsystem. On some
             * devices/networks the SENT PendingIntent is
             * not delivered reliably to a dynamically
             * registered receiver.
             *
             * Waiting for that callback caused DANIJACE PROMOTIONS to
             * report:
             *
             *     "SMS send timed out"
             *
             * even though the SMS was actually sent.
             *
             * An explicit Android exception is still treated
             * as a genuine send failure.
             */

            if (
                parts.size() == 1
            ) {
                smsManager.sendTextMessage(
                    normalizedPhone,
                    null,
                    normalizedMessage,
                    null,
                    null
                );

                resolveAccepted(
                    call,
                    false,
                    1
                );

                return;
            }

            smsManager.sendMultipartTextMessage(
                normalizedPhone,
                null,
                parts,
                null,
                null
            );

            resolveAccepted(
                call,
                true,
                parts.size()
            );

        } catch (SecurityException error) {
            call.reject(
                "Android denied SMS sending permission.",
                "SMS_PERMISSION_REQUIRED"
            );

        } catch (IllegalArgumentException error) {
            call.reject(
                error.getMessage() != null
                    ? error.getMessage()
                    : "Invalid SMS arguments.",
                "SMS_INVALID_ARGUMENTS"
            );

        } catch (UnsupportedOperationException error) {
            call.reject(
                error.getMessage() != null
                    ? error.getMessage()
                    : "This device does not support SMS sending.",
                "SMS_NOT_SUPPORTED"
            );

        } catch (Exception error) {
            call.reject(
                error.getMessage() != null
                    ? error.getMessage()
                    : "Failed to send SMS.",
                "SMS_SEND_FAILED"
            );
        }
    }

    /* =====================================================
       ACCEPTED RESULT
    ===================================================== */

    private void resolveAccepted(
        PluginCall call,
        boolean multipart,
        int parts
    ) {
        JSObject result =
            new JSObject();

        /*
         * success means Android accepted the SMS operation
         * without throwing an error.
         */
        result.put(
            "success",
            true
        );

        /*
         * accepted explicitly tells the JS layer that
         * Android accepted the SMS for processing.
         */
        result.put(
            "accepted",
            true
        );

        result.put(
            "multipart",
            multipart
        );

        result.put(
            "parts",
            parts
        );

        result.put(
            "completedParts",
            parts
        );

        call.resolve(
            result
        );
    }

    /* =====================================================
       SMS MANAGER
    ===================================================== */

    private SmsManager getSmsManager(
        Integer subscriptionId
    ) {
        if (
            subscriptionId != null &&
            Build.VERSION.SDK_INT >=
                Build.VERSION_CODES.LOLLIPOP_MR1
        ) {
            return SmsManager
                .getSmsManagerForSubscriptionId(
                    subscriptionId
                );
        }

        return SmsManager.getDefault();
    }

    /* =====================================================
       SIM / SUBSCRIPTIONS
    ===================================================== */

    @PluginMethod
    public void getSubscriptions(
        PluginCall call
    ) {
        if (
            Build.VERSION.SDK_INT <
                Build.VERSION_CODES.LOLLIPOP_MR1
        ) {
            call.reject(
                "SIM subscription information is not supported."
            );

            return;
        }

        if (
            !hasAndroidPermission(
                Manifest.permission.READ_PHONE_STATE
            )
        ) {
            call.reject(
                "READ_PHONE_STATE permission has not been granted.",
                "PHONE_PERMISSION_REQUIRED"
            );

            return;
        }

        try {
            SubscriptionManager manager =
                (SubscriptionManager)
                    getContext()
                        .getSystemService(
                            SubscriptionManager.class
                        );

            if (
                manager == null
            ) {
                call.reject(
                    "Subscription manager is unavailable."
                );

                return;
            }

            List<SubscriptionInfo> subscriptions =
                manager.getActiveSubscriptionInfoList();

            JSArray result =
                new JSArray();

            if (
                subscriptions != null
            ) {
                for (
                    SubscriptionInfo info :
                    subscriptions
                ) {
                    JSObject item =
                        new JSObject();

                    item.put(
                        "subscriptionId",
                        info.getSubscriptionId()
                    );

                    item.put(
                        "simSlotIndex",
                        info.getSimSlotIndex()
                    );

                    CharSequence carrierName =
                        info.getCarrierName();

                    if (
                        carrierName != null
                    ) {
                        item.put(
                            "carrierName",
                            carrierName.toString()
                        );
                    }

                    result.put(
                        item
                    );
                }
            }

            JSObject response =
                new JSObject();

            response.put(
                "subscriptions",
                result
            );

            call.resolve(
                response
            );

        } catch (
            SecurityException error
        ) {
            call.reject(
                "SIM information permission was denied.",
                "PHONE_PERMISSION_REQUIRED"
            );

        } catch (
            Exception error
        ) {
            call.reject(
                error.getMessage() != null
                    ? error.getMessage()
                    : "Failed to read SIM subscriptions."
            );
        }
    }
}
