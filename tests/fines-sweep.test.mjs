import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSweepAsOfDate,
} from "../src/lib/loans/fines/sweep.ts";

test("normalizeSweepAsOfDate accepts ISO date strings", () => {
  const value = normalizeSweepAsOfDate("2026-09-15");
  assert.ok(value instanceof Date);
  assert.equal(value.toISOString().slice(0, 10), "2026-09-15");
});

test("normalizeSweepAsOfDate rejects invalid dates", () => {
  assert.throws(() => normalizeSweepAsOfDate("not-a-date"));
});

test("normalizeSweepAsOfDate defaults to now when empty", () => {
  const value = normalizeSweepAsOfDate(undefined);
  assert.ok(value instanceof Date);
  assert.ok(Number.isFinite(value.getTime()));
});
