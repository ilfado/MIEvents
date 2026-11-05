import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize } from "../core/categorize.js";
import { stripHtml, parseDateOnly, parseDateTime, extractDateFromText, inMilanoProvince, extractLinks, todayIso, todayRome, isMiArea, MI_CITY_RE } from "../core/text.js";
import { extractJsonLdEvents, ldToDraft } from "../core/jsonld.js";
import { parseRssItems } from "../core/rss.js";
import { pinForVenue } from "../core/venue-pins.js";
import { parsePriceText, parseCostField, priceBandOf } from "../core/price.js";
import { ldPrice } from "../core/jsonld.js";
import { isBigEvent } from "../core/big-events.js";
import { ftsQuery } from "../adapters/outbound/repositories/sqlite.js";

test("pinForVenue: dizionario venue noti, match nome/indirizzo normalizzato", () => {
  const alca = pinForVenue("Alcatraz Milano");
  assert.ok(alca && Math.abs(alca.lat - 45.4946) < 0.001);
  const byAddr = pinForVenue(null, "Via Valtellina 25, Milano");
  assert.ok(byAddr && Math.abs(byAddr.lat - 45.4946) < 0.001);
  assert.equal(pinForVenue("venue sconosciuto xyz"), null);
  assert.equal(pinForVenue(null, null), null);
});

test("categorize detects categories", () => {
  assert.equal(categorize("Concerto rock al parco"), "concerto");
  assert.equal(categorize("Mostra di fotografia"), "mostra");
  assert.equal(categorize("Torneo di calcio giovanile"), "sport");
  assert.equal(categorize("Fiera del libro"), "fiera");
  assert.equal(categorize("Laboratori per bambini"), "famiglia");
  assert.equal(categorize("qualcosa di indefinito"), "altro");
});

test("text utils", () => {
  assert.equal(stripHtml("<p>Ciao <b>mondo</b> &amp; co</p>"), "Ciao mondo & co");
  assert.equal(parseDateOnly("2026-11-07T19:00:00+01:00"), "2026-11-07");
  assert.deepEqual(parseDateTime("2026-11-07 19:30"), { date: "2026-11-07", time: "19:30" });
  assert.equal(extractDateFromText("il 7 novembre 2026"), "2026-11-07");
  assert.equal(extractDateFromText("07/11/2026"), "2026-11-07");
  assert.equal(extractDateFromText("nessuna"), null);
  assert.equal(extractDateFromText("EICMA 2026 a Milano: dal 5 al 9 novembre 2026"), "2026-11-05");
  assert.equal(extractDateFromText("dal 3 al 7 dicembre 2026 a Rho"), "2026-12-03");
  assert.equal(extractDateFromText("dall'8 al 10 ottobre 2026"), "2026-10-08");
  assert.equal(extractDateFromText("dal 5 novembre 2026"), "2026-11-05");
  assert.ok(inMilanoProvince(45.46, 9.19));
  assert.ok(!inMilanoProvince(41.9, 12.5));
  assert.equal(todayIso(new Date("2026-11-01T10:00:00Z")), "2026-11-01");
});

test("pinForVenue matches normalized venue/address names", () => {
  assert.equal(pinForVenue("BASE Milano")?.lat, 45.4509);
  assert.equal(pinForVenue("Alcatraz Milano")?.lat, 45.4946);
  assert.equal(pinForVenue("TEATRO DEGLI ARCIMBOLDI")?.lon, 9.2084);
  assert.equal(pinForVenue("Magazzini Generali")?.address, "Via Pietrasanta 16, 20141 Milano");
  assert.equal(pinForVenue("Duomo")?.city, "MILANO");
  assert.equal(pinForVenue("Basilica di Sant'Eustorgio")?.lat, 45.4537);
  assert.equal(pinForVenue(null, "Piazza Duomo, Milano")?.lat, 45.4642);
  assert.equal(pinForVenue("Bar sporting non mappato"), null);
  assert.equal(pinForVenue(null, "Via Roma 1, nowhere"), null);
  assert.equal(pinForVenue("database sql meetup"), null);
});

