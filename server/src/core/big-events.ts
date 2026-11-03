const BIG_VENUE_RE =
  /\b(san siro|meazza|stadio|palazzetto|palasport|palalido|unipol forum|unipol dome|mediolanum forum|forum di assago|arena)\b/i;

export function isBigEvent(venue: string | null, address: string | null, title: string | null): boolean {
  return BIG_VENUE_RE.test(`${venue ?? ""} ${address ?? ""} ${title ?? ""}`);
}
