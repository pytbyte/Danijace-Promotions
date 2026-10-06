import {
  ObjectId,
  type ClientSession,
} from "mongodb";

import type {
  Loan,
  LoanActor,
  LoanFine,
} from "../types";

import type {
  AssessmentPeriod,
  CalendarDate,
  FineCalculation,
} from "@/lib/loans/fines/types";

import * as repository from "@/lib/loans/fines/repository";

const SYSTEM_ACTOR: LoanActor = {
  name: "System",
  email: "system",
};

function money(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Invalid monetary value.");
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeRate(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Rate must be between 0 and 1.");
  }

  return money(value);
}

function normalizeCycleDays(value: number | undefined): number {
  const cycleDays = Number(value ?? 7);

  if (
    !Number.isInteger(cycleDays) ||
    cycleDays <= 0 ||
    cycleDays > 3650
  ) {
    throw new Error(
      "Repayment cycle days must be a whole number between 1 and 3650.",
    );
  }

  return cycleDays;
}

function calculateLoanAmountDue(
  installmentAmount: number,
  principal: number,
  interestAmount: number,
  amountPaid: number,
): number {
  const remainingCore = Math.max(
    0,
    money(principal + interestAmount) - amountPaid,
  );

  return money(Math.min(money(installmentAmount), remainingCore));
}

function getAssessmentPeriod(
  loan: repository.FineLoanDocument,
  periodNumber: number,
): AssessmentPeriod {
  if (!Number.isInteger(periodNumber) || periodNumber <= 0) {
    throw new Error(
      "Assessment period must be a positive whole number.",
    );
  }

  const cycleDays = normalizeCycleDays(loan.repaymentCycleDays);
  const disbursementDate = repository.normalizeLoanCalendarDate(
    loan.disbursementDate,
    "loan.disbursementDate",
    loan.loanNumber,
  );
  const loanEndDate = repository.normalizeLoanCalendarDate(
    loan.endDate,
    "loan.endDate",
    loan.loanNumber,
  );
  console.log("[MAX PERIOD TRACE]", {
  loanNumber: loan.loanNumber,
  cycleDays,
  disbursementDate,
  loanEndDate,
  disbursementType: typeof disbursementDate,
  loanEndType: typeof loanEndDate,
});

const firstPeriodStart = repository.addCalendarDays(
  disbursementDate,
  0,
);

console.log("[MAX PERIOD TRACE] FIRST PERIOD", {
  disbursementDate,
  firstPeriodStart,
  firstPeriodStartType: typeof firstPeriodStart,
  comparison: firstPeriodStart >= loanEndDate,
});

  if (loanEndDate < disbursementDate) {
    throw new Error(
      `Loan end date cannot be before disbursement date for loan ${loan.loanNumber}.`,
    );
  }

  const periodStart = repository.addCalendarDays(
    disbursementDate,
    (periodNumber - 1) * cycleDays,
  );

  if (periodStart >= loanEndDate) {
    throw new Error(
      `Assessment period ${periodNumber} starts on or after the contractual loan end date for loan ${loan.loanNumber}.`,
    );
  }

  const normalPeriodEnd = repository.addCalendarDays(
    periodStart,
    cycleDays,
  );

  return {
    periodNumber,
    periodStart,
    periodEnd:
      normalPeriodEnd > loanEndDate
        ? loanEndDate
        : normalPeriodEnd,
  };
}

function getMaximumContractualPeriod(
  loan: repository.FineLoanDocument,
): number {
  const cycleDays = normalizeCycleDays(loan.repaymentCycleDays);
  const disbursementDate = repository.normalizeLoanCalendarDate(
    loan.disbursementDate,
    "loan.disbursementDate",
    loan.loanNumber,
  );
  const loanEndDate = repository.normalizeLoanCalendarDate(
    loan.endDate,
    "loan.endDate",
    loan.loanNumber,
  );
  console.log("[MAX PERIOD TRACE]", {
  loanNumber: loan.loanNumber,
  cycleDays,
  disbursementDate,
  loanEndDate,
  disbursementType: typeof disbursementDate,
  loanEndType: typeof loanEndDate,
});

const firstPeriodStart = repository.addCalendarDays(
  disbursementDate,
  0,
);

console.log("[MAX PERIOD TRACE] FIRST PERIOD", {
  disbursementDate,
  firstPeriodStart,
  firstPeriodStartType: typeof firstPeriodStart,
  comparison: firstPeriodStart >= loanEndDate,
});

  if (loanEndDate < disbursementDate) {
    throw new Error(
      `Loan end date cannot be before disbursement date for loan ${loan.loanNumber}.`,
    );
  }

  let maximumPeriod = 0;

  for (;;) {
    const periodStart = repository.addCalendarDays(
      disbursementDate,
      maximumPeriod * cycleDays,
    );

    if (periodStart >= loanEndDate) {
      break;
    }

    maximumPeriod++;
  }

  return maximumPeriod;
}

