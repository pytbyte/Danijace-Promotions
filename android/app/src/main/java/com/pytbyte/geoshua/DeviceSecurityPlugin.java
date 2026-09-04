package com.pytbyte.geoshua;

import android.app.Activity;
import android.os.Build;
import android.util.Base64;

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

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "DeviceSecurity")
public class DeviceSecurityPlugin extends Plugin {

    private static final String KEYSTORE_NAME =
            "AndroidKeyStore";

    private static final String RECOVERY_KEY_ALIAS =
            "geoshua_device_recovery_key";

    private static final String SIGNATURE_ALGORITHM =
            "SHA256withECDSA";

    /*
     * =========================================================
     * DEVICE SECURITY AVAILABILITY
     * =========================================================
     */

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

        JSObject response =
                new JSObject();

        switch (result) {

            case BiometricManager.BIOMETRIC_SUCCESS:

                response.put(
                        "available",
                        true
                );

                response.put(
                        "code",
                        "AVAILABLE"
                );

                break;

            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:

                response.put(
                        "available",
                        false
                );

                response.put(
                        "code",
                        "NO_HARDWARE"
                );

                break;

            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:

                response.put(
                        "available",
                        false
                );

                response.put(
                        "code",
                        "HARDWARE_UNAVAILABLE"
                );

                break;

            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:

                response.put(
                        "available",
                        false
                );

                response.put(
                        "code",
                        "NONE_ENROLLED"
                );

                break;

            default:

                response.put(
                        "available",
                        false
                );

                response.put(
                        "code",
                        "UNAVAILABLE"
                );

                break;
        }

