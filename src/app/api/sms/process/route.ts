/**
 * =========================================================
 * GEO-SHUA
 * SMS PROCESS API
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 *
 * HTTP boundary for Android foreground SMS ingestion.
 *
 * Flow:
 *
 * Android SmsReader
 *       ↓
 * POST /api/sms/process
 *       ↓
 * validate envelope
 *       ↓
 * parseBankSms()
 *       ↓
 * processIncomingTransaction()
 *       ↓
 * savings service / loan service
 *
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * The bank destination account in the SMS is a BANK
 * COLLECTION / DESTINATION ACCOUNT.
 *
 * It determines:
 *
 *   082083  → loan
 *   2650821 → savings
 *
 * It is NOT looked up as a GEO-SHUA financial account.
 *
 * Member identity comes from the sender name in the SMS.
 *
 * =========================================================
 */

import {
  NextResponse,
} from "next/server";

import {
  parseBankSms,
  SmsParseError,
} from "@/lib/sms/parser";

import {
  processIncomingTransaction,
} from "@/lib/sms/processor";

/* =========================================================
   TYPES
========================================================= */

type SmsProcessRequest = {
  smsId?: unknown;
  address?: unknown;
  body?: unknown;
  date?: unknown;
};

type ApiStatus =
  | "success"
  | "duplicate"
  | "ignored"
  | "error";

/* =========================================================
   CONSTANTS
========================================================= */

/**
 * Future SMS tolerance.
 *
 * Android/device clocks can differ slightly from the
 * server clock.
 */
const FUTURE_SMS_TOLERANCE_MS =
  5 * 60 * 1000;

/**
 * Diagnostic threshold only.
 *
 * We do NOT automatically reject old SMS here because
 * legitimate old bank messages may be encountered when
 * the foreground inbox is first read.
 */
const OLD_SMS_WARNING_MS =
  30 * 24 * 60 * 60 * 1000;

/* =========================================================
   HELPERS
========================================================= */

/**
 * Safely extract a string.
 */
function getOptionalString(
  value: unknown,
): string | null {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const clean =
    value.trim();

  return clean.length >
    0
    ? clean
    : null;
}

/**
 * Safely extract a positive SMS timestamp.
 */
function getSmsDate(
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

/**
 * Extract a useful error message.
 */
function getErrorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error &&
    error.message.trim()
      .length > 0
  ) {
    return error.message;
  }

  if (
    typeof error === "string" &&
    error.trim().length > 0
  ) {
    return error.trim();
  }

  return "SMS processing failed.";
}

/**
 * Build a standardized API response.
 */
function response(
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        "Cache-Control":
          "no-store",
      },
    },
  );
}

/* =========================================================
   POST
========================================================= */

