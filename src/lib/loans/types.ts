/**
 * GEO-SHUA
 * Loan Domain Types
 *
 * Financial rules:
 * - No daily fines.
 * - Fines are percentage-based.
 * - A fine may be assessed once per completed repayment cycle.
 * - Repayment cycles default to 7 days.
 * - Fines are calculated from core outstanding balance only.
 * - Existing fines never compound.
 * - Financial records are append-only.
 * - Repayments, fines, waivers, assessments and audits
 *   must never be permanently deleted.
 */

export type LoanType =
  | "emergency"
  | "regular";

export type LoanStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled";

export type LoanRepaymentStatus =
  | "current"
  | "defaulted"
  | "completed";

export type FineStatus =
  | "active"
  | "stopped";

export type TransactionSource =
  | "manual"
  | "sms"
  | "system";

export type FineSource =
  | "system"
  | "manual";

export type LoanAssessmentStatus =
  | "assessed"
  | "defaulted";

/* =========================================================
   ACTOR
========================================================= */

export interface LoanActor {
  name: string;
  email: string;
}

/* =========================================================
   GUARANTOR
========================================================= */

export interface LoanGuarantor {
  name: string;
  phone: string;
  idNumber?: string;
}

/* =========================================================
   LOAN SETTINGS
========================================================= */

export interface LoanSettings {
  id: string;

  regularInterestRate: number;
  emergencyInterestRate: number;

  regularMinimumSavings: number;
  regularSavingsMultiplier: number;

  /**
   * Retained for compatibility with existing settings
   * documents and consumers.
   *
   * The authoritative repayment timing for the new
   * periodic-fine model is repaymentCycleDays.
   */
  repaymentGraceDays: number;

  /**
   * Number of days in one repayment assessment cycle.
   *
   * Default: 7 days.
   */
  repaymentCycleDays: number;

  /**
   * Fine percentage expressed as a decimal.
   *
   * Example:
   * 0.10 = 10%
   */
  fineRate: number;

  emergencyLoansEnabled: boolean;
  regularLoansEnabled: boolean;

  updatedBy: LoanActor;

  createdAt: Date;
  updatedAt: Date;
}

/* =========================================================
   LOAN
========================================================= */

export interface Loan {
  id: string;

  loanNumber: string;

  memberId: string;
  memberNumber: string;
  memberName: string;

  type: LoanType;

  principal: number;

  interestRate: number;
  interestAmount: number;

  /**
   * Percentage fine applied once per completed
   * repayment cycle when applicable.
   */
  fineRate: number;

  /**
   * Number of days in each repayment assessment cycle.
   */
  repaymentCycleDays: number;

  disbursementDate: Date;

  /**
   * Scheduled repayment date.
   */
  repaymentDate: Date;

  /**
   * Final contractual loan end date.
   */
  endDate: Date;

  /**
   * First scheduled assessment/due date.
   *
   * Kept because existing application code may consume it.
   * It is derived from:
   *
   * disbursementDate + repaymentCycleDays
   */
  firstDueDate: Date;

  /**
   * Principal + interest.
   *
   * Does not include fines.
   */
  totalDue: number;

  /**
   * Authoritative projection of total repayments recorded.
   */
  amountPaid: number;

  /**
   * Authoritative projection of all assessed fines.
   */
  totalFines: number;

  /**
   * Authoritative projection of all approved fine waivers.
   */
  totalWaivedFines: number;

  /**
   * Cached final outstanding balance:
   *
   * totalDue
   * + totalFines
   * - totalWaivedFines
   * - amountPaid
   */
  outstandingBalance: number;

  fineStatus: FineStatus;

  repaymentStatus: LoanRepaymentStatus;

  guarantor: LoanGuarantor;

  status: LoanStatus;

  createdBy: LoanActor;

  authorizedBy: LoanActor;

  authorizedAt: Date;

  createdAt: Date;

  updatedAt: Date;
}

/* =========================================================
   CREATE LOAN
========================================================= */

export interface CreateLoanInput {
  memberId: string;

  type: LoanType;

  principal: number;

  guarantor: LoanGuarantor;

  /**
   * Percentage-based fine.
   *
   * Example:
   * 0.10 = 10%
   */
  fineRate?: number;

  repaymentDate?: Date;

  endDate?: Date;

  disbursementDate?: Date;
}

/* =========================================================
   REPAYMENT
========================================================= */

