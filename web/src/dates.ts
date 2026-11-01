export type QuickDate = "today" | "weekend" | "";

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function quickDateRange(kind: QuickDate, now = new Date()): { from: string; to: string } | null {
  if (kind === "today") {
    const iso = toIso(now);
    return { from: iso, to: iso };
  }
  if (kind === "weekend") {
    const day = now.getDay();
    const diffToFriday = (5 - day + 7) % 7;
    const friday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToFriday);
    const sunday = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 2);
    return { from: toIso(friday), to: toIso(sunday) };
  }
  return null;
}

export const QUICK_CATEGORIES: Array<{ label: string; value: string }> = [
  { label: "Concerti", value: "concerto" },
  { label: "Mostre", value: "mostra" },
  { label: "Spettacoli", value: "teatro" },
];
