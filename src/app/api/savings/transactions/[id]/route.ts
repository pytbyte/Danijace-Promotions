import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  getSavingsTransactionById,
} from "@/lib/savings/service";

/* =========================================================
   FIXED SACCO
========================================================= */

const SACCO_ID = "danijace";

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
   PARAM TYPES
========================================================= */

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/* =========================================================
   GET SINGLE TRANSACTION
========================================================= */

/**
 * GET /api/savings/transactions/[id]
 *
 * Returns one savings transaction.
 *
 * The transaction is read-only through this route.
 *
 * IMPORTANT:
 *
 * Financial transactions are immutable.
 *
 * This route does NOT provide:
 *
 * - PUT
 * - PATCH
 * - DELETE
 *
 * Corrections must use the dedicated adjustment
 * or reversal endpoints.
 */
export async function GET(
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
       GET TRANSACTION
    ------------------------------------------------------- */

    const transaction =
      await getSavingsTransactionById(
        transactionId
      );

    if (!transaction) {
      return errorResponse(
        "Savings transaction not found.",
        404
      );
    }

   

    /* -------------------------------------------------------
       RESPONSE
    ------------------------------------------------------- */

    return successResponse(
      transaction
    );
  } catch (error) {
    console.error(
      "GET /api/savings/transactions/[id] error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to retrieve savings transaction.",
      500
    );
  }
}

/* =========================================================
   BLOCK DIRECT UPDATE
========================================================= */

/**
 * PUT is deliberately not supported.
 *
 * Savings transactions are immutable financial records.
 */
export async function PUT() {
  return errorResponse(
    "Savings transactions are immutable. Use an adjustment or reversal operation instead.",
    405
  );
}

/* =========================================================
   BLOCK PARTIAL UPDATE
========================================================= */

/**
 * PATCH is deliberately not supported.
 *
 * Existing transaction amounts and financial data
 * must never be edited directly.
 */
export async function PATCH() {
  return errorResponse(
    "Savings transactions are immutable. Use an adjustment or reversal operation instead.",
    405
  );
}

/* =========================================================
   BLOCK DELETE
========================================================= */

/**
 * DELETE is deliberately not supported.
 *
 * Financial records must never be permanently deleted.
 */
export async function DELETE() {
  return errorResponse(
    "Savings transactions cannot be permanently deleted.",
    405
  );
}