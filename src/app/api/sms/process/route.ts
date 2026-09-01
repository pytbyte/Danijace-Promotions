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
 * bank account classification
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
 *
 * IMPORTANT ARCHITECTURE
 * ---------------------------------------------------------
 *
 * parser.ts:
 *   extracts and normalizes the SMS
 *
 * processor.ts:
 *   classifies the BANK collection account
 *   resolves the member
 *   routes to savings or loan
 *
 * Therefore:
 *
 *   parsed.transactionType === "unknown"
 *
 * is EXPECTED at parser level.
 *
 * The final transaction type comes from:
 *
 *   result.type
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
    typeof value !==
    "string"
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
     RECEIVE REQUEST
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

  /* =======================================================
     VALIDATE SMS BODY
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

  /* =======================================================
     VALIDATE ANDROID TIMESTAMP
  ======================================================= */

  if (
    typeof sms.date !==
      "number" ||
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
     PARSE
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
    /* =====================================================
       NORMAL PARSER REJECTION
    ===================================================== */

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
            "Processing did not start because parsing failed.",
        },

        receivedAt,
      });
    }

    /* =====================================================
       UNEXPECTED PARSER FAILURE
    ===================================================== */

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
            error instanceof
              Error
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
     PROCESS
  ======================================================= */

  try {
    const result =
      await processIncomingTransaction(
        parsed,
      );

    /* =====================================================
       FINAL TYPE
       ----------------------------------------------------
       parser.transactionType is intentionally "unknown".
       processor result.type is the authoritative routing
       decision.
    ===================================================== */

    const transactionType =
      result.type;

    /* =====================================================
       SAFETY CHECK
    ===================================================== */

    if (
      transactionType !==
        "savings" &&
      transactionType !==
        "loan"
    ) {
      /*
       * This should never happen with the current processor
       * contract, but keeping the boundary defensive avoids
       * returning a false financial success.
       */
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

          duplicate: false,

          ignored: false,

          financialChange:
            false,

          type:
            "unknown",

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

          receivedAt,
        },
        500,
      );
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

      processed:
        true,

      duplicate:
        false,

      ignored:
        false,

      financialChange:
        true,

      /*
       * IMPORTANT:
       *
       * This is the final classification produced by
       * processor.ts.
       */
      type:
        transactionType,

      /* ===================================================
         RECEIVED SMS
      =================================================== */

      received: {
        address,

        date:
          sms.date,

        body:
          sms.body,
      },

      /* ===================================================
         PARSER
      =================================================== */

      parser: {
        success: true,

        /*
         * Parser deliberately reports unknown because
         * parser.ts does not perform routing.
         */
        data:
          parsed,
      },

      /* ===================================================
         CLASSIFIER
      =================================================== */

      classifier: {
        success: true,

        transactionType:
          transactionType,

        accountNumber:
          parsed.accountNumber,

        reason:
          transactionType ===
          "loan"
            ? "Bank collection account was classified as a GEO-SHUA loan payment."
            : "Bank collection account was classified as a GEO-SHUA savings payment.",
      },

      /* ===================================================
         PROCESSOR
      =================================================== */

      processor:
        transactionType ===
        "savings"
          ? {
              success: true,

              member:
                result.member,

              savingsAccount:
                result.savingsAccount,

              savingsTransaction:
                result.savingsTransaction,
            }
          : {
              success: true,

              member:
                result.member,

              loan:
                result.loan,

              repayment:
                result.repayment,
            },

      /* ===================================================
         COMPLETE RESULT
      =================================================== */

      result,

      receivedAt,
    });
  } catch (error) {
    /* =====================================================
       PROCESSOR FAILURE
    ===================================================== */

    console.error(
      "POST /api/sms/process processor failure:",
      error,
    );

    /*
     * The parser succeeded, but the financial processor
     * could not complete the operation.
     *
     * This response remains HTTP 500 so the Android client
     * can distinguish a processing failure from an ordinary
     * unrelated SMS.
     */
    return jsonResponse(
      {
        success: false,

        status: "error",

        stage: "processor",

        processed: false,

        duplicate: false,

        ignored: false,

        financialChange:
          false,

        /*
         * At this point the parser still contains "unknown"
         * because classification happens inside the processor.
         */
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
          success:
            parsed.transactionType !==
            "unknown",

          transactionType:
            parsed.transactionType,

          accountNumber:
            parsed.accountNumber,

          reason:
            parsed.transactionType ===
            "unknown"
              ? "Classification and financial routing are performed inside processor.ts."
              : parsed.transactionType ===
                  "loan"
                ? "Loan payment destination."
                : "Savings payment destination.",
        },

        /* =================================================
           PROCESSOR
        ================================================= */

        processor: {
          success: false,

          error:
            error instanceof
              Error
              ? error.message
              : "Bank transaction processing failed.",
        },

        error:
          error instanceof
            Error
            ? error.message
            : "Unable to process incoming SMS.",

        receivedAt,
      },
      500,
    );
  }
}
