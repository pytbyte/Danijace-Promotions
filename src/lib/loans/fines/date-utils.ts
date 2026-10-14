export type CalendarDate = string;

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

function assertCalendarDate(value: unknown, fieldName: string): asserts value is CalendarDate {
  if (!isCalendarDate(value)) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DD calendar date.`);
  }
}

export function dateToKenyanCalendarDate(date: Date): CalendarDate {
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

function daysFromCivil(year: number, month: number, day: number): number {
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const monthPrime = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(value: number): { year: number; month: number; day: number } {
  const shifted = value + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);

  year += month <= 2 ? 1 : 0;

  return { year, month, day };
}

export function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  assertCalendarDate(value, "calendar date");

  if (!Number.isInteger(days)) {
    throw new Error("Calendar day offset must be a whole number.");
  }

  const result = civilFromDays(daysFromCivil(Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10))) + days);

  if (result.year < 1 || result.year > 9999) {
    throw new Error("Calendar date is outside the supported range.");
  }

  return `${String(result.year).padStart(4, "0")}-${String(result.month).padStart(2, "0")}-${String(result.day).padStart(2, "0")}`;
}

export function normalizeLoanCalendarDate(value: unknown, fieldName: string, loanNumber?: string): CalendarDate {
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

  throw new Error(`Invalid ${fieldName} for loan ${loanNumber ?? "unknown"}. Expected YYYY-MM-DD.`);
}
