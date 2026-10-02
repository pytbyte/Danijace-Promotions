import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

import clientPromise from "@/lib/mongodb";

/* =========================================================
   GEO-SHUA OVERPAID API

   Purpose:
   Persist money received above the remaining CORE loan
   balance.

   This endpoint is called AFTER createLoanRepayment()
   successfully commits its MongoDB transaction.

   IMPORTANT:

   The endpoint does NOT:
     - modify the loan
     - modify loan.amountPaid
     - modify fines
     - consume overpaid money
     - create another repayment

   It ONLY records the excess amount in the `overpaid`
   collection.
========================================================= */

export const runtime = "nodejs";

const DB_NAME =
  process.env.MONGODB_DB ||
  "geo-shua";

const COLLECTION_NAME =
  "overpaid";

/* =========================================================
   TYPES
========================================================= */

interface OverpaidRequestBody {
  loanId?: string;
  loanNumber?: string;

  memberId?: string;
  memberNumber?: string;

  repaymentId?: string;

  paymentAmount?: number;
  amount?: number;

  transactionReference?: string;

  transactionDate?: string;

  transactionAt?: string | Date;

  source?: string;
}

interface OverpaidDocument {
  _id: ObjectId;

  loanId: ObjectId;
  loanNumber: string;

  memberId: ObjectId;
  memberNumber: string;

  repaymentId: ObjectId;

  /*
   * Full amount received from the bank.
   */
  paymentAmount: number;

  /*
   * Amount above the loan's remaining CORE balance.
   */
  amount: number;

  transactionReference: string;

  transactionDate: string;

  transactionAt?: Date;

  source: string;

  createdAt: Date;
}

/* =========================================================
   MONEY NORMALIZATION
========================================================= */

function money(
  value: number,
): number {
  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return Math.round(
    value * 100,
  ) / 100;
}

/* =========================================================
   REQUIRED STRING
========================================================= */

function requiredString(
  value: unknown,
  field: string,
): string {
  if (
    typeof value !==
    "string"
  ) {
    throw new Error(
      `${field} is required.`,
    );
  }

  const result =
    value.trim();

  if (!result) {
    throw new Error(
      `${field} is required.`,
    );
  }

  return result;
}

/* =========================================================
   OBJECT ID
========================================================= */

function requiredObjectId(
  value: unknown,
  field: string,
): ObjectId {
  const text =
    requiredString(
      value,
      field,
    );

  if (
    !ObjectId.isValid(text)
  ) {
    throw new Error(
      `${field} is not a valid MongoDB ObjectId.`,
    );
  }

  return new ObjectId(text);
}

/* =========================================================
   CALENDAR DATE
========================================================= */

function assertCalendarDate(
  value: unknown,
): string {
  const date =
    requiredString(
      value,
      "transactionDate",
    );

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date,
    )
  ) {
    throw new Error(
      "transactionDate must use YYYY-MM-DD format.",
    );
  }

  /*
   * Verify that the date actually exists.
   */
  const [
    yearText,
    monthText,
    dayText,
  ] = date.split("-");

  const year =
    Number(yearText);

  const month =
    Number(monthText);

  const day =
    Number(dayText);

  const parsed =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  if (
    parsed.getUTCFullYear() !==
      year ||
    parsed.getUTCMonth() !==
      month - 1 ||
    parsed.getUTCDate() !==
      day
  ) {
    throw new Error(
      "transactionDate is not a valid calendar date.",
    );
  }

  return date;
}

/* =========================================================
   TRANSACTION TIMESTAMP
========================================================= */

function parseTransactionAt(
  value: unknown,
): Date | undefined {
  if (
    value ===
    undefined ||
    value ===
    null ||
    value ===
    ""
  ) {
    return undefined;
  }

  const parsed =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(
          String(value),
        );

  if (
    !Number.isFinite(
      parsed.getTime(),
    )
  ) {
    throw new Error(
      "transactionAt is invalid.",
    );
  }

  return parsed;
}

/* =========================================================
   PRIVATE SERVER-TO-SERVER AUTHENTICATION
========================================================= */

function authorizeRequest(
  request: Request,
): void {
  /*
   * This endpoint is called internally by the server after
   * createLoanRepayment() commits.
   *
   * Do NOT expose the endpoint as an unauthenticated public
   * financial write endpoint.
   *
   * Configure:
   *
   *   OVERPAID_API_SECRET
   *
   * in the server environment.
   */

  const configuredSecret =
    process.env
      .OVERPAID_API_SECRET;

  if (
    !configuredSecret
  ) {
    throw new Error(
      "OVERPAID_API_SECRET is not configured.",
    );
  }

  const suppliedSecret =
    request.headers.get(
      "x-geoshua-overpaid-secret",
    );

  if (
    !suppliedSecret ||
    suppliedSecret !==
      configuredSecret
  ) {
    throw new Error(
      "UNAUTHORIZED_OVERPAID_REQUEST",
    );
  }
}

/* =========================================================
   POST
========================================================= */

