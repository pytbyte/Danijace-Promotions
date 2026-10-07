import {
  ObjectId,
  type Collection,
  type Filter,
} from "mongodb";

import clientPromise from "@/lib/mongodb/index";

import {
  wakeSmsOutboxWorkers,
} from "@/lib/sms/outbox/fcm";

import type {
  ClaimSmsInput,
  QueueSmsInput,
  ReportSmsResultInput,
  SmsClaim,
  SmsOutboxDocument,
} from "@/lib/sms/types";

/* =========================================================
   DATABASE
========================================================= */

const DB_NAME = "danijace-promotions";
const OUTBOX_COLLECTION = "smsOutbox";

/* =========================================================
   CONSTANTS
========================================================= */

/**
 * Lower number = higher priority.
 *
 * 10 = immediate financial notification
 * 20 = normal notification
 * 50 = reminder
 */
const DEFAULT_PRIORITY = 20;

/**
 * Legacy retry-attempt field.
 *
 * Retained for backwards compatibility.
 *
 * IMPORTANT:
 * This is NOT a terminal retry limit.
 *
 * Failed SMS messages remain retryable until they are sent.
 */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Default number of messages requested by an Android worker.
 */
const DEFAULT_CLAIM_LIMIT = 10;

/**
 * Maximum messages one worker may claim.
 */
const MAX_CLAIM_LIMIT = 50;

/**
 * A processing claim older than this is considered abandoned.
 */
const CLAIM_TIMEOUT_MS =
  5 * 60 * 1000;

/**
 * Maximum delay between failed-SMS retries.
 */
const MAX_RETRY_DELAY_MS =
  15 * 60 * 1000;

/* =========================================================
   COLLECTION
========================================================= */

async function getSmsOutboxCollection(): Promise<
  Collection<SmsOutboxDocument>
> {
  const client =
    await clientPromise;

  return client
    .db(DB_NAME)
    .collection<SmsOutboxDocument>(
      OUTBOX_COLLECTION,
    );
}

/* =========================================================
   VALIDATION
========================================================= */

function requireNonEmptyString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(
      `${field} is required.`,
    );
  }

  return value.trim();
}

/* =========================================================
   PRIORITY
========================================================= */

function normalizePriority(
  value: number | undefined,
): number {
  if (
    value === undefined
  ) {
    return DEFAULT_PRIORITY;
  }

  if (
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(
      "SMS priority must be a non-negative integer.",
    );
  }

  return value;
}

/* =========================================================
   MAX ATTEMPTS
========================================================= */

/**
 * Retained for backwards compatibility.
 *
 * This field is informational only.
 *
 * It does NOT prevent retrying an SMS.
 */
function normalizeMaxAttempts(
  value: number | undefined,
): number {
  if (
    value === undefined
  ) {
    return DEFAULT_MAX_ATTEMPTS;
  }

  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      "SMS maxAttempts must be a positive integer.",
    );
  }

  return value;
}

/* =========================================================
   CLAIM LIMIT
========================================================= */

function normalizeLimit(
  value: number | undefined,
): number {
  if (
    value === undefined
  ) {
    return DEFAULT_CLAIM_LIMIT;
  }

  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      "SMS claim limit must be a positive integer.",
    );
  }

  return Math.min(
    value,
    MAX_CLAIM_LIMIT,
  );
}

/* =========================================================
   OBJECT ID
========================================================= */

function toObjectId(
  value: string,
  field: string,
): ObjectId {
  if (
    !ObjectId.isValid(value)
  ) {
    throw new Error(
      `Invalid ${field}.`,
    );
  }

  return new ObjectId(value);
}

/* =========================================================
   CALENDAR DATE
========================================================= */

/**
 * Keeps DANIJACE PROMOTIONS calendar dates as exact YYYY-MM-DD
 * strings instead of converting them through JavaScript
 * Date objects.
 */
function normalizeCalendarDate(
  value: string | undefined,
): string | undefined {
  if (
    value === undefined
  ) {
    return undefined;
  }

  const date =
    value.trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date,
    )
  ) {
    throw new Error(
      "scheduledFor must use YYYY-MM-DD format.",
    );
  }

  const [
    yearText,
    monthText,
    dayText,
  ] =
    date.split("-");

  const year =
    Number(yearText);

  const month =
    Number(monthText);

  const day =
    Number(dayText);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(
      "scheduledFor is not a valid calendar date.",
    );
  }

  if (
    month < 1 ||
    month > 12
  ) {
    throw new Error(
      "scheduledFor contains an invalid month.",
    );
  }

  const daysInMonth =
    new Date(
      year,
      month,
      0,
    ).getDate();

  if (
    day < 1 ||
    day > daysInMonth
  ) {
    throw new Error(
      "scheduledFor contains an invalid day.",
    );
  }

  return date;
}

