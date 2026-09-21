import clientPromise from "@/lib/mongodb/index";

const DB_NAME = "geo-shua";
const COLLECTION_NAME = "smsOutbox";

type IndexDefinition = {
  key: Record<string, 1 | -1>;
  name: string;
  unique?: boolean;
};

function sameIndexKey(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);

  if (aEntries.length !== bEntries.length) {
    return false;
  }

  return aEntries.every(
    ([field, direction], index) => {
      const [otherField, otherDirection] =
        bEntries[index] ?? [];

      return (
        field === otherField &&
        direction === otherDirection
      );
    },
  );
}

async function ensureIndex(
  collection: ReturnType<
    Awaited<typeof clientPromise>["db"]
  > extends never
    ? never
    : any,
  definition: IndexDefinition,
): Promise<void> {
  const existingIndexes =
    await collection.listIndexes().toArray();

  const equivalentIndex =
    existingIndexes.find((index: any) =>
      index.key &&
      sameIndexKey(
        index.key,
        definition.key,
      ),
    );

  /*
   * The required key already exists.
   *
   * The existing index may have a different name.
   * That is perfectly fine for our operational indexes.
   */
  if (equivalentIndex) {
    /*
     * A unique index is a business rule, not merely
     * a performance optimization.
     *
     * Never silently accept a non-unique equivalent
     * index where uniqueness is required.
     */
    if (
      definition.unique === true &&
      equivalentIndex.unique !== true
    ) {
      throw new Error(
        `Existing index "${equivalentIndex.name}" has the required key but is not unique.`,
      );
    }

    return;
  }

  /*
   * No equivalent key exists.
   *
   * Create the required index normally.
   */
  await collection.createIndex(
    definition.key,
    {
      name: definition.name,
      ...(definition.unique === true
        ? { unique: true }
        : {}),
    },
  );
}

/**
 * Ensures all indexes required by the SMS outbox exist.
 *
 * Safe to call repeatedly.
 *
 * Important:
 * MongoDB considers the index key definition separately
 * from the index name. Therefore an existing equivalent
 * index is reused even if it has a different name.
 */
export async function ensureSmsOutboxIndexes(): Promise<void> {
  const client =
    await clientPromise;

  const db =
    client.db(DB_NAME);

  const collection =
    db.collection(COLLECTION_NAME);

  /*
   * One SMS queue item per business event.
   */
  await ensureIndex(
    collection,
    {
      key: {
        idempotencyKey: 1,
      },
      name:
        "sms_outbox_idempotency_unique",
      unique: true,
    },
  );

  /*
   * Main worker queue:
   *
   * pending
   * availableAt
   * priority
   * createdAt
   */
  await ensureIndex(
    collection,
    {
      key: {
        status: 1,
        availableAt: 1,
        priority: 1,
        createdAt: 1,
      },
      name: "sms_outbox_queue",
    },
  );

  /*
   * Recovery of abandoned processing claims.
   */
  await ensureIndex(
    collection,
    {
      key: {
        status: 1,
        claimedAt: 1,
      },
      name: "sms_outbox_stale_claims",
    },
  );

  /*
   * Member-specific operational lookups.
   *
   * If an older { memberId: 1 } index exists,
   * we do not fail the application because of its
   * different name. However, the compound index
   * below is still created because it is a different
   * key definition and provides the intended lookup.
   */
  await ensureIndex(
    collection,
    {
      key: {
        memberId: 1,
        createdAt: -1,
      },
      name: "sms_outbox_member_created",
    },
  );

  /*
   * Loan-specific operational lookups.
   */
  await ensureIndex(
    collection,
    {
      key: {
        loanId: 1,
        createdAt: -1,
      },
      name: "sms_outbox_loan_created",
    },
  );
}