export async function POST(
  request: Request,
) {
  try {
    /* =====================================================
       AUTHENTICATION
    ===================================================== */

    try {
      authorizeRequest(
        request,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "OVERPAID_API_SECRET is not configured."
      ) {
        console.error(
          "[GEO-SHUA OVERPAID] Server secret is not configured.",
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Overpaid service is not configured.",
          },
          {
            status: 500,
          },
        );
      }

      return NextResponse.json(
        {
          success: false,
          error:
            "Unauthorized.",
        },
        {
          status: 401,
        },
      );
    }

    /* =====================================================
       CONTENT TYPE
    ===================================================== */

    const contentType =
      request.headers.get(
        "content-type",
      ) || "";

    if (
      !contentType
        .toLowerCase()
        .includes(
          "application/json",
        )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Content-Type must be application/json.",
        },
        {
          status: 415,
        },
      );
    }

    /* =====================================================
       REQUEST BODY
    ===================================================== */

    let body:
      OverpaidRequestBody;

    try {
      body =
        (await request.json()) as
          OverpaidRequestBody;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Request body must contain valid JSON.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       REQUIRED IDENTIFIERS
    ===================================================== */

    const loanId =
      requiredObjectId(
        body.loanId,
        "loanId",
      );

    const memberId =
      requiredObjectId(
        body.memberId,
        "memberId",
      );

    const repaymentId =
      requiredObjectId(
        body.repaymentId,
        "repaymentId",
      );

    const loanNumber =
      requiredString(
        body.loanNumber,
        "loanNumber",
      );

    const memberNumber =
      requiredString(
        body.memberNumber,
        "memberNumber",
      );

    const transactionReference =
      requiredString(
        body.transactionReference,
        "transactionReference",
      );

    const transactionDate =
      assertCalendarDate(
        body.transactionDate,
      );

    const source =
      requiredString(
        body.source,
        "source",
      );

    /* =====================================================
       AMOUNTS
    ===================================================== */

    if (
      typeof body.paymentAmount !==
      "number" ||
      !Number.isFinite(
        body.paymentAmount,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "paymentAmount must be a valid number.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof body.amount !==
      "number" ||
      !Number.isFinite(
        body.amount,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "amount must be a valid number.",
        },
        {
          status: 400,
        },
      );
    }

    const paymentAmount =
      money(
        body.paymentAmount,
      );

    const overpaidAmount =
      money(
        body.amount,
      );

    if (
      paymentAmount <= 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "paymentAmount must be greater than zero.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      overpaidAmount <= 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "amount must be greater than zero.",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * The overpaid amount can never be equal to or greater
     * than the full payment.
     */
    if (
      overpaidAmount >=
      paymentAmount
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Overpaid amount must be less than the full payment amount.",
        },
        {
          status: 400,
        },
      );
    }

    /* =====================================================
       TIMESTAMP
    ===================================================== */

    const transactionAt =
      parseTransactionAt(
        body.transactionAt,
      );

    /* =====================================================
       DATABASE
    ===================================================== */

    const client =
      await clientPromise;

    const db =
      client.db(DB_NAME);

    const overpaid =
      db.collection<OverpaidDocument>(
        COLLECTION_NAME,
      );

    /* =====================================================
       VERIFY SOURCE REPAYMENT EXISTS
       
       This prevents somebody from inserting an arbitrary
       overpaid record without a corresponding repayment.
    ===================================================== */

    const repayments =
      db.collection(
        "loanRepayments",
      );

    const repayment =
      await repayments.findOne({
        _id:
          repaymentId,

        loanId:
          loanId,

        memberId:
          memberId,

        transactionReference:
          transactionReference,
      });

    if (!repayment) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Source repayment was not found.",
        },
        {
          status: 409,
        },
      );
    }

    /* =====================================================
       VERIFY FULL PAYMENT AMOUNT
    ===================================================== */

    const repaymentAmount =
      money(
        Number(
          repayment.amount,
        ),
      );

    if (
      repaymentAmount !==
      paymentAmount
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "paymentAmount does not match the source repayment.",
        },
        {
          status: 409,
        },
      );
    }

    /* =====================================================
       IDEMPOTENCY

       repaymentId is the financial source transaction.

       Only ONE overpaid record may exist for a repayment.

       We check first for a friendly response and then rely
       on the unique MongoDB index for concurrency protection.
    ===================================================== */

    const existing =
      await overpaid.findOne({
        repaymentId:
          repaymentId,
      });

    if (existing) {
      /*
       * Same repayment + same amount:
       * already successfully persisted.
       */
      if (
        money(existing.amount) ===
        overpaidAmount
      ) {
        return NextResponse.json(
          {
            success: true,

            duplicate: true,

            message:
              "Overpaid amount was already recorded.",

            overpaid: {
              id:
                existing._id.toString(),

              loanId:
                existing.loanId.toString(),

              loanNumber:
                existing.loanNumber,

              memberId:
                existing.memberId.toString(),

              memberNumber:
                existing.memberNumber,

              repaymentId:
                existing.repaymentId.toString(),

              paymentAmount:
                existing.paymentAmount,

              amount:
                existing.amount,

              transactionReference:
                existing.transactionReference,

              transactionDate:
                existing.transactionDate,

              transactionAt:
                existing.transactionAt
                  ?.toISOString(),

              source:
                existing.source,

              createdAt:
                existing.createdAt.toISOString(),
            },
          },
          {
            status: 200,
          },
        );
      }

      /*
       * Same repayment but a different excess amount is
       * a financial conflict and MUST NOT be overwritten.
       */
      return NextResponse.json(
        {
          success: false,
          error:
            "Overpaid record already exists for this repayment with a different amount.",
        },
        {
          status: 409,
        },
      );
    }

    /* =====================================================
       BUILD DOCUMENT
    ===================================================== */

    const document:
      OverpaidDocument = {
      _id:
        new ObjectId(),

      loanId,

      loanNumber,

      memberId,

      memberNumber,

      repaymentId,

      paymentAmount,

      amount:
        overpaidAmount,

      transactionReference,

      transactionDate,

      ...(transactionAt
        ? {
            transactionAt,
          }
        : {}),

      source,

      createdAt:
        new Date(),
    };

    /* =====================================================
       INSERT

       The unique repaymentId index is created here.

       This makes concurrent duplicate POST requests safe.
    ===================================================== */

    try {
      await overpaid.createIndex(
        {
          repaymentId: 1,
        },
        {
          unique: true,
          name:
            "uniq_overpaid_repayment",
        },
      );

      await overpaid.createIndex(
        {
          memberId: 1,
          createdAt: -1,
        },
        {
          name:
            "overpaid_member_createdAt",
        },
      );

      await overpaid.createIndex(
        {
          loanId: 1,
          createdAt: -1,
        },
        {
          name:
            "overpaid_loan_createdAt",
        },
      );

      await overpaid.createIndex(
        {
          transactionReference: 1,
        },
        {
          name:
            "overpaid_transactionReference",
        },
      );

      await overpaid.insertOne(
        document,
      );
    } catch (error) {
      /*
       * Another request may have inserted the same
       * repayment between our initial findOne() and
       * insertOne().
       *
       * Re-read the document and return it as an idempotent
       * success when the amount matches.
       */
      const mongoError =
        error as {
          code?: number;
          keyPattern?: Record<
            string,
            unknown
          >;
        };

      if (
        mongoError.code ===
        11000
      ) {
        const concurrent =
          await overpaid.findOne({
            repaymentId:
              repaymentId,
          });

        if (
          concurrent &&
          money(
            concurrent.amount,
          ) ===
            overpaidAmount
        ) {
          return NextResponse.json(
            {
              success: true,

              duplicate: true,

              message:
                "Overpaid amount was already recorded.",

              overpaid: {
                id:
                  concurrent._id.toString(),

                loanId:
                  concurrent.loanId.toString(),

                loanNumber:
                  concurrent.loanNumber,

                memberId:
                  concurrent.memberId.toString(),

                memberNumber:
                  concurrent.memberNumber,

                repaymentId:
                  concurrent.repaymentId.toString(),

                paymentAmount:
                  concurrent.paymentAmount,

                amount:
                  concurrent.amount,

                transactionReference:
                  concurrent.transactionReference,

                transactionDate:
                  concurrent.transactionDate,

                transactionAt:
                  concurrent.transactionAt
                    ?.toISOString(),

                source:
                  concurrent.source,

                createdAt:
                  concurrent.createdAt.toISOString(),
              },
            },
            {
              status: 200,
            },
          );
        }

        return NextResponse.json(
          {
            success: false,
            error:
              "Overpaid record already exists with conflicting financial data.",
          },
          {
            status: 409,
          },
        );
      }

      throw error;
    }

    /* =====================================================
       SUCCESS
    ===================================================== */

    console.log(
      "[GEO-SHUA OVERPAID] Overpaid amount recorded.",
      {
        overpaidId:
          document._id.toString(),

        loanId:
          loanId.toString(),

        loanNumber,

        memberId:
          memberId.toString(),

        memberNumber,

        repaymentId:
          repaymentId.toString(),

        paymentAmount,

        overpaidAmount,

        transactionReference,
      },
    );

    return NextResponse.json(
      {
        success: true,

        duplicate: false,

        message:
          "Overpaid amount recorded successfully.",

        overpaid: {
          id:
            document._id.toString(),

          loanId:
            loanId.toString(),

          loanNumber,

          memberId:
            memberId.toString(),

          memberNumber,

          repaymentId:
            repaymentId.toString(),

          paymentAmount,

          amount:
            overpaidAmount,

          transactionReference,

          transactionDate,

          transactionAt:
            transactionAt
              ?.toISOString(),

          source,

          createdAt:
            document.createdAt.toISOString(),
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "[GEO-SHUA OVERPAID] Unexpected endpoint error.",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to record overpaid amount.",
      },
      {
        status: 500,
      },
    );
  }
}
