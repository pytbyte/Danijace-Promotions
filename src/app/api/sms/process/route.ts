import { NextRequest, NextResponse } from "next/server";

import {
  parseBankSms,
  parseBankSmsBatch,
} from "@/lib/sms/parser";

import type { SmsMessage } from "@/lib/sms/SmsReader";

/* =========================================================
   TYPES
========================================================= */

type ProcessSmsRequest = {
  message?: SmsMessage;
  messages?: SmsMessage[];
};

/* =========================================================
   POST /api/sms/process
========================================================= */

/**
 * Receives SMS JSON from the Android SmsReader
 * and passes it directly to the SMS parser.
 *
 * This route does NOT:
 *
 * - identify members
 * - query savings accounts
 * - query loans
 * - create transactions
 * - update balances
 *
 * Its only responsibility is:
 *
 * Android SMS
 *     ↓
 * API
 *     ↓
 * Parser
 *     ↓
 * Parsed SMS
 */
export async function POST(
  request: NextRequest,
) {
  try {
    const payload =
      (await request.json()) as ProcessSmsRequest;

    /* =====================================================
       SINGLE SMS
    ===================================================== */

    if (payload.message) {
      const sms = payload.message;

      if (
        !sms ||
        typeof sms.body !== "string" ||
        typeof sms.date !== "number"
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid SMS message.",
          },
          { status: 400 },
        );
      }

      try {
        const parsed =
          parseBankSms(sms);

        return NextResponse.json({
          success: true,
          parsed,
        });
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "SMS could not be parsed.",
          },
          { status: 422 },
        );
      }
    }

    /* =====================================================
       MULTIPLE SMS MESSAGES
    ===================================================== */

    if (Array.isArray(payload.messages)) {
      if (payload.messages.length === 0) {
        return NextResponse.json(
          {
            success: true,
            results: [],
          },
        );
      }

      const invalidMessage =
        payload.messages.find(
          (sms) =>
            !sms ||
            typeof sms.body !== "string" ||
            typeof sms.date !== "number",
        );

      if (invalidMessage) {
        return NextResponse.json(
          {
            success: false,
            error:
              "One or more SMS messages are invalid.",
          },
          { status: 400 },
        );
      }

      const results =
        parseBankSmsBatch(
          payload.messages,
        );

      return NextResponse.json({
        success: true,
        results,
      });
    }

    /* =====================================================
       INVALID REQUEST
    ===================================================== */

    return NextResponse.json(
      {
        success: false,
        error:
          "Request must contain either 'message' or 'messages'.",
      },
      { status: 400 },
    );
  } catch (error) {
    console.error(
      "POST /api/sms/process:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to process SMS request.",
      },
      { status: 400 },
    );
  }
}
