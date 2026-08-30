import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

/* =========================================================
   GOOGLE ID TOKEN VERIFICATION
========================================================= */

type GoogleTokenInfo = {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
  given_name?: string;
};

async function verifyAndroidGoogleToken(
  idToken: string,
) {
  const token = idToken.trim();

  if (!token) {
    return null;
  }

  /*
   * Ask Google to validate the ID token.
   *
   * This is server-to-server validation.
   * We do NOT trust the Android client or its decoded JWT.
   */
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
      token,
    )}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    console.error(
      "ANDROID GOOGLE TOKEN VERIFICATION FAILED:",
      response.status,
    );

    return null;
  }

  const googleUser =
    (await response.json()) as GoogleTokenInfo;

  /* -------------------------------------------------------
     VERIFY AUDIENCE
  ------------------------------------------------------- */

  const expectedAudience =
    process.env.GOOGLE_CLIENT_ID?.trim();

  if (
    !expectedAudience ||
    googleUser.aud !== expectedAudience
  ) {
    console.error(
      "ANDROID GOOGLE TOKEN AUDIENCE INVALID.",
    );

    return null;
  }

  /* -------------------------------------------------------
     VERIFY ISSUER
  ------------------------------------------------------- */

  if (
    googleUser.iss !==
      "https://accounts.google.com" &&
    googleUser.iss !==
      "accounts.google.com"
  ) {
    console.error(
      "ANDROID GOOGLE TOKEN ISSUER INVALID.",
    );

    return null;
  }

  /* -------------------------------------------------------
     VERIFY EMAIL
  ------------------------------------------------------- */

  if (
    googleUser.email_verified !==
    "true"
  ) {
    console.error(
      "ANDROID GOOGLE EMAIL IS NOT VERIFIED.",
    );

    return null;
  }

  /* -------------------------------------------------------
     REQUIRED GOOGLE IDENTITY
  ------------------------------------------------------- */

  if (
    !googleUser.sub ||
    !googleUser.email
  ) {
    console.error(
      "ANDROID GOOGLE TOKEN IS MISSING IDENTITY DATA.",
    );

    return null;
  }

  return {
    id: googleUser.sub,
    email: googleUser.email
      .trim()
      .toLowerCase(),
    name:
      googleUser.name?.trim() ||
      googleUser.given_name?.trim() ||
      "Google User",
    image:
      googleUser.picture?.trim() ||
      null,
  };
}

/* =========================================================
   NEXTAUTH
========================================================= */

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [
    /* -----------------------------------------------------
       WEB GOOGLE LOGIN
    ----------------------------------------------------- */

    Google({
      clientId:
        process.env.GOOGLE_CLIENT_ID!,
      clientSecret:
        process.env.GOOGLE_CLIENT_SECRET!,
    }),

    /* -----------------------------------------------------
       ANDROID GOOGLE LOGIN
    ----------------------------------------------------- */

    Credentials({
      id: "android-google",
      name: "Android Google",

      credentials: {
        idToken: {
          label: "Google ID Token",
          type: "text",
        },
      },

      async authorize(credentials) {
        const idToken =
          typeof credentials?.idToken ===
          "string"
            ? credentials.idToken.trim()
            : "";

        if (!idToken) {
          console.error(
            "ANDROID GOOGLE LOGIN: ID token missing.",
          );

          return null;
        }

        try {
          const googleUser =
            await verifyAndroidGoogleToken(
              idToken,
            );

          if (!googleUser) {
            return null;
          }

          /*
           * Returning this user causes NextAuth to create
           * its normal JWT session.
           *
           * This is the critical part that was missing.
           */
          return googleUser;
        } catch (error) {
          console.error(
            "ANDROID GOOGLE AUTHORIZE ERROR:",
            error,
          );

          return null;
        }
      },
    }),
  ],

  /* =======================================================
     SESSION
  ======================================================= */

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },

  /* =======================================================
     PAGES
  ======================================================= */

  pages: {
    signIn: "/",
    error: "/",
  },

  /* =======================================================
     SECRET
  ======================================================= */

  secret: process.env.AUTH_SECRET,
});