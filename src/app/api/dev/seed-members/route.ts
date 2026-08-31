import { NextResponse } from "next/server";

import { createMember } from "@/lib/members/service";

export async function POST() {
  try {
    const testMembers = [
      {
        firstName: "FRANCIS",
        middleName: "MWANGI",
        lastName: "KAMAU",
        gender: "male" as const,
        phone: "0719088000",
        mpesaName: "FRANCIS MWANGI KAMAU",
        email: "francis.test@geo-shua.local",
        nationalId: "100001",
        address: "Test Address 1",
        city: "Ruiru",
        county: "Kiambu",
        occupation: "Business",
        joinDate: "2026-08-26",
      },

      {
        firstName: "MARY",
        middleName: "WANJIKU",
        lastName: "KIMANI",
        gender: "female" as const,
        phone: "0718000001",
        mpesaName: "MARY WANJIKU KIMANI",
        email: "mary.test@geo-shua.local",
        nationalId: "100002",
        address: "Test Address 2",
        city: "Ruiru",
        county: "Kiambu",
        occupation: "Trader",
        joinDate: "2026-08-26",
      },

      {
        firstName: "PETER",
        middleName: "KAMAU",
        lastName: "NJOROGE",
        gender: "male" as const,
        phone: "0718000002",
        mpesaName: "PETER KAMAU NJOROGE",
        email: "peter.test@geo-shua.local",
        nationalId: "00003",
        address: "Test Address 3",
        city: "Ruiru",
        county: "Kiambu",
        occupation: "Driver",
        joinDate: "2026-08-26",
      },

      {
        firstName: "JANE",
        middleName: "NYAMBURA",
        lastName: "WACHIRA",
        gender: "female" as const,
        phone: "0718000003",
        mpesaName: "JANE NYAMBURA WACHIRA",
        email: "jane.test@geo-shua.local",
        nationalId: "00004",
        address: "Test Address 4",
        city: "Ruiru",
        county: "Kiambu",
        occupation: "Teacher",
        joinDate: "2026-08-26",
      },

      {
        firstName: "DAVID",
        middleName: "MUTURI",
        lastName: "KARIUKI",
        gender: "male" as const,
        phone: "0718000004",
        mpesaName: "DAVID MUTURI KARIUKI",
        email: "david.test@geo-shua.local",
        nationalId: "100005",
        address: "Test Address 5",
        city: "Ruiru",
        county: "Kiambu",
        occupation: "Technician",
        joinDate: "2026-08-26",
      },
    ];

    const created = [];

    for (const member of testMembers) {
      const result = await createMember(
        member,
        "dev-seed"
      );

      created.push(result);
    }

    return NextResponse.json({
      success: true,
      count: created.length,
      members: created.map((member) => ({
        id: member._id,
        membershipNumber:
          member.membershipNumber,
        name: [
          member.firstName,
          member.middleName,
          member.lastName,
        ]
          .filter(Boolean)
          .join(" "),
        mpesaName: member.mpesaName,
        phone: member.phone,
      })),
    });
  } catch (error) {
    console.error(
      "TEST MEMBER SEED ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to seed test members.",
      },
      {
        status: 500,
      }
    );
  }
}