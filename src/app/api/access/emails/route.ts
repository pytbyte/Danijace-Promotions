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
  "danijace-promotions";

const COLLECTION_NAME =
  "authorizedEmails";

/**
 * This account is the permanent recovery/admin account.
 *
 * It can be displayed but can NEVER be removed through
 * the application API.
 */
const PROTECTED_EMAIL =
  "heretolearn1@gmail.com";

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
  if (typeof value !== "string") {
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
   GET DATABASE COLLECTION
========================================================= */

async function getAuthorizedEmailsCollection() {
  const client =
    await clientPromise;

  const db =
    client.db(DB_NAME);

  return db.collection<AuthorizedEmailDocument>(
    COLLECTION_NAME,
  );
}

/* =========================================================
   ENSURE UNIQUE INDEX
========================================================= */

async function ensureAuthorizedEmailIndex() {
  const authorizedEmails =
    await getAuthorizedEmailsCollection();

  await authorizedEmails.createIndex(
    {
      email: 1,
    },
    {
      unique: true,
      name: "authorized_email_unique",
    },
  );

  return authorizedEmails;
}

/* =========================================================
   REQUIRE AUTHENTICATED + AUTHORIZED USER
========================================================= */

/**
 * Server-side authorization guard.
 *
 * Authentication:
 *   The caller must have a valid NextAuth session.
 *
 * Authorization:
 *   The authenticated email must already exist in
 *   authorizedEmails.
 *
 * IMPORTANT:
 *   The frontend must NEVER be trusted for this check.
 */
async function requireAuthorizedUser(): Promise<
  | {
      authorized: true;
      email: string;
      session: AuthenticatedSession;
    }
  | {
      authorized: false;
      response: NextResponse;
    }
> {
  /* -------------------------------------------------------
     AUTHENTICATION
  ------------------------------------------------------- */

  const session =
    (await auth()) as AuthenticatedSession | null;

  if (!session?.user) {
    return {
      authorized: false,
      response: errorResponse(
        "Authentication required.",
        401,
      ),
    };
  }

  /* -------------------------------------------------------
     IDENTIFY CALLER
  ------------------------------------------------------- */

  const callerEmail =
    normalizeEmail(
      session.user.email,
    );

  if (
    !callerEmail ||
    !isValidEmail(callerEmail)
  ) {
    return {
      authorized: false,
      response: errorResponse(
        "Your authenticated account does not have a valid email address.",
        401,
      ),
    };
  }

  /* -------------------------------------------------------
     DATABASE
  ------------------------------------------------------- */

  const authorizedEmails =
    await getAuthorizedEmailsCollection();

  /* -------------------------------------------------------
     CHECK AUTHORIZATION
  ------------------------------------------------------- */

  const authorization =
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

  if (!authorization) {
    return {
      authorized: false,
      response: errorResponse(
        "You are not authorized to access DANIJACE PROMOTIONS.",
        403,
      ),
    };
  }

  return {
    authorized: true,
    email: callerEmail,
    session,
  };
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
 * 1. Caller must have a valid NextAuth session.
 * 2. Caller email comes ONLY from the server-side session.
 * 3. Caller must already be authorized.
 * 4. Submitted email is normalized and validated.
 * 5. Unique MongoDB index prevents duplicates.
 */
export async function POST(
  request: NextRequest,
) {
  try {
    /* -------------------------------------------------------
       AUTHORIZE CALLER
    ------------------------------------------------------- */

    const access =
      await requireAuthorizedUser();

    if (!access.authorized) {
      return access.response;
    }

    /* -------------------------------------------------------
       DATABASE
    ------------------------------------------------------- */

    const authorizedEmails =
      await ensureAuthorizedEmailIndex();

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

    const document:
      AuthorizedEmailDocument = {
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
        isDuplicateKeyError(error)
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

/* =========================================================
   GET /api/access/emails
========================================================= */

/**
 * Return the complete authorized-email list.
 *
 * IMPORTANT:
 * Only an already-authorized user can retrieve this list.
 */
export async function GET() {
  try {
    /* -------------------------------------------------------
       AUTHORIZE CALLER
    ------------------------------------------------------- */

    const access =
      await requireAuthorizedUser();

    if (!access.authorized) {
      return access.response;
    }

    /* -------------------------------------------------------
       DATABASE
    ------------------------------------------------------- */

    const authorizedEmails =
      await ensureAuthorizedEmailIndex();

    /* -------------------------------------------------------
       LOAD AUTHORIZED USERS
    ------------------------------------------------------- */

    const documents =
      await authorizedEmails
        .find(
          {},
          {
            projection: {
              _id: 1,
              email: 1,
              createdAt: 1,
            },
          },
        )
        .sort({
          email: 1,
        })
        .toArray();

    /* -------------------------------------------------------
       FORMAT RESPONSE
    ------------------------------------------------------- */

    const emails =
      documents.map(
        (document) => ({
          id:
            document._id.toString(),
          email:
            document.email,
          createdAt:
            document.createdAt.toISOString(),
          protected:
            document.email
              .trim()
              .toLowerCase() ===
            PROTECTED_EMAIL,
        }),
      );

    return successResponse({
      authorized: true,
      emails,
    });
  } catch (error) {
    console.error(
      "GET /api/access/emails failed:",
      error,
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "Failed to load authorized users.",
      500,
    );
  }
}

/* =========================================================
   DELETE /api/access/emails
========================================================= */

/**
 * Remove an authorized email.
 *
 * SECURITY:
 *
 * - Caller must already be authorized.
 * - Target email must exist.
 * - heretolearn1@gmail.com can NEVER be removed.
 */
export async function DELETE(
  request: Request,
) {
  try {
    /* -------------------------------------------------------
       AUTHORIZE CALLER
    ------------------------------------------------------- */

    const access =
      await requireAuthorizedUser();

    if (!access.authorized) {
      return access.response;
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

    const email =
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

    if (
      !email ||
      !isValidEmail(email)
    ) {
      return errorResponse(
        "A valid email address is required.",
        400,
      );
    }

    /* -------------------------------------------------------
       PROTECTED ACCOUNT
    ------------------------------------------------------- */

    if (
      email === PROTECTED_EMAIL
    ) {
      return errorResponse(
        "This authorized email is protected and cannot be removed.",
        403,
      );
    }

    /* -------------------------------------------------------
       DATABASE
    ------------------------------------------------------- */

    const authorizedEmails =
      await getAuthorizedEmailsCollection();

    /* -------------------------------------------------------
       FIND TARGET
    ------------------------------------------------------- */

    const existing =
      await authorizedEmails.findOne(
        {
          email,
        },
        {
          projection: {
            _id: 1,
          },
        },
      );

    if (!existing) {
      return errorResponse(
        "Authorized email not found.",
        404,
      );
    }

    /* -------------------------------------------------------
       REMOVE TARGET
    ------------------------------------------------------- */

    const result =
      await authorizedEmails.deleteOne(
        {
          email,
        },
      );

    if (
      result.deletedCount !== 1
    ) {
      return errorResponse(
        "Authorized email could not be removed.",
        409,
      );
    }

    /* -------------------------------------------------------
       SUCCESS
    ------------------------------------------------------- */

    return successResponse({
      email,
      removed: true,
    });
  } catch (error) {
    console.error(
      "DELETE /api/access/emails failed:",
      error,
    );

    return errorResponse(
      "Failed to remove authorized email.",
      500,
    );
  }
}