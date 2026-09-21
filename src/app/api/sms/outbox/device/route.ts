import { NextResponse } from "next/server";

import {
  registerSmsDevice,
} from "@/lib/sms/outbox/devices";

import {
  ensureSmsOutboxIndexes,
} from "@/lib/sms/outbox/indexes";

import {
  isSmsWorkerRequest,
} from "@/lib/sms/outbox/workerAuth";

/* =========================================================
   POST /api/sms/outbox/device

   Registers or refreshes an Android SMS worker device.

   The Android device sends:
   {
     deviceId: "...",
     token: "...",
     platform: "android"
   }

   deviceId = stable Android installation identity
   token    = current Firebase Cloud Messaging token
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    if (!isSmsWorkerRequest(request)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized.",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       BODY
    ===================================================== */

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid JSON body.",
        },
        {
          status: 400,
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
          ok: false,
          error: "Request body must be an object.",
        },
        {
          status: 400,
        },
      );
    }

    const payload =
      body as Record<string, unknown>;

    const deviceId =
      typeof payload.deviceId === "string"
        ? payload.deviceId.trim()
        : "";

    const token =
      typeof payload.token === "string"
        ? payload.token.trim()
        : "";

    const platform =
      typeof payload.platform === "string"
        ? payload.platform.trim()
        : "android";

    /* =====================================================
       VALIDATION
    ===================================================== */

    if (!deviceId) {
      return NextResponse.json(
        {
          ok: false,
          error: "deviceId is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "FCM token is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (deviceId.length > 200) {
      return NextResponse.json(
        {
          ok: false,
          error: "deviceId is too long.",
        },
        {
          status: 400,
        },
      );
    }

    if (token.length > 4096) {
      return NextResponse.json(
        {
          ok: false,
          error: "FCM token is too long.",
        },
        {
          status: 400,
        },
      );
    }

    if (platform !== "android") {
      return NextResponse.json(
        {
          ok: false,
          error: "Only Android devices are supported.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       ENSURE INDEXES
    ===================================================== */

    await ensureSmsOutboxIndexes();

    /* =====================================================
       REGISTER DEVICE
    ===================================================== */

    const device =
      await registerSmsDevice({
        deviceId,
        token,
        platform: "android",
      });

    /* =====================================================
       RESPONSE

       Do not return the FCM token.
    ===================================================== */

    return NextResponse.json({
      ok: true,
      device: {
        id: device._id?.toString(),
        deviceId: device.deviceId,
        platform: device.platform,
        enabled: device.enabled,
        lastSeenAt:
          device.lastSeenAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(
      "[SMS DEVICE] Registration failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to register SMS device.",
      },
      {
        status: 500,
      },
    );
  }
}