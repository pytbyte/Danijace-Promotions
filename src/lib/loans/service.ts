/**
 * GEO-SHUA
 * Loan Domain Service
 *
 * Loan lifecycle: full CRUD.
 *
 * CORE LOAN MODEL
 * ---------------------------------------------------------------
 * principal            = total amount disbursed.
 * interestAmount       = princi
 * pal × applicable interest rate.
 * totalDue             = principal + interestAmount.
 * installmentAmount    = contractual amount expected each cycle.
 * amountDue            = amount expected for one specific cycle,
 *                        never greater than the remaining core balance.
 * amountPaid           = sum of recorded repayments.
 * totalFines           = sum of cycle-based fines.
 * outstandingBalance   = principal + interest + effective fines - amountPaid.
 *
 * COMPLETED INSTALLMENT BALANCE
 * ---------------------------------------------------------------
 * completedInstallmentBalance is a response-only derived value.
 *
 * It represents the total unpaid installment shortfalls from
 * completed repayment cycles.
 *
 * Source of truth:
 *
 *   loanAssessments.installmentShortfall
 *
 * It does NOT represent the current/open repayment cycle.
 * It does NOT include fines.
 * It is NOT stored on the loan master document.
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

import {
  queueLoanDisbursementSms,
} from "@/lib/sms/outbox/notifications";


import {
  queueLoanClearedSms,
  queueLoanPaymentReceivedSms,
  queueLoanPaymentReminderSms,
} from "@/lib/sms/outbox/notifications";

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

export type LoanDocument = Omit<
  Loan,
  | "id"
  | "memberId"
  | "completedInstallmentBalance"
> & {
  _id: ObjectId;
  memberId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
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
  repaymentDate?: string;
  endDate?: string;
};

export type PaginatedLoans = {
  loans: Loan[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type LoanPaymentReminderPeriod = {
  periodNumber: number;
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
  installment: number;
  balance: number;
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
  client: Awaited<typeof clientPromise>;
  db: Db;

  loans: Collection<LoanDocument>;

  members: Collection<{
    _id: ObjectId;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    phone?: string;
    membershipNumber?: string;
    status?: string;
  }>;

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

    members:
      db.collection<{
        _id: ObjectId;
        firstName?: string;
        middleName?: string;
        lastName?: string;
        phone?: string;
        membershipNumber?: string;
        status?: string;
      }>(
        MEMBERS_COLLECTION,
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

export type ExistingLoanGuarantee = {
  loanId: string;
  loanNumber: string;
  borrowerName: string;
  principal: number;
  status: LoanStatus;
};

/* =========================================================
   GUARANTOR COMMITMENT CHECK
========================================================= */

/**
 * Returns loans on which a member is currently recorded
 * as a guarantor.
 *
 * Existing guarantor records are matched using:
 *
 * 1. normalized Kenyan phone number
 * 2. exact normalized full name
 *
 * Active and pending loans represent current commitments.
 * Completed and cancelled loans are historical.
 *
 * This function is READ-ONLY.
 */
export async function getExistingGuarantorCommitments(
  memberId: string,
): Promise<ExistingLoanGuarantee[]> {
  if (
    typeof memberId !== "string" ||
    !ObjectId.isValid(memberId)
  ) {
    throw new Error(
      "Invalid member ID.",
    );
  }

  const { db } =
    await getCollections();

  const member =
    await db
      .collection<{
        _id: ObjectId;
        firstName?: string;
        middleName?: string;
        lastName?: string;
        phone?: string;
        status?: string;
      }>(
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
          projection: {
            _id: 1,
            firstName: 1,
            middleName: 1,
            lastName: 1,
            phone: 1,
            status: 1,
          },
        },
      );

  if (!member) {
    throw new Error(
      "Member not found.",
    );
  }

  const normalizeName = (
    value: unknown,
  ): string => {
    if (
      typeof value !== "string"
    ) {
      return "";
    }

    return value
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  };

  const normalizePhone = (
    value: unknown,
  ): string => {
    if (
      typeof value !== "string"
    ) {
      return "";
    }

    const digits =
      value.replace(
        /\D/g,
        "",
      );

    if (
      digits.startsWith("254") &&
      digits.length === 12
    ) {
      return digits;
    }

    if (
      digits.startsWith("0") &&
      digits.length === 10
    ) {
      return `254${digits.slice(1)}`;
    }

    if (
      digits.length === 9 &&
      (
        digits.startsWith("7") ||
        digits.startsWith("1")
      )
    ) {
      return `254${digits}`;
    }

    return digits;
  };

  const memberName =
    normalizeName(
      [
        member.firstName,
        member.middleName,
        member.lastName,
      ]
        .filter(
          (value) =>
            typeof value ===
              "string" &&
            value.trim() !== "",
        )
        .join(" "),
    );

  const memberPhone =
    normalizePhone(
      member.phone,
    );

  const loans =
    await db
      .collection<LoanDocument>(
        LOANS_COLLECTION,
      )
      .find(
        {
          status: {
            $in: [
              "pending",
              "active",
            ],
          },

          guarantor: {
            $exists: true,
          },
        },
        {
          projection: {
            _id: 1,
            loanNumber: 1,
            memberName: 1,
            principal: 1,
            status: 1,
            guarantor: 1,
          },
        },
      )
      .toArray();

  const matches =
    loans.filter(
      (loan) => {
        const guarantor =
          loan.guarantor;

        if (!guarantor) {
          return false;
        }

        const guarantorPhone =
          normalizePhone(
            guarantor.phone,
          );

        if (
          memberPhone &&
          guarantorPhone &&
          memberPhone ===
            guarantorPhone
        ) {
          return true;
        }

        const guarantorName =
          normalizeName(
            guarantor.name,
          );

        return (
          !!memberName &&
          !!guarantorName &&
          memberName ===
            guarantorName
        );
      },
    );

  return matches.map(
    (loan) => ({
      loanId:
        loan._id.toString(),

      loanNumber:
        loan.loanNumber,

      borrowerName:
        loan.memberName,

      principal:
        loan.principal,

      status:
        loan.status,
    }),
  );
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
    !Number.isNaN(
      value.getTime(),
    )
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

  const year =
    Number(
      value.slice(0, 4),
    );

  const month =
    Number(
      value.slice(5, 7),
    );

  const day =
    Number(
      value.slice(8, 10),
    );

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
    (
      year % 100 !== 0 ||
      year % 400 === 0
    );

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

/* =========================================================
   CIVIL DATE ARITHMETIC
========================================================= */

function daysFromCivil(
  year: number,
  month: number,
  day: number,
): number {
  year -=
    month <= 2
      ? 1
      : 0;

  const era =
    Math.floor(
      year / 400,
    );

  const yearOfEra =
    year -
    era * 400;

  const monthPrime =
    month +
    (
      month > 2
        ? -3
        : 9
    );

  const dayOfYear =
    Math.floor(
      (
        153 *
          monthPrime +
        2
      ) / 5,
    ) +
    day -
    1;

  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(
      yearOfEra / 4,
    ) -
    Math.floor(
      yearOfEra / 100,
    ) +
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
        Math.floor(
          dayOfEra / 1460,
        ) +
        Math.floor(
          dayOfEra / 36524,
        ) -
        Math.floor(
          dayOfEra / 146096,
        )
      ) / 365,
    );

  let year =
    yearOfEra +
    era * 400;

  const dayOfYear =
    dayOfEra -
    (
      365 * yearOfEra +
      Math.floor(
        yearOfEra / 4,
      ) -
      Math.floor(
        yearOfEra / 100,
      )
    );

  const monthPrime =
    Math.floor(
      (
        5 * dayOfYear +
        2
      ) / 153,
    );

  const day =
    dayOfYear -
    Math.floor(
      (
        153 *
          monthPrime +
        2
      ) / 5,
    ) +
    1;

  const month =
    monthPrime +
    (
      monthPrime < 10
        ? 3
        : -9
    );

  year +=
    month <= 2
      ? 1
      : 0;

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

  if (
    !Number.isInteger(days)
  ) {
    throw new Error(
      "Calendar day offset must be a whole number.",
    );
  }

  const year =
    Number(
      value.slice(0, 4),
    );

  const month =
    Number(
      value.slice(5, 7),
    );

  const day =
    Number(
      value.slice(8, 10),
    );

  const result =
    civilFromDays(
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

  return (
    `${String(result.year).padStart(4, "0")}-` +
    `${String(result.month).padStart(2, "0")}-` +
    `${String(result.day).padStart(2, "0")}`
  );
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
        timeZone:
          "Africa/Nairobi",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
      },
    ).formatToParts(date);

  const values:
    Record<string, string> = {};

  for (const part of parts) {
    if (
      part.type !==
      "literal"
    ) {
      values[part.type] =
        part.value;
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

/**
 * Converts a YYYY-MM-DD Kenyan calendar date into the UTC
 * timestamp representing the START of that calendar day in
 * Africa/Nairobi.
 *
 * Used only when comparing a CalendarDate against MongoDB
 * timestamps.
 *
 * Loan business dates themselves remain strings.
 */
function calendarDateToKenyanStartDate(
  value: CalendarDate,
): Date {
  assertCalendarDate(
    value,
    "calendar date",
  );

  const year =
    Number(value.slice(0, 4));

  const month =
    Number(value.slice(5, 7));

  const day =
    Number(value.slice(8, 10));

  /*
   * Nairobi is UTC+3 and does not observe DST.
   *
   * Midnight Nairobi =
   * previous day 21:00 UTC.
   */
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      -3,
      0,
      0,
      0,
    ),
  );
}

