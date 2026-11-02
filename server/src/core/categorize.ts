import type { EventCategory } from "@mievents/shared";

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
