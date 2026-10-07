import { NextResponse } from "next/server";

import { auth } from "@/auth";

/**
 * =========================================================
 * DANIJACE PROMOTIONS
 * UNIFIED CURRENT USER API
 * =========================================================
 *
 * GET /api/me
 *
 * PURPOSE
 * ---------------------------------------------------------
 *
 * Returns the authenticated user's complete dashboard view
 * through one request.
 *
 * The client should NOT need to independently request:
 *
 *   /api/account
 *   /api/members
 *   /api/loans
 *   /api/loans/repayments
 *   /api/loans/settings
 *   /api/savings/accounts
 *   /api/savings/summary
 *   /api/savings/transactions
 *
 * SECURITY
 * ---------------------------------------------------------
 *
 * Identity comes from the authenticated NextAuth session.
 *
 * The client cannot provide:
 *
 *   ?memberId=...
 *
 * to select another member.
 *
 * =========================================================
 */

const NO_STORE_HEADERS = {
  "Cache-Control":
    "private, no-store, no-cache, must-revalidate",
};

/* =========================================================
   TYPES
========================================================= */

type AuthenticatedSession = {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
};

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function successResponse<T>(
  data: T,
): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    {
      status: 200,
      headers: NO_STORE_HEADERS,
    },
  );
}

function errorResponse(
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

/* =========================================================
   SESSION IDENTITY
========================================================= */

function getSessionIdentity(
  session: AuthenticatedSession,
) {
  const name =
    typeof session.user?.name === "string"
      ? session.user.name.trim()
      : "";

  const email =
    typeof session.user?.email === "string"
      ? session.user.email.trim().toLowerCase()
      : "";

  if (!email) {
    throw new Error(
      "Authenticated user does not have a valid email address.",
    );
  }

  return {
    name,
    email,
    image:
      typeof session.user?.image === "string"
        ? session.user.image.trim()
        : null,
  };
}

/* =========================================================
   INTERNAL FETCH
========================================================= */

/**
 * IMPORTANT
 * ---------------------------------------------------------
 *
 * This helper exists only as a temporary compatibility
 * layer while the underlying services are consolidated.
 *
 * It forwards the authenticated session cookies when
 * calling another internal API route.
 *
 * No memberId is accepted from the client.
 */
async function internalGet(
  request: Request,
  path: string,
): Promise<unknown> {
  const url =
    new URL(
      path,
      request.url,
    );

  const cookie =
    request.headers.get("cookie");

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json",

          ...(cookie
            ? {
                Cookie: cookie,
              }
            : {}),
        },

        cache: "no-store",

        credentials: "include",
      },
    );

  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(
      extractError(
        body,
        `Request to ${path} failed with HTTP ${response.status}.`,
      ),
    );
  }

  return body;
}

/* =========================================================
   ERROR EXTRACTION
========================================================= */

function extractError(
  value: unknown,
  fallback: string,
): string {
  if (
    typeof value === "object" &&
    value !== null
  ) {
    const record =
      value as Record<string, unknown>;

    if (
      typeof record.error === "string" &&
      record.error.trim()
    ) {
      return record.error;
    }

    if (
      typeof record.message === "string" &&
      record.message.trim()
    ) {
      return record.message;
    }
  }

  return fallback;
}

/* =========================================================
   GET /api/me
========================================================= */

