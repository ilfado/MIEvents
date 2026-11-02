import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { EVENT_CATEGORIES, type EventCategory, type EventFilters } from "@mievents/shared";
import { createEventRepository, createVenueRepository } from "../../outbound/repositories/sqlite.js";
import type { EventRepository, VenueRepository } from "../../../application/ports.js";
import { runSync } from "../../../application/services/sync.js";
import { createNominatimGeocoder } from "../../outbound/geo/nominatim.js";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
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
  if (p.get("all") === "1") f.all = true;
  if (p.get("geo") === "1") f.geoOnly = true;
  const limit = p.get("limit");
  if (limit) f.limit = Number(limit);
  const offset = p.get("offset");
  if (offset) f.offset = Number(offset);
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

export function createServer(deps: { db: DatabaseSync; webDist: string; events?: EventRepository; venues?: VenueRepository }): http.Server {
  const events = deps.events ?? createEventRepository(deps.db);
  const venues = deps.venues ?? createVenueRepository(deps.db);
  const webDist = deps.webDist;

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
        const body = JSON.parse((await readBody(req)) || "{}") as { saved?: boolean };
        if (typeof body.saved !== "boolean") return sendJson(res, 400, { error: "Body must be { saved: boolean }" });
        if (!events.setSaved(id, body.saved)) return sendJson(res, 404, { error: "Event not found" });
        return sendJson(res, 200, events.getEvent(id));
      }

      if (route === "POST /api/sync") {
        const result = await runSync(
          { events, venues, geocoder: createNominatimGeocoder() },
          { fromDate: url.searchParams.get("from") ?? undefined },
        );
        return sendJson(res, 200, result);
      }

      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
        const filePath = path.join(webDist, safe === "/" ? "index.html" : safe);
        if (!filePath.startsWith(webDist)) return sendJson(res, 403, { error: "Forbidden" });
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          const index = path.join(webDist, "index.html");
          if (!fs.existsSync(index)) return sendJson(res, 404, { error: "Not found" });
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          fs.createReadStream(index).pipe(res);
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });
}
