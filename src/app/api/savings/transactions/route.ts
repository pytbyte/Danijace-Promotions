/**
 * =========================================================
 * DANIJACE PROMOTIONS
 * SAVINGS TRANSACTIONS API
 * =========================================================
 *
 * GET  /api/savings/transactions
 * POST /api/savings/transactions
 *
 * Production savings transaction API.
 *
 * IMPORTANT:
 * ---------------------------------------------------------
 * - Savings has NO saccoId.
 * - POST creates DEPOSITS only.
 * - Deposit amounts must always be positive.
 * - Adjustments and reversals are handled by their
 *   dedicated domain operations.
 * - Financial validation belongs to the savings service.
 * - Authentication is required for every operation.
 * - Client-supplied identity is never trusted for recordedBy.
 *
 * Ledger conventions:
 *
 *   deposit    = positive
 *   adjustment = signed delta
 *   reversal   = negative
 *
 * The savings service remains responsible for:
 *
 *   - account existence
 *   - account ownership
 *   - member ownership
 *   - account status
 *   - duplicate detection
 *   - ledger insertion
 *   - balance update
 *   - financial invariants
 *
 * =========================================================
 */

import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  createSavingsDeposit,
  getSavingsTransactions,
  type CreateSavingsDepositInput,
  type GetSavingsTransactionsOptions,
} from "@/lib/savings/service";

import type {
  SavingsTransaction,
} from "@/lib/savings/types";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

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
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

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
      headers: {
        "Cache-Control": "no-store",
      },
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

function getPositiveAmount(
  value: unknown
): number | null {
  const amount =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return amount;
}

function isSavingsTransactionType(
  value: string
): value is SavingsTransaction["type"] {
  return (
    value === "deposit" ||
    value === "adjustment" ||
    value === "reversal"
  );
}

function isSavingsTransactionSource(
  value: string
): value is SavingsTransaction["source"] {
  return (
    value === "mpesa" ||
    value === "bank" ||
    value === "cash" ||
    value === "sms" ||
    value === "system" ||
    value === "manual"
  );
}

function isSavingsTransactionStatus(
  value: string
): value is SavingsTransaction["status"] {
  return (
    value === "pending" ||
    value === "confirmed" ||
    value === "reversed"
  );
}

/* =========================================================
   GET
   GET /api/savings/transactions
========================================================= */

/**
 * Supported query parameters:
 *
 * page
 * limit
 * memberId
 * savingsAccountId
 * type
 * source
 * status
 *
 * NOTE:
 * ---------------------------------------------------------
 * There is intentionally NO saccoId filter.
 *
 * Savings currently belongs to the DANIJACE PROMOTIONS application
 * and the savings domain does not contain saccoId.
 */
export async function GET(
  request: Request
) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const session =
      await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401
      );
    }

    /* =====================================================
       QUERY PARAMETERS
    ===================================================== */

    const { searchParams } =
      new URL(request.url);

    const pageParam =
      searchParams.get("page");

    const limitParam =
      searchParams.get("limit");

    const memberId =
      getString(
        searchParams.get("memberId")
      );

    const savingsAccountId =
      getString(
        searchParams.get(
          "savingsAccountId"
        )
      );

    const typeParam =
      getString(
        searchParams.get("type")
      );

    const sourceParam =
      getString(
        searchParams.get("source")
      );

    const statusParam =
      getString(
        searchParams.get("status")
      );

    /* =====================================================
       PAGINATION
    ===================================================== */

    let page:
      number | undefined;

    if (pageParam !== null) {
      page = Number(pageParam);

      if (
        !Number.isInteger(page) ||
        page < 1
      ) {
        return errorResponse(
          "Invalid page number.",
          400
        );
      }
    }

    let limit:
      number | undefined;

    if (limitParam !== null) {
      limit = Number(limitParam);

      if (
        !Number.isInteger(limit) ||
        limit < 1
      ) {
        return errorResponse(
          "Invalid limit.",
          400
        );
      }
    }

    /* =====================================================
       TRANSACTION TYPE
    ===================================================== */

    let type:
      SavingsTransaction["type"] |
      undefined;

    if (typeParam) {
      if (
        !isSavingsTransactionType(
          typeParam
        )
      ) {
        return errorResponse(
          "Invalid transaction type.",
          400
        );
      }

      type = typeParam;
    }

    /* =====================================================
       TRANSACTION SOURCE
    ===================================================== */

    let source:
      SavingsTransaction["source"] |
      undefined;

    if (sourceParam) {
      if (
        !isSavingsTransactionSource(
          sourceParam
        )
      ) {
        return errorResponse(
          "Invalid transaction source.",
          400
        );
      }

      source = sourceParam;
    }

    /* =====================================================
       TRANSACTION STATUS
    ===================================================== */

    let status:
      SavingsTransaction["status"] |
      undefined;

    if (statusParam) {
      if (
        !isSavingsTransactionStatus(
          statusParam
        )
      ) {
        return errorResponse(
          "Invalid transaction status.",
          400
        );
      }

      status = statusParam;
    }

    /* =====================================================
       SERVICE OPTIONS
    ===================================================== */

    const options:
      GetSavingsTransactionsOptions = {
      page,
      limit,
      memberId,
      savingsAccountId,
      type,
      source,
      status,
    };

    /* =====================================================
       FETCH TRANSACTIONS
    ===================================================== */

    const result =
      await getSavingsTransactions(
        options
      );

    return successResponse(
      result
    );
  } catch (error) {
    console.error(
      "[GET /api/savings/transactions]",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to retrieve savings transactions.",
      500
    );
  }
}

