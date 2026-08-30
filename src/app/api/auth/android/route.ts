import { NextResponse } from "next/server";

type GoogleTokenInfo = {
  iss?: string;
  azp?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  exp?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const idToken =
      typeof body?.idToken === "string"
        ? body.idToken.trim()
        : "";

    if (!idToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Google ID token is required.",
        },
        { status: 400 },
      );
    }

    /*
     * Ask Google to validate the ID token.
     *
     * We deliberately do not trust the token's decoded
     * contents until Google has confirmed the token.
     */
    const googleResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
        idToken,
      )}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    if (!googleResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid Google ID token.",
        },
        { status: 401 },
      );
    }

    const googleUser =
      (await googleResponse.json()) as GoogleTokenInfo;

    /*
     * IMPORTANT:
     *
     * This must match the OAuth Web Client ID used by
     * the Capacitor Google login.
     */
    const expectedAudience =
      "247341240676-1lafr49l5cuf1uj0spifs77erl5hml68.apps.googleusercontent.com";

    if (googleUser.aud !== expectedAudience) {
      return NextResponse.json(
        {
          success: false,
          error: "Google token audience is invalid.",
        },
        { status: 401 },
      );
    }

    /*
     * Verify Google issued the token.
     */
    if (
      googleUser.iss !==
        "https://accounts.google.com" &&
      googleUser.iss !==
        "accounts.google.com"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid Google token issuer.",
        },
        { status: 401 },
      );
    }

    /*
     * Google must have verified the email.
     */
    if (
      googleUser.email_verified !==
      "true"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Google email address is not verified.",
        },
        { status: 401 },
      );
    }

    if (
      !googleUser.sub ||
      !googleUser.email
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Google account information is incomplete.",
        },
        { status: 401 },
      );
    }

    /*
     * At this stage we are ONLY proving that the
     * Google identity can successfully reach our
     * backend and be verified.
     *
     * Admin/member authorization will come later.
     */
    return NextResponse.json({
      success: true,
      user: {
        googleId: googleUser.sub,
        email: googleUser.email,
        name:
          googleUser.name ||
          googleUser.given_name ||
          "Google User",
        picture:
          googleUser.picture || "",
      },
    });
  } catch (error) {
    console.error(
      "ANDROID GOOGLE AUTH ERROR:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to process Google authentication.",
      },
      { status: 500 },
    );
  }
}