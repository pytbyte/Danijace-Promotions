import {
  ObjectId,
  type ClientSession,
  type Collection,
  type Db,
} from "mongodb";

import clientPromise from "@/lib/mongodb";

import type {
  Loan,
  LoanActor,
  LoanAuditEntry,
  LoanFine,
  LoanRepayment,
} from "../types";

import type {
  AssessmentPeriod,
  CalendarDate,
} from "./types";

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const LOANS_COLLECTION = "loans";
const LOAN_REPAYMENTS_COLLECTION = "loanRepayments";
const LOAN_FINES_COLLECTION = "loanFines";
const LOAN_AUDIT_COLLECTION = "loanAudit";

export type FineLoanDocument =
  Omit<Loan, "id" | "memberId" | "completedInstallmentBalance"> & {
    _id: ObjectId;
    memberId: ObjectId;
    createdAt: Date;
    updatedAt: Date;
  };

type FineRepaymentDocument =
  Omit<LoanRepayment, "id" | "loanId" | "memberId"> & {
    _id?: ObjectId;
    loanId: ObjectId;
    memberId: ObjectId;
  };

type FineDocument =
  Omit<LoanFine, "id" | "loanId" | "memberId"> & {
    _id?: ObjectId;
    loanId: ObjectId;
    memberId: ObjectId;
  };

type FineAuditDocument =
  Omit<LoanAuditEntry, "id" | "loanId"> & {
    _id?: ObjectId;
    loanId: ObjectId;
  };

type FineCollections = {
  client: Awaited<typeof clientPromise>;
  db: Db;
  loans: Collection<FineLoanDocument>;
  repayments: Collection<FineRepaymentDocument>;
  fines: Collection<FineDocument>;
  audit: Collection<FineAuditDocument>;
};

export async function getMongoClient(): Promise<Awaited<typeof clientPromise>> {
  return clientPromise;
}

async function getCollections(): Promise<FineCollections> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  return {
    client,
    db,
    loans: db.collection<FineLoanDocument>(LOANS_COLLECTION),
    repayments:
      db.collection<FineRepaymentDocument>(LOAN_REPAYMENTS_COLLECTION),
    fines: db.collection<FineDocument>(LOAN_FINES_COLLECTION),
    audit: db.collection<FineAuditDocument>(LOAN_AUDIT_COLLECTION),
  };
}

