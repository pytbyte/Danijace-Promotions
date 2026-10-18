import test from "node:test";
import assert from "node:assert/strict";

import { parseBankSms } from "../src/lib/sms/parser.ts";
import {
  classifySmsTransaction,
  getSmsMemberName,
} from "../src/lib/sms/routing.ts";

const receivedAt = Date.parse("2026-10-19T09:00:00+03:00");

const messages = [
  {
    bank: "equity",
    type: "loan",
    senderName: "Moses Lobulu Lenaitaingang",
    reference: "UJHO1AK82I",
    amount: 220,
    transactionAt: "2026-10-16T21:00:00.000Z",
    body: "Confirmed. KES. 220.00 from Moses Lobulu Lenaitaingang received Ref. UJHO1AK82I on 17-10-2026 at 00:00. Thank you",
  },
  {
    bank: "kcb",
    type: "savings",
    senderName: "NOONKUTA KIKONYA",
    accountHolderName: "MARY WAIRIMU NG ANGA",
    reference: "UIU748DRH2",
    amount: 100,
    transactionAt: "2026-09-30T20:49:00.000Z",
    destinationAccountNumber: "8049660",
    body: "UIU748DRH2 completed. You have received KES 100 from NOONKUTA KIKONYA 254116162209 for account MARY WAIRIMU NG ANGA 8049660 on 30/09/2026 at 11:49 PM. KCB Go Ahead.",
  },
  {
    bank: "ncba",
    type: "loan",
    senderName: "CHRISPINUS OLUNGA",
    reference: "UJHFNAIYP5",
    amount: 850,
    transactionAt: "2026-10-17T08:12:00.000Z",
    destinationAccountNumber: "617521",
    body: "Dear MARY W a transaction of KES 850.00 for 617521 has been received from CHRISPINUS OLUNGA on 17/10/2026 11:12 AM. M-Pesa Ref: UJHFNAIYP5. NCBA, Go for it.",
  },
];

for (const message of messages) {
  test(`${message.bank} SMS parses the payer and routes to ${message.type}`, () => {
    const parsed = parseBankSms({
      address: message.bank.toUpperCase(),
      body: message.body,
      date: receivedAt,
    });

    assert.equal(parsed.bank, message.bank);
    assert.equal(parsed.senderName, message.senderName);
    assert.equal(getSmsMemberName(parsed), message.senderName);
    assert.equal(parsed.reference, message.reference);
    assert.equal(parsed.amount, message.amount);
    assert.equal(parsed.transactionDate.toISOString(), message.transactionAt);
    assert.equal(
      classifySmsTransaction(parsed.bank, parsed.destinationAccountNumber),
      message.type,
    );

    if (message.bank === "kcb") {
      assert.equal(parsed.accountHolderName, message.accountHolderName);
      assert.equal(parsed.senderName, "NOONKUTA KIKONYA");
      assert.notEqual(parsed.senderName, parsed.accountHolderName);
      assert.equal(parsed.destinationAccountNumber, message.destinationAccountNumber);
    }

    if (message.bank === "ncba") {
      assert.equal(parsed.destinationAccountNumber, message.destinationAccountNumber);
    }
  });
}

test("legacy destination account routing remains supported", () => {
  assert.equal(classifySmsTransaction("legacy", "082083"), "loan");
  assert.equal(classifySmsTransaction("legacy", "2650821"), "savings");
});
