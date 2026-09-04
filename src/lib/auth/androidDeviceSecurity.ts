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
  publicKey?: string;
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

  signChallenge(
    challenge: string,
  ): Promise<SignChallengeResult>;
}

const DeviceSecurity =
  registerPlugin<DeviceSecurityPlugin>("DeviceSecurity");

export default DeviceSecurity;

/**
 * Check whether Android device security is available.
 */
export async function isAndroidDeviceSecurityAvailable(): Promise<boolean> {
  try {
    const result =
      await DeviceSecurity.isAvailable();

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
 * Open the native Android authentication prompt.
 */
export async function authenticateWithAndroidDeviceSecurity(): Promise<DeviceSecurityResult> {
  try {
    return await DeviceSecurity.authenticate();
  } catch (error) {
    console.error(
      "ANDROID DEVICE SECURITY ERROR:",
      error,
    );

    return {
      success: false,
      code: "NATIVE_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Unable to authenticate with Android device security.",
    };
  }
}

/**
 * Create the Android recovery key in Android Keystore.
 *
 * The private key never leaves the Android device.
 */
export async function createAndroidRecoveryKey(): Promise<RecoveryKeyResult> {
  try {
    return await DeviceSecurity.createRecoveryKey();
  } catch (error) {
    console.error(
      "ANDROID RECOVERY KEY CREATION ERROR:",
      error,
    );

    return {
      success: false,
      created: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create Android recovery key.",
    };
  }
}

/**
 * Check whether an Android recovery key already exists.
 */
export async function hasAndroidRecoveryKey(): Promise<RecoveryKeyExistsResult> {
  try {
    return await DeviceSecurity.hasRecoveryKey();
  } catch (error) {
    console.error(
      "ANDROID RECOVERY KEY CHECK ERROR:",
      error,
    );

    return {
      success: false,
      exists: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to check Android recovery key.",
    };
  }
}

/**
 * Get the public portion of the Android recovery key.
 *
 * The private key remains inside Android Keystore.
 */
export async function getAndroidRecoveryPublicKey(): Promise<RecoveryPublicKeyResult> {
  try {
    return await DeviceSecurity.getRecoveryPublicKey();
  } catch (error) {
    console.error(
      "ANDROID RECOVERY PUBLIC KEY ERROR:",
      error,
    );

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to access Android recovery public key.",
    };
  }
}

/**
 * Sign a server-issued recovery challenge using
 * the private recovery key stored in Android Keystore.
 */
export async function signAndroidRecoveryChallenge(
  challenge: string,
): Promise<SignChallengeResult> {
  if (!challenge || challenge.trim().length === 0) {
    return {
      success: false,
      error: "Recovery challenge is required.",
    };
  }

  try {
    return await DeviceSecurity.signChallenge(
      challenge,
    );
  } catch (error) {
    console.error(
      "ANDROID RECOVERY CHALLENGE SIGNING ERROR:",
      error,
    );

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to sign Android recovery challenge.",
    };
  }
}