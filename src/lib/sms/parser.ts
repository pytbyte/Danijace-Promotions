/**
 * =========================================================
 * GEO-SHUA
 * BANK SMS PARSER
 * =========================================================
 *
 * RESPONSIBILITY
 * ---------------------------------------------------------
 * This parser ONLY parses and normalizes incoming bank SMS
 * messages.
 *
 * It does NOT:
 * - query members
 * - query savings accounts
 * - query loans
 * - create financial transactions
 * - modify balances
 *
 * The account number in the SMS is ONLY used to determine
 * whether the payment is:
 *
 *   loan
 *   savings
 *
 * The member is resolved later from the parsed sender name.
 * =========================================================
 */

import type { SmsMessage } from "@/lib/sms/SmsReader";

/* =========================================================
   TYPES
========================================================= */

export type BankPaymentType =
  | "loan"
  | "savings"
  | "unknown";

export type ParsedBankSms = {
  /**
   * Bank transaction/reference code.
   *
   * Example:
   * UHTHY4Z1PL
   */
  reference: string;

  /**
   * Positive amount received.
   */
  amount: number;

  /**
   * Name exactly as supplied by the bank SMS,
   * after basic whitespace normalization.
   */
  senderName: string;

  /**
   * Bank account number appearing in the SMS.
   *
   * This is a ROUTING value only.
   *
   * It does not identify a member or savings account.
   */
  accountNumber: string;

  /**
   * Determines which financial domain should handle
   * the transaction.
   */
  transactionType: BankPaymentType;

  /**
   * Bank-reported transaction date/time.
   */
  transactionDate: Date;

  /**
   * Original SMS sender/address.
   */
  address: string | null;

  /**
   * Original SMS body.
   *
   * Preserved for audit/reconciliation.
   */
  rawMessage: string;

  /**
   * Native Android SMS timestamp.
   *
   * This is kept separately from the date parsed from
   * the bank message.
   */
  smsDate: number;

  /**
   * Bank SMS status.
   *
   * Currently the supported format is "confirmed".
   */
  status: "confirmed";
};

/* =========================================================
   ROUTING
========================================================= */

/**
 * These numbers DO NOT identify members.
 *
 * They only identify the financial destination/type.
 *
 * Update these values to the actual GEO-SHUA bank
 * collection account numbers.
 */
const LOAN_BANK_ACCOUNT =
  "082083";

const SAVINGS_BANK_ACCOUNT =
  "2650821";

/* =========================================================
   ERRORS
========================================================= */

export class SmsParseError extends Error {
  constructor(
    message: string
  ) {
    super(message);

    this.name =
      "SmsParseError";
  }
}

/* =========================================================
   HELPERS
========================================================= */

function requireSmsBody(
  body: unknown
): string {
  if (
    typeof body !== "string" ||
    !body.trim()
  ) {
    throw new SmsParseError(
      "SMS body is empty."
    );
  }

  return body.trim();
}

function normalizeWhitespace(
  value: string
): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(
  value: string
): number {
  const normalized =
    value.replace(
      /,/g,
      ""
    );

  const amount =
    Number(normalized);

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new SmsParseError(
      "SMS contains an invalid transaction amount."
    );
  }

  return amount;
}

/* =========================================================
   REFERENCE
========================================================= */

/**
 * Extract:
 *
 * UHTHY4Z1PL
 *
 * from:
 *
 * UHTHY4Z1PL Confirmed. KES 1,400.00 ...
 */
function parseReference(
  body: string
): string {
  const match =
    body.match(
      /^([A-Z0-9]+)\s+Confirmed\./i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the bank transaction reference."
    );
  }

  return match[1].trim();
}

/* =========================================================
   AMOUNT
========================================================= */

/**
 * Extract:
 *
 * KES 1,400.00
 *
 * from the SMS.
 */
function parseAmountFromBody(
  body: string
): number {
  const match =
    body.match(
      /\bKES\s*([\d,]+(?:\.\d{1,2})?)\b/i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the transaction amount."
    );
  }

  return parseAmount(
    match[1]
  );
}

/* =========================================================
   SENDER NAME
========================================================= */

/**
 * Extract:
 *
 * FRANCIS MWANGI KAMAU
 *
 * from:
 *
 * received from FRANCIS MWANGI KAMAU for account...
 */
function parseSenderName(
  body: string
): string {
  const match =
    body.match(
      /\breceived\s+from\s+(.+?)\s+for\s+account\b/i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the sender name."
    );
  }

  const name =
    normalizeWhitespace(
      match[1]
    );

  if (!name) {
    throw new SmsParseError(
      "Sender name is empty."
    );
  }

  return name;
}

/* =========================================================
   ACCOUNT NUMBER
========================================================= */

/**
 * Extract:
 *
 * 2650821
 *
 * from:
 *
 * for account 2650821 on...
 */
function parseAccountNumber(
  body: string
): string {
  const match =
    body.match(
      /\bfor\s+account\s+([0-9]+)\b/i
    );

  if (!match?.[1]) {
    throw new SmsParseError(
      "Could not identify the bank account number."
    );
  }

  return match[1];
}

/* =========================================================
   TRANSACTION DATE
========================================================= */

