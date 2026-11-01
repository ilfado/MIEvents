import { createHash } from "node:crypto";
import type { EventCategory, MiEvent, SagreRow } from "@mievents/shared";

const CATEGORY_RULES: Array<[EventCategory, RegExp]> = [
  ["concerto", /concert|live|dj set|musica dal vivo|band\b|festival musicale/i],
  ["teatro", /teatro|spettacolo teatrale|commedia|monologo| reading/i],
  ["mostra", /mostra|esposizione|esposizion|installazione|arte\b|vernissage|fotografia/i],
  ["sport", /torneo|gara|campionato|partita|maraton|corsa|match|derby/i],
  ["famiglia", /bambin|famigl|ragazzi|kids|laboratori per/i],
  ["fiera", /fiera|mercato|mercato contadino|espositori|banchett/i],
  ["sagra", /sagra|festa patronale|festa del paese|enogastronom|somministrazione|rievocazione/i],
];

export function categorize(text: string): EventCategory {
  for (const [category, re] of CATEGORY_RULES) {
    if (re.test(text)) return category;
  }
  return "altro";
}

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
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return null;
}

export function normalizeRow(row: SagreRow, fetchedAt: string): MiEvent | null {
  const title = clean(row.denom);
  const start = normalizeDate(row.data_in);
  const city = clean(row.comune);
  if (!title || !start || !city) return null;
  const end = normalizeDate(row.data_fine) ?? start;
  const addressParts = [
    [clean(row.toponimo), clean(row.indirizzo), clean(row.civico)]
      .filter(Boolean)
      .join(" "),
    clean(row.cap),
    clean(row.comune),
    clean(row.prov),
  ]
    .filter(Boolean)
    .join(", ");
  const textForCategory = [title, clean(row.tipo), clean(row.descriz)].filter(Boolean).join(" ");
  const id = createHash("sha1")
    .update([title, start, city, clean(row.indirizzo) ?? ""].join("|"))
    .digest("hex")
    .slice(0, 16);
  return {
    id,
    title,
    description: clean(row.descriz),
    category: categorize(textForCategory),
    type: clean(row.tipo),
    start,
    end,
    timeStart: clean(row.ora_in),
    timeEnd: clean(row.ora_fine),
    venue: clean(row.toponimo),
    address: addressParts || null,
    city: city.toUpperCase(),
    province: (clean(row.prov) ?? "MI").toUpperCase(),
    cap: clean(row.cap),
    organizer: clean(row.nome_org),
    website: clean(row.sito_web),
    programUrl: row.url_programma?.url ?? null,
    source: "dati.lombardia.it",
    sourceUrl: "https://www.dati.lombardia.it/Commercio/Sagre-e-fiere-su-area-pubblica-in-provincia-di-Mil/f2tm-32s5",
    lat: null,
    lon: null,
    saved: false,
    fetchedAt,
  };
}

export function fullAddress(e: Pick<MiEvent, "address" | "city" | "cap" | "province">): string {
  const parts = [e.address, e.cap, e.city, e.province].filter(Boolean);
  return parts.join(", ");
}
