/**
 * =========================================================
 * GEO-SHUA
 * ANDROID SMS DIAGNOSTIC API
 * =========================================================
 *
 * PURPOSE
 * ---------------------------------------------------------
 *
 * This endpoint is TEMPORARY diagnostic infrastructure.
 *
 * It intentionally does NOT:
 *
 * - parse bank SMS
 * - resolve members
 * - resolve loans
 * - resolve savings accounts
 * - create repayments
 * - create savings deposits
 * - send notifications
 *
 * Its only responsibility is to prove that an SMS can travel
 * through the Android background pipeline:
 *
 * Android SmsReceiver
 *      ↓
 * SmsQueueStore
 *      ↓
 * SmsDiagnosticWorker
 *      ↓
 * this endpoint
 *      ↓
 * MongoDB
 *
 * =========================================================
 */

import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

/* =========================================================
   DATABASE
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB ||
  "geo-shua";

const COLLECTION =
  "smsDiagnostics";

/* =========================================================
   TYPES
========================================================= */

type SmsDiagnosticDocument = {
  _id: string;

  smsId: string;

  address: string;

  body: string;

  smsDate: number;

  androidReceivedAt: number | null;

  workerStartedAt: number | null;

  workerSentAt: number | null;

  deviceId: string | null;

  source: "android-sms-diagnostic";

  createdAt: Date;

  lastServerReceivedAt: Date;
};

type DiagnosticRequest = {
  smsId?: unknown;

  address?: unknown;

  body?: unknown;

  date?: unknown;

  receivedAt?: unknown;

  workerStartedAt?: unknown;

  workerSentAt?: unknown;

  deviceId?: unknown;
};

/* =========================================================
   HELPERS
========================================================= */

function response(
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(
    body,
    {
      status,

      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function getString(
  value: unknown,
): string | null {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const clean =
    value.trim();

  return clean.length > 0
    ? clean
    : null;
}

function getTimestamp(
  value: unknown,
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  return value;
}

/* =========================================================
   POST
========================================================= */

export async function POST(
  request: Request,
) {
  const serverReceivedAt =
    new Date();

  /* =======================================================
     READ JSON
  ======================================================= */

  let payload:
    | DiagnosticRequest
    | null = null;

  try {
    payload =
      (await request.json()) as DiagnosticRequest;
  } catch {
    return response(
      {
        status: "error",

        reason: "invalid_json",

        message:
          "Request body must contain valid JSON.",
      },
      400,
    );
  }

  if (
    !payload ||
    typeof payload !== "object"
  ) {
    return response(
      {
        status: "error",

        reason: "invalid_request",

        message:
          "Diagnostic payload must be a JSON object.",
      },
      400,
    );
  }

  /* =======================================================
     EXTRACT
  ======================================================= */

  const smsId =
    getString(
      payload.smsId,
    );

  const address =
    getString(
      payload.address,
    );

  const body =
    getString(
      payload.body,
    );

  const smsDate =
    getTimestamp(
      payload.date,
    );

  const androidReceivedAt =
    getTimestamp(
      payload.receivedAt,
    );

  const workerStartedAt =
    getTimestamp(
      payload.workerStartedAt,
    );

  const workerSentAt =
    getTimestamp(
      payload.workerSentAt,
    );

  const deviceId =
    getString(
      payload.deviceId,
    );

  /* =======================================================
     VALIDATION
  ======================================================= */

  if (!smsId) {
    return response(
      {
        status: "error",

        reason: "missing_sms_id",

        message:
          "smsId is required.",
      },
      400,
    );
  }

  if (!address) {
    return response(
      {
        status: "error",

        reason: "missing_address",

        message:
          "address is required.",
      },
      400,
    );
  }

  if (!body) {
    return response(
      {
        status: "error",

        reason: "missing_body",

        message:
          "body is required.",
      },
      400,
    );
  }

  if (
    smsDate === null
  ) {
    return response(
      {
        status: "error",

        reason: "invalid_date",

        message:
          "date must be a positive timestamp.",
      },
      400,
    );
  }

  /* =======================================================
     MONGODB
  ======================================================= */

  try {
    const client =
      await clientPromise;

    const db =
      client.db(DB_NAME);

    /*
     * IMPORTANT:
     *
     * Explicitly type this collection because the diagnostic
     * documents intentionally use the Android smsId string as
     * MongoDB _id.
     *
     * Without this generic, the MongoDB driver can infer
     * _id as ObjectId and TypeScript will reject:
     *
     *     _id: smsId
     *
     */
    const collection =
      db.collection<SmsDiagnosticDocument>(
        COLLECTION,
      );

    /* =====================================================
       IDEMPOTENT UPSERT
    ====================================================== */

    const result =
      await collection.updateOne(
        {
          _id: smsId,
        },
        {
          $setOnInsert: {
            _id: smsId,

            smsId,

            address,

            body,

            smsDate,

            androidReceivedAt:
              androidReceivedAt,

            workerStartedAt:
              workerStartedAt,

            workerSentAt:
              workerSentAt,

            deviceId:
              deviceId,

            source:
              "android-sms-diagnostic",

            createdAt:
              serverReceivedAt,
          },

          $set: {
            lastServerReceivedAt:
              serverReceivedAt,
          },
        },
        {
          upsert: true,
        },
      );

    const duplicate =
      result.matchedCount > 0 &&
      result.upsertedCount === 0;

    /* =====================================================
       RESPONSE
    ====================================================== */

    return response(
      {
        status:
          duplicate
            ? "duplicate"
            : "success",

        stored: true,

        duplicate,

        smsId,

        serverReceivedAt:
          serverReceivedAt.toISOString(),
      },
      200,
    );
  } catch (error) {
    console.error(
      "[GEO-SHUA SMS DIAGNOSTIC] MongoDB write failed:",
      error,
    );

    return response(
      {
        status: "error",

        stored: false,

        reason: "database_error",

        message:
          error instanceof Error
            ? error.message
            : "Failed to store diagnostic SMS.",
      },
      500,
    );
  }
}

/* =========================================================
   GET
========================================================= */

export async function GET() {
  return response(
    {
      status: "success",

      service:
        "GEO-SHUA Android SMS Diagnostic API",

      collection:
        COLLECTION,

      message:
        "Diagnostic endpoint is available. Use POST to record an Android SMS.",
    },
    200,
  );
}