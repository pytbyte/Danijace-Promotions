import {
  NextRequest,
  NextResponse,
} from "next/server";

import { auth } from "@/auth";

import clientPromise from "@/lib/mongodb";

/* =========================================================
   DATABASE
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB ||
  "geo-shua";

const COLLECTION_NAME =
  "authorizedEmails";

/* =========================================================
   TYPES
========================================================= */

type AuthenticatedSession = {
  user?: {
    email?: string | null;
  } | null;
};

type AuthorizedEmailDocument = {
  email: string;
  createdAt: Date;
};

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function successResponse(
  data: unknown,
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
   EMAIL NORMALIZATION
========================================================= */

function normalizeEmail(
  value: unknown,
): string {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .toLowerCase();
}

/* =========================================================
   EMAIL VALIDATION
========================================================= */

function isValidEmail(
  email: string,
): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email,
  );
}

/* =========================================================
   DUPLICATE KEY DETECTION
========================================================= */

function isDuplicateKeyError(
  error: unknown,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (
      error as {
        code?: unknown;
      }
    ).code === 11000
  );
}

/* =========================================================
   POST /api/access/emails
========================================================= */

/**
 * Add an authorized email.
 *
 * SECURITY MODEL
 * ------------------------------------------------------------------
 *
 * 1. The caller must have a valid NextAuth session.
 * 2. The caller's email comes ONLY from the server-side session.
 * 3. The caller must already exist in authorizedEmails.
 * 4. The submitted email is normalized and validated.
 * 5. The database has a unique index on normalized email.
 *
 * The email supplied in the request body is NEVER used to
 * authenticate the caller.
 */
export async function POST(
  request: NextRequest,
) {
  try {
    /* -------------------------------------------------------
       AUTHENTICATION
    ------------------------------------------------------- */

    const session =
      (await auth()) as AuthenticatedSession | null;

    if (
      !session?.user
    ) {
      return errorResponse(
        "Authentication required.",
        401,
      );
    }

    /* -------------------------------------------------------
       IDENTIFY CURRENT CALLER
    ------------------------------------------------------- */

    const callerEmail =
      normalizeEmail(
        session.user.email,
      );

    if (
      !callerEmail ||
      !isValidEmail(
        callerEmail,
      )
    ) {
      return errorResponse(
        "Your authenticated account does not have a valid email address.",
        401,
      );
    }

    /* -------------------------------------------------------
       DATABASE
    ------------------------------------------------------- */

    const client =
      await clientPromise;

    const db =
      client.db(DB_NAME);

    const authorizedEmails =
      db.collection<AuthorizedEmailDocument>(
        COLLECTION_NAME,
      );

    /* -------------------------------------------------------
       ENSURE UNIQUE INDEX
    ------------------------------------------------------- */

    await authorizedEmails.createIndex(
      {
        email: 1,
      },
      {
        unique: true,
        name: "authorized_email_unique",
      },
    );

    /* -------------------------------------------------------
       AUTHORIZE CALLER
    ------------------------------------------------------- */

    const callerAuthorization =
      await authorizedEmails.findOne(
        {
          email: callerEmail,
        },
        {
          projection: {
            _id: 1,
          },
        },
      );

    if (
      !callerAuthorization
    ) {
      return errorResponse(
        "You are not authorized to add users.",
        403,
      );
    }

    /* -------------------------------------------------------
       READ REQUEST BODY
    ------------------------------------------------------- */

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return errorResponse(
        "Invalid JSON request body.",
        400,
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return errorResponse(
        "Invalid request body.",
        400,
      );
    }

    const submittedEmail =
      normalizeEmail(
        (
          body as {
            email?: unknown;
          }
        ).email,
      );

    /* -------------------------------------------------------
       VALIDATE TARGET EMAIL
    ------------------------------------------------------- */

    if (!submittedEmail) {
      return errorResponse(
        "Email address is required.",
        400,
      );
    }

    if (
      !isValidEmail(
        submittedEmail,
      )
    ) {
      return errorResponse(
        "Enter a valid email address.",
        400,
      );
    }

    /* -------------------------------------------------------
       DUPLICATE CHECK
    ------------------------------------------------------- */

    const existing =
      await authorizedEmails.findOne(
        {
          email: submittedEmail,
        },
        {
          projection: {
            _id: 1,
          },
        },
      );

    if (existing) {
      return errorResponse(
        "That email is already authorized.",
        409,
      );
    }

    /* -------------------------------------------------------
       CREATE AUTHORIZED EMAIL
    ------------------------------------------------------- */

    const document: AuthorizedEmailDocument =
      {
        email: submittedEmail,
        createdAt: new Date(),
      };

    try {
      await authorizedEmails.insertOne(
        document,
      );
    } catch (error) {
      /*
       * The unique index protects against two
       * simultaneous requests adding the same email.
       */
      if (
        isDuplicateKeyError(
          error,
        )
      ) {
        return errorResponse(
          "That email is already authorized.",
          409,
        );
      }

      throw error;
    }

    /* -------------------------------------------------------
       SUCCESS
    ------------------------------------------------------- */

    return successResponse(
      {
        email:
          submittedEmail,
        createdAt:
          document.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    console.error(
      "POST /api/access/emails failed:",
      error,
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to add authorized email.",
      500,
    );
  }
}
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return errorResponse("Authentication required.", 401);
    }

    const callerEmail = normalizeEmail(session.user.email);

    if (!callerEmail || !isValidEmail(callerEmail)) {
      return errorResponse(
        "Authenticated user does not have a valid email address.",
        401,
      );
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const authorizedEmails =
      db.collection<AuthorizedEmailDocument>(COLLECTION_NAME);

    const authorizedUser = await authorizedEmails.findOne(
      {
        email: callerEmail,
      },
      {
        projection: {
          _id: 1,
        },
      },
    );

    return successResponse({
      authorized: !!authorizedUser,
    });
  } catch (error) {
    console.error("GET /api/access/emails failed:", error);

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to check authorization.",
      500,
    );
  }
}