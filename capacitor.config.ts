import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pytbyte.danijacepromotions",
  appName: "Danijace Promotions",
  webDir: "capacitor-assets",

  server: {
    url: "https://danijace-promotions.vercel.app",
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