export interface LoanRepayment {
  id: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  memberNumber: string;

  amount: number;

  /**
   * Immutable bank/payment transaction reference.
   *
   * Must be globally unique.
   */
  transactionReference: string;

  transactionDate: Date;

  source: TransactionSource;

  rawMessage?: string;

  recordedBy?: LoanActor;

  createdAt: Date;
}

export interface CreateLoanRepaymentInput {
  /**
   * Preferred when the payment is already associated
   * with a specific loan.
   */
  loanId?: string;

  /**
   * Can be used when the system must safely resolve
   * the member's only open loan.
   */
  memberId?: string;

  amount: number;

  /**
   * Immutable idempotency key.
   */
  transactionReference: string;

  transactionDate: Date;

  source: TransactionSource;

  rawMessage?: string;

  recordedBy?: LoanActor;
}

/* =========================================================
   FINE
========================================================= */

export interface LoanFine {
  id: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  /**
   * Fine amount actually assessed.
   */
  amount: number;

  /**
   * Date the fine became assessable/was recorded.
   */
  fineDate: Date;

  /**
   * Percentage used to calculate the fine.
   *
   * Example:
   * 0.10 = 10%
   */
  fineRate: number;

  /**
   * Fixed repayment assessment cycle number.
   *
   * Cycle 1:
   * disbursement -> +7 days
   *
   * Cycle 2:
   * +7 days -> +14 days
   */
  periodNumber: number;

  periodStart: Date;

  periodEnd: Date;

  /**
   * Core outstanding balance used to calculate
   * this particular fine.
   *
   * Existing fines are excluded.
   */
  assessedCoreBalance: number;

  /**
   * How the fine was created.
   */
  source: FineSource;

  createdBy?: LoanActor;

  createdAt: Date;
}

/* =========================================================
   STOP / RESUME FINES
========================================================= */

export interface StopLoanFineInput {
  reason: string;
  stoppedBy: LoanActor;
}

/* =========================================================
   FINE WAIVER
========================================================= */

export interface LoanWaiver {
  id: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  amount: number;

  reason: string;

  waivedBy: LoanActor;

  createdAt: Date;
}

export interface CreateLoanWaiverInput {
  loanId: string;

  amount: number;

  reason: string;

  waivedBy: LoanActor;
}

/* =========================================================
   ASSESSMENT
========================================================= */

export interface LoanAssessment {
  id: string;

  loanId: string;

  loanNumber: string;

  memberId: string;

  memberNumber: string;

  /**
   * Fixed repayment cycle number.
   */
  periodNumber: number;

  periodStart: Date;

  periodEnd: Date;

  assessmentDate: Date;

  /**
   * Core balance at the beginning of the period.
   */
  openingCoreBalance: number;

  /**
   * Repayments recorded during this period.
   */
  paymentsDuringPeriod: number;

  /**
   * Core balance used when determining the fine.
   *
   * This must represent the balance applicable to the
   * completed period, not a future balance.
   */
  balanceBeforeFine: number;

  paymentMade: boolean;

  defaulted: boolean;

  fineRate: number;

  fineAmount: number;

  /**
   * Human-readable assessment state.
   */
  status: LoanAssessmentStatus;

  createdAt: Date;
}

/* =========================================================
   AUDIT
========================================================= */

export type LoanAuditAction =
  | "created"
  | "authorized"
  | "updated"
  | "repayment_recorded"
  | "fine_recorded"
  | "fine_stopped"
  | "assessment_recorded"
  | "waiver_recorded"
  | "cancelled"
  | "completed"
  | "defaulted";

export interface LoanAuditEntry {
  id: string;

  loanId: string;

  loanNumber: string;

  action: LoanAuditAction;

  actor: LoanActor;

  details: Record<string, unknown>;

  createdAt: Date;
}

/* =========================================================
   LIST OPTIONS
========================================================= */

export interface LoanListOptions {
  page?: number;

  limit?: number;

  status?: LoanStatus;

  type?: LoanType;

  repaymentStatus?: LoanRepaymentStatus;

  memberId?: string;

  repaymentDate?: Date | string;

  endDate?: Date | string;

  search?: string;
}

/* =========================================================
   PAGINATION
========================================================= */

export interface PaginatedLoans {
  loans: Loan[];

  total: number;

  page: number;

  limit: number;

  totalPages: number;
}

/* =========================================================
   SUMMARY
========================================================= */

export interface LoanSummary {
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
}