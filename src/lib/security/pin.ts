import bcrypt from "bcryptjs";
import { Collection, Db } from "mongodb";

export const SECURITY_COLLECTION = "userSecurity";

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export const PIN_MAX_ATTEMPTS = 5;

/**
 * Account is temporarily locked for 15 minutes after
 * the maximum number of failed PIN attempts.
 */
export const PIN_LOCK_MINUTES = 15;

export type UserSecurityDocument = {
  _id?: string;

  /**
   * Stable identity from the authenticated NextAuth session.
   */
  userId?: string;

  /**
   * Normalized Google email.
   * Used as an additional identity key/fallback.
   */
  email: string;

  /**
   * bcrypt hash.
   *
   * NEVER store the raw PIN.
   */
  pinHash: string;

  pinConfiguredAt: Date;

  failedPinAttempts: number;

  lockedUntil?: Date | null;

  lastPinVerifiedAt?: Date | null;

  createdAt: Date;

  updatedAt: Date;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePin(pin: unknown): pin is string {
  if (typeof pin !== "string") {
    return false;
  }

  if (
    pin.length < PIN_MIN_LENGTH ||
    pin.length > PIN_MAX_LENGTH
  ) {
    return false;
  }

  return /^\d+$/.test(pin);
}

export async function getSecurityCollection(
  db: Db,
): Promise<Collection<UserSecurityDocument>> {
  const collection =
    db.collection<UserSecurityDocument>(
      SECURITY_COLLECTION,
    );

  /**
   * Safe idempotent indexes.
   *
   * Email is unique because one authenticated Google
   * identity should have one security record.
   */
  await collection.createIndex(
    { email: 1 },
    { unique: true },
  );

  /**
   * userId is sparse because some existing sessions may
   * only expose an email.
   */
  await collection.createIndex(
    { userId: 1 },
    {
      unique: true,
      sparse: true,
    },
  );

  return collection;
}

export async function hashPin(
  pin: string,
): Promise<string> {
  /**
   * bcrypt cost 12 is a reasonable production baseline
   * for a short PIN when combined with server-side
   * attempt limiting.
   */
  return bcrypt.hash(pin, 12);
}

export async function comparePin(
  pin: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export function isLocked(
  security: UserSecurityDocument,
): boolean {
  if (!security.lockedUntil) {
    return false;
  }

  return security.lockedUntil.getTime() > Date.now();
}

export function getRemainingLockSeconds(
  security: UserSecurityDocument,
): number {
  if (!security.lockedUntil) {
    return 0;
  }

  return Math.max(
    0,
    Math.ceil(
      (security.lockedUntil.getTime() - Date.now()) /
        1000,
    ),
  );
}

export function normalizeSecurityEmail(
  email: string,
): string {
  return normalizeEmail(email);
}