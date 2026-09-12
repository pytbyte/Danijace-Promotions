/**
 * GEO-SHUA
 * Loan Domain Service
 *
 * Loan lifecycle: full CRUD.
 *
 * CORE LOAN MODEL
 * ---------------------------------------------------------------
 * principal            = total amount disbursed.
 * interestAmount       = principal × applicable interest rate.
 * totalDue             = principal + interestAmount.
 * installmentAmount    = contractual amount expected each cycle.
 * amountDue            = amount expected for the current specific cycle,
 *                        never greater than the remaining core balance.
 * amountPaid           = sum of recorded repayments.
 * totalFines           = sum of cycle-based fines.
 * outstandingBalance   = principal + interest + effective fines - amountPaid.
 *
 * INSTALLMENT FINE
 * ---------------------------------------------------------------
 * At the end of each completed repayment cycle:
 *
 * installmentShortfall = max(0, amountDue - paymentsDuringPeriod)
 * fineAmount           = installmentShortfall × fineRate
 *
 * The default fine rate is 10%.
 * Fines are never calculated from the entire loan balance.
 * Existing fines never compound.
 * One fine is allowed per repayment cycle.
 *
 * Loan contractual dates are stored as YYYY-MM-DD calendar strings.
 * Repayment transactionDate remains a real timestamp.
 *
 * Financial ledgers remain separate from the loan master record.
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
  LoanGuarantor,
  LoanType,
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

type CalendarDate = string;

function isValidDate(
  value: Date,
): boolean {
  return (
    value instanceof Date &&
    !Number.isNaN(value.getTime())
  );
}

function isCalendarDate(
  value: unknown,
): value is CalendarDate {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  if (
    !Number.isInteger(year) ||
    year < 1 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1
  ) {
    return false;
  }

  const leap =
    year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0);

  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];

  return day <= daysInMonth;
}

function assertCalendarDate(
  value: unknown,
  fieldName: string,
): asserts value is CalendarDate {
  if (!isCalendarDate(value)) {
    throw new Error(
      `Invalid ${fieldName}. Expected YYYY-MM-DD.`,
    );
  }
}

/*
 * Civil-date arithmetic.
 *
 * These helpers deliberately do NOT create JavaScript Date objects
 * from loan business dates. Loan calendar dates remain YYYY-MM-DD
 * strings throughout the domain and persistence layers.
 */
function daysFromCivil(
  year: number,
  month: number,
  day: number,
): number {
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const monthPrime = month + (month > 2 ? -3 : 9);
  const dayOfYear =
    Math.floor((153 * monthPrime + 2) / 5) +
    day -
    1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;

  return (
    era * 146097 +
    dayOfEra -
    719468
  );
}

function civilFromDays(
  serial: number,
): {
  year: number;
  month: number;
  day: number;
} {
  serial += 719468;

  const era =
    Math.floor(
      serial / 146097,
    );
  const dayOfEra =
    serial -
    era * 146097;
  const yearOfEra =
    Math.floor(
      (
        dayOfEra -
        Math.floor(dayOfEra / 1460) +
        Math.floor(dayOfEra / 36524) -
        Math.floor(dayOfEra / 146096)
      ) / 365,
    );
  let year =
    yearOfEra +
    era * 400;
  const dayOfYear =
    dayOfEra -
    (
      365 * yearOfEra +
      Math.floor(yearOfEra / 4) -
      Math.floor(yearOfEra / 100)
    );
  const monthPrime =
    Math.floor(
      (5 * dayOfYear + 2) / 153,
    );
  const day =
    dayOfYear -
    Math.floor(
      (153 * monthPrime + 2) / 5,
    ) +
    1;
  const month =
    monthPrime +
    (monthPrime < 10 ? 3 : -9);

  year += month <= 2 ? 1 : 0;

  return {
    year,
    month,
    day,
  };
}

