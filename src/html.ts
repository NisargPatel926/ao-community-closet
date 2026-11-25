// Tiny auto-escaping HTML templating: html`<p>${userText}</p>` escapes userText,
// nested html`` fragments and arrays of them are inserted as-is.

export class Safe {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

type Val = Safe | string | number | boolean | null | undefined | Val[];

function render(v: Val): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Safe) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return escape(String(v));
}

export function html(strings: TemplateStringsArray, ...vals: Val[]): Safe {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}

export const raw = (s: string) => new Safe(s);

// "2026-12-09" -> "Dec 9"
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d.slice(0, 10) + "T12:00:00Z");
  if (isNaN(t.getTime())) return d;
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// SQLite "YYYY-MM-DD HH:MM:SS" (UTC) -> "5 min ago"
export function ago(ts: string | null | undefined): string {
  if (!ts) return "";
  const then = new Date(ts.replace(" ", "T") + "Z").getTime();
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const units: [number, string][] = [[60, "min"], [3600, "hour"], [86400, "day"], [604800, "week"], [2629800, "month"]];
  let label = "";
  for (const [secs, name] of units) {
    if (s >= secs) {
      const n = Math.floor(s / secs);
      label = `${n} ${name}${n === 1 || name === "min" ? "" : "s"} ago`;
    }
  }
  return label;
}
