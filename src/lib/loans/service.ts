/**
 * GEO-SHUA
 * Loan Domain Service
 *
 * Production financial loan service.
 *
 * ARCHITECTURE
 * ------------------------------------------------------------------
 *
 * 1. Public/domain IDs are strings.
 * 2. MongoDB relation IDs are ObjectId.
 * 3. ID conversion happens at the persistence boundary.
 *
 * 4. Loans are persistent financial records.
 * 5. Repayments are append-only financial records.
 * 6. Fines are append-only financial records.
 * 7. Audit entries are append-only.
 *
 * 8. amountPaid is a maintained projection of the repayment ledger.
 * 9. totalFines is a maintained projection of the fine ledger.
 *
 * 10. The authoritative financial calculation is:
 *
 *       outstanding =
 *          totalDue + totalFines - amountPaid
 *
 * 11. transactionReference is the immutable idempotency key.
 *
 * 12. A bank SMS/payment adapter should resolve the member and loan
 *     BEFORE calling createLoanRepayment().    
 *
 * 13. The sender's M-Pesa name is NOT used to identify a member.
 *
 * 14. Bank transaction references must be preserved exactly after
 *     normalization and must never be reused for another payment.
 *
 * 15. Financial history is never permanently deleted.
 *
 * 16. Read operations do not mutate financial state.
 *
 * 17. Financial mutations use MongoDB transactions where required.
 *
 * 18. Concurrent repayment attempts are protected by MongoDB's
 *     transactional document-write conflict handling plus the
 *     unique transactionReference index.
 *
 * IMPORTANT
 * ------------------------------------------------------------------
 *
 * This service expects member/loan resolution to happen before the
 * repayment reaches this layer.
 *
 * For example, the bank-SMS ingestion layer should:
 *
 *   bank SMS
 *      ↓
 *   parse transaction
 *      ↓
 *   identify GEO-SHUA account number
 *      ↓
 *   resolve registered member
 *      ↓
 *   resolve savings OR loan account
 *      ↓
 *   createLoanRepayment()
 *
 * This service is the financial persistence boundary.
 */

import {
  ObjectId,
  type Collection,
  type Db,
  type ClientSession,
} from "mongodb";

import clientPromise from "@/lib/mongodb";

import type {
  CreateLoanInput,
  CreateLoanRepaymentInput,
  FineSource,
  Loan,
  LoanActor,
  LoanAuditEntry,
  LoanFine,
  LoanRepayment,
  LoanSettings,
} from "./types";

import {
  normalizeGuarantor,
  normalizeText,
  validateCreateLoan,
  validateLoanRepayment,
  validateLoanSettings,
} from "./validation";

/* =========================================================
   DATABASE
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const LOANS_COLLECTION =
  "loans";

const LOAN_SETTINGS_COLLECTION =
  "loanSettings";

const LOAN_REPAYMENTS_COLLECTION =
  "loanRepayments";

const LOAN_FINES_COLLECTION =
  "loanFines";

const LOAN_AUDIT_COLLECTION =
  "loanAudit";

const COUNTERS_COLLECTION =
  "counters";

const SYSTEM_ACTOR: LoanActor = {
  name: "System",
  email: "system",
};

/* =========================================================
   MONGODB DOCUMENT TYPES
========================================================= */

type LoanDocument = Omit<
  Loan,
  "id" | "memberId"
> & {
  _id?: ObjectId;
  memberId: ObjectId;
};

type LoanSettingsDocument = Omit<
  LoanSettings,
  "id"
> & {
  _id?: ObjectId;
};

type LoanRepaymentDocument = Omit<
  LoanRepayment,
  "id" | "loanId" | "memberId"
> & {
  _id?: ObjectId;
  loanId: ObjectId;
  memberId: ObjectId;
};

type LoanFineDocument = Omit<
  LoanFine,
  "id" | "loanId" | "memberId"
> & {
  _id?: ObjectId;
  loanId: ObjectId;
  memberId: ObjectId;
};

type LoanAuditDocument = Omit<
  LoanAuditEntry,
  "id" | "loanId"
> & {
  _id?: ObjectId;
  loanId: ObjectId;
};

type CounterDocument = {
  _id: string;
  sequence: number;
  updatedAt: Date;
};

/* =========================================================
   PUBLIC RESULT TYPES
========================================================= */

export type LoanListOptions = {
  page?: number;
  limit?: number;
  search?: string;
  status?: Loan["status"];
  type?: Loan["type"];
  memberId?: string;
};