/* =========================================================
   FCM WAKE
========================================================= */

/**
 * FCM is ONLY an acceleration mechanism.
 *
 * It must never be part of the critical financial path.
 *
 * The queue is already safely stored in MongoDB before this
 * function is triggered.
 */
async function wakeSmsWorkers(): Promise<void> {
  try {
    await wakeSmsOutboxWorkers();
  } catch (error) {
    console.error(
      "[SMS OUTBOX] Failed to wake Android workers:",
      error,
    );
  }
}

/**
 * Fire-and-forget FCM wake.
 *
 * queueSms() intentionally does NOT await this.
 */
function wakeSmsWorkersAsync(): void {
  void wakeSmsWorkers();
}

/* =========================================================
   SMS DOCUMENT → CLAIM
========================================================= */

function toSmsClaim(
  document: SmsOutboxDocument,
): SmsClaim {
  if (
    !document._id
  ) {
    throw new Error(
      "SMS queue item has no identifier.",
    );
  }

  return {
    id:
      document._id.toString(),

    type:
      document.type,

    ...(document.memberId
      ? {
          memberId:
            document.memberId.toString(),
        }
      : {}),

    ...(document.loanId
      ? {
          loanId:
            document.loanId.toString(),
        }
      : {}),

    recipient:
      document.recipient,

    message:
      document.message,

    ...(document.scheduledFor
      ? {
          scheduledFor:
            document.scheduledFor,
        }
      : {}),

    attempts:
      document.attempts,
  };
}

/* =========================================================
   QUEUE SMS
========================================================= */

/**
 * Adds an SMS to the outgoing queue.
 *
 * MongoDB becomes authoritative first.
 *
 * FCM is then triggered asynchronously and NEVER delays
 * the caller.
 */
export async function queueSms(
  data: QueueSmsInput,
): Promise<string> {
  const recipient =
    requireNonEmptyString(
      data.recipient,
      "recipient",
    );

  const message =
    requireNonEmptyString(
      data.message,
      "message",
    );

  const idempotencyKey =
    requireNonEmptyString(
      data.idempotencyKey,
      "idempotencyKey",
    );

  const priority =
    normalizePriority(
      data.priority,
    );

  const maxAttempts =
    normalizeMaxAttempts(
      data.maxAttempts,
    );

  const scheduledFor =
    normalizeCalendarDate(
      data.scheduledFor,
    );

  const memberId =
    data.memberId
      ? toObjectId(
          data.memberId,
          "memberId",
        )
      : undefined;

  const loanId =
    data.loanId
      ? toObjectId(
          data.loanId,
          "loanId",
        )
      : undefined;

  const now =
    new Date();

  const availableAt =
    data.availableAt
      ? new Date(
          data.availableAt,
        )
      : now;

  if (
    Number.isNaN(
      availableAt.getTime(),
    )
  ) {
    throw new Error(
      "Invalid SMS availableAt.",
    );
  }

  const smsOutbox =
    await getSmsOutboxCollection();

  /* -------------------------------------------------------
     IDEMPOTENCY LOOKUP
  ------------------------------------------------------- */

  const existing =
    await smsOutbox.findOne(
      {
        idempotencyKey,
      },
      {
        projection: {
          _id: 1,
          status: 1,
        },
      },
    );

  if (
    existing?._id
  ) {
    /*
     * If the SMS is still pending, wake the worker again.
     *
     * IMPORTANT:
     * Do NOT await the FCM operation.
     */
    if (
      existing.status ===
      "pending"
    ) {
      wakeSmsWorkersAsync();
    }

    return existing._id.toString();
  }

  /* -------------------------------------------------------
     CREATE DOCUMENT
  ------------------------------------------------------- */

  const document:
    SmsOutboxDocument =
    {
      type:
        data.type,

      ...(memberId
        ? {
            memberId,
          }
        : {}),

      ...(loanId
        ? {
            loanId,
          }
        : {}),

      recipient,

      message,

      status:
        "pending",

      priority,

      ...(scheduledFor
        ? {
            scheduledFor,
          }
        : {}),

      availableAt,

      attempts:
        0,

      maxAttempts,

      idempotencyKey,

      createdAt:
        now,

      updatedAt:
        now,
    };

  try {
    const result =
      await smsOutbox.insertOne(
        document,
      );

    /*
     * MongoDB is now authoritative.
     *
     * Wake Android without delaying the caller.
     */
    wakeSmsWorkersAsync();

    return result.insertedId.toString();
  } catch (error) {
    /*
     * Concurrent requests may both pass the initial
     * idempotency lookup.
     *
     * The unique MongoDB index remains the final protection.
     */
    if (
      error instanceof Error &&
      (
        error.message.includes(
          "E11000",
        ) ||
        error.message
          .toLowerCase()
          .includes(
            "duplicate",
          )
      )
    ) {
      const duplicate =
        await smsOutbox.findOne(
          {
            idempotencyKey,
          },
          {
            projection: {
              _id: 1,
              status: 1,
            },
          },
        );

      if (
        duplicate?._id
      ) {
        if (
          duplicate.status ===
          "pending"
        ) {
          wakeSmsWorkersAsync();
        }

        return duplicate._id.toString();
      }
    }

    throw error;
  }
}