/* =========================================================
   SEARCH / NORMALIZATION
========================================================= */

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

    // Response-only derived value.
    // The actual value is attached by getLoanById(),
    // getLoanByNumber(), and getLoans().
    completedInstallmentBalance: 0,
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

  const sanitizedChanges = {
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

  phone?: string;

  hasExistingLoan: boolean;

  existingLoanStatus:
    LoanStatus | null;

  existingLoanNumber:
    string | null;
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
  const { db } =
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
            phone: 1,
          },
        },
      );

  if (!member) {
    return null;
  }

  const existingLoan =
    await db
      .collection<LoanDocument>(
        LOANS_COLLECTION,
      )
      .findOne(
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

          projection: {
            _id: 1,
            loanNumber: 1,
            status: 1,
          },
        },
      );

  if (existingLoan) {
    return null;
  }

  return member;
}

async function getSavingsBalance(
  memberId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  const { db } =
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
  const { repayments } =
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

/**
 * Returns repayments recorded on or before the supplied
 * Kenyan calendar date.
 *
 * transactionDate is stored as a real MongoDB Date, therefore
 * the CalendarDate is converted only for timestamp comparison.
 */
async function getLoanPaidTotalAsOf(
  loanId: ObjectId,
  asOfDate: CalendarDate,
  session?: ClientSession,
): Promise<number> {
  assertCalendarDate(
    asOfDate,
    "repayment cutoff date",
  );

  const {
    repayments,
  } =
    await getCollections();

  const cutoffStart =
    calendarDateToKenyanStartDate(
      asOfDate,
    );

  const cutoffEnd =
    new Date(
      cutoffStart.getTime() +
        24 * 60 * 60 * 1000 -
        1,
    );

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
                  cutoffEnd,
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
      result[0]?.total ??
        0,
    ),
  );
}

async function getLoanFineTotal(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  const { fines } =
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
  const { waivers } =
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
      money(
        principal +
          interestAmount,
      ) -
        amountPaid,
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
  const effectiveFines =
    money(
      Math.max(
        0,
        totalFines -
          Math.min(
            totalFines,
            totalWaivedFines,
          ),
      ),
    );

  return money(
    Math.max(
      0,
      money(
        principal +
          interestAmount,
      ) +
        effectiveFines -
        amountPaid,
    ),
  );
}

/**
 * Amount due for one specific repayment cycle.
 *
 * The contractual installment is the target. The final cycle
 * may require less when the remaining core balance is smaller.
 */
export function calculateLoanAmountDue(
  installmentAmount: number,
  principal: number,
  interestAmount: number,
  amountPaid: number,
): number {
  const remainingCore =
    Math.max(
      0,
      money(
        principal +
          interestAmount,
      ) -
        amountPaid,
    );

  return money(
    Math.min(
      money(
        installmentAmount,
      ),
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
      amountDue -
        paymentsDuringPeriod,
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
  const { loans } =
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
  const { audit } =
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

  const { client } =
    await getCollections();

  const session =
    client.startSession();

  /*
   * Captured from the member already loaded inside the
   * transaction. It is intentionally used only after the
   * transaction has successfully committed.
   */
  let loanDisbursementRecipient =
    "";

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

          const { loans } =
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

          const repaymentCycleDays =
            normalizeCycleDays(
              settings.repaymentCycleDays,
            );

          const fineRate =
            normalizeRate(
              settings.fineRate,
            );

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

          const disbursementDate:
            CalendarDate =
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

          const firstDueDate:
            CalendarDate =
            addCalendarDays(
              disbursementDate,
              repaymentCycleDays,
            );

          const repaymentDate:
            CalendarDate =
            input.repaymentDate !==
            undefined
              ? input.repaymentDate
              : firstDueDate;

          const endDate:
            CalendarDate =
            input.endDate !==
            undefined
              ? input.endDate
              : repaymentDate;

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

          const loanNumber =
            await generateLoanNumber(
              session,
            );

          const guarantor =
            normalizeGuarantor(
              input.guarantor,
            );

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

          /*
           * Capture the member phone from the member that
           * was already loaded for this loan.
           *
           * This is only data capture. The SMS is NOT queued
           * until after the transaction commits successfully.
           */
          loanDisbursementRecipient =
            typeof member.phone ===
            "string"
              ? member.phone.trim()
              : "";

          const now =
            new Date();

          /*
           * IMPORTANT:
           *
           * completedInstallmentBalance is intentionally
           * absent from this document.
           *
           * It belongs only to the public Loan response.
           */
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

            installmentAmount,

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

              installmentAmount,

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

    /* =====================================================
       LOAN DISBURSEMENT SMS

       The transaction has successfully committed before
       reaching this point.

       SMS failure must NEVER affect the successful loan.
    ===================================================== */

    if (
      loanDisbursementRecipient
    ) {
      try {
        await queueLoanDisbursementSms({
          loanId:
            createdLoan.id,

          memberId:
            createdLoan.memberId,

          recipient:
            loanDisbursementRecipient,

          memberName:
            createdLoan.memberName,

          amount:
            createdLoan.principal,

          installmentAmount:
            createdLoan.installmentAmount,

          firstDueDate:
            createdLoan.firstDueDate,
        });
      } catch (error) {
        console.error(
          "Failed to queue loan disbursement SMS.",
          {
            loanId:
              createdLoan.id,

            loanNumber:
              createdLoan.loanNumber,

            memberId:
              createdLoan.memberId,

            memberName:
              createdLoan.memberName,

            error,
          },
        );
      }
    } else {
      console.warn(
        "Loan disbursement SMS skipped: member has no phone number.",
        {
          loanId:
            createdLoan.id,

          loanNumber:
            createdLoan.loanNumber,

          memberId:
            createdLoan.memberId,
        },
      );
    }

    return createdLoan;
  } finally {
    await session.endSession();
  }
}


/* =========================================================
   LOAN CALENDAR DATE NORMALIZATION
========================================================= */

/**
 * Normalizes financial dates coming from MongoDB.
 *
 * Canonical application format:
 *
 *   YYYY-MM-DD
 *
 * This also accepts legacy MongoDB Date values and ISO
 * datetime strings so older records do not break balance
 * calculations.
 */
function normalizeLoanCalendarDate(
  value: unknown,
  fieldName: string,
  loanNumber?: string,
): CalendarDate {
  /* =======================================================
     ALREADY A CALENDAR DATE
  ======================================================= */

  if (
    typeof value === "string"
  ) {
    const trimmed =
      value.trim();

    /*
     * Exact canonical format.
     */
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(
        trimmed,
      )
    ) {
      assertCalendarDate(
        trimmed as CalendarDate,
        fieldName,
      );

      return trimmed as CalendarDate;
    }

    /*
     * Legacy ISO string such as:
     *
     *   2026-09-21T00:00:00.000Z
     */
    const isoMatch =
      trimmed.match(
        /^(\d{4}-\d{2}-\d{2})/,
      );

    if (isoMatch) {
      const calendarDate =
        isoMatch[1] as CalendarDate;

      assertCalendarDate(
        calendarDate,
        fieldName,
      );

      return calendarDate;
    }
  }

  /* =======================================================
     LEGACY JAVASCRIPT DATE
  ======================================================= */

  if (
    (value as unknown) instanceof
    Date
  ) {
    const date =
      value as Date;

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      throw new Error(
        `Invalid ${fieldName}.`,
      );
    }

    return dateToKenyanCalendarDate(
      date,
    );
  }

  /* =======================================================
     INVALID VALUE
  ======================================================= */

  console.error(
    "[LOAN DATE] INVALID CALENDAR DATE",
    {
      fieldName,
      loanNumber,
      value,
      valueType:
        typeof value,
    },
  );

  throw new Error(
    `Invalid ${fieldName}. Expected YYYY-MM-DD.`,
  );
}


