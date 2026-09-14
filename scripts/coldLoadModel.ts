/**
 * The cold-load model behind `npm run coldload:gate` (brief §11: cold load to
 * first click under 2.5 s on 10 Mbps; under 90 MB initial download including
 * the largest map). Pure, so it is testable without a build.
 *
 * What is modelled: the bytes on the critical path — the page, every script
 * and stylesheet it references and every module it preloads — over a 10 Mbps
 * line after gzip, plus a connection's worth of latency and one round trip
 * per file over HTTP/2's parallel streams. What is not: JavaScript parse and
 * execute on a 2019 laptop, which needs the laptop. The gate is the wire
 * half of the number; the other half is in `BUILD-STATE.md`'s blocked list.
 */
export const LINE_BITS_PER_SECOND = 10_000_000;
export const CONNECT_SECONDS = 0.15;
export const ROUND_TRIP_SECONDS = 0.05;
export const COLD_LOAD_BUDGET_SECONDS = 2.5;
export const INITIAL_DOWNLOAD_BUDGET_BYTES = 90 * 1024 * 1024;

/** The paths a built page needs before its first click, in document order. */
export function criticalAssets(html: string): string[] {
  const out: string[] = [];
  // The built page is a template: the CDN prefix is an expression in the
  // attribute, quotes and all. Drop every expression before reading it.
  const clean = html.replace(/<%-[\s\S]*?%>/g, "");
  const re = /<(script|link)\b[^>]*?(?:src|href)="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const tag = m[0].toLowerCase();
    const url = m[2];
    if (tag.startsWith("<script")) {
      if (!/\basync\b/.test(tag) && !/\bdefer\b/.test(tag)) out.push(url);
      else out.push(url);
    } else if (/rel="(stylesheet|modulepreload)"/.test(tag)) {
      out.push(url);
    }
  }
  return [...new Set(out)];
}

/** Seconds on the wire for these gzip sizes, one page plus its files. */
export function wireSeconds(gzipBytes: number[]): number {
  const bytes = gzipBytes.reduce((a, b) => a + b, 0);
  // Files stream in parallel on one connection: one round trip each is
  // pessimistic for HTTP/2 and honest for HTTP/1.1's six lanes.
  return (
    CONNECT_SECONDS +
    ROUND_TRIP_SECONDS * Math.max(1, gzipBytes.length) +
    (bytes * 8) / LINE_BITS_PER_SECOND
  );
}
