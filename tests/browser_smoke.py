"""Exercise the built tool at a project subpath in Chromium, with Cloudflare trace endpoints simulated."""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def trace(colo, ip):
    return f"fl=1\nh=x\nip={ip}\nts=1\nvisit_scheme=https\ncolo={colo}\nhttp=http/2\nloc=CA\ntls=TLSv1.3\nwarp=off\n"


def fake_cloudflare(page):
    """Default lands in YVR; IPv4-only goes to SEA (border crossing); IPv6 is unreachable; speed blocks CORS."""
    answers = {
        "https://www.cloudflare.com/": trace("YVR", "203.0.113.9"),
        "https://1.1.1.1/": trace("SEA", "203.0.113.9"),
        "https://cloudflare-dns.com/": trace("YYZ", "203.0.113.9"),
    }

    def handle(route):
        url = route.request.url
        if "127.0.0.1" in url:
            return route.continue_()
        if url.startswith("https://[2606:4700:4700::1111]/"):
            return route.abort("addressunreachable")
        for prefix, body in answers.items():
            if url.startswith(prefix):
                return route.fulfill(status=200, body=body, headers={"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*"})
        if "/cdn-cgi/trace" in url:
            return route.abort("accessdenied")  # stands in for a site that sends no CORS header
        return route.abort()
    page.route("**/*", handle)


def main():
    screenshots = ROOT / "browser-checks"
    screenshots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT / "dist", Path(temporary) / "colocheck")
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                context = browser.new_context(viewport={"width": 1280, "height": 1000}, accept_downloads=True)
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                fake_cloudflare(page)
                page.goto(f"http://127.0.0.1:{server.server_port}/colocheck/")
                page.click("text=Add Cloudflare-hosted sites (optional)")
                page.fill("#custom", "example.ca")
                page.click("#run")
                page.wait_for_function("document.querySelector('#status').textContent.startsWith('Checked')", timeout=30000)

                verdict = page.locator("#verdict").inner_text()
                assert "YVR" in verdict and "Vancouver" in verdict and "left Canada" not in verdict and "null" not in verdict, verdict
                assert "IPv4 only (1.1.1.1) reached Seattle, outside Canada" in verdict, verdict
                rows = page.locator("#table tbody tr")
                assert rows.count() == 6
                texts = [rows.nth(i).inner_text() for i in range(6)]
                assert any("SEA" in t and "Seattle" in t for t in texts)
                assert page.locator("#table tbody tr.cross").count() == 1
                assert any("IPv6 only" in t and "No readable answer" in t for t in texts), texts
                assert sum("No readable answer" in t for t in texts) == 3, texts
                assert "no IPv6" in page.locator("#footnote").inner_text()

                # Saving keeps a /24 only; runs persist and can be exported, deleted.
                page.fill("#save-label", "Home <script>")
                page.click("#save-form button")
                saved = page.evaluate("localStorage.getItem('coolcode:colocheck:runs')")
                assert "203.0.113.0/24" in saved and "203.0.113.9" not in saved
                assert page.locator("#saved-table tbody tr").count() == 1
                assert "Home <script>" in page.locator("#saved-table").inner_text()
                with page.expect_download() as dl:
                    page.click("#export")
                assert json.loads(Path(dl.value.path()).read_text())[0]["label"] == "Home <script>"
                page.screenshot(path=str(screenshots / "desktop.png"), full_page=True)
                page.click("#clear")
                assert page.locator("#saved").is_hidden()

                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.body.scrollWidth <= window.innerWidth + 1")
                page.screenshot(path=str(screenshots / "mobile.png"), full_page=True)
                assert not errors, errors
                browser.close()
            print("Browser checks passed: subpath, colo detection, border flag, unreachable IPv6, CORS-blocked sites, saved runs and mobile")
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