function calculateFine(
  expectedInstallment: number,
  paymentsDuringPeriod: number,
  fineRate: number,
): FineCalculation {
  const installmentShortfall = money(
    Math.max(0, expectedInstallment - paymentsDuringPeriod),
  );

  const fineAmount = money(
    Math.max(0, installmentShortfall * fineRate),
  );

  return {
    expectedInstallment,
    paymentsDuringPeriod,
    installmentShortfall,
    fineRate,
    fineAmount,
  };
}

function normalizeActor(actor?: LoanActor): LoanActor {
  if (!actor || typeof actor !== "object") {
    return SYSTEM_ACTOR;
  }

  const name =
    typeof actor.name === "string"
      ? actor.name.trim()
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

  return { name, email };
}

function createObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid loan ID.");
  }

  return new ObjectId(id);
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toLoan(document: repository.FineLoanDocument): Loan {
  return {
    ...document,
    id: document._id.toString(),
    memberId: document.memberId.toString(),
    completedInstallmentBalance: 0,
  };
}

/**
 * The single fine calculation/write engine.
 *
 * It checks every contractual period that has ended as of the
 * supplied date. Repayment records are authoritative for what
 * was actually paid during each period. A historical fine is
 * created only when:
 *
 *   1. the period has ended,
 *   2. the loan has active fines, and
 *   3. the repayment ledger shows a positive installment
 *      shortfall.
 *
 * Existing historical fine records are never recalculated,
 * reduced, increased, or deleted by later repayments.
 */
