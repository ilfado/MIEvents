import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { openDb, rowToEvent, type EventRow } from "../db.js";
import { queryEvents, setSaved, getEvent } from "../query.js";
import { syncEvents } from "../sync.js";
import { createServer } from "../server.js";

const sampleRows = [
  {
    istat: "015066", comune: "Senago", prov: "MI", denom: "FESTA DELLA BIRRA", tipo: "Sagra",
    n_ediz: "7", descriz: "Musica e birra", data_in: "2026-09-25T00:00:00.000", ora_in: "19:00",
    data_fine: "2026-09-27T00:00:00.000", ora_fine: "23:59", toponimo: "PIAZZA", indirizzo: "TRICOLORE",
    civico: null, cap: "20030", somminis: "S", sito_web: null,
    url_programma: { url: "https://example.org/p/1", description: null }, nome_org: "Pro Loco",
  },
  {
    istat: "015241", comune: "Milano", prov: "MI", denom: "CONCERTO SINFONICO", tipo: "Evento",
    n_ediz: "1", descriz: "Orchestra in piazza", data_in: "2026-10-01T00:00:00.000", ora_in: "21:00",
    data_fine: null, ora_fine: null, toponimo: "PIAZZA", indirizzo: "DEL DUOMO", civico: "1",
    cap: "20121", somminis: "N", sito_web: "https://example.org",
    url_programma: null, nome_org: "Comune di Milano",
  },
  {
    istat: "015108", comune: "Gorgonzola", prov: "MI", denom: "FIERA DI S. CATERINA", tipo: "Fiera",
    n_ediz: "242", descriz: null, data_in: "2025-11-28T00:00:00.000", ora_in: "08:00",
    data_fine: "2025-11-29T00:00:00.000", ora_fine: "23:59", toponimo: null, indirizzo: "VIE DIVERSE",
    civico: null, cap: "20064", somminis: "S", sito_web: null,
    url_programma: { url: null, description: null }, nome_org: "Comune",
  },
];

function mockFetch(rows: unknown[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.ok(url.startsWith("https://www.dati.lombardia.it/resource/f2tm-32s5.json"));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("syncEvents fetches, normalizes and upserts", async () => {
  const db = openDb(":memory:");
  const result = await syncEvents(db, { fetchImpl: mockFetch(sampleRows), geocode: false, feeds: false, milanotoday: false });
  assert.equal(result.fetched, 3);
  assert.equal(result.inserted, 3);
  assert.equal(result.errors.length, 0);
  const rows = db.prepare("SELECT * FROM events ORDER BY start").all() as unknown as EventRow[];
  assert.equal(rows.length, 3);
  assert.equal(rowToEvent(rows[2]).city, "MILANO");
  assert.equal(rowToEvent(rows[2]).category, "concerto");
  const again = await syncEvents(db, { fetchImpl: mockFetch(sampleRows), geocode: false, feeds: false, milanotoday: false });
  assert.equal(again.inserted, 0);
  assert.equal(again.updated, 3);
});

test("syncEvents records errors and keeps partial data", async () => {
  const db = openDb(":memory:");
  const failing = (async () => new Response("boom", { status: 500 })) as typeof fetch;
  const result = await syncEvents(db, { fetchImpl: failing, geocode: false, feeds: false, milanotoday: false });
  assert.equal(result.fetched, 0);
  assert.equal(result.errors.length, 1);
});

test("queryEvents filters by city, category, date range and bbox", async () => {
  const db = openDb(":memory:");
  await syncEvents(db, { fetchImpl: mockFetch(sampleRows), geocode: false, feeds: false, milanotoday: false });
  const all = queryEvents(db, { includePast: true });
  assert.equal(all.total, 3);
  const milano = queryEvents(db, { city: "milano", includePast: true });
  assert.equal(milano.total, 1);
  assert.equal(milano.events[0].city, "MILANO");
  const concerti = queryEvents(db, { category: "concerto", includePast: true });
  assert.equal(concerti.total, 1);
  const future = queryEvents(db, { from: "2026-01-01" });
  assert.equal(future.total, 2);
  const range = queryEvents(db, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(range.total, 1);
  const q = queryEvents(db, { q: "birra", includePast: true });
  assert.equal(q.total, 1);
  db.prepare("UPDATE events SET lat=45.46, lon=9.19 WHERE city='MILANO'").run();
  const bbox = queryEvents(db, { bbox: "45.0,9.0,46.0,10.0", includePast: true });
  assert.equal(bbox.total, 1);
  assert.throws(() => queryEvents(db, { bbox: "bad" }), /bbox/);
  assert.throws(() => queryEvents(db, { category: "nope" as never }), /category/);
});

test("saved flag toggles and savedOnly filter works", async () => {
  const db = openDb(":memory:");
  await syncEvents(db, { fetchImpl: mockFetch(sampleRows), geocode: false, feeds: false, milanotoday: false });
  const ev = queryEvents(db, { city: "senago", includePast: true }).events[0];
  assert.equal(ev.saved, false);
  assert.ok(setSaved(db, ev.id, true));
  const after = getEvent(db, ev.id);
  assert.equal(after?.saved, true);
  assert.equal(queryEvents(db, { savedOnly: true, includePast: true }).total, 1);
  assert.equal(queryEvents(db, { category: "saved", includePast: true }).total, 1);
  assert.ok(!setSaved(db, "missing-id", true));
});

test("HTTP API serves events, saves and returns 404/400", async () => {
  const db = openDb(":memory:");
  await syncEvents(db, { fetchImpl: mockFetch(sampleRows), geocode: false, feeds: false, milanotoday: false });
  const server = createServer(db);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  after(() => server.close());

  const get = async (p: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`);
    return { status: res.status, body: await res.json() };
  };

  const health = await get("/api/health");
  assert.deepEqual(health.body, { ok: true });

  const all = await get("/api/events?includePast=1");
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3);

  const filtered = await get("/api/events?category=sagra&from=2026-01-01");
  assert.equal(filtered.body.total, 1);

  const bad = await get("/api/events?category=zzz");
  assert.equal(bad.status, 400);

  const id = all.body.events[0].id;
  const saved = await fetch(`http://127.0.0.1:${port}/api/events/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved: true }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).saved, true);

  const savedList = await get("/api/events?saved=1&includePast=1");
  assert.equal(savedList.body.total, 1);

  const missing = await fetch(`http://127.0.0.1:${port}/api/events/nope`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved: true }),
  });
  assert.equal(missing.status, 404);

  const badBody = await fetch(`http://127.0.0.1:${port}/api/events/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved: "yes" }),
  });
  assert.equal(badBody.status, 400);

  const notFound = await get("/api/events/does-not-exist");
  assert.equal(notFound.status, 404);

  const cities = await get("/api/events/cities");
  assert.deepEqual(cities.body.cities.sort(), ["GORGONZOLA", "MILANO", "SENAGO"]);
});
