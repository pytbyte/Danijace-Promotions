import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
  getSavingsTransactionById,
  reverseSavingsTransaction,
} from "@/lib/savings/service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ReverseRequestBody = {
  reason?: unknown;
};

const SACCO_ID = "geoshua";
const SACCO_NAME = "GEO-SHUA";

export async function POST(
  request: Request,
  context: RouteContext
) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized.",
        },
        {
          status: 401,
        }
      );
    }

    /* =====================================================
       GET TRANSACTION ID
    ===================================================== */

    const { id } = await context.params;

    if (
      typeof id !== "string" ||
      !id.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Transaction ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    const transactionId = id.trim();

    /* =====================================================
       PARSE REQUEST BODY
    ===================================================== */

    let body: ReverseRequestBody;

    try {
      body =
        (await request.json()) as ReverseRequestBody;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON request body.",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       VALIDATE REASON
    ===================================================== */

    if (
      typeof body.reason !== "string" ||
      !body.reason.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Reversal reason is required.",
        },
        {
          status: 400,
        }
      );
    }

    const reason = body.reason.trim();

    if (reason.length > 500) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Reversal reason must not exceed 500 characters.",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       GET ORIGINAL TRANSACTION
    ===================================================== */

    const original =
      await getSavingsTransactionById(
        transactionId
      );

    if (!original) {
      return NextResponse.json(
        {
          success: false,
          error: "Savings transaction not found.",
        },
        {
          status: 404,
        }
      );
    }

  

    /* =====================================================
       TRANSACTION STATUS PROTECTION
       
       The service performs these checks again.
       These checks simply allow us to return a clean
       API response before starting the database operation.
    ===================================================== */

    if (
      original.status === "reversed"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Transaction has already been reversed.",
        },
        {
          status: 409,
        }
      );
    }

    if (
      original.type === "reversal"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A reversal transaction cannot be reversed.",
        },
        {
          status: 409,
        }
      );
    }

    /* =====================================================
       RECORDED BY
       
       SavingsTransaction.recordedBy is an object,
       not a string.
    ===================================================== */

    const recordedBy = {
      email:
        session.user.email ||
        undefined,

      name:
        session.user.name ||
        undefined,
    };

    /* =====================================================
       CREATE REVERSAL
       
       IMPORTANT:
       
       We deliberately do NOT send an amount.
       
       The service calculates the exact opposite:
       
         +1000 -> -1000
         -300  -> +300
    ===================================================== */

    const reversal =
      await reverseSavingsTransaction({
        transactionId,

        reason,

        recordedBy,
      });

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json(
      {
        success: true,

        message:
          "Savings transaction reversed successfully.",

        saccoId: SACCO_ID,

        saccoName: SACCO_NAME,

        transaction: reversal,
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    /* =====================================================
       ERROR HANDLING
    ===================================================== */

    const message =
      error instanceof Error
        ? error.message
        : "Failed to reverse savings transaction.";

    /* -----------------------------------------------------
       BUSINESS CONFLICTS
    ----------------------------------------------------- */

    if (
      message.includes(
        "already been reversed"
      ) ||
      message.includes(
        "already has an adjustment"
      ) ||
      message.includes(
        "cannot be reversed"
      ) ||
      message.includes(
        "already been reversed"
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 409,
        }
      );
    }

    /* -----------------------------------------------------
       NOT FOUND
    ----------------------------------------------------- */

    if (
      message.includes(
        "transaction not found"
      ) ||
      message.includes(
        "transaction no longer exists"
      ) ||
      message.includes(
        "Savings transaction not found"
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 404,
        }
      );
    }

    /* -----------------------------------------------------
       ACCOUNT ERRORS
    ----------------------------------------------------- */

    if (
      message.includes(
        "Savings account not found"
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 404,
        }
      );
    }

    /* -----------------------------------------------------
       DEFAULT SERVER ERROR
    ----------------------------------------------------- */

    console.error(
      "POST /api/savings/transactions/[id]/reverse failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to reverse savings transaction.",
      },
      {
        status: 500,
      }
    );
  }
}