/* =========================================================
   ASSESSMENT PERIOD HELPERS
========================================================= */

type AssessmentPeriod = {
  periodNumber: number;
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
};


/**
 * Builds one repayment assessment period.
 *
 * Example:
 *
 * disbursement = 2026-09-14
 * cycle        = 7 days
 *
 * Period 1:
 *
 *   2026-09-14 -> 2026-09-21
 *
 * Period 2:
 *
 *   2026-09-21 -> 2026-09-28
 */
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

  const disbursementDate =
    normalizeLoanCalendarDate(
      loan.disbursementDate,
      "loan.disbursementDate",
      loan.loanNumber,
    );

  const periodStart =
    addCalendarDays(
      disbursementDate,
      (
        periodNumber - 1
      ) * cycleDays,
    );

  const periodEnd =
    addCalendarDays(
      periodStart,
      cycleDays,
    );

  return {
    periodNumber,
    periodStart,
    periodEnd,
  };
}



/**
 * Returns the number of fully completed repayment cycles.
 */
function getLatestDueAssessmentPeriod(
  loan: LoanDocument,
  asOfDate: Date,
): number {
  const cycleDays =
    normalizeCycleDays(
      loan.repaymentCycleDays,
    );

  const disbursementDate =
    normalizeLoanCalendarDate(
      loan.disbursementDate,
      "loan.disbursementDate",
      loan.loanNumber,
    );

  const asOfCalendarDate =
    dateToKenyanCalendarDate(
      asOfDate,
    );

  /*
   * Calculate elapsed calendar days as:
   *
   *   asOfDate - disbursementDate
   *
   * Example:
   *
   *   disbursement = 2026-09-09
   *   asOf         = 2026-09-16
   *   elapsed      = 7 days
   *
   * Therefore period 1 is completed.
   */
  const elapsedDays =
    differenceInCalendarDays(
      asOfCalendarDate,
      disbursementDate,
    );

  if (
    elapsedDays < cycleDays
  ) {
    return 0;
  }

  return Math.floor(
    elapsedDays /
      cycleDays,
  );
}


/* =========================================================
   WEEKLY REPAYMENT BREAKDOWN TYPES
========================================================= */

type WeeklyRepaymentBreakdownPeriod = {
  periodNumber: number;

  periodStart: CalendarDate;

  periodEnd: CalendarDate;

  installment: number;

  allocated: number;

  balance: number;

  status:
    | "paid"
    | "partial"
    | "current"
    | "unpaid";
};

type WeeklyRepaymentAllocation = {
  /*
   * Stable response-only ordering.
   */
  allocationNumber: number;

  /*
   * Identifies the original payment within this
   * calculation.
   */
  paymentSequence: number;

  paymentDate: CalendarDate;

  paymentAmount: number;

  periodNumber: number;

  periodStart: CalendarDate;

  periodEnd: CalendarDate;

  amountApplied: number;

  beforeRemaining: number;

  afterRemaining: number;

  /*
   * Amount from the same payment still available
   * after this allocation.
   */
  remainingPayment: number;

  /*
   * True when this allocation completely cleared
   * an installment and some money continued into
   * the next installment.
   */
  carriedForward: boolean;
};

type WeeklyRepaymentSurplus = {
  paymentSequence: number;

  paymentDate: CalendarDate;

  paymentAmount: number;

  unusedCredit: number;
};

type WeeklyRepaymentBreakdown = {
  installmentAmount: number;

  cycleDays: number;

  latestCompletedPeriod: number;

  currentPeriodNumber: number;

  completedBalance: number;

  currentBalance: number;

  totalBalance: number;

  periods: WeeklyRepaymentBreakdownPeriod[];

  allocations: WeeklyRepaymentAllocation[];

  surpluses: WeeklyRepaymentSurplus[];
};


/* =========================================================
   WEEKLY REPAYMENT BALANCE CALCULATION
========================================================= */

/**
 * Calculates the weekly repayment balance using
 * chronological oldest-outstanding-first allocation.
 *
 * Rules:
 *
 * 1. Every repayment cycle has an installment amount.
 * 2. All valid repayments are sorted chronologically.
 * 3. Every payment is applied to the oldest unpaid
 *    installment first.
 * 4. If a payment clears an installment, any surplus
 *    immediately carries into the next installment.
 * 5. A payment can therefore clear multiple installments.
 * 6. A cycle can never have a negative balance.
 * 7. Previous unpaid installments remain outstanding.
 * 8. The current installment is included.
 * 9. Fines are completely excluded.
 * 10. Credit remaining after the current installment
 *     is future credit and does not reduce the displayed
 *     weekly balance.
 *
 * The returned breakdown is response-only and is not
 * persisted to MongoDB.
 */
