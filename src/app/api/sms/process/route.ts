import { NextRequest, NextResponse } from "next/server";

import type { SmsMessage } from "@/lib/sms/SmsReader";

import {
  parseBankSms,
  parseBankSmsBatch,
} from "@/lib/sms/parser";

/* =========================================================
   TYPES
========================================================= */

type SmsRequestBody =
  | SmsMessage
  | {
      message?: SmsMessage;
      messages?: SmsMessage[];
    };

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function errorResponse(
  message: string,
  status = 400
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

/* =========================================================
   POST /api/sms/process
========================================================= */

/**
 * Receive SMS from the Android SmsReader and pass it
 * directly to the bank SMS parser.
 *
 * Supported request formats:
 *
 * 1. Single SMS directly:
 *
 * {
 *   "address": "BANK",
 *   "body": "UHTHY4Z1PL Confirmed. KES 1,400.00 ...",
 *   "date": 1788041580000
 * }
 *
 * 2. Single SMS wrapped in "message":
 *
 * {
 *   "message": {
 *     "address": "BANK",
 *     "body": "...",
 *     "date": 1788041580000
 *   }
 * }
 *
 * 3. Multiple SMS:
 *
 * {
 *   "messages": [
 *     {
 *       "address": "BANK",
 *       "body": "...",
 *       "date": 1788041580000
 *     }
 *   ]
 * }
 *
 * IMPORTANT:
 *
 * This endpoint ONLY:
 *
 * Android SMS
 *      ↓
 * this route
 *      ↓
 * parser
 *
 * It does NOT:
 *
 * - identify members
 * - query savings accounts
 * - query loans
 * - create repayments
 * - create savings transactions
 * - modify balances
 */
export async function POST(
  request: NextRequest
) {
  try {
    /* =====================================================
       READ JSON
    ===================================================== */

    let body: SmsRequestBody;

    try {
      body = (await request.json()) as SmsRequestBody;
    } catch {
      return errorResponse(
        "Request body must contain valid JSON."
      );
    }

    if (
      !body ||
      typeof body !== "object"
    ) {
      return errorResponse(
        "Request body must contain an SMS object."
      );
    }

    /* =====================================================
       FORMAT 1
       SMS object sent directly
    ===================================================== */

    if (
      "body" in body &&
      "date" in body
    ) {
      try {
        const parsed = parseBankSms(
          body as SmsMessage
        );

        return NextResponse.json({
          success: true,
          type: "single",
          parsed,
        });
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            type: "single",
            error:
              error instanceof Error
                ? error.message
                : "Unable to parse SMS.",
          },
          { status: 422 }
        );
      }
    }

    /* =====================================================
       FORMAT 2
       { message: SmsMessage }
    ===================================================== */

    if (
      "message" in body &&
      body.message
    ) {
      try {
        const parsed = parseBankSms(
          body.message
        );

        return NextResponse.json({
          success: true,
          type: "single",
          parsed,
        });
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            type: "single",
            error:
              error instanceof Error
                ? error.message
                : "Unable to parse SMS.",
          },
          { status: 422 }
        );
      }
    }

    /* =====================================================
       FORMAT 3
       { messages: SmsMessage[] }
    ===================================================== */

    if (
      "messages" in body &&
      Array.isArray(body.messages)
    ) {
      if (body.messages.length === 0) {
        return errorResponse(
          "SMS messages array is empty."
        );
      }

      try {
        const results =
          parseBankSmsBatch(
            body.messages
          );

        const successful =
          results.filter(
            (result) =>
              result.success
          ).length;

        const failed =
          results.length -
          successful;

        return NextResponse.json({
          success: true,
          type: "batch",
          total: results.length,
          successful,
          failed,
          results,
        });
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            type: "batch",
            error:
              error instanceof Error
                ? error.message
                : "Unable to parse SMS messages.",
          },
          { status: 422 }
        );
      }
    }

    /* =====================================================
       INVALID FORMAT
    ===================================================== */

    return errorResponse(
      "Request must contain either a valid SMS message or messages array."
    );
  } catch (error) {
    console.error(
      "POST /api/sms/process failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to process SMS request.",
      },
      { status: 500 }
    );
  }
}
