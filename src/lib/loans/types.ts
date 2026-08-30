/**
 * GEO-SHUA
 * Loan Domain Types
 *
 * Financial records are append-oriented.
 *
 * IMPORTANT:
 * - Public/domain IDs are strings.
 * - MongoDB persistence IDs are ObjectId values.
 * - Conversion happens at the persistence boundary.
 *
 * Existing loan terms are snapshots.
 * Changing global loan settings must NOT modify
 * an existing loan.
 */

export type LoanType =
  | "emergency"
  | "regular";

export type LoanStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled";

export type FineStatus =
  | "active"
  | "stopped";

export type FineSource =
  | "default"
  | "custom";

export type TransactionSource =
  | "manual"
  | "sms"
  | "system";

/**
 * Person responsible for creating, authorizing,
 * updating, or recording a financial action.
 */
export interface LoanActor {
  name: string;
  email: string;
}

/**
 * Loan guarantor snapshot.
 *
 * This information belongs to the loan record and
 * should remain unchanged even if the member's
 * information changes later.
 */
export interface LoanGuarantor {
  name: string;
  phone: string;
  idNumber?: string;
}

/**
 * Global loan configuration.
 *
 * These settings apply when a NEW loan is created.
 * They do not retroactively modify existing loans.
 */
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
   * Regular-loan eligibility.
   */
  regularMinimumSavings: number;
  regularSavingsMultiplier: number;

  /**
   * Number of calendar days after disbursement
   * before repayment becomes due.
   */
  repaymentGraceDays: number;

  /**
   * Default daily overdue fine.
   */
  defaultDailyFine: number;

  /**
   * Whether each loan type can currently be created.
   */
  emergencyLoansEnabled: boolean;
  regularLoansEnabled: boolean;

  /**
   * Last person who changed the settings.
   */
  updatedBy: LoanActor;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Loan record.
 *
 * Financial terms are snapshots captured when
 * the loan is created.
 */
export interface Loan {
  id: string;

  /**
   * Human-readable sequential loan number.
   *
   * Example:
   * LOAN-000001
   */
  loanNumber: string;

  /**
   * Public/domain member identifier.
   */
  memberId: string;

  /**
   * Member number and name are snapshots.
   *
   * This prevents historical loan records from
   * changing when member profile information changes.
   */
  memberNumber: string;
  memberName: string;

  type: LoanType;

  /**
   * Original principal issued.
   */
  principal: number;

  /**
   * Interest rate captured at loan creation.
   *
   * Example:
   * 0.30 = 30%
   */
  interestRate: number;

  /**
   * Interest calculated from the original principal.
   */
  interestAmount: number;

  /**
   * Daily overdue fine captured at loan creation.
   */
  dailyFine: number;

  /**
   * Whether dailyFine came from global settings
   * or was manually supplied during loan creation.
   */
  fineSource: FineSource;

  /**
   * Original disbursement date.
   */
  disbursementDate: Date;

  /**
   * First repayment due date.
   */
  firstDueDate: Date;

  /**
   * Original principal + interest.
   *
   * Fines are NOT included here because fines
   * are separate append-only financial records.
   */
  totalDue: number;

  /**
   * Current amount paid through repayment records.
   */
  amountPaid: number;

  /**
   * Current total of all recorded fines.
   */
  totalFines: number;

  /**
   * Current outstanding liability.
   *
   * outstandingBalance =
   *   totalDue +
   *   totalFines -
   *   amountPaid
   */
  outstandingBalance: number;

  /**
   * Controls whether future overdue fines can accrue.
   *
   * Existing fines remain part of the financial history
   * even when fineStatus becomes "stopped".
   */
  fineStatus: FineStatus;

  /**
   * Guarantor snapshot.
   */
  guarantor: LoanGuarantor;

  status: LoanStatus;

  /**
   * Loan creation actor.
   */
  createdBy: LoanActor;

  /**
   * Person who authorized the loan.
   */
  authorizedBy: LoanActor;

  /**
   * Time at which authorization occurred.
   */
  authorizedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input used to create a new loan.
 */
export interface CreateLoanInput {
  memberId: string;

  type: LoanType;

  /**
   * Required for both loan types.
   *
   * Regular:
   *   Must satisfy the configured savings multiplier.
   *
   * Emergency:
   *   Manually entered subject to the SACCO's
   *   emergency-loan rules.
   */
  principal: number;

  guarantor: LoanGuarantor;

  /**
   * Optional custom daily overdue fine.
   *
   * When omitted, the current global default is
   * captured into the loan.
   */
  dailyFine?: number;

  /**
   * Optional disbursement date.
   *
   * When omitted, the current server time is used.
   */
  disbursementDate?: Date;
}

/**
 * Persisted repayment transaction.
 *
 * Repayments are append-only.
 *
 * A repayment must never be edited or permanently
 * deleted in order to correct financial history.
 */
export interface LoanRepayment {
  id: string;

  loanId: string;
  loanNumber: string;

  memberId: string;
  memberNumber: string;

  /**
   * Positive amount actually received.
   */
  amount: number;

  /**
   * Unique transaction reference.
   *
   * For M-Pesa/SMS this should normally be the
   * M-Pesa transaction code.
   */
  transactionReference: string;

  /**
   * Time the payment actually occurred.
   */
  transactionDate: Date;

  source: TransactionSource;

  /**
   * Original SMS message where applicable.
   *
   * Kept for audit/reconciliation purposes.
   */
  rawMessage?: string;

  /**
   * Person/system that recorded the transaction.
   */
  recordedBy?: LoanActor;

  createdAt: Date;
}

/**
 * Input used when recording a repayment.
 *
 * Either loanId or memberId may be supplied.
 *
 * If only memberId is supplied, the service must
 * safely resolve exactly one open loan.
 */
export interface CreateLoanRepaymentInput {
  loanId?: string;

  memberId?: string;

  amount: number;

  /**
   * Mandatory idempotency key.
   *
   * This prevents the same SMS/M-Pesa transaction
   * from being recorded more than once.
   */
  transactionReference: string;

  transactionDate: Date;

  source: TransactionSource;

  /**
   * Original SMS where source === "sms".
   */
  rawMessage?: string;

  /**
   * Human/system actor recording the payment.
   */
  recordedBy?: LoanActor;
}

/**
 * A single overdue-fine event.
 *
 * Normally one system fine is recorded per applicable
 * calendar day.
 */
export interface LoanFine {
  id: string;

  loanId: string;
  loanNumber: string;

  memberId: string;

  /**
   * Amount charged for this particular fine event.
   */
  amount: number;

  /**
   * Calendar date to which this fine belongs.
   */
  fineDate: Date;

  /**
   * Daily fine rate captured at the time the fine
   * was created.
   */
  dailyFineRate: number;

  source:
    | "system"
    | "manual";

  /**
   * Optional actor for manually-created fines.
   */
  createdBy?: LoanActor;

  createdAt: Date;
}

/**
 * Input used to stop future fine accrual.
 *
 * Existing fine records are never removed.
 */
export interface StopLoanFineInput {
  reason: string;
  stoppedBy: LoanActor;
}

/**
 * Immutable audit history for loan operations.
 *
 * Audit entries are append-only.
 */
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
   * Structured historical information about the action.
   *
   * Examples:
   * - original loan terms
   * - repayment reference
   * - cancellation reason
   * - fine date
   * - setting changes
   */
  details?: Record<string, unknown>;

  createdAt: Date;
}