function money(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Invalid monetary value.");
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isCalendarDate(value: unknown): value is CalendarDate {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function assertCalendarDate(
  value: unknown,
  fieldName: string,
): asserts value is CalendarDate {
  if (!isCalendarDate(value)) {
    throw new Error(
      `${fieldName} must be a valid YYYY-MM-DD calendar date.`,
    );
  }
}

function dateToKenyanCalendarDate(date: Date): CalendarDate {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Invalid date.");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const result = `${values.year}-${values.month}-${values.day}`;
  assertCalendarDate(result, "Kenyan calendar date");
  return result;
}

function calendarDateToKenyanStartDate(value: CalendarDate): Date {
  assertCalendarDate(value, "calendar date");

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  return new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
}

function normalizeLoanCalendarDate(
  value: unknown,
  fieldName: string,
  loanNumber?: string,
): CalendarDate {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      assertCalendarDate(trimmed, fieldName);
      return trimmed;
    }

    const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);

    if (isoMatch) {
      const calendarDate = isoMatch[1];
      assertCalendarDate(calendarDate, fieldName);
      return calendarDate;
    }
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${fieldName}.`);
    }

    return dateToKenyanCalendarDate(value);
  }

  throw new Error(
    `Invalid ${fieldName} for loan ${loanNumber ?? "unknown"}. Expected YYYY-MM-DD.`,
  );
}

function daysFromCivil(year: number, month: number, day: number): number {
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const monthPrime = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;

  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(value: number): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = value + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra +
      Math.floor(yearOfEra / 4) -
      Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day =
    dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);

  year += month <= 2 ? 1 : 0;

  return { year, month, day };
}

function addCalendarDays(
  value: CalendarDate,
  days: number,
): CalendarDate {
  assertCalendarDate(value, "calendar date");

  if (!Number.isInteger(days)) {
    throw new Error("Calendar day offset must be a whole number.");
  }

  const result = civilFromDays(
    daysFromCivil(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)),
      Number(value.slice(8, 10)),
    ) + days,
  );

  if (result.year < 1 || result.year > 9999) {
    throw new Error("Calendar date is outside the supported range.");
  }

  return `${String(result.year).padStart(4, "0")}-${String(
    result.month,
  ).padStart(2, "0")}-${String(result.day).padStart(2, "0")}`;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function toLoan(document: FineLoanDocument): Loan {
  if (!document._id) {
    throw new Error("Loan has no MongoDB ID.");
  }

  return {
    ...document,
    id: document._id.toString(),
    memberId: document.memberId.toString(),
    completedInstallmentBalance: 0,
  };
}

function toFine(document: FineDocument): LoanFine {
  if (!document._id) {
    throw new Error("Fine has no MongoDB ID.");
  }

  return {
    ...document,
    id: document._id.toString(),
    loanId: document.loanId.toString(),
    memberId: document.memberId.toString(),
  };
}

export async function getLoan(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<FineLoanDocument> {
  const { loans } = await getCollections();
  const loan = await loans.findOne({ _id: loanId }, { session });

  if (!loan) {
    throw new Error("Loan not found.");
  }

  return loan;
}

export async function getLoanDomain(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<Loan> {
  return toLoan(await getLoan(loanId, session));
}

export async function getLoanIdsWithRepayments(): Promise<ObjectId[]> {
  const { repayments } = await getCollections();
  return repayments.distinct("loanId");
}

export async function getAmountPaidAsOf(
  loanId: ObjectId,
  asOfDate: CalendarDate,
  session?: ClientSession,
): Promise<number> {
  assertCalendarDate(asOfDate, "repayment cutoff date");

  const { repayments } = await getCollections();
  const legacyCutoffStart = calendarDateToKenyanStartDate(asOfDate);
  const legacyCutoffEnd = new Date(
    legacyCutoffStart.getTime() + 24 * 60 * 60 * 1000 - 1,
  );

  const result = await repayments
    .aggregate<{ _id: null; total: number }>(
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
            total: { $sum: "$amount" },
          },
        },
      ],
      { session },
    )
    .toArray();

  return money(Number(result[0]?.total ?? 0));
}

export async function getPaymentsDuringPeriod(
  loanId: ObjectId,
  period: AssessmentPeriod,
  session?: ClientSession,
): Promise<number> {
  assertCalendarDate(period.periodStart, "repayment period start");
  assertCalendarDate(period.periodEnd, "repayment period end");

  const { repayments } = await getCollections();

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

  const periodStartDate = calendarDateToKenyanStartDate(period.periodStart);
  const periodEndStartDate = calendarDateToKenyanStartDate(period.periodEnd);
  const periodEndDate = new Date(
    periodEndStartDate.getTime() + 24 * 60 * 60 * 1000 - 1,
  );

  const legacyDateFilter =
    period.periodNumber === 1
      ? {
          $gte: periodStartDate,
          $lte: periodEndDate,
        }
      : {
          $gt: periodStartDate,
          $lte: periodEndDate,
        };

  const result = await repayments
    .aggregate<{ _id: null; total: number }>(
      [
        {
          $match: {
            loanId,
            $or: [
              { transactionDate: canonicalDateFilter },
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
            total: { $sum: "$amount" },
          },
        },
      ],
      { session },
    )
    .toArray();

  return money(Number(result[0]?.total ?? 0));
}

export async function findFineByPeriod(
  loanId: ObjectId,
  periodNumber: number,
  session?: ClientSession,
): Promise<FineDocument | null> {
  const { fines } = await getCollections();
  return fines.findOne({ loanId, periodNumber }, { session });
}

export async function insertFine(
  document: FineDocument,
  session?: ClientSession,
): Promise<void> {
  const { fines } = await getCollections();
  await fines.insertOne(document, { session });
}

export async function getFineTotal(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  const { fines } = await getCollections();

  const result = await fines
    .aggregate<{ _id: null; total: number }>(
      [
        { $match: { loanId } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ],
      { session },
    )
    .toArray();

  return money(Number(result[0]?.total ?? 0));
}

export async function getLoanFineTotal(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<number> {
  return getFineTotal(loanId, session);
}

export async function getLoanFineSummaryTotal(): Promise<number> {
  const { fines } = await getCollections();
  const result = await fines
    .aggregate<{ _id: null; totalFines: number }>([
      {
        $group: {
          _id: null,
          totalFines: { $sum: "$amount" },
        },
      },
    ])
    .toArray();

  return money(Number(result[0]?.totalFines ?? 0));
}

export async function setLoanFineTotal(
  loanId: ObjectId,
  totalFines: number,
  session?: ClientSession,
): Promise<void> {
  const { loans } = await getCollections();
  await loans.updateOne(
    { _id: loanId },
    {
      $set: {
        totalFines: money(totalFines),
        updatedAt: new Date(),
      },
    },
    { session },
  );
}

export async function updateFineStatus(
  loanId: ObjectId,
  from: "active" | "stopped",
  to: "active" | "stopped",
  now: Date,
  session?: ClientSession,
): Promise<FineLoanDocument> {
  const { loans } = await getCollections();

  const result = await loans.updateOne(
    {
      _id: loanId,
      fineStatus: from,
    },
    {
      $set: {
        fineStatus: to,
        updatedAt: now,
      },
    },
    { session },
  );

  if (result.modifiedCount !== 1) {
    throw new Error(
      "Loan fine status changed concurrently. Please retry.",
    );
  }

  return getLoan(loanId, session);
}

export async function deleteLoanFines(
  loanId: ObjectId,
  session?: ClientSession,
): Promise<void> {
  const { fines } = await getCollections();
  await fines.deleteMany({ loanId }, { session });
}

export type FineCalculationDocument = {
  periodNumber: number;
  amount?: unknown;
  fineRate?: unknown;
  periodStart?: CalendarDate;
  periodEnd?: CalendarDate;
  expectedInstallment?: unknown;
  paymentsDuringPeriod?: unknown;
  installmentShortfall?: unknown;
};

export async function getLoanFinesForCalculation(
  loanId: ObjectId,
): Promise<FineCalculationDocument[]> {
  const { fines } = await getCollections();

  return fines
    .find({ loanId })
    .project<FineCalculationDocument>({
      periodNumber: 1,
      amount: 1,
      fineRate: 1,
      periodStart: 1,
      periodEnd: 1,
      expectedInstallment: 1,
      paymentsDuringPeriod: 1,
      installmentShortfall: 1,
    })
    .sort({ periodNumber: 1 })
    .toArray();
}

export async function getLoanFinesForCalculationByLoanIds(
  loanIds: ObjectId[],
): Promise<Array<FineCalculationDocument & { loanId: ObjectId }>> {
  if (loanIds.length === 0) {
    return [];
  }

  const { fines } = await getCollections();

  return fines
    .find({ loanId: { $in: loanIds } })
    .project<FineCalculationDocument & { loanId: ObjectId }>({
      loanId: 1,
      periodNumber: 1,
      amount: 1,
      fineRate: 1,
      periodStart: 1,
      periodEnd: 1,
      expectedInstallment: 1,
      paymentsDuringPeriod: 1,
      installmentShortfall: 1,
    })
    .sort({ periodNumber: 1 })
    .toArray();
}

export async function getLoanFines(
  loanId: ObjectId,
): Promise<LoanFine[]> {
  const { fines } = await getCollections();
  const documents = await fines
    .find({ loanId })
    .sort({ fineDate: -1, _id: -1 })
    .toArray();

  return documents.map(toFine);
}

export async function writeAudit(
  loanId: ObjectId,
  loanNumber: string,
  action: LoanAuditEntry["action"],
  actor: LoanActor,
  details: Record<string, unknown>,
  session?: ClientSession,
): Promise<void> {
  const { audit } = await getCollections();

  const document: FineAuditDocument = {
    _id: new ObjectId(),
    loanId,
    loanNumber,
    action,
    actor,
    details,
    createdAt: new Date(),
  };

  await audit.insertOne(document, { session });
}

export async function ensureFineIndexes(): Promise<void> {
  const { fines } = await getCollections();

  await Promise.all([
    fines.createIndex(
      { loanId: 1, fineDate: 1 },
      {
        unique: true,
        name: "loanFines_loan_date_unique",
      },
    ),
    fines.createIndex(
      { loanId: 1, periodNumber: 1 },
      {
        unique: true,
        name: "loanFines_loan_period_unique",
      },
    ),
  ]);
}

export function getFineCollectionName(): string {
  return LOAN_FINES_COLLECTION;
}

export function buildFineDocument(input: {
  loan: FineLoanDocument;
  period: AssessmentPeriod;
  expectedInstallment: number;
  paymentsDuringPeriod: number;
  installmentShortfall: number;
  fineRate: number;
  fineAmount: number;
}): FineDocument {
  return {
    _id: new ObjectId(),
    loanId: input.loan._id,
    loanNumber: input.loan.loanNumber,
    memberId: input.loan.memberId,
    amount: money(input.fineAmount),
    fineDate: input.period.periodEnd,
    fineRate: input.fineRate,
    periodNumber: input.period.periodNumber,
    periodStart: input.period.periodStart,
    periodEnd: input.period.periodEnd,
    expectedInstallment: input.expectedInstallment,
    paymentsDuringPeriod: input.paymentsDuringPeriod,
    installmentShortfall: input.installmentShortfall,
    assessedCoreBalance: input.installmentShortfall,
    source: "system" as FineDocument["source"],
    createdAt: new Date(),
  };
}

export { dateToKenyanCalendarDate, normalizeLoanCalendarDate, addCalendarDays };
