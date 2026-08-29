import { ObjectId } from "mongodb";

import clientPromise from "@/lib/mongodb";

import type { Member } from "./types";

import {
  normalizeMember,
  validateMember,
} from "./validation";

/* =========================================================
   CONSTANTS
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const MEMBERS_COLLECTION = "members";
const ACCOUNTS_COLLECTION = "savingsAccounts";
const COUNTERS_COLLECTION = "counters";

const MEMBERSHIP_PREFIX =
  process.env.MEMBERSHIP_PREFIX || "GEO";

/*
 * Temporary compatibility fallback.
 *
 * API routes should eventually pass the authenticated
 * user's email/name as createdBy or updatedBy.
 */
const SYSTEM_ACTOR = "system";

/* =========================================================
   MONGODB DOCUMENT TYPES
========================================================= */

/*
 * Application:
 *
 *   _id -> string
 *
 * MongoDB:
 *
 *   _id -> ObjectId
 */
type MemberDocument = Omit<Member, "_id"> & {
  _id?: ObjectId;
};

/*
 * Every member receives exactly ONE fixed savings account.
 *
 * Financial transactions should NOT be stored directly
 * inside this account document.
 *
 * The account represents the current account state.
 *
 * Savings deposits/withdrawals should later have their
 * own immutable transaction collection.
 */
export type SavingsAccountDocument = {
  _id?: ObjectId;

  memberId: ObjectId;

  accountNumber: string;

  accountType: "fixed";

  balance: number;

  status: "active" | "inactive";

  createdAt: string;

  updatedAt: string;

  createdBy: string;

  updatedBy?: string;
};

/*
 * Counter used for sequential numbers.
 */
type CounterDocument = {
  _id: string;

  sequence: number;

  updatedAt: string;
};

/* =========================================================
   PUBLIC TYPES
========================================================= */

export type GetMembersOptions = {
  page?: number;

  limit?: number;

  search?: string;
};

export type PaginatedMembers = {
  members: Member[];

  total: number;

  page: number;

  limit: number;

  totalPages: number;
};

/*
 * Safe account object returned to application code.
 */
export type MemberAccount = {
  _id: string;

  memberId: string;

  accountNumber: string;

  accountType: "fixed";

  balance: number;

  status: "active" | "inactive";

  createdAt: string;

  updatedAt: string;

  createdBy: string;

  updatedBy?: string;
};

/*
 * Internal result used during member registration.
 *
 * createMember() continues to return only Member for
 * compatibility with the current API route.
 *
 * The account is nevertheless created automatically.
 */
type MemberRegistrationResult = {
  member: Member;

  account: MemberAccount;
};

/* =========================================================
   COLLECTIONS
========================================================= */

async function getCollections() {
  const client = await clientPromise;

  const db = client.db(DB_NAME);

  return {
    client,

    db,

    members:
      db.collection<MemberDocument>(
        MEMBERS_COLLECTION
      ),

    accounts:
      db.collection<SavingsAccountDocument>(
        ACCOUNTS_COLLECTION
      ),

    counters:
      db.collection<CounterDocument>(
        COUNTERS_COLLECTION
      ),
  };
}

/* =========================================================
   HELPERS
========================================================= */

/**
 * Convert MongoDB member document into application Member.
 */
function toMember(
  document: MemberDocument
): Member {
  const {
    _id,
    ...data
  } = document;

  return {
    ...data,

    ...( _id
      ? {
          _id: _id.toString(),
        }
      : {}),
  } as Member;
}

/**
 * Convert MongoDB savings account into safe
 * application representation.
 */
function toMemberAccount(
  document: SavingsAccountDocument
): MemberAccount {
  if (!document._id) {
    throw new Error(
      "Savings account has no MongoDB ID."
    );
  }

  return {
    _id:
      document._id.toString(),

    memberId:
      document.memberId.toString(),

    accountNumber:
      document.accountNumber,

    accountType:
      document.accountType,

    balance:
      document.balance,

    status:
      document.status,

    createdAt:
      document.createdAt,

    updatedAt:
      document.updatedAt,

    createdBy:
      document.createdBy,

    ...(document.updatedBy
      ? {
          updatedBy:
            document.updatedBy,
        }
      : {}),
  };
}

