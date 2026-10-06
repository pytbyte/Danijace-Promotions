import type { Loan, LoanFine } from "../types";

export type CalendarDate = string;

export type AssessmentPeriod = {
  periodNumber: number;
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
};

export type FineCalculation = {
  expectedInstallment: number;
  paymentsDuringPeriod: number;
  installmentShortfall: number;
  fineRate: number;
  fineAmount: number;
};

export type FineReconciliationResult = {
  reconciledPeriods: number;
  createdFines: number;
  existingFines: number;
  skippedPeriods: number;
};

export type FineLoan = Loan;

export type FineRecord = LoanFine;