/**
 * Supported format:
 *
 * 31/08/26 at 09:17 AM
 *
 * 29/08/26 at 11:43 PM
 */
function parseTransactionDate(
  body: string
): Date {
  const match =
    body.match(
      /\bon\s+(\d{2})\/(\d{2})\/(\d{2})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i
    );

  if (!match) {
    throw new SmsParseError(
      "Could not identify the transaction date."
    );
  }

  const [
    ,
    dayText,
    monthText,
    yearText,
    hourText,
    minuteText,
    meridiem,
  ] = match;

  const day =
    Number(dayText);

  const month =
    Number(monthText);

  const shortYear =
    Number(yearText);

  let hour =
    Number(hourText);

  const minute =
    Number(minuteText);

  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(shortYear) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new SmsParseError(
      "Invalid transaction date."
    );
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new SmsParseError(
      "Transaction date contains invalid values."
    );
  }

  /*
   * Bank messages use a two-digit year.
   *
   * 26 → 2026
   */
  const year =
    2000 + shortYear;

  /*
   * Convert 12-hour time to 24-hour time.
   */
  const normalizedMeridiem =
    meridiem.toUpperCase();

  if (
    normalizedMeridiem ===
    "AM"
  ) {
    if (hour === 12) {
      hour = 0;
    }
  } else {
    if (hour !== 12) {
      hour += 12;
    }
  }

  /*
   * JavaScript Date uses the local timezone when constructed
   * this way.
   *
   * GEO-SHUA operates in Kenya, so this represents the
   * bank's local transaction time.
   */
  const date =
    new Date(
      year,
      month - 1,
      day,
      hour,
      minute,
      0,
      0
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new SmsParseError(
      "Transaction date is invalid."
    );
  }

  /*
   * Protect against JavaScript normalizing impossible
   * calendar dates such as 31/02/26.
   */
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    throw new SmsParseError(
      "Transaction date is not a valid calendar date."
    );
  }

  return date;
}

/* =========================================================
   STATUS
========================================================= */

function parseStatus(
  body: string
): "confirmed" {
  if (
    !/\bConfirmed\./i.test(
      body
    )
  ) {
    throw new SmsParseError(
      "SMS is not a confirmed transaction."
    );
  }

  return "confirmed";
}

/* =========================================================
   ROUTING
========================================================= */

function determineTransactionType(
  accountNumber: string
): BankPaymentType {
  if (
    accountNumber ===
    LOAN_BANK_ACCOUNT
  ) {
    return "loan";
  }

  if (
    accountNumber ===
    SAVINGS_BANK_ACCOUNT
  ) {
    return "savings";
  }

  /*
   * NEVER guess.
   *
   * An unknown bank account must not accidentally become
   * a savings or loan transaction.
   */
  return "unknown";
}

/* =========================================================
   MAIN PARSER
========================================================= */

/**
 * Parse a single Android SMS.
 *
 * Example input:
 *
 * {
 *   address: "...",
 *   body: "UHTHY4Z1PL Confirmed. KES 1,400.00 received ...",
 *   date: 1788041580000
 * }
 */
export function parseBankSms(
  sms: SmsMessage
): ParsedBankSms {
  if (
    !sms ||
    typeof sms !== "object"
  ) {
    throw new SmsParseError(
      "Invalid SMS object."
    );
  }

  if (
    typeof sms.date !==
      "number" ||
    !Number.isFinite(
      sms.date
    )
  ) {
    throw new SmsParseError(
      "SMS timestamp is invalid."
    );
  }

  const body =
    requireSmsBody(
      sms.body
    );

  const reference =
    parseReference(
      body
    );

  const amount =
    parseAmountFromBody(
      body
    );

  const senderName =
    parseSenderName(
      body
    );

  const accountNumber =
    parseAccountNumber(
      body
    );

  const transactionDate =
    parseTransactionDate(
      body
    );

  const status =
    parseStatus(
      body
    );

  const transactionType =
    determineTransactionType(
      accountNumber
    );

  return {
    reference,

    amount,

    senderName,

    accountNumber,

    transactionType,

    transactionDate,

    address:
      sms.address ?? null,

    rawMessage:
      body,

    smsDate:
      sms.date,

    status,
  };
}

/* =========================================================
   BATCH PARSER
========================================================= */

export type ParseSmsResult =
  | {
      success: true;
      sms: SmsMessage;
      parsed: ParsedBankSms;
    }
  | {
      success: false;
      sms: SmsMessage;
      error: string;
    };

/**
 * Parse multiple SMS messages without allowing one malformed
 * message to stop the entire inbox processing operation.
 */
export function parseBankSmsBatch(
  messages: SmsMessage[]
): ParseSmsResult[] {
  if (!Array.isArray(messages)) {
    throw new SmsParseError(
      "SMS messages must be an array."
    );
  }

  return messages.map(
    (sms) => {
      try {
        return {
          success: true,
          sms,
          parsed:
            parseBankSms(
              sms
            ),
        };
      } catch (error) {
        return {
          success: false,
          sms,
          error:
            error instanceof Error
              ? error.message
              : "Unable to parse SMS.",
        };
      }
    }
  );
}