/**
 * GEO-SHUA
 * Loan Domain Types
 *
 * Financial records are append-oriented.
 * Existing loan terms are retained as a snapshot when a loan is created.
 */

export type LoanType = "emergency" | "regular";

export type LoanStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled";

export type FineStatus = "active" | "stopped";

export type FineSource = "default" | "custom";

export type TransactionSource = "manual" | "sms" | "system";

export interface LoanActor {
  name: string;
  email: string;
}

export interface LoanGuarantor {
  name: string;
  phone: string;
  idNumber?: string;
}

export interface LoanSettings {
  id: string;

  /**
   * Interest rates are stored as decimal fractions.
   *
   * 30% = 0.30
   * 40% = 0.40
   */
  regularInterestRate: number;
  emergencyInterestRate: number;

  /**
   * Regular loan eligibility.
   */
  regularMinimumSavings: number;
  regularSavingsMultiplier: number;

  /**
   * Number of days after disbursement before the first
   * repayment becomes due.
   */
  repaymentGraceDays: number;

  /**
   * Default daily overdue fine.
   */
  defaultDailyFine: number;

  emergencyLoansEnabled: boolean;
  regularLoansEnabled: boolean;

  updatedBy: LoanActor;
  createdAt: Date;
  updatedAt: Date;
}

export interface Loan {
  id: string;
  loanNumber: string;

  memberId: string;
  memberNumber: string;
  memberName: string;

  type: LoanType;

  /**
   * Loan terms captured at creation time.
   * These must not automatically change when global
   * loan settings are changed.
   */
  principal: number;

  interestRate: number;
  interestAmount: number;

  dailyFine: number;
  fineSource: FineSource;

  disbursementDate: Date;
  firstDueDate: Date;

  /**
   * Loan totals captured from the terms at creation.
   */
  totalDue: number;

  /**
   * Current financial state.
   *
   * These values should be derived/updated from transactions
   * by the loan service.
   */
  amountPaid: number;
  totalFines: number;
  outstandingBalance: number;

  fineStatus: FineStatus;

  guarantor: LoanGuarantor;

  status: LoanStatus;

  createdBy: LoanActor;
  authorizedBy: LoanActor;
  authorizedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLoanInput {
  memberId: string;

  type: LoanType;

  /**
   * Required for both loan types.
   * For emergency loans this is manually entered.
   * For regular loans it must not exceed the configured
   * savings multiplier.
   */
  principal: number;

  guarantor: LoanGuarantor;

  /**
   * Optional custom daily fine.
   *
   * If omitted, the current loan-settings default is used.
   */
  dailyFine?: number;

  disbursementDate?: Date;
}

export interface LoanRepayment {
  id: string;

  loanId: string;
  loanNumber: string;

  memberId: string;
  memberNumber: string;

  amount: number;

  transactionReference: string;

  transactionDate: Date;

  source: TransactionSource;

  /**
   * Original SMS when the transaction originated
   * from the SMS parser.
   */
  rawMessage?: string;

  recordedBy?: LoanActor;

  createdAt: Date;
}

export interface CreateLoanRepaymentInput {
  loanId?: string;

  /**
   * Useful when the SMS parser identifies the member
   * before the loan itself is resolved.
   */
  memberId?: string;

  amount: number;

  /**
   * Must be unique.
   *
   * For M-Pesa/SMS this should normally be the M-Pesa
   * transaction/reference number.
   */
  transactionReference: string;

  transactionDate: Date;

  source: TransactionSource;

  rawMessage?: string;

  recordedBy?: LoanActor;
}

export interface LoanFine {
  id: string;

  loanId: string;
  loanNumber: string;

  memberId: string;

  /**
   * One record per applicable fine event/day.
   */
  amount: number;

  fineDate: Date;

  dailyFineRate: number;

  source: "system" | "manual";

  createdBy?: LoanActor;

  createdAt: Date;
}

export interface StopLoanFineInput {
  reason: string;
  stoppedBy: LoanActor;
}

export interface LoanAuditEntry {
  id: string;

  loanId: string;
  loanNumber: string;

  action:
    | "created"
    | "authorized"
    | "updated"
    | "repayment_recorded"
    | "fine_recorded"
    | "fine_stopped"
    | "cancelled"
    | "completed";

  actor: LoanActor;

  /**
   * Optional structured information describing
   * what changed.
   */
  details?: Record<string, unknown>;

  createdAt: Date;
}