        call.resolve(response);
    }

    /*
     * =========================================================
     * NORMAL ANDROID IDENTITY AUTHENTICATION
     * =========================================================
     *
     * Used by the normal GEO-SHUA Identity screen.
     *
     * Supports:
     *
     * - fingerprint
     * - face
     * - device PIN
     * - device pattern
     * - device password
     *
     * This method does NOT create server-verifiable
     * cryptographic proof.
     *
     * Recovery cryptographic proof is handled by
     * signChallenge().
     */

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

        if (availability !=
                BiometricManager.BIOMETRIC_SUCCESS) {

            JSObject response =
                    new JSObject();

            response.put(
                    "success",
                    false
            );

            response.put(
                    "code",
                    getAvailabilityCode(
                            availability
                    )
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

                        super.onAuthenticationSucceeded(
                                result
                        );

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
                         * Do not resolve here.
                         *
                         * Android may permit another
                         * biometric attempt.
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

    /*
     * =========================================================
     * CREATE RECOVERY KEY
     * =========================================================
     *
     * Creates an EC key pair inside Android Keystore.
     *
     * PRIVATE KEY:
     *
     * Never leaves Android Keystore.
     *
     * PUBLIC KEY:
     *
     * Can be sent to the GEO-SHUA server for registration.
     */

    @PluginMethod
    public void createRecoveryKey(
            PluginCall call
    ) {

        try {

            KeyStore keyStore =
                    KeyStore.getInstance(
                            KEYSTORE_NAME
                    );

            keyStore.load(null);

            /*
             * Never replace an existing recovery key
             * automatically.
             */

            if (keyStore.containsAlias(
                    RECOVERY_KEY_ALIAS
            )) {

                PublicKey publicKey =
                        keyStore
                                .getCertificate(
                                        RECOVERY_KEY_ALIAS
                                )
                                .getPublicKey();

                JSObject response =
                        new JSObject();

                response.put(
                        "created",
                        false
                );

                response.put(
                        "existing",
                        true
                );

                response.put(
                        "algorithm",
                        "ECDSA-SHA256"
                );

                response.put(
                        "publicKey",
                        encodeBase64(
                                publicKey.getEncoded()
                        )
                );

                call.resolve(response);

                return;
            }

            /*
             * Generate EC key pair.
             */

            KeyPairGenerator generator =
                    KeyPairGenerator.getInstance(
                            KeyProperties.KEY_ALGORITHM_EC,
                            KEYSTORE_NAME
                    );

            KeyGenParameterSpec.Builder builder =
                    new KeyGenParameterSpec.Builder(
                            RECOVERY_KEY_ALIAS,
                            KeyProperties.PURPOSE_SIGN
                    )
                    .setDigests(
                            KeyProperties.DIGEST_SHA256
                    )
                    .setUserAuthenticationRequired(
                            true
                    );

            /*
             * Android 11+.
             *
             * The key requires user authentication.
             *
             * The key itself permits strong biometric
             * or device credential authentication.
             *
             * The cryptographic BiometricPrompt path
             * below intentionally uses BIOMETRIC_STRONG.
             */

            if (Build.VERSION.SDK_INT >=
                    Build.VERSION_CODES.R) {

                builder.setUserAuthenticationParameters(
                        0,
                        KeyProperties.AUTH_BIOMETRIC_STRONG
                                | KeyProperties.AUTH_DEVICE_CREDENTIAL
                );

            } else {

                /*
                 * Android 7 through Android 10.
                 *
                 * Legacy Keystore authentication API.
                 *
                 * -1 means authentication is required
                 * for every use.
                 */

                builder.setUserAuthenticationValidityDurationSeconds(
                        -1
                );
            }

            generator.initialize(
                    builder.build()
            );

            generator.generateKeyPair();

            /*
             * Retrieve the public key.
             */

            PublicKey publicKey =
                    keyStore
                            .getCertificate(
                                    RECOVERY_KEY_ALIAS
                            )
                            .getPublicKey();

            JSObject response =
                    new JSObject();

            response.put(
                    "created",
                    true
            );

            response.put(
                    "existing",
                    false
            );

            response.put(
                    "algorithm",
                    "ECDSA-SHA256"
            );

            response.put(
                    "publicKey",
                    encodeBase64(
                            publicKey.getEncoded()
                    )
            );

            call.resolve(response);

        } catch (Exception error) {

            call.reject(
                    "Unable to create GEO-SHUA Android recovery key: "
                            + safeErrorMessage(error)
            );
        }
    }

    /*
     * =========================================================
     * HAS RECOVERY KEY
     * =========================================================
     */

    @PluginMethod
    public void hasRecoveryKey(
            PluginCall call
    ) {

        try {

            KeyStore keyStore =
                    KeyStore.getInstance(
                            KEYSTORE_NAME
                    );

            keyStore.load(null);

            boolean exists =
                    keyStore.containsAlias(
                            RECOVERY_KEY_ALIAS
                    );

            JSObject response =
                    new JSObject();

            response.put(
                    "exists",
                    exists
            );

            call.resolve(response);

        } catch (Exception error) {

            call.reject(
                    "Unable to check GEO-SHUA Android recovery key: "
                            + safeErrorMessage(error)
            );
        }
    }

    /*
     * =========================================================
     * GET RECOVERY PUBLIC KEY
     * =========================================================
     */

    @PluginMethod
    public void getRecoveryPublicKey(
            PluginCall call
    ) {

        try {

            KeyStore keyStore =
                    KeyStore.getInstance(
                            KEYSTORE_NAME
                    );

            keyStore.load(null);

            if (!keyStore.containsAlias(
                    RECOVERY_KEY_ALIAS
            )) {

                call.reject(
                        "GEO-SHUA Android recovery key does not exist."
                );

                return;
            }

            PublicKey publicKey =
                    keyStore
                            .getCertificate(
                                    RECOVERY_KEY_ALIAS
                            )
                            .getPublicKey();

            JSObject response =
                    new JSObject();

            response.put(
                    "algorithm",
                    "ECDSA-SHA256"
            );

            response.put(
                    "publicKey",
                    encodeBase64(
                            publicKey.getEncoded()
                    )
            );

            call.resolve(response);

        } catch (Exception error) {

            call.reject(
                    "Unable to read GEO-SHUA Android recovery public key: "
                            + safeErrorMessage(error)
            );
        }
    }

    /*
     * =========================================================
     * SIGN RECOVERY CHALLENGE
     * =========================================================
     *
     * This is the cryptographic recovery operation.
     *
     * FLOW:
     *
     * GEO-SHUA SERVER
     *       |
     *       | random challenge
     *       v
     * Android application
     *       |
     *       v
     * Android Keystore
     *       |
     *       v
     * BiometricPrompt CryptoObject
     *       |
     *       v
     * Strong biometric authentication
     *       |
     *       v
     * ECDSA signature
     *       |
     *       v
     * GEO-SHUA server
     *
     * The private key NEVER leaves Android Keystore.
     */

    @PluginMethod
    public void signChallenge(
            PluginCall call
    ) {

        String challenge =
                call.getString(
                        "challenge"
                );

        if (challenge == null ||
                challenge.trim().isEmpty()) {

            call.reject(
                    "A recovery challenge is required."
            );

            return;
        }

        /*
         * Prevent unnecessarily large payloads.
         */

        if (challenge.length() > 4096) {

            call.reject(
                    "Recovery challenge is too large."
            );

            return;
        }

        Activity activity =
                getActivity();

        if (!(activity instanceof FragmentActivity)) {

            call.reject(
                    "GEO-SHUA Android activity does not support cryptographic authentication."
            );

            return;
        }

        FragmentActivity fragmentActivity =
                (FragmentActivity) activity;

        try {

            /*
             * Load Android Keystore.
             */

            KeyStore keyStore =
                    KeyStore.getInstance(
                            KEYSTORE_NAME
                    );

            keyStore.load(null);

            /*
             * Recovery key must already exist.
             */

            if (!keyStore.containsAlias(
                    RECOVERY_KEY_ALIAS
            )) {

                call.reject(
                        "GEO-SHUA Android recovery key does not exist."
                );

                return;
            }

            /*
             * Retrieve the private key.
             *
             * This remains inside Android Keystore.
             */

            PrivateKey privateKey =
                    (PrivateKey)
                            keyStore.getKey(
                                    RECOVERY_KEY_ALIAS,
                                    null
                            );

            if (privateKey == null) {

                call.reject(
                        "Unable to access GEO-SHUA Android recovery private key."
                );

                return;
            }

            /*
             * Create the ECDSA signature operation.
             */

            Signature signature =
                    Signature.getInstance(
                            SIGNATURE_ALGORITHM
                    );

            signature.initSign(
                    privateKey
            );

            /*
             * Bind the signature operation to
             * BiometricPrompt.
             */

            BiometricPrompt.CryptoObject cryptoObject =
                    new BiometricPrompt.CryptoObject(
                            signature
                    );

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

                            super.onAuthenticationSucceeded(
                                    result
                            );

                            try {

                                /*
                                 * Android returns the authenticated
                                 * CryptoObject.
                                 */

                                BiometricPrompt.CryptoObject authenticatedCrypto =
                                        result.getCryptoObject();

                                if (authenticatedCrypto == null) {

                                    JSObject response =
                                            new JSObject();

                                    response.put(
                                            "success",
                                            false
                                    );

                                    response.put(
                                            "code",
                                            "CRYPTO_OPERATION_UNAVAILABLE"
                                    );

                                    response.put(
                                            "message",
                                            "Android did not return the authenticated cryptographic operation."
                                    );

                                    call.resolve(response);

                                    return;
                                }

                                Signature authenticatedSignature =
                                        authenticatedCrypto.getSignature();

                                if (authenticatedSignature == null) {

                                    JSObject response =
                                            new JSObject();

                                    response.put(
                                            "success",
                                            false
                                    );

                                    response.put(
                                            "code",
                                            "SIGNATURE_OPERATION_UNAVAILABLE"
                                    );

                                    response.put(
                                            "message",
                                            "Android did not return an authenticated signature operation."
                                    );

                                    call.resolve(response);

                                    return;
                                }

                                /*
                                 * Convert the exact server challenge
                                 * to UTF-8 bytes.
                                 */

                                byte[] challengeBytes =
                                        challenge.getBytes(
                                                StandardCharsets.UTF_8
                                        );

                                /*
                                 * Add the challenge to the
                                 * authenticated signature operation.
                                 */

                                authenticatedSignature.update(
                                        challengeBytes
                                );

                                /*
                                 * Produce ECDSA signature.
                                 */

                                byte[] signedBytes =
                                        authenticatedSignature.sign();

                                /*
                                 * Retrieve corresponding public key.
                                 */

                                KeyStore authenticatedKeyStore =
                                        KeyStore.getInstance(
                                                KEYSTORE_NAME
                                        );

                                authenticatedKeyStore.load(null);

                                PublicKey publicKey =
                                        authenticatedKeyStore
                                                .getCertificate(
                                                        RECOVERY_KEY_ALIAS
                                                )
                                                .getPublicKey();

                                /*
                                 * Build response.
                                 */

                                JSObject response =
                                        new JSObject();

                                response.put(
                                        "success",
                                        true
                                );

                                response.put(
                                        "method",
                                        "android-biometric-crypto"
                                );

                                response.put(
                                        "algorithm",
                                        "ECDSA-SHA256"
                                );

                                response.put(
                                        "challenge",
                                        challenge
                                );

                                response.put(
                                        "signature",
                                        encodeBase64(
                                                signedBytes
                                        )
                                );

                                response.put(
                                        "publicKey",
                                        encodeBase64(
                                                publicKey.getEncoded()
                                        )
                                );

                                response.put(
                                        "message",
                                        "Recovery challenge signed successfully."
                                );

                                call.resolve(response);

                            } catch (Exception error) {

                                JSObject response =
                                        new JSObject();

                                response.put(
                                        "success",
                                        false
                                );

                                response.put(
                                        "code",
                                        "SIGNATURE_FAILED"
                                );

                                response.put(
                                        "message",
                                        "Unable to sign the recovery challenge."
                                );

                                call.resolve(response);
                            }
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
                             * Do not resolve here.
                             *
                             * Android can allow another attempt.
                             */
                        }
                    };

            /*
             * CryptoObject authentication must use
             * BIOMETRIC_STRONG.
             *
             * DEVICE_CREDENTIAL is deliberately NOT included
             * in this CryptoObject prompt.
             */

            BiometricPrompt biometricPrompt =
                    new BiometricPrompt(
                            fragmentActivity,
                            executor,
                            callback
                    );

            BiometricPrompt.PromptInfo promptInfo =
                    new BiometricPrompt.PromptInfo.Builder()
                            .setTitle(
                                    "Confirm PIN recovery"
                            )
                            .setSubtitle(
                                    "Use your fingerprint or face to authorize PIN recovery"
                            )
                            .setAllowedAuthenticators(
                                    BiometricManager.Authenticators.BIOMETRIC_STRONG
                            )
                            .build();

            /*
             * AndroidX Biometric 1.1.0:
             *
             * authenticate(
             *     PromptInfo,
             *     CryptoObject
             * )
             */

            biometricPrompt.authenticate(
                    promptInfo,
                    cryptoObject
            );

        } catch (Exception error) {

            call.reject(
                    "Unable to start GEO-SHUA Android cryptographic authentication: "
                            + safeErrorMessage(error)
            );
        }
    }

    /*
     * =========================================================
     * BASE64
     * =========================================================
     *
     * android.util.Base64 is compatible with minSdk 24.
     */

    private String encodeBase64(
            byte[] value
    ) {

        return Base64.encodeToString(
                value,
                Base64.NO_WRAP
        );
    }

    /*
     * =========================================================
     * AVAILABILITY ERROR CODES
     * =========================================================
     */

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

    /*
     * =========================================================
     * AUTHENTICATION ERROR CODES
     * =========================================================
     */

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

    /*
     * =========================================================
     * SAFE ERROR MESSAGE
     * =========================================================
     */

    private String safeErrorMessage(
            Exception error
    ) {

        if (error == null ||
                error.getMessage() == null ||
                error.getMessage().trim().isEmpty()) {

            return "Unknown Android security error.";
        }

        return error.getMessage();
    }
}