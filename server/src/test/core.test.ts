import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize } from "../core/categorize.js";
import { stripHtml, parseDateOnly, parseDateTime, extractDateFromText, inMilanoProvince, extractLinks, todayIso } from "../core/text.js";
import { extractJsonLdEvents, ldToDraft } from "../core/jsonld.js";
import { parseRssItems } from "../core/rss.js";
import { ftsQuery } from "../adapters/outbound/repositories/sqlite.js";

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

test("ftsQuery", () => {
  assert.equal(ftsQuery("birra"), '"birra"*');
  assert.equal(ftsQuery("festa birra"), '"festa" AND "birra"*');
  assert.equal(ftsQuery('  "q*" '), '"q"*');
  assert.equal(ftsQuery("   "), '""');
});
