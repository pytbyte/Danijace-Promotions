import { NextResponse } from "next/server";

import {
  registerSmsDevice,
} from "@/lib/sms/outbox/devices";

import {
  isSmsWorkerRequest,
} from "@/lib/sms/outbox/workerAuth";

/* =========================================================
   POST /api/sms/outbox/device

   Registers or refreshes an Android SMS worker device.

   Android sends:

   {
     deviceId: "...",
     token: "...",
     platform: "android"
   }

   deviceId = stable Android installation identity
   token    = current Firebase Cloud Messaging token

   HOT PATH
   ---------------------------------------------------------
   This endpoint should be extremely lightweight.

   IMPORTANT:
   MongoDB indexes are NOT created here.

   Index initialization belongs to application/database
   startup rather than the Android registration request.
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       AUTHENTICATION

       Only the trusted Android SMS worker may register or
       refresh an SMS device.

       Check this before parsing the request body so an
       unauthorized request exits immediately.
    ===================================================== */

    if (
      !isSmsWorkerRequest(request)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Unauthorized.",
        },
        {
          status: 401,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    /* =====================================================
       BODY
    ===================================================== */

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid JSON body.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    /* =====================================================
       BODY TYPE
    ===================================================== */

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Request body must be an object.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    const payload =
      body as Record<
        string,
        unknown
      >;


    /* =====================================================
       DEVICE ID
    ===================================================== */

    const deviceId =
      typeof payload.deviceId ===
      "string"
        ? payload.deviceId.trim()
        : "";

    if (!deviceId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "deviceId is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (
      deviceId.length >
      200
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "deviceId is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    /* =====================================================
       FCM TOKEN
    ===================================================== */

    const token =
      typeof payload.token ===
      "string"
        ? payload.token.trim()
        : "";

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "FCM token is required.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (
      token.length >
      4096
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "FCM token is too long.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    /* =====================================================
       PLATFORM
    ===================================================== */

    const platform =
      typeof payload.platform ===
      "string"
        ? payload.platform.trim()
        : "android";

    if (
      platform !==
      "android"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only Android devices are supported.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }


    /* =====================================================
       REGISTER / REFRESH DEVICE
    ===================================================== */

    /*
     * This should be the only database operation performed
     * by this endpoint.
     *
     * registerSmsDevice() should internally perform an
     * atomic upsert using deviceId.
     *
     * Do NOT:
     *
     *   find device
     *   ↓
     *   update device
     *
     * because that creates an unnecessary database round
     * trip and a race window.
     */

    const device =
      await registerSmsDevice({
        deviceId,
        token,
        platform:
          "android",
      });


    /* =====================================================
       RESPONSE
    ===================================================== */

    /*
     * Never return the FCM token.
     *
     * Return only the information Android needs to confirm
     * that registration succeeded.
     */

    return NextResponse.json(
      {
        ok: true,

        device: {
          id:
            device._id?.toString(),

          deviceId:
            device.deviceId,

          platform:
            device.platform,

          enabled:
            device.enabled,

          lastSeenAt:
            device.lastSeenAt.toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );

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
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}