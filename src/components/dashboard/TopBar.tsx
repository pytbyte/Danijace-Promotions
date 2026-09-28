"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  signOut,
  useSession,
} from "next-auth/react";

import {
  Calculator,
  ChevronDown,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";

import {
  usePathname,
  useRouter,
} from "next/navigation";

import type { Loan } from "@/lib/loans/types";

/* =========================================================
   TYPES
========================================================= */

type MenuItem = {
  label: string;
  icon: React.ReactNode;
  href: string;
};

type AndroidGoogleUser = {
  email?: string;
  name?: string;
  picture?: string;
};

type LoanProfitPanelProps = {
  loans: Loan[];
  loading: boolean;
  error: string;
  from: string;
  to: string;
  rate: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onRateChange: (value: string) => void;
  onRetry: () => void;
};

/* =========================================================
   NAVIGATION
========================================================= */

const menuItems: MenuItem[] = [
  {
    label: "Dashboard",
    icon: (
      <LayoutDashboard
        size={18}
        strokeWidth={1.8}
      />
    ),
    href: "/dashboard",
  },
  {
    label: "Summary",
    icon: (
      <LayoutDashboard
        size={18}
        strokeWidth={1.8}
      />
    ),
    href: "/dashboard/summery",
  },
  {
    label: "Members",
    icon: (
      <Users
        size={18}
        strokeWidth={1.8}
      />
    ),
    href: "/dashboard/members",
  },
  {
    label: "Savings",
    icon: (
      <Wallet
        size={18}
        strokeWidth={1.8}
      />
    ),
    href: "/dashboard/savings",
  },
  {
    label: "Loans",
    icon: (
      <HandCoins
        size={18}
        strokeWidth={1.8}
      />
    ),
    href: "/dashboard/loans",
  },
];

/* =========================================================
   HELPERS
========================================================= */

function formatKES(
  value: number,
): string {
  return new Intl.NumberFormat(
    "en-KE",
    {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    },
  ).format(
    Number.isFinite(value)
      ? value
      : 0,
  );
}

/* =========================================================
   LOAN PROFIT PANEL
========================================================= */

function LoanProfitPanel({
  loans,
  loading,
  error,
  from,
  to,
  rate,
  onFromChange,
  onToChange,
  onRateChange,
  onRetry,
}: LoanProfitPanelProps) {
  const result = useMemo(() => {
    const interestRate = Number(rate);

    if (
      !Number.isFinite(
        interestRate,
      ) ||
      interestRate < 0
    ) {
      return {
        count: 0,
        principal: 0,
        profit: 0,
        total: 0,
      };
    }

    const matchingLoans =
      loans.filter(
        (loan) => {
          const date =
            loan.disbursementDate;

          /*
           * Loan calendar dates are stored
           * exactly as YYYY-MM-DD strings.
           *
           * Never convert these to JS Date.
           */
          if (
            typeof date !==
              "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(
              date,
            )
          ) {
            return false;
          }

          if (
            from &&
            date < from
          ) {
            return false;
          }

          if (
            to &&
            date > to
          ) {
            return false;
          }

          return true;
        },
      );

    const principal =
      matchingLoans.reduce(
        (
          total,
          loan,
        ) => {
          const amount =
            Number(
              loan.principal ??
                0,
            );

          return (
            total +
            (
              Number.isFinite(
                amount,
              )
                ? amount
                : 0
            )
          );
        },
        0,
      );

    const profit =
      principal *
      (
        interestRate /
        100
      );

    return {
      count:
        matchingLoans.length,
      principal,
      profit,
      total:
        principal +
        profit,
    };
  }, [
    loans,
    from,
    to,
    rate,
  ]);

  if (loading) {
    return (
      <div className="px-1 pb-2">
        <div
          className="
            rounded-xl
            border
            border-white/[0.08]
            bg-white/[0.025]
            p-3
          "
        >
          <div className="flex items-center justify-center gap-2 py-4">
            <div
              className="
                h-3
                w-3
                animate-spin
                rounded-full
                border
                border-white/15
                border-t-yellow-400
              "
            />
            <span className="text-[11px] text-white/35">
              Loading loans...
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-1 pb-2">
        <div
          className="
            rounded-xl
            border
            border-red-500/10
            bg-red-500/[0.035]
            p-3
          "
        >
          <div className="py-2 text-center">
            <p className="text-[11px] text-red-300/70">
              {error}
            </p>

            <button
              type="button"
              onClick={onRetry}
              className="
                mt-2
                rounded-lg
                border
                border-white/10
                bg-white/[0.04]
                px-3
                py-1.5
                text-[10px]
                font-medium
                text-white/60
                transition
                hover:bg-white/[0.08]
                hover:text-white
              "
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-1 pb-2">
      <div
        className="
          rounded-xl
          border
          border-white/[0.08]
          bg-white/[0.025]
          p-3
        "
      >
        {/* =================================================
            DATE RANGE
        ================================================= */}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              className="
                mb-1
                block
                text-[9px]
                uppercase
                tracking-wide
                text-white/30
              "
            >
              From
            </label>

            <input
              type="date"
              value={from}
              onChange={(event) =>
                onFromChange(
                  event.target.value,
                )
              }
              className="
                w-full
                rounded-lg
                border
                border-white/10
                bg-black/30
                px-2
                py-2
                text-[11px]
                text-white
                outline-none
                focus:border-yellow-500/40
              "
            />
          </div>

          <div>
            <label
              className="
                mb-1
                block
                text-[9px]
                uppercase
                tracking-wide
                text-white/30
              "
            >
              To
            </label>

            <input
              type="date"
              value={to}
              onChange={(event) =>
                onToChange(
                  event.target.value,
                )
              }
              className="
                w-full
                rounded-lg
                border
                border-white/10
                bg-black/30
                px-2
                py-2
                text-[11px]
                text-white
                outline-none
                focus:border-yellow-500/40
              "
            />
          </div>
        </div>

        {/* =================================================
            INTEREST RATE
        ================================================= */}

        <div className="mt-2">
          <label
            className="
              mb-1
              block
              text-[9px]
              uppercase
              tracking-wide
              text-white/30
            "
          >
            Interest %
          </label>

          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(event) =>
              onRateChange(
                event.target.value,
              )
            }
            placeholder="e.g. 15"
            className="
              w-full
              rounded-lg
              border
              border-white/10
              bg-black/30
              px-2.5
              py-2
              text-xs
              text-white
              outline-none
              placeholder:text-white/20
              focus:border-yellow-500/40
            "
          />
        </div>

        {/* =================================================
            RESULTS
        ================================================= */}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/[0.035] p-2">
            <p className="text-[8px] uppercase tracking-wide text-white/30">
              Loans
            </p>

            <p className="mt-0.5 text-xs font-semibold text-white">
              {result.count}
            </p>
          </div>

          <div className="rounded-lg bg-white/[0.035] p-2">
            <p className="text-[8px] uppercase tracking-wide text-white/30">
              Principal
            </p>

            <p className="mt-0.5 truncate text-xs font-semibold text-white">
              {formatKES(
                result.principal,
              )}
            </p>
          </div>

          <div className="rounded-lg bg-yellow-500/[0.08] p-2">
            <p className="text-[8px] uppercase tracking-wide text-yellow-500/50">
              Profit
            </p>

            <p className="mt-0.5 truncate text-xs font-semibold text-yellow-400">
              {formatKES(
                result.profit,
              )}
            </p>
          </div>

          <div className="rounded-lg bg-white/[0.035] p-2">
            <p className="text-[8px] uppercase tracking-wide text-white/30">
              Total
            </p>

            <p className="mt-0.5 truncate text-xs font-semibold text-white">
              {formatKES(
                result.total,
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   TOP BAR
========================================================= */

export default function TopBar() {
  const {
    data: session,
    status: sessionStatus,
  } = useSession();

  const router = useRouter();

  const pathname =
    usePathname();

  /* =======================================================
     UI STATE
  ======================================================= */

  const [
    profileOpen,
    setProfileOpen,
  ] = useState(false);

  const [
    mobileOpen,
    setMobileOpen,
  ] = useState(false);

  const [
    profitOpen,
    setProfitOpen,
  ] = useState(false);

  /* =======================================================
     AUTHORIZED USERS STATE
  ======================================================= */

  const [
    authorizedUsersOpen,
    setAuthorizedUsersOpen,
  ] = useState(false);

  const [
    authorizedEmail,
    setAuthorizedEmail,
  ] = useState("");

  const [
    authorizedEmailLoading,
    setAuthorizedEmailLoading,
  ] = useState(false);

  const [
    authorizedEmailMessage,
    setAuthorizedEmailMessage,
  ] = useState("");

  const [
    authorizedEmailError,
    setAuthorizedEmailError,
  ] = useState("");

  /* =======================================================
     AUTHORIZATION CHECK STATE
  ======================================================= */

  const [
    authorizationChecked,
    setAuthorizationChecked,
  ] = useState(false);

  const [
    isAuthorized,
    setIsAuthorized,
  ] = useState<boolean | null>(
    null,
  );

  const [
    authorizationError,
    setAuthorizationError,
  ] = useState("");

  const [
    showUnauthorizedModal,
    setShowUnauthorizedModal,
  ] = useState(false);

  /* =======================================================
     PROFIT CALCULATOR STATE
  ======================================================= */

  const [
    loans,
    setLoans,
  ] = useState<Loan[]>([]);

  const [
    loansLoading,
    setLoansLoading,
  ] = useState(false);

  const [
    loansError,
    setLoansError,
  ] = useState("");

  const [
    loanLoadVersion,
    setLoanLoadVersion,
  ] = useState(0);

  const [
    profitFrom,
    setProfitFrom,
  ] = useState("");

  const [
    profitTo,
    setProfitTo,
  ] = useState("");

  const [
    profitRate,
    setProfitRate,
  ] = useState("");

  /* =======================================================
     ANDROID GOOGLE USER
  ======================================================= */

  const [
    androidUser,
    setAndroidUser,
  ] = useState<AndroidGoogleUser | null>(
    null,
  );

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
    }

    try {
      const authenticated =
        localStorage.getItem(
          "android_google_authenticated",
        );

      const storedUser =
        localStorage.getItem(
          "android_google_user",
        );

      if (
        authenticated === "true" &&
        storedUser
      ) {
        const parsed =
          JSON.parse(
            storedUser,
          ) as AndroidGoogleUser;

        setAndroidUser(
          parsed,
        );
      } else {
        setAndroidUser(
          null,
        );
      }
    } catch (error) {
      console.error(
        "Unable to read Android Google user:",
        error,
      );

      setAndroidUser(
        null,
      );
    }
  }, []);

  /* =======================================================
     CHECK AUTHORIZATION
  ======================================================= */

  useEffect(() => {
    /*
     * Do not check while NextAuth is still resolving.
     */
    if (
      sessionStatus ===
      "loading"
    ) {
      return;
    }

    /*
     * The authorization endpoint uses auth()
     * on the server, so we need a real NextAuth
     * authenticated session before checking.
     */
    if (
      sessionStatus !==
        "authenticated" ||
      !session?.user?.email
    ) {
      setAuthorizationChecked(
        false,
      );

      setIsAuthorized(
        null,
      );

      setAuthorizationError(
        "",
      );

      setShowUnauthorizedModal(
        false,
      );

      return;
    }

    let cancelled = false;

    const checkAuthorization =
      async () => {
        try {
          setAuthorizationChecked(
            false,
          );

          setAuthorizationError(
            "",
          );

          const response =
            await fetch(
              "/api/access/emails",
              {
                method: "GET",
                headers: {
                  Accept:
                    "application/json",
                },
                cache: "no-store",
              },
            );

          const result =
            await response
              .json()
              .catch(
                () => null,
              );

          if (
            !response.ok
          ) {
            throw new Error(
              result?.error ||
                result?.message ||
                `Unable to verify authorization. HTTP ${response.status}`,
            );
          }

          const authorized =
            result?.authorized ===
              true ||
            result?.data
              ?.authorized ===
              true;

          if (
            cancelled
          ) {
            return;
          }

          setIsAuthorized(
            authorized,
          );

          setAuthorizationChecked(
            true,
          );

          setShowUnauthorizedModal(
            !authorized,
          );
        } catch (error) {
          if (
            cancelled
          ) {
            return;
          }

          console.error(
            "Unable to verify GEO-SHUA authorization:",
            error,
          );

          setAuthorizationError(
            error instanceof
              Error
              ? error.message
              : "Failed to verify account authorization.",
          );

          setAuthorizationChecked(
            true,
          );

          /*
           * Fail closed.
           *
           * If authorization cannot be
           * verified, do NOT allow access.
           */
          setIsAuthorized(
            false,
          );

          setShowUnauthorizedModal(
            true,
          );
        }
      };

    void checkAuthorization();

    return () => {
      cancelled = true;
    };
  }, [
    sessionStatus,
    session?.user?.email,
  ]);

  /* =======================================================
     CLOSE UNAUTHORIZED APP
  ======================================================= */

  const handleCloseUnauthorizedApp =
    async () => {
      try {
        /*
         * Capacitor App plugin.
         *
         * On Android this attempts to close
         * the native application.
         */
        const capacitor =
          (
            window as Window & {
              Capacitor?: {
                Plugins?: {
                  App?: {
                    exitApp?: () =>
                      Promise<void>;
                  };
                };
              };
            }
          ).Capacitor;

        const exitApp =
          capacitor?.Plugins
            ?.App?.exitApp;

        if (
          typeof exitApp ===
          "function"
        ) {
          await exitApp();
          return;
        }
      } catch (error) {
        console.error(
          "Unable to close GEO-SHUA Android application:",
          error,
        );
      }

      /*
       * Browser fallback.
       *
       * Most browsers will refuse to close
       * a tab that was not opened by script.
       */
      try {
        window.close();
      } catch (error) {
        console.error(
          "Unable to close browser window:",
          error,
        );
      }
    };

  /* =======================================================
     LOAD LOANS WHEN PROFIT CALCULATOR OPENS
  ======================================================= */

  useEffect(() => {
    if (!profitOpen) {
      return;
    }

    let cancelled = false;

    async function loadLoans() {
      try {
        setLoansLoading(
          true,
        );

        setLoansError("");

        /*
         * Existing production endpoint:
         *
         * GET /api/loans
         *
         * The endpoint accepts a maximum
         * limit of 1000.
         */
        const response =
          await fetch(
            "/api/loans?limit=1000",
            {
              method: "GET",
              cache: "no-store",
              headers: {
                Accept:
                  "application/json",
              },
            },
          );

        const result =
          await response
            .json()
            .catch(
              () => null,
            );

        if (
          !response.ok
        ) {
          throw new Error(
            result?.message ||
              result?.error ||
              `Unable to load loans. HTTP ${response.status}`,
          );
        }

        if (
          !result?.success
        ) {
          throw new Error(
            result?.message ||
              "The loan service returned an unsuccessful response.",
          );
        }

        if (
          !Array.isArray(
            result.data,
          )
        ) {
          throw new Error(
            "The loan service returned an invalid loan list.",
          );
        }

        const receivedLoans =
          result.data as Loan[];

        if (
          cancelled
        ) {
          return;
        }

        setLoans(
          receivedLoans,
        );

        setLoansError("");
      } catch (error) {
        if (
          cancelled
        ) {
          return;
        }

        const message =
          error instanceof
            Error
            ? error.message
            : "Unable to load loans.";

        console.error(
          "Unable to load loans for profit calculation:",
          error,
        );

        setLoans([]);

        setLoansError(
          message,
        );
      } finally {
        if (
          !cancelled
        ) {
          setLoansLoading(
            false,
          );
        }
      }
    }

    void loadLoans();

    return () => {
      cancelled = true;
    };
  }, [
    profitOpen,
    loanLoadVersion,
  ]);

  /* =======================================================
     RETRY LOAN LOAD
  ======================================================= */

  const retryLoanLoad =
    () => {
      setLoans([]);

      setLoansError("");

      setLoanLoadVersion(
        (value) =>
          value + 1,
      );
    };

  /* =======================================================
     ADD AUTHORIZED EMAIL
  ======================================================= */

  const addAuthorizedEmail =
    async () => {
      const normalizedEmail =
        authorizedEmail
          .trim()
          .toLowerCase();

      setAuthorizedEmailMessage(
        "",
      );

      setAuthorizedEmailError(
        "",
      );

      if (!normalizedEmail) {
        setAuthorizedEmailError(
          "Enter an email address.",
        );

        return;
      }

      const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (
        !emailRegex.test(
          normalizedEmail,
        )
      ) {
        setAuthorizedEmailError(
          "Enter a valid email address.",
        );

        return;
      }

      try {
        setAuthorizedEmailLoading(
          true,
        );

        const response =
          await fetch(
            "/api/access/emails",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Accept:
                  "application/json",
              },
              body: JSON.stringify({
                email:
                  normalizedEmail,
              }),
            },
          );

        const result =
          await response
            .json()
            .catch(
              () => null,
            );

        if (
          !response.ok
        ) {
          throw new Error(
            result?.error ||
              result?.message ||
              "Failed to add authorized email.",
          );
        }

        setAuthorizedEmail(
          "",
        );

        setAuthorizedEmailMessage(
          "Email added successfully.",
        );
      } catch (error) {
        console.error(
          "Unable to add authorized email:",
          error,
        );

        setAuthorizedEmailError(
          error instanceof
            Error
            ? error.message
            : "Failed to add authorized email.",
        );
      } finally {
        setAuthorizedEmailLoading(
          false,
        );
      }
    };

  /* =======================================================
     AUTHENTICATED USER
  ======================================================= */

  const user =
    session?.user;

  const name =
    user?.name ||
    androidUser?.name ||
    "User";

  const email =
    user?.email ||
    androidUser?.email ||
    "";

  const image =
    user?.image ||
    androidUser?.picture ||
    null;

  /* =======================================================
     NAVIGATION
  ======================================================= */

  const navigateTo = (
    href: string,
  ) => {
    setProfileOpen(
      false,
    );

    setProfitOpen(
      false,
    );

    setAuthorizedUsersOpen(
      false,
    );

    setMobileOpen(
      false,
    );

    router.push(
      href,
    );
  };

  /* =======================================================
     SIGN OUT
  ======================================================= */

  const handleSignOut =
    async () => {
      try {
        if (
          typeof window !==
          "undefined"
        ) {
          localStorage.removeItem(
            "android_google_user",
          );

          localStorage.removeItem(
            "android_google_authenticated",
          );
        }

        setAndroidUser(
          null,
        );

        if (session) {
          await signOut({
            callbackUrl: "/",
          });

          return;
        }

        router.push("/");
      } catch (error) {
        console.error(
          "Sign out error:",
          error,
        );

        router.push("/");
      }
    };

  /* =======================================================
     PROFILE TOGGLE
  ======================================================= */

  const toggleProfile =
    () => {
      setProfileOpen(
        (value) =>
          !value,
      );

      setProfitOpen(
        false,
      );

      setAuthorizedUsersOpen(
        false,
      );

      setMobileOpen(
        false,
      );
    };

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <>
      {/* =====================================================
          TOP BAR
      ===================================================== */}

      <header
        className="
          fixed
          inset-x-0
          top-0
          z-50
          h-16
          w-full
          border-b
          border-white/[0.08]
          bg-[#050505]/95
          backdrop-blur-xl
        "
      >
        {/* =================================================
            MOBILE TOP BAR
        ================================================= */}

        <div
          className="
            flex
            h-full
            w-full
            items-center
            justify-between
            px-3
            lg:hidden
          "
        >
          <div className="flex min-w-0 items-center justify-start">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(
                  true,
                );

                setProfileOpen(
                  false,
                );
              }}
              className="
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                rounded-xl
                text-white/60
                transition
                hover:bg-white/[0.06]
                hover:text-white
              "
              aria-label="Open menu"
            >
              <Menu
                size={23}
                strokeWidth={1.8}
              />
            </button>
          </div>

          {/* MOBILE PROFILE */}

          <div className="relative flex min-w-0 items-center justify-end">
            <button
              type="button"
              onClick={
                toggleProfile
              }
              className="
                flex
                h-10
                w-10
                shrink-0
                items-center
                justify-center
                rounded-xl
                transition
                hover:bg-white/[0.06]
              "
              aria-label="Open account menu"
            >
              {image ? (
                <img
                  src={image}
                  alt={name}
                  className="
                    h-9
                    w-9
                    rounded-full
                    object-cover
                    ring-1
                    ring-white/15
                  "
                />
              ) : (
                <div
                  className="
                    flex
                    h-9
                    w-9
                    items-center
                    justify-center
                    rounded-full
                    bg-yellow-500
                    text-sm
                    font-bold
                    text-black
                  "
                >
                  {name
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}
            </button>

            {profileOpen && (
              <div
                className="
                  absolute
                  right-0
                  top-12
                  z-[80]
                  w-[min(300px,calc(100vw-24px))]
                  overflow-hidden
                  rounded-2xl
                  border
                  border-white/10
                  bg-[#101010]
                  shadow-[0_25px_70px_rgba(0,0,0,0.55)]
                "
              >
                <div className="border-b border-white/[0.08] p-5">
                  <div className="flex items-center gap-3.5">
                    {image ? (
                      <img
                        src={image}
                        alt={name}
                        className="
                          h-12
                          w-12
                          shrink-0
                          rounded-full
                          object-cover
                          ring-2
                          ring-yellow-500/10
                        "
                      />
                    ) : (
                      <div
                        className="
                          flex
                          h-12
                          w-12
                          shrink-0
                          items-center
                          justify-center
                          rounded-full
                          bg-yellow-500
                          text-base
                          font-bold
                          text-black
                        "
                      >
                        {name
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {name}
                      </p>

                      <p className="mt-1 truncate text-xs text-white/35">
                        {email ||
                          "No email"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-2.5">
                  {/* MOBILE PROJECTIONS */}

                  <button
                    type="button"
                    onClick={() => {
                      setProfitOpen(
                        (value) =>
                          !value,
                      );

                      setAuthorizedUsersOpen(
                        false,
                      );
                    }}
                    className="
                      flex
                      w-full
                      items-center
                      gap-3
                      rounded-xl
                      px-3.5
                      py-3
                      text-sm
                      text-white/60
                      transition
                      hover:bg-white/[0.06]
                      hover:text-white
                    "
                  >
                    <Calculator
                      size={18}
                      strokeWidth={1.8}
                      className="text-yellow-400"
                    />

                    <span className="flex-1 text-left">
                      Projections
                    </span>

                    <ChevronDown
                      size={15}
                      strokeWidth={1.8}
                      className={`
                        text-white/30
                        transition-transform
                        ${
                          profitOpen
                            ? "rotate-180"
                            : ""
                        }
                      `}
                    />
                  </button>

                  {profitOpen && (
                    <LoanProfitPanel
                      loans={
                        loans
                      }
                      loading={
                        loansLoading
                      }
                      error={
                        loansError
                      }
                      from={
                        profitFrom
                      }
                      to={
                        profitTo
                      }
                      rate={
                        profitRate
                      }
                      onFromChange={
                        setProfitFrom
                      }
                      onToChange={
                        setProfitTo
                      }
                      onRateChange={
                        setProfitRate
                      }
                      onRetry={
                        retryLoanLoad
                      }
                    />
                  )}

                  {/* MOBILE AUTHORIZED USERS */}

                  <button
                    type="button"
                    onClick={() => {
                      setAuthorizedUsersOpen(
                        (value) =>
                          !value,
                      );

                      setProfitOpen(
                        false,
                      );

                      setAuthorizedEmailMessage(
                        "",
                      );

                      setAuthorizedEmailError(
                        "",
                      );
                    }}
                    className="
                      mt-1
                      flex
                      w-full
                      items-center
                      gap-3
                      rounded-xl
                      px-3.5
                      py-3
                      text-sm
                      text-white/60
                      transition
                      hover:bg-white/[0.06]
                      hover:text-white
                    "
                  >
                    <ShieldCheck
                      size={18}
                      strokeWidth={1.8}
                      className="text-yellow-400"
                    />

                    <span className="flex-1 text-left">
                      Authorized users
                    </span>

                    <ChevronDown
                      size={15}
                      strokeWidth={1.8}
                      className={`
                        text-white/30
                        transition-transform
                        ${
                          authorizedUsersOpen
                            ? "rotate-180"
                            : ""
                        }
                      `}
                    />
                  </button>

                  {authorizedUsersOpen && (
                    <div className="px-1 pb-2">
                      <div
                        className="
                          rounded-xl
                          border
                          border-white/[0.08]
                          bg-white/[0.025]
                          p-3
                        "
                      >
                        <p
                          className="
                            mb-2
                            text-[9px]
                            uppercase
                            tracking-wide
                            text-white/30
                          "
                        >
                          Add authorized email
                        </p>

                        <input
                          type="email"
                          value={
                            authorizedEmail
                          }
                          onChange={(
                            event,
                          ) => {
                            setAuthorizedEmail(
                              event
                                .target
                                .value,
                            );

                            setAuthorizedEmailError(
                              "",
                            );

                            setAuthorizedEmailMessage(
                              "",
                            );
                          }}
                          onKeyDown={(
                            event,
                          ) => {
                            if (
                              event.key ===
                              "Enter"
                            ) {
                              void addAuthorizedEmail();
                            }
                          }}
                          placeholder="user@gmail.com"
                          disabled={
                            authorizedEmailLoading
                          }
                          className="
                            w-full
                            rounded-lg
                            border
                            border-white/10
                            bg-black/30
                            px-2.5
                            py-2
                            text-xs
                            text-white
                            outline-none
                            placeholder:text-white/20
                            focus:border-yellow-500/40
                            disabled:opacity-50
                          "
                        />

                        {authorizedEmailError && (
                          <p className="mt-2 text-[10px] text-red-400">
                            {
                              authorizedEmailError
                            }
                          </p>
                        )}

                        {authorizedEmailMessage && (
                          <p className="mt-2 text-[10px] text-green-400">
                            {
                              authorizedEmailMessage
                            }
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            void addAuthorizedEmail()
                          }
                          disabled={
                            authorizedEmailLoading
                          }
                          className="
                            mt-2
                            w-full
                            rounded-lg
                            bg-yellow-500
                            px-3
                            py-2
                            text-[11px]
                            font-semibold
                            text-black
                            transition
                            hover:bg-yellow-400
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                          "
                        >
                          {authorizedEmailLoading
                            ? "Adding..."
                            : "Add email"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* MOBILE SIGN OUT */}

                  <button
                    type="button"
                    onClick={
                      handleSignOut
                    }
                    className="
                      mt-1
                      flex
                      w-full
                      items-center
                      gap-3
                      rounded-xl
                      px-3.5
                      py-3
                      text-sm
                      text-red-400
                      transition
                      hover:bg-red-500/[0.08]
                    "
                  >
                    <LogOut
                      size={18}
                      strokeWidth={1.8}
                    />

                    <span>
                      Sign out
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* =================================================
            DESKTOP TOP BAR
        ================================================= */}

        <div
          className="
            mx-auto
            hidden
            h-full
            w-full
            min-w-0
            items-center
            px-5
            lg:flex
            lg:px-7
            xl:px-10
          "
        >
          {/* BRAND */}

          <button
            type="button"
            onClick={() =>
              navigateTo(
                "/dashboard/summery",
              )
            }
            className="shrink-0"
            aria-label="Go to dashboard"
          >
            <div className="flex items-center gap-2.5">
              <img
                src="/logo.png"
                alt="GEO-SHUA"
                className="
                  h-9
                  w-auto
                  object-contain
                  sm:h-10
                "
              />

              <div className="hidden text-left xl:block">
                <p
                  className="
                    text-sm
                    font-semibold
                    tracking-[0.08em]
                    text-white
                  "
                >
                  GEO-SHUA
                </p>

                <p
                  className="
                    mt-0.5
                    text-[8px]
                    uppercase
                    tracking-[0.3em]
                    text-yellow-500/45
                  "
                >
                  Company
                </p>
              </div>
            </div>
          </button>

          {/* DESKTOP NAVIGATION */}

          <nav className="ml-auto flex min-w-0 items-center gap-1">
            {menuItems.map(
              (item) => {
                const active =
                  pathname ===
                    item.href ||
                  (
                    item.href !==
                      "/dashboard" &&
                    pathname.startsWith(
                      `${item.href}/`,
                    )
                  );

                return (
                  <button
                    key={
                      item.label
                    }
                    type="button"
                    onClick={() =>
                      navigateTo(
                        item.href,
                      )
                    }
                    className={`
                      flex
                      h-10
                      shrink-0
                      items-center
                      justify-center
                      gap-2
                      rounded-xl
                      px-2.5
                      text-[13px]
                      font-medium
                      transition-all
                      duration-200
                      xl:px-3
                      ${
                        active
                          ? "bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/10"
                          : "text-white/50 hover:bg-white/[0.05] hover:text-white"
                      }
                    `}
                  >
                    <span className="flex shrink-0 items-center justify-center">
                      {
                        item.icon
                      }
                    </span>

                    <span className="hidden whitespace-nowrap xl:inline">
                      {
                        item.label
                      }
                    </span>
                  </button>
                );
              },
            )}
          </nav>

          {/* DESKTOP PROFILE */}

          <div className="relative ml-3 shrink-0 xl:ml-5">
            <button
              type="button"
              onClick={
                toggleProfile
              }
              className="
                flex
                items-center
                gap-2
                rounded-xl
                p-1.5
                transition
                hover:bg-white/[0.06]
              "
              aria-label="Open account menu"
            >
              {image ? (
                <img
                  src={image}
                  alt={name}
                  className="
                    h-9
                    w-9
                    rounded-full
                    object-cover
                    ring-1
                    ring-white/15
                  "
                />
              ) : (
                <div
                  className="
                    flex
                    h-9
                    w-9
                    items-center
                    justify-center
                    rounded-full
                    bg-yellow-500
                    text-sm
                    font-bold
                    text-black
                  "
                >
                  {name
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}

              <ChevronDown
                size={16}
                strokeWidth={1.8}
                className={`
                  hidden
                  text-white/35
                  transition-transform
                  xl:block
                  ${
                    profileOpen
                      ? "rotate-180"
                      : ""
                  }
                `}
              />
            </button>

            {profileOpen && (
              <div
                className="
                  absolute
                  right-0
                  top-14
                  z-[80]
                  w-[min(300px,calc(100vw-24px))]
                  overflow-hidden
                  rounded-2xl
                  border
                  border-white/10
                  bg-[#101010]
                  shadow-[0_25px_70px_rgba(0,0,0,0.55)]
                "
              >
                <div className="border-b border-white/[0.08] p-5">
                  <div className="flex items-center gap-3.5">
                    {image ? (
                      <img
                        src={image}
                        alt={name}
                        className="
                          h-12
                          w-12
                          shrink-0
                          rounded-full
                          object-cover
                          ring-2
                          ring-yellow-500/10
                        "
                      />
                    ) : (
                      <div
                        className="
                          flex
                          h-12
                          w-12
                          shrink-0
                          items-center
                          justify-center
                          rounded-full
                          bg-yellow-500
                          text-base
                          font-bold
                          text-black
                        "
                      >
                        {name
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {name}
                      </p>

                      <p className="mt-1 truncate text-xs text-white/35">
                        {email ||
                          "No email"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-2.5">
                  {/* DESKTOP LOAN PROFIT */}

                  <button
                    type="button"
                    onClick={() => {
                      setProfitOpen(
                        (value) =>
                          !value,
                      );

                      setAuthorizedUsersOpen(
                        false,
                      );
                    }}
                    className="
                      flex
                      w-full
                      items-center
                      gap-3
                      rounded-xl
                      px-3.5
                      py-3
                      text-sm
                      text-white/60
                      transition
                      hover:bg-white/[0.06]
                      hover:text-white
                    "
                  >
                    <Calculator
                      size={18}
                      strokeWidth={1.8}
                      className="text-yellow-400"
                    />

                    <span className="flex-1 text-left">
                      Loan profit
                    </span>

                    <ChevronDown
                      size={15}
                      strokeWidth={1.8}
                      className={`
                        text-white/30
                        transition-transform
                        ${
                          profitOpen
                            ? "rotate-180"
                            : ""
                        }
                      `}
                    />
                  </button>

                  {profitOpen && (
                    <LoanProfitPanel
                      loans={
                        loans
                      }
                      loading={
                        loansLoading
                      }
                      error={
                        loansError
                      }
                      from={
                        profitFrom
                      }
                      to={
                        profitTo
                      }
                      rate={
                        profitRate
                      }
                      onFromChange={
                        setProfitFrom
                      }
                      onToChange={
                        setProfitTo
                      }
                      onRateChange={
                        setProfitRate
                      }
                      onRetry={
                        retryLoanLoad
                      }
                    />
                  )}

                  {/* =================================================
                      AUTHORIZED USERS
                  ================================================= */}

                  <button
                    type="button"
                    onClick={() => {
                      setAuthorizedUsersOpen(
                        (value) =>
                          !value,
                      );

                      setProfitOpen(
                        false,
                      );

                      setAuthorizedEmailMessage(
                        "",
                      );

                      setAuthorizedEmailError(
                        "",
                      );
                    }}
                    className="
                      mt-1
                      flex
                      w-full
                      items-center
                      gap-3
                      rounded-xl
                      px-3.5
                      py-3
                      text-sm
                      text-white/60
                      transition
                      hover:bg-white/[0.06]
                      hover:text-white
                    "
                  >
                    <ShieldCheck
                      size={18}
                      strokeWidth={1.8}
                      className="text-yellow-400"
                    />

                    <span className="flex-1 text-left">
                      Authorized users
                    </span>

                    <ChevronDown
                      size={15}
                      strokeWidth={1.8}
                      className={`
                        text-white/30
                        transition-transform
                        ${
                          authorizedUsersOpen
                            ? "rotate-180"
                            : ""
                        }
                      `}
                    />
                  </button>

                  {authorizedUsersOpen && (
                    <div className="px-1 pb-2">
                      <div
                        className="
                          rounded-xl
                          border
                          border-white/[0.08]
                          bg-white/[0.025]
                          p-3
                        "
                      >
                        <p
                          className="
                            mb-2
                            text-[9px]
                            uppercase
                            tracking-wide
                            text-white/30
                          "
                        >
                          Add authorized email
                        </p>

                        <input
                          type="email"
                          value={
                            authorizedEmail
                          }
                          onChange={(
                            event,
                          ) => {
                            setAuthorizedEmail(
                              event
                                .target
                                .value,
                            );

                            setAuthorizedEmailError(
                              "",
                            );

                            setAuthorizedEmailMessage(
                              "",
                            );
                          }}
                          onKeyDown={(
                            event,
                          ) => {
                            if (
                              event.key ===
                              "Enter"
                            ) {
                              void addAuthorizedEmail();
                            }
                          }}
                          placeholder="user@gmail.com"
                          disabled={
                            authorizedEmailLoading
                          }
                          className="
                            w-full
                            rounded-lg
                            border
                            border-white/10
                            bg-black/30
                            px-2.5
                            py-2
                            text-xs
                            text-white
                            outline-none
                            placeholder:text-white/20
                            focus:border-yellow-500/40
                            disabled:opacity-50
                          "
                        />

                        {authorizedEmailError && (
                          <p className="mt-2 text-[10px] text-red-400">
                            {
                              authorizedEmailError
                            }
                          </p>
                        )}

                        {authorizedEmailMessage && (
                          <p className="mt-2 text-[10px] text-green-400">
                            {
                              authorizedEmailMessage
                            }
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            void addAuthorizedEmail()
                          }
                          disabled={
                            authorizedEmailLoading
                          }
                          className="
                            mt-2
                            w-full
                            rounded-lg
                            bg-yellow-500
                            px-3
                            py-2
                            text-[11px]
                            font-semibold
                            text-black
                            transition
                            hover:bg-yellow-400
                            disabled:cursor-not-allowed
                            disabled:opacity-50
                          "
                        >
                          {authorizedEmailLoading
                            ? "Adding..."
                            : "Add email"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* SIGN OUT */}

                  <button
                    type="button"
                    onClick={
                      handleSignOut
                    }
                    className="
                      mt-1
                      flex
                      w-full
                      items-center
                      gap-3
                      rounded-xl
                      px-3.5
                      py-3
                      text-sm
                      text-red-400
                      transition
                      hover:bg-red-500/[0.08]
                    "
                  >
                    <LogOut
                      size={18}
                      strokeWidth={1.8}
                    />

                    <span>
                      Sign out
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* =====================================================
          MOBILE BACKDROP
      ===================================================== */}

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() =>
            setMobileOpen(
              false,
            )
          }
          className="
            fixed
            inset-0
            z-[60]
            bg-black/70
            backdrop-blur-sm
            lg:hidden
          "
        />
      )}

      {/* =====================================================
          MOBILE SIDEBAR
      ===================================================== */}

      <aside
        className={`
          fixed
          left-0
          top-0
          z-[70]
          flex
          h-[100dvh]
          w-[min(290px,85vw)]
          flex-col
          border-r
          border-white/[0.08]
          bg-[#090909]
          shadow-[20px_0_70px_rgba(0,0,0,0.5)]
          transition-transform
          duration-300
          lg:hidden
          ${
            mobileOpen
              ? "translate-x-0"
              : "-translate-x-full"
          }
        `}
      >
        {/* MOBILE SIDEBAR HEADER */}

        <div
          className="
            flex
            shrink-0
            items-center
            justify-between
            border-b
            border-white/[0.08]
            px-4
            py-4
          "
        >
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="GEO-SHUA"
              className="
                h-9
                w-9
                object-contain
              "
            />

            <div>
              <p
                className="
                  text-xs
                  font-semibold
                  tracking-[0.08em]
                  text-white
                "
              >
                GEO-SHUA
              </p>

              <p
                className="
                  text-[7px]
                  uppercase
                  tracking-[0.25em]
                  text-yellow-500/45
                "
              >
                Company
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              setMobileOpen(
                false,
              )
            }
            className="
              flex
              h-9
              w-9
              shrink-0
              items-center
              justify-center
              rounded-xl
              text-white/45
              transition
              hover:bg-white/[0.06]
              hover:text-white
            "
            aria-label="Close menu"
          >
            <X
              size={20}
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* MOBILE USER */}

        <div
          className="
            shrink-0
            border-b
            border-white/[0.08]
            p-5
          "
        >
          <div className="flex items-center gap-3.5">
            {image ? (
              <img
                src={image}
                alt={name}
                className="
                  h-11
                  w-11
                  shrink-0
                  rounded-full
                  object-cover
                  ring-2
                  ring-yellow-500/10
                "
              />
            ) : (
              <div
                className="
                  flex
                  h-11
                  w-11
                  shrink-0
                  items-center
                  justify-center
                  rounded-full
                  bg-yellow-500
                  font-bold
                  text-black
                "
              >
                {name
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p
                className="
                  truncate
                  text-sm
                  font-semibold
                  text-white
                "
              >
                {name}
              </p>

              <p
                className="
                  mt-1
                  truncate
                  text-xs
                  text-white/35
                "
              >
                {email ||
                  "No email"}
              </p>
            </div>
          </div>
        </div>

        {/* MOBILE NAVIGATION */}

        <nav
          className="
            min-h-0
            flex-1
            overflow-y-auto
            p-4
          "
        >
          <p
            className="
              mb-3
              px-3
              text-[10px]
              font-semibold
              uppercase
              tracking-[0.25em]
              text-white/25
            "
          >
            Features
          </p>

          <div className="space-y-1">
            {menuItems.map(
              (item) => {
                const active =
                  pathname ===
                    item.href ||
                  (
                    item.href !==
                      "/dashboard" &&
                    pathname.startsWith(
                      `${item.href}/`,
                    )
                  );

                return (
                  <button
                    key={
                      item.label
                    }
                    type="button"
                    onClick={() =>
                      navigateTo(
                        item.href,
                      )
                    }
                    className={`
                      flex
                      w-full
                      items-center
                      gap-3.5
                      rounded-xl
                      px-3.5
                      py-3
                      text-sm
                      font-medium
                      transition
                      ${
                        active
                          ? "bg-yellow-500/10 text-yellow-400"
                          : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                      }
                    `}
                  >
                    <span className="flex shrink-0 items-center justify-center">
                      {
                        item.icon
                      }
                    </span>

                    <span>
                      {
                        item.label
                      }
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </nav>

        {/* MOBILE FOOTER */}

        <div
          className="
            shrink-0
            border-t
            border-white/[0.08]
            p-4
          "
        >
          <button
            type="button"
            onClick={
              handleSignOut
            }
            className="
              flex
              w-full
              items-center
              gap-3.5
              rounded-xl
              px-3.5
              py-3
              text-sm
              font-medium
              text-red-400
              transition
              hover:bg-red-500/[0.08]
            "
          >
            <LogOut
              size={18}
              strokeWidth={1.8}
            />

            <span>
              Sign out
            </span>
          </button>
        </div>
      </aside>

      {/* =====================================================
          UNAUTHORIZED ACCESS MODAL
      ===================================================== */}

      {showUnauthorizedModal &&
        authorizationChecked &&
        isAuthorized === false && (
          <div
            className="
              fixed
              inset-0
              z-[9999]
              flex
              items-center
              justify-center
              bg-black/85
              px-4
              backdrop-blur-md
            "
            role="dialog"
            aria-modal="true"
            aria-labelledby="unauthorized-title"
          >
            <div
              className="
                w-full
                max-w-sm
                rounded-2xl
                border
                border-white/[0.08]
                bg-[#101010]
                p-6
                text-center
                shadow-[0_30px_100px_rgba(0,0,0,0.7)]
              "
            >
              <div
                className="
                  mx-auto
                  flex
                  h-14
                  w-14
                  items-center
                  justify-center
                  rounded-full
                  bg-red-500/[0.08]
                  ring-1
                  ring-red-500/10
                "
              >
                <ShieldCheck
                  size={27}
                  strokeWidth={1.7}
                  className="text-red-300"
                />
              </div>

              <h2
                id="unauthorized-title"
                className="
                  mt-4
                  text-base
                  font-semibold
                  text-white
                "
              >
                Not authorized
              </h2>

              <p
                className="
                  mx-auto
                  mt-2
                  max-w-xs
                  text-xs
                  leading-5
                  text-white/45
                "
              >
                Your account is not authorized
                to access GEO-SHUA.
              </p>

              {email ? (
                <div
                  className="
                    mt-4
                    rounded-xl
                    border
                    border-white/[0.06]
                    bg-white/[0.025]
                    px-3
                    py-2.5
                  "
                >
                  <p className="truncate text-[10px] text-white/35">
                    {email}
                  </p>
                </div>
              ) : null}

              {authorizationError ? (
                <p
                  className="
                    mt-3
                    text-[10px]
                    leading-4
                    text-red-300/60
                  "
                >
                  Authorization could not
                  be verified.
                </p>
              ) : null}

              <button
                type="button"
                onClick={() =>
                  void handleCloseUnauthorizedApp()
                }
                className="
                  mt-5
                  flex
                  h-11
                  w-full
                  items-center
                  justify-center
                  rounded-xl
                  bg-red-400
                  text-xs
                  font-bold
                  text-black
                  transition
                  hover:bg-red-300
                  active:scale-[0.99]
                "
              >
                Close App
              </button>
            </div>
          </div>
        )}
    </>
  );
}
