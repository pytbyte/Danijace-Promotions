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

    /*
     * Versioned recovery-key alias.
     *
     * V2 supports:
     *
     * - strong biometric
     * - device PIN
     * - device pattern
     * - device password
     *
     * The versioned alias prevents an old V1 key from being
     * accidentally reused with the new authentication policy.
     */
    private static final String RECOVERY_KEY_ALIAS =
            "geoshua_device_recovery_key_v2";

    private static final String SIGNATURE_ALGORITHM =
            "SHA256withECDSA";

    /*
     * Device-credential recovery uses a very short authentication
     * validity window.
     *
     * This allows:
     *
     * 1. User authenticates with PIN/pattern/password.
     * 2. Android Keystore records the recent authentication.
     * 3. GEO-SHUA immediately signs the server challenge.
     *
     * The window is intentionally short.
     */
    private static final int DEVICE_AUTH_VALIDITY_SECONDS = 30;

    /*
     * =========================================================
     * DEVICE SECURITY AVAILABILITY
     * =========================================================
     */

    @PluginMethod
    public void isAvailable(
            PluginCall call
    ) {

        Activity activity =
                getActivity();

        if (!(activity instanceof FragmentActivity)) {

            call.reject(
                    "GEO-SHUA Android activity does not support device security."
            );

            return;
        }

        FragmentActivity fragmentActivity =
                (FragmentActivity) activity;

        BiometricManager biometricManager =
                BiometricManager.from(
                        fragmentActivity
                );

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
     * Supports:
     *
     * - fingerprint
     * - face
     * - device PIN
     * - device pattern
     * - device password
     */

    @PluginMethod
    public void authenticate(
            PluginCall call
    ) {

        Activity activity =
                getActivity();

        if (!(activity instanceof FragmentActivity)) {

            call.reject(
                    "GEO-SHUA Android activity does not support device security."
            );

            return;
        }

        FragmentActivity fragmentActivity =
                (FragmentActivity) activity;

        BiometricManager biometricManager =
                BiometricManager.from(
                        fragmentActivity
                );

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
                         * Android may allow another biometric attempt.
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
     * The private key NEVER leaves Android Keystore.
     *
     * The key is configured so that:
     *
     * - strong biometric authentication is accepted
     * - device credential authentication is accepted
     *
     * Device-credential authentication has a very short
     * 30-second validity window.
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
             * Never replace an existing V2 key.
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
                        "success",
                        true
                );

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

                response.put(
                        "message",
                        "GEO-SHUA Android recovery key already exists."
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
             * Allow:
             *
             * - strong biometric
             * - device credential
             *
             * A short authentication validity window is used
             * because device-credential authentication cannot
             * be directly combined with the CryptoObject
             * signing prompt.
             */

            if (Build.VERSION.SDK_INT >=
                    Build.VERSION_CODES.R) {

                builder.setUserAuthenticationParameters(
                        DEVICE_AUTH_VALIDITY_SECONDS,
                        KeyProperties.AUTH_BIOMETRIC_STRONG
                                | KeyProperties.AUTH_DEVICE_CREDENTIAL
                );

            } else {

                /*
                 * Android 7 through Android 10.
                 *
                 * Legacy Keystore API.
                 *
                 * A short validity period allows the
                 * authenticated user to perform the signing
                 * operation immediately after authentication.
                 */

                builder.setUserAuthenticationValidityDurationSeconds(
                        DEVICE_AUTH_VALIDITY_SECONDS
                );
            }

            generator.initialize(
                    builder.build()
            );

            generator.generateKeyPair();

            PublicKey publicKey =
                    keyStore
                            .getCertificate(
                                    RECOVERY_KEY_ALIAS
                            )
                            .getPublicKey();

            JSObject response =
                    new JSObject();

            response.put(
                    "success",
                    true
            );

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

            response.put(
                    "message",
                    "GEO-SHUA Android recovery key created successfully."
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
                    "success",
                    true
            );

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
                    "success",
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
     * There are TWO supported authentication paths.
     *
     * ---------------------------------------------------------
     * PATH 1 — STRONG BIOMETRIC
     * ---------------------------------------------------------
     *
     * BiometricPrompt CryptoObject
     *         ↓
     * Strong biometric
     *         ↓
     * Authenticated Signature
     *         ↓
     * ECDSA signature
     *
     * ---------------------------------------------------------
     * PATH 2 — DEVICE CREDENTIAL
     * ---------------------------------------------------------
     *
     * PIN / pattern / password
     *         ↓
     * Normal BiometricPrompt
     *         ↓
     * Authentication accepted
     *         ↓
     * Android Keystore
     *         ↓
     * ECDSA signature
     *
     * The CryptoObject path remains BIOMETRIC_STRONG only
     * because Android does not permit DEVICE_CREDENTIAL to
     * be combined with a CryptoObject authentication prompt.
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
             * -------------------------------------------------
             * CRYPTOGRAPHIC BIOMETRIC PATH
             * -------------------------------------------------
             *
             * We first attempt the CryptoObject path.
             *
             * Only BIOMETRIC_STRONG is specified here.
             */

            Signature signature =
                    Signature.getInstance(
                            SIGNATURE_ALGORITHM
                    );

            signature.initSign(
                    privateKey
            );

            BiometricPrompt.CryptoObject cryptoObject =
                    new BiometricPrompt.CryptoObject(
                            signature
                    );

            Executor executor =
                    ContextCompat.getMainExecutor(
                            fragmentActivity
                    );

            BiometricPrompt.AuthenticationCallback cryptoCallback =
                    new BiometricPrompt.AuthenticationCallback() {

                        @Override
                        public void onAuthenticationSucceeded(
                                @NonNull BiometricPrompt.AuthenticationResult result
                        ) {

                            super.onAuthenticationSucceeded(
                                    result
                            );

                            try {

                                BiometricPrompt.CryptoObject authenticatedCrypto =
                                        result.getCryptoObject();

                                if (authenticatedCrypto == null) {

                                    resolveFailure(
                                            call,
                                            "CRYPTO_OPERATION_UNAVAILABLE",
                                            "Android did not return the authenticated cryptographic operation."
                                    );

                                    return;
                                }

                                Signature authenticatedSignature =
                                        authenticatedCrypto.getSignature();

                                if (authenticatedSignature == null) {

                                    resolveFailure(
                                            call,
                                            "SIGNATURE_OPERATION_UNAVAILABLE",
                                            "Android did not return an authenticated signature operation."
                                    );

                                    return;
                                }

                                byte[] challengeBytes =
                                        challenge.getBytes(
                                                StandardCharsets.UTF_8
                                        );

                                authenticatedSignature.update(
                                        challengeBytes
                                );

                                byte[] signedBytes =
                                        authenticatedSignature.sign();

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
                                        "Recovery challenge signed successfully with strong biometric authentication."
                                );

                                call.resolve(
                                        response
                                );

                            } catch (Exception error) {

                                resolveFailure(
                                        call,
                                        "BIOMETRIC_SIGNATURE_FAILED",
                                        "Unable to sign the recovery challenge with biometric authentication: "
                                                + safeErrorMessage(error)
                                );
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

                            /*
                             * IMPORTANT:
                             *
                             * We do not silently switch from a failed
                             * biometric attempt to device credential.
                             *
                             * Android's combined credential UI must be
                             * used separately because CryptoObject
                             * authentication only supports
                             * BIOMETRIC_STRONG.
                             *
                             * If the user cancels/fails this prompt,
                             * the frontend receives the actual error.
                             */

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

                            response.put(
                                    "method",
                                    "android-biometric-crypto"
                            );

                            call.resolve(
                                    response
                            );
                        }

                        @Override
                        public void onAuthenticationFailed() {

                            super.onAuthenticationFailed();

                            /*
                             * Do not resolve here.
                             */
                        }
                    };

            BiometricPrompt biometricPrompt =
                    new BiometricPrompt(
                            fragmentActivity,
                            executor,
                            cryptoCallback
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

            biometricPrompt.authenticate(
                    promptInfo,
                    cryptoObject
            );

        } catch (Exception error) {

            /*
             * If the CryptoObject cannot be initialized because
             * the device is not currently capable of performing
             * the biometric cryptographic operation, return the
             * diagnostic native error.
             *
             * The frontend can then offer the device-credential
             * recovery path.
             */

            JSObject response =
                    new JSObject();

            response.put(
                    "success",
                    false
            );

            response.put(
                    "code",
                    "CRYPTO_AUTHENTICATION_UNAVAILABLE"
            );

            response.put(
                    "message",
                    "Unable to start GEO-SHUA Android cryptographic authentication: "
                            + safeErrorMessage(error)
            );

            response.put(
                    "method",
                    "android-biometric-crypto"
            );

            call.resolve(
                    response
            );
        }
    }

    /*
     * =========================================================
     * SIGN CHALLENGE AFTER DEVICE CREDENTIAL
     * =========================================================
     *
     * This method is deliberately separate from signChallenge().
     *
     * It is used by the frontend when the user chooses:
     *
     * - PIN
     * - pattern
     * - password
     *
     * The user must first authenticate through the device
     * credential prompt.
     */

    @PluginMethod
    public void authenticateAndSignWithDeviceCredential(
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
                    "GEO-SHUA Android activity does not support device credential authentication."
            );

            return;
        }

        FragmentActivity fragmentActivity =
                (FragmentActivity) activity;

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
                                 * Authentication has now been
                                 * performed using device credential.
                                 *
                                 * Immediately perform the Keystore
                                 * signing operation while the short
                                 * authentication validity window is
                                 * active.
                                 */

                                KeyStore authenticatedKeyStore =
                                        KeyStore.getInstance(
                                                KEYSTORE_NAME
                                        );

                                authenticatedKeyStore.load(null);

                                PrivateKey privateKey =
                                        (PrivateKey)
                                                authenticatedKeyStore.getKey(
                                                        RECOVERY_KEY_ALIAS,
                                                        null
                                                );

                                if (privateKey == null) {

                                    resolveFailure(
                                            call,
                                            "PRIVATE_KEY_UNAVAILABLE",
                                            "GEO-SHUA Android recovery private key is unavailable after device authentication."
                                    );

                                    return;
                                }

                                Signature signature =
                                        Signature.getInstance(
                                                SIGNATURE_ALGORITHM
                                        );

                                signature.initSign(
                                        privateKey
                                );

                                signature.update(
                                        challenge.getBytes(
                                                StandardCharsets.UTF_8
                                        )
                                );

                                byte[] signedBytes =
                                        signature.sign();

                                PublicKey publicKey =
                                        authenticatedKeyStore
                                                .getCertificate(
                                                        RECOVERY_KEY_ALIAS
                                                )
                                                .getPublicKey();

                                JSObject response =
                                        new JSObject();

                                response.put(
                                        "success",
                                        true
                                );

                                response.put(
                                        "method",
                                        "android-device-credential"
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
                                        "Recovery challenge signed successfully with device credential authentication."
                                );

                                call.resolve(
                                        response
                                );

                            } catch (Exception error) {

                                resolveFailure(
                                        call,
                                        "DEVICE_CREDENTIAL_SIGNATURE_FAILED",
                                        "Device authentication succeeded, but Android Keystore could not sign the recovery challenge: "
                                                + safeErrorMessage(error)
                                );
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
                                    "method",
                                    "android-device-credential"
                            );

                            response.put(
                                    "message",
                                    errString.toString()
                            );

                            call.resolve(
                                    response
                            );
                        }

                        @Override
                        public void onAuthenticationFailed() {

                            super.onAuthenticationFailed();

                            /*
                             * Do not resolve.
                             *
                             * Android may allow another attempt.
                             */
                        }
                    };

            BiometricPrompt biometricPrompt =
                    new BiometricPrompt(
                            fragmentActivity,
                            executor,
                            callback
                    );

            /*
             * IMPORTANT:
             *
             * This prompt deliberately has NO CryptoObject.
             *
             * That is what allows Android to present:
             *
             * - PIN
             * - pattern
             * - password
             *
             * together with strong biometric authentication.
             */

            BiometricPrompt.PromptInfo promptInfo =
                    new BiometricPrompt.PromptInfo.Builder()
                            .setTitle(
                                    "Confirm PIN recovery"
                            )
                            .setSubtitle(
                                    "Use your fingerprint, face, PIN, pattern, or password"
                            )
                            .setAllowedAuthenticators(
                                    BiometricManager.Authenticators.BIOMETRIC_STRONG
                                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                            )
                            .build();

            biometricPrompt.authenticate(
                    promptInfo
            );

        } catch (Exception error) {

            call.reject(
                    "Unable to start GEO-SHUA device credential recovery: "
                            + safeErrorMessage(error)
            );
        }
    }

    /*
     * =========================================================
     * FAILURE RESPONSE
     * =========================================================
     */

    private void resolveFailure(
            PluginCall call,
            String code,
            String message
    ) {

        JSObject response =
                new JSObject();

        response.put(
                "success",
                false
        );

        response.put(
                "code",
                code
        );

        response.put(
                "message",
                message
        );

        call.resolve(
                response
        );
    }

    /*
     * =========================================================
     * BASE64
     * =========================================================
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