function calculateWeeklyRepaymentBalance(
  loan: LoanDocument,
  assessments: Array<{
    periodNumber: number;
    periodStart: CalendarDate;
    periodEnd: CalendarDate;
    expectedInstallment?: unknown;
    installmentShortfall?: unknown;
  }>,
  repayments: Array<{
    amount: unknown;
    transactionDate: unknown;
  }>,
  asOfDate: Date,
): {
  completedInstallmentBalance: number;
  currentInstallmentBalance: number;
  weeklyRepaymentBalance: number;
  currentPeriodNumber: number;
  weeklyRepaymentBreakdown: WeeklyRepaymentBreakdown;
  loanPaymentReminder: LoanPaymentReminderPeriod | null;
} {
  const disbursementDate = normalizeLoanCalendarDate(
    loan.disbursementDate,
    "loan.disbursementDate",
    loan.loanNumber,
  );

  const today = dateToKenyanCalendarDate(asOfDate);

  const installmentAmount = money(
    Math.max(0, Number(loan.installmentAmount ?? 0)),
  );

  const cycleDaysRaw = Number(
    loan.repaymentCycleDays ?? 7,
  );

  const cycleDays =
    Number.isInteger(cycleDaysRaw) && cycleDaysRaw > 0
      ? cycleDaysRaw
      : 7;

  const latestCompletedPeriod =
    getLatestDueAssessmentPeriod(
      loan,
      asOfDate,
    );

  const currentPeriodNumber =
    latestCompletedPeriod + 1;

  const createEmptyBreakdown =
    (): WeeklyRepaymentBreakdown => ({
      installmentAmount,
      cycleDays,
      latestCompletedPeriod,
      currentPeriodNumber,
      completedBalance: 0,
      currentBalance: 0,
      totalBalance: 0,
      periods: [],
      allocations: [],
      surpluses: [],
    });

  /*
   * No valid installment amount means there is nothing
   * meaningful to calculate.
   */
  if (installmentAmount <= 0) {
    return {
      completedInstallmentBalance: 0,
      currentInstallmentBalance: 0,
      weeklyRepaymentBalance: 0,
      currentPeriodNumber,
      weeklyRepaymentBreakdown:
        createEmptyBreakdown(),
      loanPaymentReminder: null,
    };
  }

  type NormalizedRepayment = {
    paymentSequence: number;
    amount: number;
    transactionDate: CalendarDate;
  };

  /*
   * Normalize and validate repayments first.
   *
   * Financial dates remain CalendarDate strings.
   * Do not convert them to JavaScript Date objects.
   */
  const repaymentRecords =
    repayments
      .map(
        (
          repayment,
          index,
        ): NormalizedRepayment | null => {
          const transactionDate =
            normalizeLoanCalendarDate(
              repayment.transactionDate,
              "repayment.transactionDate",
              loan.loanNumber,
            );

          const amount = Number(
            repayment.amount ?? 0,
          );

          if (
            !Number.isFinite(amount) ||
            amount <= 0
          ) {
            return null;
          }

          /*
           * Ignore payments outside the loan's
           * valid calculation window.
           */
          if (
            transactionDate < disbursementDate ||
            transactionDate > today
          ) {
            return null;
          }

          return {
            paymentSequence: index + 1,
            amount: money(amount),
            transactionDate,
          };
        },
      )
      .filter(
        (
          repayment,
        ): repayment is NormalizedRepayment =>
          repayment !== null,
      )
      .sort((a, b) => {
        const dateComparison =
          a.transactionDate.localeCompare(
            b.transactionDate,
          );

        if (dateComparison !== 0) {
          return dateComparison;
        }

        return (
          a.paymentSequence -
          b.paymentSequence
        );
      });

  type InstallmentPeriod = {
    periodNumber: number;
    periodStart: CalendarDate;
    periodEnd: CalendarDate;
    periodInstallment: number;
    remainingBalance: number;
    amountPaidToPeriod: number;
  };

  const periods: InstallmentPeriod[] = [];

  /*
   * Build every completed period plus the current
   * open period.
   */
  for (
    let periodNumber = 1;
    periodNumber <= currentPeriodNumber;
    periodNumber++
  ) {
    const period =
      getAssessmentPeriod(
        loan,
        periodNumber,
      );

    const assessment =
      assessments.find(
        (item) =>
          item.periodNumber ===
          periodNumber,
      );

    /*
     * Completed periods use the installment recorded
     * by their assessment when available.
     *
     * The current period uses the loan's current
     * installment amount.
     */
    const periodInstallment =
      periodNumber <=
      latestCompletedPeriod
        ? money(
            Math.max(
              0,
              Number(
                assessment?.expectedInstallment ??
                  installmentAmount,
              ),
            ),
          )
        : installmentAmount;

    if (periodInstallment <= 0) {
      continue;
    }

    periods.push({
      periodNumber,
      periodStart:
        period.periodStart,
      periodEnd:
        period.periodEnd,
      periodInstallment,
      remainingBalance:
        periodInstallment,
      amountPaidToPeriod: 0,
    });
  }

  const allocations:
    WeeklyRepaymentAllocation[] = [];

  const surpluses:
    WeeklyRepaymentSurplus[] = [];

  let periodIndex = 0;
  let allocationNumber = 0;

  /*
   * Apply repayments chronologically.
   *
   * A payment always clears the oldest unpaid
   * installment first. Any excess becomes surplus.
   */
  for (const repayment of repaymentRecords) {
    let remainingPayment = money(
      repayment.amount,
    );

    if (remainingPayment <= 0) {
      continue;
    }

    while (
      remainingPayment > 0 &&
      periodIndex < periods.length
    ) {
      const period =
        periods[periodIndex];

      /*
       * Skip an already-paid period.
       */
      if (period.remainingBalance <= 0) {
        periodIndex++;
        continue;
      }

      const beforeRemaining =
        money(
          period.remainingBalance,
        );

      const amountApplied =
        money(
          Math.min(
            remainingPayment,
            beforeRemaining,
          ),
        );

      if (amountApplied <= 0) {
        break;
      }

      period.remainingBalance =
        money(
          Math.max(
            0,
            beforeRemaining -
              amountApplied,
          ),
        );

      period.amountPaidToPeriod =
        money(
          period.amountPaidToPeriod +
            amountApplied,
        );

      remainingPayment =
        money(
          Math.max(
            0,
            remainingPayment -
              amountApplied,
          ),
        );

      allocationNumber++;

      allocations.push({
        allocationNumber,
        paymentSequence:
          repayment.paymentSequence,
        paymentDate:
          repayment.transactionDate,
        paymentAmount: money(
          repayment.amount,
        ),
        periodNumber:
          period.periodNumber,
        periodStart:
          period.periodStart,
        periodEnd:
          period.periodEnd,
        amountApplied,
        beforeRemaining,
        afterRemaining:
          period.remainingBalance,
        remainingPayment,
        carriedForward:
          period.remainingBalance <= 0 &&
          remainingPayment > 0,
      });

      if (
        period.remainingBalance <= 0
      ) {
        periodIndex++;
      }
    }

    /*
     * Money remaining after all known installment
     * periods is genuine excess credit.
     */
    if (remainingPayment > 0) {
      const unusedCredit =
        money(remainingPayment);

      surpluses.push({
        paymentSequence:
          repayment.paymentSequence,
        paymentDate:
          repayment.transactionDate,
        paymentAmount: money(
          repayment.amount,
        ),
        unusedCredit,
      });
    }
  }

  let completedInstallmentBalance = 0;
  let currentInstallmentBalance = 0;

  /*
   * Calculate the actual accounting balances.
   *
   * IMPORTANT:
   * currentInstallmentBalance remains the REAL
   * unpaid amount of the current period.
   *
   * We do NOT replace it with the next installment
   * here because that would corrupt accounting
   * semantics.
   */
  for (const period of periods) {
    const remainingBalance =
      money(
        Math.max(
          0,
          period.remainingBalance,
        ),
      );

    if (
      period.periodNumber <=
      latestCompletedPeriod
    ) {
      completedInstallmentBalance =
        money(
          completedInstallmentBalance +
            remainingBalance,
        );
    } else if (
      period.periodNumber ===
      currentPeriodNumber
    ) {
      currentInstallmentBalance =
        remainingBalance;
    }
  }

  completedInstallmentBalance =
    money(
      Math.max(
        0,
        completedInstallmentBalance,
      ),
    );

  currentInstallmentBalance =
    money(
      Math.max(
        0,
        currentInstallmentBalance,
      ),
    );

  /*
   * This remains the real weekly amount currently
   * owed across completed unpaid installments and
   * the current installment.
   */
  const weeklyRepaymentBalance =
    money(
      Math.max(
        0,
        completedInstallmentBalance +
          currentInstallmentBalance,
      ),
    );

  /*
   * Build the period breakdown from the REAL
   * calculated balances.
   */
  const breakdownPeriods =
    periods
      .map(
        (
          period,
        ): WeeklyRepaymentBreakdownPeriod => {
          const balance =
            money(
              Math.max(
                0,
                period.remainingBalance,
              ),
            );

          const allocated =
            money(
              Math.max(
                0,
                period.amountPaidToPeriod,
              ),
            );

          let status:
            | "paid"
            | "partial"
            | "current"
            | "unpaid";

          if (balance <= 0) {
            status = "paid";
          } else if (
            period.periodNumber ===
            currentPeriodNumber
          ) {
            status = "current";
          } else if (allocated > 0) {
            status = "partial";
          } else {
            status = "unpaid";
          }

          return {
            periodNumber:
              period.periodNumber,
            periodStart:
              period.periodStart,
            periodEnd:
              period.periodEnd,
            installment: money(
              period.periodInstallment,
            ),
            allocated,
            balance,
            status,
          };
        },
      )
      .sort(
        (a, b) =>
          a.periodNumber -
          b.periodNumber,
      );

  allocations.sort((a, b) => {
    const dateComparison =
      a.paymentDate.localeCompare(
        b.paymentDate,
      );

    if (dateComparison !== 0) {
      return dateComparison;
    }

    if (
      a.paymentSequence !==
      b.paymentSequence
    ) {
      return (
        a.paymentSequence -
        b.paymentSequence
      );
    }

    return (
      a.allocationNumber -
      b.allocationNumber
    );
  });

  surpluses.sort((a, b) => {
    const dateComparison =
      a.paymentDate.localeCompare(
        b.paymentDate,
      );

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return (
      a.paymentSequence -
      b.paymentSequence
    );
  });

  /*
   * ---------------------------------------------------------
   * DISPLAY FALLBACK
   * ---------------------------------------------------------
   *
   * If the current installment has already been paid,
   * but the loan itself still has money outstanding,
   * expose the next installment amount through the
   * breakdown's currentBalance.
   *
   * This is intentionally ONLY a breakdown/display value.
   *
   * We do not modify:
   *
   *   - currentInstallmentBalance
   *   - completedInstallmentBalance
   *   - weeklyRepaymentBalance
   *   - period balances
   *   - period status
   *
   * Therefore a paid current period remains "paid".
   *
   * `loan.outstandingBalance` is the loan-level balance
   * and is independent of the weekly installment balance.
   */
  const loanOutstandingBalance =
    money(
      Math.max(
        0,
        Number(
          loan.outstandingBalance ?? 0,
        ),
      ),
    );

  const breakdownCurrentBalance =
    currentInstallmentBalance <= 0 &&
    loanOutstandingBalance > 0
      ? installmentAmount
      : currentInstallmentBalance;

  /*
   * IMPORTANT:
   *
   * The reminder must use the REAL current-period
   * balance, not the display fallback.
   *
   * Passing the fallback here could cause a loan whose
   * current installment is already paid to incorrectly
   * appear unpaid to the reminder system.
   */
  const reminderBreakdown:
    WeeklyRepaymentBreakdown = {
    installmentAmount,
    cycleDays,
    latestCompletedPeriod,
    currentPeriodNumber,
    completedBalance:
      completedInstallmentBalance,
    currentBalance:
      currentInstallmentBalance,
    totalBalance:
      weeklyRepaymentBalance,
    periods: breakdownPeriods,
    allocations,
    surpluses,
  };

  /*
   * This is the public breakdown returned to the UI.
   *
   * Its currentBalance may show the next installment
   * when the current installment is already paid and
   * the loan still has an outstanding balance.
   */
  const weeklyRepaymentBreakdown:
    WeeklyRepaymentBreakdown = {
    installmentAmount,
    cycleDays,
    latestCompletedPeriod,
    currentPeriodNumber,
    completedBalance:
      completedInstallmentBalance,
    currentBalance:
      breakdownCurrentBalance,
    totalBalance:
      weeklyRepaymentBalance,
    periods: breakdownPeriods,
    allocations,
    surpluses,
  };

  const loanPaymentReminder =
    getLoanPaymentReminderPeriod(
      {
        currentPeriodNumber,
        weeklyRepaymentBreakdown:
          reminderBreakdown,
      },
      today,
    );

  return {
    completedInstallmentBalance,
    currentInstallmentBalance,
    weeklyRepaymentBalance,
    currentPeriodNumber,
    weeklyRepaymentBreakdown,
    loanPaymentReminder,
  };
}


