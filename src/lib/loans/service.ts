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
 * 7. Waivers are append-only financial records.
 * 8. Assessments are append-only financial records.
 * 9. Audit entries are append-only.
 *
 * 10. amountPaid is a maintained projection of the repayment ledger.
 * 11. totalFines is a maintained projection of the fine ledger.
 * 12. totalWaivedFines is a maintained projection of waiver ledger.
 *
 * 13. Core outstanding:
 *
 *       coreOutstanding =
 *          max(0, totalDue - amountPaid)
 *
 * 14. Final outstanding:
 *
 *       finalOutstanding =
 *          max(
 *            0,
 *            totalDue +
 *            totalFines -
 *            totalWaivedFines -
 *            amountPaid
 *          )
 *
 * 15. Fines are percentage-based.
 * 16. There are NO daily fines.
 * 17. A fine may be assessed once per completed repayment cycle.
 * 18. Repayment cycles default to 7 days.
 * 19. Fines are calculated from core outstanding only.
 * 20. Existing fines never compound.
 *
 * 21. transactionReference is the immutable idempotency key.
 * 22. Financial history is never permanently deleted.
 * 23. Read operations do not mutate financial state.
 * 24. Financial mutations use MongoDB transactions.
 *
 * IMPORTANT
 * ------------------------------------------------------------------
 *
 * A bank SMS/payment adapter should resolve the member and loan
 * before calling createLoanRepayment().
 *
 * The sender's M-Pesa name is NOT used to identify a member.
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
  CreateLoanWaiverInput,
  FineSource,
  Loan,
  LoanActor,
  LoanAssessment,
  LoanAuditEntry,
  LoanFine,
  LoanRepayment,
  LoanSettings,
  LoanStatus,
  LoanWaiver,
} from "./types";

import {
  normalizeGuarantor,
  normalizeText,
  validateCreateLoan,
  validateLoanRepayment,
  validateLoanSettings,
  validateCreateLoanWaiver,
} from "./validation";

/* =========================================================
   DATABASE
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB ||
  "geo-shua";

const LOANS_COLLECTION =
  "loans";

const LOAN_SETTINGS_COLLECTION =
  "loanSettings";

const LOAN_REPAYMENTS_COLLECTION =
  "loanRepayments";

const LOAN_FINES_COLLECTION =
  "loanFines";

const LOAN_WAIVERS_COLLECTION =
  "loanWaivers";

const LOAN_ASSESSMENTS_COLLECTION =
  "loanAssessments";

const LOAN_AUDIT_COLLECTION =
  "loanAudit";

const COUNTERS_COLLECTION =
  "counters";

const MEMBERS_COLLECTION =
  "members";

const SAVINGS_ACCOUNTS_COLLECTION =
  "savingsAccounts";

const SYSTEM_ACTOR: LoanActor = {
  name: "System",
  email: "system",
};

const DEFAULT_REPAYMENT_CYCLE_DAYS =
  7;

const DEFAULT_FINE_RATE =
  0.10;

const FUTURE_TRANSACTION_TOLERANCE_MS =
  5 * 60 * 1000;

/* =========================================================
   MONGODB DOCUMENT TYPES
========================================================= */

type LoanDocument =
  Omit<
    Loan,
    "id" | "memberId"
  > & {
    _id?: ObjectId;
    memberId: ObjectId;
  };

type LoanSettingsDocument =
  Omit<
    LoanSettings,
    "id"
  > & {
    _id?: ObjectId;
  };

type LoanRepaymentDocument =
  Omit<
    LoanRepayment,
    "id" |
    "loanId" |
    "memberId"
  > & {
    _id?: ObjectId;
    loanId: ObjectId;
    memberId: ObjectId;
  };

type LoanFineDocument =
  Omit<
    LoanFine,
    "id" |
    "loanId" |
    "memberId"
  > & {
    _id?: ObjectId;
    loanId: ObjectId;
    memberId: ObjectId;
  };

type LoanWaiverDocument =
  Omit<
    LoanWaiver,
    "id" |
    "loanId" |
    "memberId"
  > & {
    _id?: ObjectId;
    loanId: ObjectId;
    memberId: ObjectId;
  };

type LoanAssessmentDocument =
  Omit<
    LoanAssessment,
    "id" |
    "loanId"
  > & {
    _id?: ObjectId;
    loanId: ObjectId;
  };

type LoanAuditDocument =
  Omit<
    LoanAuditEntry,
    "id" |
    "loanId"
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
  repaymentStatus?: Loan["repaymentStatus"];
  repaymentDate?: Date | string;
  endDate?: Date | string;
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
  defaultedLoans: number;
  totalPrincipal: number;
  totalInterest: number;
  totalFines: number;
  totalWaivedFines: number;
  totalPaid: number;
  totalOutstanding: number;
};

/* =========================================================
   COLLECTIONS
========================================================= */

