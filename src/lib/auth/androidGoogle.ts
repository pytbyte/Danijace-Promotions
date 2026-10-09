import { SocialLogin } from "@capgo/capacitor-social-login";

const GOOGLE_WEB_CLIENT_ID =
  "545484870581-novr1gbgk3vhk20ghij5re4f9bfmfjjr.apps.googleusercontent.com";

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