import { ObjectId } from "mongodb";

import clientPromise from "@/lib/mongodb";

import type { Member } from "./types";

import {
  normalizeMember,
  validateMember,
} from "./validation";

/* =========================================================
   CONSTANTS
========================================================= */

const DB_NAME =
  process.env.MONGODB_DB || "geo-shua";

const COLLECTION_NAME = "members";

/* =========================================================
   MONGODB DOCUMENT TYPE

   The frontend uses:
     Member._id -> string

   MongoDB uses:
     MemberDocument._id -> ObjectId

   Keep these types separate.
========================================================= */

type MemberDocument = Omit<Member, "_id"> & {
  _id?: ObjectId;
};

/* =========================================================
   TYPES
========================================================= */

export type GetMembersOptions = {
  page?: number;
  limit?: number;
  search?: string;
};

export type PaginatedMembers = {
  members: Member[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/* =========================================================
   COLLECTION
========================================================= */

async function getCollection() {
  const client = await clientPromise;

  return client
    .db(DB_NAME)
    .collection<MemberDocument>(
      COLLECTION_NAME
    );
}

/* =========================================================
   HELPERS
========================================================= */

/**
 * Convert a MongoDB document into the application
 * Member type.
 *
 * MongoDB:
 *   _id: ObjectId
 *
 * Application:
 *   _id: string
 */
function toMember(
  document: MemberDocument
): Member {
  const { _id, ...data } = document;

  return {
    ...data,
    ...( _id
      ? {
          _id: _id.toString(),
        }
      : {}),
  } as Member;
}

/**
 * Safely convert a string into ObjectId.
 */
function createObjectId(
  id: string
): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid member ID");
  }

  return new ObjectId(id);
}

/**
 * Return the first validation error.
 */
function getFirstValidationError(
  errors: Record<string, string>
): string {
  return (
    Object.values(errors)[0] ||
    "Invalid member data"
  );
}

/**
 * Escape regex characters so user search input
 * cannot accidentally become a regex pattern.
 */
function escapeRegex(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/* =========================================================
   CREATE
========================================================= */

export async function createMember(
  data: Partial<Member>
): Promise<Member> {
  /* ---------------------------------------------
     NORMALIZE
  --------------------------------------------- */

  const normalized =
    normalizeMember(data);

  /* ---------------------------------------------
     VALIDATE
  --------------------------------------------- */

  const validation =
    validateMember(normalized);

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  const collection =
    await getCollection();

  /* ---------------------------------------------
     DUPLICATE MEMBERSHIP NUMBER
  --------------------------------------------- */

  if (normalized.membershipNumber) {
    const existingMembership =
      await collection.findOne({
        membershipNumber:
          normalized.membershipNumber,
      });

    if (existingMembership) {
      throw new Error(
        "A member with this membership number already exists."
      );
    }
  }

  /* ---------------------------------------------
     DUPLICATE PHONE
  --------------------------------------------- */

  if (normalized.phone) {
    const existingPhone =
      await collection.findOne({
        phone: normalized.phone,
      });

    if (existingPhone) {
      throw new Error(
        "A member with this phone number already exists."
      );
    }
  }

  /* ---------------------------------------------
     DUPLICATE EMAIL
  --------------------------------------------- */

  if (normalized.email) {
    const existingEmail =
      await collection.findOne({
        email: normalized.email,
      });

    if (existingEmail) {
      throw new Error(
        "A member with this email already exists."
      );
    }
  }

  /* ---------------------------------------------
     DUPLICATE NATIONAL ID
  --------------------------------------------- */

  if (normalized.nationalId) {
    const existingNationalId =
      await collection.findOne({
        nationalId:
          normalized.nationalId,
      });

    if (existingNationalId) {
      throw new Error(
        "A member with this national ID already exists."
      );
    }
  }

  /* ---------------------------------------------
     TIMESTAMPS
  --------------------------------------------- */

  const now =
    new Date().toISOString();

  /*
   * Do NOT include _id here.
   * MongoDB will generate it automatically.
   */

  const member: Omit<
    MemberDocument,
    "_id"
  > = {
    ...normalized,
    status:
      normalized.status || "active",
    createdAt: now,
    updatedAt: now,
  } as Omit<
    MemberDocument,
    "_id"
  >;

  /* ---------------------------------------------
     INSERT
  --------------------------------------------- */

  try {
    const result =
      await collection.insertOne(
        member
      );

    /* -------------------------------------------
       GET CREATED MEMBER
    ------------------------------------------- */

    const created =
      await collection.findOne({
        _id: result.insertedId,
      });

    if (!created) {
      throw new Error(
        "Member was created but could not be retrieved."
      );
    }

    return toMember(created);
  } catch (error) {
    /* -------------------------------------------
       MONGODB DUPLICATE KEY
    ------------------------------------------- */

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new Error(
        "A member with one of the supplied unique details already exists."
      );
    }

    throw error;
  }
}

