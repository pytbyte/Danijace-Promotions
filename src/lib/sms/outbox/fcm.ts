import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import {
  getMessaging,
  type BatchResponse,
  type MulticastMessage,
} from "firebase-admin/messaging";

import {
  disableSmsDeviceToken,
  getActiveSmsDeviceTokens,
} from "@/lib/sms/outbox/devices";

/* =========================================================
   CONFIG
========================================================= */

const MAX_FCM_TOKENS_PER_BATCH = 500;

/* =========================================================
   FIREBASE ADMIN
========================================================= */

function getFirebaseApp() {
  const existingApp = getApps()[0];

  if (existingApp) {
    return existingApp;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim();

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL?.trim();

  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY
      ?.replace(/\\n/g, "\n")
      .trim();

  /*
   * Preferred Vercel/server configuration.
   */
  if (
    projectId &&
    clientEmail &&
    privateKey
  ) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  }

  /*
   * Fallback for environments using
   * Google Application Default Credentials.
   */
  return initializeApp({
    credential: applicationDefault(),
    ...(projectId
      ? { projectId }
      : {}),
  });
}

/* =========================================================
   TYPES
========================================================= */

export interface WakeSmsOutboxResult {
  attempted: number;
  successful: number;
  failed: number;
  invalidTokens: string[];
}

/* =========================================================
   SEND ONE FCM BATCH
========================================================= */

async function sendWakeBatch(
  tokens: string[],
): Promise<BatchResponse> {
  const app = getFirebaseApp();

  const message: MulticastMessage = {
    tokens,

    /*
     * Data-only message.
     *
     * The message does not contain:
     * - SMS recipient
     * - SMS body
     * - financial information
     *
     * It only wakes the Android worker so it can
     * securely claim the actual SMS from the server.
     */
    data: {
      event: "sms_outbox",
    },

    android: {
      priority: "high",
    },
  };

  return getMessaging(app)
    .sendEachForMulticast(message);
}

/* =========================================================
   WAKE SMS OUTBOX WORKERS
========================================================= */

/**
 * Sends an FCM wake-up signal to all enabled Android
 * SMS worker devices.
 *
 * FCM is only the wake-up mechanism.
 *
 * The actual SMS remains in MongoDB and is claimed
 * by SmsOutboxWorker after the device wakes.
 */
export async function wakeSmsOutboxWorkers(): Promise<
  WakeSmsOutboxResult
> {
  const tokens =
    await getActiveSmsDeviceTokens();

  if (tokens.length === 0) {
    return {
      attempted: 0,
      successful: 0,
      failed: 0,
      invalidTokens: [],
    };
  }

  let attempted = 0;
  let successful = 0;
  let failed = 0;

  const invalidTokens: string[] = [];

  /*
   * FCM multicast supports a maximum of 500
   * registration tokens per request.
   */
  for (
    let offset = 0;
    offset < tokens.length;
    offset += MAX_FCM_TOKENS_PER_BATCH
  ) {
    const batch =
      tokens.slice(
        offset,
        offset +
          MAX_FCM_TOKENS_PER_BATCH,
      );

    attempted += batch.length;

    const response =
      await sendWakeBatch(batch);

    successful +=
      response.successCount;

    failed +=
      response.failureCount;

    /*
     * Firebase responses correspond to the
     * supplied tokens by array position.
     */
    response.responses.forEach(
      (result, index) => {
        if (result.success) {
          return;
        }

        const errorCode =
          result.error?.code ?? "";

        /*
         * These tokens are no longer usable.
         */
        if (
          errorCode.includes(
            "registration-token-not-registered",
          ) ||
          errorCode.includes(
            "invalid-registration-token",
          )
        ) {
          invalidTokens.push(
            batch[index],
          );
        }
      },
    );
  }

  /*
   * Disable invalid tokens so future wake-ups
   * do not repeatedly attempt delivery.
   */
  for (const token of [
    ...new Set(invalidTokens),
  ]) {
    try {
      await disableSmsDeviceToken(
        token,
      );
    } catch (error) {
      /*
       * Token cleanup must never cause the
       * FCM operation itself to fail.
       */
      console.error(
        "[FCM] Failed to disable invalid token:",
        error,
      );
    }
  }

  return {
    attempted,
    successful,
    failed,
    invalidTokens: [
      ...new Set(invalidTokens),
    ],
  };
}