import { describe, it, expect } from "vitest";
import { getAssessmentPeriod, getMaximumContractualPeriod } from "../reconcile";

import * as repository from "../repository";

function buildLoan(overrides: Partial<any> = {}) {
  return {
    loanNumber: "L-TEST-1",
    disbursementDate: "2026-09-01",
    endDate: "2026-10-01",
    repaymentCycleDays: 7,
    repaymentGraceDays: 0,
    fineRate: 0.1,
    installmentAmount: 1000,
    principal: 1000,
    interestAmount: 0,
    fineStatus: "active",
    status: "active",
    ...overrides,
  };
}

describe("Contractual period math", () => {
  it("calculates period start and end using cycleDays spacing and inclusive end", () => {
    const loan = buildLoan();

    // Period 1 should start on disbursement date and end after 6 days (inclusive)
    const p1 = getAssessmentPeriod(loan as any, 1);
    expect(p1.periodStart).toBe("2026-09-01");
    expect(p1.periodEnd).toBe("2026-09-07");

    // Period 2 should start immediately the next day
    const p2 = getAssessmentPeriod(loan as any, 2);
    expect(p2.periodStart).toBe("2026-09-08");
    expect(p2.periodEnd).toBe("2026-09-14");

    // Maximum contractual periods between 2026-09-01 and 2026-10-01 with 7-day cycles
    const max = getMaximumContractualPeriod(loan as any);
    // Manually compute: periods starting 2026-09-01,09-08,09-15,09-22,09-29 => 5 periods
    expect(max).toBe(5);
  });

  it("handles final short period correctly", () => {
    const loan = buildLoan({ endDate: "2026-09-10" });

    // Period 1: 2026-09-01 - 2026-09-07
    const p1 = getAssessmentPeriod(loan as any, 1);
    expect(p1.periodEnd).toBe("2026-09-07");

    // Period 2: start 2026-09-08 end should be loan.endDate (2026-09-10)
    const p2 = getAssessmentPeriod(loan as any, 2);
    expect(p2.periodStart).toBe("2026-09-08");
    expect(p2.periodEnd).toBe("2026-09-10");

    const max = getMaximumContractualPeriod(loan as any);
    expect(max).toBe(2);
  });
});