/**
 * Safely convert string to ObjectId.
 */
function createObjectId(
  id: string
): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new Error(
      "Invalid member ID."
    );
  }

  return new ObjectId(id);
}

/**
 * Return first validation error.
 */
function getFirstValidationError(
  errors: Record<string, string>
): string {
  return (
    Object.values(errors)[0] ||
    "Invalid member data."
  );
}

/**
 * Escape regex input.
 *
 * This prevents user search input from becoming
 * an unintended MongoDB regular expression.
 */
function escapeRegex(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/**
 * Normalize the actor performing the operation.
 *
 * Optional for backwards compatibility with existing
 * API routes.
 */
function normalizeActor(
  actor?: string
): string {
  const value =
    typeof actor === "string"
      ? actor.trim()
      : "";

  return value || SYSTEM_ACTOR;
}

/**
 * Detect MongoDB duplicate-key errors.
 */
function isDuplicateKeyError(
  error: unknown
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code ===
      11000
  );
}

/* =========================================================
   DATABASE INDEXES
========================================================= */

/**
 * Create indexes required for data integrity.
 *
 * These indexes are especially important because
 * preliminary duplicate checks alone are NOT enough
 * when two users submit data simultaneously.
 */
async function ensureIndexes(): Promise<void> {
  const {
    members,
    accounts,
  } = await getCollections();

  await Promise.all([
    /*
     * Membership number must always be unique.
     */
    members.createIndex(
      {
        membershipNumber: 1,
      },
      {
        unique: true,
        name:
          "members_membershipNumber_unique",
      }
    ),

    /*
     * Phone number must be unique.
     */
    members.createIndex(
      {
        phone: 1,
      },
      {
        unique: true,
        name:
          "members_phone_unique",
      }
    ),

    /*
     * Email is optional.
     *
     * Partial index means members without an email
     * do not conflict with each other.
     */
    members.createIndex(
      {
        email: 1,
      },
      {
        unique: true,

        partialFilterExpression: {
          email: {
            $type: "string",
          },
        },

        name:
          "members_email_unique",
      }
    ),

    /*
     * National ID is optional.
     */
    members.createIndex(
      {
        nationalId: 1,
      },
      {
        unique: true,

        partialFilterExpression: {
          nationalId: {
            $type: "string",
          },
        },

        name:
          "members_nationalId_unique",
      }
    ),

    /*
     * Deterministic member ordering.
     */
    members.createIndex(
      {
        createdAt: -1,
        _id: -1,
      },
      {
        name:
          "members_createdAt_id_desc",
      }
    ),

    /*
     * CRITICAL:
     *
     * A member may have exactly ONE savings account.
     */
    accounts.createIndex(
      {
        memberId: 1,
      },
      {
        unique: true,
        name:
          "savingsAccounts_memberId_unique",
      }
    ),

    /*
     * Account number must also be globally unique.
     */
    accounts.createIndex(
      {
        accountNumber: 1,
      },
      {
        unique: true,
        name:
          "savingsAccounts_accountNumber_unique",
      }
    ),
  ]);
}

/* =========================================================
   SEQUENTIAL NUMBER GENERATION
========================================================= */

/**
 * Atomically increment a counter.
 *
 * MongoDB's $inc guarantees that concurrent registrations
 * receive different sequence numbers.
 */
async function getNextSequence(
  counterId: string
): Promise<number> {
  const {
    counters,
  } = await getCollections();

  const now =
    new Date().toISOString();

  const result =
    await counters.findOneAndUpdate(
      {
        _id: counterId,
      },

      {
        $inc: {
          sequence: 1,
        },

        $set: {
          updatedAt: now,
        },
      },

      {
        upsert: true,

        returnDocument: "after",
      }
    );

  if (!result) {
    throw new Error(
      "Unable to generate the next sequence number."
    );
  }

  return result.sequence;
}