function getLoanPaymentReminderPeriod(
  calculation: {
    currentPeriodNumber: number;

    weeklyRepaymentBreakdown:
      WeeklyRepaymentBreakdown;
  },
  today: CalendarDate,
): LoanPaymentReminderPeriod | null {
  const currentPeriod =
    calculation.weeklyRepaymentBreakdown.periods.find(
      (period) =>
        period.periodNumber ===
        calculation.currentPeriodNumber,
    );

  if (!currentPeriod) {
    return null;
  }

  /*
   * The installment is already fully paid.
   * No reminder is required.
   */
  if (
    currentPeriod.balance <= 0
  ) {
    return null;
  }

  /*
   * Reminder is sent exactly one calendar
   * day before the installment period ends.
   */
  const reminderDate =
    addCalendarDays(
      currentPeriod.periodEnd,
      -1,
    );

  if (
    today !== reminderDate
  ) {
    return null;
  }

  return {
    periodNumber:
      currentPeriod.periodNumber,

    periodStart:
      currentPeriod.periodStart,

    periodEnd:
      currentPeriod.periodEnd,

    installment:
      currentPeriod.installment,

    balance:
      currentPeriod.balance,
  };
}

/* =========================================================
   COMPLETED INSTALLMENT BALANCE
========================================================= */

/**
 * Returns the numeric weekly installment balance.
 *
 * This remains the scalar API for callers that only need
 * the number.
 */
