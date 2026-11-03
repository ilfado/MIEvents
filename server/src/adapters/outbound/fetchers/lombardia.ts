import { createHash } from "node:crypto";
import { SAGRE_RESOURCE_URL, type SagreRow } from "@mievents/shared";
import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { clean, joinAddress, normalizeDate } from "../../../core/text.js";
import { getJson } from "./http.js";

const PAGE = 500;

function soql(where: string, orderBy: string, offset: number): string {
  return `SELECT * WHERE ${where} ORDER BY ${orderBy} LIMIT ${PAGE} OFFSET ${offset}`;
}

export const lombardiaSagreSource: EventSource = {
  id: "lombardia-sagre",
  async run(ctx): Promise<SourceResult> {
    const events: SourceResult["events"] = [];
    const where = `upper(prov) = 'MI' AND data_in >= '${ctx.fromDate}' AND data_in <= '${ctx.toDate}' AND denom IS NOT NULL`;
    for (let offset = 0; ; offset += PAGE) {
      const url = `${SAGRE_RESOURCE_URL}?$query=${encodeURIComponent(soql(where, "data_in", offset))}`;
      const data = (await getJson(ctx.fetchImpl, url)) as unknown;
      if (!Array.isArray(data)) throw new Error("Unexpected Socrata response");
      const rows = data as SagreRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const draft = normalizeSagreRow(row);
        if (draft) events.push(draft);
      }
      if (rows.length < PAGE) break;
    }
    return { sourceId: this.id, events };
  },
};

function normalizeSagreRow(row: SagreRow) {
  const title = clean(row.denom);
  const start = normalizeDate(row.data_in);
  const city = clean(row.comune);
  if (!title || !start || !city) return null;
  const end = normalizeDate(row.data_fine) ?? start;
  const address = joinAddress([
    [clean(row.toponimo), clean(row.indirizzo), clean(row.civico)].filter(Boolean).join(" "),
    clean(row.cap),
    clean(row.comune),
    clean(row.prov),
  ]);
  const id = createHash("sha1").update(["lombardia-sagre", title, start, city].join("|")).digest("hex").slice(0, 16);
  return {
    sourceId: "lombardia-sagre",
    sourceName: "dati.lombardia.it",
    title,
    description: clean(row.descriz),
    start,
    end,
    timeStart: clean(row.ora_in),
    timeEnd: clean(row.ora_fine),
    url: row.url_programma?.url ?? SAGRE_RESOURCE_URL,
    venue: clean(row.toponimo),
    address: address || null,
    city: city.toUpperCase(),
    lat: null,
    lon: null,
    organizer: clean(row.nome_org),
    _id: id,
  };
}