test("extractLinks resolves and filters", () => {
  const links = extractLinks('<a href="/eventi/x.html">a</a><a href="https://www.cheventi.it/eventi/y/">b</a><a href="/altra">c</a>', "https://www.cheventi.it/regioni/", /\/eventi\//);
  assert.equal(links.length, 2);
});

const LD = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"Event","name":"NODE &amp; more","url":"https://www.cheventi.it/eventi/x/","startDate":"2026-11-07T19:00:00+01:00","location":{"@type":"Place","name":"Slaughter Club","address":{"streetAddress":"Via Tagliabue 4","addressLocality":"Paderno Dugnano"},"geo":{"latitude":45.575565,"longitude":9.15202}}}}]}</script>`;

test("jsonld extraction + ldToDraft", () => {
  const evs = extractJsonLdEvents(LD);
  assert.equal(evs.length, 1);
  const d = ldToDraft(evs[0], "cheventi", "Cheventi.it");
  assert.ok(d);
  assert.equal(d!.title, "NODE & more");
  assert.equal(d!.start, "2026-11-07");
  assert.equal(d!.timeStart, "19:00");
  assert.equal(d!.venue, "Slaughter Club");
  assert.equal(d!.city, "PADERNO DUGNANO");
  assert.equal(d!.lat, 45.575565);
});

const RSS = `<rss version="2.0"><channel>
<item><title>Concerto dei Muse a San Siro Milano 2027</title><link>https://x.it/evento/muse/</link><description><![CDATA[Live il 15 giugno 2027 a Milano]]></description><pubDate>Sat, 20 Nov 2027 19:30:00 +0000</pubDate><category>concerti</category></item>
</channel></rss>`;

test("parseRssItems", () => {
  const items = parseRssItems(RSS);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Concerto dei Muse a San Siro Milano 2027");
  assert.deepEqual(items[0].categories, ["concerti"]);
});

test("parsePriceText: gratis, importi, range, 'da X euro'", () => {
  assert.deepEqual(parsePriceText("Ingresso gratuito"), { min: 0, max: 0, free: true });
  assert.deepEqual(parsePriceText("Gratis"), { min: 0, max: 0, free: true });
  assert.deepEqual(parsePriceText("ingresso libero"), { min: 0, max: 0, free: true });
  assert.deepEqual(parsePriceText("Biglietto € 12"), { min: 12, max: 12, free: false });
  assert.deepEqual(parsePriceText("da 5 a 15 euro"), { min: 5, max: 15, free: false });
  assert.deepEqual(parsePriceText("Ingresso da 20 euro"), { min: 20, max: 20, free: false });
  assert.deepEqual(parsePriceText("5 - 15 €"), { min: 5, max: 15, free: false });
  assert.deepEqual(parsePriceText("prezzo 10,50 € e 8 € ridotto"), { min: 8, max: 10.5, free: false });
  assert.equal(parsePriceText("senza indicazioni di prezzo"), null);
  assert.equal(parsePriceText("dal 5 al 9 novembre 2026"), null);
});

test("parsePriceText: 'gratis' come omaggio (birra/rinfresco) non rende free; outlier bassi scartati", () => {
  assert.equal(parsePriceText("Avanzi di balera, birra gratis"), null);
  assert.equal(parsePriceText("Festa con rinfresco gratuito"), null);
  assert.deepEqual(parsePriceText("Concerto gratis"), { min: 0, max: 0, free: true });
  assert.deepEqual(parsePriceText("Sagra dell'uva, ingresso gratuito"), { min: 0, max: 0, free: true });
  assert.deepEqual(parsePriceText("Biglietto 1 euro di prevendita, 45 euro intero"), { min: 45, max: 45, free: false });
  assert.deepEqual(parsePriceText("Evento a 3 euro"), { min: 3, max: 3, free: false });
});

test("ldPrice: scarta outlier bassi (es. 1 euro prevendita) quando c'e' un max >= 10", () => {
  const ev = { offers: [{ price: 1, priceCurrency: "EUR" }, { lowPrice: 35, highPrice: 45, priceCurrency: "EUR" }] };
  assert.deepEqual(ldPrice(ev as never), { min: 35, max: 45, free: false });
  const solo = { offers: { price: 1, priceCurrency: "EUR" } };
  assert.deepEqual(ldPrice(solo as never), { min: 1, max: 1, free: false });
});

test("parseCostField: campo cost TEC", () => {
  assert.deepEqual(parseCostField("0"), { min: 0, max: 0, free: true });
  assert.deepEqual(parseCostField("10.00"), { min: 10, max: 10, free: false });
  assert.deepEqual(parseCostField("5 - 15"), { min: 5, max: 15, free: false });
  assert.deepEqual(parseCostField("Gratis"), { min: 0, max: 0, free: true });
  assert.deepEqual(parseCostField("€ 18,50"), { min: 18.5, max: 18.5, free: false });
  assert.equal(parseCostField(null), null);
  assert.equal(parseCostField("  "), null);
});

test("priceBandOf: fasce gratis / fino10 / fino20 / cari", () => {
  assert.equal(priceBandOf(0, 0), "gratis");
  assert.equal(priceBandOf(5, 10), "fino10");
  assert.equal(priceBandOf(10, 20), "fino20");
  assert.equal(priceBandOf(20, 20), "fino20");
  assert.equal(priceBandOf(21, null), "cari");
  assert.equal(priceBandOf(5, 25), "cari");
  assert.equal(priceBandOf(null, null), null);
});

test("isBigEvent: stadi, palazzetti, arene, forum; no falsi positivi", () => {
  assert.ok(isBigEvent("Stadio San Siro", null, "Concerto"));
  assert.ok(isBigEvent("Unipol Forum di Assago", null, null));
  assert.ok(isBigEvent("Mediolanum Forum", null, null));
  assert.ok(isBigEvent(null, null, "Serata al Palazzetto dello Sport"));
  assert.ok(isBigEvent("Arena Civica", null, null));
  assert.ok(!isBigEvent("Circolo Magnolia", "Via Circonvallazione Idroscalo 41, Segrate", "DJ set"));
  assert.ok(!isBigEvent("Teatro Arsenale", null, "Spettacolo"));
  assert.ok(!isBigEvent("Alcatraz", null, "Concerto"));
  assert.ok(!isBigEvent(null, null, null));
});

test("extractLinks: href con apici singoli e doppi", () => {
  const links = extractLinks("<a href='/eventi/x.html'>a</a><a href=\"/eventi/y.html\">b</a>", "https://www.milanotoday.it/eventi/", /\/eventi\/[^/?#]+\.html/i);
  assert.equal(links.length, 2);
});

test("ldToDraft: prezzo da offers JSON-LD e isAccessibleForFree", () => {
  const paid = extractJsonLdEvents(`<script type="application/ld+json">{"@type":"Event","name":"Show","startDate":"2026-11-10T20:00:00+01:00","url":"https://x/","offers":{"@type":"Offer","price":"15.00","priceCurrency":"EUR"}}</script>`);
  const d = ldToDraft(paid[0], "s", "S");
  assert.equal(d!.priceMin, 15);
  assert.equal(d!.priceMax, 15);
  const agg = extractJsonLdEvents(`<script type="application/ld+json">{"@type":"Event","name":"Show2","startDate":"2026-11-10","offers":[{"@type":"Offer","price":"5"},{"@type":"Offer","price":"22"}]}</script>`);
  const d2 = ldToDraft(agg[0], "s", "S");
  assert.equal(d2!.priceMin, 5);
  assert.equal(d2!.priceMax, 22);
  const free = extractJsonLdEvents(`<script type="application/ld+json">{"@type":"Event","name":"Free","startDate":"2026-11-10","isAccessibleForFree":true}</script>`);
  const df = ldToDraft(free[0], "s", "S");
  assert.equal(df!.priceMin, 0);
  assert.equal(df!.priceMax, 0);
});

test("ftsQuery", () => {
  assert.equal(ftsQuery("birra"), '"birra"*');
  assert.equal(ftsQuery("festa birra"), '"festa" AND "birra"*');
  assert.equal(ftsQuery('  "q*" '), '"q"*');
  assert.equal(ftsQuery("   "), '""');
});

test("todayRome: fuso Europe/Rome, confine di mezzanotte", () => {
  assert.equal(todayRome(new Date("2026-11-03T12:00:00Z")), "2026-11-03");
  assert.equal(todayRome(new Date("2026-11-03T23:30:00Z")), "2026-11-04");
  assert.equal(todayRome(new Date("2026-11-03T22:30:00Z")), "2026-11-03");
});

test("isMiArea: preciso — no falsi positivi (mi piace, lombardia, sesto nudo, laina)", () => {
  assert.equal(isMiArea("Milano"), true);
  assert.equal(isMiArea("Lainate (MI)"), true);
  assert.equal(isMiArea("Sesto San Giovanni"), true);
  assert.equal(isMiArea("Via Roma 1, Bergamo"), false);
  assert.equal(isMiArea("mi piace questa festa"), false);
  assert.equal(isMiArea("lombardia"), false);
  assert.equal(isMiArea("sesto senso"), false);
  assert.equal(isMiArea("laina"), false);
  assert.equal(MI_CITY_RE.test("MI"), false);
  assert.equal(isMiArea("Senago, MI"), true);
});
