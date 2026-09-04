import { registerPlugin } from "@capacitor/core";

export type DeviceSecurityAvailability = {
  available: boolean;
  code: string;
};

export type DeviceSecurityResult = {
  success: boolean;
  method?: string;
  code?: string;
  errorCode?: number;
  message?: string;
};

export type RecoveryKeyResult = {
  success: boolean;
  created?: boolean;
  existing?: boolean;
  publicKey?: string;
  algorithm?: string;
  error?: string;
  message?: string;
};

export type RecoveryKeyExistsResult = {
  success: boolean;
  exists?: boolean;
  error?: string;
  message?: string;
};

export type RecoveryPublicKeyResult = {
  success: boolean;
  publicKey?: string;
  algorithm?: string;
  error?: string;
  message?: string;
};

export type SignChallengeResult = {
  success: boolean;
  signature?: string;
  publicKey?: string;
  algorithm?: string;
  method?: string;
  challenge?: string;
  error?: string;
  message?: string;
};

export interface DeviceSecurityPlugin {
  isAvailable(): Promise<DeviceSecurityAvailability>;

  authenticate(): Promise<DeviceSecurityResult>;

  createRecoveryKey(): Promise<RecoveryKeyResult>;

  hasRecoveryKey(): Promise<RecoveryKeyExistsResult>;

  getRecoveryPublicKey(): Promise<RecoveryPublicKeyResult>;

  /**
   * Strong biometric cryptographic recovery.
   *
   * Uses:
   * - fingerprint
   * - face
   *
   * The Android native implementation uses
   * BiometricPrompt + CryptoObject.
   */
  signChallenge(
    challenge: string,
  ): Promise<SignChallengeResult>;

  /**
   * Device-credential recovery.
   *
   * Uses:
   * - device PIN
   * - device pattern
   * - device password
   *
   * The native implementation first authenticates
   * the user with Android device security and then
   * signs the server challenge using the Android
   * Keystore recovery key.
   */
  authenticateAndSignWithDeviceCredential(
    challenge: string,
  ): Promise<SignChallengeResult>;
}

const DeviceSecurity =
  registerPlugin<DeviceSecurityPlugin>(
    "DeviceSecurity",
  );

export default DeviceSecurity;

/**
 * =========================================================
 * ANDROID DEVICE SECURITY AVAILABILITY
 * =========================================================
 */
export async function isAndroidDeviceSecurityAvailable(): Promise<boolean> {
  try {
    const result =
      await DeviceSecurity.isAvailable();

    console.log(
      "ANDROID DEVICE SECURITY AVAILABILITY RESULT:",
      JSON.stringify(result),
    );

    return result.available === true;
  } catch (error) {
    console.error(
      "ANDROID DEVICE SECURITY AVAILABILITY ERROR:",
      error,
    );

    return false;
  }
}

/**
 * =========================================================
 * NORMAL ANDROID DEVICE AUTHENTICATION
 * =========================================================
 *
 * Opens the native Android security prompt.
 *
 * Supports:
 *
 * - fingerprint
 * - face
 * - device PIN
 * - device pattern
 * - device password
 *
 * This is the normal Identity authentication flow.
 *
 * It does NOT produce server-verifiable cryptographic
 * proof.
 */
export async function authenticateWithAndroidDeviceSecurity(): Promise<DeviceSecurityResult> {
  try {
    const result =
      await DeviceSecurity.authenticate();

    console.log(
      "ANDROID DEVICE SECURITY RESULT:",
      JSON.stringify(result),
    );

    return result;
  } catch (error) {
    console.error(
      "ANDROID DEVICE SECURITY ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      success: false,
      code: "NATIVE_ERROR",
      message:
        message ||
        "Unable to authenticate with Android device security.",
    };
  }
}

/**
 * =========================================================
 * CREATE ANDROID RECOVERY KEY
 * =========================================================
 *
 * Creates the recovery key inside Android Keystore.
 *
 * The private key never leaves the Android device.
 */
export async function createAndroidRecoveryKey(): Promise<RecoveryKeyResult> {
  try {
    const result =
      await DeviceSecurity.createRecoveryKey();

    console.log(
      "ANDROID RECOVERY KEY CREATION RESULT:",
      JSON.stringify(result),
    );

    return result;
  } catch (error) {
    console.error(
      "ANDROID RECOVERY KEY CREATION ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      success: false,
      created: false,
      error:
        message ||
        "Unable to create Android recovery key.",
      message:
        message ||
        "Unable to create Android recovery key.",
    };
  }
}

/**
 * =========================================================
 * CHECK ANDROID RECOVERY KEY
 * =========================================================
 *
 * Checks whether the recovery key exists in
 * Android Keystore.
 */
export async function hasAndroidRecoveryKey(): Promise<RecoveryKeyExistsResult> {
  try {
    const result =
      await DeviceSecurity.hasRecoveryKey();

    console.log(
      "ANDROID RECOVERY KEY RESULT:",
      JSON.stringify(result),
    );

    return {
      success: true,
      exists: result.exists === true,
      message:
        result.message ||
        "Android recovery key check completed.",
    };
  } catch (error) {
    console.error(
      "ANDROID RECOVERY KEY CHECK ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "ANDROID RECOVERY KEY CHECK ERROR MESSAGE:",
      message,
    );

    return {
      success: false,
      exists: false,
      error:
        message ||
        "Unable to check Android recovery key.",
      message:
        message ||
        "Unable to check Android recovery key.",
    };
  }
}

