import { NextResponse } from "next/server";

import {
  processExpiredLoans,
} from "@/lib/loans/service";

function authorizeRequest(
  request: Request,
): void {
  const configuredSecret =
    process.env
      .LOAN_EXPIRY_API_SECRET;

  if (
    !configuredSecret
  ) {
    throw new Error(
      "LOAN_EXPIRY_API_SECRET is not configured.",
    );
  }

  const suppliedSecret =
    request.headers.get(
      "x-geoshua-loan-expiry-secret",
    );

  if (
    !suppliedSecret ||
    suppliedSecret !==
      configuredSecret
  ) {
    throw new Error(
      "UNAUTHORIZED_LOAN_EXPIRY_REQUEST",
    );
  }
}

export async function POST(
  request: Request,
) {
  try {
    authorizeRequest(
      request,
    );

    const suspendedMembers =
      await processExpiredLoans();

    return NextResponse.json(
      {
        success:
          true,

        suspendedMembers,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "LOAN_EXPIRY_API_SECRET is not configured."
    ) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "Loan expiry processor is not configured.",
        },
        {
          status: 500,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message ===
        "UNAUTHORIZED_LOAN_EXPIRY_REQUEST"
    ) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "Unauthorized.",
        },
        {
          status: 401,
        },
      );
    }

    console.error(
      "[GEO-SHUA LOAN EXPIRY] Failed:",
      error,
    );

    return NextResponse.json(
      {
        success:
          false,

        error:
          error instanceof Error
            ? error.message
            : "Failed to process expired loans.",
      },
      {
        status: 500,
      },
    );
  }
}
