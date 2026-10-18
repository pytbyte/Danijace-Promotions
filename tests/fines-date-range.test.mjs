import test from "node:test";
import assert from "node:assert/strict";

import {
  isCalendarDateAtOrBefore,
  isCalendarDateWithinRange,
} from "../src/lib/loans/fines/date-range.ts";

test("first-period window includes the exact start date", () => {
  const result = isCalendarDateWithinRange(
    "2026-10-05",
    "2026-10-05",
    "2026-10-12",
    true,
  );

  assert.equal(result, true);
});

test("later-period windows exclude the exact period start date at midnight", () => {
  const result = isCalendarDateWithinRange(
    new Date("2026-10-05T00:00:00.000Z"),
    "2026-10-05",
    "2026-10-12",
    false,
  );

  assert.equal(result, false);
});

test("string and date values are compared on the same calendar basis", () => {
  const result = isCalendarDateWithinRange(
    new Date("2026-10-06T12:00:00.000Z"),
    "2026-10-05",
    "2026-10-12",
    true,
  );

  assert.equal(result, true);
});

test("as-of cutoff includes payments on the cutoff date", () => {
  const result = isCalendarDateAtOrBefore("2026-10-12", "2026-10-12");

  assert.equal(result, true);
});
