package com.pytbyte.geoshua;

import android.app.Activity;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

@CapacitorPlugin(name = "DeviceSecurity")
public class DeviceSecurityPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        Activity activity = getActivity();

        if (!(activity instanceof FragmentActivity)) {
            call.reject(
                "GEO-SHUA Android activity does not support device security."
            );
            return;
        }

        FragmentActivity fragmentActivity =
                (FragmentActivity) activity;

        BiometricManager biometricManager =
                BiometricManager.from(fragmentActivity);

        int result =
                biometricManager.canAuthenticate(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG
                                | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                );

        JSObject response = new JSObject();

        switch (result) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                response.put("available", true);
                response.put("code", "AVAILABLE");
                break;

            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                response.put("available", false);
                response.put("code", "NO_HARDWARE");
                break;

            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                response.put("available", false);
                response.put("code", "HARDWARE_UNAVAILABLE");
                break;

            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                response.put("available", false);
                response.put("code", "NONE_ENROLLED");
                break;

            default:
                response.put("available", false);
                response.put("code", "UNAVAILABLE");
                break;
        }

        call.resolve(response);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        Activity activity = getActivity();

        if (!(activity instanceof FragmentActivity)) {
            call.reject(
                "GEO-SHUA Android activity does not support device security."
            );
            return;
        }

        FragmentActivity fragmentActivity =
                (FragmentActivity) activity;

        BiometricManager biometricManager =
                BiometricManager.from(fragmentActivity);

        int availability =
                biometricManager.canAuthenticate(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG
                                | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                );

        if (availability != BiometricManager.BIOMETRIC_SUCCESS) {
            JSObject response = new JSObject();

            response.put("success", false);
            response.put(
                    "code",
                    getAvailabilityCode(availability)
            );
            response.put(
                    "message",
                    "Android device security is not available."
            );

            call.resolve(response);
            return;
        }

        Executor executor =
                ContextCompat.getMainExecutor(
                        fragmentActivity
                );

        BiometricPrompt.AuthenticationCallback callback =
                new BiometricPrompt.AuthenticationCallback() {

                    @Override
                    public void onAuthenticationSucceeded(
                            @NonNull BiometricPrompt.AuthenticationResult result
                    ) {
                        super.onAuthenticationSucceeded(result);

                        JSObject response =
                                new JSObject();

                        response.put(
                                "success",
                                true
                        );

                        response.put(
                                "method",
                                "android-device-security"
                        );

                        response.put(
                                "message",
                                "Device authentication successful."
                        );

                        call.resolve(response);
                    }

                    @Override
                    public void onAuthenticationError(
                            int errorCode,
                            @NonNull CharSequence errString
                    ) {
                        super.onAuthenticationError(
                                errorCode,
                                errString
                        );

                        JSObject response =
                                new JSObject();

                        response.put(
                                "success",
                                false
                        );

                        response.put(
                                "code",
                                getAuthenticationErrorCode(
                                        errorCode
                                )
                        );

                        response.put(
                                "errorCode",
                                errorCode
                        );

                        response.put(
                                "message",
                                errString.toString()
                        );

                        call.resolve(response);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();

                        /*
                         * Do not resolve or reject here.
                         *
                         * Android can allow another attempt.
                         */
                    }
                };

        BiometricPrompt biometricPrompt =
                new BiometricPrompt(
                        fragmentActivity,
                        executor,
                        callback
                );

        BiometricPrompt.PromptInfo promptInfo =
                new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(
                                "Verify your identity"
                        )
                        .setSubtitle(
                                "Use your Android device security to continue"
                        )
                        .setAllowedAuthenticators(
                                BiometricManager.Authenticators.BIOMETRIC_STRONG
                                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                        )
                        .build();

        biometricPrompt.authenticate(
                promptInfo
        );
    }

    private String getAvailabilityCode(
            int result
    ) {
        switch (result) {
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "NO_HARDWARE";

            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "HARDWARE_UNAVAILABLE";

            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "NONE_ENROLLED";

            default:
                return "UNAVAILABLE";
        }
    }

    private String getAuthenticationErrorCode(
            int errorCode
    ) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_CANCELED:
                return "CANCELED";

            case BiometricPrompt.ERROR_USER_CANCELED:
                return "USER_CANCELED";

            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
                return "NEGATIVE_BUTTON";

            case BiometricPrompt.ERROR_LOCKOUT:
                return "LOCKOUT";

            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "LOCKOUT_PERMANENT";

            case BiometricPrompt.ERROR_TIMEOUT:
                return "TIMEOUT";

            case BiometricPrompt.ERROR_NO_BIOMETRICS:
                return "NO_BIOMETRICS";

            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
                return "HARDWARE_UNAVAILABLE";

            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                return "NO_DEVICE_CREDENTIAL";

            default:
                return "AUTHENTICATION_ERROR";
        }
    }
}