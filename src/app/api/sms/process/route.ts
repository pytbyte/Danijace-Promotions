/**
 * =========================================================
 * GEO-SHUA
 * BANK SMS PROCESS API
 * =========================================================
 *
 * ANDROID
 *    ↓
 * parseBankSms()
 *    ↓
 * processIncomingTransaction()
 *    ↓
 * savings service OR loan service
 *
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 *
 * This route is the HTTP boundary for incoming Android SMS
 * messages.
 *
 * It is responsible for:
 *
 * - receiving the SMS
 * - validating the request
 * - parsing the SMS
 * - calling the SMS processor
 * - returning a complete processing trace
 *
 * It does NOT:
 *
 * - query members directly
 * - create savings deposits directly
 * - create loan repayments directly
 * - modify balances
 *
 * Financial persistence remains inside the domain services.
 *
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
  address?: unknown;
  body?: unknown;
  date?: unknown;
};

/* =========================================================
   RESPONSE HELPER
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
    typeof value !== "string"
  ) {
    return null;
  }

  const clean =
    value.trim();

  return clean || null;
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
     STEP 0
     RECEIVE AND VALIDATE HTTP REQUEST
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

  if (
    typeof body !== "object" ||
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

  /* =======================================================
     VALIDATE SMS BODY
  ======================================================= */

  if (
    typeof sms.body !== "string" ||
    !sms.body.trim()
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

  /* =======================================================
     VALIDATE ANDROID TIMESTAMP
  ======================================================= */

  if (
    typeof sms.date !== "number" ||
    !Number.isFinite(
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

  const address =
    normalizeAddress(
      sms.address,
    );

  /* =======================================================
     STEP 1
     PARSE SMS
  ======================================================= */

  let parsed;

  try {
    parsed =
      parseBankSms({
        address,

        body:
          sms.body,

        date:
          sms.date,
      });
  } catch (error) {
    /*
     * An Android inbox contains many messages that have
     * nothing to do with GEO-SHUA.
     *
     * A parser rejection therefore means:
     *
     * "Message received, but not a supported GEO-SHUA
     * bank transaction."
     *
     * We intentionally return HTTP 200.
     *
     * This prevents the Android synchronizer from treating
     * ordinary SMS messages as transport failures and
     * retrying them unnecessarily.
     */
    if (
      error instanceof SmsParseError
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

        received: {
          address,

          date:
            sms.date,

          body:
            sms.body,
        },

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
            "Processing was not started because the SMS could not be parsed as a supported bank transaction.",
        },

        receivedAt,
      });
    }

    /*
     * Unexpected parser failure.
     *
     * This is a genuine application/server problem.
     */
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

        received: {
          address,

          date:
            sms.date,

          body:
            sms.body,
        },

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
     STEP 2
     PROCESS TRANSACTION
  ======================================================= */

  try {
    const result =
      await processIncomingTransaction(
        parsed,
      );

    /* =====================================================
       UNKNOWN DESTINATION
    ===================================================== */

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

        received: {
          address,

          date:
            sms.date,

          body:
            sms.body,
        },

        parser: {
          success: true,

          data:
            parsed,
        },

        classifier: {
          success: true,

          transactionType:
            "unknown",

          accountNumber:
            parsed.accountNumber,

          reason:
            `Bank account "${parsed.accountNumber}" is not configured as a GEO-SHUA savings or loan collection account.`,
        },

        processor: {
          success: false,

          skipped: true,

          reason:
            "Financial processing was not started for an unknown bank collection account.",
        },

        receivedAt,
      });
    }

    /* =====================================================
       SUCCESSFUL FINANCIAL PROCESSING
    ===================================================== */

    return jsonResponse({
      success: true,

      status:
        result.status,

      stage:
        "processor",

      /*
       * The current processor contract returns "processed"
       * for successful financial processing.
       */
      processed: true,

      duplicate: false,

      ignored: false,

      financialChange: true,

      type:
        result.type,

      received: {
        address,

        date:
          sms.date,

        body:
          sms.body,
      },

      /* ===================================================
         PARSER RESULT
      =================================================== */

      parser: {
        success: true,

        data:
          parsed,
      },

      /* ===================================================
         CLASSIFIER RESULT
      =================================================== */

      classifier: {
        success: true,

        transactionType:
          parsed.transactionType,

        accountNumber:
          parsed.accountNumber,

        reason:
          parsed.transactionType ===
          "loan"
            ? "Bank collection account routed to the GEO-SHUA loan domain."
            : "Bank collection account routed to the GEO-SHUA savings domain.",
      },

      /* ===================================================
         PROCESSOR RESULT
      =================================================== */

      processor: {
        success: true,

        member:
          result.member,

        savingsAccount:
          "savingsAccount" in
          result
            ? result.savingsAccount
            : undefined,

        savingsTransaction:
          "savingsTransaction" in
          result
            ? result.savingsTransaction
            : undefined,

        loan:
          "loan" in result
            ? result.loan
            : undefined,

        repayment:
          "repayment" in
          result
            ? result.repayment
            : undefined,
      },

      /*
       * Keep the complete processor result for the
       * dashboard diagnostic panel.
       */
      result,

      receivedAt,
    });
  } catch (error) {
    /*
     * The SMS was received and parsed, but the financial
     * processing operation failed.
     *
     * Examples:
     *
     * - member could not be resolved
     * - member inactive
     * - multiple active loans
     * - missing savings account
     * - domain service rejected transaction
     * - database failure
     */
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

        received: {
          address,

          date:
            sms.date,

          body:
            sms.body,
        },

        /* =================================================
           PARSER
        ================================================= */

        parser: {
          success: true,

          data:
            parsed,
        },

        /* =================================================
           CLASSIFIER
        ================================================= */

        classifier: {
          success: true,

          transactionType:
            parsed.transactionType,

          accountNumber:
            parsed.accountNumber,

          reason:
            parsed.transactionType ===
            "loan"
              ? "Bank collection account routed to the GEO-SHUA loan domain."
              : parsed.transactionType ===
                "savings"
                ? "Bank collection account routed to the GEO-SHUA savings domain."
                : "Bank account was not classified as a supported GEO-SHUA destination.",
        },

        /* =================================================
           PROCESSOR
        ================================================= */

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

        receivedAt,
      },
      500,
    );
  }
}
