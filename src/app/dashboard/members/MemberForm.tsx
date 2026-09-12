"use client";

import { FormEvent, useState } from "react";
import {
  Calendar,
  MapPin,
  Phone,
  User,
  UserPlus,
  X,
} from "lucide-react";

import type {
  Member,
  MemberGender,
  MemberStatus,
} from "@/lib/members/types";

type MemberFormProps = {
  onClose: () => void;
  onSuccess: (member: Member) => void;
};

type FormData = {
  firstName: string;
  middleName: string;
  lastName: string;
  gender: MemberGender | "";
  dateOfBirth: string;
  phone: string;
  email: string;
  nationalId: string;
  address: string;
  city: string;
  county: string;
  occupation: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
  nextOfKinRelationship: string;
  joinDate: string;
  status: MemberStatus;
  notes: string;
};

const initialForm: FormData = {
  firstName: "",
  middleName: "",
  lastName: "",
  gender: "",
  dateOfBirth: "",
  phone: "",
  email: "",
  nationalId: "",
  address: "",
  city: "",
  county: "",
  occupation: "",
  nextOfKinName: "",
  nextOfKinPhone: "",
  nextOfKinRelationship: "",
  joinDate: new Date().toISOString().split("T")[0],
  status: "active",
  notes: "",
};

