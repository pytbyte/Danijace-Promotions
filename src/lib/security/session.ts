import crypto from "crypto";
import { cookies } from "next/headers";
import { Db } from "mongodb";

export const SECURITY_COOKIE =
  "danijace_security_verified";

export const SECURITY_SESSION_COLLECTION =
  "securitySessions";

/**
 * Successful PIN/device verification remains valid
 * for 8 hours.
 *
 * The browser only receives the random opaque token.
 * MongoDB stores only its SHA-256 hash.
 */
export const SECURITY_SESSION_MAX_AGE =
  8 * 60 * 60;

type SecuritySessionDocument = {
  _id?: string;

  tokenHash: string;

  userId?: string;

  email: string;

  method: "pin" | "device";

  createdAt: Date;

  expiresAt: Date;
};

function hashToken(
  token: string,
): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

/* =====================================================
   CREATE SECURITY SESSION
===================================================== */

export async function createSecuritySession(
  db: Db,
  user: {
    userId?: string;
    email: string;
  },
  method: "pin" | "device",
): Promise<void> {
  const collection =
    db.collection<SecuritySessionDocument>(
      SECURITY_SESSION_COLLECTION,
    );

  await collection.createIndex(
    { tokenHash: 1 },
    { unique: true },
  );

  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );

  const token =
    crypto
      .randomBytes(48)
      .toString("base64url");

  const tokenHash =
    hashToken(token);

  const now = new Date();

  const expiresAt =
    new Date(
      now.getTime() +
        SECURITY_SESSION_MAX_AGE *
          1000,
    );

  await collection.insertOne({
    tokenHash,
    userId: user.userId,
    email: user.email,
    method,
    createdAt: now,
    expiresAt,
  });

  const cookieStore =
    await cookies();

  cookieStore.set({
    name: SECURITY_COOKIE,
    value: token,
    httpOnly: true,
    secure:
      process.env.NODE_ENV ===
      "production",
    sameSite: "lax",
    path: "/",
    maxAge:
      SECURITY_SESSION_MAX_AGE,
  });
}

/* =====================================================
   CHECK SECURITY SESSION
===================================================== */

export async function hasSecuritySession(
  db: Db,
  user: {
    userId?: string;
    email: string;
  },
): Promise<boolean> {
  const cookieStore =
    await cookies();

  const token =
    cookieStore.get(
      SECURITY_COOKIE,
    )?.value;

  if (!token) {
    return false;
  }

  const tokenHash =
    hashToken(token);

  const collection =
    db.collection<SecuritySessionDocument>(
      SECURITY_SESSION_COLLECTION,
    );

  const session =
    await collection.findOne({
      tokenHash,
      email: user.email,
      ...(user.userId
        ? {
            userId: user.userId,
          }
        : {}),
      expiresAt: {
        $gt: new Date(),
      },
    });

  return Boolean(session);
}

/* =====================================================
   CLEAR CURRENT SECURITY SESSION
===================================================== */

export async function clearSecuritySession(
  db: Db,
): Promise<void> {
  const cookieStore =
    await cookies();

  const token =
    cookieStore.get(
      SECURITY_COOKIE,
    )?.value;

  if (token) {
    const tokenHash =
      hashToken(token);

    await db
      .collection<SecuritySessionDocument>(
        SECURITY_SESSION_COLLECTION,
      )
      .deleteOne({
        tokenHash,
      });
  }

  cookieStore.delete(
    SECURITY_COOKIE,
  );
}

/* =====================================================
   CLEAR ALL SECURITY SESSIONS
===================================================== */

/**
 * Used when a security PIN is reset.
 *
 * This invalidates every second-layer security
 * session belonging to the account, not just the
 * browser performing the reset.
 */
export async function clearSecuritySessionsForUser(
  db: Db,
  user: {
    userId?: string;
    email: string;
  },
): Promise<void> {
  const collection =
    db.collection<SecuritySessionDocument>(
      SECURITY_SESSION_COLLECTION,
    );

  await collection.deleteMany({
    email: user.email,
    ...(user.userId
      ? {
          userId: user.userId,
        }
      : {}),
  });

  const cookieStore =
    await cookies();

  cookieStore.delete(
    SECURITY_COOKIE,
  );
}