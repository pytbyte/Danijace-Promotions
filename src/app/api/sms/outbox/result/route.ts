import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  reportSmsResult,
} from "@/lib/sms/outbox/service";

import {
  isSmsWorkerRequest,
} from "@/lib/sms/outbox/workerAuth";

/* =========================================================
   POST /api/sms/outbox/result

   Android reports whether a claimed SMS was successfully
   sent or failed.

   Authentication:
   - Android worker: x-geoshua-sms-worker
   - Web/admin callers: NextAuth session

   Performance:
   - Worker authentication is checked first.
   - No unnecessary database reads.
   - No cacheable responses.
   - Result reporting is delegated to one service operation.
========================================================= */

export async function POST(request: Request) {
  try {
    /* -----------------------------------------------------
       AUTHENTICATION

       The Android worker uses the lightweight worker token.
       Only non-worker callers pay the NextAuth session cost.
    ----------------------------------------------------- */

    if (!isSmsWorkerRequest(request)) {
      const session = await auth();

      if (!session?.user) {
        return NextResponse.json(
          {
            success: false,
            error: "Unauthorized.",
          },
          {
            status: 401,
            headers: {
              "Cache-Control": "no-store",
            },
          },
        );
      }
    }

    /* -----------------------------------------------------
       BODY
    ----------------------------------------------------- */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON request body.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const data = body as Record<string, unknown>;

    /* -----------------------------------------------------
       EXTRACT
    ----------------------------------------------------- */

    const deviceId =
      typeof data.deviceId === "string"
        ? data.deviceId.trim()
        : "";

    const smsId =
      typeof data.smsId === "string"
        ? data.smsId.trim()
        : "";

    const status =
      data.status === "sent" ||
      data.status === "failed"
        ? data.status
        : null;

    const providerMessageId =
      typeof data.providerMessageId === "string"
        ? data.providerMessageId.trim()
        : undefined;

    const error =
      typeof data.error === "string"
        ? data.error.trim()
        : undefined;

    /* -----------------------------------------------------
       VALIDATION

       Keep these checks local and cheap.
    ----------------------------------------------------- */

    if (!deviceId) {
      return NextResponse.json(
        {
          success: false,
          error: "deviceId is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (deviceId.length > 200) {
      return NextResponse.json(
        {
          success: false,
          error: "deviceId is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (!smsId) {
      return NextResponse.json(
        {
          success: false,
          error: "smsId is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (smsId.length > 200) {
      return NextResponse.json(
        {
          success: false,
          error: "smsId is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (!status) {
      return NextResponse.json(
        {
          success: false,
          error: 'status must be either "sent" or "failed".',
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (
      providerMessageId &&
      providerMessageId.length > 500
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "providerMessageId is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (
      error &&
      error.length > 2000
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "error message is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (
      status === "failed" &&
      !error
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "error is required when status is failed.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    /* -----------------------------------------------------
       REPORT RESULT

       This should be an atomic DB update inside
       reportSmsResult().
    ----------------------------------------------------- */

    await reportSmsResult({
      deviceId,
      smsId,
      status,
      providerMessageId,
      error,
    });

    /* -----------------------------------------------------
       SUCCESS

       No additional DB work.
    ----------------------------------------------------- */

    return NextResponse.json(
      {
        success: true,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "SMS OUTBOX RESULT ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to update SMS result.";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}