export default function MemberForm({
  onClose,
  onSuccess,
}: MemberFormProps) {
  const [form, setForm] = useState<FormData>(
    initialForm
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateField<K extends keyof FormData>(
    field: K,
    value: FormData[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setError("");

    /* =====================================================
       CLIENT-SIDE REQUIRED FIELD CHECKS
    ===================================================== */

    if (!form.firstName.trim()) {
      setError("First name is required.");
      return;
    }

    if (!form.lastName.trim()) {
      setError("Last name is required.");
      return;
    }

    if (!form.phone.trim()) {
      setError("Phone number is required.");
      return;
    }

    if (!form.joinDate) {
      setError("Join date is required.");
      return;
    }

    try {
      setSaving(true);

      /* ===================================================
         BUILD MEMBER PAYLOAD
      =================================================== */

      const payload = {
        firstName:
          form.firstName.trim(),

        middleName:
          form.middleName.trim() ||
          undefined,

        lastName:
          form.lastName.trim(),

        gender:
          form.gender ||
          undefined,

        dateOfBirth:
          form.dateOfBirth ||
          undefined,

        phone:
          form.phone.trim(),

        email:
          form.email.trim() ||
          undefined,

        nationalId:
          form.nationalId.trim() ||
          undefined,

        address:
          form.address.trim() ||
          undefined,

        city:
          form.city.trim() ||
          undefined,

        county:
          form.county.trim() ||
          undefined,

        occupation:
          form.occupation.trim() ||
          undefined,

        nextOfKinName:
          form.nextOfKinName.trim() ||
          undefined,

        nextOfKinPhone:
          form.nextOfKinPhone.trim() ||
          undefined,

        nextOfKinRelationship:
          form.nextOfKinRelationship.trim() ||
          undefined,

        joinDate:
          form.joinDate,

        status:
          form.status,

        notes:
          form.notes.trim() ||
          undefined,
      };

      /* ===================================================
         CREATE MEMBER
      =================================================== */

      const response = await fetch(
        "/api/members",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },

          body:
            JSON.stringify(payload),
        }
      );

      /* ===================================================
         PARSE SERVER RESPONSE
      =================================================== */

      let result: {
        success: boolean;
        data?: Member;
        error?: string;
      };

      try {
        result =
          await response.json();
      } catch {
        throw new Error(
          "The server returned an invalid response."
        );
      }

      /* ===================================================
         SERVER ERROR
      =================================================== */

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ||
            `Unable to register member. Server returned ${response.status}.`
        );
      }

      /* ===================================================
         VERIFY MEMBER DATA
      =================================================== */

      if (!result.data) {
        throw new Error(
          "Member was registered but no member data was returned."
        );
      }

      /* ===================================================
         SUCCESS
      =================================================== */

      onSuccess(result.data);
    } catch (err) {
      console.error(
        "Failed to register member:",
        err
      );

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(
          "Something went wrong while registering the member."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-end
        justify-center
        bg-black/40
        backdrop-blur-sm
        sm:items-center
        sm:p-4
      "
    >
      <div
        className="
          flex
          max-h-[95dvh]
          w-full
          flex-col
          overflow-hidden
          rounded-t-3xl
          border
          border-slate-200
          bg-white
          shadow-[0_30px_100px_rgba(15,23,42,0.20)]
          sm:max-w-3xl
          sm:rounded-3xl
        "
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div
          className="
            flex
            shrink-0
            items-center
            justify-between
            border-b
            border-slate-200
            bg-white
            px-5
            py-4
            sm:px-6
          "
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                rounded-xl
                bg-yellow-50
                text-yellow-700
              "
            >
              <UserPlus
                size={19}
                strokeWidth={1.8}
              />
            </div>

            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-black">
                Add Member
              </h2>

              <p className="mt-0.5 truncate text-[11px] text-black/50">
                Register a new SACCO member and savings account
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-xl
              text-black/40
              transition
              hover:bg-slate-100
              hover:text-black
              disabled:cursor-not-allowed
              disabled:opacity-40
            "
            aria-label="Close"
          >
            <X
              size={19}
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* =================================================
            FORM
        ================================================= */}

        <form
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="space-y-7 p-5 sm:p-6">

            {/* =================================================
                ERROR
            ================================================= */}

            {error && (
              <div
                role="alert"
                className="
                  rounded-xl
                  border
                  border-red-200
                  bg-red-50
                  px-4
                  py-3
                  text-xs
                  leading-5
                  text-red-700
                "
              >
                {error}
              </div>
            )}

            {/* =================================================
                PERSONAL INFORMATION
            ================================================= */}

            <FormSection
              icon={<User size={16} />}
              title="Personal information"
            >
              <div className="grid gap-4 sm:grid-cols-2">

                <Input
                  label="First Name"
                  value={
                    form.firstName
                  }
                  onChange={(value) =>
                    updateField(
                      "firstName",
                      value
                    )
                  }
                  placeholder="First name"
                  required
                />

                <Input
                  label="Middle Name"
                  value={
                    form.middleName
                  }
                  onChange={(value) =>
                    updateField(
                      "middleName",
                      value
                    )
                  }
                  placeholder="Middle name"
                />

                <Input
                  label="Last Name"
                  value={
                    form.lastName
                  }
                  onChange={(value) =>
                    updateField(
                      "lastName",
                      value
                    )
                  }
                  placeholder="Last name"
                  required
                />

                <Input
                  label="National ID"
                  value={
                    form.nationalId
                  }
                  onChange={(value) =>
                    updateField(
                      "nationalId",
                      value
                    )
                  }
                  placeholder="ID number"
                />

                <Select
                  label="Gender"
                  value={
                    form.gender
                  }
                  onChange={(value) =>
                    updateField(
                      "gender",
                      value as
                        | MemberGender
                        | ""
                    )
                  }
                  options={[
                    {
                      value: "",
                      label:
                        "Select gender",
                    },
                    {
                      value: "male",
                      label: "Male",
                    },
                    {
                      value: "female",
                      label: "Female",
                    },
                    {
                      value: "other",
                      label: "Other",
                    },
                  ]}
                />

                <Input
                  label="Date of Birth"
                  type="date"
                  value={
                    form.dateOfBirth
                  }
                  onChange={(value) =>
                    updateField(
                      "dateOfBirth",
                      value
                    )
                  }
                />

                <Input
                  label="Occupation"
                  value={
                    form.occupation
                  }
                  onChange={(value) =>
                    updateField(
                      "occupation",
                      value
                    )
                  }
                  placeholder="Occupation"
                />

              </div>
            </FormSection>

            {/* =================================================
                CONTACT
            ================================================= */}

            <FormSection
              icon={<Phone size={16} />}
              title="Contact information"
            >
              <div className="grid gap-4 sm:grid-cols-2">

                <Input
                  label="Phone"
                  type="tel"
                  value={
                    form.phone
                  }
                  onChange={(value) =>
                    updateField(
                      "phone",
                      value
                    )
                  }
                  placeholder="07XXXXXXXX"
                  required
                />

                <Input
                  label="Email"
                  type="email"
                  value={
                    form.email
                  }
                  onChange={(value) =>
                    updateField(
                      "email",
                      value
                    )
                  }
                  placeholder="member@example.com"
                />

                <Input
                  label="Address"
                  value={
                    form.address
                  }
                  onChange={(value) =>
                    updateField(
                      "address",
                      value
                    )
                  }
                  placeholder="Physical address"
                />

                <Input
                  label="City / Town"
                  value={
                    form.city
                  }
                  onChange={(value) =>
                    updateField(
                      "city",
                      value
                    )
                  }
                  placeholder="City or town"
                />

                <Input
                  label="County"
                  value={
                    form.county
                  }
                  onChange={(value) =>
                    updateField(
                      "county",
                      value
                    )
                  }
                  placeholder="County"
                />

              </div>
            </FormSection>

            {/* =================================================
                NEXT OF KIN
            ================================================= */}

            <FormSection
              icon={<UsersIcon />}
              title="Next of kin"
            >
              <div className="grid gap-4 sm:grid-cols-2">

                <Input
                  label="Name"
                  value={
                    form.nextOfKinName
                  }
                  onChange={(value) =>
                    updateField(
                      "nextOfKinName",
                      value
                    )
                  }
                  placeholder="Next of kin name"
                />

                <Input
                  label="Phone"
                  type="tel"
                  value={
                    form.nextOfKinPhone
                  }
                  onChange={(value) =>
                    updateField(
                      "nextOfKinPhone",
                      value
                    )
                  }
                  placeholder="07XXXXXXXX"
                />

                <Input
                  label="Relationship"
                  value={
                    form.nextOfKinRelationship
                  }
                  onChange={(value) =>
                    updateField(
                      "nextOfKinRelationship",
                      value
                    )
                  }
                  placeholder="e.g. Spouse, Brother"
                />

              </div>
            </FormSection>

            {/* =================================================
                MEMBERSHIP
            ================================================= */}

            <FormSection
              icon={<Calendar size={16} />}
              title="Membership"
            >
              <div className="grid gap-4 sm:grid-cols-2">

                <Input
                  label="Join Date"
                  type="date"
                  value={
                    form.joinDate
                  }
                  onChange={(value) =>
                    updateField(
                      "joinDate",
                      value
                    )
                  }
                  required
                />

                <Select
                  label="Status"
                  value={
                    form.status
                  }
                  onChange={(value) =>
                    updateField(
                      "status",
                      value as MemberStatus
                    )
                  }
                  options={[
                    {
                      value: "active",
                      label: "Active",
                    },
                    {
                      value: "inactive",
                      label: "Inactive",
                    },
                    {
                      value: "suspended",
                      label: "Suspended",
                    },
                  ]}
                />

              </div>
            </FormSection>

            {/* =================================================
                NOTES
            ================================================= */}

            <FormSection
              icon={<MapPin size={16} />}
              title="Additional information"
            >
              <div>

                <label className="mb-1.5 block text-[11px] font-medium text-black/60">
                  Notes
                </label>

                <textarea
                  value={
                    form.notes
                  }
                  onChange={(event) =>
                    updateField(
                      "notes",
                      event.target.value
                    )
                  }
                  rows={4}
                  placeholder="Optional notes about this member..."
                  className="
                    w-full
                    resize-none
                    rounded-xl
                    border
                    border-slate-200
                    bg-white
                    px-3.5
                    py-3
                    text-sm
                    text-black
                    outline-none
                    placeholder:text-black/30
                    focus:border-yellow-500/50
                    focus:ring-1
                    focus:ring-yellow-500/20
                  "
                />

              </div>
            </FormSection>

          </div>

          {/* =================================================
              FOOTER
          ================================================= */}

          <div
            className="
              sticky
              bottom-0
              flex
              shrink-0
              flex-col-reverse
              gap-2
              border-t
              border-slate-200
              bg-white/95
              p-4
              backdrop-blur-xl
              sm:flex-row
              sm:justify-end
              sm:px-6
            "
          >

            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="
                h-11
                rounded-xl
                border
                border-slate-200
                bg-white
                px-5
                text-sm
                font-medium
                text-black/60
                transition
                hover:bg-slate-50
                hover:text-black
                disabled:cursor-not-allowed
                disabled:opacity-40
              "
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="
                flex
                h-11
                items-center
                justify-center
                gap-2
                rounded-xl
                bg-yellow-500
                px-6
                text-sm
                font-semibold
                text-black
                transition
                hover:bg-yellow-400
                active:scale-[0.98]
                disabled:cursor-not-allowed
                disabled:opacity-50
              "
            >
              {saving ? (
                <>
                  <span
                    className="
                      h-4
                      w-4
                      animate-spin
                      rounded-full
                      border-2
                      border-black/30
                      border-t-black
                    "
                  />

                  Registering...
                </>
              ) : (
                <>
                  <UserPlus
                    size={16}
                    strokeWidth={2}
                  />

                  Add Member
                </>
              )}
            </button>

          </div>
        </form>
      </div>
    </div>
  );
}

