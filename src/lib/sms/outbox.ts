import {
  ObjectId,
  type Collection,
  type Db,
  type Filter,
  type FindOneAndUpdateOptions,
} from "mongodb";

import clientPromise from "@/lib/mongodb";

import {
  SMS_STATUSES,
  type ClaimSmsInput,
  type QueueSmsInput,
  type ReportSmsResultInput,
  type SmsClaim,
  type SmsOutboxDocument,
} from "./types";

/* =========================================================
   CONFIG
========================================================= */

const DB_NAME = "danijace-promotions";
const COLLECTION_NAME = "smsOutbox";

const DEFAULT_PRIORITY = 20;
const DEFAULT_MAX_ATTEMPTS = 5;

const MAX_CLAIM_LIMIT = 25;

/* =========================================================
   DATABASE
========================================================= */

async function getSmsOutboxCollection(): Promise<
  Collection<SmsOutboxDocument>
> {
  const client = await clientPromise;

  const db: Db = client.db(DB_NAME);

  return db.collection<SmsOutboxDocument>(
    COLLECTION_NAME,
  );
}

/* =========================================================
   INDEXES
========================================================= */

let indexesReady: Promise<void> | null = null;

async function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      const collection =
        await getSmsOutboxCollection();

      await collection.createIndex(
        {
          idempotencyKey: 1,
        },
        {
          unique: true,
          name: "sms_outbox_idempotency_unique",
        },
      );

      await collection.createIndex(
        {
          status: 1,
          availableAt: 1,
          priority: 1,
          createdAt: 1,
        },
        {
          name: "sms_outbox_queue",
        },
      );

      await collection.createIndex(
        {
          claimedBy: 1,
          status: 1,
        },
        {
          name: "sms_outbox_claimed_by",
        },
      );

      await collection.createIndex(
        {
          memberId: 1,
          createdAt: -1,
        },
        {
          name: "sms_outbox_member",
        },
      );
    })().catch((error) => {
      indexesReady = null;
      throw error;
    });
  }

  await indexesReady;
}

/* =========================================================
   HELPERS
========================================================= */

function normalizePhoneNumber(
  phone: string,
): string {
  const value = phone.trim();

  if (!value) {
    throw new Error("SMS recipient phone number is required.");
  }

  if (
    /^07\d{8}$/.test(value) ||
    /^01\d{8}$/.test(value)
  ) {
    return value;
  }

  if (
    /^\+2547\d{8}$/.test(value) ||
    /^\+2541\d{8}$/.test(value)
  ) {
    return `0${value.slice(4)}`;
  }

  if (
    /^2547\d{8}$/.test(value) ||
    /^2541\d{8}$/.test(value)
  ) {
    return `0${value.slice(3)}`;
  }

  throw new Error(
    `Invalid Kenyan SMS recipient: ${phone}`,
  );
}

function validateCalendarDate(
  value: string | undefined,
): void {
  if (value === undefined) {
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `Invalid SMS calendar date: ${value}`,
    );
  }
}

function toObjectId(
  value: string | undefined,
): ObjectId | undefined {
  if (!value) {
    return undefined;
  }

  if (!ObjectId.isValid(value)) {
    throw new Error(`Invalid MongoDB ObjectId: ${value}`);
  }

  return new ObjectId(value);
}

/* =========================================================
   QUEUE
========================================================= */

export async function queueSms(
  input: QueueSmsInput,
): Promise<{
  id: string;
  created: boolean;
}> {
  await ensureIndexes();

  const collection =
    await getSmsOutboxCollection();

  if (!input.idempotencyKey.trim()) {
    throw new Error(
      "SMS idempotency key is required.",
    );
  }

  if (!input.message.trim()) {
    throw new Error("SMS message is required.");
  }

  validateCalendarDate(input.scheduledFor);

  const recipient = normalizePhoneNumber(
    input.recipient,
  );

  const now = new Date();

  const document: SmsOutboxDocument = {
    type: input.type,

    memberId: toObjectId(input.memberId),
    loanId: toObjectId(input.loanId),

    recipient,
    message: input.message.trim(),

    status: SMS_STATUSES.PENDING,

    priority:
      input.priority ?? DEFAULT_PRIORITY,

    scheduledFor: input.scheduledFor,

    availableAt:
      input.availableAt ?? now,

    attempts: 0,

    maxAttempts:
      input.maxAttempts ??
      DEFAULT_MAX_ATTEMPTS,

    idempotencyKey:
      input.idempotencyKey.trim(),

    createdAt: now,
    updatedAt: now,
  };

  try {
    const result =
      await collection.insertOne(document);

    return {
      id: result.insertedId.toString(),
      created: true,
    };
  } catch (error: unknown) {
    /**
     * Duplicate idempotency key means the financial
     * event already created this SMS.
     *
     * Treat that as success rather than generating
     * another SMS.
     */
    if (
      isDuplicateKeyError(error)
    ) {
      const existing =
        await collection.findOne(
          {
            idempotencyKey:
              document.idempotencyKey,
          },
          {
            projection: {
              _id: 1,
            },
          },
        );

      if (!existing?._id) {
        throw error;
      }

      return {
        id: existing._id.toString(),
        created: false,
      };
    }

    throw error;
  }
}

/* =========================================================
   CLAIM
========================================================= */

