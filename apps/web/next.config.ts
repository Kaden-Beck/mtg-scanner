import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 compiles a native addon; bundling it breaks the binding.
  // See ADR and KAD-6 for the Docker native-module constraints this avoids.
  serverExternalPackages: ["better-sqlite3", "sharp"],
};

export default nextConfig;
