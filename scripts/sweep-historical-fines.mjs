#!/usr/bin/env node

const targetUrl =
  process.env.FINES_SWEEP_URL ?? "http://localhost:3000/api/loans/fines/sweep";

const secret = process.env.LOANS_FINE_SWEEP_SECRET;
const asOfDate =
  process.env.FINES_SWEEP_AS_OF_DATE ?? new Date().toISOString();

const response = await fetch(targetUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(secret
      ? { authorization: `Bearer ${secret}` }
      : {}),
  },
  body: JSON.stringify({ asOfDate }),
});

const payload = await response.json().catch(() => ({}));

console.log(
  JSON.stringify(
    {
      status: response.status,
      ok: response.ok,
      payload,
    },
    null,
    2,
  ),
);

if (!response.ok) {
  process.exit(1);
}