/* =========================================================
   GET ONE
========================================================= */

export async function getMemberById(
  id: string
): Promise<Member | null> {
  /* ---------------------------------------------
     VALIDATE ID
  --------------------------------------------- */

  if (!ObjectId.isValid(id)) {
    return null;
  }

  const collection =
    await getCollection();

  /* ---------------------------------------------
     FIND MEMBER
  --------------------------------------------- */

  const member =
    await collection.findOne({
      _id: createObjectId(id),
    });

  if (!member) {
    return null;
  }

  return toMember(member);
}

/* =========================================================
   GET MEMBERS
========================================================= */

export async function getMembers(
  options: GetMembersOptions = {}
): Promise<PaginatedMembers> {
  const collection =
    await getCollection();

  /* ---------------------------------------------
     PAGE
  --------------------------------------------- */

  const page = Math.max(
    1,
    Number(options.page) || 1
  );

  /* ---------------------------------------------
     LIMIT

     Minimum: 1
     Maximum: 100
     Default: 25
  --------------------------------------------- */

  const limit = Math.min(
    100,
    Math.max(
      1,
      Number(options.limit) || 25
    )
  );

  /* ---------------------------------------------
     SEARCH
  --------------------------------------------- */

  const search =
    typeof options.search === "string"
      ? options.search.trim()
      : "";

  /* ---------------------------------------------
     FILTER
  --------------------------------------------- */

  const filter: Record<
    string,
    unknown
  > = {};

  if (search) {
    const regex = new RegExp(
      escapeRegex(search),
      "i"
    );

    filter.$or = [
      {
        membershipNumber: regex,
      },
      {
        firstName: regex,
      },
      {
        middleName: regex,
      },
      {
        lastName: regex,
      },
      {
        phone: regex,
      },
      {
        email: regex,
      },
      {
        nationalId: regex,
      },
    ];
  }

  /* ---------------------------------------------
     TOTAL COUNT
  --------------------------------------------- */

  const total =
    await collection.countDocuments(
      filter
    );

  /* ---------------------------------------------
     TOTAL PAGES
  --------------------------------------------- */

  const totalPages =
    total === 0
      ? 0
      : Math.ceil(total / limit);

  /* ---------------------------------------------
     SAFE PAGE

     Prevent requesting page 20 when only
     5 pages exist.
  --------------------------------------------- */

  const safePage =
    totalPages > 0
      ? Math.min(
          page,
          totalPages
        )
      : 1;

  /* ---------------------------------------------
     SKIP
  --------------------------------------------- */

  const skip =
    (safePage - 1) * limit;

  /* ---------------------------------------------
     FETCH MEMBERS
  --------------------------------------------- */

  const members =
    await collection
      .find(filter)
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .toArray();

  /* ---------------------------------------------
     RETURN
  --------------------------------------------- */

  return {
    members: members.map(toMember),
    total,
    page: safePage,
    limit,
    totalPages,
  };
}

/* =========================================================
   UPDATE
========================================================= */

