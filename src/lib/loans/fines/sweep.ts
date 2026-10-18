export function normalizeSweepAsOfDate(
  value?: string | Date,
): Date {
  if (value === undefined || value === null || value === "") {
    return new Date();
  }

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("Invalid as-of date.");
    }

    return new Date(value);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid as-of date.");
  }

  return date;
}

export async function sweepHistoricalLoanFines(
  asOfDate?: string | Date,
): Promise<{
  asOfDate: string;
  reconciledPeriods: number;
}> {
  const normalizedDate = normalizeSweepAsOfDate(asOfDate);

  const { accrueAllLoanFines } = await import(
    "./reconcile"
  );

  const reconciledPeriods = await accrueAllLoanFines(normalizedDate);

  return {
    asOfDate: normalizedDate.toISOString(),
    reconciledPeriods,
  };
}