export async function getCompletedInstallmentBalance(
  loanId: string,
): Promise<number> {
  if (
    typeof loanId !== "string" ||
    !ObjectId.isValid(
      loanId,
    )
  ) {
    throw new Error(
      "Invalid loan ID.",
    );
  }

  const {
    loans,
    assessments,
    repayments:
      repaymentCollection,
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

  const disbursementDate =
    normalizeLoanCalendarDate(
      loan.disbursementDate,
      "loan.disbursementDate",
      loan.loanNumber,
    );

  const today =
    dateToKenyanCalendarDate(
      new Date(),
    );

  /* =========================================================
     ASSESSMENTS
  ========================================================= */

  const assessmentDocuments =
    await assessments
      .find({
        loanId:
          objectId,
      })
      .project<{
        periodNumber: number;
        periodStart: CalendarDate;
        periodEnd: CalendarDate;
        expectedInstallment: unknown;
        installmentShortfall: unknown;
      }>({
        periodNumber: 1,
        periodStart: 1,
        periodEnd: 1,
        expectedInstallment: 1,
        installmentShortfall: 1,
      })
      .sort({
        periodNumber: 1,
      })
      .toArray();

  /* =========================================================
     REPAYMENTS
  ========================================================= */

  const repaymentDocuments =
    await repaymentCollection
      .find({
        loanId:
          objectId,
      })
      .project<{
        amount: unknown;
        transactionDate: unknown;
      }>({
        amount: 1,
        transactionDate: 1,
      })
      .toArray();

  const repaymentDocumentsForCalculation =
    repaymentDocuments
      .map(
        (
          repayment,
        ) => {
          const transactionDate =
            normalizeLoanCalendarDate(
              repayment.transactionDate,
              "repayment.transactionDate",
              loan.loanNumber,
            );

          const amount =
            Number(
              repayment.amount ??
                0,
            );

          return {
            amount,

            transactionDate,
          };
        },
      )
      .filter(
        (
          repayment,
        ) =>
          Number.isFinite(
            repayment.amount,
          ) &&
          repayment.amount > 0 &&
          repayment.transactionDate >=
            disbursementDate &&
          repayment.transactionDate <=
            today,
      )
      .sort(
        (
          a,
          b,
        ) =>
          a.transactionDate.localeCompare(
            b.transactionDate,
          ),
      );

  /* =========================================================
     CALCULATE
  ========================================================= */

  const result =
    calculateWeeklyRepaymentBalance(
      loan,
      assessmentDocuments,
      repaymentDocumentsForCalculation,
      new Date(),
    );

  return result.weeklyRepaymentBalance;
}


/* =========================================================
   LIST LOANS
========================================================= */


/* =========================================================
   LIST LOANS
========================================================= */

export async function getLoans(
  options: LoanListOptions = {},
): Promise<PaginatedLoans> {
  const {
    loans,
    members,
    assessments,
    repayments: repaymentCollection,
  } = await getCollections();

  /* =========================================================
     PAGINATION
  ========================================================= */

  const requestedPage = Number(options.page);

  const page =
    Number.isFinite(requestedPage) &&
    requestedPage >= 1
      ? Math.floor(requestedPage)
      : 1;

  const requestedLimit = Number(options.limit);

  const limit =
    Number.isFinite(requestedLimit) &&
    requestedLimit >= 1
      ? Math.min(100, Math.floor(requestedLimit))
      : 25;

  /* =========================================================
     FILTER
  ========================================================= */

  const filter: Record<string, unknown> = {};

  if (options.status) {
    filter.status = options.status;
  }

  if (options.type) {
    filter.type = options.type;
  }

  if (options.repaymentStatus) {
    filter.repaymentStatus = options.repaymentStatus;
  }

  if (options.memberId) {
    if (!ObjectId.isValid(options.memberId)) {
      return {
        loans: [],
        total: 0,
        page: 1,
        limit,
        totalPages: 0,
      };
    }

    filter.memberId = createObjectId(options.memberId);
  }

  /* =========================================================
     DATE FILTERS
  ========================================================= */

  if (options.repaymentDate) {
    assertCalendarDate(
      options.repaymentDate,
      "repayment date",
    );

    filter.repaymentDate = options.repaymentDate;
  }

  if (options.endDate) {
    assertCalendarDate(
      options.endDate,
      "loan end date",
    );

    filter.endDate = options.endDate;
  }

  /* =========================================================
     SEARCH
  ========================================================= */

  const search =
    typeof options.search === "string"
      ? options.search.trim()
      : "";

  if (search) {
    const regex = new RegExp(
      escapeRegex(search),
      "i",
    );

    filter.$or = [
      {
        loanNumber: regex,
      },
      {
        memberNumber: regex,
      },
      {
        memberName: regex,
      },
      {
        "guarantor.name": regex,
      },
      {
        "guarantor.phone": regex,
      },
    ];
  }

  /* =========================================================
     COUNT
  ========================================================= */

  const total = await loans.countDocuments(filter);

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(total / limit);

  const safePage =
    totalPages > 0
      ? Math.min(page, totalPages)
      : 1;

  /* =========================================================
     LOAD LOANS
  ========================================================= */

  const documents = await loans
    .find(filter)
    .sort({
      createdAt: -1,
      _id: -1,
    })
    .skip((safePage - 1) * limit)
    .limit(limit)
    .toArray();

  if (documents.length === 0) {
    return {
      loans: [],
      total,
      page: safePage,
      limit,
      totalPages,
    };
  }

  /* =========================================================
     LOAN IDS
  ========================================================= */

  const loanIds = documents
    .map((document) => document._id)
    .filter(
      (id): id is ObjectId =>
        id instanceof ObjectId,
    );

  /* =========================================================
     MEMBER IDS
     
     The loan stores memberId.
     The member document stores:
     
       _id
       membershipNumber
       phone
     
     We use memberId to resolve the correct member.
  ========================================================= */

  const memberIds = documents
    .map((document) => document.memberId)
    .filter(
      (id): id is ObjectId =>
        id instanceof ObjectId,
    );

  /* =========================================================
     LOAD MEMBERS

     Only load members belonging to the loans on this page.
     Phone number comes from the members collection.
  ========================================================= */

  const memberDocuments =
    memberIds.length > 0
      ? await members
          .find({
            _id: {
              $in: memberIds,
            },
          })
          .project<{
            _id: ObjectId;
            membershipNumber?: string;
            firstName?: string;
            middleName?: string;
            lastName?: string;
            phone?: string;
          }>({
            _id: 1,
            membershipNumber: 1,
            firstName: 1,
            middleName: 1,
            lastName: 1,
            phone: 1,
          })
          .toArray()
      : [];

  /* =========================================================
     GROUP MEMBERS
  ========================================================= */

  const membersById = new Map<
    string,
    (typeof memberDocuments)[number]
  >();

  for (const member of memberDocuments) {
    membersById.set(
      member._id.toString(),
      member,
    );
  }

  /* =========================================================
     LOAD ASSESSMENTS
  ========================================================= */

  const assessmentDocuments =
    loanIds.length > 0
      ? await assessments
          .find({
            loanId: {
              $in: loanIds,
            },
          })
          .project<{
            loanId: ObjectId;
            periodNumber: number;
            periodStart: CalendarDate;
            periodEnd: CalendarDate;
            expectedInstallment: unknown;
            installmentShortfall: unknown;
          }>({
            loanId: 1,
            periodNumber: 1,
            periodStart: 1,
            periodEnd: 1,
            expectedInstallment: 1,
            installmentShortfall: 1,
          })
          .sort({
            periodNumber: 1,
          })
          .toArray()
      : [];

  /* =========================================================
     GROUP ASSESSMENTS
  ========================================================= */

  const assessmentsByLoanId = new Map<
    string,
    typeof assessmentDocuments
  >();

  for (const assessment of assessmentDocuments) {
    const key = assessment.loanId.toString();

    const existing =
      assessmentsByLoanId.get(key);

    if (existing) {
      existing.push(assessment);
    } else {
      assessmentsByLoanId.set(
        key,
        [assessment],
      );
    }
  }

  /* =========================================================
     LOAD REPAYMENTS
  ========================================================= */

  const repaymentDocuments =
    loanIds.length > 0
      ? await repaymentCollection
          .find({
            loanId: {
              $in: loanIds,
            },
          })
          .project<{
            loanId: ObjectId;
            amount: unknown;
            transactionDate: unknown;
          }>({
            loanId: 1,
            amount: 1,
            transactionDate: 1,
          })
          .toArray()
      : [];

  /* =========================================================
     GROUP REPAYMENTS
  ========================================================= */

  const repaymentsByLoanId = new Map<
    string,
    typeof repaymentDocuments
  >();

  for (const repayment of repaymentDocuments) {
    const key = repayment.loanId.toString();

    const existing =
      repaymentsByLoanId.get(key);

    if (existing) {
      existing.push(repayment);
    } else {
      repaymentsByLoanId.set(
        key,
        [repayment],
      );
    }
  }

  /* =========================================================
     HYDRATE LOANS
  ========================================================= */

  const hydratedLoans =
    await Promise.all(
      documents.map(async (document) => {
        const loan = toLoan(document);

        const loanId =
          document._id.toString();

        const loanAssessments =
          assessmentsByLoanId.get(
            loanId,
          ) ?? [];

        const loanRepayments =
          repaymentsByLoanId.get(
            loanId,
          ) ?? [];

        const result =
          calculateWeeklyRepaymentBalance(
            document,
            loanAssessments,
            loanRepayments,
            new Date(),
          );

        /* =================================================
           RESOLVE MEMBER
           
           Loan:
             memberId
             memberNumber
           
           Member:
             _id
             membershipNumber
             phone
           
           We use memberId because it is the
           direct database relationship.
        ================================================= */

        const member =
          membersById.get(
            document.memberId.toString(),
          );

        /* =================================================
           LOAN PAYMENT REMINDER SMS
        ================================================= */

        if (
          result.loanPaymentReminder
        ) {
          const recipient =
            typeof member?.phone ===
            "string"
              ? member.phone.trim()
              : "";

          if (recipient) {
            try {
              await queueLoanPaymentReminderSms(
                {
                  loanId: loan.id,

                  memberId:
                    loan.memberId,

                  recipient,

                  memberName:
                    loan.memberName,

                  periodNumber:
                    result
                      .loanPaymentReminder
                      .periodNumber,

                  installmentAmount:
                    result
                      .loanPaymentReminder
                      .installment,

                  dueDate:
                    result
                      .loanPaymentReminder
                      .periodEnd,
                },
              );
            } catch (error) {
              /*
               * SMS failure must NEVER affect
               * loan retrieval or financial data.
               */
              console.error(
                "Failed to queue loan payment reminder SMS.",
                {
                  loanId: loan.id,

                  loanNumber:
                    loan.loanNumber,

                  memberId:
                    loan.memberId,

                  memberNumber:
                    loan.memberNumber,

                  memberName:
                    loan.memberName,

                  recipient,

                  periodNumber:
                    result
                      .loanPaymentReminder
                      .periodNumber,

                  error,
                },
              );
            }
          } else {
            console.warn(
              "Loan payment reminder SMS skipped: member has no phone number.",
              {
                loanId: loan.id,

                loanNumber:
                  loan.loanNumber,

                memberId:
                  loan.memberId,

                memberNumber:
                  loan.memberNumber,

                memberName:
                  loan.memberName,
              },
            );
          }
        }

        /* =================================================
           RESPONSE-ONLY FINANCIAL VALUES
           
           Nothing here is persisted to MongoDB.
        ================================================= */

        loan.completedInstallmentBalance =
          result.completedInstallmentBalance;

        loan.weeklyRepaymentBalance =
          result.weeklyRepaymentBalance;

        loan.weeklyRepaymentBreakdown =
          result.weeklyRepaymentBreakdown;

        console.log(
          "[LOANS LIST][WEEKLY BALANCE]",
          {
            loanNumber:
              document.loanNumber,

            memberNumber:
              document.memberNumber,

            completedBalance:
              result.completedInstallmentBalance,

            currentBalance:
              result.currentInstallmentBalance,

            totalBalance:
              result.weeklyRepaymentBalance,

            currentPeriod:
              result.currentPeriodNumber,

            periodCount:
              result
                .weeklyRepaymentBreakdown
                .periods
                .length,

            allocationCount:
              result
                .weeklyRepaymentBreakdown
                .allocations
                .length,

            surplusCount:
              result
                .weeklyRepaymentBreakdown
                .surpluses
                .length,
          },
        );

        return loan;
      }),
    );

  /* =========================================================
     RESPONSE
  ========================================================= */

  return {
    loans: hydratedLoans,
    total,
    page: safePage,
    limit,
    totalPages,
  };
}


/* =========================================================
   GET LOAN BY ID
========================================================= */

export async function getLoanById(
  id: string,
): Promise<Loan | null> {
  if (
    typeof id !== "string" ||
    !ObjectId.isValid(
      id,
    )
  ) {
    return null;
  }

  const {
    loans,
    assessments,
    repayments:
      repaymentCollection,
  } =
    await getCollections();

  const objectId =
    createObjectId(
      id,
    );

  const loan =
    await loans.findOne({
      _id:
        objectId,
    });

  if (!loan) {
    return null;
  }

  /* =========================================================
     ASSESSMENTS
  ========================================================= */

  const assessmentDocuments =
    await assessments
      .find({
        loanId:
          objectId,
      })
      .project<{
        periodNumber: number;
        periodStart: CalendarDate;
        periodEnd: CalendarDate;
        expectedInstallment: unknown;
        installmentShortfall: unknown;
      }>({
        periodNumber: 1,
        periodStart: 1,
        periodEnd: 1,
        expectedInstallment: 1,
        installmentShortfall: 1,
      })
      .sort({
        periodNumber: 1,
      })
      .toArray();

  /* =========================================================
     REPAYMENTS
  ========================================================= */

  const repaymentDocuments =
    await repaymentCollection
      .find({
        loanId:
          objectId,
      })
      .project<{
        amount: unknown;
        transactionDate: unknown;
      }>({
        amount: 1,
        transactionDate: 1,
      })
      .toArray();

  /* =========================================================
     CALCULATE
  ========================================================= */

  const result =
    calculateWeeklyRepaymentBalance(
      loan,
      assessmentDocuments,
      repaymentDocuments,
      new Date(),
    );

  /* =========================================================
     RESPONSE
  ========================================================= */

  return {
    ...toLoan(
      loan,
    ),

    completedInstallmentBalance:
      result.completedInstallmentBalance,

    weeklyRepaymentBalance:
      result.weeklyRepaymentBalance,

    weeklyRepaymentBreakdown:
      result.weeklyRepaymentBreakdown,
  };
}


/* =========================================================
   GET LOAN BY NUMBER
========================================================= */

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
    assessments,
    repayments:
      repaymentCollection,
  } =
    await getCollections();

  const loan =
    await loans.findOne({
      loanNumber:
        normalized,
    });

  if (!loan) {
    return null;
  }

  const objectId =
    loan._id;

  /* =========================================================
     ASSESSMENTS
  ========================================================= */

  const assessmentDocuments =
    await assessments
      .find({
        loanId:
          objectId,
      })
      .project<{
        periodNumber: number;
        periodStart: CalendarDate;
        periodEnd: CalendarDate;
        expectedInstallment: unknown;
        installmentShortfall: unknown;
      }>({
        periodNumber: 1,
        periodStart: 1,
        periodEnd: 1,
        expectedInstallment: 1,
        installmentShortfall: 1,
      })
      .sort({
        periodNumber: 1,
      })
      .toArray();

  /* =========================================================
     REPAYMENTS
  ========================================================= */

  const repaymentDocuments =
    await repaymentCollection
      .find({
        loanId:
          objectId,
      })
      .project<{
        amount: unknown;
        transactionDate: unknown;
      }>({
        amount: 1,
        transactionDate: 1,
      })
      .toArray();

  /* =========================================================
     CALCULATE
  ========================================================= */

  const result =
    calculateWeeklyRepaymentBalance(
      loan,
      assessmentDocuments,
      repaymentDocuments,
      new Date(),
    );

  /* =========================================================
     RESPONSE
  ========================================================= */

  return {
    ...toLoan(
      loan,
    ),

    completedInstallmentBalance:
      result.completedInstallmentBalance,

    weeklyRepaymentBalance:
      result.weeklyRepaymentBalance,

    weeklyRepaymentBreakdown:
      result.weeklyRepaymentBreakdown,
  };
}




