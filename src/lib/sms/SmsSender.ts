import { Capacitor, registerPlugin } from "@capacitor/core";

/* =========================================================
   TYPES
========================================================= */

export interface SmsPermissionResult {
  granted: boolean;
}

export interface SmsPermissionsResult {
  sms: boolean;
  phone: boolean;
  granted: boolean;
}

export interface SmsSubscription {
  subscriptionId: number;
  simSlotIndex: number;
  carrierName?: string;
}

export interface SmsSubscriptionsResult {
  subscriptions: SmsSubscription[];
}

export interface SendSmsOptions {
  phone: string;
  message: string;
  subscriptionId?: number;
}

export interface SendSmsResult {
  success: boolean;
  accepted: boolean;
  multipart: boolean;
  parts: number;
  completedParts?: number;
}

export interface SmsSenderPlugin {
  /**
   * Request SEND_SMS permission.
   */
  requestPermission(): Promise<SmsPermissionResult>;

  /**
   * Check SEND_SMS permission without prompting.
   */
  checkPermission(): Promise<SmsPermissionResult>;

  /**
   * Request all SMS-related permissions exposed by
   * the native plugin.
   */
  requestPermissions?(): Promise<SmsPermissionsResult>;

  /**
   * Check all SMS-related permissions without prompting.
   */
  checkPermissions?(): Promise<SmsPermissionsResult>;

  /**
   * Send an SMS through the Android SIM.
   *
   * The native plugin waits for Android's send result
   * before resolving successfully.
   */
  send(
    options: SendSmsOptions,
  ): Promise<SendSmsResult>;

  /**
   * Return active SIM subscriptions.
   */
  getSubscriptions(): Promise<SmsSubscriptionsResult>;
}

/* =========================================================
   NATIVE PLUGIN
========================================================= */

const NativeSmsSender =
  registerPlugin<SmsSenderPlugin>(
    "SmsSender",
  );

/* =========================================================
   PLATFORM HELPERS
========================================================= */

function ensureAndroid(): void {
  if (
    !Capacitor.isNativePlatform() ||
    Capacitor.getPlatform() !== "android"
  ) {
    throw new Error(
      "SMS sending is only available on the Android GEO-SHUA app.",
    );
  }
}

/* =========================================================
   PUBLIC API
========================================================= */

export const SmsSender = {
  async requestPermission(): Promise<SmsPermissionResult> {
    ensureAndroid();

    return NativeSmsSender.requestPermission();
  },

  async checkPermission(): Promise<SmsPermissionResult> {
    ensureAndroid();

    return NativeSmsSender.checkPermission();
  },

  async requestPermissions(): Promise<SmsPermissionsResult> {
    ensureAndroid();

    if (
      !NativeSmsSender.requestPermissions
    ) {
      throw new Error(
        "The installed Android SMS plugin does not support requestPermissions().",
      );
    }

    return NativeSmsSender.requestPermissions();
  },

  async checkPermissions(): Promise<SmsPermissionsResult> {
    ensureAndroid();

    if (
      !NativeSmsSender.checkPermissions
    ) {
      throw new Error(
        "The installed Android SMS plugin does not support checkPermissions().",
      );
    }

    return NativeSmsSender.checkPermissions();
  },

  async getSubscriptions(): Promise<SmsSubscriptionsResult> {
    ensureAndroid();

    return NativeSmsSender.getSubscriptions();
  },

  async send(
    options: SendSmsOptions,
  ): Promise<SendSmsResult> {
    ensureAndroid();

    const phone =
      options.phone?.trim();

    const message =
      options.message?.trim();

    if (!phone) {
      throw new Error(
        "Recipient phone number is required.",
      );
    }

    if (!message) {
      throw new Error(
        "SMS message is required.",
      );
    }

    return NativeSmsSender.send({
      phone,
      message,
      ...(options.subscriptionId !== undefined
        ? {
            subscriptionId:
              options.subscriptionId,
          }
        : {}),
    });
  },
};

export default SmsSender;

