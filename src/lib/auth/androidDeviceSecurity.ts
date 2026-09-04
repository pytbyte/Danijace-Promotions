import { registerPlugin } from "@capacitor/core";

export type DeviceSecurityAvailability = {
  available: boolean;
  code: string;
  message?: string;
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
  code?: string;
  errorCode?: number;
  error?: string;
  message?: string;
};

/**
 * IMPORTANT
 *
 * Capacitor plugin methods receive an object.
 *
 * Native Java expects:
 *
 *     call.getString("challenge")
 *
 * Therefore JavaScript MUST call:
 *
 *     DeviceSecurity.signChallenge({ challenge })
 *
 * and:
 *
 *     DeviceSecurity.authenticateAndSignWithDeviceCredential({
 *       challenge,
 *     })
 *
 * NOT:
 *
 *     DeviceSecurity.signChallenge(challenge)
 *
 * and NOT:
 *
 *     DeviceSecurity.authenticateAndSignWithDeviceCredential(challenge)
 */
export interface DeviceSecurityPlugin {
  isAvailable(): Promise<DeviceSecurityAvailability>;

  authenticate(): Promise<DeviceSecurityResult>;

  createRecoveryKey(): Promise<RecoveryKeyResult>;

  hasRecoveryKey(): Promise<RecoveryKeyExistsResult>;

  getRecoveryPublicKey(): Promise<RecoveryPublicKeyResult>;

  signChallenge(
    options: {
      challenge: string;
    },
  ): Promise<SignChallengeResult>;

  authenticateAndSignWithDeviceCredential(
    options: {
      challenge: string;
    },
  ): Promise<SignChallengeResult>;
}

const DeviceSecurity =
  registerPlugin<DeviceSecurityPlugin>(
    "DeviceSecurity",
  );

export default DeviceSecurity;

/* =========================================================
   AVAILABILITY
========================================================= */

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

/* =========================================================
   NORMAL DEVICE AUTHENTICATION
========================================================= */

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

/* =========================================================
   CREATE RECOVERY KEY
========================================================= */

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

/* =========================================================
   CHECK RECOVERY KEY
========================================================= */

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

/* =========================================================
   GET RECOVERY PUBLIC KEY
========================================================= */

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

/* =========================================================
   STRONG BIOMETRIC CHALLENGE SIGNING
========================================================= */

export async function signAndroidRecoveryChallenge(
  challenge: string,
): Promise<SignChallengeResult> {
  const normalizedChallenge =
    typeof challenge === "string"
      ? challenge.trim()
      : "";

  if (!normalizedChallenge) {
    return {
      success: false,
      error:
        "Recovery challenge is required.",
      message:
        "Recovery challenge is required.",
    };
  }

  if (
    normalizedChallenge.length > 4096
  ) {
    return {
      success: false,
      error:
        "Recovery challenge is too large.",
      message:
        "Recovery challenge is too large.",
    };
  }

  try {
    /*
     * IMPORTANT:
     *
     * Capacitor requires an object here.
     *
     * Java receives:
     *
     * call.getString("challenge")
     */
    const result =
      await DeviceSecurity.signChallenge({
        challenge:
          normalizedChallenge,
      });

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

/* =========================================================
   DEVICE CREDENTIAL CHALLENGE SIGNING
========================================================= */

export async function authenticateAndSignAndroidWithDeviceCredential(
  challenge: string,
): Promise<SignChallengeResult> {
  const normalizedChallenge =
    typeof challenge === "string"
      ? challenge.trim()
      : "";

  if (!normalizedChallenge) {
    return {
      success: false,
      error:
        "Recovery challenge is required.",
      message:
        "Recovery challenge is required.",
    };
  }

  if (
    normalizedChallenge.length > 4096
  ) {
    return {
      success: false,
      error:
        "Recovery challenge is too large.",
      message:
        "Recovery challenge is too large.",
    };
  }

  try {
    console.log(
      "ANDROID DEVICE CREDENTIAL RECOVERY: sending challenge",
      {
        challengeLength:
          normalizedChallenge.length,
      },
    );

    /*
     * =====================================================
     * CRITICAL FIX
     * =====================================================
     *
     * DO NOT DO THIS:
     *
     * DeviceSecurity.authenticateAndSignWithDeviceCredential(
     *   normalizedChallenge
     * );
     *
     * Native Java expects:
     *
     * call.getString("challenge")
     *
     * Therefore we MUST send:
     *
     * { challenge: normalizedChallenge }
     */
    const result =
      await DeviceSecurity.authenticateAndSignWithDeviceCredential(
        {
          challenge:
            normalizedChallenge,
        },
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