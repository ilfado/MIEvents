import { test } from "node:test";
import assert from "node:assert/strict";
import { applyClientFilters, geoEvents } from "@mievents/shared";
import type { MiEvent } from "@mievents/shared";

function ev(id: string, over: Partial<MiEvent> = {}): MiEvent {
  return {
    id,
    title: id,
    description: null,
    category: "altro",
    type: null,
    start: "2026-11-05",
    end: null,
    timeStart: null,
    timeEnd: null,
    venue: "V",
    address: "A",
    city: "MILANO",
    province: "MI",
    cap: null,
    organizer: null,
    website: null,
    programUrl: null,
    source: "t",
    sourceUrl: "https://x/" + id,
    lat: 45.4,
    lon: 9.1,
    saved: false,
    fetchedAt: "2026-11-03T00:00:00Z",
    priceMin: null,
    priceMax: null,
    priceBand: null,
    big: false,
    ...over,
  };
}

const items = [
  ev("a", { title: "Sagra della birra", category: "sagra", city: "SENAGO", priceBand: "gratis", start: "2026-11-05", saved: true }),
  ev("b", { title: "Concerto punk", category: "concerto", city: "MILANO", priceBand: "fino10", start: "2026-11-06", description: "ingresso 8 euro" }),
  ev("c", { title: "Mostra", category: "mostra", city: "MILANO", priceBand: "fino20", start: "2026-11-20", lat: null, lon: null }),
];

test("applyClientFilters: q multi-parola su title/venue/city/desc, accenti ignorati", () => {
  assert.deepEqual(applyClientFilters(items, { q: "birra sagra", city: "", category: "", priceBand: "", from: "", to: "" }).map((e) => e.id), ["a"]);
  assert.deepEqual(applyClientFilters(items, { q: "8 euro", city: "", category: "", priceBand: "", from: "", to: "" }).map((e) => e.id), ["b"]);
});

test("applyClientFilters: city/category/priceBand/from-to/saved", () => {
  const f = { q: "", city: "", category: "" as const, priceBand: "" as const, from: "", to: "" };
  assert.deepEqual(applyClientFilters(items, { ...f, city: "MILANO" }).map((e) => e.id), ["b", "c"]);
  assert.deepEqual(applyClientFilters(items, { ...f, category: "concerto" }).map((e) => e.id), ["b"]);
  assert.deepEqual(applyClientFilters(items, { ...f, priceBand: "gratis" }).map((e) => e.id), ["a"]);
  assert.deepEqual(applyClientFilters(items, { ...f, from: "2026-11-06" }).map((e) => e.id), ["b", "c"]);
  assert.deepEqual(applyClientFilters(items, { ...f, to: "2026-11-06" }).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(applyClientFilters(items, { ...f, category: "saved" }).map((e) => e.id), ["a"]);
});

test("geoEvents: solo con coordinate", () => {
  assert.deepEqual(geoEvents(items).map((e) => e.id), ["a", "b"]);
});
