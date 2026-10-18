export function parseCalendarValueToUtcDate(
  value: unknown,
): Date | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      return null;
    }

    return new Date(value.getTime());
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  const year = Number(trimmed.slice(0, 4));
  const month = Number(trimmed.slice(5, 7));
  const day = Number(trimmed.slice(8, 10));

  const parsed = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function isCalendarDateAtOrBefore(
  transactionDate: unknown,
  asOfDate: string,
): boolean {
  const asOf = parseCalendarValueToUtcDate(asOfDate);
  const paymentDate = parseCalendarValueToUtcDate(transactionDate);

  if (!asOf || !paymentDate) {
    return false;
  }

  const cutoffEnd = new Date(Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
    23,
    59,
    59,
    999,
  ));

  return paymentDate <= cutoffEnd;
}

export function isCalendarDateWithinRange(
  transactionDate: unknown,
  periodStart: string,
  periodEnd: string,
  includeStartBoundary: boolean,
): boolean {
  const paymentDate = parseCalendarValueToUtcDate(transactionDate);

  if (!paymentDate) {
    return false;
  }

  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T23:59:59.999Z`);

  if (includeStartBoundary) {
    return paymentDate >= start && paymentDate <= end;
  }

  return paymentDate > start && paymentDate <= end;
}
