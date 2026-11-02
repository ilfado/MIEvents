import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { getJson } from "./http.js";

const ENDPOINT = "https://qlever.dev/api/wikidata";

export const wikidataSource: EventSource = {
  id: "wikidata",
  async run(ctx): Promise<SourceResult> {
    const limit = ctx.limits["wikidataLimit"] ?? 100;
    const query = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?event ?label ?coord ?date ?end WHERE {
  ?event wdt:P31/wdt:P279* wd:Q1656682 .
  ?event wdt:P625 ?coord .
  ?event wdt:P131* wd:Q490 .
  ?event wdt:P585 ?date .
  OPTIONAL { ?event wdt:P582 ?end }
  OPTIONAL { ?event rdfs:label ?label . FILTER(LANG(?label) = "it") }
  FILTER(?date >= "${ctx.fromDate}T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>)
} ORDER BY DESC(?date) LIMIT ${limit}`;
    const json = (await getJson(ctx.fetchImpl, `${ENDPOINT}?query=${encodeURIComponent(query)}`)) as {
      results?: { bindings: Array<Record<string, { value: string }>> };
    };
    const events: SourceResult["events"] = [];
    const seen = new Set<string>();
    for (const b of json.results?.bindings ?? []) {
      const id = b.event?.value;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const coord = b.coord?.value.match(/POINT\(([-\d.]+) ([-\d.]+)\)/);
      const lon = coord ? Number(coord[1]) : null;
      const lat = coord ? Number(coord[2]) : null;
      const date = b.date?.value.slice(0, 10);
      if (!date) continue;
      events.push({
        sourceId: this.id,
        sourceName: "Wikidata",
        title: (b.label?.value ?? id).slice(0, 300),
        description: null,
        start: date,
        end: b.end?.value ? b.end.value.slice(0, 10) : null,
        timeStart: null,
        timeEnd: null,
        url: id,
        venue: null,
        address: "Milano",
        city: "MILANO",
        lat: lat !== null && Number.isFinite(lat) ? lat : null,
        lon: lon !== null && Number.isFinite(lon) ? lon : null,
        organizer: null,
      });
    }
    return { sourceId: this.id, events };
  },
};
