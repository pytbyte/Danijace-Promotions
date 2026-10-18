import type {
  BankPaymentType,
  BankSource,
  ParsedBankSms,
} from "@/lib/sms/parser";

const LOAN_BANK_ACCOUNT = "082083";
const SAVINGS_BANK_ACCOUNT = "2650821";

/**
 * Decide which financial workflow receives a parsed SMS.
 * Known bank formats take precedence; legacy messages retain
 * the configured collection-account routing.
 */
export function classifySmsTransaction(
  bank: BankSource,
  destinationAccountNumber: string,
): BankPaymentType {
  if (bank === "equity" || bank === "ncba") {
    return "loan";
  }

  if (bank === "kcb") {
    return "savings";
  }

  const account = destinationAccountNumber
    .trim()
    .replace(/\s+/g, "");

  if (account === LOAN_BANK_ACCOUNT) {
    return "loan";
  }

  if (account === SAVINGS_BANK_ACCOUNT) {
    return "savings";
  }

  return "unknown";
}

/** The payer is credited for all three supported bank formats. */
export function getSmsMemberName(
  transaction: Pick<ParsedBankSms, "senderName">,
): string {
  return transaction.senderName;
}
