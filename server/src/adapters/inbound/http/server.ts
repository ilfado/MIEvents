import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { EVENT_CATEGORIES, type EventCategory, type EventFilters, type PriceBand } from "@mievents/shared";
import { createEventRepository, createVenueRepository } from "../../outbound/repositories/sqlite.js";
import type { EventRepository, VenueRepository } from "../../../application/ports.js";
import { createSyncRunner, type SyncRunner } from "../../../application/services/sync.js";
import { createNominatimGeocoder } from "../../outbound/geo/nominatim.js";
import { parseIsoDate } from "../../../core/text.js";

const CSP = "default-src 'self'; script-src 'self' blob:; worker-src blob:; child-src blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'";

const SEC_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SEC_HEADERS,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let data = "";
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Body too large"), { statusCode: 413 }));
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
  const priceBand = p.get("priceBand");
  if (priceBand) f.priceBand = priceBand as PriceBand;
  if (p.get("includeBig") === "1") f.includeBig = true;
  if (p.get("includePast") === "1") f.includePast = true;
  if (p.get("all") === "1") f.all = true;
  if (p.get("geo") === "1") f.geoOnly = true;
  const limit = p.get("limit");
  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error("Invalid limit, expected a positive integer"), { statusCode: 400 });
    f.limit = n;
  }
  const offset = p.get("offset");
  if (offset != null) {
    const n = Number(offset);
    if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error("Invalid offset, expected a non-negative integer"), { statusCode: 400 });
    f.offset = n;
  }
  return f;
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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

export function createServer(deps: { db: DatabaseSync; webDist: string; events?: EventRepository; venues?: VenueRepository; syncRunner?: SyncRunner }): http.Server {
  const events = deps.events ?? createEventRepository(deps.db);
  const venues = deps.venues ?? createVenueRepository(deps.db);
  const webDist = deps.webDist;
  const syncRunner = deps.syncRunner ?? createSyncRunner({ events, venues, geocoder: createNominatimGeocoder() });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /api/health") return sendJson(res, 200, { ok: true });

      if (route === "GET /api/events") {
        try {
          return sendJson(res, 200, events.listEvents(parseFilters(url)));
        } catch (err) {
          const e = err as Error & { statusCode?: number };
          return sendJson(res, e.statusCode ?? 400, { error: e.message });
        }
      }

      if (route === "GET /api/events/cities") return sendJson(res, 200, { cities: events.listCities() });
      if (route === "GET /api/events/categories") return sendJson(res, 200, { categories: EVENT_CATEGORIES });
      if (route === "GET /api/venues") return sendJson(res, 200, { venues: venues.listVenues() });
      if (route === "GET /api/sync/state") return sendJson(res, 200, events.getSyncState());

      if (url.pathname.startsWith("/api/events/") && req.method === "GET") {
        const id = decodeURIComponent(url.pathname.slice("/api/events/".length));
        const event = events.getEvent(id);
        if (!event) return sendJson(res, 404, { error: "Event not found" });
        return sendJson(res, 200, event);
      }

      if (url.pathname.startsWith("/api/events/") && req.method === "POST") {
        const id = decodeURIComponent(url.pathname.slice("/api/events/".length));
        let body: { saved?: boolean };
        try {
          body = JSON.parse((await readBody(req)) || "{}") as { saved?: boolean };
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON body" });
        }
        if (typeof body.saved !== "boolean") return sendJson(res, 400, { error: "Body must be { saved: boolean }" });
        if (!events.setSaved(id, body.saved)) return sendJson(res, 404, { error: "Event not found" });
        return sendJson(res, 200, events.getEvent(id));
      }

      if (route === "GET /api/debug/source" && process.env.DEBUG_SOURCES === "1") {
        const name = url.searchParams.get("source") ?? "";
        const { defaultSources } = await import("../../../application/services/sync.js");
        const sources = defaultSources(process.env);
        const src = sources.find((s) => s.id === name);
        if (!src) return sendJson(res, 404, { error: "unknown source", available: sources.map((s) => s.id) });
        const ctx = {
          fetchImpl: fetch,
          fromDate: new Date().toISOString().slice(0, 10),
          toDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
          geocode: false,
          geocodeSleepMs: 0,
          maxGeocode: 0,
          limits: { bitArtists: 3, ticketmasterSize: 5 },
          env: process.env,
          venues,
          geocoder: { async geocode() { return null; } },
          now: () => new Date().toISOString(),
        };
        const t0 = Date.now();
        try {
          const result = await src.run(ctx as never);
          return sendJson(res, 200, { source: name, ok: true, events: result.events.length, ms: Date.now() - t0, sample: result.events.slice(0, 3) });
        } catch (err) {
          return sendJson(res, 200, { source: name, ok: false, error: (err as Error).message, ms: Date.now() - t0 });
        }
      }

      if (route === "POST /api/sync") {
        const syncToken = process.env.SYNC_TOKEN?.trim();
        if (syncToken) {
          const auth = req.headers.authorization ?? "";
          const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (!provided || !tokenMatches(provided, syncToken)) {
            return sendJson(res, 401, { error: "Unauthorized" });
          }
        }
        const from = url.searchParams.get("from");
        if (from) {
          try {
            parseIsoDate(from, "from");
          } catch (err) {
            return sendJson(res, 400, { error: (err as Error).message });
          }
        }
        const p = syncRunner.run({ fromDate: from ?? undefined });
        if (!p) return sendJson(res, 409, { error: "Sync already running" });
        void p
          .then((r) => events.setSyncState("last_sync_result", JSON.stringify(r)))
          .catch((err) => console.error("[sync] background failed:", (err as Error).message));
        return sendJson(res, 202, { started: true });
      }

      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const webRoot = path.resolve(webDist);
        const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
        let filePath = path.resolve(webRoot, "." + safe);
        if (filePath === webRoot) filePath = path.join(webRoot, "index.html");
        if (!filePath.startsWith(webRoot + path.sep)) return sendJson(res, 403, { error: "Forbidden" });
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          const index = path.join(webRoot, "index.html");
          if (!fs.existsSync(index)) return sendJson(res, 404, { error: "Not found" });
          res.writeHead(200, {
            "Content-Type": MIME[".html"],
            "Cache-Control": "no-cache",
            "Content-Security-Policy": CSP,
            ...SEC_HEADERS,
          });
          fs.createReadStream(index).pipe(res);
          return;
        }
        const ext = path.extname(filePath);
        const headers: Record<string, string> = {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
          ...SEC_HEADERS,
        };
        if (ext === ".html") headers["Content-Security-Policy"] = CSP;
        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode) return sendJson(res, e.statusCode, { error: e.message });
      console.error("[http] error:", err);
      sendJson(res, 500, { error: "Internal server error" });
    }
  });
}
