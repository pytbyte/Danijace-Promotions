"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  signOut,
  useSession,
} from "next-auth/react";

import {
  ChevronDown,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  Wallet,
  X,
} from "lucide-react";

import {
  usePathname,
  useRouter,
} from "next/navigation";

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
   TOP BAR
========================================================= */

export default function TopBar() {
  const {
    data: session,
  } = useSession();

  const router =
    useRouter();

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

  /* =======================================================
     ANDROID GOOGLE USER
  ======================================================= */

  const [
    androidUser,
    setAndroidUser,
  ] =
    useState<AndroidGoogleUser | null>(
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
        authenticated ===
          "true" &&
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
     AUTHENTICATED USER
  ======================================================= */

  const user =
    session?.user;

  /*
   * NextAuth takes priority.
   *
   * Android falls back to the locally stored Google user
   * for DISPLAY purposes only.
   */
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
        /*
         * Clear Android local authentication data.
         */
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

        /*
         * Sign out of NextAuth when a server session exists.
         */
        if (session) {
          await signOut({
            callbackUrl:
              "/",
          });

          return;
        }

        /*
         * Android/local-only display authentication.
         */
        router.push(
          "/",
        );
      } catch (error) {
        console.error(
          "Sign out error:",
          error,
        );

        router.push(
          "/",
        );
      }
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
          {/* -------------------------------------------------
              MENU BUTTON
          ------------------------------------------------- */}

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

          {/* -------------------------------------------------
              MOBILE PROFILE
          ------------------------------------------------- */}

          <div className="relative flex min-w-0 items-center justify-end">
            <button
              type="button"
              onClick={() => {
                setProfileOpen(
                  (
                    value,
                  ) =>
                    !value,
                );

                setMobileOpen(
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
                transition
                hover:bg-white/[0.06]
              "
              aria-label="Open account menu"
            >
              {image ? (
                <img
                  src={
                    image
                  }
                  alt={
                    name
                  }
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
                    .charAt(
                      0,
                    )
                    .toUpperCase()}
                </div>
              )}
            </button>

            {/* ------------------------------------------------
                MOBILE PROFILE DROPDOWN
            ------------------------------------------------ */}

            {profileOpen && (
              <div
                className="
                  absolute
                  right-0
                  top-12
                  z-[80]
                  w-[min(285px,calc(100vw-24px))]
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
                        src={
                          image
                        }
                        alt={
                          name
                        }
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
                          .charAt(
                            0,
                          )
                          .toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {
                          name
                        }
                      </p>

                      <p className="mt-1 truncate text-xs text-white/35">
                        {
                          email ||
                          "No email"
                        }
                      </p>
                    </div>

                  </div>
                </div>

                <div className="p-2.5">

                 

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
          {/* -------------------------------------------------
              BRAND
          ------------------------------------------------- */}

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

          {/* =================================================
              DESKTOP NAVIGATION
          ================================================= */}

          <nav className="ml-auto flex min-w-0 items-center gap-1">

            {menuItems.map(
              (
                item,
              ) => {
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

                    <span
                      className="
                        hidden
                        whitespace-nowrap
                        xl:inline
                      "
                    >
                      {
                        item.label
                      }
                    </span>
                  </button>
                );
              },
            )}

          </nav>

          {/* =================================================
              DESKTOP PROFILE
          ================================================= */}

          <div className="relative ml-3 shrink-0 xl:ml-5">

            <button
              type="button"
              onClick={() => {
                setProfileOpen(
                  (
                    value,
                  ) =>
                    !value,
                );

                setMobileOpen(
                  false,
                );
              }}
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
                  src={
                    image
                  }
                  alt={
                    name
                  }
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
                    .charAt(
                      0,
                    )
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

            {/* =================================================
                DESKTOP PROFILE DROPDOWN
            ================================================= */}

            {profileOpen && (
              <div
                className="
                  absolute
                  right-0
                  top-14
                  z-[80]
                  w-[min(285px,calc(100vw-24px))]
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
                        src={
                          image
                        }
                        alt={
                          name
                        }
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
                          .charAt(
                            0,
                          )
                          .toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">

                      <p className="truncate text-sm font-semibold text-white">
                        {
                          name
                        }
                      </p>

                      <p className="mt-1 truncate text-xs text-white/35">
                        {
                          email ||
                          "No email"
                        }
                      </p>

                    </div>
                  </div>
                </div>

                <div className="p-2.5">

                  <button
                    type="button"
                    onClick={() =>
                      navigateTo(
                        "/dashboard/settings",
                      )
                    }
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
                    <Settings
                      size={18}
                      strokeWidth={1.8}
                    />

                    <span>
                      Account settings
                    </span>
                  </button>

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
        {/* =================================================
            MOBILE SIDEBAR HEADER
        ================================================= */}

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

        {/* =================================================
            MOBILE USER
        ================================================= */}

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
                src={
                  image
                }
                alt={
                  name
                }
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
                  .charAt(
                    0,
                  )
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
                {
                  name
                }
              </p>

              <p
                className="
                  mt-1
                  truncate
                  text-xs
                  text-white/35
                "
              >
                {
                  email ||
                  "No email"
                }
              </p>

            </div>
          </div>
        </div>

        {/* =================================================
            MOBILE NAVIGATION
        ================================================= */}

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
              (
                item,
              ) => {
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

        {/* =================================================
            MOBILE FOOTER
        ================================================= */}

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
    </>
  );
}