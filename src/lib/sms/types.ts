export type BankTransactionType =
  | "credit"
  | "debit"
  | "unknown";

export type BankAccountType =
  | "loan"
  | "savings"
  | "unknown";

export interface BankSmsMessage {
  address: string | null;
  body: string;
  date: number;
}

export interface ParsedBankTransaction {
  transactionReference: string;
  amount: number;
  transactionDate: Date;
  accountNumber: string;

  type: BankTransactionType;

  rawMessage: string;

  sender: string | null;
}

export interface ResolvedAccount {
  accountId: string;
  accountNumber: string;

  memberId: string;
  memberNumber: string;

  accountType: BankAccountType;

  loanId?: string;
  savingsAccountId?: string;
}