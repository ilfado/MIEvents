import type { PriceBand } from "@mievents/shared";

export interface ParsedPrice {
  min: number;
  max: number;
  free: boolean;
}

const FREE_RE = /\b(?:ingresso|accesso|evento|manifestazione|spettacolo|visita|partecipazione|apertura|concerto|show|dj set|live|mostra|inaugurazione|festa|sagra|mercato|rassegna|serata)\s+(?:\u00e8\s+)?(?:gratis|gratuito|gratuita|libero|libera)\b|\b(?:ingresso libero|entrata libera|partecipazione libera|free entry)\b|^(?:gratis|gratuito|gratuita|free)\b/i;
const AMOUNT_RE = /(?:€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro\b|eur\b))/gi;
const RANGE_RE = /(\d+(?:[.,]\d{1,2})?)\s*(?:-|–|—|\/|\ba\b|\bal\b)\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro\b|eur\b)/i;
const FROM_RE = /\bda\s+(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro\b|eur\b)/i;
const BARE_RANGE_RE = /^(\d+(?:[.,]\d{1,2})?)\s*(?:-|–|—|a)\s*(\d+(?:[.,]\d{1,2})?)$/;
const BARE_NUMBER_RE = /^(\d+(?:[.,]\d{1,2})?)$/;

function toNum(s: string): number {
  return Number(s.replace(",", "."));
}

export function parsePriceText(text: string | null | undefined): ParsedPrice | null {
  if (!text) return null;
  const free = FREE_RE.test(text);
  const amounts: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const v = toNum(m[1] ?? m[2]);
    if (Number.isFinite(v) && v >= 0 && v <= 10000) amounts.push(v);
  }
  const range = RANGE_RE.exec(text);
  if (range) {
    const a = toNum(range[1]);
    const b = toNum(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a <= 10000 && b <= 10000) {
      if (!amounts.includes(a)) amounts.push(a);
      if (!amounts.includes(b)) amounts.push(b);
    }
  }
  if (amounts.length === 0) {
    const from = FROM_RE.exec(text);
    if (from) {
      const v = toNum(from[1]);
      if (Number.isFinite(v) && v <= 10000) amounts.push(v);
    }
  }
  if (amounts.length === 0) return free ? { min: 0, max: 0, free: true } : null;
  if (free && amounts.every((a) => a === 0)) return { min: 0, max: 0, free: true };
  const top = Math.max(...amounts);
  const vals = top >= 10 ? amounts.filter((a) => a >= 5) : amounts;
  return { min: Math.min(...vals), max: Math.max(...vals), free: false };
}

export function parseCostField(cost: string | null | undefined): ParsedPrice | null {
  if (!cost) return null;
  const t = cost.trim();
  if (!t) return null;
  const parsed = parsePriceText(t);
  if (parsed) return parsed;
  const range = BARE_RANGE_RE.exec(t);
  if (range) {
    const a = toNum(range[1]);
    const b = toNum(range[2]);
    return { min: Math.min(a, b), max: Math.max(a, b), free: false };
  }
  const single = BARE_NUMBER_RE.exec(t);
  if (single) {
    const v = toNum(single[1]);
    return { min: v, max: v, free: v === 0 };
  }
  return null;
}

export function priceBandOf(
  min: number | null | undefined,
  max: number | null | undefined,
): PriceBand | null {
  const top = max ?? min;
  if (top == null) return null;
  if (top <= 0) return "gratis";
  if (top <= 10) return "fino10";
  if (top <= 20) return "fino20";
  return "cari";
}
