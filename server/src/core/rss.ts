import { stripHtml } from "./text.js";

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string | null;
  categories: string[];
}

export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const body = m[1];
    const pick = (tag: string): string => {
      const mm = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return mm ? mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
    };
    const cats = [...body.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) =>
      c[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim(),
    );
    const title = stripHtml(pick("title"));
    const link = pick("link");
    if (!title || !link) continue;
    items.push({
      title,
      link,
      description: stripHtml(pick("description")) || stripHtml(pick("encoded")),
      pubDate: pick("pubDate") || null,
      categories: cats,
    });
  }
  return items;
}
