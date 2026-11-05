import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsReducer, initialEventsState, nextRequestId, type EventsState } from "@mievents/shared";
import type { MiEvent } from "@mievents/shared";

function ev(id: string): MiEvent {
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
  };
}

test("eventsReducer: risposta stale (requestId vecchio) viene scartata", () => {
  let s: EventsState = initialEventsState;
  const id1 = nextRequestId(s);
  s = eventsReducer(s, { type: "start", id: id1 });
  const id2 = nextRequestId(s);
  s = eventsReducer(s, { type: "start", id: id2 });
  s = eventsReducer(s, { type: "success", id: id1, events: [ev("vecchia")], total: 1, append: false });
  assert.equal(s.items.length, 0);
  assert.equal(s.loading, true);
  s = eventsReducer(s, { type: "success", id: id2, events: [ev("nuova")], total: 1, append: false });
  assert.equal(s.items[0].id, "nuova");
  assert.equal(s.loading, false);
});

test("eventsReducer: append (loadMore) non si accoda a una risposta di altri filtri", () => {
  let s: EventsState = initialEventsState;
  const id1 = nextRequestId(s);
  s = eventsReducer(s, { type: "start", id: id1 });
  s = eventsReducer(s, { type: "success", id: id1, events: [ev("a"), ev("b")], total: 5, append: false });
  const id2 = nextRequestId(s);
  s = eventsReducer(s, { type: "start", id: id2 });
  s = eventsReducer(s, { type: "success", id: id2, events: [ev("c")], total: 5, append: true });
  assert.deepEqual(s.items.map((e) => e.id), ["a", "b", "c"]);
  assert.equal(s.total, 5);
});

test("eventsReducer: error stale ignorato, error valido setta error e ferma loading", () => {
  let s: EventsState = initialEventsState;
  const id1 = nextRequestId(s);
  s = eventsReducer(s, { type: "start", id: id1 });
  const id2 = nextRequestId(s);
  s = eventsReducer(s, { type: "start", id: id2 });
  s = eventsReducer(s, { type: "error", id: id1, message: "vecchio" });
  assert.equal(s.error, null);
  s = eventsReducer(s, { type: "error", id: id2, message: "boom" });
  assert.equal(s.error, "boom");
  assert.equal(s.loading, false);
});
