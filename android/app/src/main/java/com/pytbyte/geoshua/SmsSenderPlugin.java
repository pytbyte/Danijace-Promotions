package com.pytbyte.geoshua;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

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

    private static final long SEND_RESULT_TIMEOUT_MS = 60_000L;

    private final Handler mainHandler =
        new Handler(
            Looper.getMainLooper()
        );

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
     * Capacitor's Plugin class already exposes a public
     * hasPermission(String) method.
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

            if (
                parts.size() == 1
            ) {
                sendSingleMessage(
                    smsManager,
                    normalizedPhone,
                    normalizedMessage,
                    call
                );

                return;
            }

            sendMultipartMessage(
                smsManager,
                normalizedPhone,
                parts,
                call
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
       SINGLE SMS
    ===================================================== */

    private void sendSingleMessage(
        SmsManager smsManager,
        String phone,
        String message,
        PluginCall call
    ) {
        final String callbackId =
            UUID
                .randomUUID()
                .toString();

        final AtomicBoolean completed =
            new AtomicBoolean(false);

        final String action =
            buildSendAction(
                callbackId
            );

        final BroadcastReceiver receiver =
            createSendReceiver(
                call,
                1,
                completed
            );

        try {
            registerReceiver(
                receiver,
                action
            );

            Intent sentIntent =
                new Intent(
                    action
                );

            PendingIntent sentPendingIntent =
                PendingIntent.getBroadcast(
                    getContext(),
                    createRequestCode(),
                    sentIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT |
                        PendingIntent.FLAG_IMMUTABLE
                );

            smsManager.sendTextMessage(
                phone,
                null,
                message,
                sentPendingIntent,
                null
            );

            scheduleTimeout(
                receiver,
                call,
                completed,
                "SMS send timed out."
            );

        } catch (Exception error) {
            unregisterReceiverSafely(
                receiver
            );

            if (
                completed.compareAndSet(
                    false,
                    true
                )
            ) {
                call.reject(
                    error.getMessage() != null
                        ? error.getMessage()
                        : "Failed to send SMS.",
                    "SMS_SEND_FAILED"
                );
            }
        }
    }

    /* =====================================================
       MULTIPART SMS
    ===================================================== */

    private void sendMultipartMessage(
        SmsManager smsManager,
        String phone,
        ArrayList<String> parts,
        PluginCall call
    ) {
        final String callbackId =
            UUID
                .randomUUID()
                .toString();

        final AtomicBoolean completed =
            new AtomicBoolean(false);

        final String action =
            buildSendAction(
                callbackId
            );

        final BroadcastReceiver receiver =
            createSendReceiver(
                call,
                parts.size(),
                completed
            );

        ArrayList<PendingIntent> sentIntents =
            new ArrayList<>();

        try {
            registerReceiver(
                receiver,
                action
            );

            for (
                int index = 0;
                index < parts.size();
                index++
            ) {
                Intent sentIntent =
                    new Intent(
                        action
                    );

                sentIntent.putExtra(
                    "partIndex",
                    index
                );

                PendingIntent pendingIntent =
                    PendingIntent.getBroadcast(
                        getContext(),
                        createRequestCode(),
                        sentIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT |
                            PendingIntent.FLAG_IMMUTABLE
                    );

                sentIntents.add(
                    pendingIntent
                );
            }

            smsManager.sendMultipartTextMessage(
                phone,
                null,
                parts,
                sentIntents,
                null
            );

            scheduleTimeout(
                receiver,
                call,
                completed,
                "Multipart SMS send timed out."
            );

        } catch (Exception error) {
            unregisterReceiverSafely(
                receiver
            );

            if (
                completed.compareAndSet(
                    false,
                    true
                )
            ) {
                call.reject(
                    error.getMessage() != null
                        ? error.getMessage()
                        : "Failed to send multipart SMS.",
                    "SMS_SEND_FAILED"
                );
            }
        }
    }

    /* =====================================================
       SEND RESULT RECEIVER
    ===================================================== */

    private BroadcastReceiver createSendReceiver(
        PluginCall call,
        int expectedParts,
        AtomicBoolean completed
    ) {
        return new BroadcastReceiver() {

            private int completedParts = 0;

            @Override
            public void onReceive(
                Context context,
                Intent intent
            ) {
                if (
                    completed.get()
                ) {
                    return;
                }

                int resultCode =
                    getResultCode();

                completedParts++;

                /*
                 * Any failed part means the complete SMS
                 * operation is considered failed.
                 */
                if (
                    resultCode !=
                        Activity.RESULT_OK
                ) {
                    if (
                        completed.compareAndSet(
                            false,
                            true
                        )
                    ) {
                        unregisterReceiverSafely(
                            this
                        );

                        String error =
                            getSmsResultMessage(
                                resultCode
                            );

                        JSObject result =
                            new JSObject();

                        result.put(
                            "success",
                            false
                        );

                        result.put(
                            "accepted",
                            false
                        );

                        result.put(
                            "multipart",
                            expectedParts > 1
                        );

                        result.put(
                            "parts",
                            expectedParts
                        );

                        result.put(
                            "completedParts",
                            completedParts
                        );

                        result.put(
                            "errorCode",
                            resultCode
                        );

                        result.put(
                            "error",
                            error
                        );

                        call.reject(
                            error,
                            "SMS_SEND_FAILED",
                            result
                        );
                    }

                    return;
                }

                /*
                 * For multipart messages, wait for every
                 * part to report success.
                 */
                if (
                    completedParts <
                    expectedParts
                ) {
                    return;
                }

                if (
                    completed.compareAndSet(
                        false,
                        true
                    )
                ) {
                    unregisterReceiverSafely(
                        this
                    );

                    JSObject result =
                        new JSObject();

                    result.put(
                        "success",
                        true
                    );

                    result.put(
                        "accepted",
                        true
                    );

                    result.put(
                        "multipart",
                        expectedParts > 1
                    );

                    result.put(
                        "parts",
                        expectedParts
                    );

                    result.put(
                        "completedParts",
                        completedParts
                    );

                    call.resolve(
                        result
                    );
                }
            }
        };
    }

    /* =====================================================
       TIMEOUT
    ===================================================== */

    private void scheduleTimeout(
        BroadcastReceiver receiver,
        PluginCall call,
        AtomicBoolean completed,
        String message
    ) {
        mainHandler.postDelayed(
            () -> {
                if (
                    completed.compareAndSet(
                        false,
                        true
                    )
                ) {
                    unregisterReceiverSafely(
                        receiver
                    );

                    call.reject(
                        message,
                        "SMS_SEND_TIMEOUT"
                    );
                }
            },
            SEND_RESULT_TIMEOUT_MS
        );
    }

    /* =====================================================
       ANDROID SMS ERROR MESSAGES
    ===================================================== */

    private String getSmsResultMessage(
        int resultCode
    ) {
        switch (resultCode) {

            case SmsManager.RESULT_ERROR_GENERIC_FAILURE:
                return "SMS failed due to a generic Android error.";

            case SmsManager.RESULT_ERROR_RADIO_OFF:
                return "The mobile radio is turned off.";

            case SmsManager.RESULT_ERROR_NULL_PDU:
                return "Android could not create the SMS PDU.";

            case SmsManager.RESULT_ERROR_NO_SERVICE:
                return "No mobile network service is currently available.";

            case SmsManager.RESULT_ERROR_LIMIT_EXCEEDED:
                return "The SMS sending limit was exceeded.";

            case SmsManager.RESULT_ERROR_FDN_CHECK_FAILURE:
                return "The SIM fixed dialing check blocked the SMS.";

            default:
                return "Android failed to send the SMS. Result code: "
                    + resultCode;
        }
    }

    /* =====================================================
       RECEIVER REGISTRATION
    ===================================================== */

    private void registerReceiver(
        BroadcastReceiver receiver,
        String action
    ) {
        IntentFilter filter =
            new IntentFilter(
                action
            );

        if (
            Build.VERSION.SDK_INT >=
                Build.VERSION_CODES.TIRAMISU
        ) {
            getContext().registerReceiver(
                receiver,
                filter,
                Context.RECEIVER_NOT_EXPORTED
            );

            return;
        }

        getContext().registerReceiver(
            receiver,
            filter
        );
    }

    private void unregisterReceiverSafely(
        BroadcastReceiver receiver
    ) {
        try {
            getContext().unregisterReceiver(
                receiver
            );
        } catch (
            IllegalArgumentException ignored
        ) {
            /*
             * Receiver was already unregistered.
             */
        }
    }

    /* =====================================================
       UNIQUE IDS
    ===================================================== */

    private int createRequestCode() {
        return UUID
            .randomUUID()
            .hashCode();
    }

    private String buildSendAction(
        String callbackId
    ) {
        return "com.pytbyte.geoshua.SMS_SENT."
            + callbackId;
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

            if (manager == null) {
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