export async function reconcileLoanFinesInSession(
  loanId: ObjectId,
  asOfDate: Date,
  session: ClientSession,
): Promise<number> {
  console.log("[FINE ENTRY]", {
    loanId: loanId.toString(),
    asOfDate,
    sessionPresent: Boolean(session),
  });

  if (!isValidDate(asOfDate)) {
    throw new Error("Invalid as-of date.");
  }

  const loan = await repository.getLoan(loanId, session);

  if (loan.status === "cancelled") {
    return 0;
  }

  const asOfCalendarDate = repository.dateToKenyanCalendarDate(asOfDate);
  const loanEndDate = repository.normalizeLoanCalendarDate(
    loan.endDate,
    "loan.endDate",
    loan.loanNumber,
  );
  const maximumContractualPeriod = getMaximumContractualPeriod(loan);
  console.log("[FINE PERIOD TRACE]", {
  loanId: loanId.toString(),
  loanNumber: loan.loanNumber,
  disbursementDate: loan.disbursementDate,
  loanEndDate,
  asOfDate,
  asOfCalendarDate,
  repaymentCycleDays: loan.repaymentCycleDays,
  maximumContractualPeriod,
  fineStatus: loan.fineStatus,
  status: loan.status,
});

  if (maximumContractualPeriod <= 0) {
    await repository.setLoanFineTotal(
      loanId,
      await repository.getFineTotal(loanId, session),
      session,
    );
    return 0;
  }

  let reconciledPeriods = 0;
  let createdFines = 0;
  let existingFines = 0;
  let skippedPeriods = 0;

  for (
    let periodNumber = 1;
    periodNumber <= maximumContractualPeriod;
    periodNumber++
  ) {
    const contractualPeriod = getAssessmentPeriod(loan, periodNumber);
   

    if (contractualPeriod.periodStart >= loanEndDate) {
      break;
    }


    const boundedPeriodEnd =
      contractualPeriod.periodEnd > loanEndDate
        ? loanEndDate
        : contractualPeriod.periodEnd;

    if (boundedPeriodEnd > asOfCalendarDate) {
      break;
    }

    const period: AssessmentPeriod = {
      ...contractualPeriod,
      periodEnd: boundedPeriodEnd,
    };

    reconciledPeriods++;
    console.log("[FINE STATUS TRACE]", {
  loanId: loanId.toString(),
  loanNumber: loan.loanNumber,
  periodNumber,
  fineStatus: loan.fineStatus,
  isActive: loan.fineStatus === "active",
});

    if (loan.fineStatus !== "active") {
      skippedPeriods++;
      continue;
    }

    const amountPaidBeforePeriod = await repository.getAmountPaidAsOf(
      loanId,
      period.periodStart,
      session,
    );

    const expectedInstallment = money(
      Math.max(
        0,
        calculateLoanAmountDue(
          loan.installmentAmount,
          loan.principal,
          loan.interestAmount,
          amountPaidBeforePeriod,
        ),
      ),
    );

    const paymentsDuringPeriod =
      await repository.getPaymentsDuringPeriod(
        loanId,
        period,
        session,
      );

    const fineRate = normalizeRate(loan.fineRate);

    const calculation = calculateFine(
      expectedInstallment,
      paymentsDuringPeriod,
      fineRate,
    );

    console.log("[FINE DEBUG]", {
      loanId: loanId.toString(),
      loanNumber: loan.loanNumber,
      periodNumber,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      asOfCalendarDate,
      fineStatus: loan.fineStatus,
      fineRate,
      amountPaidBeforePeriod,
      expectedInstallment,
      paymentsDuringPeriod,
      installmentShortfall: calculation.installmentShortfall,
      fineAmount: calculation.fineAmount,
    });

    if (calculation.fineAmount <= 0) {
      console.log("[FINE DEBUG] SKIP: fineAmount <= 0", {
        loanId: loanId.toString(),
        periodNumber,
      });
      continue;
    }

    const existingFine = await repository.findFineByPeriod(
      loanId,
      periodNumber,
      session,
    );

    if (existingFine) {
      existingFines++;
      continue;
    }

    const fineDocument = repository.buildFineDocument({
      loan,
      period,
      expectedInstallment: calculation.expectedInstallment,
      paymentsDuringPeriod: calculation.paymentsDuringPeriod,
      installmentShortfall: calculation.installmentShortfall,
      fineRate: calculation.fineRate,
      fineAmount: calculation.fineAmount,
    });

    try {
      await repository.insertFine(fineDocument, session);
    } catch (error) {
      if (!repository.isDuplicateKeyError(error)) {
        throw error;
      }

      const concurrentFine = await repository.findFineByPeriod(
        loanId,
        periodNumber,
        session,
      );

      if (!concurrentFine) {
        throw error;
      }

      existingFines++;
      continue;
    }

    await repository.writeAudit(
      loanId,
      loan.loanNumber,
      "fine_recorded",
      SYSTEM_ACTOR,
      {
        periodNumber,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        amount: calculation.fineAmount,
        fineRate: calculation.fineRate,
        expectedInstallment: calculation.expectedInstallment,
        amountPaidDuringPeriod:
          calculation.paymentsDuringPeriod,
        unpaidInstallment:
          calculation.installmentShortfall,
        assessedCoreBalance:
          calculation.installmentShortfall,
        source: "historical_reconciliation",
        action: "created",
      },
      session,
    );

    createdFines++;
  }

  const authoritativeTotal = await repository.getFineTotal(
    loanId,
    session,
  );

  await repository.setLoanFineTotal(
    loanId,
    authoritativeTotal,
    session,
  );

  return reconciledPeriods;
}

/**
 * Public transactional fine reconciliation for one loan.
 */
export async function reconcileLoanFines(
  loanId: string,
  asOfDate: Date = new Date(),
  session?: ClientSession,
): Promise<number> {
  const objectId = createObjectId(loanId);

  if (!isValidDate(asOfDate)) {
    throw new Error("Invalid as-of date.");
  }

  if (session) {
    return reconcileLoanFinesInSession(objectId, asOfDate, session);
  }

  const client = await repository.getMongoClient();
  const dbSession = client.startSession();

  try {
    return await dbSession.withTransaction(
      async () =>
        reconcileLoanFinesInSession(
          objectId,
          asOfDate,
          dbSession,
        ),
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 10_000,
      },
    );
  } finally {
    await dbSession.endSession();
  }
}