/**
 * Generate membership number.
 *
 * GEO-000001
 * GEO-000002
 * GEO-000003
 */
async function generateMembershipNumber(): Promise<string> {
  const sequence =
    await getNextSequence(
      "membershipNumber"
    );

  return (
    `${MEMBERSHIP_PREFIX}-` +
    String(sequence).padStart(
      6,
      "0"
    )
  );
}

/**
 * Generate savings account number.
 *
 * SAV-000001
 * SAV-000002
 * SAV-000003
 */
async function generateAccountNumber(): Promise<string> {
  const sequence =
    await getNextSequence(
      "savingsAccountNumber"
    );

  return (
    "SAV-" +
    String(sequence).padStart(
      6,
      "0"
    )
  );
}

/* =========================================================
   CREATE MEMBER + AUTOMATIC SAVINGS ACCOUNT
========================================================= */

/**
 * Register a member.
 *
 * THIS FUNCTION AUTOMATICALLY CREATES:
 *
 * 1. Member
 * 2. Fixed savings account
 *
 * The account starts with:
 *
 * balance = 0
 *
 * No savings transaction is created here.
 *
 * Everything happens inside ONE MongoDB transaction.
 *
 * If account creation fails:
 *
 * -> member creation is rolled back.
 *
 * If member creation fails:
 *
 * -> account is never created.
 *
 * There can therefore never be a successfully registered
 * member without their required savings account.
 */