export async function claimSms(
  input: ClaimSmsInput,
): Promise<SmsClaim[]> {
  await ensureIndexes();

  const collection =
    await getSmsOutboxCollection();

  const deviceId =
    input.deviceId.trim();

  if (!deviceId) {
    throw new Error("SMS device ID is required.");
  }

  const requestedLimit =
    input.limit ?? 10;

  const limit = Math.min(
    Math.max(
      Math.floor(requestedLimit),
      1,
    ),
    MAX_CLAIM_LIMIT,
  );

  const claims: SmsClaim[] = [];

  /**
   * Claim one job at a time using an atomic
   * findOneAndUpdate operation.
   *
   * Multiple Android devices therefore cannot
   * claim the same SMS.
   */
  for (let index = 0; index < limit; index += 1) {
    const now = new Date();

    const filter: Filter<SmsOutboxDocument> = {
      status: SMS_STATUSES.PENDING,
      availableAt: {
        $lte: now,
      },
    };

    const update = {
      $set: {
        status: SMS_STATUSES.PROCESSING,
        claimedBy: deviceId,
        claimedAt: now,
        updatedAt: now,
      },
      $inc: {
        attempts: 1,
      },
    };

    const options: FindOneAndUpdateOptions = {
      sort: {
        priority: 1,
        availableAt: 1,
        createdAt: 1,
      },
      returnDocument: "after",
    };

    const result =
      await collection.findOneAndUpdate(
        filter,
        update,
        options,
      );

    const document = result;

    if (!document) {
      break;
    }

    if (!document._id) {
      continue;
    }

    claims.push({
      id: document._id.toString(),

      type: document.type,

      memberId:
        document.memberId?.toString(),

      loanId:
        document.loanId?.toString(),

      recipient:
        document.recipient,

      message:
        document.message,

      scheduledFor:
        document.scheduledFor,

      attempts:
        document.attempts,
    });
  }

  return claims;
}

/* =========================================================
   REPORT RESULT
========================================================= */

export async function reportSmsResult(
  input: ReportSmsResultInput,
): Promise<void> {
  await ensureIndexes();

  const collection =
    await getSmsOutboxCollection();

  const deviceId =
    input.deviceId.trim();

  if (!deviceId) {
    throw new Error(
      "SMS device ID is required.",
    );
  }

  if (!ObjectId.isValid(input.smsId)) {
    throw new Error(
      "Invalid SMS ID.",
    );
  }

  const smsId =
    new ObjectId(input.smsId);

  const now = new Date();

  if (input.status === "sent") {
    const result =
      await collection.updateOne(
        {
          _id: smsId,
          status: SMS_STATUSES.PROCESSING,
          claimedBy: deviceId,
        },
        {
          $set: {
            status: SMS_STATUSES.SENT,
            sentAt: now,
            providerMessageId:
              input.providerMessageId,
            updatedAt: now,
          },
          $unset: {
            claimedBy: "",
            claimedAt: "",
            failureReason: "",
            failedAt: "",
          },
        },
      );

    if (result.matchedCount === 0) {
      throw new Error(
        "SMS is not currently claimed by this device.",
      );
    }

    return;
  }

  const reason =
    input.error?.trim() ||
    "SMS sending failed.";

  const document =
    await collection.findOne({
      _id: smsId,
      status: SMS_STATUSES.PROCESSING,
      claimedBy: deviceId,
    });

  if (!document) {
    throw new Error(
      "SMS is not currently claimed by this device.",
    );
  }

  const shouldRetry =
    document.attempts <
    document.maxAttempts;

  if (shouldRetry) {
    /**
     * Exponential retry delay:
     *
     * attempt 1 -> 1 minute
     * attempt 2 -> 2 minutes
     * attempt 3 -> 4 minutes
     * attempt 4 -> 8 minutes
     */
    const delayMinutes =
      Math.min(
        2 ** Math.max(
          document.attempts - 1,
          0,
        ),
        15,
      );

    const availableAt =
      new Date(
        now.getTime() +
          delayMinutes *
            60 *
            1000,
      );

    await collection.updateOne(
      {
        _id: smsId,
        status: SMS_STATUSES.PROCESSING,
        claimedBy: deviceId,
      },
      {
        $set: {
          status: SMS_STATUSES.PENDING,
          availableAt,
          failureReason: reason,
          updatedAt: now,
        },
        $unset: {
          claimedBy: "",
          claimedAt: "",
        },
      },
    );

    return;
  }

  await collection.updateOne(
    {
      _id: smsId,
      status: SMS_STATUSES.PROCESSING,
      claimedBy: deviceId,
    },
    {
      $set: {
        status: SMS_STATUSES.FAILED,
        failedAt: now,
        failureReason: reason,
        updatedAt: now,
      },
      $unset: {
        claimedBy: "",
        claimedAt: "",
      },
    },
  );
}

/* =========================================================
   CANCEL
========================================================= */

export async function cancelSms(
  smsId: string,
  reason = "SMS cancelled.",
): Promise<boolean> {
  await ensureIndexes();

  if (!ObjectId.isValid(smsId)) {
    throw new Error("Invalid SMS ID.");
  }

  const collection =
    await getSmsOutboxCollection();

  const result =
    await collection.updateOne(
      {
        _id: new ObjectId(smsId),
        status: {
          $in: [
            SMS_STATUSES.PENDING,
            SMS_STATUSES.PROCESSING,
          ],
        },
      },
      {
        $set: {
          status: SMS_STATUSES.CANCELLED,
          failureReason: reason,
          updatedAt: new Date(),
        },
        $unset: {
          claimedBy: "",
          claimedAt: "",
        },
      },
    );

  return result.modifiedCount > 0;
}

/* =========================================================
   DUPLICATE KEY
========================================================= */

function isDuplicateKeyError(
  error: unknown,
): boolean {
  if (
    !error ||
    typeof error !== "object"
  ) {
    return false;
  }

  const candidate =
    error as {
      code?: number;
    };

  return candidate.code === 11000;
}
