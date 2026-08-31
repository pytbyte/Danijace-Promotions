export type MemberStatus = "active" | "inactive" | "suspended";

export type MemberGender = "male" | "female" | "other";

export type Member = {
  _id?: string;

  membershipNumber: string;

  firstName: string;
  middleName?: string;
  lastName: string;

  gender?: MemberGender;
  dateOfBirth?: string;

  phone: string;
  email?: string;

  nationalId?: string;

  address?: string;
  city?: string;
  county?: string;

  occupation?: string;

  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;

  joinDate: string;

  status: MemberStatus;

  profileImage?: string;

  notes?: string;

  createdBy: string;
  updatedBy?: string;

  createdAt: string;
  updatedAt: string;
};