export async function createMember(
  data: Partial<Member>,
  createdBy?: string
): Promise<Member> {
  const actor =
    normalizeActor(createdBy);

  /*
   * Never trust client-controlled system fields.
   */
  const {
    _id:
      _ignoredId,

    membershipNumber:
      _ignoredMembershipNumber,

    createdAt:
      _ignoredCreatedAt,

    updatedAt:
      _ignoredUpdatedAt,

    createdBy:
      _ignoredCreatedBy,

    updatedBy:
      _ignoredUpdatedBy,

    status:
      _ignoredStatus,

    ...registrationData
  } = data;

  /*
   * Normalize user-provided fields.
   */
  const normalized =
    normalizeMember(
      registrationData
    );

  /*
   * Generate membership number on server.
   */
  const membershipNumber =
    await generateMembershipNumber();

  /*
   * Generate savings account number on server.
   *
   * A failed transaction may create a sequence gap.
   *
   * That is intentional.
   *
   * We NEVER reuse financial/account numbers.
   */
  const accountNumber =
    await generateAccountNumber();

  const now =
    new Date().toISOString();

  /*
   * Build complete member for validation.
   */
  const memberForValidation:
    Partial<Member> = {
    ...normalized,

    membershipNumber,

    status: "active",

    createdBy: actor,

    createdAt: now,

    updatedAt: now,
  };

  /*
   * Validate complete member.
   */
  const validation =
    validateMember(
      memberForValidation
    );

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  /*
   * Ensure database indexes exist.
   */
  await ensureIndexes();

  const {
    client,
    members,
    accounts,
  } = await getCollections();

  /*
   * Preliminary duplicate checks.
   *
   * These are mainly for friendly error messages.
   *
   * MongoDB unique indexes remain the actual
   * concurrency protection.
   */
  const duplicateChecks =
    await Promise.all([
      members.findOne({
        membershipNumber,
      }),

      normalized.phone
        ? members.findOne({
            phone:
              normalized.phone,
          })
        : null,

      normalized.email
        ? members.findOne({
            email:
              normalized.email,
          })
        : null,

      normalized.nationalId
        ? members.findOne({
            nationalId:
              normalized.nationalId,
          })
        : null,
    ]);

  if (duplicateChecks[0]) {
    throw new Error(
      "A member with this membership number already exists."
    );
  }

  if (duplicateChecks[1]) {
    throw new Error(
      "A member with this phone number already exists."
    );
  }

  if (duplicateChecks[2]) {
    throw new Error(
      "A member with this email already exists."
    );
  }

  if (duplicateChecks[3]) {
    throw new Error(
      "A member with this national ID already exists."
    );
  }

  /*
   * Build member document.
   *
   * We intentionally do NOT provide _id.
   *
   * MongoDB generates it.
   */
  const memberDocument:
    Omit<MemberDocument, "_id"> = {
    ...normalized,

    membershipNumber,

    status: "active",

    createdBy: actor,

    createdAt: now,

    updatedAt: now,
  } as Omit<
    MemberDocument,
    "_id"
  >;

  /*
   * Start MongoDB transaction.
   */
  const session =
    client.startSession();

  try {
    /*
     * Return the transaction result directly.
     *
     * This avoids TypeScript's "never" narrowing problem
     * caused by assigning variables from inside callbacks.
     */
    const result =
      await session.withTransaction(
        async (): Promise<MemberRegistrationResult> => {
          /*
           * ==========================================
           * 1. CREATE MEMBER
           * ==========================================
           */
          const memberInsert =
            await members.insertOne(
              memberDocument,
              {
                session,
              }
            );

          /*
           * MongoDB-generated member ID.
           */
          const memberId =
            memberInsert.insertedId;

          /*
           * ==========================================
           * 2. CREATE SAVINGS ACCOUNT AUTOMATICALLY
           * ==========================================
           *
           * Every member gets exactly ONE fixed
           * savings account.
           *
           * Starting balance is ZERO.
           *
           * No savings movement occurs here.
           */
          const accountDocument:
            SavingsAccountDocument = {
            memberId,

            accountNumber,

            accountType: "fixed",

            balance: 0,

            status: "active",

            createdAt: now,

            updatedAt: now,

            createdBy: actor,
          };

          /*
           * insertOne generates the account _id.
           */
          const accountInsert =
            await accounts.insertOne(
              accountDocument,
              {
                session,
              }
            );

          /*
           * ==========================================
           * 3. BUILD RETURN OBJECTS
           * ==========================================
           */

          const createdMember:
            Member = {
            ...memberDocument,

            _id:
              memberId.toString(),
          } as Member;

          const createdAccount:
            MemberAccount = {
            _id:
              accountInsert.insertedId.toString(),

            memberId:
              memberId.toString(),

            accountNumber,

            accountType:
              "fixed",

            balance: 0,

            status:
              "active",

            createdAt: now,

            updatedAt: now,

            createdBy: actor,
          };

          return {
            member:
              createdMember,

            account:
              createdAccount,
          };
        }
      );

    /*
     * Transaction completed successfully.
     *
     * IMPORTANT:
     *
     * At this point both documents exist:
     *
     * members
     * savingsAccounts
     */
    if (!result.member) {
      throw new Error(
        "Member registration could not be completed."
      );
    }

    return result.member;

  } catch (error) {
    /*
     * Convert MongoDB duplicate errors into a clean
     * application-level error.
     */
    if (
      isDuplicateKeyError(error)
    ) {
      throw new Error(
        "A member with one of the supplied unique details already exists."
      );
    }

    throw error;

  } finally {
    await session.endSession();
  }
}

/* =========================================================
   GET ONE MEMBER
========================================================= */

export async function getMemberById(
  id: string
): Promise<Member | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const {
    members,
  } = await getCollections();

  const member =
    await members.findOne({
      _id:
        createObjectId(id),
    });

  if (!member) {
    return null;
  }

  return toMember(member);
}

/* =========================================================
   GET MEMBER SAVINGS ACCOUNT
========================================================= */

/**
 * Retrieve the single fixed savings account belonging
 * to a member.
 */
export async function getMemberAccount(
  memberId: string
): Promise<MemberAccount | null> {
  if (!ObjectId.isValid(memberId)) {
    return null;
  }

  const {
    accounts,
  } = await getCollections();

  const account =
    await accounts.findOne({
      memberId:
        createObjectId(memberId),
    });

  if (!account) {
    return null;
  }

  return toMemberAccount(
    account
  );
}

