import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pytbyte.geoshua",
  appName: "Geo Shua",
  webDir: "capacitor-assets",

  server: {
    url: "https://geo-shua.vercel.app",
    cleartext: false,
  },

  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;