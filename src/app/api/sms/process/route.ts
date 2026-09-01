/**
 * Android
 *   ↓
 * parser
 *   ↓
 * processIncomingTransaction()
 *   ↓
 * savings service OR loan service
 */

import { NextRequest, NextResponse } from "next/server";

import { parseBankSms } from "@/lib/sms/parser";
import { processIncomingTransaction } from "@/lib/sms/processor";

export async function POST(
  request: NextRequest,
) {
  try {
    const body =
      await request.json();

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Request body must be a valid SMS object.",
        },
        {
          status: 400,
        },
      );
    }

    const sms =
      body as {
        address?: string | null;
        body?: unknown;
        date?: unknown;
      };

    if (
      typeof sms.body !== "string" ||
      !sms.body.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "SMS body is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof sms.date !== "number" ||
      !Number.isFinite(sms.date)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "SMS date is invalid.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       STEP 1: PARSE
    ===================================================== */

    const parsed =
      parseBankSms({
        address:
          sms.address ?? null,

        body:
          sms.body,

        date:
          sms.date,
      });

    /* =====================================================
       STEP 2: PROCESS
    ===================================================== */

    const result =
      await processIncomingTransaction(
        parsed,
      );

    /* =====================================================
       STEP 3: RESPONSE TO ANDROID
    ===================================================== */

    return NextResponse.json({
      success: true,

      processed: true,

      financialChange: true,

      type:
        result.type,

      parsed,

      result,
    });
  } catch (error) {
    console.error(
      "POST /api/sms/process failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        processed: false,
        financialChange: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to process incoming SMS.",
      },
      {
        status: 422,
      },
    );
  }
}