/* =========================================================
   GET MEMBERS
========================================================= */

export async function getMembers(
  options: GetMembersOptions = {}
): Promise<PaginatedMembers> {
  const {
    members,
  } = await getCollections();

  /*
   * PAGE
   */
  const requestedPage =
    Number(options.page);

  const page =
    Number.isFinite(
      requestedPage
    ) &&
    requestedPage >= 1
      ? Math.floor(
          requestedPage
        )
      : 1;

  /*
   * LIMIT
   */
  const requestedLimit =
    Number(options.limit);

  const limit =
    Number.isFinite(
      requestedLimit
    ) &&
    requestedLimit >= 1
      ? Math.min(
          100,
          Math.floor(
            requestedLimit
          )
        )
      : 25;

  /*
   * SEARCH
   */
  const search =
    typeof options.search ===
    "string"
      ? options.search.trim()
      : "";

  /*
   * FILTER
   */
  const filter: Record<
    string,
    unknown
  > = {};

  if (search) {
    const regex =
      new RegExp(
        escapeRegex(search),
        "i"
      );

    filter.$or = [
      {
        membershipNumber:
          regex,
      },

      {
        firstName:
          regex,
      },

      {
        middleName:
          regex,
      },

      {
        lastName:
          regex,
      },

      {
        phone:
          regex,
      },

      {
        email:
          regex,
      },

      {
        nationalId:
          regex,
      },
    ];
  }

  /*
   * COUNT
   */
  const total =
    await members.countDocuments(
      filter
    );

  /*
   * TOTAL PAGES
   */
  const totalPages =
    total === 0
      ? 0
      : Math.ceil(
          total / limit
        );

  /*
   * SAFE PAGE
   */
  const safePage =
    totalPages > 0
      ? Math.min(
          page,
          totalPages
        )
      : 1;

  /*
   * SKIP
   */
  const skip =
    (safePage - 1) *
    limit;

  /*
   * FETCH
   */
  const documents =
    await members
      .find(filter)
      .sort({
        createdAt: -1,

        /*
         * Deterministic ordering if two members
         * have the same createdAt.
         */
        _id: -1,
      })
      .skip(skip)
      .limit(limit)
      .toArray();

  return {
    members:
      documents.map(
        toMember
      ),

    total,

    page:
      safePage,

    limit,

    totalPages,
  };
}

/* =========================================================
   UPDATE MEMBER
========================================================= */

/**
 * Update editable member information.
 *
 * Protected fields:
 *
 * - _id
 * - membershipNumber
 * - createdAt
 * - createdBy
 * - updatedAt
 * - updatedBy
 *
 * Membership number can NEVER be changed.
 */
