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
 * All loan financial dates, including repayment transactionDate,
 * are stored as exact YYYY-MM-DD calendar strings.
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
  reconcileLoanFines,
  accrueLoanFines,
  accrueAllLoanFines,
  stopLoanFines,
  resumeLoanFines,
  getLoanFines,
} from "@/lib/loans/fines/reconcile";

import {
  getLoanFineTotal,
  getLoanFineSummaryTotal,
  ensureFineIndexes,
  deleteLoanFines,
  getLoanFinesForCalculation,
  getLoanFinesForCalculationByLoanIds,
} from "@/lib/loans/fines/repository";

export {
  reconcileLoanFines,
  accrueLoanFines,
  accrueAllLoanFines,
  stopLoanFines,
  resumeLoanFines,
  getLoanFines,
};

import {
  getOrCreateSavingsAccount,
  createSavingsDeposit,
} from "@/lib/savings/service";

import {
  queueLoanDisbursementSms,
} from "@/lib/sms/outbox/notifications";


import {
  queueLoanClearedSms,
  queueLoanPaymentReceivedSms,
  queueLoanPaymentReminderSms,
  queueSavingsDepositSms,
} from "@/lib/sms/outbox/notifications";

import type {
  CreateLoanInput,
  CreateLoanRepaymentInput,
  CreateLoanWaiverInput,
  Loan,
  LoanActor,
  LoanAssessment,
  LoanAuditEntry,
  LoanRepayment,
  LoanSettings,
  LoanStatus,
  LoanWaiver,
  LoanGuarantor,
  LoanType,
} from "./types";
import type { WeeklyRepaymentBreakdownPeriod } from "@/lib/loans/types";

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
  await ensureFineIndexes();

  const {
    loans,
    settings,
    repayments,
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
    8,

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
 * Canonical repayment transactionDate values are stored as
 * YYYY-MM-DD strings. Lexical comparison is therefore also
 * chronological comparison.
 *
 * A legacy Date branch is retained so older repayment records
 * do not disappear from historical calculations.
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

  const { repayments } =
    await getCollections();

  const legacyCutoffStart =
    calendarDateToKenyanStartDate(
      asOfDate,
    );

  const legacyCutoffEnd =
    new Date(
      legacyCutoffStart.getTime() +
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

              $or: [
                {
                  transactionDate: {
                    $lte: asOfDate,
                  },
                },

                {
                  transactionDate: {
                    $type: "date",
                    $lte: legacyCutoffEnd,
                  },
                },
              ],
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

/**
 * Suspend a member inside an existing MongoDB transaction.
 *
 * Returns true only when this call actually changes the
 * member from a non-suspended status to suspended.
 */
async function suspendMemberInSession(
  db: Db,
  memberId: ObjectId,
  session: ClientSession,
  actor: LoanActor = SYSTEM_ACTOR,
): Promise<boolean> {
  const members =
    db.collection<{
      status?: string;
      updatedAt?: string;
      updatedBy?: string;
    }>(MEMBERS_COLLECTION);

  const existing =
    await members.findOne(
      {
        _id:
          memberId,
      },
      {
        session,
        projection: {
          status: 1,
        },
      },
    );

  if (!existing) {
    throw new Error(
      "Member not found.",
    );
  }

  if (
    existing.status ===
    "suspended"
  ) {
    return false;
  }

  const now =
    new Date().toISOString();

  const result =
    await members.updateOne(
      {
        _id:
          memberId,

        status: {
          $ne:
            "suspended",
        },
      },
      {
        $set: {
          status:
            "suspended",

          updatedAt:
            now,

          updatedBy:
            actor.email ||
            actor.name,
        },
      },
      {
        session,
      },
    );

  if (
    result.matchedCount ===
    0
  ) {
    throw new Error(
      "Member suspension failed.",
    );
  }

  return true;
}

/**
 * Process loans whose contractual end date has been reached
 * or passed and that still have an outstanding core balance.
 */
export async function processExpiredLoans(
  asOfDate: Date = new Date(),
): Promise<number> {
  if (!isValidDate(asOfDate)) {
    throw new Error(
      "Invalid as-of date.",
    );
  }

  const today =
    dateToKenyanCalendarDate(
      asOfDate,
    );

  const {
    client,
    db,
    loans,
  } = await getCollections();

  const candidates =
    await loans
      .find(
        {
          status: {
            $in: [
              "pending",
              "active",
            ],
          },

          endDate: {
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

  let suspendedMembers =
    0;

  for (
    const candidate
      of candidates
  ) {
    if (
      !candidate._id
    ) {
      continue;
    }

    const session =
      client.startSession();

    try {
      const suspended =
        await session.withTransaction(
          async () => {
            const loan =
              await loans.findOne(
                {
                  _id:
                    candidate._id,
                },
                {
                  session,
                },
              );

            if (
              !loan ||
              !loan._id ||
              !loan.memberId
            ) {
              return false;
            }

            if (
              loan.status !==
                "pending" &&
              loan.status !==
                "active"
            ) {
              return false;
            }

            if (
              loan.endDate >
              today
            ) {
              return false;
            }

            const amountPaid =
              await getLoanPaidTotal(
                loan._id,
                session,
              );

            const outstandingBalance =
              calculateFinalOutstanding(
                loan.principal,
                loan.interestAmount,
                amountPaid,
              );

            if (
              outstandingBalance <=
              0
            ) {
              return false;
            }

            return suspendMemberInSession(
              db,
              loan.memberId,
              session,
              SYSTEM_ACTOR,
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

      if (suspended) {
        suspendedMembers += 1;
      }
    } catch (error) {
      console.error(
        `[LOAN EXPIRY] Failed to process loan ${candidate._id.toString()}:`,
        error,
      );
    } finally {
      await session.endSession();
    }
  }

  return suspendedMembers;
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

            const waived =
              await getLoanWaivedFineTotal(
                previous._id,
                session,
              );

            const outstanding =
              calculateFinalOutstanding(
                previous.principal,
                previous.interestAmount,
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


/* =========================================================
   CONTRACTUAL REPAYMENT PERIOD
========================================================= */

/**
 * Builds exactly one contractual repayment period.
 *
 * Contractual schedule rules:
 *
 * 1. The first period starts on loan.disbursementDate.
 * 2. Each normal period spans repaymentCycleDays.
 * 3. No period may begin on or after loan.endDate.
 * 4. If loan.endDate falls inside a normal cycle, that cycle
 *    becomes the final contractual period and is clipped to
 *    loan.endDate.
 *
 * Example:
 *
 *   disbursement = 2026-09-14
 *   cycle        = 7 days
 *   endDate      = 2026-10-03
 *
 *   Period 1:
 *     2026-09-14 -> 2026-09-21
 *
 *   Period 2:
 *     2026-09-21 -> 2026-09-28
 *
 *   Period 3:
 *     2026-09-28 -> 2026-10-03
 *
 *   There is no Period 4.
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

  const loanEndDate =
    normalizeLoanCalendarDate(
      loan.endDate,
      "loan.endDate",
      loan.loanNumber,
    );

  if (
    loanEndDate <
    disbursementDate
  ) {
    throw new Error(
      `Loan end date cannot be before disbursement date for loan ${loan.loanNumber}.`,
    );
  }

  const periodStart =
    addCalendarDays(
      disbursementDate,
      (
        periodNumber - 1
      ) * cycleDays,
    );

  /*
   * loan.endDate is the hard contractual boundary.
   *
   * A period beginning exactly on loan.endDate does not
   * exist.
   */
  if (
    periodStart >=
    loanEndDate
  ) {
    throw new Error(
      `Assessment period ${periodNumber} starts on or after the contractual loan end date for loan ${loan.loanNumber}.`,
    );
  }

  const normalPeriodEnd =
    addCalendarDays(
      periodStart,
      cycleDays,
    );

  /*
   * The final contractual period may be shorter than the
   * normal repayment cycle.
   */
  const periodEnd =
    normalPeriodEnd >
    loanEndDate
      ? loanEndDate
      : normalPeriodEnd;

  return {
    periodNumber,

    periodStart,

    periodEnd,
  };
}


/**
 * Returns the maximum number of contractual repayment periods
 * belonging to the loan.
 *
 * A period belongs to the contractual schedule only when its
 * periodStart is strictly before loan.endDate.
 */
function getMaximumContractualPeriod(
  loan: LoanDocument,
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

  const loanEndDate =
    normalizeLoanCalendarDate(
      loan.endDate,
      "loan.endDate",
      loan.loanNumber,
    );

  if (
    loanEndDate <
    disbursementDate
  ) {
    throw new Error(
      `Loan end date cannot be before disbursement date for loan ${loan.loanNumber}.`,
    );
  }

  let maximumPeriod =
    0;

  for (;;) {
    const periodStart =
      addCalendarDays(
        disbursementDate,
        maximumPeriod *
          cycleDays,
      );

    if (
      periodStart >=
      loanEndDate
    ) {
      break;
    }

    maximumPeriod++;
  }

  return maximumPeriod;
}


/**
 * Returns the number of contractual repayment periods whose
 * actual periodEnd has passed or reached the supplied calendar
 * date.
 *
 * IMPORTANT:
 *
 * Completion is determined from getAssessmentPeriod().periodEnd.
 *
 * We do NOT calculate:
 *
 *   Math.floor(elapsedDays / cycleDays)
 *
 * because the final contractual period may be shorter than the
 * normal repayment cycle.
 *
 * Example:
 *
 *   2026-09-14 -> 2026-09-21
 *   2026-09-21 -> 2026-09-28
 *   2026-09-28 -> 2026-10-03
 *
 * On 2026-10-03:
 *
 *   latestCompletedPeriod = 3
 */
function getLatestDueAssessmentPeriodForCalendarDate(
  loan: LoanDocument,
  asOfCalendarDate: CalendarDate,
): number {
  assertCalendarDate(
    asOfCalendarDate,
    "as-of calendar date",
  );

  const disbursementDate =
    normalizeLoanCalendarDate(
      loan.disbursementDate,
      "loan.disbursementDate",
      loan.loanNumber,
    );

  if (
    asOfCalendarDate <
    disbursementDate
  ) {
    return 0;
  }

  const maximumContractualPeriod =
    getMaximumContractualPeriod(
      loan,
    );
    

  if (
    maximumContractualPeriod <=
    0
  ) {
    return 0;
  }

  let latestCompletedPeriod =
    0;

  for (
    let periodNumber = 1;
    periodNumber <=
    maximumContractualPeriod;
    periodNumber++
  ) {
    const period =
      getAssessmentPeriod(
        loan,
        periodNumber,
      );

    /*
     * A repayment period becomes historical/closed when its
     * contractual end date has arrived.
     */
    if (
      period.periodEnd <=
      asOfCalendarDate
    ) {
      latestCompletedPeriod =
        periodNumber;

      continue;
    }

    /*
     * Periods are chronological. Once one period has not
     * completed, none of the later periods can have completed.
     */
    break;
  }

  return latestCompletedPeriod;
}


/**
 * Returns the number of fully completed contractual repayment
 * periods for a real timestamp.
 *
 * The timestamp is converted once to the Kenyan calendar date.
 * Financial schedule calculations remain calendar-date based.
 */
function getLatestDueAssessmentPeriod(
  loan: LoanDocument,
  asOfDate: Date,
): number {
  if (
    !isValidDate(
      asOfDate,
    )
  ) {
    throw new Error(
      "Invalid as-of date.",
    );
  }

  return getLatestDueAssessmentPeriodForCalendarDate(
    loan,
    dateToKenyanCalendarDate(
      asOfDate,
    ),
  );
}


/* =========================================================
   WEEKLY REPAYMENT BREAKDOWN TYPES
========================================================= */



type WeeklyRepaymentAllocation = {
  /*
   * Stable response-only ordering.
   */
  allocationNumber: number;

  /*
   * Identifies the original repayment within this calculation.
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
   * Amount from the same repayment still available after
   * this allocation.
   */
  remainingPayment: number;

  /*
   * True when this allocation completely cleared the
   * installment and some money continued to the next
   * contractual installment.
   */
  carriedForward: boolean;
};


type WeeklyRepaymentSurplus = {
  paymentSequence: number;

  paymentDate: CalendarDate;

  paymentAmount: number;

  /*
   * Amount that could not be allocated to any currently
   * relevant contractual installment.
   */
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

  totalFines: number;

  periods: WeeklyRepaymentBreakdownPeriod[];

  allocations: WeeklyRepaymentAllocation[];

  surpluses: WeeklyRepaymentSurplus[];
};


/* =========================================================
   WEEKLY REPAYMENT BALANCE CALCULATION
========================================================= */

/**
 * Calculates the current contractual repayment position.
 *
 * This function deliberately separates:
 *
 * 1. HISTORICAL PERIOD DATA
 *    ----------------------
 *    Persisted assessment values:
 *
 *      - paymentsDuringPeriod
 *      - installmentShortfall
 *      - fineAmount
 *
 *    These are immutable historical facts once the period
 *    has been closed.
 *
 * 2. CURRENT ALLOCATION DATA
 *    -----------------------
 *    Current chronological allocation of all repayments:
 *
 *      - allocated
 *      - balance
 *
 *    These may change when later repayments are received.
 *
 * 3. LOAN OUTSTANDING BALANCE
 *    ------------------------
 *    loan.outstandingBalance is the final contractual truth
 *    for the amount still owed on the loan.
 *
 *    IMPORTANT:
 *
 *    The period allocation engine may temporarily show all
 *    currently-built periods as fully allocated because
 *    repayments can be allocated against future installments.
 *
 *    That must NEVER cause the overall weekly repayment
 *    balance to become zero while the loan still has an
 *    outstanding balance.
 *
 *
 * Example:
 *
 *   Total contractual loan balance: 21,000
 *   Amount paid:                    16,800
 *   Outstanding balance:             4,200
 *
 *   Even if FIFO allocation has allocated the 16,800 across
 *   all periods currently built, the weekly repayment balance
 *   MUST still be at least 4,200.
 *
 *
 * CONTRACTUAL SCHEDULE RULES
 * ---------------------------------------------------------
 *
 * 1. Periods begin on loan.disbursementDate.
 * 2. No period begins on or after loan.endDate.
 * 3. The final period may be shorter than repaymentCycleDays.
 * 4. No installment exists beyond loan.endDate.
 * 5. Repayments are processed chronologically.
 * 6. Repayments are allocated oldest outstanding period first.
 * 7. A repayment may clear multiple periods.
 * 8. No period balance can become negative.
 * 9. Historical assessment values are never recalculated here.
 * 10. Historical fines are read from persisted loanFines.
 * 11. Fines are completely excluded from repayment balances.
 * 12. Excess repayment is returned as surplus.
 * 13. loan.outstandingBalance is the final minimum truth for
 *     the overall outstanding contractual balance.
 * 14. weeklyRepaymentBalance MUST NEVER be zero while
 *     loan.outstandingBalance is greater than zero.
 *
 *
 * The returned breakdown is response-only and is not persisted.
 */

function calculateWeeklyRepaymentBalance(
  loan: LoanDocument,
  assessments: Array<{
    periodNumber: number;
    periodStart: CalendarDate;
    periodEnd: CalendarDate;
    expectedInstallment?: unknown;
    paymentsDuringPeriod?: unknown;
    installmentShortfall?: unknown;
    fineAmount?: unknown;
  }>,
  repayments: Array<{
    amount: unknown;
    transactionDate: unknown;
  }>,
  fines: Array<{
    periodNumber: number;
    amount?: unknown;
    fineRate?: unknown;
    periodStart?: CalendarDate;
    periodEnd?: CalendarDate;
    expectedInstallment?: unknown;
    paymentsDuringPeriod?: unknown;
    installmentShortfall?: unknown;
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
  /* =========================================================
     BASIC LOAN SETTINGS
  ========================================================= */

  if (!isValidDate(asOfDate)) {
    throw new Error("Invalid as-of date.");
  }

  const disbursementDate =
    normalizeLoanCalendarDate(
      loan.disbursementDate,
      "loan.disbursementDate",
      loan.loanNumber,
    );

  const loanEndDate =
    normalizeLoanCalendarDate(
      loan.endDate,
      "loan.endDate",
      loan.loanNumber,
    );

  const today =
    dateToKenyanCalendarDate(asOfDate);

  if (loanEndDate < disbursementDate) {
    throw new Error(
      `Loan end date cannot be before disbursement date for loan ${loan.loanNumber}.`,
    );
  }

  const installmentAmount = money(
    Math.max(
      0,
      Number(loan.installmentAmount ?? 0),
    ),
  );

  const cycleDays =
    normalizeCycleDays(
      loan.repaymentCycleDays,
    );

  /* =========================================================
     LOAN STATE

     IMPORTANT:

     loan.outstandingBalance is the authoritative overall
     contractual balance.

     If this value is greater than zero, the loan still owes
     money regardless of:
       - current date
       - loan end date
       - future installment allocation
       - historical period status
  ========================================================= */

  const loanOutstandingBalance = money(
    Math.max(
      0,
      Number(loan.outstandingBalance ?? 0),
    ),
  );

  const loanIsOver =
    loanOutstandingBalance <= 0;

  /* =========================================================
     CONTRACTUAL PERIOD LIMIT
  ========================================================= */

  const maximumContractualPeriod =
    getMaximumContractualPeriod(loan);

  if (maximumContractualPeriod <= 0) {
    /*
     * Even if there are no contractual periods available,
     * never hide a real outstanding loan balance.
     */
    const fallbackBalance =
      loanIsOver
        ? 0
        : loanOutstandingBalance;

    const emptyBreakdown:
      WeeklyRepaymentBreakdown = {
      installmentAmount,

      cycleDays,

      latestCompletedPeriod: 0,

      currentPeriodNumber: 0,

      completedBalance: 0,

      currentBalance: fallbackBalance,

      totalBalance: fallbackBalance,

      totalFines: 0,

      periods: [],

      allocations: [],

      surpluses: [],
    };

    return {
      completedInstallmentBalance: 0,

      currentInstallmentBalance:
        fallbackBalance,

      weeklyRepaymentBalance:
        fallbackBalance,

      currentPeriodNumber: 0,

      weeklyRepaymentBreakdown:
        emptyBreakdown,

      loanPaymentReminder: null,
    };
  }

  /* =========================================================
     PERIOD STATUS
  ========================================================= */

  const latestCompletedPeriod =
    Math.min(
      Math.max(
        0,
        getLatestDueAssessmentPeriodForCalendarDate(
          loan,
          today,
        ),
      ),
      maximumContractualPeriod,
    );

  /*
   * This is the period that would normally be considered
   * current based purely on today's contractual date.
   *
   * It may later roll forward if this period has already been
   * fully paid and another contractual period exists.
   */
  const baseCurrentPeriodNumber =
    latestCompletedPeriod >=
    maximumContractualPeriod
      ? maximumContractualPeriod
      : latestCompletedPeriod + 1;

  /* =========================================================
     EMPTY BREAKDOWN FACTORY
  ========================================================= */

  const createEmptyBreakdown =
    (
      effectiveCurrentPeriodNumber =
        baseCurrentPeriodNumber,
    ): WeeklyRepaymentBreakdown => ({
      installmentAmount,

      cycleDays,

      latestCompletedPeriod,

      currentPeriodNumber:
        effectiveCurrentPeriodNumber,

      completedBalance: 0,

      currentBalance: 0,

      totalBalance: 0,

      totalFines: 0,

      periods: [],

      allocations: [],

      surpluses: [],
    });

  if (installmentAmount <= 0) {
    /*
     * Even when installmentAmount is unavailable, an actual
     * outstanding loan balance must still be visible.
     */
    const fallbackBalance =
      loanIsOver
        ? 0
        : loanOutstandingBalance;

    const breakdown =
      createEmptyBreakdown();

    breakdown.currentBalance =
      fallbackBalance;

    breakdown.totalBalance =
      fallbackBalance;

    return {
      completedInstallmentBalance: 0,

      currentInstallmentBalance:
        fallbackBalance,

      weeklyRepaymentBalance:
        fallbackBalance,

      currentPeriodNumber:
        baseCurrentPeriodNumber,

      weeklyRepaymentBreakdown:
        breakdown,

      loanPaymentReminder: null,
    };
  }

  /* =========================================================
     ASSESSMENT LOOKUP

     Assessments may provide the persisted contractual
     installment amount for closed periods.

     IMPORTANT:

     Assessments are NOT authoritative for:

       - historical paid amount
       - historical shortfall
       - historical fine

     The repayment ledger is authoritative for actual
     repayment timing and amounts.

     loanFines is authoritative for historical fines.
  ========================================================= */

  const assessmentByPeriod =
    new Map<
      number,
      {
        expectedInstallment: number;
        paymentsDuringPeriod: number;
        installmentShortfall: number;
        fineAmount: number;
      }
    >();

  for (const assessment of assessments) {
    const periodNumber =
      Number(assessment.periodNumber);

    if (
      !Number.isInteger(periodNumber) ||
      periodNumber <= 0
    ) {
      continue;
    }

    const expectedInstallment =
      money(
        Math.max(
          0,
          Number(
            assessment.expectedInstallment ??
              installmentAmount,
          ),
        ),
      );

    const paymentsDuringPeriod =
      money(
        Math.max(
          0,
          Number(
            assessment.paymentsDuringPeriod ??
              0,
          ),
        ),
      );

    const installmentShortfall =
      money(
        Math.max(
          0,
          Number(
            assessment.installmentShortfall ??
              0,
          ),
        ),
      );

    const fineAmount =
      money(
        Math.max(
          0,
          Number(
            assessment.fineAmount ??
              0,
          ),
        ),
      );

    assessmentByPeriod.set(
      periodNumber,
      {
        expectedInstallment,

        paymentsDuringPeriod,

        installmentShortfall,

        fineAmount,
      },
    );
  }

  /* =========================================================
     FINE LOOKUP

     loanFines is the authoritative source for historical
     installment fines.

     IMPORTANT:

     We preserve the complete persisted historical fine
     snapshot.

     We do NOT calculate or infer the fine here.

     The fine snapshot contains:

       - amount
       - rate
       - expected installment
       - payments during period
       - historical shortfall
  ========================================================= */

  const fineByPeriod =
    new Map<
      number,
      {
        amount: number;
        fineRate: number;
        expectedInstallment: number;
        paymentsDuringPeriod: number;
        installmentShortfall: number;
        periodStart?: CalendarDate;
        periodEnd?: CalendarDate;
      }
    >();

  for (const fine of fines) {
    const periodNumber =
      Number(fine.periodNumber);

    if (
      !Number.isInteger(periodNumber) ||
      periodNumber <= 0
    ) {
      continue;
    }

    const amount =
      money(
        Math.max(
          0,
          Number(fine.amount ?? 0),
        ),
      );

    const fineRate =
      Number(fine.fineRate ?? 0);

    const expectedInstallment =
      money(
        Math.max(
          0,
          Number(
            fine.expectedInstallment ?? 0,
          ),
        ),
      );

    const paymentsDuringPeriod =
      money(
        Math.max(
          0,
          Number(
            fine.paymentsDuringPeriod ?? 0,
          ),
        ),
      );

    const installmentShortfall =
      money(
        Math.max(
          0,
          Number(
            fine.installmentShortfall ?? 0,
          ),
        ),
      );

    fineByPeriod.set(
      periodNumber,
      {
        amount,

        fineRate:
          Number.isFinite(fineRate)
            ? fineRate
            : 0,

        expectedInstallment,

        paymentsDuringPeriod,

        installmentShortfall,

        periodStart:
          fine.periodStart,

        periodEnd:
          fine.periodEnd,
      },
    );
  }

  /* =========================================================
     NORMALIZED REPAYMENTS

     The repayment collection is authoritative for actual
     payment timing and amounts.

     transactionDate is the financial date.

     Boundary rule:

       Period 1:
         >= periodStart
         <= periodEnd

       Period 2+:
         > periodStart
         <= periodEnd

     This prevents a payment exactly on a shared boundary
     from being counted in both periods.
  ========================================================= */

  type NormalizedRepayment = {
    paymentSequence: number;

    amount: number;

    transactionDate: CalendarDate;
  };

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

          const amount =
            Number(
              repayment.amount ?? 0,
            );

          if (
            !Number.isFinite(amount) ||
            amount <= 0
          ) {
            return null;
          }

          if (
            transactionDate <
              disbursementDate ||
            transactionDate >
              today
          ) {
            return null;
          }

          return {
            paymentSequence:
              index + 1,

            amount:
              money(amount),

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
      .sort(
        (a, b) => {
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
        },
      );

  /* =========================================================
     CONTRACTUAL PERIOD MODEL
  ========================================================= */

  type InstallmentPeriod = {
    periodNumber: number;

    periodStart: CalendarDate;

    periodEnd: CalendarDate;

    periodInstallment: number;

    historicalPaidDuringPeriod: number;

    historicalShortfall: number;

    historicalFine: {
      amount: number;
      rate: number;
      expectedInstallment: number;
      paymentsDuringPeriod: number;
      installmentShortfall: number;
    } | null;

    remainingBalance: number;

    amountPaidToPeriod: number;
  };

  const periods:
    InstallmentPeriod[] = [];

  /*
   * Build through ONE period beyond the date-based current
   * period.
   *
   * This gives FIFO allocation somewhere to roll forward
   * when the date-based current period has already been
   * completely paid.
   *
   * The overall outstanding balance is still authoritative
   * for the final weekly repayment amount.
   */
  const periodBuildLimit =
    Math.min(
      maximumContractualPeriod,
      Math.max(
        1,
        baseCurrentPeriodNumber + 1,
      ),
    );

  for (
    let periodNumber = 1;
    periodNumber <= periodBuildLimit;
    periodNumber++
  ) {
    const period =
      getAssessmentPeriod(
        loan,
        periodNumber,
      );

    /*
     * HARD CONTRACTUAL DATE GUARDS
     */
    if (
      period.periodStart >=
      loanEndDate
    ) {
      break;
    }

    if (
      period.periodEnd >
      loanEndDate
    ) {
      throw new Error(
        `Contractual period ${periodNumber} exceeds loan end date for loan ${loan.loanNumber}.`,
      );
    }

    const assessment =
      assessmentByPeriod.get(
        periodNumber,
      );

    const fine =
      fineByPeriod.get(
        periodNumber,
      );

    /* =======================================================
       CONTRACTUAL INSTALLMENT
    ======================================================= */

    const periodInstallment =
      periodNumber <= latestCompletedPeriod
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

    /* =======================================================
       HISTORICAL PAYMENT FACT
    ======================================================= */

    const historicalPaidDuringPeriod =
      periodNumber <= latestCompletedPeriod
        ? money(
            repaymentRecords
              .filter(
                (repayment) => {
                  if (
                    periodNumber === 1
                  ) {
                    return (
                      repayment.transactionDate >=
                        period.periodStart &&
                      repayment.transactionDate <=
                        period.periodEnd
                    );
                  }

                  return (
                    repayment.transactionDate >
                      period.periodStart &&
                    repayment.transactionDate <=
                      period.periodEnd
                  );
                },
              )
              .reduce(
                (
                  total,
                  repayment,
                ) =>
                  money(
                    total +
                      repayment.amount,
                  ),
                0,
              ),
          )
        : 0;

    /* =======================================================
       HISTORICAL SHORTFALL
    ======================================================= */

    const historicalShortfall =
      periodNumber <= latestCompletedPeriod
        ? money(
            Math.max(
              0,
              periodInstallment -
                historicalPaidDuringPeriod,
            ),
          )
        : 0;

    /* =======================================================
       HISTORICAL FINE
    ======================================================= */

    const historicalFine =
      periodNumber <= latestCompletedPeriod &&
      fine &&
      fine.amount > 0
        ? {
            amount:
              money(
                Math.max(
                  0,
                  fine.amount,
                ),
              ),

            rate:
              Number.isFinite(
                fine.fineRate,
              )
                ? fine.fineRate
                : 0,

            expectedInstallment:
              money(
                Math.max(
                  0,
                  fine.expectedInstallment ||
                    periodInstallment,
                ),
              ),

            paymentsDuringPeriod:
              money(
                Math.max(
                  0,
                  fine.paymentsDuringPeriod,
                ),
              ),

            installmentShortfall:
              money(
                Math.max(
                  0,
                  fine.installmentShortfall,
                ),
              ),
          }
        : null;

    periods.push({
      periodNumber,

      periodStart:
        period.periodStart,

      periodEnd:
        period.periodEnd,

      periodInstallment,

      historicalPaidDuringPeriod,

      historicalShortfall,

      historicalFine,

      /*
       * Current allocation starts from the full contractual
       * installment.
       *
       * Historical shortfall is intentionally NOT used here.
       */
      remainingBalance:
        periodInstallment,

      amountPaidToPeriod: 0,
    });
  }

  /* =========================================================
     PAYMENT ALLOCATION
  ========================================================= */

  const allocations:
    WeeklyRepaymentAllocation[] = [];

  const surpluses:
    WeeklyRepaymentSurplus[] = [];

  let allocationNumber = 0;

  for (
    const repayment of repaymentRecords
  ) {
    let remainingPayment =
      money(repayment.amount);

    if (remainingPayment <= 0) {
      continue;
    }

    for (
      const period of periods
    ) {
      if (remainingPayment <= 0) {
        break;
      }

      if (period.remainingBalance <= 0) {
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
        continue;
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

        paymentAmount:
          money(repayment.amount),

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
    }

    if (remainingPayment > 0) {
      surpluses.push({
        paymentSequence:
          repayment.paymentSequence,

        paymentDate:
          repayment.transactionDate,

        paymentAmount:
          money(repayment.amount),

        unusedCredit:
          money(remainingPayment),
      });
    }
  }

  /* =========================================================
     EFFECTIVE CURRENT PERIOD
  ========================================================= */

  let effectiveCurrentPeriodNumber =
    baseCurrentPeriodNumber;

  const baseCurrentPeriod =
    periods.find(
      (period) =>
        period.periodNumber ===
        baseCurrentPeriodNumber,
    );

  const nextContractualPeriod =
    periods.find(
      (period) =>
        period.periodNumber ===
        baseCurrentPeriodNumber + 1,
    );

  if (
    !loanIsOver &&
    baseCurrentPeriod &&
    nextContractualPeriod &&
    baseCurrentPeriod.remainingBalance <=
      0 &&
    baseCurrentPeriodNumber <
      maximumContractualPeriod
  ) {
    effectiveCurrentPeriodNumber =
      baseCurrentPeriodNumber + 1;
  }

  /*
   * Never allow the effective current period to exceed the
   * maximum contractual period.
   */
  effectiveCurrentPeriodNumber =
    Math.min(
      effectiveCurrentPeriodNumber,
      maximumContractualPeriod,
    );

  /* =========================================================
     COMPLETED INSTALLMENT BALANCE
  ========================================================= */

  let completedInstallmentBalance = 0;

  for (
    const period of periods
  ) {
    if (
      period.periodNumber >
      latestCompletedPeriod
    ) {
      continue;
    }

    completedInstallmentBalance =
      money(
        completedInstallmentBalance +
          Math.max(
            0,
            period.remainingBalance,
          ),
      );
  }

  completedInstallmentBalance =
    money(
      Math.max(
        0,
        completedInstallmentBalance,
      ),
    );

  /* =========================================================
     CURRENT INSTALLMENT BALANCE
  ========================================================= */

  let currentInstallmentBalance = 0;

  const currentPeriod =
    periods.find(
      (period) =>
        period.periodNumber ===
        effectiveCurrentPeriodNumber,
    );

  if (loanIsOver) {
    /*
     * The loan has no outstanding contractual balance.
     */
    completedInstallmentBalance = 0;

    currentInstallmentBalance = 0;
  } else if (
    effectiveCurrentPeriodNumber >
      latestCompletedPeriod &&
    currentPeriod
  ) {
    currentInstallmentBalance =
      money(
        Math.max(
          0,
          currentPeriod.remainingBalance,
        ),
      );
  } else {
    currentInstallmentBalance = 0;
  }

  /* =========================================================
     CALCULATED PERIOD BALANCE
  ========================================================= */

  const calculatedWeeklyRepaymentBalance =
    money(
      Math.max(
        0,
        completedInstallmentBalance +
          currentInstallmentBalance,
      ),
    );

  /* =========================================================
     AUTHORITATIVE WEEKLY REPAYMENT BALANCE
     =========================================================

     IMPORTANT:

     The period allocation model can legitimately produce a
     lower value than loan.outstandingBalance when repayments
     have already been allocated into future contractual
     periods that are not currently represented in the
     visible period breakdown.

     Example:

       Loan outstanding:             Ksh 4,200
       Calculated period balance:    Ksh 0

     The loan still owes Ksh 4,200.

     Therefore the overall weekly repayment balance must
     never fall below the persisted loan outstanding balance.

     This also handles loans whose end date has already passed.

     End date does NOT make an unpaid loan balance disappear.

     Only an actual outstanding balance of zero allows the
     weekly repayment balance to become zero.
  ========================================================= */

  const weeklyRepaymentBalance =
    loanIsOver
      ? 0
      : money(
          Math.max(
            calculatedWeeklyRepaymentBalance,
            loanOutstandingBalance,
          ),
        );

  /* =========================================================
     RECONCILE CURRENT BALANCE WITH AUTHORITATIVE BALANCE
     =========================================================

     If the period calculation is lower than the actual loan
     outstanding balance, attach the difference to the current
     contractual balance.

     This keeps:

       completedBalance +
       currentBalance

     consistent with:

       weeklyRepaymentBalance

     without modifying historical period facts or repayment
     allocations.
  ========================================================= */

  if (
    !loanIsOver &&
    weeklyRepaymentBalance >
      calculatedWeeklyRepaymentBalance
  ) {
    const balanceGap =
      money(
        Math.max(
          0,
          weeklyRepaymentBalance -
            calculatedWeeklyRepaymentBalance,
        ),
      );

    currentInstallmentBalance =
      money(
        currentInstallmentBalance +
          balanceGap,
      );
  }

  /* =========================================================
     PERIOD BREAKDOWN
  ========================================================= */

  const breakdownPeriods =
    periods
      .filter(
        (period) =>
          period.periodNumber <=
          effectiveCurrentPeriodNumber,
      )
      .map(
        (
          period,
        ): WeeklyRepaymentBreakdownPeriod => {
          const allocated =
            money(
              Math.max(
                0,
                period.amountPaidToPeriod,
              ),
            );

          const balance =
            money(
              Math.max(
                0,
                period.remainingBalance,
              ),
            );

          const isCompleted =
            period.periodNumber <=
            latestCompletedPeriod;

          let status:
            | "paid"
            | "partial"
            | "current"
            | "unpaid";

          /*
           * CURRENT ALLOCATION HAS PRIORITY.
           *
           * A contractual period can be paid before its due
           * date.
           *
           * Example:
           *
           *   Period 5
           *   Expected: 3,500
           *   Historical paid: 0
           *   Current allocated: 3,500
           *   Current balance: 0
           *
           * That period is PAID even though it was not yet a
           * completed historical period.
           */
          if (balance <= 0) {
            status = "paid";
          } else if (
            isCompleted &&
            allocated > 0
          ) {
            status = "partial";
          } else if (
            period.periodNumber ===
            effectiveCurrentPeriodNumber
          ) {
            status = "current";
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

            installment:
              money(
                period.periodInstallment,
              ),

            /* =============================================
               HISTORICAL FACTS
            ============================================= */

            historical: {
              paidDuringPeriod:
                money(
                  period.historicalPaidDuringPeriod,
                ),

              shortfall:
                money(
                  period.historicalShortfall,
                ),

              fine:
                period.historicalFine
                  ? {
                      amount:
                        money(
                          period
                            .historicalFine
                            .amount,
                        ),

                      rate:
                        Number.isFinite(
                          period
                            .historicalFine
                            .rate,
                        )
                          ? period
                              .historicalFine
                              .rate
                          : 0,

                      expectedInstallment:
                        money(
                          period
                            .historicalFine
                            .expectedInstallment,
                        ),

                      paymentsDuringPeriod:
                        money(
                          period
                            .historicalFine
                            .paymentsDuringPeriod,
                        ),

                      installmentShortfall:
                        money(
                          period
                            .historicalFine
                            .installmentShortfall,
                        ),
                    }
                  : null,
            },

            /* =============================================
               CURRENT ALLOCATION STATE
            ============================================= */

            current: {
              allocated,

              balance,
            },

            status,
          };
        },
      )
      .sort(
        (a, b) =>
          a.periodNumber -
          b.periodNumber,
      );

  /* =========================================================
     TOTAL FINES

     Fines remain completely separate from the contractual
     weekly repayment balance.
  ========================================================= */

  const totalFines =
    money(
      breakdownPeriods.reduce(
        (total, period) =>
          money(
            total +
              Math.max(
                0,
                Number(
                  period.historical.fine
                    ?.amount ?? 0,
                ),
              ),
          ),
        0,
      ),
    );

  /* =========================================================
     SORT ALLOCATIONS
  ========================================================= */

  allocations.sort(
    (a, b) => {
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
    },
  );

  /* =========================================================
     SORT SURPLUSES
  ========================================================= */

  surpluses.sort(
    (a, b) => {
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
    },
  );

  /* =========================================================
     FINAL BREAKDOWN
  ========================================================= */

  const weeklyRepaymentBreakdown:
    WeeklyRepaymentBreakdown = {
    installmentAmount,

    cycleDays,

    latestCompletedPeriod,

    currentPeriodNumber:
      effectiveCurrentPeriodNumber,

    completedBalance:
      completedInstallmentBalance,

    currentBalance:
      currentInstallmentBalance,

    totalBalance:
      weeklyRepaymentBalance,

    totalFines,

    periods:
      breakdownPeriods,

    allocations,

    surpluses,
  };

  /* =========================================================
     PAYMENT REMINDER
  ========================================================= */

  const loanPaymentReminder =
    getLoanPaymentReminderPeriod(
      {
        currentPeriodNumber:
          effectiveCurrentPeriodNumber,

        weeklyRepaymentBreakdown,
      },
      today,
    );

  /* =========================================================
     RETURN
  ========================================================= */

  return {
    completedInstallmentBalance,

    currentInstallmentBalance,

    weeklyRepaymentBalance,

    currentPeriodNumber:
      effectiveCurrentPeriodNumber,

    weeklyRepaymentBreakdown,

    loanPaymentReminder,
  };
}



/* =========================================================
   LOAN PAYMENT REMINDER
========================================================= */

/**
 * Returns the reminder period when today is exactly one
 * calendar day before the current contractual period ends.
 *
 * Historical fines are irrelevant to reminder eligibility.
 */
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
      (
        period,
      ) =>
        period.periodNumber ===
        calculation.currentPeriodNumber,
    );

  if (!currentPeriod) {
    return null;
  }

  /*
   * Once the period has ended it is historical and cannot
   * generate a new current-period reminder.
   */
  if (
    currentPeriod.periodEnd <=
    today
  ) {
    return null;
  }

  /*
   * No reminder is required when the current installment
   * has already been fully allocated.
   */
  if (
    currentPeriod.current.balance <=
    0
  ) {
    return null;
  }

  const reminderDate =
    addCalendarDays(
      currentPeriod.periodEnd,
      -1,
    );

  if (
    today !==
    reminderDate
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
      currentPeriod.current.balance,
  };
}


/* =========================================================
   COMPLETED INSTALLMENT BALANCE
========================================================= */

/**
 * Returns the current contractual weekly repayment balance.
 *
 * This remains the scalar API for callers that only need the
 * numeric balance.
 *
 * The complete contractual calculation is delegated to
 * calculateWeeklyRepaymentBalance().
 *
 * Historical assessment values are read from MongoDB and are
 * not recalculated here.
 */
export async function getCompletedInstallmentBalance(
  loanId: string,
): Promise<number> {
  if (
    typeof loanId !==
      "string" ||
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

        paymentsDuringPeriod: unknown;

        installmentShortfall: unknown;

        fineAmount: unknown;
      }>({
        periodNumber: 1,

        periodStart: 1,

        periodEnd: 1,

        expectedInstallment: 1,

        paymentsDuringPeriod: 1,

        installmentShortfall: 1,

        fineAmount: 1,
      })
      .sort({
        periodNumber: 1,
      })
      .toArray();

  const fineDocuments =
    await getLoanFinesForCalculation(
      objectId,
    );

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
          repayment.amount >
            0,
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

      fineDocuments,

      new Date(),
    );

  return result.weeklyRepaymentBalance;
}
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

  const requestedPage =
    Number(options.page);

  const page =
    Number.isFinite(requestedPage) &&
    requestedPage >= 1
      ? Math.floor(requestedPage)
      : 1;

  const requestedLimit =
    Number(options.limit);

  const limit =
    Number.isFinite(requestedLimit) &&
    requestedLimit >= 1
      ? Math.min(
          100,
          Math.floor(requestedLimit),
        )
      : 25;

  /* =========================================================
     FILTER
  ========================================================= */

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

  if (options.repaymentStatus) {
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
        totalPages: 0,
      };
    }

    filter.memberId =
      createObjectId(
        options.memberId,
      );
  }

  /* =========================================================
     DATE FILTERS
  ========================================================= */

  if (options.repaymentDate) {
    assertCalendarDate(
      options.repaymentDate,
      "repayment date",
    );

    filter.repaymentDate =
      options.repaymentDate;
  }

  if (options.endDate) {
    assertCalendarDate(
      options.endDate,
      "loan end date",
    );

    filter.endDate =
      options.endDate;
  }

  /* =========================================================
     SEARCH
  ========================================================= */

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

  /* =========================================================
     LOAD LOANS
  ========================================================= */

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

  if (
    documents.length === 0
  ) {
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

  const loanIds =
    documents
      .map(
        (document) =>
          document._id,
      )
      .filter(
        (
          id,
        ): id is ObjectId =>
          id instanceof ObjectId,
      );

  /* =========================================================
     MEMBER IDS

     The loan stores memberId.

     The member document stores:

       _id
       membershipNumber
       phone

     We use memberId to resolve
     the correct member.
  ========================================================= */

  const memberIds =
    documents
      .map(
        (document) =>
          document.memberId,
      )
      .filter(
        (
          id,
        ): id is ObjectId =>
          id instanceof ObjectId,
      );

  /* =========================================================
     LOAD MEMBERS

     Only load members belonging
     to the loans on this page.

     Phone number comes from the
     members collection.
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

  const membersById =
    new Map<
      string,
      (typeof memberDocuments)[number]
    >();

  for (
    const member of memberDocuments
  ) {
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

  const assessmentsByLoanId =
    new Map<
      string,
      typeof assessmentDocuments
    >();

  for (
    const assessment of assessmentDocuments
  ) {
    const key =
      assessment.loanId.toString();

    const existing =
      assessmentsByLoanId.get(
        key,
      );

    if (existing) {
      existing.push(
        assessment,
      );
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

  const repaymentsByLoanId =
    new Map<
      string,
      typeof repaymentDocuments
    >();

  for (
    const repayment of repaymentDocuments
  ) {
    const key =
      repayment.loanId.toString();

    const existing =
      repaymentsByLoanId.get(
        key,
      );

    if (existing) {
      existing.push(
        repayment,
      );
    } else {
      repaymentsByLoanId.set(
        key,
        [repayment],
      );
    }
  }

  const fineDocuments =
    loanIds.length > 0
      ? await getLoanFinesForCalculationByLoanIds(
          loanIds,
        )
      : [];

  /* =========================================================
     GROUP FINES
  ========================================================= */

  const finesByLoanId =
    new Map<
      string,
      typeof fineDocuments
    >();

  for (
    const fine of fineDocuments
  ) {
    const key =
      fine.loanId.toString();

    const existing =
      finesByLoanId.get(
        key,
      );

    if (existing) {
      existing.push(fine);
    } else {
      finesByLoanId.set(
        key,
        [fine],
      );
    }
  }

  /* =========================================================
     HYDRATE LOANS
  ========================================================= */

  const hydratedLoans =
    await Promise.all(
      documents.map(
        async (document) => {
          const loan =
            toLoan(document);

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

          const loanFines =
            finesByLoanId.get(
              loanId,
            ) ?? [];

          const result =
            calculateWeeklyRepaymentBalance(
              document,
              loanAssessments,
              loanRepayments,
              loanFines,
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

             We use memberId because it is
             the direct database relationship.
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
                    loanId:
                      loan.id,

                    memberId:
                      loan.memberId,

                    recipient,

                    memberName:
                      loan.memberName,

                    periodNumber:
                      result
                        .loanPaymentReminder
                        .periodNumber,

                    installmentAmountOwed:
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
                    loanId:
                      loan.id,

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
                  loanId:
                    loan.id,

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
        },
      ),
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
    !ObjectId.isValid(id)
  ) {
    return null;
  }

  const {
    loans,
    assessments,
    repayments:
      repaymentCollection,
  } = await getCollections();

  const objectId =
    createObjectId(id);

  const loan =
    await loans.findOne({
      _id: objectId,
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
      loanId: objectId,
    })
    .project<{
      periodNumber: number;
      periodStart: CalendarDate;
      periodEnd: CalendarDate;
      expectedInstallment: unknown;
      paymentsDuringPeriod: unknown;
      installmentShortfall: unknown;
      fineAmount: unknown;
    }>({
      periodNumber: 1,
      periodStart: 1,
      periodEnd: 1,
      expectedInstallment: 1,
      paymentsDuringPeriod: 1,
      installmentShortfall: 1,
      fineAmount: 1,
    })
    .sort({
      periodNumber: 1,
    })
    .toArray();

  const fineDocuments =
    await getLoanFinesForCalculation(
      objectId,
    );

  /* =========================================================
     REPAYMENTS
  ========================================================= */

  const repaymentDocuments =
    await repaymentCollection
      .find({
        loanId: objectId,
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
      fineDocuments,
      new Date(),
    );

  /* =========================================================
     RESPONSE
  ========================================================= */

  return {
    ...toLoan(loan),

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
  } = await getCollections();

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
      loanId: objectId,
    })
    .project<{
      periodNumber: number;
      periodStart: CalendarDate;
      periodEnd: CalendarDate;
      expectedInstallment: unknown;
      paymentsDuringPeriod: unknown;
      installmentShortfall: unknown;
      fineAmount: unknown;
    }>({
      periodNumber: 1,
      periodStart: 1,
      periodEnd: 1,
      expectedInstallment: 1,
      paymentsDuringPeriod: 1,
      installmentShortfall: 1,
      fineAmount: 1,
    })
    .sort({
      periodNumber: 1,
    })
    .toArray();

  const fineDocuments =
    await getLoanFinesForCalculation(
      objectId,
    );

  /* =========================================================
     REPAYMENTS
  ========================================================= */

  const repaymentDocuments =
    await repaymentCollection
      .find({
        loanId: objectId,
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
      fineDocuments,
      new Date(),
    );

  /* =========================================================
     RESPONSE
  ========================================================= */

  return {
    ...toLoan(loan),

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
   ASSESSMENT PERIOD
========================================================= */

async function getPeriodPaymentTotal(
  loanId: ObjectId,
  period: AssessmentPeriod,
  session?: ClientSession,
): Promise<number> {
  const { repayments } =
    await getCollections();

  assertCalendarDate(
    period.periodStart,
    "repayment period start",
  );

  assertCalendarDate(
    period.periodEnd,
    "repayment period end",
  );

  const canonicalDateFilter =
    period.periodNumber === 1
      ? {
          $gte: period.periodStart,
          $lte: period.periodEnd,
        }
      : {
          $gt: period.periodStart,
          $lte: period.periodEnd,
        };

  /*
   * Legacy repayment records may still contain a BSON Date.
   * Keep them visible without changing the canonical storage
   * format used by new records.
   */
  const periodStartDate =
    calendarDateToKenyanStartDate(
      period.periodStart,
    );

  const periodEndStartDate =
    calendarDateToKenyanStartDate(
      period.periodEnd,
    );

  const legacyDateFilter =
    period.periodNumber === 1
      ? {
          $gte: periodStartDate,
          $lte: new Date(
            periodEndStartDate.getTime() +
              24 * 60 * 60 * 1000 -
              1,
          ),
        }
      : {
          $gt: periodStartDate,
          $lte: new Date(
            periodEndStartDate.getTime() +
              24 * 60 * 60 * 1000 -
              1,
          ),
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
              $or: [
                {
                  transactionDate:
                    canonicalDateFilter,
                },
                {
                  transactionDate: {
                    $type: "date",
                    ...legacyDateFilter,
                  },
                },
              ],
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
   ASSESS ONE COMPLETED LOAN PERIOD
========================================================= */

/**
 * Permanently closes one completed repayment period.
 *
 * IMPORTANT:
 *
 * This function has two possible outcomes:
 *
 * 1. Assessment already exists:
 *      return the existing assessment unchanged.
 *
 * 2. Assessment does not exist:
 *      calculate the historical period once and save it.
 *
 * Once an assessment exists, NOTHING about that historical
 * period is recalculated.
 *
 * Later repayments belong to the repayment-allocation layer.
 * They do not rewrite this assessment.
 */
async function assessLoanPeriod(
  loanId: ObjectId,
  periodNumber: number,
  assessmentDate: CalendarDate,
  session: ClientSession,
): Promise<LoanAssessment> {
  const {
    loans,
    assessments,
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

  const period =
    getAssessmentPeriod(
      loan,
      periodNumber,
    );

  assertCalendarDate(
    assessmentDate,
    "assessment date",
  );

  /*
   * A period can only be closed after its actual periodEnd.
   */
  if (
    assessmentDate <
    period.periodEnd
  ) {
    throw new Error(
      "A repayment cycle cannot be assessed before the cycle ends.",
    );
  }

  /*
   * =========================================================
   * CHECK WHETHER THE PERIOD IS ALREADY CLOSED
   * =========================================================
   *
   * THIS MUST HAPPEN BEFORE ANY FINANCIAL CALCULATION.
   *
   * If the assessment exists, the historical period is
   * immutable.
   */
  const existingAssessment =
    await assessments.findOne(
      {
        loanId,
        periodNumber,
      },
      {
        session,
      },
    );

  if (existingAssessment) {
    return toAssessment(
      existingAssessment,
    );
  }

  /*
   * =========================================================
   * OPENING CORE BALANCE
   * =========================================================
   *
   * Snapshot of the loan immediately before this historical
   * period.
   *
   * Fines are deliberately excluded.
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
   * PAYMENTS DURING THIS HISTORICAL PERIOD
   * =========================================================
   *
   * ONLY repayments whose transaction date belongs to this
   * period are counted.
   *
   * A payment made later is irrelevant to this calculation.
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
   * HISTORICAL SHORTFALL
   * =========================================================
   *
   * This is the amount that was actually unpaid when this
   * particular repayment period closed.
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
   * Historical snapshot.
   *
   * Later repayments cannot modify this stored value because
   * the assessment becomes immutable after this point.
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

  const defaulted =
    unpaidInstallment > 0;

  /*
   * Capture the fine rate used at the time this historical
   * period is closed.
   *
   * A future change to loan.fineRate does not modify this
   * historical period.
   */
  const fineRate =
    normalizeRate(
      loan.fineRate,
    );

  const actualFineAmount = 0;

  /*
   * =========================================================
   * BUILD HISTORICAL ASSESSMENT
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

    assessmentDate,

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

  /*
   * =========================================================
   * INSERT HISTORICAL ASSESSMENT ONCE
   * =========================================================
   *
   * DO NOT UPSERT.
   *
   * DO NOT $set an existing assessment.
   *
   * A historical assessment is an immutable record.
   */
  try {
    await assessments.insertOne(
      assessmentDocument,
      {
        session,
      },
    );
  } catch (error) {
    /*
     * Another transaction may have closed the same period
     * concurrently.
     *
     * Re-read the existing historical assessment and return
     * it unchanged.
     */
    if (
      !isDuplicateKeyError(
        error,
      )
    ) {
      throw error;
    }

    const concurrentAssessment =
      await assessments.findOne(
        {
          loanId,
          periodNumber,
        },
        {
          session,
        },
      );

    if (!concurrentAssessment) {
      throw error;
    }

    return toAssessment(
      concurrentAssessment,
    );
  }

  /*
   * =========================================================
   * AUDIT HISTORICAL ASSESSMENT
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
   * =========================================================
   * DEFAULT AUDIT
   * =========================================================
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
   CLOSE COMPLETED LOAN PERIODS
========================================================= */

/**
 * Closes every contractual repayment period whose end date
 * has passed as of the supplied calendar date.
 *
 * A period is closed exactly once.
 *
 * Existing assessments are NEVER recalculated.
 */
async function closeCompletedLoanPeriods(
  loanId: ObjectId,
  asOfCalendarDate: CalendarDate,
  session: ClientSession,
): Promise<number> {
  assertCalendarDate(
    asOfCalendarDate,
    "as-of calendar date",
  );

  const {
    loans,
    assessments,
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

  /*
   * No new historical periods are created for cancelled or
   * completed loans.
   *
   * Existing historical records remain untouched.
   */
  if (
    loan.status === "cancelled" ||
    loan.status === "completed"
  ) {
    return 0;
  }

  const disbursementDate =
    normalizeLoanCalendarDate(
      loan.disbursementDate,
      "loan.disbursementDate",
      loan.loanNumber,
    );

  const loanEndDate =
    normalizeLoanCalendarDate(
      loan.endDate,
      "loan.endDate",
      loan.loanNumber,
    );

  const cycleDaysRaw =
    Number(
      loan.repaymentCycleDays ?? 7,
    );

  const cycleDays =
    Number.isInteger(
      cycleDaysRaw,
    ) &&
    cycleDaysRaw > 0
      ? cycleDaysRaw
      : 7;

  if (
    loanEndDate <=
    disbursementDate
  ) {
    return 0;
  }

  /*
   * Determine the number of contractual periods.
   */
  let maximumContractualPeriod =
    0;

  for (;;) {
    const periodStart =
      addCalendarDays(
        disbursementDate,
        maximumContractualPeriod *
          cycleDays,
      );

    if (
      periodStart >=
      loanEndDate
    ) {
      break;
    }

    maximumContractualPeriod++;
  }

  if (
    maximumContractualPeriod <=
    0
  ) {
    return 0;
  }

  let newlyClosedPeriods =
    0;

  /*
   * Examine each installment independently.
   */
  for (
    let periodNumber = 1;
    periodNumber <=
    maximumContractualPeriod;
    periodNumber++
  ) {
    const period =
      getAssessmentPeriod(
        loan,
        periodNumber,
      );

    /*
     * Defensive contractual boundary.
     */
    if (
      period.periodStart >=
      loanEndDate
    ) {
      break;
    }

    const boundedPeriodEnd =
      period.periodEnd >
      loanEndDate
        ? loanEndDate
        : period.periodEnd;

    /*
     * THE PERIOD ITSELF DETERMINES WHETHER IT IS CLOSED.
     *
     * If periodEnd is still in the future, stop because all
     * later contractual periods are also still open.
     */
    if (
      boundedPeriodEnd >
      asOfCalendarDate
    ) {
      break;
    }

    /*
     * Existing assessment = historical period already closed.
     *
     * Do absolutely nothing to it.
     */
    const existingAssessment =
      await assessments.findOne(
        {
          loanId,
          periodNumber,
        },
        {
          session,
        },
      );

    if (existingAssessment) {
      continue;
    }

    /*
     * Period has ended and has never been closed.
     *
     * Close it once.
     */
    await assessLoanPeriod(
      loanId,
      periodNumber,
      boundedPeriodEnd,
      session,
    );

    newlyClosedPeriods++;
  }

  return newlyClosedPeriods;
}
/**
 * =========================================================
 * HISTORICAL LOAN RESOLUTION FOR REPAYMENTS
 * =========================================================
 *
 * For SMS repayments, loan ownership is determined from the
 * financial event time, NOT from the loan that happens to be
 * active when Android/API processes the SMS.
 *
 * Required historical rules:
 *
 *   transactionAt >= authorizedAt
 *   transactionDate >= disbursementDate
 *
 * Example:
 *
 *   LOAN-A authorized:  2026-09-05 09:00
 *   payment occurred:  2026-09-05 10:00
 *   LOAN-A cleared:    2026-09-05 11:00
 *   LOAN-B authorized: 2026-09-05 12:00
 *
 * If Android replays the 10:00 payment at 14:00,
 * it must still resolve to LOAN-A.
 *
 * It must NEVER resolve to LOAN-B merely because LOAN-B
 * is the current active loan.
 * =========================================================
 */

async function resolveLoanForRepayment(
  input: CreateLoanRepaymentInput,
  session: ClientSession,
): Promise<LoanDocument> {
  const { loans } = await getCollections();

  /* =======================================================
     EXPLICIT LOAN ID
  ======================================================= */

  if (input.loanId) {
    if (!ObjectId.isValid(input.loanId)) {
      throw new Error("Invalid loan ID.");
    }

    const loan = await loans.findOne(
      {
        _id: createObjectId(input.loanId),
      },
      {
        session,
      },
    );

    if (!loan) {
      throw new Error("Loan not found.");
    }

    /*
     * For SMS repayments, an explicitly supplied loan must
     * still pass the historical timestamp checks.
     *
     * Do not allow an explicit loan ID to bypass replay
     * protection.
     */
    if (input.source === "sms") {
      /* -----------------------------------------------------
         EXACT BANK TRANSACTION TIMESTAMP
      ----------------------------------------------------- */

      if (!input.transactionAt) {
        throw new Error(
          "SMS repayment requires the exact bank transaction timestamp.",
        );
      }

      const transactionAt =
        input.transactionAt instanceof Date
          ? input.transactionAt.getTime()
          : NaN;

      if (!Number.isFinite(transactionAt)) {
        throw new Error(
          "SMS repayment transaction timestamp is invalid.",
        );
      }

      /* -----------------------------------------------------
         LOAN AUTHORIZATION TIMESTAMP
      ----------------------------------------------------- */

      if (
        loan.authorizedAt === undefined ||
        loan.authorizedAt === null
      ) {
        throw new Error(
          `Loan "${loan.loanNumber}" has no authorization timestamp. Automatic SMS repayment processing is blocked.`,
        );
      }

      const authorizedAt =
        loan.authorizedAt instanceof Date
          ? loan.authorizedAt.getTime()
          : new Date(
              loan.authorizedAt as string | number,
            ).getTime();

      if (!Number.isFinite(authorizedAt)) {
        throw new Error(
          `Loan "${loan.loanNumber}" has an invalid authorization timestamp. Automatic SMS repayment processing is blocked.`,
        );
      }

      /*
       * The bank transaction must happen at or after the
       * loan was authorized.
       *
       * IMPORTANT:
       * Use transactionAt, NOT the Android SMS receipt time.
       */
      if (transactionAt < authorizedAt) {
        throw new Error(
          "SMS_REPAYMENT_RECEIVED_BEFORE_LOAN_AUTHORIZATION",
        );
      }

      /* -----------------------------------------------------
         LOAN DISBURSEMENT DATE
      ----------------------------------------------------- */

      const disbursementDate =
        normalizeLoanCalendarDate(
          loan.disbursementDate,
          `Loan "${loan.loanNumber}" disbursement date`,
        );

      /*
       * The financial transaction date cannot be before the
       * loan's disbursement date.
       */
      if (input.transactionDate < disbursementDate) {
        throw new Error(
          "SMS_REPAYMENT_BEFORE_DISBURSEMENT",
        );
      }
    }

    return loan;
  }

  /* =======================================================
     MEMBER IS REQUIRED WHEN LOAN ID IS NOT PROVIDED
  ======================================================= */

  if (!input.memberId) {
    throw new Error(
      "A loan ID or member ID is required.",
    );
  }

  if (!ObjectId.isValid(input.memberId)) {
    throw new Error("Invalid member ID.");
  }

  const memberId = createObjectId(input.memberId);

  /* =======================================================
     SMS REPAYMENT
     =======================================================
   *
   * SMS requires HISTORICAL loan resolution.
   *
   * We deliberately do NOT resolve against only the current
   * active loan.
   *
   * Example:
   *
   *   09:00 payment SMS
   *   10:00 old loan cleared
   *   10:05 new loan created
   *
   * A replay of the 09:00 SMS must not suddenly become a
   * payment against the new loan.
   */

  if (input.source === "sms") {
    /* -----------------------------------------------------
       EXACT BANK TRANSACTION TIMESTAMP
    ----------------------------------------------------- */

    if (!input.transactionAt) {
      throw new Error(
        "SMS repayment requires the exact bank transaction timestamp.",
      );
    }

    const transactionAt =
      input.transactionAt instanceof Date
        ? input.transactionAt.getTime()
        : NaN;

    if (!Number.isFinite(transactionAt)) {
      throw new Error(
        "SMS repayment transaction timestamp is invalid.",
      );
    }

    /* -----------------------------------------------------
       GET ALL HISTORICAL LOANS
    -----------------------------------------------------
     *
     * Do NOT use:
     *
     *   status: "active"
     *
     * because the loan receiving the payment may already
     * have been completed by the time the SMS is replayed.
     */

    const historicalLoans = await loans
      .find(
        {
          memberId,
        },
        {
          session,
        },
      )
      .sort({
        createdAt: 1,
        _id: 1,
      })
      .toArray();

    if (historicalLoans.length === 0) {
      throw new Error(
        "No historical loan could be found for this member.",
      );
    }

    /* =====================================================
       FIND HISTORICALLY ELIGIBLE LOANS
    ===================================================== */

    const eligibleLoans = historicalLoans.filter(
      (loan) => {
        /* -------------------------------------------------
           1. LOAN AUTHORIZATION TIMESTAMP
        -------------------------------------------------
         *
         * The bank transaction must have happened at or
         * after this loan was authorized.
         */

        if (
          loan.authorizedAt === undefined ||
          loan.authorizedAt === null
        ) {
          return false;
        }

        const authorizedAt =
          loan.authorizedAt instanceof Date
            ? loan.authorizedAt.getTime()
            : new Date(
                loan.authorizedAt as string | number,
              ).getTime();

        if (!Number.isFinite(authorizedAt)) {
          return false;
        }

        if (transactionAt < authorizedAt) {
          return false;
        }

        /* -------------------------------------------------
           2. LOAN DISBURSEMENT DATE
        -------------------------------------------------
         *
         * The financial transaction cannot predate the
         * loan's disbursement date.
         */

        let disbursementDate: CalendarDate;

        try {
          disbursementDate =
            normalizeLoanCalendarDate(
              loan.disbursementDate,
              `Loan "${loan.loanNumber}" disbursement date`,
            );
        } catch {
          /*
           * A malformed historical loan date must never make
           * the SMS resolver guess.
           */
          return false;
        }

        if (
          input.transactionDate <
          disbursementDate
        ) {
          return false;
        }

        return true;
      },
    );

    /* =====================================================
       NO HISTORICAL MATCH
    ===================================================== */

    if (eligibleLoans.length === 0) {
      throw new Error(
        "SMS_REPAYMENT_NO_HISTORICALLY_ELIGIBLE_LOAN",
      );
    }

    /* =====================================================
       MULTIPLE HISTORICAL MATCHES
    =====================================================
     *
     * NEVER GUESS.
     *
     * If multiple loans were legitimately eligible at the
     * exact transaction timestamp, the SMS does not contain
     * enough information for this resolver to safely choose
     * one.
     */

    if (eligibleLoans.length > 1) {
      const loanNumbers = eligibleLoans
        .map(
          (loan) =>
            loan.loanNumber,
        )
        .filter(
          (
            value,
          ): value is string =>
            typeof value === "string" &&
            value.trim().length > 0,
        )
        .join(", ");

      throw new Error(
        `SMS_REPAYMENT_AMBIGUOUS_LOAN:${loanNumbers}`,
      );
    }

    /* =====================================================
       EXACTLY ONE HISTORICAL MATCH
    ===================================================== */

    const loan = eligibleLoans[0];

    if (!loan) {
      throw new Error(
        "Unable to resolve historically eligible loan.",
      );
    }

    return loan;
  }

  /* =======================================================
     NON-SMS REPAYMENT
     =======================================================
   *
   * Preserve the existing behavior for manual/system
   * repayments.
   *
   * Historical SMS replay protection does not apply here.
   */

  const openLoans = await loans
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

  if (openLoans.length > 1) {
    throw new Error(
      "Member has multiple open loans. Loan ID is required to record this repayment safely.",
    );
  }

  const loan = openLoans[0];

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

     Financial dates are CalendarDate values:

       YYYY-MM-DD

     Do NOT convert this to JavaScript Date.

     This represents the bank transaction's financial
     calendar date.
  ======================================================= */

  const transactionDate =
    input.transactionDate;

  assertCalendarDate(
    transactionDate,
    "transaction date",
  );

  /* =======================================================
     EXACT BANK TRANSACTION TIMESTAMP

     transactionAt is the exact timestamp reported by the
     bank transaction/SMS.

     It is NOT:

       - Android SMS receipt time
       - SMS queue insertion time
       - GEO-SHUA createdAt
       - repayment.createdAt

     This timestamp is required for automatic SMS loan
     resolution and historical replay protection.
  ======================================================= */

  let transactionAt:
    Date | undefined;

  if (
    input.transactionAt !==
    undefined
  ) {
    if (
      !(
        input.transactionAt instanceof
        Date
      ) ||
      !Number.isFinite(
        input.transactionAt.getTime(),
      )
    ) {
      throw new Error(
        "Repayment transaction timestamp is invalid.",
      );
    }

    /*
     * Clone the Date so the object stored in the repayment
     * document cannot be affected by accidental mutation of
     * the caller's Date instance.
     */
    transactionAt =
      new Date(
        input.transactionAt.getTime(),
      );
  }

  /* =======================================================
     SMS TRANSACTION TIMESTAMP REQUIREMENT

     Every automatic SMS repayment MUST carry the exact
     bank transaction timestamp.

     Without this timestamp we cannot safely determine which
     historical loan existed when the payment actually
     happened.
  ======================================================= */

  if (
    input.source === "sms" &&
    !transactionAt
  ) {
    throw new Error(
      "SMS repayment requires the exact bank transaction timestamp.",
    );
  }

  /* =======================================================
     FUTURE TRANSACTION PROTECTION

     Financial calendar dates are compared as canonical
     YYYY-MM-DD strings.

     This is intentionally based on the Kenyan calendar
     date rather than UTC.
  ======================================================= */

  const today =
    dateToKenyanCalendarDate(
      new Date(),
    );

  if (
    transactionDate >
    today
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
    db,
    loans,
    repayments,
  } =
    await getCollections();

  /* =======================================================
     FAST IDEMPOTENCY CHECK

     This is only an optimization.

     The unique MongoDB transactionReference index remains
     the authoritative concurrency protection.
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

    return toRepayment(
      existing,
    );
  }

  /* =======================================================
     POST-COMMIT NOTIFICATION STATE

     These values are populated inside the transaction.

     Notifications are sent ONLY after the transaction
     successfully commits.
  ======================================================= */

  let loanPaymentRecipient =
    "";

  let loanPaymentMemberName =
    "";

  let loanPaymentRemainingBalance =
    0;

  let loanWasCleared =
    false;

  /*
   * Savings transaction created from an overpayment.
   *
   * The financial transaction is created inside the same
   * MongoDB transaction as the loan repayment. Only the
   * SMS notification is deferred until after commit.
   */
  let savingsDepositTransactionId =
    "";

  /*
   * Amount received above the loan's remaining core
   * balance.
   *
   * This is NOT applied to the loan.
   *
   * If positive, it is deposited into the member's
   * savings account atomically with the repayment.
   */
  let overpaidAmount =
    0;

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

             Protects against concurrent requests that both
             passed the fast pre-transaction lookup.
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

             For SMS repayments this resolver is responsible
             for determining the historically correct loan.

             It receives input.transactionAt and therefore
             has access to the actual bank transaction instant.

             It must NOT use Android SMS receipt time for
             financial loan resolution.
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

             Retrieve only the member information needed for
             post-commit SMS notifications.

             This does not affect financial processing.
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

          /*
           * IMPORTANT:
           *
           * Do NOT remove the completed-loan protection yet.
           *
           * Historical loan resolution and historical
           * repayment acceptance are separate problems.
           *
           * A future change that allows a historically valid
           * SMS to update a completed loan must also redesign
           * the optimistic-concurrency/update logic below.
           */
          if (
            loan.status ===
            "completed"
          ) {
            throw new Error(
              "Completed loans cannot receive repayments.",
            );
          }

          /* =================================================
             SMS DISBURSEMENT DATE PROTECTION

             The bank transaction cannot financially precede
             the loan's disbursement date.

               transactionDate < disbursementDate
                 -> reject

               transactionDate === disbursementDate
                 -> allowed

               transactionDate > disbursementDate
                 -> allowed

             The exact timestamp comparison against
             authorizedAt is handled by
             resolveLoanForRepayment().
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
             CURRENT LEDGER STATE

             Do NOT trust the projection fields on the loan
             document as the authoritative financial ledger.

             Recalculate from immutable transaction records.
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

          /* =================================================
             IMMUTABLE REPAYMENT DOCUMENT

             transactionDate:
               Financial calendar date.

             transactionAt:
               Exact original bank transaction timestamp.

             createdAt:
               GEO-SHUA ledger insertion timestamp.

             These three values have different meanings and
             must not be substituted for one another.
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

            /*
             * IMPORTANT:
             *
             * This remains the FULL amount received from
             * the bank.
             *
             * Example:
             *
             * Bank payment = 10,500
             * Loan balance = 8,400
             *
             * repayment.amount = 10,500
             *
             * Only 8,400 is applied to the loan ledger.
             * 2,100 becomes overpaidAmount.
             */
            amount,

            transactionReference:
              reference,

            transactionDate:
              transactionDate,

            ...(transactionAt
              ? {
                  transactionAt:
                    transactionAt,
                }
              : {}),

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
             ASSESS COMPLETED REPAYMENT CYCLES

             The repayment is inserted BEFORE fine assessment.

             Therefore:

             Payment exactly on cycle-end date
               -> included in that cycle

             Payment after cycle-end
               -> excluded from the completed cycle

             Everything occurs inside the same MongoDB
             transaction.
          ================================================= */

          await closeCompletedLoanPeriods(
            loanObjectId,
            dateToKenyanCalendarDate(
              new Date(transactionDate),
            ),
            session,
          );

          /* =================================================
             RECONCILE HISTORICAL FINES

             The repayment has already been inserted and any
             ended assessment periods have been closed. The
             centralized fine engine now derives missing
             historical fines from the repayment ledger.
          ================================================= */

          await reconcileLoanFines(
            loanObjectId.toString(),
            new Date(transactionDate),
            session,
          );

          /* =================================================
             RELOAD FINE LEDGER

             Fine assessment may have created new fine records,
             so reload the authoritative totals.
          ================================================= */

          const totalFinesAfterAccrual =
            await getLoanFineTotal(
              loanObjectId,
              session,
            );

          const totalWaivedFinesAfterAccrual =
            await getLoanWaivedFineTotal(
              loanObjectId,
              session,
            );

          /*
           * Calculate the remaining core loan balance using
           * the original pre-repayment loan state.
           *
           * Fine reconciliation does not change the core
           * principal/interest calculation.
           *
           * This value is intentionally calculated from
           * `loan`, not `loanAfterFineReconciliation`.
           */
          const currentOutstandingAfterAccrual =
            calculateFinalOutstanding(
              loan.principal,
              loan.interestAmount,
              amountPaidBefore,
            );

          /* =================================================
            RELOAD LOAN PROJECTION AFTER FINE RECONCILIATION

            Fine reconciliation may update loans.totalFines.

            The original `loan` object was loaded before
            reconciliation, so its projection fields can now
            be stale.

            IMPORTANT:

            The original `loan` remains authoritative for
            calculating this repayment's pre-payment state.

            This fresh document is used only for the
            optimistic-concurrency snapshot below.
          ================================================= */

          const loanAfterFineReconciliation =
            await loans.findOne(
              {
                _id: loanObjectId,
              },
              {
                session,
              },
            );

          if (!loanAfterFineReconciliation) {
            throw new Error(
              "Loan no longer exists after fine reconciliation.",
            );
          }

          /* =================================================
             OVERPAYMENT CALCULATION

             Apply only the amount required to clear the
             remaining core loan balance.

             Anything above that amount becomes overpaid.

             Fines are intentionally NOT included.
          ================================================= */

          const amountAppliedToLoan =
            money(
              Math.min(
                amount,
                currentOutstandingAfterAccrual,
              ),
            );

          overpaidAmount =
            money(
              Math.max(
                0,
                amount -
                  currentOutstandingAfterAccrual,
              ),
            );

          /* =================================================
             NEW FINANCIAL STATE

             IMPORTANT:

             Only amountAppliedToLoan is added to the loan's
             amountPaid.

             The excess remains outside the loan balance.
          ================================================= */

          const newAmountPaid =
            money(
              amountPaidBefore +
                amountAppliedToLoan,
            );

          const newOutstanding =
            calculateFinalOutstanding(
              loan.principal,
              loan.interestAmount,
              newAmountPaid,
            );

          /*
           * If this repayment occurs on or after the
           * contractual loan end date and the loan still
           * has an outstanding balance, suspend the member.
           *
           * This executes inside the same MongoDB
           * transaction as the repayment and loan update.
           */
          if (
            loan.endDate <=
              today &&
            newOutstanding >
              0
          ) {
            await suspendMemberInSession(
              db,
              loan.memberId,
              session,
              SYSTEM_ACTOR,
            );
          }

          const newStatus:
            Loan["status"] =
            newOutstanding <=
            0
              ? "completed"
              : loan.status;

          /* =================================================
             NOTIFICATION STATE

             Capture the balance AFTER this specific payment.
          ================================================= */

          loanPaymentRemainingBalance =
            newOutstanding;

          loanWasCleared =
            newStatus ===
            "completed";

          /* =================================================
             UPDATE LOAN PROJECTION

             Optimistic concurrency protection prevents another
             repayment from overwriting this repayment's
             calculated state.

             Only pending/active loans are accepted here.

             This is intentional until historical repayment
             handling for completed loans is redesigned.
          ================================================= */

          const updateResult =
            await loans.updateOne(
              {
                _id:
                  loanObjectId,

                amountPaid:
                  loanAfterFineReconciliation.amountPaid,

                totalFines:
                  loanAfterFineReconciliation.totalFines,

                totalWaivedFines:
                  loanAfterFineReconciliation.totalWaivedFines,

                outstandingBalance:
                  loanAfterFineReconciliation.outstandingBalance,

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
                    totalFinesAfterAccrual,

                  totalWaivedFines:
                    Math.min(
                      totalFinesAfterAccrual,
                      totalWaivedFinesAfterAccrual,
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
             OVERPAYMENT -> SAVINGS

             The full bank payment remains in the immutable
             repayment ledger.

             Only the amount required to clear the loan is
             added to loan.amountPaid.

             Any excess is deposited into the member's
             savings account using the SAME MongoDB session.

             Therefore:

               loan repayment + savings deposit

             either both commit or both roll back.
          ================================================= */

          if (
            overpaidAmount > 0
          ) {
            const savingsAccount =
              await getOrCreateSavingsAccount(
                loan.memberId.toString(),
                session,
              );

            const savingsDeposit =
              await createSavingsDeposit({
                savingsAccountId:
                  savingsAccount.id,

                memberId:
                  loan.memberId.toString(),

                memberName:
                  loanPaymentMemberName,

                amount:
                  overpaidAmount,

                source:
                  "system",

                reference:
                  `loan-overpayment:${repaymentDocument._id!.toString()}`,

                sourceReference:
                  repaymentDocument._id!.toString(),

                transactionAt:
                  transactionDate,

                recordedBy:
                  input.recordedBy
                    ? normalizeActor(
                        input.recordedBy,
                      )
                    : SYSTEM_ACTOR,

                session,
              });

            savingsDepositTransactionId =
              savingsDeposit.id;
          }

          /* =================================================
             DOMAIN MODEL
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

              /*
               * Actual amount received from the bank.
               */
              amount:
                repayment.amount,

              /*
               * Amount actually applied against the loan.
               */
              amountAppliedToLoan,

              /*
               * Amount received above the core loan balance.
               *
               * This amount is transferred to the member's
               * savings account in the same MongoDB transaction.
               */
              overpaidAmount,

              transactionReference:
                repayment.transactionReference,

              source:
                repayment.source,

              transactionDate:
                repayment.transactionDate,

              ...(repayment.transactionAt
                ? {
                    transactionAt:
                      repayment.transactionAt,
                  }
                : {}),

              outstandingBefore:
                currentOutstandingAfterAccrual,

              outstandingAfter:
                newOutstanding,

              amountPaidBefore,

              amountPaidAfter:
                newAmountPaid,

              totalFinesBefore:
                totalFinesBefore,

              totalFinesAfter:
                totalFinesAfterAccrual,

              totalWaivedFinesBefore:
                totalWaivedFinesBefore,

              totalWaivedFinesAfter:
                totalWaivedFinesAfterAccrual,
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
                  totalFinesAfterAccrual,

                totalWaivedFines:
                  totalWaivedFinesAfterAccrual,

                finalOutstandingBalance:
                  newOutstanding,

                /*
                 * If the payment cleared the loan and had
                 * excess money, retain that information in
                 * the completion audit as well.
                 */
                overpaidAmount,
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

       From this point onward the financial transaction is
       permanent.

       Notification failure MUST NOT roll back the
       payment.

       Any savings deposit created from an overpayment was
       committed atomically with the loan repayment above.
       Only its SMS notification is deferred until now.
    ===================================================== */

    const repayment =
      transactionResult.repayment;

    /* =====================================================
       PAYMENT RECEIVED SMS
    ===================================================== */

    if (
      loanPaymentRecipient
    ) {
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
       SAVINGS DEPOSIT SMS

       The savings deposit itself was committed atomically
       with the loan repayment above.

       Only now is it safe to create the notification.

       Notification failure MUST NOT affect the already
       committed financial transaction.
    ===================================================== */

    if (
      savingsDepositTransactionId &&
      loanPaymentRecipient
    ) {
      try {
        await queueSavingsDepositSms({
          transactionId:
            savingsDepositTransactionId,

          memberId:
            repayment.memberId,

          recipient:
            loanPaymentRecipient,

          memberName:
            loanPaymentMemberName,

          amount:
            overpaidAmount,
        });
      } catch (error) {
        console.error(
          "Failed to queue savings deposit SMS for loan overpayment.",
          {
            repaymentId:
              repayment.id,

            savingsDepositTransactionId,

            loanId:
              repayment.loanId,

            memberId:
              repayment.memberId,

            overpaidAmount,

            error,
          },
        );
      }
    } else if (
      savingsDepositTransactionId
    ) {
      console.warn(
        "Savings deposit SMS skipped: member has no phone number.",
        {
          repaymentId:
            repayment.id,

          savingsDepositTransactionId,

          loanId:
            repayment.loanId,

          memberId:
            repayment.memberId,

          overpaidAmount,
        },
      );
    }

    /* =====================================================
       LOAN CLEARED SMS

       Only this repayment can trigger the clearance SMS
       when it moves the loan to completed.
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

      /*
       * IMPORTANT:
       *
       * Do not create another savings deposit or send
       * repayment notifications here.
       *
       * This request did not create the repayment. The
       * original request owns the committed financial
       * transaction and its post-commit notifications.
       */
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

        await deleteLoanFines(
          objectId,
          session,
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

      getLoanFineSummaryTotal(),

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
        fineStats ||
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