/**
 * =========================================================
 * GET ANDROID RECOVERY PUBLIC KEY
 * =========================================================
 *
 * Gets only the public portion of the recovery key.
 *
 * The private key remains inside Android Keystore.
 */
export async function getAndroidRecoveryPublicKey(): Promise<RecoveryPublicKeyResult> {
  try {
    const result =
      await DeviceSecurity.getRecoveryPublicKey();

    console.log(
      "ANDROID RECOVERY PUBLIC KEY RESULT:",
      JSON.stringify({
        ...result,
        publicKey: result.publicKey
          ? "[PRESENT]"
          : undefined,
      }),
    );

    return result;
  } catch (error) {
    console.error(
      "ANDROID RECOVERY PUBLIC KEY ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      success: false,
      error:
        message ||
        "Unable to access Android recovery public key.",
      message:
        message ||
        "Unable to access Android recovery public key.",
    };
  }
}

/**
 * =========================================================
 * SIGN ANDROID RECOVERY CHALLENGE
 * =========================================================
 *
 * STRONG BIOMETRIC RECOVERY
 *
 * Signs a server-issued recovery challenge using
 * the private key stored inside Android Keystore.
 *
 * Authentication:
 *
 * - fingerprint
 * - face
 *
 * Native implementation:
 *
 * BiometricPrompt
 *       +
 * CryptoObject
 *       +
 * Android Keystore
 *
 * Returns an ECDSA signature that the server can
 * verify against the registered public key.
 */
export async function signAndroidRecoveryChallenge(
  challenge: string,
): Promise<SignChallengeResult> {

  if (
    !challenge ||
    challenge.trim().length === 0
  ) {
    return {
      success: false,
      error:
        "Recovery challenge is required.",
      message:
        "Recovery challenge is required.",
    };
  }

  if (challenge.length > 4096) {
    return {
      success: false,
      error:
        "Recovery challenge is too large.",
      message:
        "Recovery challenge is too large.",
    };
  }

  try {
    const result =
      await DeviceSecurity.signChallenge(
        challenge,
      );

    console.log(
      "ANDROID RECOVERY CHALLENGE SIGN RESULT:",
      JSON.stringify({
        ...result,
        signature: result.signature
          ? "[PRESENT]"
          : undefined,
        publicKey: result.publicKey
          ? "[PRESENT]"
          : undefined,
      }),
    );

    return result;
  } catch (error) {
    console.error(
      "ANDROID RECOVERY CHALLENGE SIGNING ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      success: false,
      error:
        message ||
        "Unable to sign Android recovery challenge.",
      message:
        message ||
        "Unable to sign Android recovery challenge.",
    };
  }
}

/**
 * =========================================================
 * ANDROID DEVICE-CREDENTIAL RECOVERY
 * =========================================================
 *
 * DEVICE-CREDENTIAL RECOVERY
 *
 * Supports:
 *
 * - device PIN
 * - device pattern
 * - device password
 *
 * This is intentionally a separate native method from
 * signAndroidRecoveryChallenge().
 *
 * Android does not allow DEVICE_CREDENTIAL to be combined
 * with the CryptoObject authentication flow used for the
 * strong biometric signature operation.
 *
 * Native flow:
 *
 * Android device credential
 *       ↓
 * Authentication succeeds
 *       ↓
 * Android Keystore
 *       ↓
 * ECDSA signature
 *       ↓
 * GEO-SHUA server
 *
 * The private key never leaves Android Keystore.
 */
export async function authenticateAndSignAndroidWithDeviceCredential(
  challenge: string,
): Promise<SignChallengeResult> {

  if (
    !challenge ||
    challenge.trim().length === 0
  ) {
    return {
      success: false,
      error:
        "Recovery challenge is required.",
      message:
        "Recovery challenge is required.",
    };
  }

  if (challenge.length > 4096) {
    return {
      success: false,
      error:
        "Recovery challenge is too large.",
      message:
        "Recovery challenge is too large.",
    };
  }

  try {
    const result =
      await DeviceSecurity.authenticateAndSignWithDeviceCredential(
        challenge,
      );

    console.log(
      "ANDROID DEVICE CREDENTIAL RECOVERY RESULT:",
      JSON.stringify({
        ...result,
        signature: result.signature
          ? "[PRESENT]"
          : undefined,
        publicKey: result.publicKey
          ? "[PRESENT]"
          : undefined,
      }),
    );

    return result;
  } catch (error) {
    console.error(
      "ANDROID DEVICE CREDENTIAL RECOVERY ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      success: false,
      error:
        message ||
        "Unable to sign Android recovery challenge with device credential.",
      message:
        message ||
        "Unable to sign Android recovery challenge with device credential.",
    };
  }
}
