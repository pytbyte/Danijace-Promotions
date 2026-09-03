import crypto from "crypto";
import { Collection, Db } from "mongodb";

export const PIN_RECOVERY_COLLECTION =
  "securityPinRecoveries";

export const PIN_RECOVERY_CODE_LENGTH = 6;

/**
 * Recovery codes are valid for 10 minutes.
 */
export const PIN_RECOVERY_CODE_TTL_SECONDS =
  10 * 60;

/**
 * Maximum incorrect recovery-code attempts.
 */
export const PIN_RECOVERY_MAX_ATTEMPTS = 5;

/**
 * Minimum time between recovery-code requests.
 */
export const PIN_RECOVERY_RESEND_SECONDS = 60;

/**
 * Maximum recovery-code requests from one account
 * within the rolling window.
 */
export const PIN_RECOVERY_MAX_REQUESTS = 5;

export const PIN_RECOVERY_REQUEST_WINDOW_SECONDS =
  60 * 60;

type PinRecoveryDocument = {
  _id?: string;

  userId?: string;

  email: string;

  /**
   * SHA-256 hash of the six-digit recovery code.
   *
   * NEVER store the actual code.
   */
  codeHash: string;

  /**
   * Opaque token issued after successful code verification.
   * Only its SHA-256 hash is stored.
   */
  resetTokenHash?: string;

  attempts: number;

  requestCount: number;

  firstRequestAt: Date;

  lastSentAt: Date;

  createdAt: Date;

  expiresAt: Date;

  verifiedAt?: Date | null;

  usedAt?: Date | null;
};

function hashValue(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

export function hashRecoveryCode(
  code: string,
): string {
  return hashValue(code);
}

export function hashResetToken(
  token: string,
): string {
  return hashValue(token);
}

export function generateRecoveryCode(): string {
  return crypto
    .randomInt(0, 1_000_000)
    .toString()
    .padStart(PIN_RECOVERY_CODE_LENGTH, "0");
}

export function generateResetToken(): string {
  return crypto
    .randomBytes(48)
    .toString("base64url");
}

export function validateRecoveryCode(
  code: unknown,
): code is string {
  return (
    typeof code === "string" &&
    /^\d{6}$/.test(code)
  );
}

export async function getRecoveryCollection(
  db: Db,
): Promise<Collection<PinRecoveryDocument>> {
  const collection =
    db.collection<PinRecoveryDocument>(
      PIN_RECOVERY_COLLECTION,
    );

  await collection.createIndex(
    { expiresAt: 1 },
    {
      expireAfterSeconds: 0,
    },
  );

  await collection.createIndex({
    email: 1,
    createdAt: -1,
  });

  await collection.createIndex(
    { resetTokenHash: 1 },
    {
      sparse: true,
    },
  );

  return collection;
}

export function isRecoveryExpired(
  recovery: PinRecoveryDocument,
): boolean {
  return (
    recovery.expiresAt.getTime() <=
    Date.now()
  );
}

export function isResendAllowed(
  recovery: PinRecoveryDocument,
): boolean {
  return (
    Date.now() -
      recovery.lastSentAt.getTime() >=
    PIN_RECOVERY_RESEND_SECONDS * 1000
  );
}

export function isRequestWindowExpired(
  recovery: PinRecoveryDocument,
): boolean {
  return (
    Date.now() -
      recovery.firstRequestAt.getTime() >=
    PIN_RECOVERY_REQUEST_WINDOW_SECONDS *
      1000
  );
}

export function isRecoveryExhausted(
  recovery: PinRecoveryDocument,
): boolean {
  return (
    recovery.attempts >=
    PIN_RECOVERY_MAX_ATTEMPTS
  );
}