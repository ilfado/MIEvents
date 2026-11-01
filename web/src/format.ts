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
