import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  dbPath: string;
  webDist: string;
  syncIntervalMs: number;
  syncGeocode: boolean;
  syncOnStart: boolean;
  syncMaxGeocode: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 3001),
    dbPath: env.DB_PATH ?? path.join(__dirname, "..", "..", "data", "mievents.db"),
    webDist: env.WEB_DIST ?? path.join(__dirname, "..", "..", "..", "web", "dist"),
    syncIntervalMs: Number(env.SYNC_INTERVAL_MS ?? 6 * 60 * 60 * 1000),
    syncGeocode: env.SYNC_GEOCODE !== "0",
    syncOnStart: env.SYNC_ON_START !== "0",
    syncMaxGeocode: Number(env.SYNC_MAX_GEOCODE ?? 200),
  };
}
