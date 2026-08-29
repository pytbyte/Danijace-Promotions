import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  createSavingsAdjustment,
  getSavingsTransactionById,
  type CreateSavingsAdjustmentInput,
} from "@/lib/savings/service";

/* =========================================================
   FIXED SACCO
========================================================= */

const SACCO_ID = "geoshua";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function successResponse<T>(
  data: T,
  status = 200
) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    {
      status,
    }
  );
}

function errorResponse(
  message: string,
  status: number
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    {
      status,
    }
  );
}

/* =========================================================
   VALIDATION HELPERS
========================================================= */

function getString(
  value: unknown
): string | undefined {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return undefined;
  }

  return value.trim();
}

function getFiniteNumber(
  value: unknown
): number | null {
  const number =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  return number;
}

/* =========================================================
   ROUTE PARAMS
========================================================= */

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/* =========================================================
   POST ADJUSTMENT
========================================================= */

/**
 * POST /api/savings/transactions/[id]/adjust
 *
 * Creates a new adjustment transaction against
 * an existing savings transaction.
 *
 * IMPORTANT:
 *
 * The original transaction is NEVER edited.
 *
 * Example:
 *
 * Original:
 *   +1,000
 *
 * Correction:
 *   -200
 *
 * New ledger:
 *   +1,000
 *   -200
 *
 * Net effect:
 *   +800
 *
 * The adjustment amount is therefore signed.
 *
 * Positive amount:
 *   increases the savings balance.
 *
 * Negative amount:
 *   decreases the savings balance.
 */
export async function POST(
  request: Request,
  context: RouteContext
) {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const session =
      await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401
      );
    }

    /* -------------------------------------------------------
       ROUTE PARAMETER
    ------------------------------------------------------- */

    const params =
      await context.params;

    const transactionId =
      typeof params.id === "string"
        ? params.id.trim()
        : "";

    if (!transactionId) {
      return errorResponse(
        "Transaction ID is required.",
        400
      );
    }

    /* -------------------------------------------------------
       FIND ORIGINAL TRANSACTION
    ------------------------------------------------------- */

    const original =
      await getSavingsTransactionById(
        transactionId
      );

    if (!original) {
      return errorResponse(
        "Savings transaction not found.",
        404
      );
    }

    

    /* -------------------------------------------------------
       READ BODY
    ------------------------------------------------------- */

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return errorResponse(
        "Invalid JSON request body.",
        400
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return errorResponse(
        "Request body must be a JSON object.",
        400
      );
    }

    const payload =
      body as Record<
        string,
        unknown
      >;

    /* -------------------------------------------------------
       AMOUNT
    ------------------------------------------------------- */

    const amount =
      getFiniteNumber(
        payload.amount
      );

    if (amount === null) {
      return errorResponse(
        "Adjustment amount must be a valid number.",
        400
      );
    }

    if (amount === 0) {
      return errorResponse(
        "Adjustment amount cannot be zero.",
        400
      );
    }

    /* -------------------------------------------------------
       REASON
    ------------------------------------------------------- */

    const reason =
      getString(
        payload.reason
      );

    if (!reason) {
      return errorResponse(
        "Adjustment reason is required.",
        400
      );
    }

    /* -------------------------------------------------------
       RECORDED BY
    ------------------------------------------------------- */

    /**
     * Do not trust the client to identify who
     * performed the financial adjustment.
     *
     * The authenticated session is the source
     * of the operator identity.
     */
    const recordedBy =
      session.user.email
        ? {
            id:
              session.user.email,

            name:
              session.user.name ||
              session.user.email,

            email:
              session.user.email,
          }
        : undefined;

    /* -------------------------------------------------------
       BUILD INPUT
    ------------------------------------------------------- */

    const adjustment:
      CreateSavingsAdjustmentInput = {
      originalTransactionId:
        transactionId,

      amount,

      reason,

      recordedBy,
    };

    /* -------------------------------------------------------
       CREATE ADJUSTMENT
    ------------------------------------------------------- */

    const result =
      await createSavingsAdjustment(
        adjustment
      );

    /* -------------------------------------------------------
       RESPONSE
    ------------------------------------------------------- */

    return successResponse(
      result,
      201
    );
  } catch (error) {
    console.error(
      "POST /api/savings/transactions/[id]/adjust error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create savings adjustment.";

    /**
     * Known business-rule failures are client
     * errors rather than server failures.
     */
    const businessErrors = [
      "Original savings transaction not found.",
      "A reversed transaction cannot be adjusted.",
      "A reversal transaction cannot be adjusted.",
      "Savings account not found.",
      "Savings account is inactive.",
      "This transaction already has an adjustment.",
    ];

    const status =
      businessErrors.includes(message)
        ? 409
        : 400;

    return errorResponse(
      message,
      status
    );
  }
}

/* =========================================================
   BLOCK OTHER METHODS
========================================================= */

/**
 * Adjustments are created only through POST.
 */
export async function GET() {
  return errorResponse(
    "Use GET /api/savings/transactions/[id] to retrieve the transaction.",
    405
  );
}

export async function PUT() {
  return errorResponse(
    "Savings adjustments are immutable after creation.",
    405
  );
}

export async function PATCH() {
  return errorResponse(
    "Savings adjustments are immutable after creation.",
    405
  );
}

export async function DELETE() {
  return errorResponse(
    "Savings adjustments cannot be permanently deleted.",
    405
  );
}