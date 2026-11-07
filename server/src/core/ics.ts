export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string;
  dtstart: string | null;
  dtstartTime: string | null;
  dtend: string | null;
  dtendTime: string | null;
}

function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseDt(v: string): { date: string; time: string | null } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const time = m[4] ? `${m[4]}:${m[5]}` : null;
  return { date, time };
}

export function parseIcs(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  for (const block of unfold(text).split("BEGIN:VEVENT").slice(1)) {
    const end = block.indexOf("END:VEVENT");
    const body = end >= 0 ? block.slice(0, end) : block;
    const get = (name: string): string => {
      const m = body.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "m"));
      return m ? unescape(m[1].trim()) : "";
    };
    const dtstart = parseDt(get("DTSTART"));
    const dtend = parseDt(get("DTEND"));
    out.push({
      uid: get("UID"),
      summary: get("SUMMARY"),
      description: get("DESCRIPTION"),
      location: get("LOCATION"),
      url: get("URL"),
      dtstart: dtstart?.date ?? null,
      dtstartTime: dtstart?.time ?? null,
      dtend: dtend?.date ?? null,
      dtendTime: dtend?.time ?? null,
    });
  }
  return out;
}
