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
import java.security.cert.Certificate;
import java.util.concurrent.Executor;

/**
 * GEO-SHUA Android Device Security Plugin
 *
 * Provides:
 *
 * 1. Android device-security availability
 * 2. Normal identity authentication
 * 3. Android Keystore recovery-key creation
 * 4. Recovery-key existence checking
 * 5. Recovery public-key retrieval
 * 6. Strong-biometric cryptographic challenge signing
 * 7. Device-credential challenge signing
 *
 * Security model:
 *
 * - Recovery private keys remain inside Android Keystore.
 * - Private keys are never returned to JavaScript.
 * - Only the public key and challenge signatures leave the device.
 * - Recovery keys use ECDSA / SHA-256.
 * - Recovery-key alias is versioned.
 *
 * IMPORTANT:
 *
 * BiometricPrompt + CryptoObject is deliberately restricted to
 * BIOMETRIC_STRONG.
 *
 * Device credential authentication uses a separate non-CryptoObject
 * BiometricPrompt followed immediately by an Android Keystore signing
 * operation while the authentication-validity window is active.
 */
@CapacitorPlugin(name = "DeviceSecurity")
public class DeviceSecurityPlugin extends Plugin {

    private static final String KEYSTORE_NAME =
            "AndroidKeyStore";

    /**
     * Versioned recovery-key alias.
     *
     * V2 is intentionally separate from any previous recovery key.
     */
    private static final String RECOVERY_KEY_ALIAS =
            "geoshua_device_recovery_key_v2";

    /**
     * Signature algorithm used by both Android and the server.
     *
     * Server equivalent:
     *
     * crypto.verify(
     *     "sha256",
     *     Buffer.from(challenge, "utf8"),
     *     publicKey,
     *     signature
     * )
     */
    private static final String SIGNATURE_ALGORITHM =
            "SHA256withECDSA";

    /**
     * Short authentication validity period for device-credential
     * recovery.
     *
     * After successful device authentication, the Keystore permits
     * the signing operation for this period.
     */
    private static final int DEVICE_AUTH_VALIDITY_SECONDS = 30;

    /**
     * Maximum challenge size accepted by the native layer.
     */
    private static final int MAX_CHALLENGE_LENGTH = 4096;

    /**
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

        try {

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

            response.put(
                    "available",
                    result ==
                            BiometricManager.BIOMETRIC_SUCCESS
            );

            response.put(
                    "code",
                    getAvailabilityCode(result)
            );

            response.put(
                    "message",
                    getAvailabilityMessage(result)
            );

            call.resolve(
                    response
            );

        } catch (Exception error) {

            call.reject(
                    "GEO-SHUA Android device-security availability check failed: "
                            + safeErrorMessage(error)
            );
        }
    }

    /**
     * =========================================================
     * NORMAL ANDROID IDENTITY AUTHENTICATION
     * =========================================================
     *
     * Supports:
     *
     * - strong biometric
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
                    getAvailabilityMessage(
                            availability
                    )
            );

            call.resolve(
                    response
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

                        call.resolve(
                                response
                        );
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

    /**
     * =========================================================
     * CREATE RECOVERY KEY
     * =========================================================
     *
     * Creates an EC key pair inside Android Keystore.
     *
     * Private key:
     *     NEVER leaves Android Keystore.
     *
     * Public key:
     *     DER SubjectPublicKeyInfo -> Base64.
     */
    @PluginMethod
    public void createRecoveryKey(
            PluginCall call
    ) {

        try {

            KeyStore keyStore =
                    getAndroidKeyStore();

            /*
             * Never silently replace an existing recovery key.
             */
            if (keyStore.containsAlias(
                    RECOVERY_KEY_ALIAS
            )) {

                PublicKey publicKey =
                        getRecoveryPublicKeyFromKeyStore(
                                keyStore
                        );

                if (publicKey == null) {

                    call.reject(
                            "GEO-SHUA recovery key alias exists, "
                                    + "but its public certificate could not be read. "
                                    + "Alias="
                                    + RECOVERY_KEY_ALIAS
                    );

                    return;
                }

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

                call.resolve(
                        response
                );

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
             * Permit:
             *
             * - strong biometric
             * - device credential
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
                 * Legacy Android Keystore API.
                 */
                builder.setUserAuthenticationValidityDurationSeconds(
                        DEVICE_AUTH_VALIDITY_SECONDS
                );
            }

            generator.initialize(
                    builder.build()
            );

            generator.generateKeyPair();

            /*
             * Reload Keystore after generation.
             */
            keyStore =
                    getAndroidKeyStore();

            PublicKey publicKey =
                    getRecoveryPublicKeyFromKeyStore(
                            keyStore
                    );

            if (publicKey == null) {

                call.reject(
                        "GEO-SHUA Android recovery key was generated, "
                                + "but its public key could not be retrieved. "
                                + "Alias="
                                + RECOVERY_KEY_ALIAS
                );

                return;
            }

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

            call.resolve(
                    response
            );

        } catch (Exception error) {

            call.reject(
                    "Unable to create GEO-SHUA Android recovery key: "
                            + error.getClass().getName()
                            + ": "
                            + safeErrorMessage(error)
            );
        }
    }

