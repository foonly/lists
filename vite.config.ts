import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
	plugins: [
		vue(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "Lists",
				short_name: "Lists",
				theme_color: "#4a90d9",
				background_color: "#ffffff",
				display: "standalone",
				start_url: "/",
				icons: [
					{
						src: "/icons/icon-192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "/icons/icon-512.png",
						sizes: "512x512",
						type: "image/png",
					},
				],
			},
		}),
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