export async function updateMember(
  id: string,
  data: Partial<Member>,
  updatedBy?: string
): Promise<Member> {
  if (!ObjectId.isValid(id)) {
    throw new Error(
      "Invalid member ID."
    );
  }

  const actor =
    normalizeActor(updatedBy);

  const memberId =
    createObjectId(id);

  const {
    members,
  } = await getCollections();

  /*
   * GET EXISTING
   */
  const existing =
    await members.findOne({
      _id: memberId,
    });

  if (!existing) {
    throw new Error(
      "Member not found."
    );
  }

  /*
   * Remove protected fields.
   */
  const {
    _id:
      _ignoredId,

    membershipNumber:
      _ignoredMembershipNumber,

    createdAt:
      _ignoredCreatedAt,

    createdBy:
      _ignoredCreatedBy,

    updatedAt:
      _ignoredUpdatedAt,

    updatedBy:
      _ignoredUpdatedBy,

    ...editableData
  } = data;

  /*
   * Normalize editable fields.
   */
  const normalized =
    normalizeMember(
      editableData
    );

  /*
   * Existing application member.
   */
  const existingMember =
    toMember(existing);

  const now =
    new Date().toISOString();

  /*
   * Build complete member for validation.
   */
  const merged: Member = {
    ...existingMember,

    ...normalized,

    /*
     * Protected identity.
     */
    _id:
      existingMember._id,

    membershipNumber:
      existingMember.membershipNumber,

    createdAt:
      existingMember.createdAt,

    createdBy:
      existingMember.createdBy,

    updatedAt:
      now,

    updatedBy:
      actor,
  };

  /*
   * VALIDATE
   */
  const validation =
    validateMember(
      merged
    );

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  /*
   * DUPLICATE PHONE
   */
  if (normalized.phone) {
    const duplicate =
      await members.findOne({
        phone:
          normalized.phone,

        _id: {
          $ne:
            memberId,
        },
      });

    if (duplicate) {
      throw new Error(
        "Another member already uses this phone number."
      );
    }
  }

  /*
   * DUPLICATE EMAIL
   */
  if (normalized.email) {
    const duplicate =
      await members.findOne({
        email:
          normalized.email,

        _id: {
          $ne:
            memberId,
        },
      });

    if (duplicate) {
      throw new Error(
        "Another member already uses this email."
      );
    }
  }

  /*
   * DUPLICATE NATIONAL ID
   */
  if (normalized.nationalId) {
    const duplicate =
      await members.findOne({
        nationalId:
          normalized.nationalId,

        _id: {
          $ne:
            memberId,
        },
      });

    if (duplicate) {
      throw new Error(
        "Another member already uses this national ID."
      );
    }
  }

  /*
   * Remove protected fields before MongoDB update.
   */
  const {
    _id:
      _removeId,

    membershipNumber:
      _removeMembershipNumber,

    createdAt:
      _removeCreatedAt,

    createdBy:
      _removeCreatedBy,

    ...safeUpdateData
  } = normalized;

  const updateData:
    Partial<MemberDocument> & {
      updatedAt: string;

      updatedBy: string;
    } = {
    ...safeUpdateData,

    updatedAt:
      now,

    updatedBy:
      actor,
  };

  /*
   * UPDATE
   */
  try {
    const result =
      await members.updateOne(
        {
          _id:
            memberId,
        },

        {
          $set:
            updateData,
        }
      );

    if (
      result.matchedCount === 0
    ) {
      throw new Error(
        "Member not found."
      );
    }

  } catch (error) {
    if (
      isDuplicateKeyError(error)
    ) {
      throw new Error(
        "A member with one of the supplied unique details already exists."
      );
    }

    throw error;
  }

  /*
   * GET UPDATED MEMBER
   */
  const updated =
    await members.findOne({
      _id:
        memberId,
    });

  if (!updated) {
    throw new Error(
      "Member was updated but could not be retrieved."
    );
  }

  return toMember(
    updated
  );
}

/* =========================================================
   DEACTIVATE MEMBER
========================================================= */

/**
 * NEVER permanently delete a member.
 *
 * Deactivation preserves all historical relationships.
 *
 * Only the member status changes.
 *
 * The savings account is NOT deleted.
 */
export async function deactivateMember(
  id: string,
  updatedBy?: string
): Promise<Member> {
  if (!ObjectId.isValid(id)) {
    throw new Error(
      "Invalid member ID."
    );
  }

  const actor =
    normalizeActor(updatedBy);

  const memberId =
    createObjectId(id);

  const {
    members,
  } = await getCollections();

  const existing =
    await members.findOne({
      _id:
        memberId,
    });

  if (!existing) {
    throw new Error(
      "Member not found."
    );
  }

  /*
   * Already inactive.
   */
  if (
    existing.status ===
    "inactive"
  ) {
    return toMember(
      existing
    );
  }

  const now =
    new Date().toISOString();

  const result =
    await members.updateOne(
      {
        _id:
          memberId,
      },

      {
        $set: {
          status:
            "inactive",

          updatedAt:
            now,

          updatedBy:
            actor,
        },
      }
    );

  if (
    result.matchedCount === 0
  ) {
    throw new Error(
      "Member could not be deactivated."
    );
  }

  const updated =
    await members.findOne({
      _id:
        memberId,
    });

  if (!updated) {
    throw new Error(
      "Member was deactivated but could not be retrieved."
    );
  }

  /*
   * DO NOT deactivate/delete the savings account here.
   *
   * Member lifecycle and financial-account lifecycle
   * are deliberately separate.
   */
  return toMember(
    updated
  );
}

