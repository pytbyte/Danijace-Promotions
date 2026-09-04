import {
  Collection,
  ObjectId,
} from "mongodb";

/* =========================================================
   ANDROID DEVICE RECOVERY KEY
========================================================= */

export type AndroidRecoveryKey = {
  _id?: ObjectId;
  userId?: string;
  email: string;
  publicKey: string;
  algorithm: "ECDSA-SHA256";
  platform: "android";
  keyType: "recovery";
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date | null;
  enabled: boolean;
};

/* =========================================================
   ANDROID RECOVERY CHALLENGE
========================================================= */

export type AndroidRecoveryChallenge = {
  _id?: ObjectId;
  userId?: string;
  email: string;
  challengeHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date | null;
  verifiedAt?: Date | null;
  attempts: number;
};

/* =========================================================
   ANDROID RECOVERY AUTHORIZATION
========================================================= */

export type AndroidRecoveryAuthorization = {
  _id?: ObjectId;
  userId?: string;
  email: string;
  challengeId: ObjectId;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date | null;
};

/* =========================================================
   COLLECTION NAMES
========================================================= */

export const DEVICE_RECOVERY_COLLECTION =
  "androidDeviceRecoveryKeys";

export const DEVICE_RECOVERY_CHALLENGES_COLLECTION =
  "androidDeviceRecoveryChallenges";

export const DEVICE_RECOVERY_AUTHORIZATIONS_COLLECTION =
  "androidDeviceRecoveryAuthorizations";

/* =========================================================
   CHALLENGE SETTINGS
========================================================= */

export const DEVICE_RECOVERY_CHALLENGE_TTL_MS =
  5 * 60 * 1000;

/* =========================================================
   AUTHORIZATION SETTINGS
========================================================= */

export const DEVICE_RECOVERY_AUTHORIZATION_TTL_MS =
  10 * 60 * 1000;

/* =========================================================
   EMAIL NORMALIZATION
========================================================= */

export function normalizeRecoveryEmail(
  email: unknown,
): string {
  if (typeof email !== "string") {
    return "";
  }

  return email.trim().toLowerCase();
}

/* =========================================================
   PUBLIC KEY VALIDATION
========================================================= */

export function isValidRecoveryPublicKey(
  publicKey: unknown,
): publicKey is string {
  if (typeof publicKey !== "string") {
    return false;
  }

  const value = publicKey.trim();

  if (
    value.length < 80 ||
    value.length > 4096
  ) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/* =========================================================
   RECOVERY KEY COLLECTION
========================================================= */

export async function getDeviceRecoveryCollection(
  db: {
    collection<T extends object>(
      name: string,
    ): Collection<T>;
  },
): Promise<Collection<AndroidRecoveryKey>> {
  const collection =
    db.collection<AndroidRecoveryKey>(
      DEVICE_RECOVERY_COLLECTION,
    );

  await collection.createIndex(
    { email: 1 },
    {
      unique: true,
      name:
        "android_recovery_email_unique",
    },
  );

  await collection.createIndex(
    { userId: 1 },
    {
      unique: true,
      sparse: true,
      name:
        "android_recovery_user_id_unique",
    },
  );

  return collection;
}

/* =========================================================
   RECOVERY CHALLENGE COLLECTION
========================================================= */

export async function getDeviceRecoveryChallengeCollection(
  db: {
    collection<T extends object>(
      name: string,
    ): Collection<T>;
  },
): Promise<
  Collection<AndroidRecoveryChallenge>
> {
  const collection =
    db.collection<AndroidRecoveryChallenge>(
      DEVICE_RECOVERY_CHALLENGES_COLLECTION,
    );

  await collection.createIndex(
    { expiresAt: 1 },
    {
      expireAfterSeconds: 0,
      name:
        "android_recovery_challenge_ttl",
    },
  );

  await collection.createIndex(
    {
      email: 1,
      createdAt: -1,
    },
    {
      name:
        "android_recovery_challenge_email_created",
    },
  );

  await collection.createIndex(
    {
      email: 1,
      usedAt: 1,
    },
    {
      name:
        "android_recovery_challenge_email_used",
    },
  );

  return collection;
}

/* =========================================================
   RECOVERY AUTHORIZATION COLLECTION
========================================================= */

export async function getDeviceRecoveryAuthorizationCollection(
  db: {
    collection<T extends object>(
      name: string,
    ): Collection<T>;
  },
): Promise<
  Collection<AndroidRecoveryAuthorization>
> {
  const collection =
    db.collection<AndroidRecoveryAuthorization>(
      DEVICE_RECOVERY_AUTHORIZATIONS_COLLECTION,
    );

  await collection.createIndex(
    {
      tokenHash: 1,
    },
    {
      unique: true,
      name:
        "android_recovery_authorization_token_unique",
    },
  );

  await collection.createIndex(
    {
      expiresAt: 1,
    },
    {
      expireAfterSeconds: 0,
      name:
        "android_recovery_authorization_ttl",
    },
  );

  await collection.createIndex(
    {
      email: 1,
      createdAt: -1,
    },
    {
      name:
        "android_recovery_authorization_email_created",
    },
  );

  return collection;
}