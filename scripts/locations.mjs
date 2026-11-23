#!/usr/bin/env node
// Fetch Cloudflare's data-centre list into web/data/locations.json for the build.
// Tries speed.cloudflare.com/locations (names and coordinates), then the official status page
// (names and countries). Seed coordinates are merged in, and the seed is the final fallback.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexLocations, parseStatusComponents } from '../web/model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(ROOT, 'web', 'config.json'), 'utf8'));
const seed = JSON.parse(await readFile(path.join(ROOT, 'web', 'locations-seed.json'), 'utf8'));

async function load(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'coolcode.ca/colocheck (github.com/jsdyer/colocheck)', Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : parseStatusComponents(json);
}

for (const url of config.locations_sources) {
  try {
    const map = indexLocations(await load(url));
    if (map.size < 100) throw new Error(`only ${map.size} locations`);
    for (const s of seed) {
      const l = map.get(s.iata);
      if (!l) map.set(s.iata, s);
      else if (!Number.isFinite(l.lat)) map.set(s.iata, { ...l, lat: s.lat, lon: s.lon, cca2: l.cca2 || s.cca2 });
    }
    await mkdir(path.join(ROOT, 'web', 'data'), { recursive: true });
    await writeFile(path.join(ROOT, 'web', 'data', 'locations.json'), JSON.stringify({ retrieved: new Date().toISOString(), source: url, locations: [...map.values()] }));
    console.log(`✓ ${map.size} Cloudflare locations from ${url}`);
    process.exit(0);
  } catch (e) {
    console.error(`✗ ${url}: ${e.message}`);
  }
}
console.error('No location list available; the page will use the seed list.');
