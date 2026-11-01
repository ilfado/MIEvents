import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { EVENT_CATEGORIES, type EventCategory, type EventFilters, type SyncResult } from "@mievents/shared";
import { openDb } from "./db.js";
import { queryEvents, listCities, setSaved, getEvent } from "./query.js";
import { listVenues } from "./venues.js";
import { syncEvents } from "./sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "..", "data", "mievents.db");
const WEB_DIST = process.env.WEB_DIST ?? path.join(__dirname, "..", "..", "web", "dist");
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
const SYNC_GEOCODE = process.env.SYNC_GEOCODE !== "0";
const SYNC_ON_START = process.env.SYNC_ON_START !== "0";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseFilters(url: URL): EventFilters {
  const p = url.searchParams;
  const f: EventFilters = {};
  const q = p.get("q");
  if (q) f.q = q;
  const city = p.get("city");
  if (city) f.city = city;
  const category = p.get("category");
  if (category) f.category = category as EventCategory | "saved";
  const from = p.get("from");
  if (from) f.from = from;
  const to = p.get("to");
  if (to) f.to = to;
  const bbox = p.get("bbox");
  if (bbox) f.bbox = bbox;
  if (p.get("saved") === "1") f.savedOnly = true;
  if (p.get("includePast") === "1") f.includePast = true;
  return f;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

function serveStatic(res: http.ServerResponse, filePath: string): void {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(WEB_DIST, "index.html");
      if (fs.existsSync(index)) {
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        fs.createReadStream(index).pipe(res);
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

export function createServer(dbOverride?: DatabaseSync): http.Server {
  const db = dbOverride ?? openDb(DB_PATH);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /api/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (route === "GET /api/events") {
        try {
          return sendJson(res, 200, queryEvents(db, parseFilters(url)));
        } catch (err) {
          const e = err as Error & { statusCode?: number };
          return sendJson(res, e.statusCode ?? 400, { error: e.message });
        }
      }

      if (route === "GET /api/events/cities") {
        return sendJson(res, 200, { cities: listCities(db) });
      }

      if (route === "GET /api/events/categories") {
        return sendJson(res, 200, { categories: EVENT_CATEGORIES });
      }

      if (route === "GET /api/venues") {
        return sendJson(res, 200, { venues: listVenues(db) });
      }

      if (url.pathname.startsWith("/api/events/") && req.method === "GET") {
        const id = decodeURIComponent(url.pathname.slice("/api/events/".length));
        const event = getEvent(db, id);
        if (!event) return sendJson(res, 404, { error: "Event not found" });
        return sendJson(res, 200, event);
      }

      if (url.pathname.startsWith("/api/events/") && req.method === "POST") {
        const id = decodeURIComponent(url.pathname.slice("/api/events/".length));
        const body = JSON.parse((await readBody(req)) || "{}") as { saved?: boolean };
        if (typeof body.saved !== "boolean") {
          return sendJson(res, 400, { error: "Body must be { saved: boolean }" });
        }
        if (!setSaved(db, id, body.saved)) {
          return sendJson(res, 404, { error: "Event not found" });
        }
        const event = getEvent(db, id);
        return sendJson(res, 200, event);
      }

      if (route === "POST /api/sync") {
        const body = url.searchParams.get("from")
          ? { fromDate: url.searchParams.get("from") ?? undefined }
          : {};
        const result: SyncResult = await syncEvents(db, {
          fromDate: body.fromDate,
          geocode: SYNC_GEOCODE,
          maxGeocode: Number(process.env.SYNC_MAX_GEOCODE ?? 200),
          geocodeSleepMs: 1100,
        });
        return sendJson(res, 200, result);
      }

      if (route === "GET /api/sync/state") {
        const rows = db.prepare("SELECT key, value FROM sync_state").all() as { key: string; value: string }[];
        return sendJson(res, 200, Object.fromEntries(rows.map((r) => [r.key, r.value])));
      }

      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
        const filePath = path.join(WEB_DIST, safe === "/" ? "index.html" : safe);
        if (!filePath.startsWith(WEB_DIST)) return sendJson(res, 403, { error: "Forbidden" });
        return serveStatic(res, filePath);
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });
}

export function start(): http.Server {
  const db = openDb(DB_PATH);
  const server = createServer(db);
  server.listen(PORT, () => {
    console.log(`MIEvents server on http://localhost:${PORT} (db: ${DB_PATH})`);
  });
  if (SYNC_ON_START) {
    void syncEvents(db, {
      geocode: SYNC_GEOCODE,
      maxGeocode: Number(process.env.SYNC_MAX_GEOCODE ?? 200),
      geocodeSleepMs: 1100,
    })
      .then((r) => console.log("Initial sync:", JSON.stringify(r)))
      .catch((e) => console.error("Initial sync failed:", e.message));
  }
  setInterval(() => {
    void syncEvents(db, { geocode: SYNC_GEOCODE, maxGeocode: 50, geocodeSleepMs: 1100 })
      .then((r) => console.log("Scheduled sync:", JSON.stringify(r)))
      .catch((e) => console.error("Scheduled sync failed:", e.message));
  }, SYNC_INTERVAL_MS).unref();
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) start();
