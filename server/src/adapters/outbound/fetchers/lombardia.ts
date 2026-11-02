import { createHash } from "node:crypto";
import { SAGRE_RESOURCE_URL, type SagreRow } from "@mievents/shared";
import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
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

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function normalizeDate(value: string | null | undefined): string | null {
  const v = clean(value);
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function normalizeSagreRow(row: SagreRow) {
  const title = clean(row.denom);
  const start = normalizeDate(row.data_in);
  const city = clean(row.comune);
  if (!title || !start || !city) return null;
  const end = normalizeDate(row.data_fine) ?? start;
  const address = [
    [clean(row.toponimo), clean(row.indirizzo), clean(row.civico)].filter(Boolean).join(" "),
    clean(row.cap),
    clean(row.comune),
    clean(row.prov),
  ]
    .filter(Boolean)
    .join(", ");
  const id = createHash("sha1").update([title, start, city, clean(row.indirizzo) ?? ""].join("|")).digest("hex").slice(0, 16);
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
