import { SocialLogin } from "@capgo/capacitor-social-login";

const GOOGLE_WEB_CLIENT_ID =
  "545484870581-2gt85vutfh9gd60hh230pl6fitmhk8vd.apps.googleusercontent.com";

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