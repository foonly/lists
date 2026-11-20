import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Kept separate from vite.config.ts so tests don't load the PWA plugin
// (which writes a dev service worker to dev-dist/).
export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
