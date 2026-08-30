/**
 * GEO-SHUA
 * Loan Domain Service
 *
 * IMPORTANT:
 * - Public/domain IDs are strings.
 * - MongoDB relation IDs are ObjectId.
 * - Conversion happens at the persistence boundary.
 *
 * Financial records are append-oriented.
 * Repayments, fines and audit records are never permanently deleted.
 */

import { ObjectId, type Collection, type Db } from "mongodb";

import clientPromise from "@/lib/mongodb";

import type {
  CreateLoanInput,
  CreateLoanRepaymentInput,
  FineSource,
  Loan,
  LoanActor,
  LoanAuditEntry,
  LoanFine,
  LoanGuarantor,
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

const LOANS_COLLECTION = "loans";
const LOAN_SETTINGS_COLLECTION = "loanSettings";
const LOAN_REPAYMENTS_COLLECTION = "loanRepayments";
const LOAN_FINES_COLLECTION = "loanFines";
const LOAN_AUDIT_COLLECTION = "loanAudit";
const COUNTERS_COLLECTION = "counters";

const SYSTEM_ACTOR: LoanActor = {
  name: "System",
  email: "system",
};

/* =========================================================
   MONGODB DOCUMENT TYPES
========================================================= */

/**
 * IMPORTANT:
 *
 * The application/domain layer uses string IDs.
 *
 * MongoDB relations use ObjectId.
 *
 * Therefore these persistence types deliberately differ
 * from the public domain interfaces.
 */

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
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  return {
    client,
    db,

    loans: db.collection<LoanDocument>(
      LOANS_COLLECTION,
    ),

    settings: db.collection<LoanSettingsDocument>(
      LOAN_SETTINGS_COLLECTION,
    ),

    repayments: db.collection<LoanRepaymentDocument>(
      LOAN_REPAYMENTS_COLLECTION,
    ),

    fines: db.collection<LoanFineDocument>(
      LOAN_FINES_COLLECTION,
    ),

    audit: db.collection<LoanAuditDocument>(
      LOAN_AUDIT_COLLECTION,
    ),

    counters: db.collection<CounterDocument>(
      COUNTERS_COLLECTION,
    ),
  };
}

/* =========================================================
   HELPERS
========================================================= */

function createObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
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
    (error as { code?: unknown }).code === 11000
  );
}

function normalizeActor(
  actor?: LoanActor,
): LoanActor {
  if (!actor || typeof actor !== "object") {
    return SYSTEM_ACTOR;
  }

  const name =
    typeof actor.name === "string"
      ? normalizeText(actor.name)
      : "";

  const email =
    typeof actor.email === "string"
      ? actor.email.trim().toLowerCase()
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

function firstError(
  errors: string[],
): string {
  return (
    errors[0] ||
    "Invalid loan data."
  );
}

/* =========================================================
   MONGO -> DOMAIN CONVERSION
========================================================= */

/**
 * Never expose MongoDB ObjectId values through the
 * application/domain layer.
 */

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
    id: document._id.toString(),
    memberId: document.memberId.toString(),
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
    id: document._id.toString(),
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
    id: document._id.toString(),
    loanId: document.loanId.toString(),
    memberId: document.memberId.toString(),
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
    id: document._id.toString(),
    loanId: document.loanId.toString(),
    memberId: document.memberId.toString(),
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
    id: document._id.toString(),
    loanId: document.loanId.toString(),
  };
}

/* =========================================================
   MONEY / DATE HELPERS
========================================================= */

/**
 * Round money safely to two decimal places.
 */
function money(value: number): number {
  return (
    Math.round(
      (value + Number.EPSILON) * 100,
    ) / 100
  );
}

/**
 * Add calendar days without mutating
 * the original Date.
 */
function addDays(
  date: Date,
  days: number,
): Date {
  const result = new Date(
    date.getTime(),
  );

  result.setDate(
    result.getDate() + days,
  );

  return result;
}