/* =========================================================
   CLAIM FILTER
========================================================= */

/**
 * Builds the atomic claim filter.
 *
 * A worker may claim:
 *
 * 1. A pending message whose availableAt has arrived.
 *
 * 2. A processing message whose previous claim has expired.
 *
 * There is intentionally NO attempts/maxAttempts restriction.
 */
function buildClaimFilter(
  now: Date,
): Filter<SmsOutboxDocument> {
  const staleBefore = new Date(
    now.getTime() - CLAIM_TIMEOUT_MS,
  );

  const pendingFilter: Filter<SmsOutboxDocument> = {
    status: "pending",
    availableAt: {
      $lte: now,
    },
  };

  const staleProcessingFilter: Filter<SmsOutboxDocument> = {
    status: "processing",
    claimedAt: {
      $lt: staleBefore,
    },
  };

  return {
    $or: [
      pendingFilter,
      staleProcessingFilter,
    ],
  };
}

/* =========================================================
   CLAIM ONE SMS
========================================================= */

/**
 * Atomically claims one SMS for an Android device.
 *
 * IMPORTANT:
 *
 * There is NO preliminary stale-recovery updateMany().
 *
 * Stale processing messages are simply included in the
 * atomic claim filter.
 *
 * That removes an entire MongoDB round trip from the
 * hot path.
 */
export async function claimSms(
  data: ClaimSmsInput,
): Promise<SmsClaim | null> {
  const deviceId =
    requireNonEmptyString(
      data.deviceId,
      "deviceId",
    );

  const now =
    new Date();

  const smsOutbox =
    await getSmsOutboxCollection();

  const result =
    await smsOutbox.findOneAndUpdate(
      buildClaimFilter(now),
      {
        $set: {
          status:
            "processing",

          claimedBy:
            deviceId,

          claimedAt:
            now,

          updatedAt:
            now,
        },

        $inc: {
          attempts:
            1,
        },
      },
      {
        sort: {
          priority:
            1,

          availableAt:
            1,

          createdAt:
            1,
        },

        returnDocument:
          "after",
      },
    );

  if (
    !result
  ) {
    return null;
  }

  return toSmsClaim(
    result,
  );
}

/* =========================================================
   CLAIM BATCH
========================================================= */

/**
 * Claims multiple SMS messages for one Android worker.
 *
 * Each claim remains an atomic MongoDB operation.
 *
 * We intentionally claim sequentially so priority ordering is
 * preserved:
 *
 *   priority 10
 *   priority 10
 *   priority 20
 *   priority 50
 *
 * The old implementation unnecessarily executed stale
 * recovery before EVERY claim. That has been removed.
 */
export async function claimSmsBatch(
  data: ClaimSmsInput,
): Promise<SmsClaim[]> {
  const deviceId =
    requireNonEmptyString(
      data.deviceId,
      "deviceId",
    );

  const limit =
    normalizeLimit(
      data.limit,
    );

  const smsOutbox =
    await getSmsOutboxCollection();

  const claims:
    SmsClaim[] =
    [];

  /*
   * Use the same collection directly rather than calling
   * claimSms(), which would repeatedly reacquire the
   * collection and rebuild the entire operation.
   */
  for (
    let index = 0;
    index < limit;
    index += 1
  ) {
    const now =
      new Date();

    const result =
      await smsOutbox.findOneAndUpdate(
        buildClaimFilter(now),
        {
          $set: {
            status:
              "processing",

            claimedBy:
              deviceId,

            claimedAt:
              now,

            updatedAt:
              now,
          },

          $inc: {
            attempts:
              1,
          },
        },
        {
          sort: {
            priority:
              1,

            availableAt:
              1,

            createdAt:
              1,
          },

          returnDocument:
            "after",
        },
      );

    if (
      !result
    ) {
      break;
    }

    claims.push(
      toSmsClaim(
        result,
      ),
    );
  }

  return claims;
}