export async function GET(
  request: Request,
): Promise<NextResponse> {
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
       IDENTITY
    ------------------------------------------------------- */

    const identity =
      getSessionIdentity(session);

    /*
     * The authenticated email is the only identity supplied
     * to the unified view.
     */
    const email =
      encodeURIComponent(
        identity.email,
      );

    /* -------------------------------------------------------
       LOAD ACCOUNT + MEMBER
    ------------------------------------------------------- */

    const account =
      await internalGet(
        request,
        "/api/account",
      );

    /*
     * /api/members already authenticates the request.
     *
     * We search using the authenticated email rather than
     * allowing the browser to choose a memberId.
     */
    const members =
      await internalGet(
        request,
        `/api/members?search=${email}&page=1&limit=10`,
      );

    /* -------------------------------------------------------
       RESOLVE MEMBER
    ------------------------------------------------------- */

    let member: unknown = null;

    if (
      typeof members === "object" &&
      members !== null
    ) {
      const result =
        members as Record<string, unknown>;

      const data =
        Array.isArray(result.data)
          ? result.data
          : [];

      /*
       * Search results can contain several matches.
       *
       * Prefer an exact email match.
       */
      member =
        data.find(
          (item) => {
            if (
              typeof item !== "object" ||
              item === null
            ) {
              return false;
            }

            const record =
              item as Record<string, unknown>;

            return (
              typeof record.email === "string" &&
              record.email
                .trim()
                .toLowerCase() ===
                identity.email
            );
          },
        ) ?? null;
    }

    /* -------------------------------------------------------
       MEMBER ID
    ------------------------------------------------------- */

    let memberId: string | null = null;

    if (
      typeof member === "object" &&
      member !== null
    ) {
      const record =
        member as Record<string, unknown>;

      if (
        typeof record._id === "string" &&
        record._id.trim()
      ) {
        memberId =
          record._id.trim();
      } else if (
        typeof record.id === "string" &&
        record.id.trim()
      ) {
        memberId =
          record.id.trim();
      }
    }

    /* -------------------------------------------------------
       BASE EMPTY VIEW
    ------------------------------------------------------- */

    let loans: unknown = [];
    let loanRepayments: unknown = [];
    let loanSettings: unknown = null;

    let savingsAccount: unknown = null;
    let savingsSummary: unknown = null;
    let savingsTransactions: unknown = [];

    /* -------------------------------------------------------
       MEMBER-DEPENDENT DATA
    ------------------------------------------------------- */

    if (memberId) {
      const encodedMemberId =
        encodeURIComponent(
          memberId,
        );

      /*
       * These requests are independent and therefore run
       * concurrently.
       *
       * This is considerably faster than sequential requests.
       */
      const [
        loansResult,
        repaymentsResult,
        savingsAccountResult,
        savingsTransactionsResult,
      ] =
        await Promise.all([
          internalGet(
            request,
            `/api/loans?memberId=${encodedMemberId}&page=1&limit=25`,
          ),

          internalGet(
            request,
            `/api/loans/repayments?memberId=${encodedMemberId}`,
          ),

          internalGet(
            request,
            `/api/savings/accounts?memberId=${encodedMemberId}`,
          ),

          internalGet(
            request,
            `/api/savings/transactions?memberId=${encodedMemberId}&page=1&limit=25`,
          ),
        ]);

      loans =
        loansResult;

      loanRepayments =
        repaymentsResult;

      savingsAccount =
        savingsAccountResult;

      savingsTransactions =
        savingsTransactionsResult;
    }

    /* -------------------------------------------------------
       GLOBAL DATA
    ------------------------------------------------------- */

    /*
     * These endpoints are already authenticated and represent
     * the current user's SACCO-level financial configuration.
     */
    const [
      loanSettingsResult,
      savingsSummaryResult,
    ] =
      await Promise.all([
        internalGet(
          request,
          "/api/loans/settings",
        ),

        internalGet(
          request,
          "/api/savings/summary",
        ),
      ]);

    loanSettings =
      loanSettingsResult;

    savingsSummary =
      savingsSummaryResult;

    /* -------------------------------------------------------
       RESPONSE
    ------------------------------------------------------- */

    return successResponse({
      account,

      user: {
        name:
          identity.name,
        email:
          identity.email,
        image:
          identity.image,
      },

      member,

      loans,

      loanRepayments,

      loanSettings,

      savings: {
        account:
          savingsAccount,

        summary:
          savingsSummary,

        transactions:
          savingsTransactions,
      },
    });

  } catch (error) {
    console.error(
      "GET /api/me error:",
      error,
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to load user dashboard data.",
      500,
    );
  }
}