    /**
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
                    getAndroidKeyStore();

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

            response.put(
                    "alias",
                    RECOVERY_KEY_ALIAS
            );

            response.put(
                    "message",
                    exists
                            ? "GEO-SHUA Android recovery key exists."
                            : "GEO-SHUA Android recovery key does not exist."
            );

            call.resolve(
                    response
            );

        } catch (Exception error) {

            call.reject(
                    "Unable to check GEO-SHUA Android recovery key: "
                            + error.getClass().getName()
                            + ": "
                            + safeErrorMessage(error)
            );
        }
    }

    /**
     * =========================================================
     * GET RECOVERY PUBLIC KEY
     * =========================================================
     *
     * This method deliberately performs each Keystore operation
     * separately so native errors are diagnostic instead of being
     * collapsed into a generic "unable to access key" message.
     */
    @PluginMethod
    public void getRecoveryPublicKey(
            PluginCall call
    ) {

        try {

            KeyStore keyStore =
                    getAndroidKeyStore();

            boolean aliasExists =
                    keyStore.containsAlias(
                            RECOVERY_KEY_ALIAS
                    );

            if (!aliasExists) {

                call.reject(
                        "GEO-SHUA Android recovery public key unavailable: "
                                + "Keystore alias does not exist. "
                                + "Alias="
                                + RECOVERY_KEY_ALIAS
                );

                return;
            }

            Certificate certificate =
                    keyStore.getCertificate(
                            RECOVERY_KEY_ALIAS
                    );

            if (certificate == null) {

                call.reject(
                        "GEO-SHUA Android recovery public key unavailable: "
                                + "Keystore certificate is null. "
                                + "Alias="
                                + RECOVERY_KEY_ALIAS
                );

                return;
            }

            PublicKey publicKey =
                    certificate.getPublicKey();

            if (publicKey == null) {

                call.reject(
                        "GEO-SHUA Android recovery public key unavailable: "
                                + "Certificate returned a null public key. "
                                + "Alias="
                                + RECOVERY_KEY_ALIAS
                );

                return;
            }

            String keyAlgorithm =
                    publicKey.getAlgorithm();

            if (!"EC".equalsIgnoreCase(
                    keyAlgorithm
            )) {

                call.reject(
                        "GEO-SHUA Android recovery public key unavailable: "
                                + "Unexpected key algorithm="
                                + keyAlgorithm
                                + ". Expected EC."
                );

                return;
            }

            byte[] encodedPublicKey =
                    publicKey.getEncoded();

            if (encodedPublicKey == null ||
                    encodedPublicKey.length == 0) {

                call.reject(
                        "GEO-SHUA Android recovery public key unavailable: "
                                + "Public key DER encoding is empty."
                );

                return;
            }

            String base64PublicKey =
                    encodeBase64(
                            encodedPublicKey
                    );

            if (base64PublicKey.isEmpty()) {

                call.reject(
                        "GEO-SHUA Android recovery public key unavailable: "
                                + "Base64 encoding returned an empty value."
                );

                return;
            }

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
                    "keyAlgorithm",
                    keyAlgorithm
            );

            response.put(
                    "keyFormat",
                    "DER-SPKI"
            );

            response.put(
                    "publicKey",
                    base64PublicKey
            );

            response.put(
                    "message",
                    "GEO-SHUA Android recovery public key retrieved successfully."
            );

            call.resolve(
                    response
            );

        } catch (Exception error) {

            call.reject(
                    "GEO-SHUA Android recovery public key read failed: "
                            + error.getClass().getName()
                            + ": "
                            + safeErrorMessage(error)
            );
        }
    }

    /**
     * =========================================================
     * SIGN RECOVERY CHALLENGE — STRONG BIOMETRIC
     * =========================================================
     *
     * This path intentionally uses CryptoObject.
     *
     * CryptoObject authentication is restricted to
     * BIOMETRIC_STRONG.
     *
     * Device credential recovery is implemented separately in
     * authenticateAndSignWithDeviceCredential().
     */
    @PluginMethod
    public void signChallenge(
            PluginCall call
    ) {

        String challenge =
                call.getString(
                        "challenge"
                );

        if (!validateChallenge(
                call,
                challenge
        )) {

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
                    getAndroidKeyStore();

            if (!keyStore.containsAlias(
                    RECOVERY_KEY_ALIAS
            )) {

                call.reject(
                        "GEO-SHUA Android recovery key does not exist. "
                                + "Alias="
                                + RECOVERY_KEY_ALIAS
                );

                return;
            }

            PrivateKey privateKey =
                    getRecoveryPrivateKey(
                            keyStore
                    );

            if (privateKey == null) {

                call.reject(
                        "Unable to access GEO-SHUA Android recovery private key."
                );

                return;
            }

            /*
             * Prepare signature operation.
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

                                authenticatedSignature.update(
                                        challenge.getBytes(
                                                StandardCharsets.UTF_8
                                        )
                                );

                                byte[] signedBytes =
                                        authenticatedSignature.sign();

                                KeyStore authenticatedKeyStore =
                                        getAndroidKeyStore();

                                PublicKey publicKey =
                                        getRecoveryPublicKeyFromKeyStore(
                                                authenticatedKeyStore
                                        );

                                if (publicKey == null) {

                                    resolveFailure(
                                            call,
                                            "PUBLIC_KEY_UNAVAILABLE",
                                            "Recovery signature succeeded, but Android could not retrieve the recovery public key."
                                    );

                                    return;
                                }

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
                                                + error.getClass().getName()
                                                + ": "
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
                             * Do not resolve.
                             *
                             * Android can permit another biometric
                             * attempt.
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
             * CryptoObject authentication uses BIOMETRIC_STRONG.
             *
             * Do NOT add DEVICE_CREDENTIAL here.
             */
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
                            + error.getClass().getName()
                            + ": "
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

    /**
     * =========================================================
     * SIGN RECOVERY CHALLENGE — DEVICE CREDENTIAL
     * =========================================================
     *
     * Supports:
     *
     * - device PIN
     * - device pattern
     * - device password
     * - strong biometric
     *
     * This method intentionally does NOT use a CryptoObject.
     *
     * Android first authenticates the user through BiometricPrompt.
     * Immediately after successful authentication, the application
     * performs the Keystore signing operation.
     */
    @PluginMethod
    public void authenticateAndSignWithDeviceCredential(
            PluginCall call
    ) {

        String challenge =
                call.getString(
                        "challenge"
                );

        if (!validateChallenge(
                call,
                challenge
        )) {

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
                    getAndroidKeyStore();

            if (!keyStore.containsAlias(
                    RECOVERY_KEY_ALIAS
            )) {

                call.reject(
                        "GEO-SHUA Android recovery key does not exist. "
                                + "Alias="
                                + RECOVERY_KEY_ALIAS
                );

                return;
            }

            /*
             * Confirm that the private key can be located before
             * displaying the authentication prompt.
             */
            PrivateKey privateKey =
                    getRecoveryPrivateKey(
                            keyStore
                    );

            if (privateKey == null) {

                call.reject(
                        "Unable to access GEO-SHUA Android recovery private key before device authentication."
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
                                 * Reload Keystore immediately after
                                 * authentication.
                                 */
                                KeyStore authenticatedKeyStore =
                                        getAndroidKeyStore();

                                PrivateKey authenticatedPrivateKey =
                                        getRecoveryPrivateKey(
                                                authenticatedKeyStore
                                        );

                                if (authenticatedPrivateKey == null) {

                                    resolveFailure(
                                            call,
                                            "PRIVATE_KEY_UNAVAILABLE",
                                            "Android device authentication succeeded, but the GEO-SHUA recovery private key is unavailable."
                                    );

                                    return;
                                }

                                /*
                                 * Perform the signing operation immediately
                                 * while the authentication validity window
                                 * is active.
                                 */
                                Signature signature =
                                        Signature.getInstance(
                                                SIGNATURE_ALGORITHM
                                        );

                                signature.initSign(
                                        authenticatedPrivateKey
                                );

                                signature.update(
                                        challenge.getBytes(
                                                StandardCharsets.UTF_8
                                        )
                                );

                                byte[] signedBytes =
                                        signature.sign();

                                PublicKey publicKey =
                                        getRecoveryPublicKeyFromKeyStore(
                                                authenticatedKeyStore
                                        );

                                if (publicKey == null) {

                                    resolveFailure(
                                            call,
                                            "PUBLIC_KEY_UNAVAILABLE",
                                            "Device authentication succeeded and the challenge was signed, but the recovery public key could not be retrieved."
                                    );

                                    return;
                                }

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
                                        "Recovery challenge signed successfully with Android device authentication."
                                );

                                call.resolve(
                                        response
                                );

                            } catch (Exception error) {

                                resolveFailure(
                                        call,
                                        "DEVICE_CREDENTIAL_SIGNATURE_FAILED",
                                        "Android authentication succeeded, but the recovery challenge could not be signed: "
                                                + error.getClass().getName()
                                                + ": "
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
             * NO CryptoObject.
             *
             * This allows Android to provide:
             *
             * - fingerprint
             * - face
             * - PIN
             * - pattern
             * - password
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
                    "Unable to start GEO-SHUA Android device-credential recovery: "
                            + error.getClass().getName()
                            + ": "
                            + safeErrorMessage(error)
            );
        }
    }

    /**
     * =========================================================
     * ANDROID KEYSTORE
     * =========================================================
     */
    private KeyStore getAndroidKeyStore()
            throws Exception {

        KeyStore keyStore =
                KeyStore.getInstance(
                        KEYSTORE_NAME
                );

        keyStore.load(
                null
        );

        return keyStore;
    }

    /**
     * =========================================================
     * RECOVERY PRIVATE KEY
     * =========================================================
     */
    private PrivateKey getRecoveryPrivateKey(
            KeyStore keyStore
    ) throws Exception {

        if (!keyStore.containsAlias(
                RECOVERY_KEY_ALIAS
        )) {

            return null;
        }

        return (PrivateKey)
                keyStore.getKey(
                        RECOVERY_KEY_ALIAS,
                        null
                );
    }

    /**
     * =========================================================
     * RECOVERY PUBLIC KEY
     * =========================================================
     */
    private PublicKey getRecoveryPublicKeyFromKeyStore(
            KeyStore keyStore
    ) throws Exception {

        if (!keyStore.containsAlias(
                RECOVERY_KEY_ALIAS
        )) {

            return null;
        }

        Certificate certificate =
                keyStore.getCertificate(
                        RECOVERY_KEY_ALIAS
                );

        if (certificate == null) {

            return null;
        }

        return certificate.getPublicKey();
    }

    /**
     * =========================================================
     * CHALLENGE VALIDATION
     * =========================================================
     */
    private boolean validateChallenge(
            PluginCall call,
            String challenge
    ) {

        if (challenge == null ||
                challenge.trim().isEmpty()) {

            call.reject(
                    "A recovery challenge is required."
            );

            return false;
        }

        if (challenge.length() >
                MAX_CHALLENGE_LENGTH) {

            call.reject(
                    "Recovery challenge is too large."
            );

            return false;
        }

        return true;
    }

    /**
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

    /**
     * =========================================================
     * BASE64
     * =========================================================
     */
    private String encodeBase64(
            byte[] value
    ) {

        if (value == null ||
                value.length == 0) {

            return "";
        }

        return Base64.encodeToString(
                value,
                Base64.NO_WRAP
        );
    }

    /**
     * =========================================================
     * AVAILABILITY ERROR CODE
     * =========================================================
     */
    private String getAvailabilityCode(
            int result
    ) {

        switch (result) {

            case BiometricManager.BIOMETRIC_SUCCESS:

                return "AVAILABLE";

            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:

                return "NO_HARDWARE";

            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:

                return "HARDWARE_UNAVAILABLE";

            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:

                return "NONE_ENROLLED";

            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:

                return "SECURITY_UPDATE_REQUIRED";

            case BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED:

                return "UNSUPPORTED";

            default:

                return "UNAVAILABLE";
        }
    }

    /**
     * =========================================================
     * AVAILABILITY MESSAGE
     * =========================================================
     */
    private String getAvailabilityMessage(
            int result
    ) {

        switch (result) {

            case BiometricManager.BIOMETRIC_SUCCESS:

                return "Android device security is available.";

            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:

                return "This Android device has no supported biometric hardware.";

            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:

                return "Android biometric hardware is currently unavailable.";

            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:

                return "No supported biometric or device credential is enrolled.";

            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:

                return "Android requires a security update before device authentication can be used.";

            case BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED:

                return "This Android device does not support the requested authentication configuration.";

            default:

                return "Android device security is unavailable.";
        }
    }

    /**
     * =========================================================
     * AUTHENTICATION ERROR CODE
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

            case BiometricPrompt.ERROR_SECURITY_UPDATE_REQUIRED:

                return "SECURITY_UPDATE_REQUIRED";

            case BiometricPrompt.ERROR_UNABLE_TO_PROCESS:

                return "UNABLE_TO_PROCESS";

            case BiometricPrompt.ERROR_VENDOR:

                return "VENDOR_ERROR";

            default:

                return "AUTHENTICATION_ERROR";
        }
    }

    /**
     * =========================================================
     * SAFE ERROR MESSAGE
     * =========================================================
     */
    private String safeErrorMessage(
            Exception error
    ) {

        if (error == null) {

            return "Unknown Android security error.";
        }

        String message =
                error.getMessage();

        if (message == null ||
                message.trim().isEmpty()) {

            return "Unknown Android security error.";
        }

        return message;
    }
}