/* =========================================================
   DELETE MEMBER - COMPATIBILITY ALIAS
========================================================= */

/**
 * There is NO permanent member deletion.
 *
 * This function exists because an older API route may
 * still import deleteMember().
 *
 * Instead of deleting the MongoDB document, it performs
 * a safe deactivation.
 *
 * Therefore:
 *
 * deleteMember(id)
 *
 * actually means:
 *
 * deactivateMember(id)
 */
export async function deleteMember(
  id: string,
  updatedBy?: string
): Promise<boolean> {
  await deactivateMember(
    id,
    updatedBy
  );

  return true;
}

/* =========================================================
   REACTIVATE MEMBER
========================================================= */

/**
 * Reactivate an inactive member.
 *
 * Original MongoDB _id and membership number remain
 * unchanged.
 */
export async function reactivateMember(
  id: string,
  updatedBy?: string
): Promise<Member> {
  if (!ObjectId.isValid(id)) {
    throw new Error(
      "Invalid member ID."
    );
  }

  const actor =
    normalizeActor(updatedBy);

  const memberId =
    createObjectId(id);

  const {
    members,
  } = await getCollections();

  const existing =
    await members.findOne({
      _id:
        memberId,
    });

  if (!existing) {
    throw new Error(
      "Member not found."
    );
  }

  /*
   * Already active.
   */
  if (
    existing.status ===
    "active"
  ) {
    return toMember(
      existing
    );
  }

  const now =
    new Date().toISOString();

  const result =
    await members.updateOne(
      {
        _id:
          memberId,
      },

      {
        $set: {
          status:
            "active",

          updatedAt:
            now,

          updatedBy:
            actor,
        },
      }
    );

  if (
    result.matchedCount === 0
  ) {
    throw new Error(
      "Member could not be reactivated."
    );
  }

  const updated =
    await members.findOne({
      _id:
        memberId,
    });

  if (!updated) {
    throw new Error(
      "Member was reactivated but could not be retrieved."
    );
  }

  return toMember(
    updated
  );
}

/* =========================================================
   SUSPEND MEMBER
========================================================= */

/**
 * Suspend a member without deleting anything.
 */
export async function suspendMember(
  id: string,
  updatedBy?: string
): Promise<Member> {
  if (!ObjectId.isValid(id)) {
    throw new Error(
      "Invalid member ID."
    );
  }

  const actor =
    normalizeActor(updatedBy);

  const memberId =
    createObjectId(id);

  const {
    members,
  } = await getCollections();

  const existing =
    await members.findOne({
      _id:
        memberId,
    });

  if (!existing) {
    throw new Error(
      "Member not found."
    );
  }

  /*
   * Already suspended.
   */
  if (
    existing.status ===
    "suspended"
  ) {
    return toMember(
      existing
    );
  }

  const now =
    new Date().toISOString();

  const result =
    await members.updateOne(
      {
        _id:
          memberId,
      },

      {
        $set: {
          status:
            "suspended",

          updatedAt:
            now,

          updatedBy:
            actor,
        },
      }
    );

  if (
    result.matchedCount === 0
  ) {
    throw new Error(
      "Member could not be suspended."
    );
  }

  const updated =
    await members.findOne({
      _id:
        memberId,
    });

  if (!updated) {
    throw new Error(
      "Member was suspended but could not be retrieved."
    );
  }

  return toMember(
    updated
  );
}

/* =========================================================
   SEARCH MEMBERS
========================================================= */

export async function searchMembers(
  query: string,
  options: Omit<
    GetMembersOptions,
    "search"
  > = {}
): Promise<PaginatedMembers> {
  return getMembers({
    ...options,

    search:
      query,
  });
}