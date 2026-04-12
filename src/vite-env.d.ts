/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	/** Base URL for the sync backend API, e.g. "http://localhost:8080/api/v1" */
	readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
