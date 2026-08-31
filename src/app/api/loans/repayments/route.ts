import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  createLoanRepayment,
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
    { status },
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
    { status },
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
   ACTOR
========================================================= */

function getSessionActor(
  session: AuthenticatedSession,
) {
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
   POST /api/loans/repayments
========================================================= */

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
      getSessionActor(session);

    /* =====================================================
       PARSE BODY
    ===================================================== */

    let body: RepaymentRequest;

    try {
      const parsed =
        await request.json();

      if (
        typeof parsed !== "object" ||
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
      typeof body.loanId !== "string" ||
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
      body.amount === undefined ||
      body.amount === null ||
      body.amount === ""
    ) {
      return errorResponse(
        "Repayment amount is required.",
        400,
      );
    }

    const amount =
      typeof body.amount === "number"
        ? body.amount
        : Number(body.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return errorResponse(
        "Repayment amount must be greater than zero.",
        400,
      );
    }

    /*
     * Normalize to two decimal places.
     */
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

    /*
     * Prevent unsafe financial precision.
     */
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
       TRANSACTION REFERENCE
    ===================================================== */

    if (
      typeof body.transactionReference !==
        "string" ||
      !body.transactionReference.trim()
    ) {
      return errorResponse(
        "Transaction reference is required.",
        400,
      );
    }

    const transactionReference =
      body.transactionReference
        .trim()
        .toUpperCase();

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

    /*
     * Do not allow future transactions.
     *
     * The service must also enforce this rule.
     */
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
       SOURCE
    ===================================================== */

    const source =
      body.source === undefined
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
         * IMPORTANT:
         *
         * Actor is supplied by the authenticated
         * server session, never by the browser.
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

    /*
     * -----------------------------------------------------
     * KNOWN APPLICATION ERRORS
     * -----------------------------------------------------
     */

    if (
      error instanceof Error
    ) {
      const message =
        error.message;

      if (
        message.includes(
          "not found",
        ) ||
        message.includes(
          "does not exist",
        )
      ) {
        return errorResponse(
          message,
          404,
        );
      }

      if (
        message.includes(
          "already exists",
        ) ||
        message.includes(
          "already recorded",
        ) ||
        message.includes(
          "duplicate",
        )
      ) {
        return errorResponse(
          message,
          409,
        );
      }

      if (
        message.includes(
          "outstanding",
        ) ||
        message.includes(
          "exceed",
        ) ||
        message.includes(
          "active loan",
        ) ||
        message.includes(
          "cannot",
        ) ||
        message.includes(
          "required",
        ) ||
        message.includes(
          "invalid",
        ) ||
        message.includes(
          "Invalid",
        ) ||
        message.includes(
          "future",
        ) ||
        message.includes(
          "amount",
        )
      ) {
        return errorResponse(
          message,
          400,
        );
      }
    }

    /*
     * -----------------------------------------------------
     * GENERIC SERVER ERROR
     * -----------------------------------------------------
     */

    return errorResponse(
      "Unable to record the loan repayment.",
      500,
    );
  }
}