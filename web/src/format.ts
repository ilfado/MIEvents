import type { MiEvent } from "@mievents/shared";

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatDateRange(e: MiEvent): string {
  if (!e.end || e.end === e.start) return formatDate(e.start);
  return `${formatDate(e.start)} – ${formatDate(e.end)}`;
}

export function formatTime(e: MiEvent): string {
  const parts: string[] = [];
  if (e.timeStart && e.timeStart !== "00:00") parts.push(`dalle ${e.timeStart}`);
  if (e.timeEnd && e.timeEnd !== "23:59") parts.push(`alle ${e.timeEnd}`);
  return parts.join(" ");
}

const CATEGORY_LABELS: Record<string, string> = {
  sagra: "Sagra",
  fiera: "Fiera",
  concerto: "Concerto",
  teatro: "Teatro",
  mostra: "Mostra",
  sport: "Sport",
  famiglia: "Famiglia",
  altro: "Altro",
};

export function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? c;
}

function fmtEuro(n: number): string {
  return Number.isInteger(n) ? `€ ${n}` : `€ ${n.toFixed(2).replace(".", ",")}`;
}

export function formatPrice(e: MiEvent): string | null {
  if (e.priceBand === "gratis") return "GRATIS";
  if (e.priceBand === "cari") return "CARI";
  if (e.priceMin == null && e.priceMax == null) return null;
  if (e.priceMin != null && e.priceMax != null && e.priceMin !== e.priceMax) {
    return `${fmtEuro(e.priceMin)}–${fmtEuro(e.priceMax)}`;
  }
  return fmtEuro((e.priceMax ?? e.priceMin) as number);
}
