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

export interface DeviceSecurityPlugin {
  isAvailable(): Promise<DeviceSecurityAvailability>;

  authenticate(): Promise<DeviceSecurityResult>;
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