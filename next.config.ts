import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "sharp", "file-type"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*",
      "./node_modules/.pnpm/@img+*/node_modules/@img/**/*",
      "./node_modules/.pnpm/sharp@*/node_modules/sharp/**/*",
    ],
  },
};

export default nextConfig;