/**
 * Backward-compatible public name for existing API callers.
 */
export const accrueLoanFines = reconcileLoanFines;

/**
 * Sweep all loans that have an actual repayment ledger entry.
 * Each loan is passed through the same central fine engine.
 */
export async function accrueAllLoanFines(
  asOfDate: Date = new Date(),
): Promise<number> {
  if (!isValidDate(asOfDate)) {
    throw new Error("Invalid as-of date.");
  }

  const loanIds = await repository.getLoanIdsWithRepayments();
  let reconciledPeriods = 0;

  for (const loanId of loanIds) {
    try {
      reconciledPeriods += await reconcileLoanFines(
        loanId.toString(),
        asOfDate,
      );
    } catch (error) {
      console.error(
        `Failed to reconcile historical fines for loan ${loanId.toString()}:`,
        error,
      );
    }
  }

  return reconciledPeriods;
}

export async function stopLoanFines(
  loanId: string,
  input: {
    reason: string;
    stoppedBy: LoanActor;
  },
): Promise<Loan> {
  const objectId = createObjectId(loanId);
  const reason =
    typeof input?.reason === "string"
      ? input.reason.trim()
      : "";

  if (!reason) {
    throw new Error("A reason is required when stopping fines.");
  }

  const actor = normalizeActor(input.stoppedBy);
  const client = await repository.getMongoClient();
  const session = client.startSession();

  try {
    return await session.withTransaction(
      async () => {
        const loan = await repository.getLoan(objectId, session);

        if (loan.status === "cancelled") {
          throw new Error(
            "Fines cannot be changed on a cancelled loan.",
          );
        }

        if (loan.status === "completed") {
          throw new Error(
            "Fines cannot be changed on a completed loan.",
          );
        }

        if (loan.fineStatus === "stopped") {
          return toLoan(loan);
        }

        const now = new Date();

        await repository.updateFineStatus(
          objectId,
          "active",
          "stopped",
          now,
          session,
        );

        await repository.writeAudit(
          objectId,
          loan.loanNumber,
          "fine_stopped",
          actor,
          {
            reason,
            stoppedAt: now,
          },
          session,
        );

        await reconcileLoanFinesInSession(
          objectId,
          now,
          session,
        );

        return repository.getLoanDomain(objectId, session);
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

export async function resumeLoanFines(
  loanId: string,
  resumedBy: LoanActor,
  reason: string,
): Promise<Loan> {
  const objectId = createObjectId(loanId);
  const actor = normalizeActor(resumedBy);
  const cleanReason =
    typeof reason === "string" ? reason.trim() : "";

  if (!cleanReason) {
    throw new Error("A reason is required when resuming fines.");
  }

  const client = await repository.getMongoClient();
  const session = client.startSession();

  try {
    const loan = await session.withTransaction(
      async () => {
        const current = await repository.getLoan(objectId, session);

        if (
          current.status === "cancelled" ||
          current.status === "completed"
        ) {
          throw new Error(
            "Fines cannot be resumed on a completed or cancelled loan.",
          );
        }

        if (current.fineStatus === "active") {
          return repository.getLoanDomain(objectId, session);
        }

        const now = new Date();

        await repository.updateFineStatus(
          objectId,
          "stopped",
          "active",
          now,
          session,
        );

        await repository.writeAudit(
          objectId,
          current.loanNumber,
          "updated",
          actor,
          {
            action: "fines_resumed",
            reason: cleanReason,
            resumedAt: now,
          },
          session,
        );

        return repository.getLoanDomain(objectId, session);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 10_000,
      },
    );

    /*
     * Preserve the existing behavior: resuming the fine status
     * commits first, then overdue historical periods are assessed
     * in a separate transaction.
     */
    await reconcileLoanFines(
      loanId,
      new Date(),
    );

    return (
      await repository.getLoanDomain(objectId)
    ) || loan;
  } finally {
    await session.endSession();
  }
}

export async function getLoanFines(
  loanId: string,
): Promise<LoanFine[]> {
  return repository.getLoanFines(createObjectId(loanId));
}