/* =========================================================
   POST
   POST /api/savings/transactions
========================================================= */

/**
 * Create a savings DEPOSIT.
 *
 * This endpoint intentionally creates deposits only.
 *
 * Do NOT use this endpoint to create:
 *
 *   - adjustments
 *   - withdrawals
 *   - reversals
 *
 * Those operations must go through their dedicated
 * domain operations so that their financial invariants
 * cannot be bypassed.
 */
export async function POST(
  request: Request
) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const session =
      await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401
      );
    }

    /* =====================================================
       REQUEST BODY
    ===================================================== */

    let body: unknown;

    try {
      body = await request.json();
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

    /* =====================================================
       SAVINGS ACCOUNT
    ===================================================== */

    const savingsAccountId =
      getString(
        payload.savingsAccountId
      );

    if (!savingsAccountId) {
      return errorResponse(
        "Savings account ID is required.",
        400
      );
    }

    /* =====================================================
       MEMBER
    ===================================================== */

    const memberId =
      getString(
        payload.memberId
      );

    if (!memberId) {
      return errorResponse(
        "Member ID is required.",
        400
      );
    }

    const memberName =
      getString(
        payload.memberName
      );

    if (!memberName) {
      return errorResponse(
        "Member name is required.",
        400
      );
    }

    /* =====================================================
       AMOUNT
    ===================================================== */

    const amount =
      getPositiveAmount(
        payload.amount
      );

    if (amount === null) {
      return errorResponse(
        "Savings amount must be greater than zero.",
        400
      );
    }

    /* =====================================================
       SOURCE
    ===================================================== */

    const source =
      getString(
        payload.source
      );

    if (!source) {
      return errorResponse(
        "Savings source is required.",
        400
      );
    }

    if (
      !isSavingsTransactionSource(
        source
      )
    ) {
      return errorResponse(
        "Invalid savings transaction source.",
        400
      );
    }

    /* =====================================================
       OPTIONAL EXTERNAL REFERENCES
    ===================================================== */

    const reference =
      getString(
        payload.reference
      );

    const smsId =
      getString(
        payload.smsId
      );

    const sourceReference =
      getString(
        payload.sourceReference
      );

    /* =====================================================
       TRANSACTION DATE
    ===================================================== */

    const transactionAt =
      getString(
        payload.transactionAt
      );

    if (transactionAt) {
      const parsedDate =
        new Date(transactionAt);

      if (
        Number.isNaN(
          parsedDate.getTime()
        )
      ) {
        return errorResponse(
          "Invalid transaction date.",
          400
        );
      }
    }

    /* =====================================================
       RECORDED BY
    ===================================================== */

    /*
     * Never trust recordedBy from the client.
     *
     * The authenticated session is the source of identity.
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

    /* =====================================================
       DEPOSIT INPUT
    ===================================================== */

    const deposit:
      CreateSavingsDepositInput = {
      savingsAccountId,
      memberId,
      memberName,
      amount,
      source,
      reference,
      smsId,
      sourceReference,
      transactionAt,
      recordedBy,
    };

    /* =====================================================
       CREATE DEPOSIT
    ===================================================== */

    /*
     * The service is authoritative.
     *
     * It must verify:
     *
     *   - account exists
     *   - account belongs to member
     *   - account is active
     *   - member exists
     *   - duplicate transaction does not exist
     *   - ledger entry is valid
     *   - cached balance is updated correctly
     */
    const transaction =
      await createSavingsDeposit(
        deposit
      );

    return successResponse(
      transaction,
      201
    );
  } catch (error) {
    console.error(
      "[POST /api/savings/transactions]",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to create savings transaction.",
      400
    );
  }
}