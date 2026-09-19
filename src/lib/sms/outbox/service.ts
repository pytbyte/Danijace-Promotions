
import {
  ObjectId,
  type Collection,
} from "mongodb";

import clientPromise from "@/lib/mongodb/index";

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

const DB_NAME = "geo-shua";
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
 * Maximum number of Android sending attempts.
 */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Default number of messages requested by an Android worker.
 */
const DEFAULT_CLAIM_LIMIT = 10;

/**
 * Maximum messages one worker may claim in one request.
 */
const MAX_CLAIM_LIMIT = 50;

/**
 * A processing SMS older than this is considered abandoned.
 *
 * This protects the queue when Android crashes, loses network,
 * or the application is killed after claiming an SMS.
 */
const CLAIM_TIMEOUT_MS =
  5 * 60 * 1000;

/* =========================================================
   COLLECTION
========================================================= */

async function getSmsOutboxCollection(): Promise<
  Collection<SmsOutboxDocument>
> {
  const client =
    await clientPromise;

  const database =
    client.db(DB_NAME);

  return database.collection<SmsOutboxDocument>(
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

/* ---------------------------------------------------------
   PRIORITY
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   MAX ATTEMPTS
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   CLAIM LIMIT
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   OBJECT ID
--------------------------------------------------------- */

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

/* ---------------------------------------------------------
   CALENDAR DATE
--------------------------------------------------------- */

/**
 * Validates a GEO-SHUA calendar date without converting it
 * through JavaScript Date.
 *
 * Financial calendar dates remain exact YYYY-MM-DD strings.
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
   QUEUE SMS
========================================================= */

/**
 * Adds an SMS to the outgoing queue.
 *
 * Financial services remain authoritative.
 *
 * The financial operation should commit first, then this
 * function should be called to create the communication task.
 *
 * Idempotency examples:
 *
 * savings_deposit:<transactionId>
 * loan_payment_received:<repaymentId>
 * loan_disbursement:<loanId>
 * loan_payment_reminder:<loanId>:<period>
 * loan_cleared:<loanId>
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

  /*
   * Fast idempotency lookup.
   *
   * The unique MongoDB index remains the final protection
   * against concurrent duplicate inserts.
   */
  const existing =
    await smsOutbox.findOne({
      idempotencyKey,
    });

  if (
    existing?._id
  ) {
    return existing._id.toString();
  }

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

    return result.insertedId.toString();
  } catch (error) {
    /*
     * Two requests can pass the initial findOne() at the same
     * time. The unique idempotencyKey index prevents duplicates.
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
        await smsOutbox.findOne({
          idempotencyKey,
        });

      if (
        duplicate?._id
      ) {
        return duplicate._id.toString();
      }
    }

    throw error;
  }
}

/* =========================================================
   CLAIM ONE SMS
========================================================= */

/**
 * Atomically claims one SMS for an Android device.
 *
 * Multiple Android devices may call this concurrently.
 *
 * MongoDB's findOneAndUpdate() makes the claim atomic.
 */
export async function claimSms(
  data: ClaimSmsInput,
): Promise<SmsClaim | null> {
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

  /*
   * claimSms() normally claims one message.
   *
   * The limit remains in the public contract for compatibility
   * and future use.
   */
  for (
    let index = 0;
    index < limit;
    index += 1
  ) {
    const now =
      new Date();

    const staleBefore =
      new Date(
        now.getTime() -
          CLAIM_TIMEOUT_MS,
      );

    /*
     * attempts < maxAttempts compares two fields from the
     * same MongoDB document, therefore $expr is required.
     */
    const result =
      await smsOutbox.findOneAndUpdate(
        {
          $or: [
            {
              status:
                "pending",

              availableAt: {
                $lte: now,
              },

              $expr: {
                $lt: [
                  "$attempts",
                  "$maxAttempts",
                ],
              },
            },

            {
              status:
                "processing",

              claimedAt: {
                $lt: staleBefore,
              },

              $expr: {
                $lt: [
                  "$attempts",
                  "$maxAttempts",
                ],
              },
            },
          ],
        },
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

    const document =
      result;

    if (
      !document ||
      !document._id
    ) {
      return null;
    }

    /*
     * Defensive protection.
     */
    if (
      document.attempts >
      document.maxAttempts
    ) {
      await smsOutbox.updateOne(
        {
          _id:
            document._id,
        },
        {
          $set: {
            status:
              "failed",

            failureReason:
              "Maximum SMS attempts exceeded.",

            failedAt:
              new Date(),

            updatedAt:
              new Date(),
          },

          $unset: {
            claimedBy:
              "",

            claimedAt:
              "",
          },
        },
      );

      continue;
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

  return null;
}

/* =========================================================
   CLAIM BATCH
========================================================= */

/**
 * Claims multiple SMS messages for an Android worker.
 *
 * Each individual claim remains atomic.
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

  const claims:
    SmsClaim[] =
    [];

  for (
    let index = 0;
    index < limit;
    index += 1
  ) {
    const claim =
      await claimSms({
        deviceId,

        limit:
          1,
      });

    if (!claim) {
      break;
    }

    claims.push(
      claim,
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
 * "sent" means Android accepted the SMS for sending.
 *
 * It does NOT mean that the recipient handset received it.
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

  const existing =
    await smsOutbox.findOne({
      _id:
        smsObjectId,
    });

  if (!existing) {
    throw new Error(
      "SMS queue item not found.",
    );
  }

  /*
   * Never allow another Android device to complete a claim
   * belonging to this device.
   */
  if (
    existing.claimedBy &&
    existing.claimedBy !==
      deviceId
  ) {
    throw new Error(
      "SMS queue item is claimed by another device.",
    );
  }

  /*
   * Idempotent success reporting.
   */
  if (
    existing.status ===
      "sent" &&
    data.status ===
      "sent"
  ) {
    return;
  }

  if (
    existing.status !==
    "processing"
  ) {
    throw new Error(
      `SMS cannot be completed from status "${existing.status}".`,
    );
  }

  const now =
    new Date();

  /* -------------------------------------------------------
     SUCCESS
  ------------------------------------------------------- */

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

    if (
      data.providerMessageId?.trim()
    ) {
      setFields.providerMessageId =
        data.providerMessageId.trim();
    }

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

    /*
     * If another process completed it between the initial
     * read and this update, do not report a false failure.
     */
    if (
      result.matchedCount ===
        0
    ) {
      const current =
        await smsOutbox.findOne({
          _id:
            smsObjectId,
        });

      if (
        current?.status ===
        "sent"
      ) {
        return;
      }

      throw new Error(
        "SMS claim is no longer owned by this device.",
      );
    }

    return;
  }

  /* -------------------------------------------------------
     FAILURE
  ------------------------------------------------------- */

  const attempts =
    existing.attempts;

  const exhausted =
    attempts >=
    existing.maxAttempts;

  /*
   * No attempts remain.
   */
  if (exhausted) {
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
        {
          $set: {
            status:
              "failed",

            failedAt:
              now,

            failureReason:
              data.error?.trim() ||
              "SMS sending failed.",

            updatedAt:
              now,
          },

          $unset: {
            claimedBy:
              "",

            claimedAt:
              "",
          },
        },
      );

    if (
      result.matchedCount ===
      0
    ) {
      throw new Error(
        "SMS claim is no longer owned by this device.",
      );
    }

    return;
  }

  /*
   * Exponential retry backoff.
   *
   * Attempt 1 → 1 minute
   * Attempt 2 → 2 minutes
   * Attempt 3 → 4 minutes
   *
   * Maximum delay → 15 minutes.
   */
  const retryNumber =
    Math.max(
      attempts - 1,
      0,
    );

  const retryDelay =
    Math.min(
      60_000 *
        Math.pow(
          2,
          retryNumber,
        ),
      15 * 60_000,
    );

  const retryAt =
    new Date(
      now.getTime() +
        retryDelay,
    );

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
      {
        $set: {
          status:
            "pending",

          availableAt:
            retryAt,

          failureReason:
            data.error?.trim() ||
            "SMS sending failed; retry scheduled.",

          updatedAt:
            now,
        },

        $unset: {
          claimedBy:
            "",

          claimedAt:
            "",
        },
      },
    );

  if (
    result.matchedCount ===
    0
  ) {
    throw new Error(
      "SMS claim is no longer owned by this device.",
    );
  }
}

/* =========================================================
   RECOVER STALE CLAIMS
========================================================= */

/**
 * Returns abandoned processing messages to the queue.
 *
 * This should be called periodically by the server.
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

  /*
   * Messages that still have attempts available return to
   * pending.
   */
  const recoverResult =
    await smsOutbox.updateMany(
      {
        status:
          "processing",

        claimedAt: {
          $lt: staleBefore,
        },

        $expr: {
          $lt: [
            "$attempts",
            "$maxAttempts",
          ],
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
            "Previous SMS worker claim expired.",
        },

        $unset: {
          claimedBy:
            "",

          claimedAt:
            "",
        },
      },
    );

  /*
   * Messages that have exhausted their retry budget are
   * permanently failed.
   */
  await smsOutbox.updateMany(
    {
      status:
        "processing",

      claimedAt: {
        $lt: staleBefore,
      },

      $expr: {
        $gte: [
          "$attempts",
          "$maxAttempts",
        ],
      },
    },
    {
      $set: {
        status:
          "failed",

        failedAt:
          now,

        failureReason:
          "SMS worker claim expired after maximum attempts.",

        updatedAt:
          now,
      },

      $unset: {
        claimedBy:
          "",

        claimedAt:
          "",
      },
    },
  );

  return recoverResult.modifiedCount;
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
    await smsOutbox.findOne({
      _id:
        objectId,
    });

  if (!existing) {
    throw new Error(
      "SMS queue item not found.",
    );
  }

  /*
   * Idempotent cancellation.
   */
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

