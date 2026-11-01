import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, normalizeRow, fullAddress } from "../normalize.js";
import type { SagreRow } from "@mievents/shared";

const baseRow: SagreRow = {
  istat: "015066",
  comune: "Senago",
  prov: "MI",
  denom: "FESTA DELLA BIRRA",
  tipo: "Sagra",
  n_ediz: "7",
  descriz: "Sagra della birra ed intrattenimenti musicali",
  data_in: "2026-09-25T00:00:00.000",
  ora_in: "19:00",
  data_fine: "2026-09-27T00:00:00.000",
  ora_fine: "23:59",
  toponimo: "PIAZZA",
  indirizzo: "TRICOLORE",
  civico: null,
  cap: "20030",
  somminis: "S",
  sito_web: null,
  url_programma: { url: "https://example.org/programma/1", description: null },
  nome_org: "PRO LOCO SENAGO",
};

test("normalizeRow maps fields and normalizes date", () => {
  const e = normalizeRow(baseRow, "2026-01-01T00:00:00Z");
  assert.ok(e);
  assert.equal(e.title, "FESTA DELLA BIRRA");
  assert.equal(e.start, "2026-09-25");
  assert.equal(e.end, "2026-09-27");
  assert.equal(e.city, "SENAGO");
  assert.equal(e.province, "MI");
  assert.equal(e.category, "sagra");
  assert.equal(e.programUrl, "https://example.org/programma/1");
  assert.ok(e.id.length === 16);
  assert.match(e.address ?? "", /PIAZZA TRICOLORE/);
});

test("normalizeRow returns null without title, date or city", () => {
  assert.equal(normalizeRow({ ...baseRow, denom: null }, "x"), null);
  assert.equal(normalizeRow({ ...baseRow, data_in: null }, "x"), null);
  assert.equal(normalizeRow({ ...baseRow, comune: "  " }, "x"), null);
});

test("normalizeRow defaults end to start and accepts dd/mm/yyyy", () => {
  const e = normalizeRow({ ...baseRow, data_fine: null, data_in: "25/09/2026" }, "x");
  assert.ok(e);
  assert.equal(e.start, "2026-09-25");
  assert.equal(e.end, "2026-09-25");
});

test("categorize detects categories", () => {
  assert.equal(categorize("Concerto rock al parco"), "concerto");
  assert.equal(categorize("Mostra di fotografia"), "mostra");
  assert.equal(categorize("Torneo di calcio giovanile"), "sport");
  assert.equal(categorize("Fiera del libro"), "fiera");
  assert.equal(categorize("Laboratori per bambini"), "famiglia");
  assert.equal(categorize("qualcosa di indefinito"), "altro");
});

test("fullAddress joins parts", () => {
  assert.equal(
    fullAddress({ address: "VIA ROMA 1", city: "MILANO", cap: "20121", province: "MI" }),
    "VIA ROMA 1, 20121, MILANO, MI",
  );
});
