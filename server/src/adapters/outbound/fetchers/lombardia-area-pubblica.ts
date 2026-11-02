import { SAGRE_AREA_PUBBLICA_RESOURCE_URL, type SagreAreaPubblicaRow } from "@mievents/shared";
import type { EventSource } from "../../../application/ports.js";
import type { SourceResult } from "../../../core/types.js";
import { inMilanoProvince, parseDateOnly } from "../../../core/text.js";
import { getJson } from "./http.js";

const PAGE = 500;

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function normalizeDate(value: string | null | undefined): string | null {
  return parseDateOnly(clean(value));
}

function pointOf(row: SagreAreaPubblicaRow): { lat: number; lon: number } | null {
  const loc = row.location;
  if (loc && Array.isArray(loc.coordinates) && loc.coordinates.length === 2) {
    const [lon, lat] = loc.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lon) && inMilanoProvince(lat, lon)) {
      return { lat, lon };
    }
  }
  const lat = Number(row.geo_y);
  const lon = Number(row.geo_x);
  if (Number.isFinite(lat) && Number.isFinite(lon) && row.geo_x && row.geo_y && inMilanoProvince(lat, lon)) {
    return { lat, lon };
  }
  return null;
}

export const lombardiaAreaPubblicaSource: EventSource = {
  id: "lombardia-area-pubblica",
  async run(ctx): Promise<SourceResult> {
    const events: SourceResult["events"] = [];
    const where = `upper(prov) = 'MI' AND data_in >= '${ctx.fromDate}' AND data_in <= '${ctx.toDate}' AND denom IS NOT NULL`;
    for (let offset = 0; ; offset += PAGE) {
      const url = `${SAGRE_AREA_PUBBLICA_RESOURCE_URL}?$query=${encodeURIComponent(
        `SELECT * WHERE ${where} ORDER BY data_in LIMIT ${PAGE} OFFSET ${offset}`,
      )}`;
      const data = (await getJson(ctx.fetchImpl, url)) as unknown;
      if (!Array.isArray(data)) throw new Error("Unexpected Socrata response");
      const rows = data as SagreAreaPubblicaRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const draft = normalizeRow(row);
        if (draft) events.push(draft);
      }
      if (rows.length < PAGE) break;
    }
    return { sourceId: this.id, events };
  },
};

function normalizeRow(row: SagreAreaPubblicaRow): SourceResult["events"][number] | null {
  const title = clean(row.denom);
  const start = normalizeDate(row.data_in);
  const city = clean(row.comune);
  if (!title || !start || !city) return null;
  if (clean(row.prov)?.toUpperCase() !== "MI") return null;
  const end = normalizeDate(row.data_fine) ?? start;
  const point = pointOf(row);
  const address = [
    [clean(row.toponimo), clean(row.indirizzo), clean(row.civico)].filter(Boolean).join(" "),
    clean(row.cap),
    clean(row.comune),
    clean(row.prov),
  ]
    .filter(Boolean)
    .join(", ");
  return {
    sourceId: "lombardia-area-pubblica",
    sourceName: "dati.lombardia.it (area pubblica)",
    title,
    description: clean(row.descriz),
    start,
    end,
    timeStart: clean(row.ora_in),
    timeEnd: clean(row.ora_fine),
    url: row.url_programma?.url ?? SAGRE_AREA_PUBBLICA_RESOURCE_URL,
    venue: clean(row.toponimo),
    address: address || null,
    city: city.toUpperCase(),
    lat: point?.lat ?? null,
    lon: point?.lon ?? null,
    organizer: clean(row.nome_org),
  };
}
