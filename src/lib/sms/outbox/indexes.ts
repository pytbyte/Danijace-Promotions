import clientPromise from "@/lib/mongodb/index";

const DB_NAME = "geo-shua";
const COLLECTION_NAME = "smsOutbox";

/**
 * Creates the indexes required by the SMS outbox.
 *
 * Safe to call repeatedly because MongoDB will keep existing
 * indexes instead of creating duplicates.
 */
export async function ensureSmsOutboxIndexes(): Promise<void> {
  const client =
    await clientPromise;

  const db =
    client.db(DB_NAME);

  const collection =
    db.collection(COLLECTION_NAME);

  /*
   * Critical:
   *
   * Guarantees that one business event can only create one
   * SMS queue item.
   *
   * Examples:
   *
   * savings_deposit:<transactionId>
   * loan_payment_received:<repaymentId>
   * loan_disbursement:<loanId>
   * loan_payment_reminder:<loanId>:<period>
   * loan_cleared:<loanId>
   */
  await collection.createIndex(
    {
      idempotencyKey: 1,
    },
    {
      unique: true,
      name: "sms_outbox_idempotency_unique",
    },
  );

  /*
   * Main worker queue index.
   *
   * Android normally asks for:
   *
   * status = pending
   * availableAt <= now
   *
   * and sorts by:
   *
   * priority → availableAt → createdAt
   */
  await collection.createIndex(
    {
      status: 1,
      availableAt: 1,
      priority: 1,
      createdAt: 1,
    },
    {
      name: "sms_outbox_queue",
    },
  );

  /*
   * Used when recovering abandoned processing claims.
   */
  await collection.createIndex(
    {
      status: 1,
      claimedAt: 1,
    },
    {
      name: "sms_outbox_stale_claims",
    },
  );

  /*
   * Useful for member/loan-specific operational lookups.
   */
  await collection.createIndex(
    {
      memberId: 1,
      createdAt: -1,
    },
    {
      name: "sms_outbox_member_created",
    },
  );

  await collection.createIndex(
    {
      loanId: 1,
      createdAt: -1,
    },
    {
      name: "sms_outbox_loan_created",
    },
  );
}

