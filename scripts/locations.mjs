#!/usr/bin/env node
// Fetch Cloudflare's published data-centre list into web/data/locations.json for the build.
// If the fetch fails or looks wrong, keep the committed seed list (the page falls back to it).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexLocations } from '../web/model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(ROOT, 'web', 'config.json'), 'utf8'));
const seed = JSON.parse(await readFile(path.join(ROOT, 'web', 'locations-seed.json'), 'utf8'));
try {
  const res = await fetch(config.locations_source, { headers: { 'User-Agent': 'coolcode.ca/colocheck' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  const map = indexLocations(list);
  const missing = seed.filter((s) => !map.has(s.iata)).map((s) => s.iata);
  if (map.size < 100) throw new Error(`only ${map.size} locations`);
  // Keep seed entries Cloudflare's list doesn't include, so known Canadian sites never vanish.
  for (const s of seed) if (!map.has(s.iata)) map.set(s.iata, s);
  await mkdir(path.join(ROOT, 'web', 'data'), { recursive: true });
  await writeFile(path.join(ROOT, 'web', 'data', 'locations.json'), JSON.stringify({ retrieved: new Date().toISOString(), source: config.locations_source, locations: [...map.values()] }));
  console.log(`✓ ${map.size} Cloudflare locations${missing.length ? ` (seed-only: ${missing.join(', ')})` : ''}`);
} catch (e) {
  console.error(`Locations unavailable (${e.message}); the page will use the seed list.`);
}
