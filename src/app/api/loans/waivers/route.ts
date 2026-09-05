import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  createLoanWaiver,
  getLoanWaivers,
} from "@/lib/loans/service";

import type {
  CreateLoanWaiverInput,
} from "@/lib/loans/types";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function successResponse<T>(
  data: T,
  status = 200,
) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    {
      status,
    },
  );
}

function errorResponse(
  message: string,
  status: number,
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    {
      status,
    },
  );
}

/* =========================================================
   SESSION USER
========================================================= */

type AuthenticatedSession = {
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

/* =========================================================
   ACTOR
========================================================= */

type WaiverActor = NonNullable<
  CreateLoanWaiverInput["waivedBy"]
>;

function getSessionActor(
  session: AuthenticatedSession,
): WaiverActor {
  const name =
    typeof session?.user?.name === "string"
      ? session.user.name.trim()
      : "";

  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.trim().toLowerCase()
      : "";

  if (!name || !email) {
    throw new Error(
      "Authenticated user does not have a valid name and email.",
    );
  }

  return {
    name,
    email,
  };
}

/* =========================================================
   GENERIC HELPERS
========================================================= */

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/* =========================================================
   LOAN ID
========================================================= */

function parseLoanId(
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new Error(
      "Loan ID is required.",
    );
  }

  const loanId = value.trim();

  if (!loanId) {
    throw new Error(
      "Loan ID is required.",
    );
  }

  return loanId;
}

/* =========================================================
   WAIVER REFERENCE
========================================================= */

/**
 * Immutable client-supplied idempotency reference.
 *
 * The same reference must be reused when a client retries
 * the same waiver request.
 */
function parseWaiverReference(
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new Error(
      "Waiver reference is required.",
    );
  }

  const waiverReference = value.trim();

  if (!waiverReference) {
    throw new Error(
      "Waiver reference is required.",
    );
  }

  /*
   * Keep the idempotency key bounded.
   */
  if (waiverReference.length > 200) {
    throw new Error(
      "Waiver reference must not exceed 200 characters.",
    );
  }

  return waiverReference;
}

/* =========================================================
   WAIVER AMOUNT
========================================================= */

function parseAmount(
  value: unknown,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new Error(
      "Waiver amount must be a positive number.",
    );
  }

  /*
   * Financial values are accepted only when their
   * value in cents can safely be represented.
   */
  if (
    !Number.isSafeInteger(
      Math.round(value * 100),
    )
  ) {
    throw new Error(
      "Waiver amount is outside the supported financial range.",
    );
  }

  return value;
}

/* =========================================================
   REASON
========================================================= */

function parseReason(
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new Error(
      "Waiver reason is required.",
    );
  }

  const reason = value.trim();

  if (!reason) {
    throw new Error(
      "Waiver reason is required.",
    );
  }

  /*
   * Keep the API payload bounded.
   *
   * The service performs its own normalization/validation
   * as the authoritative domain layer.
   */
  if (reason.length > 1000) {
    throw new Error(
      "Waiver reason must not exceed 1000 characters.",
    );
  }

  return reason;
}

/* =========================================================
   GET /api/loans/waivers
========================================================= */

/**
 * Retrieve the append-only waiver history for a loan.
 *
 * Query:
 *
 *   ?loanId=<loan-id>
 *
 * The service performs the authoritative ObjectId
 * validation and retrieves waivers newest-first.
 */
