from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlparse

from playwright.sync_api import Page, Route, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
DASHBOARD_INDEX = DIST / "dashboard" / "index.html"
QA_HOST = "bili-bill-preference-real-mock.test"
QA_URL = f"http://{QA_HOST}/dashboard/index.html#preference"


def main() -> None:
    ensure_dashboard_bundle()
    run_browser_qa()
    print("PASS preference-word-cloud.real-mock-qa: ECharts 6 production canvas rendered")


def ensure_dashboard_bundle() -> None:
    if os.environ.get("BILI_BILL_REAL_MOCK_QA_SKIP_BUILD") == "1":
        if not DASHBOARD_INDEX.exists():
            raise AssertionError("dist/dashboard/index.html is missing. Run npm run build first.")
        return

    npm = "npm.cmd" if os.name == "nt" else "npm"
    result = subprocess.run(
        [npm, "run", "build"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if result.returncode != 0:
        raise AssertionError("npm run build failed before preference QA:\n" + result.stdout[-8000:])


def run_browser_qa() -> None:
    requested_paths: list[str] = []
    console_errors: list[str] = []
    page_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 980})
        page.on(
            "console",
            lambda message: console_errors.append(message.text) if message.type == "error" else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.add_init_script(chrome_mock_script())
        page.route("**/*", lambda route: route_dist_asset(route, requested_paths))

        try:
            page.goto(QA_URL, wait_until="networkidle")
            expect(page.get_by_role("heading", name="高频标签")).to_be_visible()
            assert_production_bundle_loaded(page, requested_paths)

            screenshot_path = os.environ.get("BILI_BILL_QA_SCREENSHOT")
            if screenshot_path:
                page.screenshot(path=screenshot_path, full_page=True)

            if console_errors:
                raise AssertionError("Preference production console errors:\n" + "\n".join(console_errors))
            if page_errors:
                raise AssertionError("Preference production page errors:\n" + "\n".join(page_errors))
            assert_word_cloud_canvas(page)
            assert_no_horizontal_overflow(page)
            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(400)
            assert_word_cloud_canvas(page)
            assert_no_horizontal_overflow(page)
        finally:
            browser.close()


def assert_production_bundle_loaded(page: Page, requested_paths: list[str]) -> None:
    expect(page.locator('script[src="/dashboard.js"]')).to_have_count(1)
    if "/dashboard.js" not in requested_paths:
        raise AssertionError(f"Production dashboard bundle was not requested: {requested_paths}")
    source_requests = [
        path
        for path in requested_paths
        if path.endswith((".ts", ".tsx")) or "/dashboard/modules/" in path
    ]
    if source_requests:
        raise AssertionError(f"Production QA loaded source modules: {source_requests}")


def assert_word_cloud_canvas(page: Page) -> None:
    card = page.get_by_role("heading", name="高频标签").locator("xpath=..")
    canvas = card.locator("canvas")
    expect(canvas).to_have_count(1)
    expect(canvas).to_be_visible()
    pixels = canvas.evaluate(
        """element => {
          const context = element.getContext('2d');
          const data = context.getImageData(0, 0, element.width, element.height).data;
          let visible = 0;
          for (let index = 3; index < data.length; index += 4) {
            if (data[index] > 0) visible += 1;
          }
          return { width: element.width, height: element.height, visible };
        }"""
    )
    if pixels["width"] < 200 or pixels["height"] < 200 or pixels["visible"] < 500:
        raise AssertionError(f"Word-cloud canvas is blank or undersized: {pixels}")


def assert_no_horizontal_overflow(page: Page) -> None:
    dimensions = page.evaluate(
        """() => ({
          bodyClient: document.body.clientWidth,
          bodyScroll: document.body.scrollWidth,
          rootClient: document.documentElement.clientWidth,
          rootScroll: document.documentElement.scrollWidth,
        })"""
    )
    if dimensions["bodyScroll"] > dimensions["bodyClient"] + 1:
        raise AssertionError(f"Preference body overflow: {dimensions}")
    if dimensions["rootScroll"] > dimensions["rootClient"] + 1:
        raise AssertionError(f"Preference root overflow: {dimensions}")


def route_dist_asset(route: Route, requested_paths: list[str]) -> None:
    parsed = urlparse(route.request.url)
    if parsed.hostname != QA_HOST:
        route.abort()
        return

    path = unquote(parsed.path)
    if path in ("", "/"):
        path = "/dashboard/index.html"
    requested_paths.append(path)
    if path == "/favicon.ico":
        route.fulfill(status=204, body="")
        return

    target = safe_dist_path(path)
    if not target.exists() or not target.is_file():
        route.fulfill(status=404, body=f"Missing QA asset: {path}")
        return
    if target == DASHBOARD_INDEX:
        route.fulfill(
            status=200,
            body=target.read_text(encoding="utf-8"),
            content_type="text/html; charset=utf-8",
        )
        return
    route.fulfill(status=200, path=str(target), content_type=content_type_for(target))


def safe_dist_path(url_path: str) -> Path:
    relative = Path(*[part for part in url_path.lstrip("/").split("/") if part])
    target = (DIST / relative).resolve()
    dist_root = DIST.resolve()
    if os.path.commonpath([str(dist_root), str(target)]) != str(dist_root):
        raise AssertionError(f"Refusing to serve path outside dist: {url_path}")
    return target


def content_type_for(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if path.suffix == ".js":
        return "application/javascript; charset=utf-8"
    if path.suffix == ".css":
        return "text/css; charset=utf-8"
    return guessed or "application/octet-stream"


def chrome_mock_script() -> str:
    fixture = json.dumps(preference_fixture(), ensure_ascii=False, separators=(",", ":"))
    return f"""
(() => {{
  const fixture = {fixture};
  window.chrome = {{
    runtime: {{
      async sendMessage(message) {{
        if (message?.action === 'GET_SYNC_STATUS') {{
          return {{ success: true, data: {{ lastSyncTime: 0, totalRecords: 12 }} }};
        }}
        if (message?.action === 'GET_PREFERENCE_DATA') {{
          return {{ success: true, data: structuredClone(fixture) }};
        }}
        return {{ success: false, error: 'QA mock does not implement action: ' + message?.action }};
      }},
      getURL(path) {{ return path; }},
    }},
  }};
}})();
"""


def preference_fixture() -> dict:
    window = {
        "key": "weekly:2026-07-27",
        "label": "2026 年第 31 周",
        "startDate": "2026-07-27",
        "endDate": "2026-08-02",
        "granularity": "weekly",
        "recordCount": 12,
        "activeDays": 5,
        "totalWatchTime": 7200,
        "partialCoverage": False,
    }
    return {
        "windows": {"daily": [], "weekly": [window], "monthly": []},
        "selectedWindow": {
            "window": window,
            "state": "ready",
            "stateReason": None,
            "categories": [
                {"name": "科技", "watchTime": 3600, "percentage": 0.5},
                {"name": "知识", "watchTime": 2400, "percentage": 0.333},
                {"name": "生活", "watchTime": 1200, "percentage": 0.167},
            ],
            "durationBuckets": [
                {"label": "0-5 分钟", "min": 0, "max": 300, "count": 3},
                {"label": "5-20 分钟", "min": 300, "max": 1200, "count": 6},
                {"label": "20 分钟以上", "min": 1200, "max": 999999, "count": 3},
            ],
            "topTags": [
                {"name": "人工智能", "count": 12},
                {"name": "编程", "count": 10},
                {"name": "产品设计", "count": 8},
                {"name": "纪录片", "count": 6},
                {"name": "科普", "count": 5},
                {"name": "音乐", "count": 4},
            ],
        },
        "defaultGranularity": "weekly",
        "coverage": {
            "earliestDate": "2026-07-01",
            "latestDate": "2026-08-01",
            "activeDays": 20,
            "totalRecords": 120,
            "coveredDays": 32,
        },
    }


if __name__ == "__main__":
    main()