function addCalendarDays(
  value: CalendarDate,
  days: number,
): CalendarDate {
  assertCalendarDate(
    value,
    "calendar date",
  );

  if (!Number.isInteger(days)) {
    throw new Error(
      "Calendar day offset must be a whole number.",
    );
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  const result = civilFromDays(
    daysFromCivil(
      year,
      month,
      day,
    ) + days,
  );

  if (
    result.year < 1 ||
    result.year > 9999
  ) {
    throw new Error(
      "Calendar date is outside the supported range.",
    );
  }

  return `${String(result.year).padStart(4, "0")}-${String(result.month).padStart(2, "0")}-${String(result.day).padStart(2, "0")}`;
}

function differenceInCalendarDays(
  from: CalendarDate,
  to: CalendarDate,
): number {
  assertCalendarDate(
    from,
    "start calendar date",
  );
  assertCalendarDate(
    to,
    "end calendar date",
  );

  return (
    daysFromCivil(
      Number(from.slice(0, 4)),
      Number(from.slice(5, 7)),
      Number(from.slice(8, 10)),
    ) -
    daysFromCivil(
      Number(to.slice(0, 4)),
      Number(to.slice(5, 7)),
      Number(to.slice(8, 10)),
    )
  ) * -1;
}

function dateToKenyanCalendarDate(
  date: Date,
): CalendarDate {
  if (!isValidDate(date)) {
    throw new Error(
      "Invalid date.",
    );
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Africa/Nairobi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(date);

  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const result =
    `${values.year}-${values.month}-${values.day}`;

  assertCalendarDate(
    result,
    "Kenyan calendar date",
  );

  return result;
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
  asOfDate: CalendarDate,
  session?: ClientSession,
): Promise<number> {
  assertCalendarDate(
    asOfDate,
    "repayment cutoff date",
  );

  const { repayments } = await getCollections();

  const result = await repayments
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
          $match: {
            $expr: {
              $lte: [
                {
                  $dateToString: {
                    date: "$transactionDate",
                    format: "%Y-%m-%d",
                    timezone: "Africa/Nairobi",
                  },
                },
                asOfDate,
              ],
            },
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
      ],
      { session },
    )
    .toArray();

  return money(
    Number(result[0]?.total || 0),
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
  principal: number,
  interestAmount: number,
  amountPaid: number,
): number {
  return money(
    Math.max(
      0,
      money(principal + interestAmount) - amountPaid,
    ),
  );
}

function calculateFinalOutstanding(
  principal: number,
  interestAmount: number,
  totalFines: number,
  totalWaivedFines: number,
  amountPaid: number,
): number {
  const effectiveFines = money(
    Math.max(
      0,
      totalFines - Math.min(totalFines, totalWaivedFines),
    ),
  );

  return money(
    Math.max(
      0,
      money(principal + interestAmount) +
        effectiveFines -
        amountPaid,
    ),
  );
}

/**
 * Amount due for one specific repayment cycle.
 *
 * The contractual installment is the target. The final cycle may
 * require less when the remaining core balance is smaller.
 */
export function calculateLoanAmountDue(
  installmentAmount: number,
  principal: number,
  interestAmount: number,
  amountPaid: number,
): number {
  const remainingCore = Math.max(
    0,
    money(principal + interestAmount) - amountPaid,
  );

  return money(
    Math.min(
      money(installmentAmount),
      remainingCore,
    ),
  );
}

function calculateUnpaidInstallment(
  amountDue: number,
  paymentsDuringPeriod: number,
): number {
  return money(
    Math.max(
      0,
      amountDue - paymentsDuringPeriod,
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
      loan.principal,
      loan.interestAmount,
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

  /*
   * Reject removed legacy daily-fine fields.
   */
  if (
    "dailyFine" in rawInput ||
    "defaultDailyFine" in rawInput ||
    "fineSource" in rawInput
  ) {
    throw new Error(
      "Daily fines are no longer supported. Use fineRate.",
    );
  }

  /*
   * Validate the complete create-loan payload before
   * opening the database transaction.
   */
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
          /* =================================================
             MEMBER
          ================================================= */

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

          /* =================================================
             SETTINGS
          ================================================= */

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

          /* =================================================
             PREVENT MULTIPLE OPEN LOANS
          ================================================= */

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

          /* =================================================
             REGULAR LOAN ELIGIBILITY
          ================================================= */

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

          /* =================================================
             PREVIOUS LOANS
          ================================================= */

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
                previous.principal,
                previous.interestAmount,
                fines,
                waived,
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

          /* =================================================
             INTEREST
          ================================================= */

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

          /* =================================================
             REPAYMENT SETTINGS
          ================================================= */

          /*
           * These values are authoritative SACCO settings.
           *
           * The client does not determine:
           *
           * - fine rate
           * - repayment-cycle length
           */
          const repaymentCycleDays =
            normalizeCycleDays(
              settings.repaymentCycleDays,
            );

          const fineRate =
            normalizeRate(
              settings.fineRate,
            );

          /* =================================================
             INSTALLMENT
          ================================================= */

          /*
           * installmentAmount is the amount expected during
           * EACH repayment cycle.
           *
           * Example:
           *
           * repaymentCycleDays = 7
           * installmentAmount  = KSh 5,000
           *
           * Expected weekly payment = KSh 5,000.
           *
           * This is NOT a daily fine.
           */
          const installmentAmount =
            money(
              input.installmentAmount,
            );

          if (
            !Number.isFinite(
              installmentAmount,
            ) ||
            installmentAmount <= 0
          ) {
            throw new Error(
              "Installment amount must be greater than zero.",
            );
          }

          /* =================================================
             TOTAL DUE
          ================================================= */

          /*
           * Contractual loan amount:
           *
           * principal + interest
           *
           * Fines are never included in totalDue.
           */
          const totalDue =
            money(
              principal +
                interestAmount,
            );

          if (
            installmentAmount >
            totalDue
          ) {
            throw new Error(
              "Installment amount cannot exceed the total loan amount due.",
            );
          }

          /* =================================================
             CONTRACTUAL CALENDAR DATES
          ================================================= */

          /*
           * IMPORTANT:
           *
           * Loan business dates are CalendarDate strings:
           *
           *     YYYY-MM-DD
           *
           * They must NOT be converted to JavaScript Date
           * objects before being stored.
           */

          const disbursementDate: CalendarDate =
            input.disbursementDate !==
            undefined
              ? input.disbursementDate
              : dateToKenyanCalendarDate(
                  new Date(),
                );

          assertCalendarDate(
            disbursementDate,
            "disbursement date",
          );

          /*
           * firstDueDate is the first repayment-cycle
           * boundary.
           *
           * It is calculated independently from the user's
           * selected repaymentDate.
           *
           * Example:
           *
           * disbursementDate = 2026-09-11
           * cycle            = 7 days
           *
           * firstDueDate     = 2026-09-18
           */
          const firstDueDate: CalendarDate =
            addCalendarDays(
              disbursementDate,
              repaymentCycleDays,
            );

          /*
           * If the user supplied a repaymentDate, preserve
           * that exact calendar date.
           *
           * Do NOT replace it with firstDueDate.
           */
          const repaymentDate: CalendarDate =
            input.repaymentDate !==
            undefined
              ? input.repaymentDate
              : firstDueDate;

          /*
           * If the user supplied an endDate, preserve that
           * exact calendar date.
           *
           * Otherwise the loan ends on the repayment date.
           */
          const endDate: CalendarDate =
            input.endDate !==
            undefined
              ? input.endDate
              : repaymentDate;

          /* -------------------------------------------------
             VALIDATE ALL FINAL DATES
          ------------------------------------------------- */

          assertCalendarDate(
            repaymentDate,
            "repayment date",
          );

          assertCalendarDate(
            endDate,
            "loan end date",
          );

          if (
            repaymentDate <
            disbursementDate
          ) {
            throw new Error(
              "Repayment date cannot be before disbursement date.",
            );
          }

          if (
            endDate <
            repaymentDate
          ) {
            throw new Error(
              "Loan end date cannot be before repayment date.",
            );
          }

          /* =================================================
             LOAN NUMBER
          ================================================= */

          const loanNumber =
            await generateLoanNumber(
              session,
            );

          /* =================================================
             GUARANTOR
          ================================================= */

          const guarantor =
            normalizeGuarantor(
              input.guarantor,
            );

          /* =================================================
             MEMBER NAME
          ================================================= */

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

          const now =
            new Date();

          /* =================================================
             LOAN DOCUMENT
          ================================================= */

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

            /*
             * Authoritative fine rate copied from SACCO
             * settings at loan creation.
             */
            fineRate,

            /*
             * Authoritative repayment cycle copied from
             * SACCO settings at loan creation.
             */
            repaymentCycleDays,

            /*
             * Expected payment for EACH repayment cycle.
             */
            installmentAmount,

            /*
             * IMPORTANT:
             *
             * Calendar dates are stored exactly as strings.
             *
             * Example:
             *
             *     "2026-09-11"
             *
             * There is NO Date conversion here.
             */
            disbursementDate,

            /*
             * Preserve the user's selected repayment date.
             *
             * If none was supplied, this is firstDueDate.
             */
            repaymentDate,

            /*
             * Preserve the user's selected end date.
             *
             * If none was supplied, this is repaymentDate.
             */
            endDate,

            /*
             * First repayment-cycle boundary.
             */
            firstDueDate,

            /*
             * Principal + interest only.
             *
             * Fines are never added to totalDue.
             */
            totalDue,

            /*
             * No payments at creation.
             */
            amountPaid:
              0,

            /*
             * No fines at creation.
             */
            totalFines:
              0,

            /*
             * No waivers at creation.
             */
            totalWaivedFines:
              0,

            /*
             * Initial outstanding:
             *
             * totalDue
             * + fines
             * - waived fines
             * - payments
             *
             * = totalDue
             */
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

          /* =================================================
             INSERT
          ================================================= */

          await loans.insertOne(
            loanDocument,
            {
              session,
            },
          );

          /* =================================================
             CREATION AUDIT
          ================================================= */

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

              installmentAmount,

              disbursementDate,

              repaymentDate,

              endDate,

              firstDueDate,

              totalDue,
            },
            session,
          );

          /* =================================================
             AUTHORIZATION AUDIT
          ================================================= */

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
   UPDATE LOAN
========================================================= */

/**
 * Full CRUD loan update.
 *
 * A loan can be edited regardless of whether repayments,
 * fines, waivers, or assessments already exist.
 *
 * Client-editable fields are contractual fields only.
 * Financial projections are always recalculated from the
 * authoritative ledgers and are never accepted from the client.
 */
export type UpdateLoanInput = {
  type?: LoanType;
  principal?: number;
  installmentAmount?: number;
  disbursementDate?: string;
  repaymentDate?: string;
  endDate?: string;
  guarantor?: LoanGuarantor;
};

export async function updateLoan(
  loanId: string,
  changes: UpdateLoanInput,
  updatedBy: LoanActor,
): Promise<Loan> {
  if (
    typeof loanId !== "string" ||
    !ObjectId.isValid(loanId)
  ) {
    throw new Error("Invalid loan ID.");
  }

  if (
    !changes ||
    typeof changes !== "object" ||
    Array.isArray(changes)
  ) {
    throw new Error("Loan update data is required.");
  }

  const actor = normalizeActor(updatedBy);
  const rawChanges = changes as Record<string, unknown>;

  const forbiddenFields = new Set([
    "id",
    "_id",
    "loanNumber",
    "memberId",
    "memberNumber",
    "memberName",
    "interestRate",
    "interestAmount",
    "totalDue",
    "amountDue",
    "amountPaid",
    "totalFines",
    "totalWaivedFines",
    "outstandingBalance",
    "fineRate",
    "repaymentCycleDays",
    "fineStatus",
    "repaymentStatus",
    "status",
    "createdBy",
    "authorizedBy",
    "authorizedAt",
    "createdAt",
    "updatedAt",
    "dailyFine",
    "defaultDailyFine",
    "fineSource",
  ]);

  for (const field of Object.keys(rawChanges)) {
    if (forbiddenFields.has(field)) {
      throw new Error(
        `${field} cannot be changed through loan editing.`,
      );
    }
  }

  const allowedFields = new Set([
    "type",
    "principal",
    "installmentAmount",
    "disbursementDate",
    "repaymentDate",
    "endDate",
    "guarantor",
  ]);

  for (const field of Object.keys(rawChanges)) {
    if (!allowedFields.has(field)) {
      throw new Error(
        `Loan field '${field}' cannot be changed.`,
      );
    }
  }

  if (Object.keys(rawChanges).length === 0) {
    throw new Error("No loan changes were supplied.");
  }

  const { client } = await getCollections();
  const session = client.startSession();

  try {
    return await session.withTransaction(
      async (): Promise<Loan> => {
        const {
          loans,
        } = await getCollections();

        const objectId = createObjectId(loanId);

        const current = await loans.findOne(
          { _id: objectId },
          { session },
        );

        if (!current) {
          throw new Error("Loan not found.");
        }

        /* =================================================
           TYPE
        ================================================= */

        const newType =
          changes.type !== undefined
            ? changes.type
            : current.type;

        if (
          newType !== "regular" &&
          newType !== "emergency"
        ) {
          throw new Error("Invalid loan type.");
        }

        const settings = await getLoanSettings(session);

        if (
          newType === "regular" &&
          !settings.regularLoansEnabled
        ) {
          throw new Error(
            "Regular loans are currently disabled.",
          );
        }

        if (
          newType === "emergency" &&
          !settings.emergencyLoansEnabled
        ) {
          throw new Error(
            "Emergency loans are currently disabled.",
          );
        }

        /* =================================================
           PRINCIPAL
        ================================================= */

        const newPrincipal =
          changes.principal !== undefined
            ? money(Number(changes.principal))
            : money(current.principal);

        if (
          !Number.isFinite(newPrincipal) ||
          newPrincipal <= 0
        ) {
          throw new Error(
            "Loan principal must be greater than zero.",
          );
        }

        /* =================================================
           INTEREST + TOTAL EXPECTED
        ================================================= */

        const newInterestRate =
          newType === current.type
            ? normalizeRate(current.interestRate)
            : normalizeRate(
                newType === "emergency"
                  ? settings.emergencyInterestRate
                  : settings.regularInterestRate,
              );

        const newInterestAmount = money(
          newPrincipal * newInterestRate,
        );

        const newTotalDue = money(
          newPrincipal + newInterestAmount,
        );

        /* =================================================
           INSTALLMENT
        ================================================= */

        const newInstallmentAmount =
          changes.installmentAmount !== undefined
            ? money(Number(changes.installmentAmount))
            : money(current.installmentAmount);

        if (
          !Number.isFinite(newInstallmentAmount) ||
          newInstallmentAmount <= 0
        ) {
          throw new Error(
            "Installment amount must be greater than zero.",
          );
        }

        if (newInstallmentAmount > newTotalDue) {
          throw new Error(
            "Installment amount cannot exceed the total expected loan amount.",
          );
        }

        /* =================================================
           DATES
        ================================================= */

        const newDisbursementDate =
          changes.disbursementDate !== undefined
            ? changes.disbursementDate
            : current.disbursementDate;

        const newRepaymentDate =
          changes.repaymentDate !== undefined
            ? changes.repaymentDate
            : current.repaymentDate;

        const newEndDate =
          changes.endDate !== undefined
            ? changes.endDate
            : current.endDate;

        assertCalendarDate(
          newDisbursementDate,
          "disbursement date",
        );

        assertCalendarDate(
          newRepaymentDate,
          "repayment date",
        );

        assertCalendarDate(
          newEndDate,
          "loan end date",
        );

        if (newRepaymentDate < newDisbursementDate) {
          throw new Error(
            "Repayment date cannot be before disbursement date.",
          );
        }

        if (newEndDate < newRepaymentDate) {
          throw new Error(
            "Loan end date cannot be before repayment date.",
          );
        }

        const repaymentCycleDays = normalizeCycleDays(
          current.repaymentCycleDays,
        );

        const newFirstDueDate = addCalendarDays(
          newDisbursementDate,
          repaymentCycleDays,
        );

        /* =================================================
           GUARANTOR
        ================================================= */

        const newGuarantor =
          changes.guarantor !== undefined
            ? normalizeGuarantor(changes.guarantor)
            : current.guarantor;

        /* =================================================
           AUTHORITATIVE LEDGER TOTALS
        ================================================= */

        const amountPaid = await getLoanPaidTotal(
          objectId,
          session,
        );

        const totalFines = await getLoanFineTotal(
          objectId,
          session,
        );

        const totalWaivedFines = Math.min(
          totalFines,
          await getLoanWaivedFineTotal(
            objectId,
            session,
          ),
        );

        const outstandingBalance =
          calculateFinalOutstanding(
            newPrincipal,
            newInterestAmount,
            totalFines,
            totalWaivedFines,
            amountPaid,
          );

        /* =================================================
           STATUS PROJECTION
        ================================================= */

        const newStatus: Loan["status"] =
          current.status === "cancelled"
            ? "cancelled"
            : outstandingBalance <= 0
              ? "completed"
              : "active";

        const newRepaymentStatus:
          Loan["repaymentStatus"] =
          outstandingBalance <= 0
            ? "completed"
            : current.repaymentStatus === "defaulted"
              ? "defaulted"
              : "current";

        const before = {
          type: current.type,
          principal: current.principal,
          installmentAmount: current.installmentAmount,
          interestRate: current.interestRate,
          interestAmount: current.interestAmount,
          disbursementDate: current.disbursementDate,
          repaymentDate: current.repaymentDate,
          endDate: current.endDate,
          firstDueDate: current.firstDueDate,
          totalDue: current.totalDue,
          amountPaid: current.amountPaid,
          totalFines: current.totalFines,
          totalWaivedFines: current.totalWaivedFines,
          outstandingBalance: current.outstandingBalance,
          status: current.status,
          repaymentStatus: current.repaymentStatus,
          guarantor: current.guarantor,
        };

        const after = {
          type: newType,
          principal: newPrincipal,
          installmentAmount: newInstallmentAmount,
          interestRate: newInterestRate,
          interestAmount: newInterestAmount,
          disbursementDate: newDisbursementDate,
          repaymentDate: newRepaymentDate,
          endDate: newEndDate,
          firstDueDate: newFirstDueDate,
          totalDue: newTotalDue,
          amountPaid,
          totalFines,
          totalWaivedFines,
          outstandingBalance,
          status: newStatus,
          repaymentStatus: newRepaymentStatus,
          guarantor: newGuarantor,
        };

        const now = new Date();

        const updateResult = await loans.updateOne(
          {
            _id: objectId,
            updatedAt: current.updatedAt,
          },
          {
            $set: {
              type: newType,
              principal: newPrincipal,
              installmentAmount: newInstallmentAmount,
              interestRate: newInterestRate,
              interestAmount: newInterestAmount,
              disbursementDate: newDisbursementDate,
              repaymentDate: newRepaymentDate,
              endDate: newEndDate,
              firstDueDate: newFirstDueDate,
              totalDue: newTotalDue,
              amountPaid,
              totalFines,
              totalWaivedFines,
              outstandingBalance,
              status: newStatus,
              repaymentStatus: newRepaymentStatus,
              guarantor: newGuarantor,
              updatedAt: now,
            },
          },
          { session },
        );

        if (updateResult.matchedCount !== 1) {
          throw new Error(
            "Loan was modified or removed before the update could be applied. Please retry.",
          );
        }

        await writeAudit(
          objectId,
          current.loanNumber,
          "updated",
          actor,
          {
            action: "loan_updated",
            before,
            after,
          },
          session,
        );

        const updated = await loans.findOne(
          { _id: objectId },
          { session },
        );

        if (!updated) {
          throw new Error(
            "Updated loan could not be retrieved.",
          );
        }

        return toLoan(updated);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 10_000,
      },
    );
  } finally {
    await session.endSession();
  }
}


/**
 * =========================================================
 * ACCRUE ALL ELIGIBLE LOAN FINES
 * =========================================================
 *
 * Finds active loans that have reached at least their first
 * repayment cycle and passes them to the existing
 * accrueLoanFines() engine.
 *
 * This function does NOT calculate fines itself.
 *
 * accrueLoanFines() remains the authoritative financial
 * calculation and persistence engine.
 */
export async function accrueAllLoanFines(): Promise<number> {
  const {
    loans,
  } = await getCollections();

  const now =
    new Date();

  /*
   * Only select loans that are potentially ready for
   * repayment-cycle assessment.
   *
   * The actual eligibility decision remains inside
   * accrueLoanFines().
   */
  const candidates =
    await loans
      .find(
        {
          status:
            "active",

          fineStatus:
            "active",

          firstDueDate:
            {
              $lte:
                dateToKenyanCalendarDate(now),
            },
        },
        {
          projection:
            {
              _id: 1,
            },
        },
      )
      .toArray();

  let created =
    0;

  /*
   * Process each loan independently.
   *
   * If one loan fails, the remaining loans still get
   * processed.
   */
  for (
    const loan of candidates
  ) {
    if (!loan._id) {
      continue;
    }

    try {
      created +=
        await accrueLoanFines(
          loan._id.toString(),
          now,
        );
    } catch (error) {
      console.error(
        `Failed to accrue fines for loan ${loan._id.toString()}:`,
        error,
      );
    }
  }

  return created;
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
        dateToKenyanCalendarDate(date);
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
        dateToKenyanCalendarDate(date);
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
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
};

function getAssessmentPeriod(
  loan: LoanDocument,
  periodNumber: number,
): AssessmentPeriod {
  if (
    !Number.isInteger(periodNumber) ||
    periodNumber <= 0
  ) {
    throw new Error(
      "Assessment period must be a positive whole number.",
    );
  }

  const cycleDays = normalizeCycleDays(
    loan.repaymentCycleDays,
  );

  assertCalendarDate(
    loan.disbursementDate,
    "loan disbursement date",
  );

  const periodStart = addCalendarDays(
    loan.disbursementDate,
    (periodNumber - 1) * cycleDays,
  );

  const periodEnd = addCalendarDays(
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
  const cycleDays = normalizeCycleDays(
    loan.repaymentCycleDays,
  );

  const asOfCalendarDate = dateToKenyanCalendarDate(
    asOfDate,
  );

  const elapsedDays = differenceInCalendarDays(
    loan.disbursementDate,
    asOfCalendarDate,
  );

  if (elapsedDays < cycleDays) {
    return 0;
  }

  return Math.floor(elapsedDays / cycleDays);
}

async function getPeriodPaymentTotal(
  loanId: ObjectId,
  period: AssessmentPeriod,
  session?: ClientSession,
): Promise<number> {
  const { repayments } =
    await getCollections();

  const dateMatch =
    period.periodNumber === 1
      ? {
          transactionDate: {
            $gte:
              period.periodStart,
            $lte:
              period.periodEnd,
          },
        }
      : {
          transactionDate: {
            $gt:
              period.periodStart,
            $lte:
              period.periodEnd,
          },
        };

  const result = await repayments
    .aggregate<{
      _id: null;
      total: number;
    }>(
      [
        {
          $match: {
            loanId,
            ...dateMatch,
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
      ],
      { session },
    )
    .toArray();

  return money(
    Number(
      result[0]?.total || 0,
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
  } = await getCollections();

  const loan =
    await loans.findOne(
      {
        _id: loanId,
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
    loan.status === "cancelled" ||
    loan.status === "completed"
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
    dateToKenyanCalendarDate(assessmentDate) <
    period.periodEnd
  ) {
    throw new Error(
      "A repayment cycle cannot be assessed before the cycle ends.",
    );
  }

  /*
   * =========================================================
   * OPENING CORE BALANCE
   * =========================================================
   *
   * This is the loan balance before this repayment cycle.
   *
   * Existing fines are deliberately excluded.
   */
  const amountPaidBeforePeriod =
    await getLoanPaidTotalAsOf(
      loanId,
      period.periodStart,
      session,
    );

  const openingCoreBalance =
    calculateCoreOutstanding(
      loan.principal,
      loan.interestAmount,
      amountPaidBeforePeriod,
    );

  /*
   * =========================================================
   * PERIOD PAYMENTS
   * =========================================================
   *
   * Only repayments belonging to this repayment cycle
   * are used to determine whether the member met the
   * weekly installment.
   */
  const paymentsDuringPeriod =
    await getPeriodPaymentTotal(
      loanId,
      period,
      session,
    );

  /*
   * =========================================================
   * EXPECTED INSTALLMENT
   * =========================================================
   *
   * Never expect more than the remaining core balance.
   *
   * Example:
   *
   * Remaining loan = 3,000
   * Weekly installment = 5,000
   *
   * Expected installment = 3,000
   *
   * There should be no 5,000 obligation when only
   * 3,000 remains on the core loan.
   */
  const expectedInstallment =
    calculateLoanAmountDue(
      loan.installmentAmount,
      loan.principal,
      loan.interestAmount,
      amountPaidBeforePeriod,
    );

  /*
   * =========================================================
   * UNPAID WEEKLY INSTALLMENT
   * =========================================================
   *
   * The fine applies ONLY to the unpaid portion of the
   * expected installment for this repayment cycle.
   *
   * It does NOT apply to the entire loan balance.
   */
  const unpaidInstallment =
    calculateUnpaidInstallment(
      expectedInstallment,
      paymentsDuringPeriod,
    );

  /*
   * =========================================================
   * END-OF-PERIOD CORE BALANCE
   * =========================================================
   *
   * Kept for reporting/reconciliation.
   *
   * This is NOT the fine base anymore.
   */
  const amountPaidAsOfPeriodEnd =
    await getLoanPaidTotalAsOf(
      loanId,
      period.periodEnd,
      session,
    );

  const balanceBeforeFine =
    calculateCoreOutstanding(
      loan.principal,
      loan.interestAmount,
      amountPaidAsOfPeriodEnd,
    );

  const paymentMade =
    paymentsDuringPeriod > 0;

  /*
   * =========================================================
   * WEEKLY DEFAULT
   * =========================================================
   *
   * A cycle is defaulted only when the member failed to
   * meet the contractual installment for that cycle.
   *
   * Example:
   *
   * Expected = 5,000
   * Paid     = 3,000
   * Unpaid   = 2,000
   *
   * defaulted = true
   */
  const defaulted =
    unpaidInstallment > 0;

  const fineRate =
    normalizeRate(
      loan.fineRate,
    );

  /*
   * =========================================================
   * FINE CALCULATION
   * =========================================================
   *
   * IMPORTANT:
   *
   * Fine = unpaid installment × fine rate
   *
   * NOT:
   *
   * Fine = entire loan outstanding × fine rate
   */
  const calculatedFine =
    defaulted
      ? money(
          unpaidInstallment *
            fineRate,
        )
      : 0;

  let actualFineAmount =
    0;

  /*
   * Only active fine status permits a new fine.
   */
  if (
    loan.fineStatus === "active" &&
    calculatedFine > 0
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

      /*
       * NEW WEEKLY-INSTALLMENT FIELDS
       */
      expectedInstallment,

      
        paymentsDuringPeriod,

      installmentShortfall:
  unpaidInstallment,

      /*
       * Retained for compatibility.
       *
       * This now represents the unpaid installment
       * that the fine was actually assessed against.
       */
      assessedCoreBalance:
        unpaidInstallment,

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

          expectedInstallment,

          amountPaidDuringPeriod:
            paymentsDuringPeriod,

          unpaidInstallment,

          assessedCoreBalance:
            unpaidInstallment,
        },
        session,
      );
    } catch (error) {
      /*
       * Another concurrent transaction may have created
       * the fine for this repayment cycle.
       *
       * The unique index on:
       * { loanId, periodNumber }
       * protects against duplicate fines.
       */
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

  /*
   * =========================================================
   * STORE ASSESSMENT
   * =========================================================
   */
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

    assessmentDate:
      dateToKenyanCalendarDate(assessmentDate),

    openingCoreBalance,

    expectedInstallment,

    paymentsDuringPeriod,

    installmentShortfall:
  unpaidInstallment,

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
    /*
     * Handle concurrent assessment creation.
     */
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

  /*
   * =========================================================
   * AUDIT ASSESSMENT
   * =========================================================
   */
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

      expectedInstallment,

      paymentsDuringPeriod,

      unpaidInstallment,

      balanceBeforeFine,

      paymentMade,

      defaulted,

      fineRate,

      fineAmount:
        actualFineAmount,
    },
    session,
  );

  /*
   * Record a separate default audit event.
   */
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

        expectedInstallment,

        paymentsDuringPeriod,

        unpaidInstallment,

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
  } = await getCollections();

  const session =
    client.startSession();

  try {
    const createdCount =
      await session.withTransaction(
        async (): Promise<number> => {
          const {
            loans,
          } = await getCollections();

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
            loan.status === "cancelled" ||
            loan.status === "completed"
          ) {
            return 0;
          }

          if (
            loan.fineStatus ===
            "stopped"
          ) {
            return 0;
          }

          /*
           * Determine how many complete repayment
           * cycles have elapsed.
           */
          const latestPeriod =
            getLatestDueAssessmentPeriod(
              loan,
              asOfDate,
            );

          if (
            latestPeriod <= 0
          ) {
            return 0;
          }

          let created = 0;

          /*
           * Assess every completed repayment cycle
           * that has not already been assessed.
           *
           * Example:
           * 7 days  -> period 1
           * 14 days -> period 2
           * 21 days -> period 3
           */
          for (
            let periodNumber = 1;
            periodNumber <=
            latestPeriod;
            periodNumber++
          ) {
            const {
              assessments,
            } = await getCollections();

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

            /*
             * Confirm that the assessment now exists.
             */
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

          /*
           * Determine whether the loan has ever
           * defaulted on a completed repayment cycle.
           */
          const {
            assessments,
          } = await getCollections();

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

          /*
           * Read authoritative financial totals
           * from the append-only ledgers.
           */
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

          /*
           * Final outstanding:
           *
           * core balance
           * + fines
           * - effective waivers
           * - payments
           *
           * Existing fines never compound.
           */
          const outstanding =
            calculateFinalOutstanding(
              loan.principal,
              loan.interestAmount,
              fines,
              waived,
              paid,
            );

          let repaymentStatus:
            Loan["repaymentStatus"] =
            "current";

          if (
            outstanding <= 0
          ) {
            repaymentStatus =
              "completed";
          } else if (
            defaultAssessment ||
            dateToKenyanCalendarDate(asOfDate) >=
              loan.endDate
          ) {
            repaymentStatus =
              "defaulted";
          }

          /*
           * Update the loan status projection.
           */
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

          /*
           * Reconcile the loan projections from
           * the authoritative ledgers.
           */
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
            dateToKenyanCalendarDate(transactionDate) <=
              loan.disbursementDate
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
              loan.principal,
              loan.interestAmount,
              totalFinesBefore,
              totalWaivedFinesBefore,
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

            transactionDate: 
              dateToKenyanCalendarDate(
                transactionDate,
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
              loan.principal,
              loan.interestAmount,
              totalFinesBefore,
              totalWaivedFinesBefore,
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

/* =========================================================
   CREATE LOAN WAIVER
========================================================= */

export async function createLoanWaiver(
  input: CreateLoanWaiverInput,
): Promise<LoanWaiver> {
  /* =======================================================
     INPUT VALIDATION
  ======================================================= */

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

  /* =======================================================
     NORMALIZE IMMUTABLE IDEMPOTENCY REFERENCE
     
     The reference belongs to the financial event.
     
     It must remain exactly the same when the client
     retries the same waiver request.
  ======================================================= */

  const reference =
    normalizeText(
      input.waiverReference,
    );

  if (!reference) {
    throw new Error(
      "Waiver reference is required.",
    );
  }

  /* =======================================================
     NORMALIZE REQUEST VALUES
  ======================================================= */

  const amount =
    money(
      input.amount,
    );

  const loanId =
    createObjectId(
      input.loanId,
    );

  const reason =
    normalizeText(
      input.reason,
    );

  if (!reason) {
    throw new Error(
      "A waiver reason is required.",
    );
  }

  /* =======================================================
     GET COLLECTIONS
  ======================================================= */

  const {
    client,
    waivers,
  } =
    await getCollections();

  /* =======================================================
     FIRST IDEMPOTENCY CHECK
     
     Handles normal retries where the original request
     already committed successfully.
  ======================================================= */

  const existing =
    await waivers.findOne({
      waiverReference:
        reference,
    });

  if (existing) {
    /* -----------------------------------------------------
       SAME REFERENCE + DIFFERENT AMOUNT
       ----------------------------------------------------- */

    if (
      money(
        existing.amount,
      ) !== amount
    ) {
      throw new Error(
        "Waiver reference already exists for a different amount.",
      );
    }

    /* -----------------------------------------------------
       SAME REFERENCE + DIFFERENT LOAN
       ----------------------------------------------------- */

    if (
      existing.loanId.toString() !==
      loanId.toString()
    ) {
      throw new Error(
        "Waiver reference already exists for a different loan.",
      );
    }

    /* -----------------------------------------------------
       SAME REFERENCE + DIFFERENT REASON
       
       A reference represents one immutable financial
       event. Reusing it for a different reason is unsafe.
    ----------------------------------------------------- */

    if (
      normalizeText(
        existing.reason,
      ) !== reason
    ) {
      throw new Error(
        "Waiver reference already exists for a different reason.",
      );
    }

    return toWaiver(
      existing,
    );
  }

  /* =======================================================
     DATABASE TRANSACTION
  ======================================================= */

  const session =
    client.startSession();

  try {
    const transactionResult =
      await session.withTransaction(
        async (): Promise<LoanWaiver> => {
          const {
            loans,
            waivers,
          } =
            await getCollections();

          /* =================================================
             SECOND IDEMPOTENCY CHECK
             
             Protects against concurrent requests using the
             same waiver reference.
          ================================================= */

          const alreadyExists =
            await waivers.findOne(
              {
                waiverReference:
                  reference,
              },
              {
                session,
              },
            );

          if (alreadyExists) {
            /* -----------------------------------------------
               VERIFY AMOUNT
            ----------------------------------------------- */

            if (
              money(
                alreadyExists.amount,
              ) !== amount
            ) {
              throw new Error(
                "Waiver reference already exists for a different amount.",
              );
            }

            /* -----------------------------------------------
               VERIFY LOAN
            ----------------------------------------------- */

            if (
              alreadyExists.loanId.toString() !==
              loanId.toString()
            ) {
              throw new Error(
                "Waiver reference already exists for a different loan.",
              );
            }

            /* -----------------------------------------------
               VERIFY REASON
            ----------------------------------------------- */

            if (
              normalizeText(
                alreadyExists.reason,
              ) !== reason
            ) {
              throw new Error(
                "Waiver reference already exists for a different reason.",
              );
            }

            return toWaiver(
              alreadyExists,
            );
          }

          /* =================================================
             LOAD LOAN
          ================================================= */

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

          /* =================================================
             LOAN STATUS
          ================================================= */

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

          /* =================================================
             CURRENT FINE LEDGER
          ================================================= */

          const totalFines =
            await getLoanFineTotal(
              loanId,
              session,
            );

          /* =================================================
             CURRENT WAIVER LEDGER
          ================================================= */

          const totalWaived =
            await getLoanWaivedFineTotal(
              loanId,
              session,
            );

          /* =================================================
             AVAILABLE FINE BALANCE
             
             Waivers can only consume fines that have not
             already been waived.
          ================================================= */

          const available =
            money(
              Math.max(
                0,
                totalFines -
                  totalWaived,
              ),
            );

          if (
            available <=
            0
          ) {
            throw new Error(
              "There are no active fines available for waiver.",
            );
          }

          /* =================================================
             OVER-WAIVER PROTECTION
          ================================================= */

          if (
            amount >
            available
          ) {
            throw new Error(
              `Waiver cannot exceed the available fine balance of KSh ${available.toLocaleString()}.`,
            );
          }

          /* =================================================
             ACTOR
          ================================================= */

          const actor =
            normalizeActor(
              input.waivedBy,
            );

          /* =================================================
             TIMESTAMP
          ================================================= */

          const now =
            new Date();

          /* =================================================
             IMMUTABLE WAIVER DOCUMENT
          ================================================= */

          const waiverDocument:
            LoanWaiverDocument = {
            _id:
              new ObjectId(),

            loanId,

            loanNumber:
              loan.loanNumber,

            memberId:
              loan.memberId,

            waiverReference:
              reference,

            amount,

            reason,

            waivedBy:
              actor,

            createdAt:
              now,
          };

          /* =================================================
             INSERT IMMUTABLE WAIVER
             
             The unique waiverReference index provides the
             final database-level concurrency guarantee.
          ================================================= */

          try {
            await waivers.insertOne(
              waiverDocument,
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
                "WAIVER_IDEMPOTENCY_RACE",
              );
            }

            throw error;
          }

          /* =================================================
             NEW WAIVED TOTAL
          ================================================= */

          const newTotalWaived =
            money(
              totalWaived +
                amount,
            );

          /* =================================================
             CURRENT PAID TOTAL
          ================================================= */

          const amountPaid =
            await getLoanPaidTotal(
              loanId,
              session,
            );

          /* =================================================
             NEW OUTSTANDING BALANCE
          ================================================= */

          const outstanding =
            calculateFinalOutstanding(
              loan.principal,
              loan.interestAmount,
              totalFines,
              newTotalWaived,
              amountPaid,
            );

          /* =================================================
             UPDATE LOAN PROJECTION
             
             Optimistic concurrency protection prevents this
             waiver from silently overwriting another financial
             mutation.
          ================================================= */

          const updateResult =
            await loans.updateOne(
              {
                _id:
                  loanId,

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

          /* =================================================
             AUDIT
          ================================================= */

          await writeAudit(
            loanId,
            loan.loanNumber,
            "waiver_recorded",
            actor,
            {
              waiverId:
                waiverDocument._id!.toString(),

              waiverReference:
                reference,

              amount,

              reason,

              availableBefore:
                available,

              availableAfter:
                money(
                  available -
                    amount,
                ),

              outstandingBefore:
                loan.outstandingBalance,

              outstandingAfter:
                outstanding,

              totalFines,

              totalWaivedFinesBefore:
                totalWaived,

              totalWaivedFinesAfter:
                newTotalWaived,
            },
            session,
          );

          /* =================================================
             RETURN CREATED WAIVER
          ================================================= */

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

    return transactionResult;
  } catch (error) {
    /* =====================================================
       IDEMPOTENCY RACE RECOVERY
       
       Two requests can pass the first check simultaneously.
       
       MongoDB's unique waiverReference index allows only one
       to commit the waiver. The losing request comes here,
       retrieves the committed waiver, validates that it is
       the same financial event, and safely returns it.
    ===================================================== */

    if (
      error instanceof Error &&
      error.message ===
        "WAIVER_IDEMPOTENCY_RACE"
    ) {
      const existing =
        await waivers.findOne({
          waiverReference:
            reference,
        });

      if (!existing) {
        throw new Error(
          "Waiver idempotency race occurred but the existing waiver could not be retrieved.",
        );
      }

      /* -----------------------------------------------------
         VERIFY AMOUNT
      ----------------------------------------------------- */

      if (
        money(
          existing.amount,
        ) !== amount
      ) {
        throw new Error(
          "Waiver reference already exists for a different amount.",
        );
      }

      /* -----------------------------------------------------
         VERIFY LOAN
      ----------------------------------------------------- */

      if (
        existing.loanId.toString() !==
        loanId.toString()
      ) {
        throw new Error(
          "Waiver reference already exists for a different loan.",
        );
      }

      /* -----------------------------------------------------
         VERIFY REASON
      ----------------------------------------------------- */

      if (
        normalizeText(
          existing.reason,
        ) !== reason
      ) {
        throw new Error(
          "Waiver reference already exists for a different reason.",
        );
      }

      return toWaiver(
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
   Delete LOAN
========================================================= */

export async function deleteLoan(
  loanId: string,
): Promise<void> {
  if (!ObjectId.isValid(loanId)) {
    throw new Error("Invalid loan ID.");
  }

  const {
    client,
  } = await getCollections();

  const session =
    client.startSession();

  try {
    await session.withTransaction(
      async () => {
        const {
          loans,
          repayments,
          fines,
          waivers,
          assessments,
          audit,
        } = await getCollections();

        const objectId =
          createObjectId(
            loanId,
          );

        /* ---------------------------------------------------
           VERIFY LOAN EXISTS
        --------------------------------------------------- */

        const loan =
          await loans.findOne(
            {
              _id: objectId,
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

        /* ---------------------------------------------------
           DELETE ASSOCIATED FINANCIAL RECORDS
        --------------------------------------------------- */

        await repayments.deleteMany(
          {
            loanId: objectId,
          },
          {
            session,
          },
        );

        await fines.deleteMany(
          {
            loanId: objectId,
          },
          {
            session,
          },
        );

        await waivers.deleteMany(
          {
            loanId: objectId,
          },
          {
            session,
          },
        );

        await assessments.deleteMany(
          {
            loanId: objectId,
          },
          {
            session,
          },
        );

        await audit.deleteMany(
          {
            loanId: objectId,
          },
          {
            session,
          },
        );

        /* ---------------------------------------------------
           DELETE LOAN
        --------------------------------------------------- */

        const result =
          await loans.deleteOne(
            {
              _id: objectId,
            },
            {
              session,
            },
          );

        if (
          result.deletedCount !== 1
        ) {
          throw new Error(
            "Failed to delete loan.",
          );
        }
      },
      {
        readConcern: {
          level: "snapshot",
        },

        writeConcern: {
          w: "majority",
        },

        maxCommitTimeMS: 10_000,
      },
    );
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