/**
 * Start of local calendar day.
 */
function startOfDay(
  date: Date,
): Date {
  const result = new Date(date);

  result.setHours(
    0,
    0,
    0,
    0,
  );

  return result;
}

/**
 * End of local calendar day.
 */
function endOfDay(
  date: Date,
): Date {
  const result = startOfDay(date);

  result.setHours(
    23,
    59,
    59,
    999,
  );

  return result;
}

/**
 * Business day key.
 *
 * Used only for diagnostics/idempotency concepts.
 */
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
  } = await getCollections();

  await Promise.all([
    loans.createIndex(
      {
        loanNumber: 1,
      },
      {
        unique: true,
        name: "loans_loanNumber_unique",
      },
    ),

    loans.createIndex(
      {
        memberId: 1,
        status: 1,
      },
      {
        name: "loans_member_status",
      },
    ),

    loans.createIndex(
      {
        createdAt: -1,
        _id: -1,
      },
      {
        name: "loans_createdAt_id_desc",
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
        transactionDate: 1,
      },
      {
        name:
          "loanRepayments_loan_date",
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
      },
      {
        name: "loanFines_loanId",
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
): Promise<number> {
  const { counters } =
    await getCollections();

  const now = new Date();

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
      },
    );

  if (!result) {
    throw new Error(
      "Unable to generate loan sequence.",
    );
  }

  return result.sequence;
}

async function generateLoanNumber(): Promise<string> {
  const sequence =
    await getNextSequence(
      "loanNumber",
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
   DEFAULT LOAN SETTINGS
========================================================= */

const DEFAULT_SETTINGS: Omit<
  LoanSettings,
  "id" | "createdAt" | "updatedAt"
> = {
  regularInterestRate: 0.3,
  emergencyInterestRate: 0.4,

  regularMinimumSavings: 10000,
  regularSavingsMultiplier: 2,

  repaymentGraceDays: 7,

  defaultDailyFine: 200,

  emergencyLoansEnabled: true,
  regularLoansEnabled: true,

  updatedBy: SYSTEM_ACTOR,
};

/* =========================================================
   GET LOAN SETTINGS
========================================================= */

export async function getLoanSettings(): Promise<LoanSettings> {
  const { settings } =
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
    return toSettings(existing);
  }

  const now = new Date();

  const document: LoanSettingsDocument = {
    ...DEFAULT_SETTINGS,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result =
      await settings.insertOne(
        document,
      );

    return toSettings({
      ...document,
      _id: result.insertedId,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const retry =
        await settings.findOne(
          {},
          {
            sort: {
              createdAt: -1,
              _id: -1,
            },
          },
        );

      if (retry) {
        return toSettings(retry);
      }
    }

    throw error;
  }
}

/* =========================================================
   UPDATE LOAN SETTINGS
========================================================= */

export async function updateLoanSettings(
  changes: Partial<LoanSettings>,
  updatedBy: LoanActor,
): Promise<LoanSettings> {
  const actor =
    normalizeActor(updatedBy);

  const validation =
    validateLoanSettings(changes);

  if (!validation.valid) {
    throw new Error(
      firstError(validation.errors),
    );
  }

  const current =
    await getLoanSettings();

  const {
    id: _ignoredId,
    createdAt: _ignoredCreatedAt,
    updatedAt: _ignoredUpdatedAt,
    updatedBy: _ignoredUpdatedBy,
    ...safeChanges
  } = changes;

  void _ignoredId;
  void _ignoredCreatedAt;
  void _ignoredUpdatedAt;
  void _ignoredUpdatedBy;

  const now = new Date();

  const { settings } =
    await getCollections();

  const currentId =
    createObjectId(current.id);

  await settings.updateOne(
    {
      _id: currentId,
    },
    {
      $set: {
        ...safeChanges,
        updatedBy: actor,
        updatedAt: now,
      },
    },
  );

  const updated =
    await settings.findOne({
      _id: currentId,
    });

  if (!updated) {
    throw new Error(
      "Loan settings were updated but could not be retrieved.",
    );
  }

  return toSettings(updated);
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
): Promise<MemberForLoan> {
  const { db } =
    await getCollections();

  const member =
    await db
      .collection<MemberForLoan>(
        "members",
      )
      .findOne({
        _id: createObjectId(
          memberId,
        ),
      });

  if (!member) {
    throw new Error(
      "Member not found.",
    );
  }

  return member;
}

async function getSavingsBalance(
  memberId: ObjectId,
): Promise<number> {
  const { db } =
    await getCollections();

  const account =
    await db
      .collection<SavingsAccountForLoan>(
        "savingsAccounts",
      )
      .findOne({
        memberId,
        accountType: "fixed",
        status: "active",
      });

  if (!account) {
    throw new Error(
      "Member does not have an active fixed savings account.",
    );
  }

  if (
    typeof account.balance !== "number" ||
    !Number.isFinite(
      account.balance,
    ) ||
    account.balance < 0
  ) {
    throw new Error(
      "Member savings account has an invalid balance.",
    );
  }

  return money(account.balance);
}

/* =========================================================
   EXISTING OPEN LOAN CHECK
========================================================= */

async function getExistingOpenLoan(
  memberId: ObjectId,
): Promise<Loan | null> {
  const { loans } =
    await getCollections();

  const existing =
    await loans.findOne({
      memberId,
      status: {
        $in: [
          "pending",
          "active",
        ],
      },
    });

  return existing
    ? toLoan(existing)
    : null;
}

/* =========================================================
   OUTSTANDING LOAN LIABILITY
========================================================= */

async function getLoanFineTotal(
  loanId: ObjectId,
): Promise<number> {
  const { fines } =
    await getCollections();

  const result =
    await fines
      .aggregate<{
        _id: null;
        total: number;
      }>([
        {
          $match: {
            loanId,
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: "$amount",
            },
          },
        },
      ])
      .toArray();

  return money(
    Number(
      result[0]?.total || 0,
    ),
  );
}

async function getLoanPaidTotal(
  loanId: ObjectId,
): Promise<number> {
  const { repayments } =
    await getCollections();

  const result =
    await repayments
      .aggregate<{
        _id: null;
        total: number;
      }>([
        {
          $match: {
            loanId,
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: "$amount",
            },
          },
        },
      ])
      .toArray();

  return money(
    Number(
      result[0]?.total || 0,
    ),
  );
}

/* =========================================================
   RECALCULATE LOAN
========================================================= */

async function recalculateLoan(
  loanId: ObjectId,
): Promise<Loan> {
  const { loans } =
    await getCollections();

  const loan =
    await loans.findOne({
      _id: loanId,
    });

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  const amountPaid =
    await getLoanPaidTotal(
      loanId,
    );

  const totalFines =
    await getLoanFineTotal(
      loanId,
    );

  const liability =
    money(
      loan.totalDue +
        totalFines,
    );

  const outstandingBalance =
    money(
      Math.max(
        0,
        liability -
          amountPaid,
      ),
    );

  let status =
    loan.status;

  if (
    loan.status !== "cancelled" &&
    outstandingBalance <= 0
  ) {
    status = "completed";
  }

  /**
   * Do not resurrect a cancelled loan.
   */
  if (loan.status === "cancelled") {
    status = "cancelled";
  }

  const now = new Date();

  /**
   * Only update when values actually need changing.
   */
  const changed =
    loan.amountPaid !== amountPaid ||
    loan.totalFines !== totalFines ||
    loan.outstandingBalance !==
      outstandingBalance ||
    loan.status !== status;

  if (changed) {
    await loans.updateOne(
      {
        _id: loanId,
      },
      {
        $set: {
          amountPaid,
          totalFines,
          outstandingBalance,
          status,
          updatedAt: now,
        },
      },
    );
  }

  const updated =
    await loans.findOne({
      _id: loanId,
    });

  if (!updated) {
    throw new Error(
      "Loan state was updated but could not be retrieved.",
    );
  }

  return toLoan(updated);
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
): Promise<void> {
  const { audit } =
    await getCollections();

  const document: LoanAuditDocument = {
    _id: new ObjectId(),

    loanId,

    loanNumber,

    action,

    actor,

    ...(details
      ? {
          details,
        }
      : {}),

    createdAt: new Date(),
  };

  await audit.insertOne(
    document,
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
    normalizeActor(createdBy);

  const authorizer =
    normalizeActor(
      authorizedBy || creator,
    );

  const validation =
    validateCreateLoan(input);

  if (!validation.valid) {
    throw new Error(
      firstError(validation.errors),
    );
  }

  const member =
    await getMemberForLoan(
      input.memberId,
    );

  if (member.status !== "active") {
    throw new Error(
      "Only active members can receive loans.",
    );
  }

  const settings =
    await getLoanSettings();

  if (
    input.type === "emergency" &&
    !settings.emergencyLoansEnabled
  ) {
    throw new Error(
      "Emergency loans are currently disabled.",
    );
  }

  if (
    input.type === "regular" &&
    !settings.regularLoansEnabled
  ) {
    throw new Error(
      "Regular loans are currently disabled.",
    );
  }

  /**
   * One open loan per member.
   */
  const existingLoan =
    await getExistingOpenLoan(
      member._id,
    );

  if (existingLoan) {
    throw new Error(
      `Member already has an existing loan (${existingLoan.loanNumber}).`,
    );
  }

  let savingsBalance:
    | number
    | null = null;

  if (input.type === "regular") {
    savingsBalance =
      await getSavingsBalance(
        member._id,
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

    /**
     * Protect against inconsistent legacy data.
     *
     * A completed/cancelled record must not be treated
     * as open, but an outstanding liability on a legacy
     * completed record must still block a new loan.
     */
    const { loans } =
      await getCollections();

    const previousLoans =
      await loans
        .find({
          memberId:
            member._id,
          status: {
            $ne: "cancelled",
          },
        })
        .toArray();

    for (
      const previous of previousLoans
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
  }

  /**
   * Interest is a snapshot.
   *
   * Changing future loan settings does not alter
   * this existing loan.
   */
  const rate =
    input.type === "emergency"
      ? settings.emergencyInterestRate
      : settings.regularInterestRate;

  const interestAmount =
    money(
      input.principal *
        rate,
    );

  const dailyFine =
    input.dailyFine !== undefined
      ? money(input.dailyFine)
      : money(
          settings.defaultDailyFine,
        );

  const fineSource: FineSource =
    input.dailyFine !== undefined
      ? "custom"
      : "default";

  const disbursementDate =
    input.disbursementDate
      ? new Date(
          input.disbursementDate,
        )
      : new Date();

  if (
    Number.isNaN(
      disbursementDate.getTime(),
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
      input.principal +
        interestAmount,
    );

  const loanNumber =
    await generateLoanNumber();

  const guarantor =
    normalizeGuarantor(
      input.guarantor,
    );

  const now = new Date();

  const loanDocument: LoanDocument = {
    _id: new ObjectId(),

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

    type: input.type,

    principal:
      money(input.principal),

    interestRate: rate,

    interestAmount,

    dailyFine,

    fineSource,

    disbursementDate,

    firstDueDate,

    totalDue,

    amountPaid: 0,

    totalFines: 0,

    outstandingBalance:
      totalDue,

    fineStatus: "active",

    guarantor,

    /**
     * Loan authorization is recorded at creation
     * under the current workflow.
     */
    status: "active",

    createdBy: creator,

    authorizedBy: authorizer,

    authorizedAt: now,

    createdAt: now,

    updatedAt: now,
  };

  await ensureLoanIndexes();

  const { loans } =
    await getCollections();

  try {
    await loans.insertOne(
      loanDocument,
    );
  } catch (error) {
    if (
      isDuplicateKeyError(error)
    ) {
      throw new Error(
        "A loan with this loan number already exists. Please retry.",
      );
    }

    throw error;
  }

  const created =
    await loans.findOne({
      _id: loanDocument._id,
    });

  if (!created) {
    throw new Error(
      "Loan was created but could not be retrieved.",
    );
  }

  const loan =
    toLoan(created);

  await writeAudit(
    loanDocument._id!,
    loanNumber,
    "created",
    creator,
    {
      type: input.type,
      principal: loan.principal,
      interestRate:
        loan.interestRate,
      interestAmount:
        loan.interestAmount,
      dailyFine:
        loan.dailyFine,
      fineSource:
        loan.fineSource,
      disbursementDate:
        loan.disbursementDate,
      firstDueDate:
        loan.firstDueDate,
      totalDue:
        loan.totalDue,
      savingsBalance,
    },
  );

  await writeAudit(
    loanDocument._id!,
    loanNumber,
    "authorized",
    authorizer,
    {
      authorizedAt: now,
    },
  );

  return loan;
}

/* =========================================================
   GET LOAN BY ID
========================================================= */

export async function getLoanById(
  id: string,
): Promise<Loan | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const { loans } =
    await getCollections();

  const objectId =
    createObjectId(id);

  const loan =
    await loans.findOne({
      _id: objectId,
    });

  if (!loan) {
    return null;
  }

  await accrueLoanFines(id);

  return recalculateLoan(
    objectId,
  );
}

/* =========================================================
   GET LOAN BY NUMBER
========================================================= */

export async function getLoanByNumber(
  loanNumber: string,
): Promise<Loan | null> {
  const normalized =
    loanNumber.trim();

  if (!normalized) {
    return null;
  }

  const { loans } =
    await getCollections();

  const loan =
    await loans.findOne({
      loanNumber:
        normalized,
    });

  if (!loan || !loan._id) {
    return null;
  }

  await accrueLoanFines(
    loan._id.toString(),
  );

  return recalculateLoan(
    loan._id,
  );
}

/* =========================================================
   LIST LOANS
========================================================= */

export async function getLoans(
  options: LoanListOptions = {},
): Promise<PaginatedLoans> {
  const { loans } =
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

  const filter: Record<
    string,
    unknown
  > = {};

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
      ObjectId.isValid(
        options.memberId,
      )
    ) {
      filter.memberId =
        createObjectId(
          options.memberId,
        );
    } else {
      return {
        loans: [],
        total: 0,
        page: 1,
        limit,
        totalPages: 0,
      };
    }
  }

  const search =
    typeof options.search ===
    "string"
      ? options.search.trim()
      : "";

  if (search) {
    /**
     * Escape user-provided regex characters.
     */
    const escaped =
      search.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );

    const regex =
      new RegExp(
        escaped,
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

  const skip =
    (safePage - 1) *
    limit;

  const documents =
    await loans
      .find(filter)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .skip(skip)
      .limit(limit)
      .toArray();

  const result: Loan[] = [];

  for (
    const document of documents
  ) {
    if (!document._id) {
      continue;
    }

    await accrueLoanFines(
      document._id.toString(),
    );

    result.push(
      await recalculateLoan(
        document._id,
      ),
    );
  }

  return {
    loans: result,
    total,
    page: safePage,
    limit,
    totalPages,
  };
}

/* =========================================================
   ACCRUE DAILY FINES
========================================================= */

/**
 * Create one fine record for every overdue day.
 *
 * Important:
 *
 * Due date itself is NOT fined.
 *
 * First fine day is the calendar day after
 * firstDueDate.
 *
 * Example:
 *
 * Disbursement: 1st
 * Grace: 7 days
 * Due: 8th
 * First fine: 9th
 */
export async function accrueLoanFines(
  loanId: string,
  asOfDate: Date = new Date(),
): Promise<number> {
  if (!ObjectId.isValid(loanId)) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  if (
    Number.isNaN(
      asOfDate.getTime(),
    )
  ) {
    throw new Error(
      "Invalid as-of date.",
    );
  }

  const {
    loans,
    fines,
  } = await getCollections();

  const objectId =
    createObjectId(loanId);

  const loan =
    await loans.findOne({
      _id: objectId,
    });

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  if (
    loan.status === "cancelled" ||
    loan.status === "completed"
  ) {
    return 0;
  }

  if (
    loan.fineStatus === "stopped"
  ) {
    return 0;
  }

  const today =
    startOfDay(asOfDate);

  const firstFineDate =
    addDays(
      startOfDay(
        loan.firstDueDate,
      ),
      1,
    );

  if (
    today < firstFineDate
  ) {
    return 0;
  }

  let createdCount = 0;

  let current =
    new Date(
      firstFineDate,
    );

  while (
    current <= today
  ) {
    const fineDate =
      startOfDay(current);

    /**
     * Exact calendar-day query.
     *
     * This avoids relying on Date object equality
     * if legacy records contain a different time.
     */
    const existing =
      await fines.findOne({
        loanId:
          objectId,
        fineDate: {
          $gte: fineDate,
          $lte: endOfDay(
            fineDate,
          ),
        },
      });

    if (!existing) {
      const document:
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
          document,
        );

        createdCount++;

        await writeAudit(
          objectId,
          loan.loanNumber,
          "fine_recorded",
          SYSTEM_ACTOR,
          {
            fineDate:
              document.fineDate,

            dayKey:
              dayKey(
                document.fineDate,
              ),

            amount:
              document.amount,

            dailyFineRate:
              document.dailyFineRate,
          },
        );
      } catch (error) {
        /**
         * Concurrent calls are expected to race here.
         *
         * The unique index guarantees that only one
         * fine for the loan/date can survive.
         */
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
  if (!ObjectId.isValid(loanId)) {
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

  const { loans } =
    await getCollections();

  const objectId =
    createObjectId(loanId);

  const loan =
    await loans.findOne({
      _id: objectId,
    });

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  if (
    loan.fineStatus === "stopped"
  ) {
    return recalculateLoan(
      objectId,
    );
  }

  const now = new Date();

  await loans.updateOne(
    {
      _id: objectId,
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

  await writeAudit(
    objectId,
    loan.loanNumber,
    "fine_stopped",
    actor,
    {
      reason,
      stoppedAt: now,
    },
  );

  return recalculateLoan(
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
  if (!ObjectId.isValid(loanId)) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const actor =
    normalizeActor(
      resumedBy,
    );

  const cleanReason =
    typeof reason === "string"
      ? normalizeText(reason)
      : "";

  if (!cleanReason) {
    throw new Error(
      "A reason is required when resuming fines.",
    );
  }

  const { loans } =
    await getCollections();

  const objectId =
    createObjectId(loanId);

  const loan =
    await loans.findOne({
      _id: objectId,
    });

  if (!loan) {
    throw new Error(
      "Loan not found.",
    );
  }

  if (
    loan.status === "cancelled" ||
    loan.status === "completed"
  ) {
    throw new Error(
      "Fines cannot be resumed on a completed or cancelled loan.",
    );
  }

  const now = new Date();

  await loans.updateOne(
    {
      _id: objectId,
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

  return recalculateLoan(
    objectId,
  );
}

/* =========================================================
   RESOLVE REPAYMENT LOAN
========================================================= */

async function resolveLoanForRepayment(
  input: CreateLoanRepaymentInput,
): Promise<LoanDocument> {
  const { loans } =
    await getCollections();

  let loan:
    | LoanDocument
    | null = null;

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

    loan =
      await loans.findOne({
        _id: createObjectId(
          input.loanId,
        ),
      });
  }

  if (!loan && input.memberId) {
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

    /**
     * Find all open loans rather than silently
     * selecting an arbitrary one.
     */
    const openLoans =
      await loans
        .find({
          memberId,
          status: {
            $in: [
              "pending",
              "active",
            ],
          },
        })
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .limit(2)
        .toArray();

    if (openLoans.length > 1) {
      throw new Error(
        "Member has multiple open loans. Loan ID is required to record this repayment safely.",
      );
    }

    loan =
      openLoans[0] || null;
  }

  if (!loan) {
    throw new Error(
      "No active loan could be resolved for this repayment.",
    );
  }

  return loan;
}

/* =========================================================
   RECORD LOAN REPAYMENT
========================================================= */

export async function createLoanRepayment(
  input: CreateLoanRepaymentInput,
): Promise<LoanRepayment> {
  const validation =
    validateLoanRepayment(
      input,
    );

  if (!validation.valid) {
    throw new Error(
      firstError(validation.errors),
    );
  }

  const {
    repayments,
  } = await getCollections();

  const reference =
    normalizeText(
      input.transactionReference,
    );

  /**
   * Idempotency check BEFORE touching financial state.
   */
  const existing =
    await repayments.findOne({
      transactionReference:
        reference,
    });

  if (existing) {
    return toRepayment(
      existing,
    );
  }

  const loan =
    await resolveLoanForRepayment(
      input,
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

  /**
   * Reconcile overdue fines before calculating
   * the current amount owed.
   */
  await accrueLoanFines(
    loan._id.toString(),
    input.transactionDate,
  );

  const currentLoan =
    await recalculateLoan(
      loan._id,
    );

  const amount =
    money(input.amount);

  if (
    amount >
    currentLoan.outstandingBalance
  ) {
    throw new Error(
      `Repayment exceeds the outstanding balance of KSh ${currentLoan.outstandingBalance.toLocaleString()}.`,
    );
  }

  const document:
    LoanRepaymentDocument = {
    _id:
      new ObjectId(),

    loanId:
      loan._id,

    loanNumber:
      loan.loanNumber,

    memberId:
      loan.memberId,

    memberNumber:
      loan.memberNumber,

    amount,

    transactionReference:
      reference,

    transactionDate:
      new Date(
        input.transactionDate,
      ),

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

  try {
    await repayments.insertOne(
      document,
    );
  } catch (error) {
    /**
     * SMS/M-Pesa idempotency.
     *
     * If another request inserted this transaction
     * at the same time, return that existing transaction
     * rather than creating another financial record.
     */
    if (
      isDuplicateKeyError(
        error,
      )
    ) {
      const duplicate =
        await repayments.findOne({
          transactionReference:
            reference,
        });

      if (duplicate) {
        return toRepayment(
          duplicate,
        );
      }
    }

    throw error;
  }

  const repayment =
    toRepayment(
      document,
    );

  await writeAudit(
    loan._id,
    loan.loanNumber,
    "repayment_recorded",
    input.recordedBy
      ? normalizeActor(
          input.recordedBy,
        )
      : SYSTEM_ACTOR,
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
    },
  );

  /**
   * Recalculate after the append-only transaction
   * has been successfully stored.
   */
  const updatedLoan =
    await recalculateLoan(
      loan._id,
    );

  /**
   * Write completion audit once the loan transitions
   * into completed state.
   */
  if (
    updatedLoan.status ===
      "completed" &&
    currentLoan.status !==
      "completed"
  ) {
    await writeAudit(
      loan._id,
      loan.loanNumber,
      "completed",
      SYSTEM_ACTOR,
      {
        completedAt:
          new Date(),
        finalAmountPaid:
          updatedLoan.amountPaid,
        totalDue:
          updatedLoan.totalDue,
        totalFines:
          updatedLoan.totalFines,
      },
    );
  }

  return repayment;
}

/* =========================================================
   GET REPAYMENTS
========================================================= */

export async function getLoanRepayments(
  loanId: string,
): Promise<LoanRepayment[]> {
  if (!ObjectId.isValid(loanId)) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const {
    repayments,
  } = await getCollections();

  const objectId =
    createObjectId(loanId);

  const documents =
    await repayments
      .find({
        loanId:
          objectId,
      })
      .sort({
        transactionDate: -1,
        createdAt: -1,
        _id: -1,
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
  if (!ObjectId.isValid(loanId)) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const { fines } =
    await getCollections();

  const objectId =
    createObjectId(loanId);

  const documents =
    await fines
      .find({
        loanId:
          objectId,
      })
      .sort({
        fineDate: -1,
        _id: -1,
      })
      .toArray();

  return documents.map(
    toFine,
  );
}

/* =========================================================
   GET AUDIT HISTORY
========================================================= */

export async function getLoanAudit(
  loanId: string,
): Promise<LoanAuditEntry[]> {
  if (!ObjectId.isValid(loanId)) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const { audit } =
    await getCollections();

  const objectId =
    createObjectId(loanId);

  const documents =
    await audit
      .find({
        loanId:
          objectId,
      })
      .sort({
        createdAt: 1,
        _id: 1,
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
  if (!ObjectId.isValid(loanId)) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const actor =
    normalizeActor(
      cancelledBy,
    );

  const cleanReason =
    typeof reason === "string"
      ? normalizeText(reason)
      : "";

  if (!cleanReason) {
    throw new Error(
      "A cancellation reason is required.",
    );
  }

  const { loans } =
    await getCollections();

  const objectId =
    createObjectId(loanId);

  const loan =
    await loans.findOne({
      _id: objectId,
    });

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
    return toLoan(loan);
  }

  const now = new Date();

  await loans.updateOne(
    {
      _id: objectId,
    },
    {
      $set: {
        status:
          "cancelled",
        updatedAt:
          now,
      },
    },
  );

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
  );

  return recalculateLoan(
    objectId,
  );
}

/* =========================================================
   LOAN SUMMARY
========================================================= */

export async function getLoanSummary(): Promise<LoanSummary> {
  const { loans } =
    await getCollections();

  const documents =
    await loans.find({}).toArray();

  /**
   * Accrue fines for open loans.
   */
  for (
    const loan of documents
  ) {
    if (
      loan._id &&
      (
        loan.status === "active" ||
        loan.status === "pending"
      )
    ) {
      await accrueLoanFines(
        loan._id.toString(),
      );
    }
  }

  const refreshed =
    await loans.find({}).toArray();

  let totalPrincipal = 0;
  let totalInterest = 0;
  let totalFines = 0;
  let totalPaid = 0;
  let totalOutstanding = 0;

  let activeLoans = 0;
  let completedLoans = 0;
  let pendingLoans = 0;
  let cancelledLoans = 0;

  for (
    const loan of refreshed
  ) {
    if (!loan._id) {
      continue;
    }

    const current =
      await recalculateLoan(
        loan._id,
      );

    totalPrincipal +=
      current.principal;

    totalInterest +=
      current.interestAmount;

    totalFines +=
      current.totalFines;

    totalPaid +=
      current.amountPaid;

    totalOutstanding +=
      current.outstandingBalance;

    if (
      current.status ===
      "active"
    ) {
      activeLoans++;
    } else if (
      current.status ===
      "completed"
    ) {
      completedLoans++;
    } else if (
      current.status ===
      "pending"
    ) {
      pendingLoans++;
    } else if (
      current.status ===
      "cancelled"
    ) {
      cancelledLoans++;
    }
  }

  return {
    totalLoans:
      refreshed.length,

    activeLoans,

    completedLoans,

    pendingLoans,

    cancelledLoans,

    totalPrincipal:
      money(totalPrincipal),

    totalInterest:
      money(totalInterest),

    totalFines:
      money(totalFines),

    totalPaid:
      money(totalPaid),

    totalOutstanding:
      money(totalOutstanding),
  };
}