/* =========================================================
   UPDATE LOAN
========================================================= */

/**
 * Full CRUD loan update.
 *
 * Contractual loan fields remain editable even after
 * repayments, fines, waivers, or assessments exist.
 *
 * Financial projection fields are never accepted from
 * the client. They are recalculated from authoritative
 * ledger data.
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
    throw new Error(
      "Invalid loan ID.",
    );
  }

  if (
    !changes ||
    typeof changes !==
      "object" ||
    Array.isArray(changes)
  ) {
    throw new Error(
      "Loan update data is required.",
    );
  }

  const actor =
    normalizeActor(
      updatedBy,
    );

  const rawChanges =
    changes as Record<
      string,
      unknown
    >;

  const forbiddenFields =
    new Set([
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

  for (
    const field of
      Object.keys(
        rawChanges,
      )
  ) {
    if (
      forbiddenFields.has(
        field,
      )
    ) {
      throw new Error(
        `${field} cannot be changed through loan editing.`,
      );
    }
  }

  const allowedFields =
    new Set([
      "type",
      "principal",
      "installmentAmount",
      "disbursementDate",
      "repaymentDate",
      "endDate",
      "guarantor",
    ]);

  for (
    const field of
      Object.keys(
        rawChanges,
      )
  ) {
    if (
      !allowedFields.has(
        field,
      )
    ) {
      throw new Error(
        `Loan field '${field}' cannot be changed.`,
      );
    }
  }

  if (
    Object.keys(
      rawChanges,
    ).length === 0
  ) {
    throw new Error(
      "No loan changes were supplied.",
    );
  }

  const { client } =
    await getCollections();

  const session =
    client.startSession();

  try {
    return await session.withTransaction(
      async (): Promise<Loan> => {
        const { loans } =
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

        const newType =
          changes.type !==
          undefined
            ? changes.type
            : current.type;

        if (
          newType !==
            "regular" &&
          newType !==
            "emergency"
        ) {
          throw new Error(
            "Invalid loan type.",
          );
        }

        const settings =
          await getLoanSettings(
            session,
          );

        if (
          newType ===
            "regular" &&
          !settings.regularLoansEnabled
        ) {
          throw new Error(
            "Regular loans are currently disabled.",
          );
        }

        if (
          newType ===
            "emergency" &&
          !settings.emergencyLoansEnabled
        ) {
          throw new Error(
            "Emergency loans are currently disabled.",
          );
        }

        const newPrincipal =
          changes.principal !==
          undefined
            ? money(
                Number(
                  changes.principal,
                ),
              )
            : money(
                current.principal,
              );

        if (
          !Number.isFinite(
            newPrincipal,
          ) ||
          newPrincipal <= 0
        ) {
          throw new Error(
            "Loan principal must be greater than zero.",
          );
        }

        const newInterestRate =
          newType ===
            current.type
            ? normalizeRate(
                current.interestRate,
              )
            : normalizeRate(
                newType ===
                  "emergency"
                  ? settings.emergencyInterestRate
                  : settings.regularInterestRate,
              );

        const newInterestAmount =
          money(
            newPrincipal *
              newInterestRate,
          );

        const newTotalDue =
          money(
            newPrincipal +
              newInterestAmount,
          );

        const newInstallmentAmount =
          changes.installmentAmount !==
          undefined
            ? money(
                Number(
                  changes.installmentAmount,
                ),
              )
            : money(
                current.installmentAmount,
              );

        if (
          !Number.isFinite(
            newInstallmentAmount,
          ) ||
          newInstallmentAmount <= 0
        ) {
          throw new Error(
            "Installment amount must be greater than zero.",
          );
        }

        if (
          newInstallmentAmount >
          newTotalDue
        ) {
          throw new Error(
            "Installment amount cannot exceed the total expected loan amount.",
          );
        }

        const newDisbursementDate =
          changes.disbursementDate !==
          undefined
            ? changes.disbursementDate
            : current.disbursementDate;

        const newRepaymentDate =
          changes.repaymentDate !==
          undefined
            ? changes.repaymentDate
            : current.repaymentDate;

        const newEndDate =
          changes.endDate !==
          undefined
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

        if (
          newRepaymentDate <
          newDisbursementDate
        ) {
          throw new Error(
            "Repayment date cannot be before disbursement date.",
          );
        }

        if (
          newEndDate <
          newRepaymentDate
        ) {
          throw new Error(
            "Loan end date cannot be before repayment date.",
          );
        }

        const repaymentCycleDays =
          normalizeCycleDays(
            current.repaymentCycleDays,
          );

        const newFirstDueDate =
          addCalendarDays(
            newDisbursementDate,
            repaymentCycleDays,
          );

        const newGuarantor =
          changes.guarantor !==
          undefined
            ? normalizeGuarantor(
                changes.guarantor,
              )
            : current.guarantor;

        const amountPaid =
          await getLoanPaidTotal(
            objectId,
            session,
          );

        const totalFines =
          await getLoanFineTotal(
            objectId,
            session,
          );

        const totalWaivedFines =
          Math.min(
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

        const newStatus:
          Loan["status"] =
          current.status ===
            "cancelled"
            ? "cancelled"
            : outstandingBalance <=
                0
              ? "completed"
              : "active";

        const newRepaymentStatus:
          Loan["repaymentStatus"] =
          outstandingBalance <=
            0
            ? "completed"
            : current.repaymentStatus ===
                "defaulted"
              ? "defaulted"
              : "current";

        const before = {
          type:
            current.type,

          principal:
            current.principal,

          installmentAmount:
            current.installmentAmount,

          interestRate:
            current.interestRate,

          interestAmount:
            current.interestAmount,

          disbursementDate:
            current.disbursementDate,

          repaymentDate:
            current.repaymentDate,

          endDate:
            current.endDate,

          firstDueDate:
            current.firstDueDate,

          totalDue:
            current.totalDue,

          amountPaid:
            current.amountPaid,

          totalFines:
            current.totalFines,

          totalWaivedFines:
            current.totalWaivedFines,

          outstandingBalance:
            current.outstandingBalance,

          status:
            current.status,

          repaymentStatus:
            current.repaymentStatus,

          guarantor:
            current.guarantor,
        };

        const after = {
          type:
            newType,

          principal:
            newPrincipal,

          installmentAmount:
            newInstallmentAmount,

          interestRate:
            newInterestRate,

          interestAmount:
            newInterestAmount,

          disbursementDate:
            newDisbursementDate,

          repaymentDate:
            newRepaymentDate,

          endDate:
            newEndDate,

          firstDueDate:
            newFirstDueDate,

          totalDue:
            newTotalDue,

          amountPaid,

          totalFines,

          totalWaivedFines,

          outstandingBalance,

          status:
            newStatus,

          repaymentStatus:
            newRepaymentStatus,

          guarantor:
            newGuarantor,
        };

        const now =
          new Date();

        const updateResult =
          await loans.updateOne(
            {
              _id:
                objectId,

              updatedAt:
                current.updatedAt,
            },
            {
              $set: {
                type:
                  newType,

                principal:
                  newPrincipal,

                installmentAmount:
                  newInstallmentAmount,

                interestRate:
                  newInterestRate,

                interestAmount:
                  newInterestAmount,

                disbursementDate:
                  newDisbursementDate,

                repaymentDate:
                  newRepaymentDate,

                endDate:
                  newEndDate,

                firstDueDate:
                  newFirstDueDate,

                totalDue:
                  newTotalDue,

                amountPaid,

                totalFines,

                totalWaivedFines,

                outstandingBalance,

                status:
                  newStatus,

                repaymentStatus:
                  newRepaymentStatus,

                guarantor:
                  newGuarantor,

                updatedAt:
                  now,
              },
            },
            {
              session,
            },
          );

        if (
          updateResult.matchedCount !==
          1
        ) {
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
            action:
              "loan_updated",

            before,

            after,
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
            "Updated loan could not be retrieved.",
          );
        }

        return toLoan(
          updated,
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
   ACCRUE ALL ELIGIBLE LOAN FINES
========================================================= */

