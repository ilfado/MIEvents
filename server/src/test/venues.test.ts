import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db.js";
import { queryEvents } from "../query.js";
import { upsertVenue, venueId, attachVenueCoords, geocodeVenue, listVenues } from "../venues.js";
import { syncEvents } from "../sync.js";
import type { SagreRow } from "@mievents/shared";

const row: SagreRow = {
  istat: "015066", comune: "Senago", prov: "MI", denom: "FESTA DELLA BIRRA", tipo: "Sagra",
  n_ediz: "7", descriz: "Musica e birra", data_in: "2026-09-25T00:00:00.000", ora_in: "19:00",
  data_fine: "2026-09-27T00:00:00.000", ora_fine: "23:59", toponimo: "PIAZZA", indirizzo: "TRICOLORE",
  civico: null, cap: "20030", somminis: "S", sito_web: null,
  url_programma: { url: null, description: null }, nome_org: "Pro Loco",
};

const row2: SagreRow = {
  ...row, denom: "SAGRA DELLO STESSO LUOGO", data_in: "2026-10-10T00:00:00.000",
  data_fine: "2026-10-11T00:00:00.000",
};

function socrataFetch(rows: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify(rows), { status: 200 })) as typeof fetch;
}

test("venueId is stable and normalized", () => {
  assert.equal(venueId("  Piazza Tricolore ", "piazza tricolore", "senago"), venueId("Piazza Tricolore", "Piazza Tricolore", "SENAGO"));
  assert.notEqual(venueId("A", null, "MILANO"), venueId("B", null, "MILANO"));
});

test("upsertVenue is idempotent and attachVenueCoords reuses coords", async () => {
  const db = openDb(":memory:");
  const v1 = upsertVenue(db, { name: "Spazio Profumo", address: "Via Binda 29, Milano", city: "Milano" }, "2026-11-01");
  const v2 = upsertVenue(db, { name: "spazio profumo", address: "via binda 29, milano", city: "MILANO" }, "2026-11-02");
  assert.equal(v1.id, v2.id);
  assert.equal(listVenues(db).length, 1);

  const mockGeo = (async () =>
    new Response(JSON.stringify([{ lat: "45.4408", lon: "9.1694" }]), { status: 200 })) as typeof fetch;
  const geo = await geocodeVenue(db, v1, { fetchImpl: mockGeo, sleepMs: 0 });
  assert.ok(geo?.lat === 45.4408 && geo?.lon === 9.1694);

  const attached = attachVenueCoords(db, { venue: "Spazio Profumo", address: "Via Binda 29", city: "MILANO", lat: null, lon: null });
  assert.equal(attached.lat, 45.4408);
  assert.equal(attached.lon, 9.1694);
});

test("default query hides past events, includePast=1 shows them", async () => {
  const db = openDb(":memory:");
  const future = { ...row, denom: "EVENTO FUTURO", data_in: "2099-01-01T00:00:00.000", data_fine: "2099-01-02T00:00:00.000" };
  const past = { ...row, denom: "EVENTO PASSATO", data_in: "2020-01-01T00:00:00.000", data_fine: "2020-01-02T00:00:00.000" };
  await syncEvents(db, {
    fetchImpl: socrataFetch([future, past]),
    geocode: false,
    milanotoday: false,
    fromDate: "2020-01-01",
  });
  const def = queryEvents(db, {});
  const all = queryEvents(db, { includePast: true });
  assert.equal(all.total, 2);
  assert.equal(def.total, 1);
  assert.equal(def.events[0].title, "EVENTO FUTURO");
  const withFrom = queryEvents(db, { from: "2020-01-01" });
  assert.equal(withFrom.total, 2);
});

test("sync geocodes once per venue and reuses coords for other events", async () => {
  let nominatimCalls = 0;
  const mockFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("dati.lombardia.it")) return new Response(JSON.stringify([row, row2]), { status: 200 });
    if (url.includes("nominatim")) {
      nominatimCalls++;
      return new Response(JSON.stringify([{ lat: "45.5741", lon: "9.1635" }]), { status: 200 });
    }
    return new Response("<html></html>", { status: 200 });
  }) as typeof fetch;
  const db = openDb(":memory:");
  const res = await syncEvents(db, { fetchImpl: mockFetch, geocode: true, milanotoday: false, geocodeSleepMs: 0 });
  assert.equal(res.geocoded, 1);
  assert.equal(nominatimCalls, 1);
  const all = queryEvents(db, { includePast: true });
  assert.ok(all.events.every((e) => e.lat === 45.5741 && e.lon === 9.1635));
  assert.equal(listVenues(db).length, 1);
});
