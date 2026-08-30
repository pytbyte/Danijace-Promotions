import { SocialLogin } from "@capgo/capacitor-social-login";

const GOOGLE_WEB_CLIENT_ID =
  "247341240676-1lafr49l5cuf1uj0spifs77erl5hml68.apps.googleusercontent.com";

let initialized = false;

export async function initializeAndroidGoogle() {
  if (initialized) {
    return;
  }

  await SocialLogin.initialize({
    google: {
      webClientId: GOOGLE_WEB_CLIENT_ID,
      mode: "online",
    },
  });

  initialized = true;
}

export async function loginWithAndroidGoogle() {
  await initializeAndroidGoogle();

  return SocialLogin.login({
    provider: "google",
    options: {},
  });
}