/* =========================================================
   FORM SECTION
========================================================= */

function FormSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2">

        <span className="text-yellow-600">
          {icon}
        </span>

        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-black/60">
          {title}
        </h3>

      </div>

      {children}
    </section>
  );
}

/* =========================================================
   INPUT
========================================================= */

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>

      <label className="mb-1.5 block text-[11px] font-medium text-black/60">
        {label}

        {required && (
          <span className="ml-1 text-yellow-600">
            *
          </span>
        )}
      </label>

      <input
        type={type}
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
        placeholder={
          placeholder
        }
        required={required}
        className="
          h-11
          w-full
          rounded-xl
          border
          border-slate-200
          bg-white
          px-3.5
          text-sm
          text-black
          outline-none
          transition
          placeholder:text-black/30
          focus:border-yellow-500/50
          focus:bg-white
          focus:ring-1
          focus:ring-yellow-500/20
        "
      />

    </div>
  );
}

/* =========================================================
   SELECT
========================================================= */

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: {
    value: string;
    label: string;
  }[];
}) {
  return (
    <div>

      <label className="mb-1.5 block text-[11px] font-medium text-black/60">
        {label}
      </label>

      <select
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
        className="
          h-11
          w-full
          cursor-pointer
          rounded-xl
          border
          border-slate-200
          bg-white
          px-3.5
          text-sm
          text-black
          outline-none
          transition
          focus:border-yellow-500/50
          focus:ring-1
          focus:ring-yellow-500/20
        "
      >
        {options.map(
          (option) => (
            <option
              key={
                option.value
              }
              value={
                option.value
              }
              className="bg-white text-black"
            >
              {
                option.label
              }
            </option>
          )
        )}
      </select>

    </div>
  );
}

/* =========================================================
   NEXT OF KIN ICON
========================================================= */

function UsersIcon() {
  return (
    <div className="flex items-center">
      <User size={15} />
    </div>
  );
}