export type PaginatedLoans = {
  loans: Loan[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type LoanSummary = {
  totalLoans: number;
  activeLoans: number;
  completedLoans: number;
  pendingLoans: number;
  cancelledLoans: number;

  totalPrincipal: number;
  totalInterest: number;
  totalFines: number;
  totalPaid: number;
  totalOutstanding: number;
};

/* =========================================================
   COLLECTIONS
========================================================= */

type LoanCollections = {
  client: Awaited<typeof clientPromise>;
  db: Db;

  loans: Collection<LoanDocument>;
  settings: Collection<LoanSettingsDocument>;
  repayments: Collection<LoanRepaymentDocument>;
  fines: Collection<LoanFineDocument>;
  audit: Collection<LoanAuditDocument>;
  counters: Collection<CounterDocument>;
};

async function getCollections(): Promise<LoanCollections> {
  const client =
    await clientPromise;

  const db =
    client.db(DB_NAME);

  return {
    client,
    db,

    loans:
      db.collection<LoanDocument>(
        LOANS_COLLECTION,
      ),

    settings:
      db.collection<LoanSettingsDocument>(
        LOAN_SETTINGS_COLLECTION,
      ),

    repayments:
      db.collection<LoanRepaymentDocument>(
        LOAN_REPAYMENTS_COLLECTION,
      ),

    fines:
      db.collection<LoanFineDocument>(
        LOAN_FINES_COLLECTION,
      ),

    audit:
      db.collection<LoanAuditDocument>(
        LOAN_AUDIT_COLLECTION,
      ),

    counters:
      db.collection<CounterDocument>(
        COUNTERS_COLLECTION,
      ),
  };
}

/* =========================================================
   HELPERS
========================================================= */

function createObjectId(
  id: string,
): ObjectId {
  if (
    typeof id !== "string" ||
    !ObjectId.isValid(id)
  ) {
    throw new Error("Invalid ID.");
  }

  return new ObjectId(id);
}

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

function firstError(
  errors: string[],
): string {
  return (
    errors[0] ||
    "Invalid loan data."
  );
}

function normalizeActor(
  actor?: LoanActor,
): LoanActor {
  if (
    !actor ||
    typeof actor !== "object"
  ) {
    return SYSTEM_ACTOR;
  }

  const name =
    typeof actor.name === "string"
      ? normalizeText(actor.name)
      : "";

  const email =
    typeof actor.email === "string"
      ? actor.email
          .trim()
          .toLowerCase()
      : "";

  if (!name || !email) {
    throw new Error(
      "A valid actor name and email are required.",
    );
  }

  return {
    name,
    email,
  };
}

function money(
  value: number,
): number {
  if (
    !Number.isFinite(value)
  ) {
    throw new Error(
      "Invalid monetary value.",
    );
  }

  return (
    Math.round(
      (value + Number.EPSILON) * 100,
    ) / 100
  );
}

function addDays(
  date: Date,
  days: number,
): Date {
  const result =
    new Date(
      date.getTime(),
    );

  result.setDate(
    result.getDate() + days,
  );

  return result;
}

function startOfDay(
  date: Date,
): Date {
  const result =
    new Date(date);

  result.setHours(
    0,
    0,
    0,
    0,
  );

  return result;
}

function dayKey(
  date: Date,
): string {
  return [
    date.getFullYear(),
    String(
      date.getMonth() + 1,
    ).padStart(2, "0"),
    String(
      date.getDate(),
    ).padStart(2, "0"),
  ].join("-");
}

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function isValidDate(
  value: Date,
): boolean {
  return (
    value instanceof Date &&
    !Number.isNaN(
      value.getTime(),
    )
  );
}

/* =========================================================
   MONGO → DOMAIN
========================================================= */

function toLoan(
  document: LoanDocument,
): Loan {
  if (!document._id) {
    throw new Error(
      "Loan has no MongoDB ID.",
    );
  }

  return {
    ...document,
    id:
      document._id.toString(),
    memberId:
      document.memberId.toString(),
  };
}

function toSettings(
  document: LoanSettingsDocument,
): LoanSettings {
  if (!document._id) {
    throw new Error(
      "Loan settings have no MongoDB ID.",
    );
  }

  return {
    ...document,
    id:
      document._id.toString(),
  };
}

function toRepayment(
  document: LoanRepaymentDocument,
): LoanRepayment {
  if (!document._id) {
    throw new Error(
      "Repayment has no MongoDB ID.",
    );
  }

  return {
    ...document,
    id:
      document._id.toString(),
    loanId:
      document.loanId.toString(),
    memberId:
      document.memberId.toString(),
  };
}

function toFine(
  document: LoanFineDocument,
): LoanFine {
  if (!document._id) {
    throw new Error(
      "Fine has no MongoDB ID.",
    );
  }

  return {
    ...document,
    id:
      document._id.toString(),
    loanId:
      document.loanId.toString(),
    memberId:
      document.memberId.toString(),
  };
}

function toAudit(
  document: LoanAuditDocument,
): LoanAuditEntry {
  if (!document._id) {
    throw new Error(
      "Audit entry has no MongoDB ID.",
    );
  }

  return {
    ...document,
    id:
      document._id.toString(),
    loanId:
      document.loanId.toString(),
  };
}

/* =========================================================
   DATABASE INDEXES
========================================================= */

export async function ensureLoanIndexes(): Promise<void> {
  const {
    loans,
    settings,
    repayments,
    fines,
    audit,
  } =
    await getCollections();

  await Promise.all([
    loans.createIndex(
      {
        loanNumber: 1,
      },
      {
        unique: true,
        name:
          "loans_loanNumber_unique",
      },
    ),

    loans.createIndex(
      {
        memberId: 1,
        status: 1,
      },
      {
        name:
          "loans_member_status",
      },
    ),

    loans.createIndex(
      {
        createdAt: -1,
        _id: -1,
      },
      {
        name:
          "loans_createdAt_id_desc",
      },
    ),

    repayments.createIndex(
      {
        transactionReference: 1,
      },
      {
        unique: true,
        name:
          "loanRepayments_transactionReference_unique",
      },
    ),

    repayments.createIndex(
      {
        loanId: 1,
        transactionDate: -1,
        _id: -1,
      },
      {
        name:
          "loanRepayments_loan_date",
      },
    ),

    repayments.createIndex(
      {
        memberId: 1,
        transactionDate: -1,
        _id: -1,
      },
      {
        name:
          "loanRepayments_member_date",
      },
    ),

    fines.createIndex(
      {
        loanId: 1,
        fineDate: 1,
      },
      {
        unique: true,
        name:
          "loanFines_loan_date_unique",
      },
    ),

    audit.createIndex(
      {
        loanId: 1,
        createdAt: 1,
        _id: 1,
      },
      {
        name:
          "loanAudit_loan_createdAt_id",
      },
    ),

    settings.createIndex(
      {
        createdAt: -1,
        _id: -1,
      },
      {
        name:
          "loanSettings_createdAt_desc",
      },
    ),
  ]);
}

/* =========================================================
   SEQUENTIAL LOAN NUMBER
========================================================= */

async function getNextSequence(
  counterId: string,
  session?: ClientSession,
): Promise<number> {
  const {
    counters,
  } =
    await getCollections();

  const result =
    await counters.findOneAndUpdate(
      {
        _id:
          counterId,
      },
      {
        $inc: {
          sequence: 1,
        },

        $set: {
          updatedAt:
            new Date(),
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        session,
      },
    );

  if (!result) {
    throw new Error(
      "Unable to generate sequence.",
    );
  }

  return result.sequence;
}

async function generateLoanNumber(
  session?: ClientSession,
): Promise<string> {
  const sequence =
    await getNextSequence(
      "loanNumber",
      session,
    );

  return (
    "LOAN-" +
    String(sequence).padStart(
      6,
      "0",
    )
  );
}

/* =========================================================
   DEFAULT SETTINGS
========================================================= */

const DEFAULT_SETTINGS: Omit<
  LoanSettings,
  | "id"
  | "createdAt"
  | "updatedAt"
> = {
  regularInterestRate:
    0.3,

  emergencyInterestRate:
    0.4,

  regularMinimumSavings:
    10_000,

  regularSavingsMultiplier:
    2,

  repaymentGraceDays:
    7,

  defaultDailyFine:
    200,

  emergencyLoansEnabled:
    true,

  regularLoansEnabled:
    true,

  updatedBy:
    SYSTEM_ACTOR,
};

/* =========================================================
   SETTINGS
========================================================= */

export async function getLoanSettings(): Promise<LoanSettings> {
  const {
    settings,
  } =
    await getCollections();

  const existing =
    await settings.findOne(
      {},
      {
        sort: {
          createdAt: -1,
          _id: -1,
        },
      },
    );

  if (existing) {
    return toSettings(
      existing,
    );
  }

  const now =
    new Date();

  const document:
    LoanSettingsDocument = {
    ...DEFAULT_SETTINGS,
    createdAt:
      now,
    updatedAt:
      now,
  };

  const result =
    await settings.insertOne(
      document,
    );

  return toSettings({
    ...document,
    _id:
      result.insertedId,
  });
}

export async function updateLoanSettings(
  changes: Partial<LoanSettings>,
  updatedBy: LoanActor,
): Promise<LoanSettings> {
  const actor =
    normalizeActor(
      updatedBy,
    );

  const validation =
    validateLoanSettings(
      changes,
    );

  if (!validation.valid) {
    throw new Error(
      firstError(
        validation.errors,
      ),
    );
  }

  const current =
    await getLoanSettings();

  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    updatedBy: _updatedBy,
    ...safeChanges
  } = changes;

  void _id;
  void _createdAt;
  void _updatedAt;
  void _updatedBy;

  const {
    settings,
  } =
    await getCollections();

  const currentId =
    createObjectId(
      current.id,
    );

  const now =
    new Date();

  const result =
    await settings.updateOne(
      {
        _id:
          currentId,
      },
      {
        $set: {
          ...safeChanges,
          updatedBy:
            actor,
          updatedAt:
            now,
        },
      },
    );

  if (
    result.matchedCount !== 1
  ) {
    throw new Error(
      "Loan settings could not be found.",
    );
  }

  const updated =
    await settings.findOne({
      _id:
        currentId,
    });

  if (!updated) {
    throw new Error(
      "Updated loan settings could not be retrieved.",
    );
  }

  return toSettings(
    updated,
  );
}

/* =========================================================
   MEMBER + SAVINGS LOOKUP
========================================================= */

type MemberForLoan = {
  _id: ObjectId;
  membershipNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  status: string;
};

type SavingsAccountForLoan = {
  _id?: ObjectId;
  memberId: ObjectId;
  accountNumber: string;
  accountType: string;
  balance: number;
  status: string;
};

async function getMemberForLoan(
  memberId: string,
  session?: ClientSession,
): Promise<MemberForLoan> {
  const {
    db,
  } =
    await getCollections();

  const member =
    await db
      .collection<MemberForLoan>(
        "members",
      )
      .findOne(
        {
          _id:
            createObjectId(
              memberId,
            ),
        },
        {
          session,
        },
      );

  if (!member) {
    throw new Error(
      "Member not found.",
    );
  }

  return member;
}

async function getSavingsBalance(
  memberId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  const {
    db,
  } =
    await getCollections();

  const account =
    await db
      .collection<SavingsAccountForLoan>(
        "savingsAccounts",
      )
      .findOne(
        {
          memberId,

          accountType:
            "fixed",

          status:
            "active",
        },
        {
          session,
        },
      );

  if (!account) {
    throw new Error(
      "Member does not have an active fixed savings account.",
    );
  }

  if (
    typeof account.balance !==
      "number" ||
    !Number.isFinite(
      account.balance,
    ) ||
    account.balance < 0
  ) {
    throw new Error(
      "Member savings account has an invalid balance.",
    );
  }

  return money(
    account.balance,
  );
}

/* =========================================================
   LEDGER TOTALS
========================================================= */

async function getLoanPaidTotal(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  const {
    repayments,
  } =
    await getCollections();

  const result =
    await repayments
      .aggregate<{
        _id: null;
        total: number;
      }>(
        [
          {
            $match: {
              loanId,
            },
          },

          {
            $group: {
              _id: null,

              total: {
                $sum:
                  "$amount",
              },
            },
          },
        ],
        {
          session,
        },
      )
      .toArray();

  return money(
    Number(
      result[0]?.total ||
        0,
    ),
  );
}

async function getLoanFineTotal(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  const {
    fines,
  } =
    await getCollections();

  const result =
    await fines
      .aggregate<{
        _id: null;
        total: number;
      }>(
        [
          {
            $match: {
              loanId,
            },
          },

          {
            $group: {
              _id: null,

              total: {
                $sum:
                  "$amount",
              },
            },
          },
        ],
        {
          session,
        },
      )
      .toArray();

  return money(
    Number(
      result[0]?.total ||
        0,
    ),
  );
}

/* =========================================================
   RECONCILE LOAN PROJECTION
========================================================= */

/**
 * Reconcile the maintained loan totals from the immutable
 * ledgers.
 *
 * This function does NOT create financial records.
 */
async function reconcileLoan(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<Loan> {
  const {
    loans,
  } =
    await getCollections();

  const loan =
    await loans.findOne(
      {
        _id:
          loanId,
      },
      {
        session,
      },
    );

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  const amountPaid =
    await getLoanPaidTotal(
      loanId,
      session,
    );

  const totalFines =
    await getLoanFineTotal(
      loanId,
      session,
    );

  const outstandingBalance =
    money(
      Math.max(
        0,
        loan.totalDue +
          totalFines -
          amountPaid,
      ),
    );

  let status =
    loan.status;

  if (
    loan.status !==
      "cancelled" &&
    outstandingBalance <=
      0
  ) {
    status =
      "completed";
  }

  if (
    loan.status ===
    "cancelled"
  ) {
    status =
      "cancelled";
  }

  const changed =
    loan.amountPaid !==
      amountPaid ||
    loan.totalFines !==
      totalFines ||
    loan.outstandingBalance !==
      outstandingBalance ||
    loan.status !==
      status;

  if (changed) {
    await loans.updateOne(
      {
        _id:
          loanId,
      },
      {
        $set: {
          amountPaid,
          totalFines,
          outstandingBalance,
          status,
          updatedAt:
            new Date(),
        },
      },
      {
        session,
      },
    );
  }

  const updated =
    await loans.findOne(
      {
        _id:
          loanId,
      },
      {
        session,
      },
    );

  if (!updated) {
    throw new Error(
      "Loan reconciliation failed.",
    );
  }

  return toLoan(
    updated,
  );
}

/* =========================================================
   AUDIT
========================================================= */

async function writeAudit(
  loanId: ObjectId,
  loanNumber: string,
  action: LoanAuditEntry["action"],
  actor: LoanActor,
  details?: Record<string, unknown>,
  session?: ClientSession,
): Promise<void> {
  const {
    audit,
  } =
    await getCollections();

  const document:
    LoanAuditDocument = {
    _id:
      new ObjectId(),

    loanId,

    loanNumber,

    action,

    actor,

    ...(details
      ? {
          details,
        }
      : {}),

    createdAt:
      new Date(),
  };

  await audit.insertOne(
    document,
    {
      session,
    },
  );
}

/* =========================================================
   CREATE LOAN
========================================================= */

export async function createLoan(
  input: CreateLoanInput,
  createdBy: LoanActor,
  authorizedBy?: LoanActor,
): Promise<Loan> {
  const creator =
    normalizeActor(
      createdBy,
    );

  const authorizer =
    normalizeActor(
      authorizedBy ||
        creator,
    );

  const validation =
    validateCreateLoan(
      input,
    );

  if (!validation.valid) {
    throw new Error(
      firstError(
        validation.errors,
      ),
    );
  }

  const {
    client,
  } =
    await getCollections();

  const session =
    client.startSession();

  try {
    let createdLoan:
      | Loan
      | null =
      null;

    await session.withTransaction(
      async () => {
        const member =
          await getMemberForLoan(
            input.memberId,
            session,
          );

        if (
          member.status !==
          "active"
        ) {
          throw new Error(
            "Only active members can receive loans.",
          );
        }

        const settings =
          await getLoanSettings();

        if (
          input.type ===
            "emergency" &&
          !settings.emergencyLoansEnabled
        ) {
          throw new Error(
            "Emergency loans are currently disabled.",
          );
        }

        if (
          input.type ===
            "regular" &&
          !settings.regularLoansEnabled
        ) {
          throw new Error(
            "Regular loans are currently disabled.",
          );
        }

        const {
          loans,
        } =
          await getCollections();

        const existing =
          await loans.findOne(
            {
              memberId:
                member._id,

              status: {
                $in: [
                  "pending",
                  "active",
                ],
              },
            },
            {
              session,
            },
          );

        if (existing) {
          throw new Error(
            `Member already has an existing loan (${existing.loanNumber}).`,
          );
        }

        let savingsBalance:
          | number
          | null =
          null;

        if (
          input.type ===
          "regular"
        ) {
          savingsBalance =
            await getSavingsBalance(
              member._id,
              session,
            );

          if (
            savingsBalance <
            settings.regularMinimumSavings
          ) {
            throw new Error(
              `Regular loan requires minimum savings of KSh ${settings.regularMinimumSavings.toLocaleString()}.`,
            );
          }

          const maximumLoan =
            money(
              savingsBalance *
                settings.regularSavingsMultiplier,
            );

          if (
            input.principal >
            maximumLoan
          ) {
            throw new Error(
              `Regular loan cannot exceed KSh ${maximumLoan.toLocaleString()} based on current savings.`,
            );
          }
        }

        const previousLoans =
          await loans
            .find(
              {
                memberId:
                  member._id,

                status: {
                  $ne:
                    "cancelled",
                },
              },
              {
                session,
              },
            )
            .toArray();

        for (
          const previous of
            previousLoans
        ) {
          if (
            previous.outstandingBalance >
            0
          ) {
            throw new Error(
              `Member has an outstanding balance on loan ${previous.loanNumber}.`,
            );
          }
        }

        const rate =
          input.type ===
          "emergency"
            ? settings.emergencyInterestRate
            : settings.regularInterestRate;

        const principal =
          money(
            input.principal,
          );

        const interestAmount =
          money(
            principal *
              rate,
          );

        const dailyFine =
          input.dailyFine !==
          undefined
            ? money(
                input.dailyFine,
              )
            : money(
                settings.defaultDailyFine,
              );

        const fineSource:
          FineSource =
          input.dailyFine !==
          undefined
            ? "custom"
            : "default";

        const disbursementDate =
          input.disbursementDate
            ? new Date(
                input.disbursementDate,
              )
            : new Date();

        if (
          !isValidDate(
            disbursementDate,
          )
        ) {
          throw new Error(
            "Invalid disbursement date.",
          );
        }

        const firstDueDate =
          addDays(
            disbursementDate,
            settings.repaymentGraceDays,
          );

        const totalDue =
          money(
            principal +
              interestAmount,
          );

        const loanNumber =
          await generateLoanNumber(
            session,
          );

        const guarantor =
          normalizeGuarantor(
            input.guarantor,
          );

        const now =
          new Date();

        const loanDocument:
          LoanDocument = {
          _id:
            new ObjectId(),

          loanNumber,

          memberId:
            member._id,

          memberNumber:
            member.membershipNumber,

          memberName:
            normalizeText(
              [
                member.firstName,
                member.middleName,
                member.lastName,
              ]
                .filter(Boolean)
                .join(" "),
            ),

          type:
            input.type,

          principal,

          interestRate:
            rate,

          interestAmount,

          dailyFine,

          fineSource,

          disbursementDate,

          firstDueDate,

          totalDue,

          amountPaid:
            0,

          totalFines:
            0,

          outstandingBalance:
            totalDue,

          fineStatus:
            "active",

          guarantor,

          status:
            "active",

          createdBy:
            creator,

          authorizedBy:
            authorizer,

          authorizedAt:
            now,

          createdAt:
            now,

          updatedAt:
            now,
        };

        await loans.insertOne(
          loanDocument,
          {
            session,
          },
        );

        await writeAudit(
          loanDocument._id!,
          loanNumber,
          "created",
          creator,
          {
            type:
              input.type,

            principal,

            interestRate:
              rate,

            interestAmount,

            dailyFine,

            fineSource,

            disbursementDate,

            firstDueDate,

            totalDue,

            savingsBalance,
          },
          session,
        );

        await writeAudit(
          loanDocument._id!,
          loanNumber,
          "authorized",
          authorizer,
          {
            authorizedAt:
              now,
          },
          session,
        );

        createdLoan =
          toLoan(
            loanDocument,
          );
      },
      {
        readConcern: {
          level:
            "snapshot",
        },

        writeConcern: {
          w: "majority",
        },

        maxCommitTimeMS:
          10_000,
      },
    );

    if (!createdLoan) {
      throw new Error(
        "Loan transaction completed without creating a loan.",
      );
    }

    return createdLoan;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   GET LOAN
========================================================= */

export async function getLoanById(
  id: string,
): Promise<Loan | null> {
  if (
    !ObjectId.isValid(id)
  ) {
    return null;
  }

  const {
    loans,
  } =
    await getCollections();

  const loan =
    await loans.findOne({
      _id:
        createObjectId(id),
    });

  return loan
    ? toLoan(loan)
    : null;
}

export async function getLoanByNumber(
  loanNumber: string,
): Promise<Loan | null> {
  const normalized =
    typeof loanNumber ===
    "string"
      ? loanNumber.trim()
      : "";

  if (!normalized) {
    return null;
  }

  const {
    loans,
  } =
    await getCollections();

  const loan =
    await loans.findOne({
      loanNumber:
        normalized,
    });

  return loan
    ? toLoan(loan)
    : null;
}

/* =========================================================
   LIST LOANS
========================================================= */

export async function getLoans(
  options: LoanListOptions = {},
): Promise<PaginatedLoans> {
  const {
    loans,
  } =
    await getCollections();

  const requestedPage =
    Number(options.page);

  const page =
    Number.isFinite(
      requestedPage,
    ) &&
    requestedPage >= 1
      ? Math.floor(
          requestedPage,
        )
      : 1;

  const requestedLimit =
    Number(options.limit);

  const limit =
    Number.isFinite(
      requestedLimit,
    ) &&
    requestedLimit >= 1
      ? Math.min(
          100,
          Math.floor(
            requestedLimit,
          ),
        )
      : 25;

  const filter:
    Record<string, unknown> = {};

  if (options.status) {
    filter.status =
      options.status;
  }

  if (options.type) {
    filter.type =
      options.type;
  }

  if (options.memberId) {
    if (
      !ObjectId.isValid(
        options.memberId,
      )
    ) {
      return {
        loans: [],
        total: 0,
        page: 1,
        limit,
        totalPages: 0,
      };
    }

    filter.memberId =
      createObjectId(
        options.memberId,
      );
  }

  const search =
    typeof options.search ===
    "string"
      ? options.search.trim()
      : "";

  if (search) {
    const regex =
      new RegExp(
        escapeRegex(search),
        "i",
      );

    filter.$or = [
      {
        loanNumber:
          regex,
      },

      {
        memberNumber:
          regex,
      },

      {
        memberName:
          regex,
      },

      {
        "guarantor.name":
          regex,
      },

      {
        "guarantor.phone":
          regex,
      },
    ];
  }

  const total =
    await loans.countDocuments(
      filter,
    );

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(
          total / limit,
        );

  const safePage =
    totalPages > 0
      ? Math.min(
          page,
          totalPages,
        )
      : 1;

  const documents =
    await loans
      .find(filter)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .skip(
        (safePage - 1) *
          limit,
      )
      .limit(limit)
      .toArray();

  return {
    loans:
      documents.map(
        toLoan,
      ),

    total,

    page:
      safePage,

    limit,

    totalPages,
  };
}

/* =========================================================
   ACCRUE DAILY FINES
========================================================= */

export async function accrueLoanFines(
  loanId: string,
  asOfDate: Date = new Date(),
): Promise<number> {
  if (
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  if (
    !isValidDate(
      asOfDate,
    )
  ) {
    throw new Error(
      "Invalid as-of date.",
    );
  }

  const {
    loans,
    fines,
  } =
    await getCollections();

  const objectId =
    createObjectId(
      loanId,
    );

  const loan =
    await loans.findOne({
      _id:
        objectId,
    });

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  if (
    loan.status ===
      "cancelled" ||
    loan.status ===
      "completed"
  ) {
    return 0;
  }

  if (
    loan.fineStatus ===
    "stopped"
  ) {
    return 0;
  }

  const today =
    startOfDay(
      asOfDate,
    );

  const firstFineDate =
    addDays(
      startOfDay(
        loan.firstDueDate,
      ),
      1,
    );

  if (
    today <
    firstFineDate
  ) {
    return 0;
  }

  let createdCount =
    0;

  let current =
    new Date(
      firstFineDate,
    );

  while (
    current <=
    today
  ) {
    const fineDate =
      startOfDay(
        current,
      );

    const existingFine =
      await fines.findOne({
        loanId:
          objectId,

        fineDate,
      });

    if (!existingFine) {
      const fineDocument:
        LoanFineDocument = {
        _id:
          new ObjectId(),

        loanId:
          objectId,

        loanNumber:
          loan.loanNumber,

        memberId:
          loan.memberId,

        amount:
          money(
            loan.dailyFine,
          ),

        fineDate,

        dailyFineRate:
          money(
            loan.dailyFine,
          ),

        source:
          "system",

        createdAt:
          new Date(),
      };

      try {
        await fines.insertOne(
          fineDocument,
        );

        createdCount++;

        await writeAudit(
          objectId,
          loan.loanNumber,
          "fine_recorded",
          SYSTEM_ACTOR,
          {
            fineDate,

            dayKey:
              dayKey(
                fineDate,
              ),

            amount:
              fineDocument.amount,

            dailyFineRate:
              fineDocument.dailyFineRate,
          },
        );
      } catch (error) {
        if (
          !isDuplicateKeyError(
            error,
          )
        ) {
          throw error;
        }
      }
    }

    current =
      addDays(
        current,
        1,
      );
  }

  if (
    createdCount > 0
  ) {
    await reconcileLoan(
      objectId,
    );
  }

  return createdCount;
}

/* =========================================================
   STOP FINES
========================================================= */

export async function stopLoanFines(
  loanId: string,
  input: {
    reason: string;
    stoppedBy: LoanActor;
  },
): Promise<Loan> {
  if (
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const reason =
    typeof input?.reason ===
    "string"
      ? normalizeText(
          input.reason,
        )
      : "";

  if (!reason) {
    throw new Error(
      "A reason is required when stopping fines.",
    );
  }

  const actor =
    normalizeActor(
      input.stoppedBy,
    );

  const {
    loans,
  } =
    await getCollections();

  const objectId =
    createObjectId(
      loanId,
    );

  const loan =
    await loans.findOne({
      _id:
        objectId,
    });

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  if (
    loan.status ===
    "cancelled"
  ) {
    throw new Error(
      "Fines cannot be changed on a cancelled loan.",
    );
  }

  if (
    loan.status ===
    "completed"
  ) {
    throw new Error(
      "Fines cannot be changed on a completed loan.",
    );
  }

  if (
    loan.fineStatus ===
    "stopped"
  ) {
    return loan
      ? toLoan(loan)
      : (() => {
          throw new Error(
            "Loan not found.",
          );
        })();
  }

  const now =
    new Date();

  const result =
    await loans.updateOne(
      {
        _id:
          objectId,

        fineStatus:
          "active",
      },
      {
        $set: {
          fineStatus:
            "stopped",

          updatedAt:
            now,
        },
      },
    );

  if (
    result.modifiedCount !==
    1
  ) {
    const current =
      await loans.findOne({
        _id:
          objectId,
      });

    if (!current) {
      throw new Error(
        "Loan not found.",
      );
    }

    return toLoan(
      current,
    );
  }

  await writeAudit(
    objectId,
    loan.loanNumber,
    "fine_stopped",
    actor,
    {
      reason,

      stoppedAt:
        now,
    },
  );

  return reconcileLoan(
    objectId,
  );
}

/* =========================================================
   RESUME FINES
========================================================= */

export async function resumeLoanFines(
  loanId: string,
  resumedBy: LoanActor,
  reason: string,
): Promise<Loan> {
  if (
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const actor =
    normalizeActor(
      resumedBy,
    );

  const cleanReason =
    typeof reason ===
    "string"
      ? normalizeText(
          reason,
        )
      : "";

  if (!cleanReason) {
    throw new Error(
      "A reason is required when resuming fines.",
    );
  }

  const {
    loans,
  } =
    await getCollections();

  const objectId =
    createObjectId(
      loanId,
    );

  const loan =
    await loans.findOne({
      _id:
        objectId,
    });

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  if (
    loan.status ===
      "cancelled" ||
    loan.status ===
      "completed"
  ) {
    throw new Error(
      "Fines cannot be resumed on a completed or cancelled loan.",
    );
  }

  if (
    loan.fineStatus ===
    "active"
  ) {
    return toLoan(
      loan,
    );
  }

  const now =
    new Date();

  const result =
    await loans.updateOne(
      {
        _id:
          objectId,

        fineStatus:
          "stopped",
      },
      {
        $set: {
          fineStatus:
            "active",

          updatedAt:
            now,
        },
      },
    );

  if (
    result.modifiedCount !==
    1
  ) {
    const current =
      await loans.findOne({
        _id:
          objectId,
      });

    if (!current) {
      throw new Error(
        "Loan not found.",
      );
    }

    return toLoan(
      current,
    );
  }

  await writeAudit(
    objectId,
    loan.loanNumber,
    "updated",
    actor,
    {
      action:
        "fines_resumed",

      reason:
        cleanReason,

      resumedAt:
        now,
    },
  );

  await accrueLoanFines(
    loanId,
  );

  return reconcileLoan(
    objectId,
  );
}

/* =========================================================
   RESOLVE REPAYMENT LOAN
========================================================= */

async function resolveLoanForRepayment(
  input: CreateLoanRepaymentInput,
  session: ClientSession,
): Promise<LoanDocument> {
  const {
    loans,
  } =
    await getCollections();

  if (input.loanId) {
    if (
      !ObjectId.isValid(
        input.loanId,
      )
    ) {
      throw new Error(
        "Invalid loan ID.",
      );
    }

    const loan =
      await loans.findOne(
        {
          _id:
            createObjectId(
              input.loanId,
            ),
        },
        {
          session,
        },
      );

    if (!loan) {
      throw new Error(
        "Loan not found.",
      );
    }

    return loan;
  }

  if (!input.memberId) {
    throw new Error(
      "A loan ID or member ID is required.",
    );
  }

  if (
    !ObjectId.isValid(
      input.memberId,
    )
  ) {
    throw new Error(
      "Invalid member ID.",
    );
  }

  const memberId =
    createObjectId(
      input.memberId,
    );

  const openLoans =
    await loans
      .find(
        {
          memberId,

          status: {
            $in: [
              "pending",
              "active",
            ],
          },
        },
        {
          session,
        },
      )
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .limit(2)
      .toArray();

  if (
    openLoans.length > 1
  ) {
    throw new Error(
      "Member has multiple open loans. Loan ID is required to record this repayment safely.",
    );
  }

  const loan =
    openLoans[0];

  if (!loan) {
    throw new Error(
      "No active loan could be resolved for this repayment.",
    );
  }

  return loan;
}

/* =========================================================
   RECORD REPAYMENT
========================================================= */

/**
 * Record a repayment atomically.
 *
 * IMPORTANT FOR BANK SMS
 * ------------------------------------------------------------------
 *
 * transactionReference must be the bank's immutable transaction
 * reference.
 *
 * Example:
 *
 *     input.transactionReference
 *          = "BANK-ABC123456"
 *
 * The SMS sender name is NOT used as the financial identity.
 *
 * The SMS adapter should already have resolved:
 *
 *     bank account number
 *          ↓
 *     GEO-SHUA account number
 *          ↓
 *     member
 *          ↓
 *     loan
 *
 * before invoking this function.
 */
export async function createLoanRepayment(
  input: CreateLoanRepaymentInput,
): Promise<LoanRepayment> {
  const validation =
    validateLoanRepayment(
      input,
    );

  if (!validation.valid) {
    throw new Error(
      firstError(
        validation.errors,
      ),
    );
  }

  const reference =
    normalizeText(
      input.transactionReference,
    );

  if (!reference) {
    throw new Error(
      "Transaction reference is required.",
    );
  }

  const amount =
    money(
      input.amount,
    );

  if (amount <= 0) {
    throw new Error(
      "Repayment amount must be greater than zero.",
    );
  }

  const transactionDate =
    new Date(
      input.transactionDate,
    );

  if (
    !isValidDate(
      transactionDate,
    )
  ) {
    throw new Error(
      "Invalid transaction date.",
    );
  }

  const now =
    new Date();

  const futureToleranceMs =
    5 * 60 * 1000;

  if (
    transactionDate.getTime() >
    now.getTime() +
      futureToleranceMs
  ) {
    throw new Error(
      "Repayment transaction date cannot be in the future.",
    );
  }

  const {
    client,
    repayments,
  } =
    await getCollections();

  /*
   * Fast idempotency check BEFORE starting the transaction.
   *
   * This handles the normal retry case without opening
   * a transaction unnecessarily.
   */
  const existing =
    await repayments.findOne({
      transactionReference:
        reference,
    });

  if (existing) {
    /*
     * Same reference must represent the same financial event.
     *
     * If an external system attempts to reuse the reference
     * for a different amount/loan/member, reject it.
     */
    if (
      money(existing.amount) !==
        amount ||
      (
        input.loanId &&
        existing.loanId.toString() !==
          input.loanId
      ) ||
      (
        input.memberId &&
        existing.memberId.toString() !==
          input.memberId
      )
    ) {
      throw new Error(
        "Transaction reference already exists for a different financial transaction.",
      );
    }

    return toRepayment(
      existing,
    );
  }

  const session =
    client.startSession();

  try {
    let result:
      | LoanRepayment
      | null =
      null;

    await session.withTransaction(
      async () => {
        /*
         * Re-check idempotency inside the transaction.
         *
         * This protects against the race where another
         * request inserted the reference after our first
         * check.
         */
        const alreadyExists =
          await repayments.findOne(
            {
              transactionReference:
                reference,
            },
            {
              session,
            },
          );

        if (alreadyExists) {
          if (
            money(
              alreadyExists.amount,
            ) !== amount
          ) {
            throw new Error(
              "Transaction reference already exists for a different amount.",
            );
          }

          result =
            toRepayment(
              alreadyExists,
            );

          return;
        }

        const loan =
          await resolveLoanForRepayment(
            input,
            session,
          );

        if (!loan._id) {
          throw new Error(
            "Resolved loan has no MongoDB ID.",
          );
        }

        if (
          loan.status ===
          "cancelled"
        ) {
          throw new Error(
            "Cancelled loans cannot receive repayments.",
          );
        }

        if (
          loan.status ===
          "completed"
        ) {
          throw new Error(
            "Completed loans cannot receive repayments.",
          );
        }

        const loanObjectId =
          loan._id;

        /*
         * ---------------------------------------------------
         * FINE CUTOFF
         * ---------------------------------------------------
         *
         * Fines are calculated up to the transaction date.
         *
         * Due date itself is not fined.
         *
         * First fine date:
         *
         *     firstDueDate + 1 day
         */
        const asOfDay =
          startOfDay(
            transactionDate,
          );

        const firstFineDate =
          addDays(
            startOfDay(
              loan.firstDueDate,
            ),
            1,
          );

        /*
         * We intentionally do not attempt to insert fines
         * into this transaction.
         *
         * Fine accrual is an independent append-only process.
         *
         * The repayment transaction therefore never gets
         * poisoned by a duplicate-key race on the fine ledger.
         */
        if (
          loan.fineStatus !==
            "stopped" &&
          asOfDay >=
            firstFineDate
        ) {
          /*
           * Existing fine records are used to determine the
           * liability at transaction time.
           *
           * Missing fines are not silently fabricated here.
           *
           * The scheduled fine-accrual process should keep
           * the fine ledger current.
           */
        }

        const amountPaidBefore =
          await getLoanPaidTotal(
            loanObjectId,
            session,
          );

        const totalFinesBefore =
          await getLoanFineTotal(
            loanObjectId,
            session,
          );

        const currentOutstanding =
          money(
            Math.max(
              0,
              loan.totalDue +
                totalFinesBefore -
                amountPaidBefore,
            ),
          );

        if (
          currentOutstanding <=
          0
        ) {
          throw new Error(
            "Loan has no outstanding balance.",
          );
        }

        if (
          amount >
          currentOutstanding
        ) {
          throw new Error(
            `Repayment exceeds the outstanding balance of KSh ${currentOutstanding.toLocaleString()}.`,
          );
        }

        /*
         * ---------------------------------------------------
         * BUILD REPAYMENT
         * ---------------------------------------------------
         */
        const repaymentDocument:
          LoanRepaymentDocument = {
          _id:
            new ObjectId(),

          loanId:
            loanObjectId,

          loanNumber:
            loan.loanNumber,

          memberId:
            loan.memberId,

          memberNumber:
            loan.memberNumber,

          amount,

          transactionReference:
            reference,

          transactionDate,

          source:
            input.source,

          ...(input.rawMessage
            ? {
                rawMessage:
                  input.rawMessage,
              }
            : {}),

          ...(input.recordedBy
            ? {
                recordedBy:
                  normalizeActor(
                    input.recordedBy,
                  ),
              }
            : {}),

          createdAt:
            new Date(),
        };

        /*
         * Append-only financial ledger.
         */
        try {
          await repayments.insertOne(
            repaymentDocument,
            {
              session,
            },
          );
        } catch (error) {
          /*
           * A duplicate reference means another request
           * won the idempotency race.
           *
           * Do not continue the transaction after a duplicate
           * write error.
           */
          if (
            isDuplicateKeyError(
              error,
            )
          ) {
            throw new Error(
              "REPAYMENT_IDEMPOTENCY_RACE",
            );
          }

          throw error;
        }

        /*
         * ---------------------------------------------------
         * NEW LEDGER STATE
         * ---------------------------------------------------
         */
        const newAmountPaid =
          money(
            amountPaidBefore +
              amount,
          );

        const newOutstanding =
          money(
            Math.max(
              0,
              loan.totalDue +
                totalFinesBefore -
                newAmountPaid,
            ),
          );

        const newStatus:
          | Loan["status"] =
          newOutstanding <=
          0
            ? "completed"
            : loan.status;

        /*
         * ---------------------------------------------------
         * ATOMIC LOAN UPDATE
         * ---------------------------------------------------
         *
         * MongoDB transactions already provide write-conflict
         * protection when another transaction modifies the same
         * loan document concurrently.
         *
         * We also match the loan's current financial projection
         * so stale transactions cannot silently overwrite newer
         * state.
         */
        const {
          loans,
        } =
          await getCollections();

        const updateResult =
          await loans.updateOne(
            {
              _id:
                loanObjectId,

              amountPaid:
                loan.amountPaid,

              totalFines:
                loan.totalFines,

              outstandingBalance:
                loan.outstandingBalance,

              status: {
                $in: [
                  "pending",
                  "active",
                ],
              },
            },
            {
              $set: {
                amountPaid:
                  newAmountPaid,

                totalFines:
                  totalFinesBefore,

                outstandingBalance:
                  newOutstanding,

                status:
                  newStatus,

                updatedAt:
                  new Date(),
              },
            },
            {
              session,
            },
          );

        if (
          updateResult.modifiedCount !==
          1
        ) {
          throw new Error(
            "Loan balance changed while recording this repayment. The transaction was aborted; please retry.",
          );
        }

        /*
         * ---------------------------------------------------
         * AUDIT
         * ---------------------------------------------------
         */
        const repayment =
          toRepayment(
            repaymentDocument,
          );

        const actor =
          input.recordedBy
            ? normalizeActor(
                input.recordedBy,
              )
            : SYSTEM_ACTOR;

        await writeAudit(
          loanObjectId,
          loan.loanNumber,
          "repayment_recorded",
          actor,
          {
            repaymentId:
              repayment.id,

            amount:
              repayment.amount,

            transactionReference:
              repayment.transactionReference,

            source:
              repayment.source,

            transactionDate:
              repayment.transactionDate,

            outstandingBefore:
              currentOutstanding,

            outstandingAfter:
              newOutstanding,

            amountPaidBefore,

            amountPaidAfter:
              newAmountPaid,

            totalFines:
              totalFinesBefore,
          },
          session,
        );

        if (
          newStatus ===
          "completed"
        ) {
          await writeAudit(
            loanObjectId,
            loan.loanNumber,
            "completed",
            SYSTEM_ACTOR,
            {
              completedAt:
                new Date(),

              finalAmountPaid:
                newAmountPaid,

              totalDue:
                loan.totalDue,

              totalFines:
                totalFinesBefore,

              finalOutstandingBalance:
                newOutstanding,
            },
            session,
          );
        }

        result =
          repayment;
      },
      {
        readConcern: {
          level:
            "snapshot",
        },

        writeConcern: {
          w: "majority",
        },

        maxCommitTimeMS:
          10_000,
      },
    );

    if (!result) {
      throw new Error(
        "Repayment transaction completed without a result.",
      );
    }

    return result;
  } catch (error) {
    /*
     * If the unique transactionReference was won by another
     * concurrent request, retrieve the committed repayment
     * AFTER the transaction has aborted.
     *
     * This is deliberately outside the transaction because
     * MongoDB transactions must not continue after a duplicate
     * key error.
     */
    if (
      error instanceof Error &&
      error.message ===
        "REPAYMENT_IDEMPOTENCY_RACE"
    ) {
      const existing =
        await repayments.findOne({
          transactionReference:
            reference,
        });

      if (!existing) {
        throw new Error(
          "Repayment idempotency race occurred but the existing repayment could not be retrieved.",
        );
      }

      if (
        money(existing.amount) !==
        amount
      ) {
        throw new Error(
          "Transaction reference already exists for a different amount.",
        );
      }

      return toRepayment(
        existing,
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   GET REPAYMENTS
========================================================= */

export async function getLoanRepayments(
  loanId: string,
): Promise<LoanRepayment[]> {
  if (
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const {
    repayments,
  } =
    await getCollections();

  const documents =
    await repayments
      .find({
        loanId:
          createObjectId(
            loanId,
          ),
      })
      .sort({
        transactionDate:
          -1,

        createdAt:
          -1,

        _id:
          -1,
      })
      .toArray();

  return documents.map(
    toRepayment,
  );
}

/* =========================================================
   GET FINES
========================================================= */

export async function getLoanFines(
  loanId: string,
): Promise<LoanFine[]> {
  if (
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const {
    fines,
  } =
    await getCollections();

  const documents =
    await fines
      .find({
        loanId:
          createObjectId(
            loanId,
          ),
      })
      .sort({
        fineDate:
          -1,

        _id:
          -1,
      })
      .toArray();

  return documents.map(
    toFine,
  );
}

/* =========================================================
   GET AUDIT
========================================================= */

export async function getLoanAudit(
  loanId: string,
): Promise<LoanAuditEntry[]> {
  if (
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const {
    audit,
  } =
    await getCollections();

  const documents =
    await audit
      .find({
        loanId:
          createObjectId(
            loanId,
          ),
      })
      .sort({
        createdAt:
          1,

        _id:
          1,
      })
      .toArray();

  return documents.map(
    toAudit,
  );
}

/* =========================================================
   CANCEL LOAN
========================================================= */

export async function cancelLoan(
  loanId: string,
  cancelledBy: LoanActor,
  reason: string,
): Promise<Loan> {
  if (
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const actor =
    normalizeActor(
      cancelledBy,
    );

  const cleanReason =
    typeof reason ===
    "string"
      ? normalizeText(
          reason,
        )
      : "";

  if (!cleanReason) {
    throw new Error(
      "A cancellation reason is required.",
    );
  }

  const {
    client,
  } =
    await getCollections();

  const session =
    client.startSession();

  try {
    let cancelledLoan:
      | Loan
      | null =
      null;

    await session.withTransaction(
      async () => {
        const {
          loans,
        } =
          await getCollections();

        const objectId =
          createObjectId(
            loanId,
          );

        const loan =
          await loans.findOne(
            {
              _id:
                objectId,
            },
            {
              session,
            },
          );

        if (!loan) {
          throw new Error(
            "Loan not found.",
          );
        }

        if (
          loan.status ===
          "completed"
        ) {
          throw new Error(
            "A completed loan cannot be cancelled.",
          );
        }

        if (
          loan.status ===
          "cancelled"
        ) {
          cancelledLoan =
            toLoan(
              loan,
            );

          return;
        }

        const now =
          new Date();

        const result =
          await loans.updateOne(
            {
              _id:
                objectId,

              status: {
                $ne:
                  "cancelled",
              },
            },
            {
              $set: {
                status:
                  "cancelled",

                updatedAt:
                  now,
              },
            },
            {
              session,
            },
          );

        if (
          result.modifiedCount !==
          1
        ) {
          throw new Error(
            "Loan cancellation failed because the loan changed concurrently.",
          );
        }

        await writeAudit(
          objectId,
          loan.loanNumber,
          "cancelled",
          actor,
          {
            reason:
              cleanReason,

            cancelledAt:
              now,
          },
          session,
        );

        const updated =
          await loans.findOne(
            {
              _id:
                objectId,
            },
            {
              session,
            },
          );

        if (!updated) {
          throw new Error(
            "Cancelled loan could not be retrieved.",
          );
        }

        cancelledLoan =
          toLoan(
            updated,
          );
      },
      {
        readConcern: {
          level:
            "snapshot",
        },

        writeConcern: {
          w: "majority",
        },

        maxCommitTimeMS:
          10_000,
      },
    );

    if (!cancelledLoan) {
      throw new Error(
        "Loan cancellation completed without a result.",
      );
    }

    return cancelledLoan;
  } finally {
    await session.endSession();
  }
}

/* =========================================================
   LOAN SUMMARY
========================================================= */

export async function getLoanSummary(): Promise<LoanSummary> {
  const {
    loans,
    repayments,
    fines,
  } =
    await getCollections();

  const [
    loanStats,
    repaymentStats,
    fineStats,
  ] =
    await Promise.all([
      loans
        .aggregate<{
          _id: null;
          totalLoans: number;
          activeLoans: number;
          completedLoans: number;
          pendingLoans: number;
          cancelledLoans: number;
          totalPrincipal: number;
          totalInterest: number;
        }>([
          {
            $group: {
              _id: null,

              totalLoans: {
                $sum: 1,
              },

              activeLoans: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$status",
                        "active",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              completedLoans: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$status",
                        "completed",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              pendingLoans: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$status",
                        "pending",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              cancelledLoans: {
                $sum: {
                  $cond: [
                    {
                      $eq: [
                        "$status",
                        "cancelled",
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },

              totalPrincipal: {
                $sum:
                  "$principal",
              },

              totalInterest: {
                $sum:
                  "$interestAmount",
              },
            },
          },
        ])
        .toArray(),

      repayments
        .aggregate<{
          _id: null;
          totalPaid: number;
        }>([
          {
            $group: {
              _id: null,

              totalPaid: {
                $sum:
                  "$amount",
              },
            },
          },
        ])
        .toArray(),

      fines
        .aggregate<{
          _id: null;
          totalFines: number;
        }>([
          {
            $group: {
              _id: null,

              totalFines: {
                $sum:
                  "$amount",
              },
            },
          },
        ])
        .toArray(),
    ]);

  const loansData =
    loanStats[0];

  const totalPrincipal =
    money(
      Number(
        loansData?.totalPrincipal ||
          0,
      ),
    );

  const totalInterest =
    money(
      Number(
        loansData?.totalInterest ||
          0,
      ),
    );

  const totalPaid =
    money(
      Number(
        repaymentStats[0]
          ?.totalPaid || 0,
      ),
    );

  const totalFines =
    money(
      Number(
        fineStats[0]
          ?.totalFines || 0,
      ),
    );

  const totalDue =
    money(
      totalPrincipal +
        totalInterest,
    );

  const totalOutstanding =
    money(
      Math.max(
        0,
        totalDue +
          totalFines -
          totalPaid,
      ),
    );

  return {
    totalLoans:
      Number(
        loansData?.totalLoans ||
          0,
      ),

    activeLoans:
      Number(
        loansData?.activeLoans ||
          0,
      ),

    completedLoans:
      Number(
        loansData?.completedLoans ||
          0,
      ),

    pendingLoans:
      Number(
        loansData?.pendingLoans ||
          0,
      ),

    cancelledLoans:
      Number(
        loansData?.cancelledLoans ||
          0,
      ),

    totalPrincipal,

    totalInterest,

    totalFines,

    totalPaid,

    totalOutstanding,
  };
}