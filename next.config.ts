import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default withPWA({
  dest: "public",
  register: true,
})(nextConfig);