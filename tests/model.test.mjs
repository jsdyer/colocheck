import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../web/model.mjs';

const seed = JSON.parse(readFileSync(new URL('../web/locations-seed.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../web/config.json', import.meta.url), 'utf8'));
const LOC = M.indexLocations(seed);
const trace = (colo, ip = '203.0.113.9', loc = 'CA') => `fl=123\nh=www.cloudflare.com\nip=${ip}\nts=1763900000.1\nvisit_scheme=https\nuag=x\ncolo=${colo}\nsliver=none\nhttp=http/2\nloc=${loc}\ntls=TLSv1.3\nsni=plaintext\nwarp=off\ngateway=off\nrbi=off\nkex=X25519\n`;

test('trace parsing', () => {
  const t = M.parseTrace(trace('YVR'));
  assert.deepEqual([t.colo, t.ip, t.family, t.loc, t.http, t.warp], ['YVR', '203.0.113.9', '4', 'CA', 'http/2', 'off']);
  assert.equal(M.parseTrace(trace('SEA', '2001:db8::5')).family, '6');
  assert.throws(() => M.parseTrace('<html>nope</html>'), /No data centre/);
});

test('median and distances', () => {
  assert.equal(M.median([30, 10, 20]), 20);
  assert.equal(M.median([10, 20, 30, 40]), 25);
  assert.equal(M.median([]), null);
  const km = M.haversineKm(LOC.get('YVR'), LOC.get('SEA'));
  assert.ok(km > 195 && km < 215, km);
  assert.equal(M.nearestIn(LOC, LOC.get('SEA'), 'CA').iata, 'YVR');
  assert.equal(M.nearestIn(LOC, LOC.get('BOS'), 'CA').iata, 'YUL');
});

test('endpoint summary flags Canadian traffic served from the US', () => {
  const ep = { id: 'v4', label: 'IPv4' };
  const samples = [40, 30, 35].map((ms) => ({ trace: M.parseTrace(trace('SEA')), ms }));
  const s = M.summarizeEndpoint(ep, samples, LOC, 'CA');
  assert.equal(s.crossBorder, true);
  assert.equal(s.city, 'Seattle');
  assert.equal(s.medianMs, 35);
  assert.equal(s.minMs, 30);
  assert.equal(M.summarizeEndpoint(ep, [{ trace: M.parseTrace(trace('YVR')), ms: 5 }], LOC, 'CA').crossBorder, false);
  // A visitor outside Canada landing in the US isn't flagged.
  assert.equal(M.summarizeEndpoint(ep, [{ trace: M.parseTrace(trace('SEA', '198.51.100.1', 'US')), ms: 5 }], LOC, 'CA').crossBorder, false);
  // Unknown colo code: still reported, just without a city.
  assert.equal(M.summarizeEndpoint(ep, [{ trace: M.parseTrace(trace('ZZZ')), ms: 5 }], LOC, 'CA').city, null);
  assert.deepEqual(M.summarizeEndpoint(ep, [{ error: 'timed out' }], LOC, 'CA'), { id: 'v4', label: 'IPv4', status: 'unavailable', error: 'timed out' });
});

test('saved runs keep only a network prefix and merge safely', () => {
  assert.equal(M.maskIp('203.0.113.9'), '203.0.113.0/24');
  assert.equal(M.maskIp('2001:db8:abcd:12::5'), '2001:db8:abcd::/48');
  assert.equal(M.maskIp('2001:db8::5'), '2001:db8:0::/48');
  const r = M.summarizeEndpoint({ id: 'default', label: 'Default' }, [{ trace: M.parseTrace(trace('YVR')), ms: 9 }], LOC, 'CA');
  const run = M.toSavedRun('  Home fibre  ', [r, { id: 'v6', label: 'IPv6', status: 'unavailable' }], new Date('2026-11-23T20:00:00Z'));
  assert.equal(run.label, 'Home fibre');
  assert.ok(!JSON.stringify(run).includes('203.0.113.9'));
  assert.equal(run.results[0].net, '203.0.113.0/24');
  const merged = M.mergeRuns([run], [run, { label: 'Mobile', at: '2026-11-24T00:00:00Z', results: [] }, { bad: true }], 50);
  assert.deepEqual(merged.map((x) => x.label), ['Mobile', 'Home fibre']);
  assert.equal(M.mergeRuns([], Array.from({ length: 60 }, (_, i) => ({ label: `r${i}`, at: new Date(Date.UTC(2026, 0, 1, i)).toISOString(), results: [] })), config.max_saved_runs).length, config.max_saved_runs);
});

test('custom sites become trace endpoints; endpoints beyond the defaults are accepted', () => {
  const eps = M.customEndpoints('https://Example.ca/path\nexample.ca, bad host!, 192.0.2.1, other.example.com', 5);
  assert.deepEqual(eps.map((e) => e.url), ['https://example.ca/cdn-cgi/trace', 'https://other.example.com/cdn-cgi/trace']);
  assert.ok(config.endpoints.every((e) => e.url.endsWith('/cdn-cgi/trace') && e.id && e.label));
  assert.equal(M.customEndpoints(Array.from({ length: 9 }, (_, i) => `s${i}.example.ca`).join('\n'), config.max_custom_hosts).length, config.max_custom_hosts);
});
