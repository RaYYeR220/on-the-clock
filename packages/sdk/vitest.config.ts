import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    // The reference ERC-5564 SDK ships extensionless ESM imports; let Vite resolve them.
    server: { deps: { inline: ["@scopelift/stealth-address-sdk"] } },
  },
});