export async function GET(
  request: NextRequest,
) {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const session =
      (await auth()) as AuthenticatedSession | null;

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401,
      );
    }

    /* -------------------------------------------------------
       LOAN ID
    ------------------------------------------------------- */

    const loanId =
      request.nextUrl.searchParams.get(
        "loanId",
      );

    if (
      typeof loanId !== "string" ||
      !loanId.trim()
    ) {
      return errorResponse(
        "Loan ID is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       GET WAIVERS
    ------------------------------------------------------- */

    const waivers =
      await getLoanWaivers(
        loanId.trim(),
      );

    return NextResponse.json(
      {
        success: true,
        data: waivers,
        count: waivers.length,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (error) {
    console.error(
      "GET /api/loans/waivers error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to retrieve loan waivers.";

    const knownError =
      message.includes("required") ||
      message.includes("Invalid loan ID");

    return errorResponse(
      message,
      knownError ? 400 : 500,
    );
  }
}

/* =========================================================
   POST /api/loans/waivers
========================================================= */

/**
 * Create an append-only loan fine waiver.
 *
 * Expected body:
 *
 * {
 *   "waiverReference": "...",
 *   "loanId": "...",
 *   "amount": 500,
 *   "reason": "Approved by management"
 * }
 *
 * IMPORTANT:
 *
 * The client does NOT provide:
 *
 * - loan number
 * - member ID
 * - member information
 * - available fines
 * - total fines
 * - total waived fines
 * - outstanding balance
 * - createdAt
 * - waivedBy
 *
 * The service resolves/calculates authoritative financial
 * values and the authenticated session supplies the actor.
 *
 * waiverReference is an immutable idempotency key. The
 * client must reuse the same reference when retrying the
 * same logical waiver request.
 */
export async function POST(
  request: NextRequest,
) {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const session =
      (await auth()) as AuthenticatedSession | null;

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401,
      );
    }

    /* -------------------------------------------------------
       ACTOR
    ------------------------------------------------------- */

    const actor =
      getSessionActor(session);

    /* -------------------------------------------------------
       READ JSON
    ------------------------------------------------------- */

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return errorResponse(
        "Invalid JSON request body.",
        400,
      );
    }

    /* -------------------------------------------------------
       BODY MUST BE OBJECT
    ------------------------------------------------------- */

    if (!isRecord(body)) {
      return errorResponse(
        "Request body must be a JSON object.",
        400,
      );
    }

    /* -------------------------------------------------------
       WAIVER REFERENCE
    ------------------------------------------------------- */

    let waiverReference: string;

    try {
      waiverReference =
        parseWaiverReference(
          body.waiverReference,
        );
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Waiver reference is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       LOAN ID
    ------------------------------------------------------- */

    let loanId: string;

    try {
      loanId =
        parseLoanId(
          body.loanId,
        );
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Loan ID is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       AMOUNT
    ------------------------------------------------------- */

    let amount: number;

    try {
      amount =
        parseAmount(
          body.amount,
        );
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Invalid waiver amount.",
        400,
      );
    }

    /* -------------------------------------------------------
       REASON
    ------------------------------------------------------- */

    let reason: string;

    try {
      reason =
        parseReason(
          body.reason,
        );
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Waiver reason is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       BUILD SAFE INPUT
    ------------------------------------------------------- */

    const input: CreateLoanWaiverInput = {
      waiverReference,
      loanId,
      amount,
      reason,
      waivedBy: actor,
    };

    /* -------------------------------------------------------
       CREATE WAIVER
    ------------------------------------------------------- */

    /**
     * createLoanWaiver() is the authoritative financial
     * operation.
     *
     * It handles:
     *
     * - loan existence
     * - cancelled/completed loan protection
     * - existing fines
     * - existing waivers
     * - available waiver amount
     * - over-waiver protection
     * - append-only ledger insertion
     * - loan projection update
     * - outstanding balance calculation
     * - audit entry
     * - MongoDB transaction
     * - waiver idempotency
     */
    const waiver =
      await createLoanWaiver(
        input,
      );

    return successResponse(
      waiver,
      201,
    );
  } catch (error) {
    console.error(
      "POST /api/loans/waivers error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create loan waiver.";

    /* -------------------------------------------------------
       DOMAIN / VALIDATION ERRORS
    ------------------------------------------------------- */

    const knownError =
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("not found") ||
      message.includes("cancelled") ||
      message.includes("completed") ||
      message.includes("waiver") ||
      message.includes("Waiver") ||
      message.includes("fine") ||
      message.includes("Fine") ||
      message.includes("outstanding") ||
      message.includes("amount") ||
      message.includes("Amount") ||
      message.includes("reason") ||
      message.includes("Reason") ||
      message.includes("valid actor") ||
      message.includes("outside the supported financial range");

    return errorResponse(
      message,
      knownError ? 400 : 500,
    );
  }
}