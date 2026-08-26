import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pytbyte.geoshua",
  appName: "Geo Shua",
  webDir: "capacitor-assets",
  server: {
    url: "https://geo-shua.vercel.app",
    cleartext: false,
  },
};

export default config;