type LoanCollections = {
  client: Awaited<
    typeof clientPromise
  >;
  db: Db;
  loans: Collection<LoanDocument>;
  settings: Collection<LoanSettingsDocument>;
  repayments: Collection<LoanRepaymentDocument>;
  fines: Collection<LoanFineDocument>;
  waivers: Collection<LoanWaiverDocument>;
  assessments: Collection<LoanAssessmentDocument>;
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

    waivers:
      db.collection<LoanWaiverDocument>(
        LOAN_WAIVERS_COLLECTION,
      ),

    assessments:
      db.collection<LoanAssessmentDocument>(
        LOAN_ASSESSMENTS_COLLECTION,
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
    throw new Error(
      "Invalid ID.",
    );
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
    typeof actor.name ===
    "string"
      ? normalizeText(
          actor.name,
        )
      : "";

  const email =
    typeof actor.email ===
    "string"
      ? actor.email
          .trim()
          .toLowerCase()
      : "";

  if (
    !name ||
    !email
  ) {
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
      (
        value +
        Number.EPSILON
      ) * 100,
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
    result.getDate() +
      days,
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

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function normalizeRate(
  value: number,
): number {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(
      "Rate must be between 0 and 1.",
    );
  }

  return money(value);
}

function normalizeCycleDays(
  value: number,
): number {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 3650
  ) {
    throw new Error(
      "Repayment cycle days must be a whole number between 1 and 3650.",
    );
  }

  return value;
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

/**
 * Legacy settings protection.
 *
 * Older MongoDB settings documents may not contain:
 *
 * - repaymentCycleDays
 * - fineRate
 *
 * Those documents are normalized safely when read.
 *
 * This does NOT rewrite financial history.
 */
function toSettings(
  document: LoanSettingsDocument,
): LoanSettings {
  if (!document._id) {
    throw new Error(
      "Loan settings have no MongoDB ID.",
    );
  }

  const regularInterestRate =
    typeof document.regularInterestRate ===
      "number" &&
    Number.isFinite(
      document.regularInterestRate,
    ) &&
    document.regularInterestRate >= 0 &&
    document.regularInterestRate <= 1
      ? document.regularInterestRate
      : DEFAULT_SETTINGS.regularInterestRate;

  const emergencyInterestRate =
    typeof document.emergencyInterestRate ===
      "number" &&
    Number.isFinite(
      document.emergencyInterestRate,
    ) &&
    document.emergencyInterestRate >= 0 &&
    document.emergencyInterestRate <= 1
      ? document.emergencyInterestRate
      : DEFAULT_SETTINGS.emergencyInterestRate;

  const regularMinimumSavings =
    typeof document.regularMinimumSavings ===
      "number" &&
    Number.isFinite(
      document.regularMinimumSavings,
    ) &&
    document.regularMinimumSavings >= 0
      ? money(
          document.regularMinimumSavings,
        )
      : DEFAULT_SETTINGS.regularMinimumSavings;

  const regularSavingsMultiplier =
    typeof document.regularSavingsMultiplier ===
      "number" &&
    Number.isFinite(
      document.regularSavingsMultiplier,
    ) &&
    document.regularSavingsMultiplier > 0
      ? document.regularSavingsMultiplier
      : DEFAULT_SETTINGS.regularSavingsMultiplier;

  const repaymentGraceDays =
    typeof document.repaymentGraceDays ===
      "number" &&
    Number.isInteger(
      document.repaymentGraceDays,
    ) &&
    document.repaymentGraceDays >= 0
      ? document.repaymentGraceDays
      : DEFAULT_SETTINGS.repaymentGraceDays;

  const repaymentCycleDays =
    typeof document.repaymentCycleDays ===
      "number" &&
    Number.isInteger(
      document.repaymentCycleDays,
    ) &&
    document.repaymentCycleDays > 0 &&
    document.repaymentCycleDays <= 3650
      ? document.repaymentCycleDays
      : DEFAULT_REPAYMENT_CYCLE_DAYS;

  const fineRate =
    typeof document.fineRate ===
      "number" &&
    Number.isFinite(
      document.fineRate,
    ) &&
    document.fineRate >= 0 &&
    document.fineRate <= 1
      ? document.fineRate
      : DEFAULT_FINE_RATE;

  const emergencyLoansEnabled =
    typeof document.emergencyLoansEnabled ===
      "boolean"
      ? document.emergencyLoansEnabled
      : DEFAULT_SETTINGS.emergencyLoansEnabled;

  const regularLoansEnabled =
    typeof document.regularLoansEnabled ===
      "boolean"
      ? document.regularLoansEnabled
      : DEFAULT_SETTINGS.regularLoansEnabled;

  return {
    ...document,

    id:
      document._id.toString(),

    regularInterestRate,

    emergencyInterestRate,

    regularMinimumSavings,

    regularSavingsMultiplier,

    repaymentGraceDays,

    repaymentCycleDays,

    fineRate,

    emergencyLoansEnabled,

    regularLoansEnabled,
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

function toWaiver(
  document: LoanWaiverDocument,
): LoanWaiver {
  if (!document._id) {
    throw new Error(
      "Waiver has no MongoDB ID.",
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

function toAssessment(
  document: LoanAssessmentDocument,
): LoanAssessment {
  if (!document._id) {
    throw new Error(
      "Assessment has no MongoDB ID.",
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
    waivers,
    assessments,
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
        memberId: 1,
        repaymentStatus: 1,
      },
      {
        name:
          "loans_member_repaymentStatus",
      },
    ),

    loans.createIndex(
      {
        repaymentDate: 1,
        status: 1,
      },
      {
        name:
          "loans_repaymentDate_status",
      },
    ),

    loans.createIndex(
      {
        endDate: 1,
        status: 1,
      },
      {
        name:
          "loans_endDate_status",
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

    fines.createIndex(
      {
        loanId: 1,
        periodNumber: 1,
      },
      {
        unique: true,
        name:
          "loanFines_loan_period_unique",
      },
    ),

    waivers.createIndex(
      {
        loanId: 1,
        createdAt: 1,
        _id: 1,
      },
      {
        name:
          "loanWaivers_loan_createdAt",
      },
    ),

    assessments.createIndex(
      {
        loanId: 1,
        periodNumber: 1,
      },
      {
        unique: true,
        name:
          "loanAssessments_loan_period_unique",
      },
    ),

    assessments.createIndex(
      {
        loanId: 1,
        periodEnd: 1,
      },
      {
        name:
          "loanAssessments_loan_periodEnd",
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
        returnDocument:
          "after",
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
    String(sequence)
      .padStart(6, "0")
  );
}

/* =========================================================
   DEFAULT SETTINGS
========================================================= */

const DEFAULT_SETTINGS: Omit<
  LoanSettings,
  "id" |
  "createdAt" |
  "updatedAt"
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

  repaymentCycleDays:
    DEFAULT_REPAYMENT_CYCLE_DAYS,

  fineRate:
    DEFAULT_FINE_RATE,

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

export async function getLoanSettings(
  session?: ClientSession,
): Promise<LoanSettings> {
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

        session,
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

  try {
    const result =
      await settings.insertOne(
        document,
        {
          session,
        },
      );

    return toSettings({
      ...document,

      _id:
        result.insertedId,
    });
  } catch (error) {
    if (
      isDuplicateKeyError(
        error,
      )
    ) {
      const retry =
        await settings.findOne(
          {},

          {
            sort: {
              createdAt: -1,
              _id: -1,
            },

            session,
          },
        );

      if (retry) {
        return toSettings(
          retry,
        );
      }
    }

    throw error;
  }
}

export async function updateLoanSettings(
  changes: Partial<LoanSettings>,
  updatedBy: LoanActor,
): Promise<LoanSettings> {
  const actor =
    normalizeActor(
      updatedBy,
    );

  const rawChanges =
    changes as Record<
      string,
      unknown
    >;

  if (
    "dailyFine" in rawChanges ||
    "defaultDailyFine" in rawChanges ||
    "fineSource" in rawChanges
  ) {
    throw new Error(
      "Daily fines are no longer supported. Use fineRate.",
    );
  }

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

  const sanitizedChanges =
    {
      ...safeChanges,

      ...(safeChanges.repaymentCycleDays !==
      undefined
        ? {
            repaymentCycleDays:
              normalizeCycleDays(
                safeChanges.repaymentCycleDays,
              ),
          }
        : {}),

      ...(safeChanges.fineRate !==
      undefined
        ? {
            fineRate:
              normalizeRate(
                safeChanges.fineRate,
              ),
          }
        : {}),
    };

  const result =
    await settings.updateOne(
      {
        _id:
          currentId,
      },

      {
        $set: {
          ...sanitizedChanges,

          updatedBy:
            actor,

          updatedAt:
            now,
        },
      },
    );

  if (
    result.matchedCount !==
    1
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

  hasExistingLoan: boolean;
  existingLoanStatus: LoanStatus | null;
  existingLoanNumber: string | null;
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
): Promise<MemberForLoan | null> {
  const {
    db,
  } =
    await getCollections();

  const member =
    await db
      .collection<MemberForLoan>(
        MEMBERS_COLLECTION,
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

          projection: {
            _id: 1,
            membershipNumber: 1,
            firstName: 1,
            middleName: 1,
            lastName: 1,
            status: 1,
          },
        },
      );

  /*
   * Member does not exist.
   */
  if (!member) {
    return null;
  }

  /*
   * A member may only have one outstanding
   * loan at a time.
   *
   * pending and active loans prevent the member
   * from being eligible for another loan.
   *
   * completed and cancelled loans are historical
   * and therefore do not prevent a new loan.
   */
  const existingLoan =
    await db
      .collection<Loan>(
        LOANS_COLLECTION,
      )
      .findOne(
        {
          memberId:
            member._id.toString(),

          status: {
            $in: [
              "pending",
              "active",
            ],
          },
        },
        {
          session,

          projection: {
            _id: 1,
          },
        },
      );

  /*
   * Member already has an outstanding loan.
   *
   * Do not throw.
   * Simply make the member ineligible by returning null.
   */
  if (existingLoan) {
    return null;
  }

  /*
   * Member exists and has no outstanding loan.
   */
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
        SAVINGS_ACCOUNTS_COLLECTION,
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

async function getLoanPaidTotalAsOf(
  loanId: ObjectId,
  asOfDate: Date,
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

              transactionDate: {
                $lte:
                  asOfDate,
              },
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

async function getLoanWaivedFineTotal(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  const {
    waivers,
  } =
    await getCollections();

  const result =
    await waivers
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
   OUTSTANDING CALCULATIONS
========================================================= */

function calculateCoreOutstanding(
  totalDue: number,
  amountPaid: number,
): number {
  return money(
    Math.max(
      0,

      totalDue -
        amountPaid,
    ),
  );
}

function calculateFinalOutstanding(
  totalDue: number,
  totalFines: number,
  totalWaivedFines: number,
  amountPaid: number,
): number {
  return money(
    Math.max(
      0,

      totalDue +
        totalFines -
        totalWaivedFines -
        amountPaid,
    ),
  );
}

/* =========================================================
   RECONCILE LOAN PROJECTION
========================================================= */

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

  const totalWaivedFines =
    Math.min(
      totalFines,

      await getLoanWaivedFineTotal(
        loanId,
        session,
      ),
    );

  const outstandingBalance =
    calculateFinalOutstanding(
      loan.totalDue,
      totalFines,
      totalWaivedFines,
      amountPaid,
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
    loan.totalWaivedFines !==
      totalWaivedFines ||
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

          totalWaivedFines,

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
  details: Record<
    string,
    unknown
  > = {},
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

    details,

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

  const rawInput =
    input as unknown as Record<
      string,
      unknown
    >;

  if (
    "dailyFine" in rawInput ||
    "defaultDailyFine" in rawInput ||
    "fineSource" in rawInput
  ) {
    throw new Error(
      "Daily fines are no longer supported. Use fineRate.",
    );
  }

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
    const createdLoan =
      await session.withTransaction(
        async (): Promise<Loan> => {
          
          const member =
            await getMemberForLoan(
              input.memberId,
              session,
            );

          if (!member) {
            throw new Error(
              "Member is not eligible for a new loan.",
            );
          }
          if (
            member.status !==
            "active"
          ) {
            throw new Error(
              "Only active members can receive loans.",
            );
          }

          const settings =
            await getLoanSettings(
              session,
            );

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

          if (
            input.type ===
            "regular"
          ) {
            const savingsBalance =
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
            const previous
              of previousLoans
          ) {
            if (!previous._id) {
              continue;
            }

            const paid =
              await getLoanPaidTotal(
                previous._id,
                session,
              );

            const fines =
              await getLoanFineTotal(
                previous._id,
                session,
              );

            const waived =
              await getLoanWaivedFineTotal(
                previous._id,
                session,
              );

            const outstanding =
              calculateFinalOutstanding(
                previous.totalDue,
                fines,
                Math.min(
                  fines,
                  waived,
                ),
                paid,
              );

            if (
              outstanding >
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

          /*
           * AUTHORITATIVE SETTINGS
           *
           * The repayment cycle and fine rate are SACCO
           * configuration, not values supplied by the client.
           */
          const repaymentCycleDays =
            normalizeCycleDays(
              settings.repaymentCycleDays,
            );

          const fineRate =
            normalizeRate(
              settings.fineRate,
            );

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
              repaymentCycleDays,
            );

          const repaymentDate =
            input.repaymentDate
              ? new Date(
                  input.repaymentDate,
                )
              : firstDueDate;

          const endDate =
            input.endDate
              ? new Date(
                  input.endDate,
                )
              : repaymentDate;

          if (
            !isValidDate(
              repaymentDate,
            )
          ) {
            throw new Error(
              "Invalid repayment date.",
            );
          }

          if (
            !isValidDate(
              endDate,
            )
          ) {
            throw new Error(
              "Invalid loan end date.",
            );
          }

          if (
            repaymentDate.getTime() <
            disbursementDate.getTime()
          ) {
            throw new Error(
              "Repayment date cannot be before disbursement date.",
            );
          }

          if (
            endDate.getTime() <
            repaymentDate.getTime()
          ) {
            throw new Error(
              "Loan end date cannot be before repayment date.",
            );
          }

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

          const memberName =
            normalizeText(
              [
                member.firstName,
                member.middleName,
                member.lastName,
              ]
                .filter(Boolean)
                .join(" "),
            );

          const loanDocument:
            LoanDocument = {
            _id:
              new ObjectId(),

            loanNumber,

            memberId:
              member._id,

            memberNumber:
              member.membershipNumber,

            memberName,

            type:
              input.type,

            principal,

            interestRate:
              rate,

            interestAmount,

            fineRate,

            repaymentCycleDays,

            disbursementDate,

            repaymentDate,

            endDate,

            firstDueDate,

            totalDue,

            amountPaid:
              0,

            totalFines:
              0,

            totalWaivedFines:
              0,

            outstandingBalance:
              totalDue,

            fineStatus:
              "active",

            repaymentStatus:
              "current",

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

              fineRate,

              repaymentCycleDays,

              disbursementDate,

              repaymentDate,

              endDate,

              firstDueDate,

              totalDue,
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

          return toLoan(
            loanDocument,
          );
        },

        {
          readConcern: {
            level:
              "snapshot",
          },

          writeConcern: {
            w:
              "majority",
          },

          maxCommitTimeMS:
            10_000,
        },
      );

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
    Record<string, unknown> =
    {};

  if (options.status) {
    filter.status =
      options.status;
  }

  if (options.type) {
    filter.type =
      options.type;
  }

  if (
    options.repaymentStatus
  ) {
    filter.repaymentStatus =
      options.repaymentStatus;
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
        totalPages:
          0,
      };
    }

    filter.memberId =
      createObjectId(
        options.memberId,
      );
  }

  if (
    options.repaymentDate
  ) {
    const date =
      new Date(
        options.repaymentDate,
      );

    if (
      isValidDate(date)
    ) {
      filter.repaymentDate =
        {
          $gte:
            startOfDay(
              date,
            ),

          $lt:
            addDays(
              startOfDay(
                date,
              ),
              1,
            ),
        };
    }
  }

  if (
    options.endDate
  ) {
    const date =
      new Date(
        options.endDate,
      );

    if (
      isValidDate(date)
    ) {
      filter.endDate =
        {
          $gte:
            startOfDay(
              date,
            ),

          $lt:
            addDays(
              startOfDay(
                date,
              ),
              1,
            ),
        };
    }
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
        createdAt:
          -1,

        _id:
          -1,
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
   ASSESSMENT PERIOD
========================================================= */

type AssessmentPeriod = {
  periodNumber: number;
  periodStart: Date;
  periodEnd: Date;
};

function getAssessmentPeriod(
  loan: LoanDocument,
  periodNumber: number,
): AssessmentPeriod {
  if (
    !Number.isInteger(
      periodNumber,
    ) ||
    periodNumber <= 0
  ) {
    throw new Error(
      "Assessment period must be a positive whole number.",
    );
  }

  const cycleDays =
    normalizeCycleDays(
      loan.repaymentCycleDays,
    );

  const periodStart =
    addDays(
      loan.disbursementDate,
      (
        periodNumber -
        1
      ) *
        cycleDays,
    );

  const periodEnd =
    addDays(
      periodStart,
      cycleDays,
    );

  return {
    periodNumber,
    periodStart,
    periodEnd,
  };
}

function getLatestDueAssessmentPeriod(
  loan: LoanDocument,
  asOfDate: Date,
): number {
  const cycleDays =
    normalizeCycleDays(
      loan.repaymentCycleDays,
    );

  const cycleMilliseconds =
    cycleDays *
    24 *
    60 *
    60 *
    1000;

  const elapsed =
    asOfDate.getTime() -
    loan.disbursementDate.getTime();

  if (
    elapsed <
    cycleMilliseconds
  ) {
    return 0;
  }

  return Math.floor(
    elapsed /
      cycleMilliseconds,
  );
}

async function getPeriodPaymentTotal(
  loanId: ObjectId,
  period: AssessmentPeriod,
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

              transactionDate:
                period.periodNumber ===
                1
                  ? {
                      $gte:
                        period.periodStart,

                      $lte:
                        period.periodEnd,
                    }
                  : {
                      $gt:
                        period.periodStart,

                      $lte:
                        period.periodEnd,
                    },
            },
          },

          {
            $group: {
              _id:
                null,

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
   ASSESS LOAN PERIOD
========================================================= */

async function assessLoanPeriod(
  loanId: ObjectId,
  periodNumber: number,
  assessmentDate: Date,
  session: ClientSession,
): Promise<LoanAssessment> {
  const {
    loans,
    assessments,
    fines,
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

  if (
    loan.status ===
      "cancelled" ||
    loan.status ===
      "completed"
  ) {
    throw new Error(
      "Cancelled or completed loans cannot be assessed.",
    );
  }

  const existing =
    await assessments.findOne(
      {
        loanId,

        periodNumber,
      },

      {
        session,
      },
    );

  if (existing) {
    return toAssessment(
      existing,
    );
  }

  const period =
    getAssessmentPeriod(
      loan,
      periodNumber,
    );

  if (
    assessmentDate.getTime() <
    period.periodEnd.getTime()
  ) {
    throw new Error(
      "A repayment cycle cannot be assessed before the cycle ends.",
    );
  }

  const amountPaidBeforePeriod =
    await getLoanPaidTotalAsOf(
      loanId,
      period.periodStart,
      session,
    );

  const openingCoreBalance =
    calculateCoreOutstanding(
      loan.totalDue,
      amountPaidBeforePeriod,
    );

  const amountPaidAsOfPeriodEnd =
    await getLoanPaidTotalAsOf(
      loanId,
      period.periodEnd,
      session,
    );

  const balanceBeforeFine =
    calculateCoreOutstanding(
      loan.totalDue,
      amountPaidAsOfPeriodEnd,
    );

  const paymentsDuringPeriod =
    await getPeriodPaymentTotal(
      loanId,
      period,
      session,
    );

  const paymentMade =
    paymentsDuringPeriod >
    0;

  const defaulted =
    !paymentMade &&
    balanceBeforeFine >
      0;

  /*
   * Fines are calculated only against core outstanding.
   *
   * Existing fines are deliberately excluded.
   * Therefore fines never compound.
   */
  const fineRate =
    normalizeRate(
      loan.fineRate,
    );

  const calculatedFine =
    defaulted
      ? money(
          balanceBeforeFine *
            fineRate,
        )
      : 0;

  let actualFineAmount =
    0;

  if (
    loan.fineStatus ===
      "active" &&
    calculatedFine >
      0
  ) {
    const fineDocument:
      LoanFineDocument = {
      _id:
        new ObjectId(),

      loanId,

      loanNumber:
        loan.loanNumber,

      memberId:
        loan.memberId,

      amount:
        calculatedFine,

      fineDate:
        period.periodEnd,

      fineRate,

      periodNumber,

      periodStart:
        period.periodStart,

      periodEnd:
        period.periodEnd,

      assessedCoreBalance:
        balanceBeforeFine,

      source:
        "system" as FineSource,

      createdAt:
        new Date(),
    };

    try {
      await fines.insertOne(
        fineDocument,
        {
          session,
        },
      );

      actualFineAmount =
        calculatedFine;

      await writeAudit(
        loanId,
        loan.loanNumber,
        "fine_recorded",
        SYSTEM_ACTOR,
        {
          periodNumber,

          periodStart:
            period.periodStart,

          periodEnd:
            period.periodEnd,

          amount:
            calculatedFine,

          fineRate,

          assessedCoreBalance:
            balanceBeforeFine,
        },
        session,
      );
    } catch (error) {
      if (
        !isDuplicateKeyError(
          error,
        )
      ) {
        throw error;
      }

      const concurrentFine =
        await fines.findOne(
          {
            loanId,

            periodNumber,
          },

          {
            session,
          },
        );

      actualFineAmount =
        concurrentFine?.amount ||
        0;
    }
  }

  const assessmentDocument:
    LoanAssessmentDocument = {
    _id:
      new ObjectId(),

    loanId,

    loanNumber:
      loan.loanNumber,

    memberId:
      loan.memberId.toString(),

    memberNumber:
      loan.memberNumber,

    periodNumber,

    periodStart:
      period.periodStart,

    periodEnd:
      period.periodEnd,

    assessmentDate,

    openingCoreBalance,

    paymentsDuringPeriod,

    balanceBeforeFine,

    paymentMade,

    defaulted,

    fineRate,

    fineAmount:
      actualFineAmount,

    status:
      defaulted
        ? "defaulted"
        : "assessed",

    createdAt:
      new Date(),
  };

  try {
    await assessments.insertOne(
      assessmentDocument,
      {
        session,
      },
    );
  } catch (error) {
    if (
      isDuplicateKeyError(
        error,
      )
    ) {
      const concurrent =
        await assessments.findOne(
          {
            loanId,

            periodNumber,
          },

          {
            session,
          },
        );

      if (!concurrent) {
        throw error;
      }

      return toAssessment(
        concurrent,
      );
    }

    throw error;
  }

  await writeAudit(
    loanId,
    loan.loanNumber,
    "assessment_recorded",
    SYSTEM_ACTOR,
    {
      periodNumber,

      periodStart:
        period.periodStart,

      periodEnd:
        period.periodEnd,

      openingCoreBalance,

      paymentsDuringPeriod,

      balanceBeforeFine,

      paymentMade,

      defaulted,

      fineRate,

      fineAmount:
        actualFineAmount,
    },
    session,
  );

  if (defaulted) {
    await writeAudit(
      loanId,
      loan.loanNumber,
      "defaulted",
      SYSTEM_ACTOR,
      {
        periodNumber,

        periodEnd:
          period.periodEnd,

        balanceBeforeFine,

        fineAmount:
          actualFineAmount,
      },
      session,
    );
  }

  return toAssessment(
    assessmentDocument,
  );
}

/* =========================================================
   ACCRUE LOAN FINES
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
    client,
  } =
    await getCollections();

  const session =
    client.startSession();

  try {
    const createdCount =
      await session.withTransaction(
        async (): Promise<number> => {
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

          const latestPeriod =
            getLatestDueAssessmentPeriod(
              loan,
              asOfDate,
            );

          if (
            latestPeriod <=
            0
          ) {
            return 0;
          }

          let created =
            0;

          for (
            let periodNumber = 1;
            periodNumber <=
            latestPeriod;
            periodNumber++
          ) {
            const {
              assessments,
            } =
              await getCollections();

            const existing =
              await assessments.findOne(
                {
                  loanId:
                    objectId,

                  periodNumber,
                },

                {
                  session,
                },
              );

            if (existing) {
              continue;
            }

            await assessLoanPeriod(
              objectId,
              periodNumber,
              asOfDate,
              session,
            );

            const inserted =
              await assessments.findOne(
                {
                  loanId:
                    objectId,

                  periodNumber,
                },

                {
                  session,
                },
              );

            if (inserted) {
              created++;
            }
          }

          const {
            assessments,
          } =
            await getCollections();

          const defaultAssessment =
            await assessments.findOne(
              {
                loanId:
                  objectId,

                defaulted:
                  true,
              },

              {
                session,
              },
            );

          const paid =
            await getLoanPaidTotal(
              objectId,
              session,
            );

          const fines =
            await getLoanFineTotal(
              objectId,
              session,
            );

          const waived =
            await getLoanWaivedFineTotal(
              objectId,
              session,
            );

          const outstanding =
            calculateFinalOutstanding(
              loan.totalDue,
              fines,
              Math.min(
                fines,
                waived,
              ),
              paid,
            );

          let repaymentStatus:
            Loan["repaymentStatus"] =
            "current";

          if (
            outstanding <=
            0
          ) {
            repaymentStatus =
              "completed";
          } else if (
            defaultAssessment ||
            asOfDate.getTime() >=
              loan.endDate.getTime()
          ) {
            repaymentStatus =
              "defaulted";
          }

          await loans.updateOne(
            {
              _id:
                objectId,
            },

            {
              $set: {
                repaymentStatus,

                updatedAt:
                  new Date(),
              },
            },

            {
              session,
            },
          );

          await reconcileLoan(
            objectId,
            session,
          );

          return created;
        },

        {
          readConcern: {
            level:
              "snapshot",
          },

          writeConcern: {
            w:
              "majority",
          },

          maxCommitTimeMS:
            10_000,
        },
      );

    return createdCount;
  } finally {
    await session.endSession();
  }
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
    client,
  } =
    await getCollections();

  const session =
    client.startSession();

  try {
    return await session.withTransaction(
      async (): Promise<Loan> => {
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

            {
              session,
            },
          );

        if (
          result.modifiedCount !==
          1
        ) {
          throw new Error(
            "Loan fine status changed concurrently. Please retry.",
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
          session,
        );

        return reconcileLoan(
          objectId,
          session,
        );
      },

      {
        readConcern: {
          level:
            "snapshot",
        },

        writeConcern: {
          w:
            "majority",
        },

        maxCommitTimeMS:
          10_000,
      },
    );
  } finally {
    await session.endSession();
  }
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
    client,
  } =
    await getCollections();

  const session =
    client.startSession();

  try {
    const loan =
      await session.withTransaction(
        async (): Promise<Loan> => {
          const {
            loans,
          } =
            await getCollections();

          const objectId =
            createObjectId(
              loanId,
            );

          const current =
            await loans.findOne(
              {
                _id:
                  objectId,
              },

              {
                session,
              },
            );

          if (!current) {
            throw new Error(
              "Loan not found.",
            );
          }

          if (
            current.status ===
              "cancelled" ||
            current.status ===
              "completed"
          ) {
            throw new Error(
              "Fines cannot be resumed on a completed or cancelled loan.",
            );
          }

          if (
            current.fineStatus ===
            "active"
          ) {
            return toLoan(
              current,
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

              {
                session,
              },
            );

          if (
            result.modifiedCount !==
            1
          ) {
            throw new Error(
              "Loan fine status changed concurrently. Please retry.",
            );
          }

          await writeAudit(
            objectId,
            current.loanNumber,
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
            session,
          );

          return reconcileLoan(
            objectId,
            session,
          );
        },

        {
          readConcern: {
            level:
              "snapshot",
          },

          writeConcern: {
            w:
              "majority",
          },

          maxCommitTimeMS:
            10_000,
        },
      );

    /*
     * Assess overdue cycles after the fine status has been
     * resumed. This intentionally runs in a separate
     * transaction.
     */
    await accrueLoanFines(
      loanId,
      new Date(),
    );

    return (
      await getLoanById(
        loanId,
      )
    ) || loan;
  } finally {
    await session.endSession();
  }
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
        createdAt:
          -1,

        _id:
          -1,
      })
      .limit(2)
      .toArray();

  if (
    openLoans.length >
    1
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
export async function createLoanRepayment(
  input: CreateLoanRepaymentInput,
): Promise<LoanRepayment> {
  /* =======================================================
     INPUT VALIDATION
  ======================================================= */

  const validation =
    validateLoanRepayment(input);

  if (!validation.valid) {
    throw new Error(
      firstError(validation.errors),
    );
  }

  const reference =
    normalizeText(
      input.transactionReference,
    );

  const amount =
    money(input.amount);

  if (amount <= 0) {
    throw new Error(
      "Repayment amount must be greater than zero.",
    );
  }

  const transactionDate =
    new Date(input.transactionDate);

  if (!isValidDate(transactionDate)) {
    throw new Error(
      "Invalid transaction date.",
    );
  }

  /* =======================================================
     FUTURE TRANSACTION PROTECTION
  ======================================================= */

  const now =
    new Date();

  if (
    transactionDate.getTime() >
    now.getTime() +
      FUTURE_TRANSACTION_TOLERANCE_MS
  ) {
    throw new Error(
      "Repayment transaction date cannot be in the future.",
    );
  }

  /* =======================================================
     COLLECTIONS
  ======================================================= */

  const {
    client,
    repayments,
  } =
    await getCollections();

  /* =======================================================
     FAST IDEMPOTENCY CHECK
     
     This is an optimization only.
     The unique MongoDB index remains the final
     concurrency protection.
  ======================================================= */

  const existing =
    await repayments.findOne({
      transactionReference:
        reference,
    });

  if (existing) {
    if (
      money(existing.amount) !==
      amount
    ) {
      throw new Error(
        "Transaction reference already exists for a different financial transaction.",
      );
    }

    if (
      input.loanId &&
      existing.loanId.toString() !==
        input.loanId
    ) {
      throw new Error(
        "Transaction reference already exists for a different loan.",
      );
    }

    if (
      input.memberId &&
      existing.memberId.toString() !==
        input.memberId
    ) {
      throw new Error(
        "Transaction reference already exists for a different member.",
      );
    }

    return toRepayment(existing);
  }

  /* =======================================================
     DATABASE TRANSACTION
  ======================================================= */

  const session =
    client.startSession();

  try {
    const transactionResult =
      await session.withTransaction(
        async (): Promise<{
          repayment: LoanRepayment;
        }> => {
          /* =================================================
             SECOND IDEMPOTENCY CHECK
             
             Protects against concurrent requests.
          ================================================= */

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

            if (
              input.loanId &&
              alreadyExists.loanId.toString() !==
                input.loanId
            ) {
              throw new Error(
                "Transaction reference already exists for a different loan.",
              );
            }

            if (
              input.memberId &&
              alreadyExists.memberId.toString() !==
                input.memberId
            ) {
              throw new Error(
                "Transaction reference already exists for a different member.",
              );
            }

            return {
              repayment:
                toRepayment(
                  alreadyExists,
                ),
            };
          }

          /* =================================================
             RESOLVE LOAN
          ================================================= */

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

          /* =================================================
             LOAN STATUS
          ================================================= */

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

          /* =================================================
             SMS TEMPORAL PROTECTION
             
             A bank SMS must represent a transaction that
             happened strictly AFTER the loan was disbursed.
             
             This prevents old SMS messages from being
             attached to newly created loans.
             
             Same timestamp is intentionally rejected.
          ================================================= */

          if (
            input.source === "sms" &&
            transactionDate.getTime() <=
              loan.disbursementDate.getTime()
          ) {
            throw new Error(
              "SMS_REPAYMENT_BEFORE_DISBURSEMENT",
            );
          }

          /* =================================================
             LOAN ID
          ================================================= */

          const loanObjectId =
            loan._id;

          /* =================================================
             CURRENT FINANCIAL STATE
          ================================================= */

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

          const totalWaivedFinesBefore =
            await getLoanWaivedFineTotal(
              loanObjectId,
              session,
            );

          const currentOutstanding =
            calculateFinalOutstanding(
              loan.totalDue,
              totalFinesBefore,
              Math.min(
                totalFinesBefore,
                totalWaivedFinesBefore,
              ),
              amountPaidBefore,
            );

          if (
            currentOutstanding <=
            0
          ) {
            throw new Error(
              "Loan has no outstanding balance.",
            );
          }

          /* =================================================
             OVERPAYMENT PROTECTION
          ================================================= */

          if (
            amount >
            currentOutstanding
          ) {
            throw new Error(
              `Repayment exceeds the outstanding balance of KSh ${currentOutstanding.toLocaleString()}.`,
            );
          }

          /* =================================================
             REPAYMENT DOCUMENT
          ================================================= */

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

          /* =================================================
             INSERT IMMUTABLE REPAYMENT
          ================================================= */

          try {
            await repayments.insertOne(
              repaymentDocument,
              {
                session,
              },
            );
          } catch (error) {
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

          /* =================================================
             CALCULATE NEW FINANCIAL STATE
          ================================================= */

          const newAmountPaid =
            money(
              amountPaidBefore +
                amount,
            );

          const newOutstanding =
            calculateFinalOutstanding(
              loan.totalDue,
              totalFinesBefore,
              Math.min(
                totalFinesBefore,
                totalWaivedFinesBefore,
              ),
              newAmountPaid,
            );

          const newStatus:
            Loan["status"] =
            newOutstanding <=
            0
              ? "completed"
              : loan.status;

          /* =================================================
             UPDATE LOAN
             
             Optimistic concurrency protection ensures that
             another repayment cannot silently overwrite
             this transaction's financial state.
          ================================================= */

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

                totalWaivedFines:
                  loan.totalWaivedFines,

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

                  totalWaivedFines:
                    Math.min(
                      totalFinesBefore,
                      totalWaivedFinesBefore,
                    ),

                  outstandingBalance:
                    newOutstanding,

                  status:
                    newStatus,

                  repaymentStatus:
                    newStatus ===
                    "completed"
                      ? "completed"
                      : loan.repaymentStatus,

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

          /* =================================================
             CONVERT TO DOMAIN MODEL
          ================================================= */

          const repayment =
            toRepayment(
              repaymentDocument,
            );

          /* =================================================
             AUDIT ACTOR
          ================================================= */

          const actor =
            input.recordedBy
              ? normalizeActor(
                  input.recordedBy,
                )
              : SYSTEM_ACTOR;

          /* =================================================
             REPAYMENT AUDIT
          ================================================= */

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

              totalWaivedFines:
                totalWaivedFinesBefore,
            },
            session,
          );

          /* =================================================
             COMPLETION AUDIT
          ================================================= */

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

                totalWaivedFines:
                  totalWaivedFinesBefore,

                finalOutstandingBalance:
                  newOutstanding,
              },
              session,
            );
          }

          return {
            repayment,
          };
        },

        {
          readConcern: {
            level:
              "snapshot",
          },

          writeConcern: {
            w:
              "majority",
          },

          maxCommitTimeMS:
            10_000,
        },
      );

    return transactionResult.repayment;
  } catch (error) {
    /* =====================================================
       IDEMPOTENCY RACE RECOVERY
    ===================================================== */

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

      if (
        input.loanId &&
        existing.loanId.toString() !==
          input.loanId
      ) {
        throw new Error(
          "Transaction reference already exists for a different loan.",
        );
      }

      if (
        input.memberId &&
        existing.memberId.toString() !==
          input.memberId
      ) {
        throw new Error(
          "Transaction reference already exists for a different member.",
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
   CREATE LOAN WAIVER
========================================================= */

export async function createLoanWaiver(
  input: CreateLoanWaiverInput,
): Promise<LoanWaiver> {
  const validation =
    validateCreateLoanWaiver(
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
    return await session.withTransaction(
      async (): Promise<LoanWaiver> => {
        const {
          loans,
          waivers,
        } =
          await getCollections();

        const loanId =
          createObjectId(
            input.loanId,
          );

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

        if (
          loan.status ===
          "cancelled"
        ) {
          throw new Error(
            "Cancelled loans cannot receive fine waivers.",
          );
        }

        if (
          loan.status ===
          "completed"
        ) {
          throw new Error(
            "Completed loans cannot receive fine waivers.",
          );
        }

        const totalFines =
          await getLoanFineTotal(
            loanId,
            session,
          );

        const totalWaived =
          await getLoanWaivedFineTotal(
            loanId,
            session,
          );

        const available =
          money(
            Math.max(
              0,
              totalFines -
                totalWaived,
            ),
          );

        const amount =
          money(
            input.amount,
          );

        if (
          available <=
          0
        ) {
          throw new Error(
            "There are no active fines available for waiver.",
          );
        }

        if (
          amount >
          available
        ) {
          throw new Error(
            `Waiver cannot exceed the available fine balance of KSh ${available.toLocaleString()}.`,
          );
        }

        const actor =
          normalizeActor(
            input.waivedBy,
          );

        const now =
          new Date();

        const waiverDocument:
          LoanWaiverDocument = {
          _id:
            new ObjectId(),

          loanId,

          loanNumber:
            loan.loanNumber,

          memberId:
            loan.memberId,

          amount,

          reason:
            normalizeText(
              input.reason,
            ),

          waivedBy:
            actor,

          createdAt:
            now,
        };

        await waivers.insertOne(
          waiverDocument,
          {
            session,
          },
        );

        const newTotalWaived =
          money(
            totalWaived +
              amount,
          );

        const outstanding =
          calculateFinalOutstanding(
            loan.totalDue,
            totalFines,
            newTotalWaived,
            await getLoanPaidTotal(
              loanId,
              session,
            ),
          );

        const updateResult =
          await loans.updateOne(
            {
              _id:
                loanId,

              totalFines:
                loan.totalFines,

              totalWaivedFines:
                loan.totalWaivedFines,

              outstandingBalance:
                loan.outstandingBalance,
            },

            {
              $set: {
                totalFines,

                totalWaivedFines:
                  newTotalWaived,

                outstandingBalance:
                  outstanding,

                updatedAt:
                  now,
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
            "Loan balance changed while recording the waiver. The transaction was aborted; please retry.",
          );
        }

        await writeAudit(
          loanId,
          loan.loanNumber,
          "waiver_recorded",
          actor,
          {
            waiverId:
              waiverDocument._id!.toString(),

            amount,

            reason:
              waiverDocument.reason,

            availableBefore:
              available,

            availableAfter:
              money(
                available -
                  amount,
              ),

            outstandingAfter:
              outstanding,
          },
          session,
        );

        return toWaiver(
          waiverDocument,
        );
      },

      {
        readConcern: {
          level:
            "snapshot",
        },

        writeConcern: {
          w:
            "majority",
        },

        maxCommitTimeMS:
          10_000,
      },
    );
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
   GET WAIVERS
========================================================= */

export async function getLoanWaivers(
  loanId: string,
): Promise<LoanWaiver[]> {
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
    waivers,
  } =
    await getCollections();

  const documents =
    await waivers
      .find({
        loanId:
          createObjectId(
            loanId,
          ),
      })
      .sort({
        createdAt:
          -1,

        _id:
          -1,
      })
      .toArray();

  return documents.map(
    toWaiver,
  );
}

/* =========================================================
   GET ASSESSMENTS
========================================================= */

export async function getLoanAssessments(
  loanId: string,
): Promise<LoanAssessment[]> {
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
    assessments,
  } =
    await getCollections();

  const documents =
    await assessments
      .find({
        loanId:
          createObjectId(
            loanId,
          ),
      })
      .sort({
        periodNumber:
          1,

        _id:
          1,
      })
      .toArray();

  return documents.map(
    toAssessment,
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
    const transactionResult =
      await session.withTransaction(
        async (): Promise<{
          loan: Loan;
          changed: boolean;
        }> => {
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
            return {
              loan:
                toLoan(
                  loan,
                ),

              changed:
                false,
            };
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

                  repaymentStatus:
                    "current",

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

          return {
            loan:
              toLoan(
                updated,
              ),

            changed:
              true,
          };
        },

        {
          readConcern: {
            level:
              "snapshot",
          },

          writeConcern: {
            w:
              "majority",
          },

          maxCommitTimeMS:
            10_000,
        },
      );

    return transactionResult.loan;
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
    waivers,
  } =
    await getCollections();

  const [
    loanStats,
    repaymentStats,
    fineStats,
    waiverStats,
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

          defaultedLoans: number;

          totalPrincipal: number;

          totalInterest: number;

          totalOutstanding: number;
        }>([
          {
            $facet: {
              counts: [
                {
                  $group: {
                    _id:
                      null,

                    totalLoans: {
                      $sum:
                        1,
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

                    defaultedLoans: {
                      $sum: {
                        $cond: [
                          {
                            $eq: [
                              "$repaymentStatus",
                              "defaulted",
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
              ],

              balances: [
                {
                  $match: {
                    status: {
                      $ne:
                        "cancelled",
                    },
                  },
                },

                {
                  $lookup: {
                    from:
                      LOAN_REPAYMENTS_COLLECTION,

                    localField:
                      "_id",

                    foreignField:
                      "loanId",

                    as:
                      "repaymentLedger",
                  },
                },

                {
                  $lookup: {
                    from:
                      LOAN_FINES_COLLECTION,

                    localField:
                      "_id",

                    foreignField:
                      "loanId",

                    as:
                      "fineLedger",
                  },
                },

                {
                  $lookup: {
                    from:
                      LOAN_WAIVERS_COLLECTION,

                    localField:
                      "_id",

                    foreignField:
                      "loanId",

                    as:
                      "waiverLedger",
                  },
                },

                {
                  $set: {
                    ledgerPaid: {
                      $sum:
                        "$repaymentLedger.amount",
                    },

                    ledgerFines: {
                      $sum:
                        "$fineLedger.amount",
                    },

                    ledgerWaived: {
                      $sum:
                        "$waiverLedger.amount",
                    },
                  },
                },

                {
                  $set: {
                    effectiveWaived: {
                      $min: [
                        "$ledgerFines",
                        "$ledgerWaived",
                      ],
                    },
                  },
                },

                {
                  $set: {
                    calculatedOutstanding: {
                      $max: [
                        0,

                        {
                          $subtract: [
                            {
                              $add: [
                                "$totalDue",
                                "$ledgerFines",
                              ],
                            },

                            {
                              $add: [
                                "$effectiveWaived",
                                "$ledgerPaid",
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },

                {
                  $group: {
                    _id:
                      null,

                    totalOutstanding: {
                      $sum:
                        "$calculatedOutstanding",
                    },
                  },
                },
              ],
            },
          },

          {
            $project: {
              _id:
                null,

              totalLoans: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.totalLoans",
                      0,
                    ],
                  },
                  0,
                ],
              },

              activeLoans: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.activeLoans",
                      0,
                    ],
                  },
                  0,
                ],
              },

              completedLoans: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.completedLoans",
                      0,
                    ],
                  },
                  0,
                ],
              },

              pendingLoans: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.pendingLoans",
                      0,
                    ],
                  },
                  0,
                ],
              },

              cancelledLoans: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.cancelledLoans",
                      0,
                    ],
                  },
                  0,
                ],
              },

              defaultedLoans: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.defaultedLoans",
                      0,
                    ],
                  },
                  0,
                ],
              },

              totalPrincipal: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.totalPrincipal",
                      0,
                    ],
                  },
                  0,
                ],
              },

              totalInterest: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$counts.totalInterest",
                      0,
                    ],
                  },
                  0,
                ],
              },

              totalOutstanding: {
                $ifNull: [
                  {
                    $arrayElemAt: [
                      "$balances.totalOutstanding",
                      0,
                    ],
                  },
                  0,
                ],
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
              _id:
                null,

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
              _id:
                null,

              totalFines: {
                $sum:
                  "$amount",
              },
            },
          },
        ])
        .toArray(),

      waivers
        .aggregate<{
          _id: null;
          totalWaivedFines: number;
        }>([
          {
            $group: {
              _id:
                null,

              totalWaivedFines: {
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
          ?.totalPaid ||
          0,
      ),
    );

  const totalFines =
    money(
      Number(
        fineStats[0]
          ?.totalFines ||
          0,
      ),
    );

  const totalWaivedFines =
    money(
      Number(
        waiverStats[0]
          ?.totalWaivedFines ||
          0,
      ),
    );

  const totalOutstanding =
    money(
      Number(
        loansData?.totalOutstanding ||
          0,
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

    defaultedLoans:
      Number(
        loansData?.defaultedLoans ||
          0,
      ),

    totalPrincipal,

    totalInterest,

    totalFines,

    totalWaivedFines,

    totalPaid,

    totalOutstanding,
  };
}