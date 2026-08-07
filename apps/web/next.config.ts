import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 compiles a native addon; bundling it breaks the binding.
  // See ADR and KAD-6 for the Docker native-module constraints this avoids.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  // Phone/LAN smoke hits the host by IP, not localhost. Without this, Next 16
  // blocks /_next/* and HMR, the client never hydrates, and Look up does a
  // native form GET to /scan? instead of POST /api/scan/resolve.
  allowedDevOrigins: ["192.168.0.152", "192.168.0.152:3000"],
};

export default nextConfig;
