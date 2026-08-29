import { NextResponse } from "next/server";

import {
  auth,
} from "@/auth";

import {
  createSavingsDeposit,
  getSavingsTransactions,
  type GetSavingsTransactionsOptions,
  type CreateSavingsDepositInput,
} from "@/lib/savings/service";

import type {
  SavingsTransaction,
} from "@/lib/savings/types";

/* =========================================================
   FIXED SACCO
========================================================= */

const SACCO_ID = "geoshua";
const SACCO_NAME = "GEO-SHUA";

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
  return [
    "deposit",
    "adjustment",
    "reversal",
  ].includes(value);
}

function isSavingsTransactionSource(
  value: string
): value is SavingsTransaction["source"] {
  return [
    "mpesa",
    "bank",
    "cash",
    "sms",
    "system",
    "manual",
  ].includes(value);
}

function isSavingsTransactionStatus(
  value: string
): value is SavingsTransaction["status"] {
  return [
    "pending",
    "confirmed",
    "reversed",
  ].includes(value);
}

/* =========================================================
   GET
   GET /api/savings/transactions
========================================================= */

/**
 * Query parameters:
 *
 * page
 * limit
 * memberId
 * savingsAccountId
 * saccoId
 * type
 * source
 * status
 *
 * SACCO is fixed to GEO-SHUA for now.
 */
export async function GET(
  request: Request
) {
  try {
    /**
     * Require authentication.
     */
    const session = await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401
      );
    }

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

    const requestedSaccoId =
      getString(
        searchParams.get("saccoId")
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

    /**
     * At this stage there is only one SACCO.
     *
     * We deliberately ignore a different SACCO ID
     * supplied by the client instead of allowing the
     * client to query another SACCO.
     */
    const saccoId =
      requestedSaccoId &&
      requestedSaccoId !== SACCO_ID
        ? SACCO_ID
        : SACCO_ID;

    /**
     * Parse pagination.
     *
     * The service performs the final safety limits,
     * but we still normalize the values here.
     */
    const page =
      pageParam !== null
        ? Number(pageParam)
        : undefined;

    const limit =
      limitParam !== null
        ? Number(limitParam)
        : undefined;

    if (
      page !== undefined &&
      (
        !Number.isFinite(page) ||
        page < 1
      )
    ) {
      return errorResponse(
        "Invalid page number.",
        400
      );
    }

    if (
      limit !== undefined &&
      (
        !Number.isFinite(limit) ||
        limit < 1
      )
    ) {
      return errorResponse(
        "Invalid limit.",
        400
      );
    }

    /**
     * Validate transaction filters using the
     * actual SavingsTransaction types.
     *
     * This avoids the previous TS2339 issue where
     * optional properties were accessed through
     * GetSavingsTransactionsOptions | undefined.
     */
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

    /**
     * Build service options explicitly.
     */
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

    const result =
      await getSavingsTransactions(
        options
      );

    return successResponse(
      result
    );
  } catch (error) {
    console.error(
      "GET /api/savings/transactions error:",
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
 * Create a savings deposit.
 *
 * SACCO information is ALWAYS supplied by this
 * API rather than trusted from the client.
 *
 * Current SACCO:
 *
 * saccoId   = geoshua
 * saccoName = GEO-SHUA
 */
export async function POST(
  request: Request
) {
  try {
    /**
     * Require authentication.
     */
    const session = await auth();

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401
      );
    }

    /**
     * Parse request body.
     */
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

    /**
     * Required fields.
     */
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

    /**
     * Optional fields.
     */
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

    const transactionAt =
      getString(
        payload.transactionAt
      );

    /**
     * Validate transaction date if supplied.
     *
     * We do not silently convert invalid dates.
     */
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

    /**
     * recordedBy is deliberately built from the
     * authenticated session where possible.
     *
     * The service accepts a recordedBy object,
     * but we do not trust arbitrary client identity
     * information.
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

    /**
     * SACCO values are controlled by the API.
     *
     * The client cannot submit another SACCO.
     */
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

    /**
     * Service performs the authoritative checks:
     *
     * - account existence
     * - account ownership
     * - SACCO ownership
     * - account status
     * - transaction validation
     * - duplicate detection
     * - ledger insertion
     * - cached balance update
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
      "POST /api/savings/transactions error:",
      error
    );

    /**
     * Duplicate external transactions are handled
     * idempotently by the service and normally return
     * the existing transaction.
     */
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to create savings transaction.",
      400
    );
  }
}