export async function updateMember(
  id: string,
  data: Partial<Member>
): Promise<Member> {
  /* ---------------------------------------------
     VALIDATE ID
  --------------------------------------------- */

  if (!ObjectId.isValid(id)) {
    throw new Error(
      "Invalid member ID"
    );
  }

  const memberId =
    createObjectId(id);

  const collection =
    await getCollection();

  /* ---------------------------------------------
     GET EXISTING MEMBER
  --------------------------------------------- */

  const existing =
    await collection.findOne({
      _id: memberId,
    });

  if (!existing) {
    throw new Error(
      "Member not found."
    );
  }

  /* ---------------------------------------------
     NORMALIZE
  --------------------------------------------- */

  const normalized =
    normalizeMember(data);

  /* ---------------------------------------------
     MERGE EXISTING + NEW DATA
  --------------------------------------------- */

  const existingMember =
    toMember(existing);

  const merged: Member = {
    ...existingMember,
    ...normalized,
  };

  /* ---------------------------------------------
     VALIDATE COMPLETE MEMBER
  --------------------------------------------- */

  const validation =
    validateMember(merged);

  if (!validation.valid) {
    throw new Error(
      getFirstValidationError(
        validation.errors
      )
    );
  }

  /* ---------------------------------------------
     DUPLICATE MEMBERSHIP NUMBER
  --------------------------------------------- */

  if (normalized.membershipNumber) {
    const duplicate =
      await collection.findOne({
        membershipNumber:
          normalized.membershipNumber,

        _id: {
          $ne: memberId,
        },
      });

    if (duplicate) {
      throw new Error(
        "Another member already uses this membership number."
      );
    }
  }

  /* ---------------------------------------------
     DUPLICATE PHONE
  --------------------------------------------- */

  if (normalized.phone) {
    const duplicate =
      await collection.findOne({
        phone: normalized.phone,

        _id: {
          $ne: memberId,
        },
      });

    if (duplicate) {
      throw new Error(
        "Another member already uses this phone number."
      );
    }
  }

  /* ---------------------------------------------
     DUPLICATE EMAIL
  --------------------------------------------- */

  if (normalized.email) {
    const duplicate =
      await collection.findOne({
        email: normalized.email,

        _id: {
          $ne: memberId,
        },
      });

    if (duplicate) {
      throw new Error(
        "Another member already uses this email."
      );
    }
  }

  /* ---------------------------------------------
     DUPLICATE NATIONAL ID
  --------------------------------------------- */

  if (normalized.nationalId) {
    const duplicate =
      await collection.findOne({
        nationalId:
          normalized.nationalId,

        _id: {
          $ne: memberId,
        },
      });

    if (duplicate) {
      throw new Error(
        "Another member already uses this national ID."
      );
    }
  }

  /* ---------------------------------------------
     SAFE UPDATE DATA

     Remove application-only/protected fields
     BEFORE assigning the object to
     Partial<MemberDocument>.

     This prevents:
       string _id
       from being passed into MongoDB.
  --------------------------------------------- */

  const {
    _id: _ignoredId,
    createdAt: _ignoredCreatedAt,
    createdBy: _ignoredCreatedBy,
    ...safeUpdateData
  } = normalized;

  const updateData:
    Partial<MemberDocument> = {
    ...safeUpdateData,
    updatedAt:
      new Date().toISOString(),
  };

  /* ---------------------------------------------
     UPDATE
  --------------------------------------------- */

  try {
    const result =
      await collection.updateOne(
        {
          _id: memberId,
        },
        {
          $set: updateData,
        }
      );

    if (result.matchedCount === 0) {
      throw new Error(
        "Member not found."
      );
    }
  } catch (error) {
    /* -------------------------------------------
       MONGODB DUPLICATE KEY
    ------------------------------------------- */

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new Error(
        "A member with one of the supplied unique details already exists."
      );
    }

    throw error;
  }

  /* ---------------------------------------------
     GET UPDATED MEMBER
  --------------------------------------------- */

  const updated =
    await collection.findOne({
      _id: memberId,
    });

  if (!updated) {
    throw new Error(
      "Member was updated but could not be retrieved."
    );
  }

  return toMember(updated);
}

/* =========================================================
   DELETE
========================================================= */

export async function deleteMember(
  id: string
): Promise<boolean> {
  /* ---------------------------------------------
     VALIDATE ID
  --------------------------------------------- */

  if (!ObjectId.isValid(id)) {
    throw new Error(
      "Invalid member ID"
    );
  }

  const collection =
    await getCollection();

  /* ---------------------------------------------
     DELETE
  --------------------------------------------- */

  const result =
    await collection.deleteOne({
      _id: createObjectId(id),
    });

  return (
    result.deletedCount === 1
  );
}

/* =========================================================
   SEARCH
========================================================= */

export async function searchMembers(
  query: string,
  options: Omit<
    GetMembersOptions,
    "search"
  > = {}
): Promise<PaginatedMembers> {
  return getMembers({
    ...options,
    search: query,
  });
}