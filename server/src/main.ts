import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/index.js";
import { openDb, createEventRepository, createVenueRepository } from "./adapters/outbound/repositories/sqlite.js";
import { createNominatimGeocoder } from "./adapters/outbound/geo/nominatim.js";
import { createServer } from "./adapters/inbound/http/server.js";
import { runSync } from "./application/services/sync.js";

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  const events = createEventRepository(db);
  const venues = createVenueRepository(db);
  const geocoder = createNominatimGeocoder();

  const server = createServer({ db, webDist: cfg.webDist, events, venues });
  server.listen(cfg.port, () => {
    console.log(`MIEvents server on http://localhost:${cfg.port} (db: ${cfg.dbPath})`);
  });

  const doSync = () =>
    runSync({ events, venues, geocoder }, { geocode: cfg.syncGeocode, maxGeocode: cfg.syncMaxGeocode })
      .then((r) => console.log("Sync:", JSON.stringify(r)))
      .catch((e) => console.error("Sync failed:", e.message));

  if (cfg.syncOnStart) void doSync();
  setInterval(() => void doSync(), cfg.syncIntervalMs).unref();
}
