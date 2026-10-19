import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // rocketride opens a websocket from Node; keep it out of the bundle.
  serverExternalPackages: ["rocketride"],
};

export default nextConfig;
