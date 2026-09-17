import type {
  Member,
  MemberGender,
  MemberStatus,
} from "./types";

export type MemberValidationErrors = Partial<
  Record<keyof Member, string>
>;

export type MemberValidationResult = {
  valid: boolean;
  errors: MemberValidationErrors;
};

/* =========================================================
   HELPERS
========================================================= */

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/* =========================================================
   PHONE VALIDATION
========================================================= */

/*
 * Canonical Kenyan mobile format:
 *
 * 0712345678
 * 0112345678
 *
 * We accept both 07 and 01 mobile prefixes after
 * normalization.
 */
const KENYAN_PHONE_REGEX = /^(?:07|01)\d{8}$/;

export function normalizePhone(phone: string): string {
  const value = clean(phone).replace(/\s+/g, "");

  /*
   * +254712345678
   *        ↓
   * 0712345678
   */
  if (value.startsWith("+254")) {
    return `0${value.slice(4)}`;
  }

  /*
   * 254712345678
   *       ↓
   * 0712345678
   */
  if (value.startsWith("254")) {
    return `0${value.slice(3)}`;
  }

  return value;
}

export function validatePhone(phone: string): boolean {
  const normalized = normalizePhone(phone);

  return KENYAN_PHONE_REGEX.test(normalized);
}

/* =========================================================
   EMAIL VALIDATION
========================================================= */

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(
  email?: string
): boolean {
  const value = clean(email);

  if (!value) return true;

  return EMAIL_REGEX.test(value);
}

/* =========================================================
   DATE VALIDATION
========================================================= */

function isValidDate(value: string): boolean {
  if (!value) return false;

  const date = new Date(value);

  return !Number.isNaN(date.getTime());
}

function isFutureDate(value: string): boolean {
  if (!value) return false;

  const date = new Date(value);
  const today = new Date();

  today.setHours(23, 59, 59, 999);

  return date > today;
}

/* =========================================================
   MEMBER VALIDATION
========================================================= */

export function validateMember(
  member: Partial<Member>
): MemberValidationResult {
  const errors: MemberValidationErrors = {};

  const firstName = clean(member.firstName);
  const middleName = clean(member.middleName);
  const lastName = clean(member.lastName);

  const membershipNumber = clean(
    member.membershipNumber
  );

  const phone = clean(member.phone);
  const email = clean(member.email);
  const nationalId = clean(member.nationalId);
  const joinDate = clean(member.joinDate);

  /* ---------------------------------------------
     MEMBERSHIP NUMBER
  --------------------------------------------- */

  if (!membershipNumber) {
    errors.membershipNumber =
      "Membership number is required.";
  } else if (membershipNumber.length < 3) {
    errors.membershipNumber =
      "Membership number is too short.";
  } else if (membershipNumber.length > 50) {
    errors.membershipNumber =
      "Membership number is too long.";
  }

  /* ---------------------------------------------
     NAME
  --------------------------------------------- */

  if (!firstName) {
    errors.firstName = "First name is required.";
  } else if (firstName.length < 2) {
    errors.firstName =
      "First name must contain at least 2 characters.";
  }

  if (middleName && middleName.length < 2) {
    errors.middleName =
      "Middle name must contain at least 2 characters.";
  }

  if (!lastName) {
    errors.lastName = "Last name is required.";
  } else if (lastName.length < 2) {
    errors.lastName =
      "Last name must contain at least 2 characters.";
  }

  /* ---------------------------------------------
     PHONE
  --------------------------------------------- */

  if (!phone) {
    errors.phone = "Phone number is required.";
  } else if (!validatePhone(phone)) {
    errors.phone =
      "Enter a valid Kenyan phone number.";
  }

  /* ---------------------------------------------
     EMAIL
  --------------------------------------------- */

  if (email && !validateEmail(email)) {
    errors.email =
      "Enter a valid email address.";
  }

  /* ---------------------------------------------
     NATIONAL ID
  --------------------------------------------- */

  if (nationalId) {
    if (!/^\d{5,20}$/.test(nationalId)) {
      errors.nationalId =
        "Enter a valid national ID number.";
    }
  }

  /* ---------------------------------------------
     GENDER
  --------------------------------------------- */

  if (member.gender) {
    const genders: MemberGender[] = [
      "male",
      "female",
      "other",
    ];

    if (!genders.includes(member.gender)) {
      errors.gender = "Invalid gender.";
    }
  }

  /* ---------------------------------------------
     DATE OF BIRTH
  --------------------------------------------- */

  if (member.dateOfBirth) {
    if (!isValidDate(member.dateOfBirth)) {
      errors.dateOfBirth =
        "Enter a valid date of birth.";
    } else if (isFutureDate(member.dateOfBirth)) {
      errors.dateOfBirth =
        "Date of birth cannot be in the future.";
    }
  }

  /* ---------------------------------------------
     JOIN DATE
  --------------------------------------------- */

  if (!joinDate) {
    errors.joinDate = "Join date is required.";
  } else if (!isValidDate(joinDate)) {
    errors.joinDate =
      "Enter a valid join date.";
  } else if (isFutureDate(joinDate)) {
    errors.joinDate =
      "Join date cannot be in the future.";
  }

  /* ---------------------------------------------
     STATUS
  --------------------------------------------- */

  if (member.status) {
    const statuses: MemberStatus[] = [
      "active",
      "inactive",
      "blacklisted",
    ];

    if (!statuses.includes(member.status)) {
      errors.status = "Invalid member status.";
    }
  }

  /* ---------------------------------------------
     NEXT OF KIN
  --------------------------------------------- */

  const nextOfKinName = clean(
    member.nextOfKinName
  );

  const nextOfKinPhone = clean(
    member.nextOfKinPhone
  );

  const nextOfKinRelationship = clean(
    member.nextOfKinRelationship
  );

  if (
    nextOfKinName ||
    nextOfKinPhone ||
    nextOfKinRelationship
  ) {
    if (!nextOfKinName) {
      errors.nextOfKinName =
        "Next of kin name is required.";
    }

    if (!nextOfKinPhone) {
      errors.nextOfKinPhone =
        "Next of kin phone is required.";
    } else if (!validatePhone(nextOfKinPhone)) {
      errors.nextOfKinPhone =
        "Enter a valid Kenyan phone number.";
    }

    if (!nextOfKinRelationship) {
      errors.nextOfKinRelationship =
        "Relationship is required.";
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/* =========================================================
   NORMALIZE MEMBER
========================================================= */

export function normalizeMember(
  member: Partial<Member>
): Partial<Member> {
  return {
    ...member,

    membershipNumber: clean(
      member.membershipNumber
    ).toUpperCase(),

    firstName: clean(member.firstName),

    middleName:
      clean(member.middleName) || undefined,

    lastName: clean(member.lastName),

    phone: normalizePhone(
      clean(member.phone)
    ),

    email:
      clean(member.email).toLowerCase() ||
      undefined,

    nationalId:
      clean(member.nationalId) || undefined,

    address:
      clean(member.address) || undefined,

    city:
      clean(member.city) || undefined,

    county:
      clean(member.county) || undefined,

    occupation:
      clean(member.occupation) || undefined,

    nextOfKinName:
      clean(member.nextOfKinName) || undefined,

    nextOfKinPhone:
      member.nextOfKinPhone
        ? normalizePhone(
            clean(member.nextOfKinPhone)
          )
        : undefined,

    nextOfKinRelationship:
      clean(member.nextOfKinRelationship) ||
      undefined,

    notes:
      clean(member.notes) || undefined,
  };
}
