# Colo Check

Which Cloudflare data centre does your connection actually reach? Colo Check asks several Cloudflare addresses from your browser, records the data-centre code each one reports (YVR, YYZ, SEA…), times the answers, and flags when traffic from Canada is served from outside Canada. Published at **https://coolcode.ca/colocheck/**.

Every Cloudflare-served host exposes a small diagnostic page, `/cdn-cgi/trace`, that reports the answering data centre (`colo`), your address as Cloudflare sees it, the HTTP version and your country. Colo Check reads it from:

| Address | Why |
|---|---|
| `www.cloudflare.com` | Whatever your browser and network pick (IPv4 or IPv6) |
| `1.1.1.1` | Forces IPv4 |
| `[2606:4700:4700::1111]` | Forces IPv6; no answer usually means your network has no IPv6 |
| `cloudflare-dns.com`, `speed.cloudflare.com` | Other Cloudflare properties, sometimes routed differently |

## Reading the results

<!-- coolcode:guide -->
Choose "Check my connection". The large code is the data centre your browser's normal route reached. Rows highlighted in orange reached a data centre outside Canada although Cloudflare placed you in Canada. That usually means your ISP hands Cloudflare traffic over in the US (for example, Vancouver traffic served from Seattle). Compare the IPv4 and IPv6 rows: they often take different paths. Save each run with a label such as "Home fibre" or "Phone on 5G", then run it again on another network to compare. Saved runs keep only your network prefix, never your full address.
<!-- /coolcode:guide -->

[Map the data centres serving IPv4 and IPv6 and keep a history of location changes](https://coolcode.ca/edge-map/).

- A browser can't tell "unreachable" apart from "the site doesn't allow other pages to read it". Both show as **No readable answer**. Sites you add usually show this, because their owners don't allow cross-site reads.
- Median and fastest times include TLS and HTTP overhead from your browser. They're useful for comparing routes, not as a ping replacement.
- The data-centre list is fetched from Cloudflare at each deploy: `speed.cloudflare.com/locations` if it answers, otherwise Cloudflare's status page. `web/locations-seed.json` fills gaps and always keeps Canadian sites named.

## Expand or customize

Settings live in **`web/config.json`**:

| Key | Meaning |
|---|---|
| `endpoints` | Addresses to test: `id`, `label`, `url` (ending in `/cdn-cgi/trace`), `family` (`auto`, `4` or `6`). Add any Cloudflare-served host that allows cross-site reads. |
| `samples`, `timeout_ms` | Requests per address and the time limit for each. |
| `home_country` | Country for the border flag (default `CA`). |
| `max_custom_hosts` | How many extra sites a visitor can add per run. |
| `max_saved_runs` | How many saved runs one browser keeps. |
| `locations_sources` | Where the deploy looks for Cloudflare's data-centre list, in order: speed.cloudflare.com (with coordinates), then the official status page (names and countries). The seed list fills in coordinates for Canadian and nearby US sites. |

For example, to test an extra address, add `{ "id": "one", "label": "one.one.one.one", "url": "https://one.one.one.one/cdn-cgi/trace", "family": "auto" }` to `endpoints` and push to `main`. The workflow runs the tests, refreshes the data-centre list, builds and deploys. Add `?run=1` to the page address to start a check as soon as the page loads.

## Develop and test

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
node scripts/locations.mjs      # optional: fetch Cloudflare's location list
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

`tests/browser_smoke.py` serves the build at `/colocheck/` and simulates the Cloudflare addresses: a Vancouver default, an IPv4 route through Seattle, an unreachable IPv6 address and unreadable sites. It checks saving, export and deletion of runs, and the mobile layout.
