import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['firebase-admin'],
};

export default withSentryConfig(nextConfig, {
  org: "otayori-calendar",
  project: "otayori-calendar",
  silent: true,
  disableLogger: true,
});
