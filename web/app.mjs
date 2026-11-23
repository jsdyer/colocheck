import * as M from './model.mjs';

const STORE = 'coolcode:colocheck:runs';
const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
  return el;
}
const FLAG = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
const ms = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)} ms`);

let config, locations, results = [];

async function sample(url, timeout) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${url}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    const elapsed = performance.now() - t0;
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { trace: M.parseTrace(text), ms: elapsed };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'timed out' : e instanceof TypeError ? 'unreadable' : e.message };
  }
}

async function run() {
  const btn = $('#run');
  btn.disabled = true;
  const endpoints = [...config.endpoints, ...M.customEndpoints($('#custom').value, config.max_custom_hosts)];
  results = [];
  $('#result').hidden = false;
  for (const [i, ep] of endpoints.entries()) {
    $('#status').textContent = `Checking ${ep.label} (${i + 1} of ${endpoints.length})…`;
    const samples = [];
    for (let n = 0; n < config.samples; n++) {
      const s = await sample(ep.url, config.timeout_ms);
      samples.push(s);
      if (s.error && n === 0) break; // don't keep retrying an address that can't be read
    }
    results.push(M.summarizeEndpoint(ep, samples, locations, config.home_country));
    render();
  }
  $('#status').textContent = `Checked ${new Date().toLocaleTimeString('en-CA').replace(/\.$/, '')}.`;
  btn.disabled = false;
}

function render() {
  const ok = results.filter((r) => r.status === 'ok');
  const main = ok.find((r) => r.id === 'default') || ok[0];
  const v = $('#verdict');
  if (main) {
    const place = main.city ? `${main.city}${main.countryName || main.country ? `, ${main.countryName || main.country}` : ''}` : 'an unlisted location';
    const crossed = ok.filter((r) => r.crossBorder && r !== main);
    v.replaceChildren(...[
      h('span', { class: 'big' }, `${FLAG(main.country)} ${main.colo}`), ' ',
      `Your connection reached Cloudflare's ${place} data centre over IPv${main.family}, in about ${ms(main.medianMs)}.`,
      main.crossBorder ? h('strong', { class: 'warn' }, ' Your traffic left Canada to get there.') : null,
      crossed.length ? h('strong', { class: 'warn' }, ` ${crossed.map((r) => r.label).join(', ')} reached ${[...new Set(crossed.map((r) => r.city || r.colo))].join(', ')}, outside Canada.`) : null,
    ].filter(Boolean));
    if (main.crossBorder) {
      const here = locations.get(main.colo);
      const near = here && M.nearestIn(locations, here, config.home_country);
      if (near) v.append(` The nearest Canadian data centre is ${near.city} (${near.iata}). Where you land depends on how your ISP connects to Cloudflare, not only on distance.`);
    }
  } else v.textContent = results.length ? 'No Cloudflare address could be read from this page yet.' : '';

  $('#table').replaceChildren(
    h('thead', {}, h('tr', {}, ...['Address', 'Data centre', 'Over', 'Median', 'Fastest', 'Your IP (as seen)'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...results.map((r) => (r.status === 'ok'
      ? h('tr', { class: r.crossBorder ? 'cross' : null },
        h('td', {}, r.label),
        h('td', {}, `${FLAG(r.country)} ${r.colo}`, r.city ? h('span', { class: 'muted' }, ` ${r.city}`) : null, r.colos.length > 1 ? h('span', { class: 'muted' }, ` (also ${r.colos.filter((c) => c !== r.colo).join(', ')})`) : null),
        h('td', {}, `IPv${r.family}`, r.http ? h('span', { class: 'muted' }, ` · ${r.http}`) : null),
        h('td', {}, ms(r.medianMs)), h('td', {}, ms(r.minMs)), h('td', { class: 'ip' }, r.ip || '—'))
      : h('tr', { class: 'na' }, h('td', {}, r.label), h('td', { colspan: '5' }, r.error === 'unreadable' ? 'No readable answer: unreachable from this network, or the site doesn’t let other pages read it' : `Unavailable: ${r.error}`))))));
  const v6 = results.find((r) => r.id === 'v6');
  $('#footnote').textContent = [
    v6 && v6.status !== 'ok' ? 'The IPv6-only address didn’t answer, which usually means this network has no IPv6.' : '',
    main?.visitorCountry ? `Cloudflare places you in ${main.visitorCountry}.` : '',
    main?.warp && main.warp !== 'off' ? `WARP: ${main.warp}.` : '',
  ].filter(Boolean).join(' ');
}

function loadRuns() { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.filter(M.validRun) : []; } catch { return []; } }
function saveRuns(runs) { try { localStorage.setItem(STORE, JSON.stringify(runs)); } catch { /* storage unavailable */ } }

function renderSaved() {
  const runs = loadRuns();
  $('#saved').hidden = !runs.length;
  if (!runs.length) return;
  const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
  const label = (id) => runs.flatMap((r) => r.results).find((x) => x.id === id)?.label || id;
  $('#saved-table').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Run'), ...ids.map((id) => h('th', { scope: 'col' }, label(id))), h('th', { scope: 'col' }, ''))),
    h('tbody', {}, ...runs.map((run, i) => h('tr', {},
      h('td', {}, run.label, h('div', { class: 'muted' }, new Date(run.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })), h('div', { class: 'muted' }, run.results.find((x) => x.net)?.net || '')),
      ...ids.map((id) => { const x = run.results.find((r) => r.id === id); return h('td', { class: x?.crossBorder ? 'cross' : null }, x?.colo ? `${x.colo} · ${ms(x.medianMs)}` : '—'); }),
      h('td', {}, h('button', { type: 'button', class: 'quiet-btn', 'aria-label': `Delete ${run.label}`, onclick: () => { const all = loadRuns(); all.splice(i, 1); saveRuns(all); renderSaved(); } }, 'Delete'))))));
}

$('#run').addEventListener('click', run);
$('#save-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!results.length) return;
  saveRuns(M.mergeRuns(loadRuns(), [M.toSavedRun($('#save-label').value, results)], config.max_saved_runs));
  $('#save-label').value = '';
  renderSaved();
});
$('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(loadRuns(), null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: 'colocheck-runs.json' }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { saveRuns(M.mergeRuns(loadRuns(), JSON.parse(await file.text()), config.max_saved_runs)); renderSaved(); $('#status').textContent = 'Runs imported.'; }
  catch { $('#status').textContent = 'That file isn’t a Colo Check export.'; }
  e.target.value = '';
});
$('#clear').addEventListener('click', () => { try { localStorage.removeItem(STORE); } catch { /* ignore */ } renderSaved(); });

try {
  config = await (await fetch('./config.json')).json();
  $('#samples').textContent = config.samples;
  let list;
  try { const r = await fetch('./data/locations.json'); if (!r.ok) throw new Error(); list = (await r.json()).locations; } catch { list = await (await fetch('./locations-seed.json')).json(); }
  locations = M.indexLocations(list);
  renderSaved();
  if (new URL(location.href).searchParams.get('run') === '1') run();
} catch (e) { $('#status').textContent = 'Configuration failed to load.'; console.error(e); }