/**
 * Finds active loans that have reached at least their first
 * repayment cycle and passes them to accrueLoanFines().
 *
 * accrueLoanFines() remains the authoritative financial
 * assessment and persistence engine.
 */
export async function accrueAllLoanFines(): Promise<number> {
  const { loans } =
    await getCollections();

  const now =
    new Date();

  const today =
    dateToKenyanCalendarDate(
      now,
    );

  const candidates =
    await loans
      .find(
        {
          status:
            "active",

          fineStatus:
            "active",

          firstDueDate: {
            $lte:
              today,
          },
        },
        {
          projection: {
            _id: 1,
          },
        },
      )
      .toArray();

  let created =
    0;

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
   ASSESSMENT PERIOD
========================================================= */



async function getPeriodPaymentTotal(
  loanId: ObjectId,
  period: AssessmentPeriod,
  session?: ClientSession,
): Promise<number> {
  const { repayments } =
    await getCollections();

  /*
   * Financial dates are stored as exact
   * YYYY-MM-DD strings.
   *
   * Do NOT convert them to JavaScript Date.
   * Do NOT use $dateToString.
   */
  assertCalendarDate(
    period.periodStart,
    "repayment period start",
  );

  assertCalendarDate(
    period.periodEnd,
    "repayment period end",
  );

  /*
   * Period 1:
   *   start <= transactionDate <= end
   *
   * Period 2+:
   *   start < transactionDate <= end
   *
   * This prevents a repayment on a period boundary
   * from being counted in two different periods.
   */
  const transactionDateFilter =
    period.periodNumber === 1
      ? {
          $gte: period.periodStart,
          $lte: period.periodEnd,
        }
      : {
          $gt: period.periodStart,
          $lte: period.periodEnd,
        };

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
                transactionDateFilter,
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
      result[0]?.total ?? 0,
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

  /* =======================================================
     FINANCIAL TRANSACTION DATE

     Financial dates use the canonical CalendarDate format:

       YYYY-MM-DD

     Do NOT convert transactionDate to JavaScript Date.
  ======================================================= */

  const transactionDate =
    input.transactionDate;

  assertCalendarDate(
    transactionDate,
    "transaction date",
  );

  /* =======================================================
     FUTURE TRANSACTION PROTECTION

     CalendarDate strings sort chronologically when stored
     in YYYY-MM-DD format.

     The current Kenyan calendar date is the boundary.
  ======================================================= */

  const today =
    dateToKenyanCalendarDate(
      new Date(),
    );

  if (transactionDate > today) {
    throw new Error(
      "Repayment transaction date cannot be in the future.",
    );
  }

  /* =======================================================
     COLLECTIONS
  ======================================================= */

  const {
    client,
    db,
    loans,
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
     SMS NOTIFICATION STATE

     These values are captured inside the transaction but
     the SMS is queued only after the transaction commits.
  ======================================================= */

  let loanPaymentRecipient =
    "";

  let loanPaymentMemberName =
    "";

  let loanPaymentRemainingBalance =
    0;

  let loanWasCleared =
    false;

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
             LOAN MEMBER

             The member is already part of the repayment
             transaction. We only retrieve the fields needed
             for SMS notifications.

             This does NOT alter any financial logic.
          ================================================= */

          const member =
            await db
              .collection<{
                phone?: string;
                firstName?: string;
                middleName?: string;
                lastName?: string;
              }>(
                MEMBERS_COLLECTION,
              )
              .findOne(
                {
                  _id:
                    loan.memberId,
                },
                {
                  session,

                  projection: {
                    phone: 1,
                    firstName: 1,
                    middleName: 1,
                    lastName: 1,
                  },
                },
              );

          loanPaymentRecipient =
            typeof member?.phone ===
            "string"
              ? member.phone.trim()
              : "";

          loanPaymentMemberName =
            [
              member?.firstName,
              member?.middleName,
              member?.lastName,
            ]
              .filter(
                (
                  value,
                ): value is string =>
                  typeof value ===
                    "string" &&
                  value.trim()
                    .length > 0,
              )
              .join(" ");

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

             SMS repayments cannot have a transaction date
             before the loan disbursement date.

             Same-day repayment IS allowed.

               transactionDate < disbursementDate
                 -> rejected

               transactionDate === disbursementDate
                 -> allowed

               transactionDate > disbursementDate
                 -> allowed
          ================================================= */

          if (
            input.source === "sms" &&
            transactionDate <
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

             transactionDate remains a CalendarDate string.
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
             CAPTURE SMS FINANCIAL STATE

             This is the actual outstanding balance AFTER
             this repayment.
          ================================================= */

          loanPaymentRemainingBalance =
            newOutstanding;

          loanWasCleared =
            newStatus ===
            "completed";

          /* =================================================
             UPDATE LOAN

             Optimistic concurrency protection ensures that
             another repayment cannot silently overwrite
             this transaction's financial state.
          ================================================= */

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

    /* =====================================================
       TRANSACTION COMMITTED

       Everything below this point is notification work.

       Financial success has already been committed.
       SMS failures must NEVER roll back the repayment.
    ===================================================== */

    const repayment =
      transactionResult.repayment;

    /* =====================================================
       LOAN PAYMENT RECEIVED SMS
    ===================================================== */

    if (loanPaymentRecipient) {
      try {
        await queueLoanPaymentReceivedSms({
          repaymentId:
            repayment.id,

          loanId:
            repayment.loanId,

          memberId:
            repayment.memberId,

          recipient:
            loanPaymentRecipient,

          memberName:
            loanPaymentMemberName,

          amount:
            repayment.amount,

          remainingBalance:
            loanPaymentRemainingBalance,
        });
      } catch (error) {
        console.error(
          "Failed to queue loan payment received SMS.",
          {
            repaymentId:
              repayment.id,

            transactionReference:
              repayment.transactionReference,

            loanId:
              repayment.loanId,

            memberId:
              repayment.memberId,

            error,
          },
        );
      }
    } else {
      console.warn(
        "Loan payment received SMS skipped: member has no phone number.",
        {
          repaymentId:
            repayment.id,

          transactionReference:
            repayment.transactionReference,

          loanId:
            repayment.loanId,

          memberId:
            repayment.memberId,
        },
      );
    }

    /* =====================================================
       LOAN CLEARED SMS

       Only send this when THIS repayment actually
       completed the loan.

       queueLoanClearedSms() uses the loan ID as part of
       its idempotency key, preventing duplicate clearance
       notifications.
    ===================================================== */

    if (
      loanWasCleared &&
      loanPaymentRecipient
    ) {
      try {
        await queueLoanClearedSms({
          loanId:
            repayment.loanId,

          memberId:
            repayment.memberId,

          recipient:
            loanPaymentRecipient,

          memberName:
            loanPaymentMemberName,
        });
      } catch (error) {
        console.error(
          "Failed to queue loan cleared SMS.",
          {
            repaymentId:
              repayment.id,

            transactionReference:
              repayment.transactionReference,

            loanId:
              repayment.loanId,

            memberId:
              repayment.memberId,

            error,
          },
        );
      }
    } else if (
      loanWasCleared &&
      !loanPaymentRecipient
    ) {
      console.warn(
        "Loan cleared SMS skipped: member has no phone number.",
        {
          repaymentId:
            repayment.id,

          transactionReference:
            repayment.transactionReference,

          loanId:
            repayment.loanId,

          memberId:
            repayment.memberId,
        },
      );
    }

    return repayment;
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