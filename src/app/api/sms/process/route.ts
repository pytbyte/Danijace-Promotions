/**
 * =========================================================
 * GEO-SHUA
 * BANK SMS PROCESS API
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 * This route is the ingestion/orchestration boundary.
 *
 * It:
 *   1. receives and validates the Android SMS envelope
 *   2. parses the bank SMS
 *   3. protects against impossible timestamps
 *   4. delegates financial decisions to processor.ts
 *   5. reports the exact processing outcome
 *
 * It does NOT:
 *   - create savings transactions directly
 *   - create loans directly
 *   - modify balances directly
 *
 * Financial idempotency MUST be enforced by the processor
 * and persistence layer.
 * =========================================================
 */

import {
  NextRequest,
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

type IncomingSmsRequest = {
  smsId?: unknown;
  address?: unknown;
  body?: unknown;
  date?: unknown;
};

/**
 * We intentionally keep this tolerant because the processor
 * is the financial authority and its result may evolve.
 */
type ProcessorResult = {
  status?: unknown;
  type?: unknown;

  duplicate?: unknown;
  ignored?: unknown;
  financialChange?: unknown;

  member?: unknown;
  savingsAccount?: unknown;
  savingsTransaction?: unknown;

  loan?: unknown;
  repayment?: unknown;

  result?: unknown;
};

/* =========================================================
   CONSTANTS
========================================================= */

/**
 * Bank timestamps should never legitimately be meaningfully
 * ahead of server time.
 *
 * Small tolerance protects against minor phone/bank/server
 * clock differences.
 */
const FUTURE_SMS_TOLERANCE_MS =
  5 * 60 * 1000;

/**
 * Used only for diagnostics.
 *
 * IMPORTANT:
 * This does NOT determine whether an old SMS is financially
 * valid. Historical-event policy belongs in processor.ts.
 *
 * We deliberately do not blanket-reject old SMS messages here
 * because legitimate inbox sweeps may ingest older messages.
 */
const VERY_OLD_SMS_WARNING_MS =
  30 * 24 * 60 * 60 * 1000;

/* =========================================================
   RESPONSE
========================================================= */

function jsonResponse(
  data: unknown,
  status = 200,
) {
  return NextResponse.json(
    data,
    {
      status,
    },
  );
}

/* =========================================================
   ADDRESS
========================================================= */

function normalizeAddress(
  value: unknown,
): string | null {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const clean =
    value.trim();

  return clean.length > 0
    ? clean
    : null;
}

/* =========================================================
   SMS ID
========================================================= */

function normalizeSmsId(
  value: unknown,
): string | null {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const clean =
    value.trim();

  return clean.length > 0
    ? clean
    : null;
}

/* =========================================================
   DATE HELPERS
========================================================= */

function isReasonableSmsDate(
  value: number,
): boolean {
  if (
    !Number.isFinite(value)
  ) {
    return false;
  }

  if (value <= 0) {
    return false;
  }

  return true;
}

function isFutureSmsDate(
  value: number,
): boolean {
  const now =
    Date.now();

  return (
    value >
    now +
      FUTURE_SMS_TOLERANCE_MS
  );
}

function isVeryOldSmsDate(
  value: number,
): boolean {
  const now =
    Date.now();

  return (
    now - value >
    VERY_OLD_SMS_WARNING_MS
  );
}

/* =========================================================
   RESULT HELPERS
========================================================= */

function asProcessorResult(
  value: unknown,
): ProcessorResult {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as ProcessorResult;
}

function asString(
  value: unknown,
): string | null {
  return typeof value ===
    "string"
    ? value
    : null;
}

function asBoolean(
  value: unknown,
): boolean | null {
  return typeof value ===
    "boolean"
    ? value
    : null;
}

/**
 * The processor should eventually return these explicitly.
 *
 * For backward compatibility we derive sensible defaults
 * instead of blindly claiming success.
 */
function getProcessorStatus(
  result: ProcessorResult,
): string {
  return (
    asString(
      result.status,
    ) ??
    "processed"
  );
}

function getProcessorType(
  result: ProcessorResult,
  parsedType: string,
): string {
  return (
    asString(
      result.type,
    ) ??
    parsedType
  );
}

function getProcessorDuplicate(
  result: ProcessorResult,
): boolean {
  return (
    asBoolean(
      result.duplicate,
    ) === true
  );
}

function getProcessorIgnored(
  result: ProcessorResult,
): boolean {
  return (
    asBoolean(
      result.ignored,
    ) === true
  );
}

function getProcessorFinancialChange(
  result: ProcessorResult,
): boolean {
  /**
   * Financial change MUST be explicitly true.
   *
   * We do not infer it from "processed", "success", or
   * the existence of an object.
   */
  return (
    asBoolean(
      result.financialChange,
    ) === true
  );
}

/* =========================================================
   RECEIVED PAYLOAD
========================================================= */

function buildReceived(
  smsId: string | null,
  address: string | null,
  date: number,
  body: string,
) {
  return {
    smsId,
    address,
    date,
    body,
  };
}

/* =========================================================
   POST
========================================================= */

export async function POST(
  request: NextRequest,
) {
  const receivedAt =
    new Date().toISOString();

  /* =======================================================
     RECEIVE JSON
  ======================================================= */

  let body: unknown;

  try {
    body =
      await request.json();
  } catch {
    return jsonResponse(
      {
        success: false,
        status: "error",
        stage: "received",
        processed: false,
        duplicate: false,
        ignored: false,
        financialChange: false,
        error:
          "Request body must contain valid JSON.",
        receivedAt,
      },
      400,
    );
  }

  /* =======================================================
     VALIDATE OBJECT
  ======================================================= */

  if (
    typeof body !==
      "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return jsonResponse(
      {
        success: false,
        status: "error",
        stage: "received",
        processed: false,
        duplicate: false,
        ignored: false,
        financialChange: false,
        error:
          "Request body must be a valid SMS object.",
        receivedAt,
      },
      400,
    );
  }

  const sms =
    body as IncomingSmsRequest;

  const smsId =
    normalizeSmsId(
      sms.smsId,
    );

  /* =======================================================
     VALIDATE BODY
  ======================================================= */

  if (
    typeof sms.body !==
      "string" ||
    sms.body.trim().length ===
      0
  ) {
    return jsonResponse(
      {
        success: false,
        status: "error",
        stage: "received",
        processed: false,
        duplicate: false,
        ignored: false,
        financialChange: false,
        error:
          "SMS body is required.",
        receivedAt,
      },
      400,
    );
  }

  const smsBody =
    sms.body.trim();

  /* =======================================================
     VALIDATE DATE
  ======================================================= */

  if (
    typeof sms.date !==
      "number" ||
    !isReasonableSmsDate(
      sms.date,
    )
  ) {
    return jsonResponse(
      {
        success: false,
        status: "error",
        stage: "received",
        processed: false,
        duplicate: false,
        ignored: false,
        financialChange: false,
        error:
          "SMS date is invalid.",
        receivedAt,
      },
      400,
    );
  }

  const smsDate =
    sms.date;

  const address =
    normalizeAddress(
      sms.address,
    );

  const received =
    buildReceived(
      smsId,
      address,
      smsDate,
      smsBody,
    );

  /* =======================================================
     FUTURE-DATED SMS PROTECTION
  ======================================================= */

  if (
    isFutureSmsDate(
      smsDate,
    )
  ) {
    return jsonResponse(
      {
        success: true,
        status: "ignored",
        stage: "received",
        processed: false,
        duplicate: false,
        ignored: true,
        financialChange: false,
        type: "unknown",

        received,

        parser: {
          success: false,
          error:
            "SMS timestamp is in the future.",
        },

        classifier: {
          success: false,
          transactionType:
            "unknown",
          reason:
            "Future-dated SMS messages are not eligible for automatic financial processing.",
        },

        processor: {
          success: false,
          skipped: true,
          reason:
            "Processing did not start because the SMS timestamp is invalid for the current ingestion window.",
        },

        receivedAt,
      },
      200,
    );
  }

  /* =======================================================
     PARSE
  ======================================================= */

  let parsed;

  try {
    parsed =
      parseBankSms({
        address,
        body: smsBody,
        date: smsDate,
      });
  } catch (error) {
    if (
      error instanceof
      SmsParseError
    ) {
      return jsonResponse({
        success: true,

        status: "ignored",

        stage: "parser",

        processed: false,

        duplicate: false,

        ignored: true,

        financialChange: false,

        type: "unknown",

        received,

        parser: {
          success: false,

          error:
            error.message,
        },

        classifier: {
          success: false,

          transactionType:
            "unknown",

          reason:
            "SMS did not match the supported GEO-SHUA bank transaction format.",
        },

        processor: {
          success: false,

          skipped: true,

          reason:
            "Processing did not start because parsing failed.",
        },

        receivedAt,
      });
    }

    console.error(
      "POST /api/sms/process parser failure:",
      error,
    );

    return jsonResponse(
      {
        success: false,

        status: "error",

        stage: "parser",

        processed: false,

        duplicate: false,

        ignored: false,

        financialChange: false,

        type: "unknown",

        received,

        parser: {
          success: false,

          error:
            error instanceof Error
              ? error.message
              : "Unexpected SMS parser failure.",
        },

        receivedAt,
      },
      500,
    );
  }

  /* =======================================================
     POST-PARSE SAFETY
  ======================================================= */

  /**
   * The parser determines loan/savings routing exclusively
   * from the GEO-SHUA collection account.
   *
   * Unknown must NEVER reach financial processing.
   */
  if (
    parsed.transactionType ===
    "unknown"
  ) {
    return jsonResponse({
      success: true,

      status: "ignored",

      stage: "classifier",

      processed: false,

      duplicate: false,

      ignored: true,

      financialChange: false,

      type: "unknown",

      received,

      parser: {
        success: true,

        data: parsed,
      },

      classifier: {
        success: false,

        transactionType:
          "unknown",

        accountNumber:
          parsed.accountNumber,

        reason:
          "The bank account in the SMS is not a registered GEO-SHUA financial destination.",
      },

      processor: {
        success: false,

        skipped: true,

        reason:
          "Financial processing was blocked for an unknown destination.",
      },

      receivedAt,
    });
  }

  /* =======================================================
     HISTORICAL SMS DIAGNOSTIC
  ======================================================= */

  const historicalWarning =
    isVeryOldSmsDate(
      parsed.smsDate,
    )
      ? {
          historical: true,
          warning:
            "SMS is older than the automatic-ingestion diagnostic threshold. The processor must determine whether the underlying bank event is still eligible for financial action.",
        }
      : {
          historical: false,
        };

  /* =======================================================
     PROCESS
  ======================================================= */

  let result: unknown;

  try {
    /**
     * IMPORTANT:
     *
     * processor.ts remains the financial authority.
     *
     * The processor must:
     *
     *   - enforce idempotency
     *   - match existing loans for repayments
     *   - never create a new loan merely because an old SMS
     *     says money was received
     *   - atomically persist financial effects
     */
    result =
      await processIncomingTransaction(
        parsed,
      );
  } catch (error) {
    console.error(
      "POST /api/sms/process processor failure:",
      error,
    );

    return jsonResponse(
      {
        success: false,

        status: "error",

        stage: "processor",

        processed: false,

        duplicate: false,

        ignored: false,

        financialChange: false,

        type:
          parsed.transactionType,

        received,

        parser: {
          success: true,

          data: parsed,
        },

        classifier: {
          success: true,

          transactionType:
            parsed.transactionType,

          accountNumber:
            parsed.accountNumber,

          reason:
            parsed.transactionType ===
            "loan"
              ? "Bank collection account classified as loan payment destination."
              : "Bank collection account classified as savings payment destination.",
        },

        processor: {
          success: false,

          error:
            error instanceof Error
              ? error.message
              : "Bank transaction processing failed.",
        },

        error:
          error instanceof Error
            ? error.message
            : "Unable to process incoming SMS.",

        historical:
          historicalWarning,

        receivedAt,
      },
      500,
    );
  }

  /* =======================================================
     NORMALIZE PROCESSOR RESULT
  ======================================================= */

  const processorResult =
    asProcessorResult(
      result,
    );

  const transactionType =
    getProcessorType(
      processorResult,
      parsed.transactionType,
    );

  const duplicate =
    getProcessorDuplicate(
      processorResult,
    );

  const ignored =
    getProcessorIgnored(
      processorResult,
    );

  const financialChange =
    getProcessorFinancialChange(
      processorResult,
    );

  const processorStatus =
    getProcessorStatus(
      processorResult,
    );

  /* =======================================================
     FINAL SAFETY CHECK
  ======================================================= */

  if (
    transactionType !==
      "savings" &&
    transactionType !==
      "loan"
  ) {
    console.error(
      "POST /api/sms/process invalid processor type:",
      result,
    );

    return jsonResponse(
      {
        success: false,

        status: "error",

        stage: "processor",

        processed: false,

        duplicate,

        ignored: false,

        financialChange: false,

        type: "unknown",

        received,

        parser: {
          success: true,

          data: parsed,
        },

        classifier: {
          success: false,

          transactionType:
            "unknown",

          accountNumber:
            parsed.accountNumber,

          reason:
            "The processor did not return a valid financial destination.",
        },

        processor: {
          success: false,

          error:
            "Invalid processor transaction type.",
        },

        result,

        receivedAt,
      },
      500,
    );
  }

  /* =======================================================
     DUPLICATE
  ======================================================= */

  if (
    duplicate
  ) {
    return jsonResponse({
      success: true,

      status: "duplicate",

      stage: "processor",

      processed: false,

      duplicate: true,

      ignored: false,

      financialChange: false,

      type: transactionType,

      received,

      parser: {
        success: true,

        data: parsed,
      },

      classifier: {
        success: true,

        transactionType,

        accountNumber:
          parsed.accountNumber,

        reason:
          transactionType ===
          "loan"
            ? "Loan payment destination."
            : "Savings payment destination.",
      },

      processor: {
        success: true,

        duplicate: true,

        message:
          "The bank transaction has already been processed. No new financial entry was created.",
      },

      result,

      historical:
        historicalWarning,

      receivedAt,
    });
  }

  /* =======================================================
     IGNORED WITHOUT FINANCIAL CHANGE
  ======================================================= */

  if (
    ignored &&
    !financialChange
  ) {
    return jsonResponse({
      success: true,

      status:
        processorStatus ===
        "processed"
          ? "ignored"
          : processorStatus,

      stage: "processor",

      processed: false,

      duplicate: false,

      ignored: true,

      financialChange: false,

      type: transactionType,

      received,

      parser: {
        success: true,

        data: parsed,
      },

      classifier: {
        success: true,

        transactionType,

        accountNumber:
          parsed.accountNumber,

        reason:
          transactionType ===
          "loan"
            ? "Loan payment destination."
            : "Savings payment destination.",
      },

      processor: {
        success: true,

        skipped: true,

        result,
      },

      historical:
        historicalWarning,

      receivedAt,
    });
  }

  /* =======================================================
     SUCCESS
  ======================================================= */

  if (
    financialChange
  ) {
    return jsonResponse({
      success: true,

      status:
        processorStatus,

      stage: "processor",

      processed: true,

      duplicate: false,

      ignored: false,

      financialChange: true,

      type: transactionType,

      received,

      parser: {
        success: true,

        data: parsed,
      },

      classifier: {
        success: true,

        transactionType,

        accountNumber:
          parsed.accountNumber,

        reason:
          transactionType ===
          "loan"
            ? "Bank collection account was classified as a GEO-SHUA loan payment."
            : "Bank collection account was classified as a GEO-SHUA savings payment.",
      },

      processor:
        transactionType ===
        "savings"
          ? {
              success: true,

              member:
                processorResult.member,

              savingsAccount:
                processorResult.savingsAccount,

              savingsTransaction:
                processorResult.savingsTransaction,
            }
          : {
              success: true,

              member:
                processorResult.member,

              loan:
                processorResult.loan,

              repayment:
                processorResult.repayment,
            },

      result,

      historical:
        historicalWarning,

      receivedAt,
    });
  }

  /* =======================================================
     UNSAFE / INCOMPLETE PROCESSOR RESULT
  ======================================================= */

  console.error(
    "POST /api/sms/process processor returned an incomplete financial result:",
    result,
  );

  return jsonResponse(
    {
      success: false,

      status: "error",

      stage: "processor",

      processed: false,

      duplicate: false,

      ignored: false,

      financialChange: false,

      type: transactionType,

      received,

      parser: {
        success: true,

        data: parsed,
      },

      classifier: {
        success: true,

        transactionType,

        accountNumber:
          parsed.accountNumber,

        reason:
          transactionType ===
          "loan"
            ? "Loan payment destination."
            : "Savings payment destination.",
      },

      processor: {
        success: false,

        error:
          "Processor returned without explicitly confirming the financial outcome.",
      },

      result,

      historical:
        historicalWarning,

      receivedAt,
    },
    500,
  );
}