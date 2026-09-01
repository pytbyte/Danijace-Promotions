import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  createLoanRepayment,
  getLoanById,
  getLoanRepayments,
} from "@/lib/loans/service";

import type {
  TransactionSource,
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
   SESSION
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

function getSessionActor(
  session: AuthenticatedSession,
) {
  const name =
    typeof session?.user?.name ===
    "string"
      ? session.user.name.trim()
      : "";

  const email =
    typeof session?.user?.email ===
    "string"
      ? session.user.email
          .trim()
          .toLowerCase()
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
   REQUEST TYPE
========================================================= */

type RepaymentRequest = {
  loanId?: unknown;
  amount?: unknown;
  transactionReference?: unknown;
  transactionDate?: unknown;
  source?: unknown;
  rawMessage?: unknown;
};

/* =========================================================
   REFERENCE
========================================================= */

/**
 * Generate an internal reference when a manual/system
 * repayment does not provide one.
 *
 * IMPORTANT:
 *
 * The reference is still stored because the financial
 * service requires a unique transaction identity.
 *
 * The user does NOT have to type it.
 */
function generateInternalReference(
  source: TransactionSource,
): string {
  const prefix =
    source === "sms"
      ? "SMS"
      : source === "system"
        ? "SYS"
        : "MAN";

  return `${prefix}-${Date.now()}-${randomUUID()}`;
}

/* =========================================================
   GET /api/loans/repayments?loanId=...
========================================================= */

/**
 * Return the immutable repayment ledger for one loan.
 *
 * This endpoint ONLY reads repayment history.
 *
 * It does not:
 *
 * - modify the loan
 * - create repayments
 * - change balances
 * - recalculate financial state
 */
export async function GET(
  request: Request,
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

    const url =
      new URL(request.url);

    const loanId =
      url.searchParams
        .get("loanId")
        ?.trim() || "";

    if (!loanId) {
      return errorResponse(
        "Loan ID is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       VERIFY LOAN EXISTS
    ------------------------------------------------------- */

    const loan =
      await getLoanById(
        loanId,
      );

    if (!loan) {
      return errorResponse(
        "Loan not found.",
        404,
      );
    }

    /* -------------------------------------------------------
       GET REPAYMENTS
    ------------------------------------------------------- */

    const repayments =
      await getLoanRepayments(
        loanId,
      );

    /* -------------------------------------------------------
       RESPONSE
    ------------------------------------------------------- */

    return NextResponse.json(
      {
        success: true,

        data:
          repayments,

        loan: {
          id:
            loan.id,

          loanNumber:
            loan.loanNumber,

          memberId:
            loan.memberId,

          memberName:
            loan.memberName,

          principal:
            loan.principal,

          totalDue:
            loan.totalDue,

          amountPaid:
            loan.amountPaid,

          totalFines:
            loan.totalFines,

          outstandingBalance:
            loan.outstandingBalance,

          status:
            loan.status,
        },

        count:
          repayments.length,
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
      "GET /api/loans/repayments error:",
      error,
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to retrieve loan repayment history.",
      500,
    );
  }
}

/* =========================================================
   POST /api/loans/repayments
========================================================= */

/**
 * Record a new immutable loan repayment.
 *
 * REFERENCE RULE
 * ---------------------------------------------------------
 *
 * Manual/system:
 *   reference is optional.
 *   The server generates one when missing.
 *
 * SMS:
 *   reference is required because it comes from the bank
 *   and is the real external transaction identity.
 */
export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const session =
      (await auth()) as AuthenticatedSession | null;

    if (!session?.user) {
      return errorResponse(
        "Authentication required.",
        401,
      );
    }

    const actor =
      getSessionActor(
        session,
      );

    /* =====================================================
       PARSE BODY
    ===================================================== */

    let body: RepaymentRequest;

    try {
      const parsed =
        await request.json();

      if (
        typeof parsed !==
          "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return errorResponse(
          "Request body must be a JSON object.",
          400,
        );
      }

      body =
        parsed as RepaymentRequest;
    } catch {
      return errorResponse(
        "Request body must be valid JSON.",
        400,
      );
    }

    /* =====================================================
       LOAN ID
    ===================================================== */

    if (
      typeof body.loanId !==
        "string" ||
      !body.loanId.trim()
    ) {
      return errorResponse(
        "Loan ID is required.",
        400,
      );
    }

    const loanId =
      body.loanId.trim();

    /* =====================================================
       AMOUNT
    ===================================================== */

    if (
      body.amount ===
        undefined ||
      body.amount ===
        null ||
      body.amount === ""
    ) {
      return errorResponse(
        "Repayment amount is required.",
        400,
      );
    }

    const amount =
      typeof body.amount ===
        "number"
        ? body.amount
        : Number(
            body.amount,
          );

    if (
      !Number.isFinite(
        amount,
      ) ||
      amount <= 0
    ) {
      return errorResponse(
        "Repayment amount must be greater than zero.",
        400,
      );
    }

    /* -------------------------------------------------------
       TWO DECIMAL PLACES
    ------------------------------------------------------- */

    const normalizedAmount =
      Math.round(
        amount * 100,
      ) / 100;

    if (
      !Number.isFinite(
        normalizedAmount,
      ) ||
      normalizedAmount <= 0
    ) {
      return errorResponse(
        "Invalid repayment amount.",
        400,
      );
    }

    /* -------------------------------------------------------
       SAFE FINANCIAL RANGE
    ------------------------------------------------------- */

    if (
      !Number.isSafeInteger(
        Math.round(
          normalizedAmount * 100,
        ),
      )
    ) {
      return errorResponse(
        "Repayment amount is outside the supported financial range.",
        400,
      );
    }

    /* =====================================================
       SOURCE
    ===================================================== */

    const source =
      body.source ===
      undefined
        ? "manual"
        : body.source;

    if (
      source !== "manual" &&
      source !== "sms" &&
      source !== "system"
    ) {
      return errorResponse(
        "Invalid payment source.",
        400,
      );
    }

    const transactionSource =
      source as TransactionSource;

    /* =====================================================
       TRANSACTION REFERENCE
       
       OPTIONAL FOR MANUAL/SYSTEM
       REQUIRED FOR SMS
    ===================================================== */

    let transactionReference =
      "";

    if (
      body.transactionReference !==
        undefined &&
      body.transactionReference !==
        null
    ) {
      if (
        typeof body.transactionReference !==
        "string"
      ) {
        return errorResponse(
          "Transaction reference must be a string.",
          400,
        );
      }

      transactionReference =
        body.transactionReference
          .trim()
          .toUpperCase();
    }

    /*
     * SMS payments MUST preserve the bank reference.
     */
    if (
      transactionSource ===
        "sms" &&
      !transactionReference
    ) {
      return errorResponse(
        "Bank transaction reference is required for an SMS repayment.",
        400,
      );
    }

    /*
     * Manual/system repayments do not require the user
     * to enter a reference.
     *
     * The server creates an internal unique identity.
     */
    if (
      !transactionReference
    ) {
      transactionReference =
        generateInternalReference(
          transactionSource,
        );
    }

    /* =====================================================
       TRANSACTION DATE
    ===================================================== */

    if (
      typeof body.transactionDate !==
        "string" ||
      !body.transactionDate.trim()
    ) {
      return errorResponse(
        "Transaction date is required.",
        400,
      );
    }

    const transactionDate =
      new Date(
        body.transactionDate,
      );

    if (
      Number.isNaN(
        transactionDate.getTime(),
      )
    ) {
      return errorResponse(
        "Invalid transaction date.",
        400,
      );
    }

    /* -------------------------------------------------------
       FUTURE DATE PROTECTION
    ------------------------------------------------------- */

    const futureTolerance =
      5 * 60 * 1000;

    if (
      transactionDate.getTime() >
      Date.now() +
        futureTolerance
    ) {
      return errorResponse(
        "Transaction date cannot be in the future.",
        400,
      );
    }

    /* =====================================================
       RAW SMS
    ===================================================== */

    let rawMessage:
      | string
      | undefined;

    if (
      body.rawMessage !==
        undefined &&
      body.rawMessage !==
        null
    ) {
      if (
        typeof body.rawMessage !==
        "string"
      ) {
        return errorResponse(
          "Raw SMS message must be a string.",
          400,
        );
      }

      const cleaned =
        body.rawMessage.trim();

      if (cleaned) {
        rawMessage =
          cleaned;
      }
    }

    /*
     * SMS repayments must preserve the original bank
     * message for auditability.
     */
    if (
      transactionSource ===
        "sms" &&
      !rawMessage
    ) {
      return errorResponse(
        "Original SMS message is required for an SMS repayment.",
        400,
      );
    }

    /* =====================================================
       CREATE REPAYMENT
    ===================================================== */

    const repayment =
      await createLoanRepayment({
        loanId,

        amount:
          normalizedAmount,

        transactionReference,

        transactionDate,

        source:
          transactionSource,

        /*
         * Actor always comes from the authenticated
         * server session.
         */
        recordedBy:
          actor,

        ...(rawMessage
          ? {
              rawMessage,
            }
          : {}),
      });

    /* =====================================================
       SUCCESS
    ===================================================== */

    return successResponse(
      repayment,
      201,
    );
  } catch (error) {
    console.error(
      "POST /api/loans/repayments failed:",
      error,
    );

    if (
      error instanceof Error
    ) {
      const message =
        error.message;

      const lower =
        message.toLowerCase();

      /* ---------------------------------------------------
         NOT FOUND
      --------------------------------------------------- */

      if (
        lower.includes(
          "not found",
        ) ||
        lower.includes(
          "does not exist",
        )
      ) {
        return errorResponse(
          message,
          404,
        );
      }

      /* ---------------------------------------------------
         DUPLICATE
      --------------------------------------------------- */

      if (
        lower.includes(
          "already exists",
        ) ||
        lower.includes(
          "already recorded",
        ) ||
        lower.includes(
          "duplicate",
        ) ||
        lower.includes(
          "different financial transaction",
        )
      ) {
        return errorResponse(
          message,
          409,
        );
      }

      /* ---------------------------------------------------
         VALIDATION / DOMAIN
      --------------------------------------------------- */

      if (
        lower.includes(
          "outstanding",
        ) ||
        lower.includes(
          "exceed",
        ) ||
        lower.includes(
          "active loan",
        ) ||
        lower.includes(
          "cancelled",
        ) ||
        lower.includes(
          "completed",
        ) ||
        lower.includes(
          "cannot",
        ) ||
        lower.includes(
          "required",
        ) ||
        lower.includes(
          "invalid",
        ) ||
        lower.includes(
          "future",
        ) ||
        lower.includes(
          "amount",
        ) ||
        lower.includes(
          "transaction date",
        )
      ) {
        return errorResponse(
          message,
          400,
        );
      }
    }

    /* ---------------------------------------------------
       GENERIC SERVER ERROR
    --------------------------------------------------- */

    return errorResponse(
      "Unable to record the loan repayment.",
      500,
    );
  }
}