/* =========================================================
   REPORT SMS RESULT
========================================================= */

/**
 * Reports the result from Android.
 *
 * "sent" means Android accepted the SMS for transmission.
 *
 * It does NOT mean that the recipient handset received it.
 *
 * Normal successful path:
 *
 *     ONE MongoDB update
 *
 * Normal failed path:
 *
 *     ONE MongoDB update
 *
 * The old implementation performed an initial findOne()
 * before every result update. That extra read has been removed
 * from the normal path.
 */
export async function reportSmsResult(
  data: ReportSmsResultInput,
): Promise<void> {
  const deviceId =
    requireNonEmptyString(
      data.deviceId,
      "deviceId",
    );

  const smsId =
    requireNonEmptyString(
      data.smsId,
      "smsId",
    );

  const smsObjectId =
    toObjectId(
      smsId,
      "smsId",
    );

  const smsOutbox =
    await getSmsOutboxCollection();

  const now =
    new Date();

  /* =======================================================
     SENT
  ======================================================= */

  if (
    data.status ===
    "sent"
  ) {
    const setFields:
      Record<
        string,
        unknown
      > = {
      status:
        "sent",

      sentAt:
        now,

      updatedAt:
        now,
    };

    const providerMessageId =
      data.providerMessageId?.trim();

    if (
      providerMessageId
    ) {
      setFields.providerMessageId =
        providerMessageId;
    }

    /*
     * Two valid cases:
     *
     * 1. The current device still owns the processing claim.
     *
     * 2. The SMS is already sent.
     *
     * The second case makes duplicate "sent" callbacks
     * idempotent.
     */
    const result =
      await smsOutbox.updateOne(
        {
          _id:
            smsObjectId,

          $or: [
            {
              status:
                "processing",

              claimedBy:
                deviceId,
            },

            {
              status:
                "sent",
            },
          ],
        },
        {
          $set:
            setFields,

          $unset: {
            claimedBy:
              "",

            claimedAt:
              "",

            failureReason:
              "",
          },
        },
      );

    if (
      result.matchedCount >
      0
    ) {
      return;
    }

    /*
     * Only the exceptional path performs another read.
     *
     * This is reached when:
     *
     * - the SMS does not exist;
     * - another device owns the claim;
     * - the claim expired;
     * - the SMS was cancelled;
     * - or another state transition occurred.
     */
    const current =
      await smsOutbox.findOne(
        {
          _id:
            smsObjectId,
        },
        {
          projection: {
            _id: 1,
            status: 1,
            claimedBy: 1,
          },
        },
      );

    if (
      !current
    ) {
      throw new Error(
        "SMS queue item not found.",
      );
    }

    if (
      current.status ===
      "sent"
    ) {
      return;
    }

    if (
      current.claimedBy &&
      current.claimedBy !==
        deviceId
    ) {
      throw new Error(
        "SMS queue item is claimed by another device.",
      );
    }

    throw new Error(
      `SMS cannot be completed from status "${current.status}".`,
    );
  }

  /* =======================================================
     FAILED
  ======================================================= */

  if (
    data.status !==
    "failed"
  ) {
    throw new Error(
      'SMS result status must be either "sent" or "failed".',
    );
  }

  /*
   * Attempts are diagnostic only.
   *
   * There is intentionally NO maxAttempts terminal state.
   */
  const currentAttempts =
    1;

  /*
   * We use the attempt number already represented by the
   * current claim where possible through the update itself.
   *
   * For retry scheduling, the first failed claim gets roughly
   * one minute, then the delay doubles until fifteen minutes.
   *
   * Because attempts are incremented during claim, the
   * exponential delay is based on the persisted attempt count.
   *
   * We don't need a preliminary findOne() on the normal path.
   * The retry delay is calculated from the current failure
   * using a conservative first-delay value.
   *
   * The worker's immediate retry path remains fast for the
   * initial failure while repeated failures progressively
   * back off.
   */

  /*
   * We need the existing attempt number to calculate the
   * exact exponential delay. Rather than adding a read,
   * calculate the next delay from the known claim sequence
   * stored by MongoDB using an update pipeline.
   *
   * MongoDB will calculate:
   *
   *   min(60s * 2^(attempts - 1), 15m)
   */
  const result =
    await smsOutbox.updateOne(
      {
        _id:
          smsObjectId,

        status:
          "processing",

        claimedBy:
          deviceId,
      },
      [
        {
          $set: {
            status:
              "pending",

            availableAt: {
              $let: {
                vars: {
                  retryExponent: {
                    $max: [
                      {
                        $subtract: [
                          "$attempts",
                          1,
                        ],
                      },

                      0,
                    ],
                  },
                },

                in: {
                  $add: [
                    now,
                    {
                      $min: [
                        MAX_RETRY_DELAY_MS,

                        {
                          $multiply: [
                            60_000,

                            {
                              $pow: [
                                2,
                                "$$retryExponent",
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },

            failureReason:
              data.error?.trim() ||
              "SMS sending failed; retry scheduled.",

            updatedAt:
              now,
          },
        },

        {
          $unset: [
            "claimedBy",
            "claimedAt",
          ],
        },
      ],
    );

  if (
    result.matchedCount >
    0
  ) {
    /*
     * Wake the worker again.

     * This is deliberately fire-and-forget.
     *
     * availableAt still controls when the SMS may actually
     * be claimed again.
     */
    wakeSmsWorkersAsync();

    return;
  }

  /*
   * Exceptional path only.
   */
  const current =
    await smsOutbox.findOne(
      {
        _id:
          smsObjectId,
      },
      {
        projection: {
          _id: 1,
          status: 1,
          claimedBy: 1,
        },
      },
    );

  if (
    !current
  ) {
    throw new Error(
      "SMS queue item not found.",
    );
  }

  if (
    current.status ===
    "sent"
  ) {
    return;
  }

  if (
    current.claimedBy &&
    current.claimedBy !==
      deviceId
  ) {
    throw new Error(
      "SMS queue item is claimed by another device.",
    );
  }

  throw new Error(
    `SMS cannot be failed from status "${current.status}".`,
  );
}

/* =========================================================
   RECOVER STALE CLAIMS
========================================================= */

/**
 * Explicit maintenance operation.
 *
 * Normally claimSms()/claimSmsBatch() do not need this
 * function because stale processing messages are directly
 * eligible for atomic reclamation.
 *
 * This function remains useful for maintenance/diagnostics.
 */
export async function recoverStaleSms(): Promise<number> {
  const smsOutbox =
    await getSmsOutboxCollection();

  const now =
    new Date();

  const staleBefore =
    new Date(
      now.getTime() -
        CLAIM_TIMEOUT_MS,
    );

  const result =
    await smsOutbox.updateMany(
      {
        status:
          "processing",

        claimedAt: {
          $lt:
            staleBefore,
        },
      },
      {
        $set: {
          status:
            "pending",

          availableAt:
            now,

          updatedAt:
            now,

          failureReason:
            "Previous SMS worker claim expired; retry scheduled.",
        },

        $unset: {
          claimedBy:
            "",

          claimedAt:
            "",
        },
      },
    );

  return result.modifiedCount;
}

/* =========================================================
   CANCEL
========================================================= */

/**
 * Cancels a pending SMS.
 *
 * Processing and sent messages cannot be cancelled because
 * Android may already have accepted them for transmission.
 */
export async function cancelSms(
  smsId: string,
): Promise<void> {
  const objectId =
    toObjectId(
      smsId,
      "smsId",
    );

  const smsOutbox =
    await getSmsOutboxCollection();

  const result =
    await smsOutbox.updateOne(
      {
        _id:
          objectId,

        status:
          "pending",
      },
      {
        $set: {
          status:
            "cancelled",

          updatedAt:
            new Date(),
        },
      },
    );

  if (
    result.matchedCount >
    0
  ) {
    return;
  }

  const existing =
    await smsOutbox.findOne(
      {
        _id:
          objectId,
      },
      {
        projection: {
          _id: 1,
          status: 1,
        },
      },
    );

  if (
    !existing
  ) {
    throw new Error(
      "SMS queue item not found.",
    );
  }

  if (
    existing.status ===
    "cancelled"
  ) {
    return;
  }

  throw new Error(
    `SMS cannot be cancelled from status "${existing.status}".`,
  );
}

/* =========================================================
   GET SMS
========================================================= */

export async function getSmsById(
  smsId: string,
): Promise<SmsOutboxDocument | null> {
  const objectId =
    toObjectId(
      smsId,
      "smsId",
    );

  const smsOutbox =
    await getSmsOutboxCollection();

  return smsOutbox.findOne({
    _id:
      objectId,
  });
}