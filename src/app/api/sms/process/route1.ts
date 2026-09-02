/**
 * =========================================================
 * GEO-SHUA
 * BANK SMS PROCESS API
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

  /* =======================================================
     VALIDATE DATE
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
          smsId,

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
          smsId,

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
     PROCESS
  ======================================================= */

  try {

    const result =
      await processIncomingTransaction(
        parsed,
      );

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

          financialChange: false,

          type: "unknown",

          received: {
            smsId,

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
       SUCCESS
    ===================================================== */

    return jsonResponse({
      success: true,

      status:
        result.status,

      stage: "processor",

      processed: true,

      duplicate: false,

      ignored: false,

      financialChange: true,

      type:
        transactionType,

      received: {
        smsId,

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

      result,

      receivedAt,
    });

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

        received: {
          smsId,

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
