// Pure logic for Colo Check: parsing /cdn-cgi/trace, timing statistics, location lookup,
// cross-border detection, saved-run storage format. No DOM, no network.

/** Parse Cloudflare's key=value trace text. */
export function parseTrace(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!out.colo || !/^[A-Z]{3}$/.test(out.colo)) throw new Error('No data centre code in the trace');
  return {
    colo: out.colo,
    ip: out.ip || null,
    family: out.ip ? (out.ip.includes(':') ? '6' : '4') : null,
    loc: out.loc || null,
    http: out.http || null,
    tls: out.tls || null,
    warp: out.warp || null,
    ts: out.ts ? Number(out.ts) : null,
  };
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Locations list → map by IATA code (from Cloudflare's list or the seed). */
export function indexLocations(list) {
  const map = new Map();
  for (const l of Array.isArray(list) ? list : []) {
    if (l && /^[A-Z]{3}$/.test(l.iata)) map.set(l.iata, { iata: l.iata, city: l.city || l.iata, cca2: l.cca2 || null, lat: Number(l.lat), lon: Number(l.lon), region: l.region || null });
  }
  return map;
}

export function haversineKm(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

/** Nearest data centre in `country` to a location (used to show "the closest Canadian one is …"). */
export function nearestIn(locations, from, country) {
  let best = null;
  for (const l of locations.values()) {
    if (l.cca2 !== country || !Number.isFinite(l.lat)) continue;
    const d = haversineKm(from, l);
    if (!best || d < best.km) best = { ...l, km: d };
  }
  return best;
}

/**
 * Summarise one endpoint's samples: colo, family, median/min latency, and whether a visitor in
 * `home` was served from abroad.
 */
export function summarizeEndpoint(endpoint, samples, locations, home) {
  const ok = samples.filter((s) => s.trace);
  if (!ok.length) {
    const err = samples.find((s) => s.error)?.error || 'no answer';
    return { id: endpoint.id, label: endpoint.label, status: 'unavailable', error: err };
  }
  const colos = [...new Set(ok.map((s) => s.trace.colo))];
  const t = ok.at(-1).trace;
  const loc = locations.get(t.colo) || null;
  const visitorCountry = t.loc;
  return {
    id: endpoint.id, label: endpoint.label, status: 'ok',
    colo: t.colo, colos, city: loc?.city || null, country: loc?.cca2 || null,
    family: t.family, ip: t.ip, visitorCountry, http: t.http, warp: t.warp,
    medianMs: median(ok.map((s) => s.ms)), minMs: Math.min(...ok.map((s) => s.ms)), samples: ok.length,
    crossBorder: Boolean(visitorCountry === home && loc?.cca2 && loc.cca2 !== home),
  };
}

/** Coarsen an IP for saving: IPv4 to /24, IPv6 to /48. */
export function maskIp(ip) {
  if (!ip) return null;
  if (ip.includes(':')) {
    const head = ip.split('::')[0].split(':').filter(Boolean).slice(0, 3);
    while (head.length < 3) head.push('0');
    return `${head.join(':')}::/48`;
  }
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : null;
}

/** A run reduced for storage: no full IP addresses. */
export function toSavedRun(label, results, at = new Date()) {
  return {
    label: String(label || '').trim().slice(0, 60) || 'Untitled',
    at: at.toISOString(),
    results: results.map((r) => (r.status === 'ok'
      ? { id: r.id, label: r.label, colo: r.colo, city: r.city, country: r.country, family: r.family, net: maskIp(r.ip), medianMs: r.medianMs, crossBorder: r.crossBorder, visitorCountry: r.visitorCountry }
      : { id: r.id, label: r.label, status: r.status })),
  };
}

export function validRun(r) {
  return r && typeof r.label === 'string' && !Number.isNaN(Date.parse(r.at)) && Array.isArray(r.results)
    && r.results.every((x) => typeof x.id === 'string' && (x.colo === undefined || /^[A-Z]{3}$/.test(x.colo)));
}

/** Merge imported runs with existing ones (dedupe by label+time), newest first, capped. */
export function mergeRuns(existing, incoming, max) {
  const all = [...(incoming || []).filter(validRun), ...(existing || [])];
  const seen = new Set();
  return all.filter((r) => { const k = `${r.label}|${r.at}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** Custom Cloudflare-hosted sites a visitor wants to test. */
export function customEndpoints(text, max) {
  const out = [];
  for (const raw of String(text).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)) {
    let host;
    try { host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname; } catch { continue; }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) continue;
    const id = `site:${host.toLowerCase()}`;
    if (!out.some((e) => e.id === id)) out.push({ id, label: host.toLowerCase(), url: `https://${host.toLowerCase()}/cdn-cgi/trace`, family: 'auto', custom: true });
  }
  return out.slice(0, max);
}