export async function POST(
  request: Request,
) {
  const receivedAt =
    Date.now();

  /* =======================================================
     READ REQUEST BODY
  ======================================================= */

  let payload:
    | SmsProcessRequest
    | null = null;

  try {
    payload =
      (await request.json()) as SmsProcessRequest;
  } catch {
    return response(
      {
        status:
          "error" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "invalid_json",

        message:
          "Request body must contain valid JSON.",
      },
      400,
    );
  }

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return response(
      {
        status:
          "error" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "invalid_request",

        message:
          "SMS request payload is invalid.",
      },
      400,
    );
  }

  /* =======================================================
     EXTRACT ENVELOPE
  ======================================================= */

  const smsId =
    getOptionalString(
      payload.smsId,
    );

  const address =
    getOptionalString(
      payload.address,
    );

  const body =
    getOptionalString(
      payload.body,
    );

  const smsDate =
    getSmsDate(
      payload.date,
    );

  /* =======================================================
     VALIDATE SMS BODY
  ======================================================= */

  if (!body) {
    return response(
      {
        status:
          "error" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "missing_body",

        message:
          "SMS body is required.",

        smsId,
      },
      400,
    );
  }

  /* =======================================================
     VALIDATE SMS DATE
  ======================================================= */

  if (
    smsDate ===
    null
  ) {
    return response(
      {
        status:
          "error" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "invalid_date",

        message:
          "SMS timestamp must be a valid positive number.",

        smsId,
      },
      400,
    );
  }

  /* =======================================================
     FUTURE SMS PROTECTION
  ======================================================= */

  const futureDifference =
    smsDate -
    receivedAt;

  if (
    futureDifference >
    FUTURE_SMS_TOLERANCE_MS
  ) {
    return response(
      {
        status:
          "ignored" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "future_sms",

        message:
          "SMS timestamp is in the future and was not processed.",

        smsId,

        receivedAt,

        smsDate,

        futureDifferenceMs:
          futureDifference,
      },
      200,
    );
  }

  /* =======================================================
     AGE DIAGNOSTIC
  ======================================================= */

  const ageMs =
    receivedAt -
    smsDate;

  const oldSms =
    ageMs >
    OLD_SMS_WARNING_MS;

  /* =======================================================
     PARSE SMS
  ======================================================= */

  let parsed;

  try {
    parsed =
      parseBankSms({
        id:
          smsId,

        address,

        body,

        date:
          smsDate,
      });
  } catch (error) {
    const message =
      getErrorMessage(
        error,
      );

    /**
     * Parsing failures are intentionally returned as
     * HTTP 200 because an inbox contains many unrelated
     * messages and one non-bank SMS should not be treated
     * as an API/server failure.
     */
    return response(
      {
        status:
          "ignored" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "parse_failed",

        message,

        smsId,

        address,

        smsDate,

        oldSms,

        rawMessage:
          body,

        parserError:
          error instanceof
          SmsParseError,
      },
      200,
    );
  }

  /* =======================================================
     PARSED DIAGNOSTICS
  ======================================================= */

  /**
   * At this point we know:
   *
   * - reference
   * - amount
   * - senderName
   * - destinationAccountNumber
   * - transactionDate
   *
   * Parser deliberately leaves transactionType as
   * "unknown".
   */
  const parsedDiagnostic = {
    reference:
      parsed.reference,

    amount:
      parsed.amount,

    senderName:
      parsed.senderName,

    destinationAccountNumber:
      parsed.destinationAccountNumber,

    transactionType:
      parsed.transactionType,

    transactionDate:
      parsed.transactionDate
        .toISOString(),

    address:
      parsed.address,

    smsDate:
      parsed.smsDate,

    status:
      parsed.status,
  };

  /* =======================================================
     PROCESS FINANCIAL TRANSACTION
  ======================================================= */

  try {
    const result =
      await processIncomingTransaction(
        parsed,
      );

    /* =====================================================
       SAVINGS
    ===================================================== */

    if (
      result.type ===
      "savings"
    ) {
      return response(
        {
          status:
            "success" satisfies ApiStatus,

          processed:
            true,

          financialChange:
            true,

          reason:
            "savings_deposit_processed",

          message:
            "Bank SMS was processed as a GEO-SHUA savings deposit.",

          smsId,

          parsed:
            {
              ...parsedDiagnostic,

              transactionType:
                "savings",
            },

          member:
            result.member,

          savingsAccount:
            result.savingsAccount,

          savingsTransaction:
            result.savingsTransaction,

          oldSms,
        },
        200,
      );
    }

    /* =====================================================
       LOAN
    ===================================================== */

    if (
      result.type ===
      "loan"
    ) {
      return response(
        {
          status:
            "success" satisfies ApiStatus,

          processed:
            true,

          financialChange:
            true,

          reason:
            "loan_repayment_processed",

          message:
            "Bank SMS was processed as a GEO-SHUA loan repayment.",

          smsId,

          parsed:
            {
              ...parsedDiagnostic,

              transactionType:
                "loan",
            },

          member:
            result.member,

          loan:
            result.loan,

          repayment:
            result.repayment,

          oldSms,
        },
        200,
      );
    }

    /* =====================================================
       DEFENSIVE FALLBACK
    ===================================================== */

    return response(
      {
        status:
          "error" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "unknown_processor_result",

        message:
          "SMS processor returned an unsupported result.",

        smsId,

        parsed:
          parsedDiagnostic,

        oldSms,
      },
      500,
    );
  } catch (error) {
    const message =
      getErrorMessage(
        error,
      );

    /* =====================================================
       DUPLICATE DETECTION
    ===================================================== */

    /**
     * Current financial services are responsible for
     * idempotency.
     *
     * We recognize common duplicate wording here so the
     * foreground SMS monitor can display it correctly.
     */
    const lowerMessage =
      message.toLowerCase();

    const isDuplicate =
      lowerMessage.includes(
        "duplicate",
      ) ||
      lowerMessage.includes(
        "already processed",
      ) ||
      lowerMessage.includes(
        "already exists",
      ) ||
      lowerMessage.includes(
        "already recorded",
      ) ||
      lowerMessage.includes(
        "transaction reference",
      ) &&
        lowerMessage.includes(
          "exists",
        );

    if (
      isDuplicate
    ) {
      return response(
        {
          status:
            "duplicate" satisfies ApiStatus,

          processed:
            false,

          financialChange:
            false,

          reason:
            "duplicate_transaction",

          message:
            "This bank transaction has already been processed.",

          smsId,

          parsed:
            parsedDiagnostic,

          oldSms,
        },
        200,
      );
    }

    /* =====================================================
       UNKNOWN DESTINATION
    ===================================================== */

    if (
      lowerMessage.includes(
        "destination account",
      ) &&
      lowerMessage.includes(
        "not configured",
      )
    ) {
      return response(
        {
          status:
            "ignored" satisfies ApiStatus,

          processed:
            false,

          financialChange:
            false,

          reason:
            "unknown_bank_destination",

          message,

          smsId,

          parsed:
            parsedDiagnostic,

          destinationAccountNumber:
            parsed.destinationAccountNumber,

          oldSms,
        },
        200,
      );
    }

    /* =====================================================
       MEMBER NOT FOUND
    ===================================================== */

    if (
      lowerMessage.includes(
        "no geo-shua member",
      ) ||
      lowerMessage.includes(
        "did not exactly match",
      ) ||
      lowerMessage.includes(
        "multiple geo-shua members",
      ) ||
      lowerMessage.includes(
        "member",
      ) &&
        lowerMessage.includes(
          "not active",
        )
    ) {
      return response(
        {
          status:
            "ignored" satisfies ApiStatus,

          processed:
            false,

          financialChange:
            false,

          reason:
            "member_resolution_failed",

          message,

          smsId,

          parsed:
            parsedDiagnostic,

          memberName:
            parsed.senderName,

          oldSms,
        },
        200,
      );
    }

    /* =====================================================
       LOAN/SAVINGS ROUTING FAILURE
    ===================================================== */

    if (
      lowerMessage.includes(
        "no active geo-shua loan",
      ) ||
      lowerMessage.includes(
        "multiple active loans",
      )
    ) {
      return response(
        {
          status:
            "ignored" satisfies ApiStatus,

          processed:
            false,

          financialChange:
            false,

          reason:
            "loan_resolution_failed",

          message,

          smsId,

          parsed:
            parsedDiagnostic,

          memberName:
            parsed.senderName,

          oldSms,
        },
        200,
      );
    }

    /* =====================================================
       SAVINGS ACCOUNT FAILURE
    ===================================================== */

    if (
      lowerMessage.includes(
        "savings account",
      )
    ) {
      return response(
        {
          status:
            "ignored" satisfies ApiStatus,

          processed:
            false,

          financialChange:
            false,

          reason:
            "savings_account_resolution_failed",

          message,

          smsId,

          parsed:
            parsedDiagnostic,

          memberName:
            parsed.senderName,

          oldSms,
        },
        200,
      );
    }

    /* =====================================================
       UNEXPECTED PROCESSOR ERROR
    ===================================================== */

    console.error(
      "[GEO-SHUA SMS PROCESS] Unexpected processor error:",
      error,
    );

    return response(
      {
        status:
          "error" satisfies ApiStatus,

        processed:
          false,

        financialChange:
          false,

        reason:
          "processor_failed",

        message,

        smsId,

        parsed:
          parsedDiagnostic,

        oldSms,
      },
      500,
    );
  }
}

/* =========================================================
   OPTIONAL METHOD HANDLING
========================================================= */

export async function GET() {
  return response(
    {
      status:
        "success" satisfies ApiStatus,

      service:
        "GEO-SHUA SMS Processing API",

      message:
        "SMS processing endpoint is available. Use POST to process an Android bank SMS.",

      architecture:
        "foreground-only",

      classification:
        {
          loan:
            "082083",

          savings:
            "2650821",
        },
    },
    200,
  );
}