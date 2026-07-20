import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from threading import Thread
import time

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = ROOT / "dist"
SINGLE_PART_URL = "https://www.bilibili.com/video/BV1uVLX6uEYC/"
MULTI_PART_URL = "https://www.bilibili.com/video/BV1NCgVzoEG9/?p=2"
SINGLE_PART_TITLE = "【闪客】1M 上下文很难吗？深入解读 GLM5.2 上下文背后的技术"
MULTI_VIDEO_TITLE = "【闪客】一小时从函数到 Transformer"
MULTI_PART_TITLE = "02 计算神经网络的参数"
FORBIDDEN_VISIBLE_TERMS = [
    "未消费",
    "猜你喜欢",
    "fallback",
    "transcript",
    "confidence",
    "sourceHash",
    "segmentId",
    "subtitle_url",
    "document is not defined",
    "ReferenceError",
    "BVID",
    "CID",
]


def extension_service_workers(context):
    return [
        worker
        for worker in context.service_workers
        if re.fullmatch(r"chrome-extension://[^/]+/background\.js", worker.url)
    ]


class AiRequestProbe:
    def __init__(self) -> None:
        self.requests: list[str] = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                self._record()

            def do_POST(self) -> None:
                self._record()

            def do_OPTIONS(self) -> None:
                self._record()

            def _record(self) -> None:
                length = int(self.headers.get("Content-Length", "0") or 0)
                if length > 0:
                    self.rfile.read(length)
                owner.requests.append(f"{self.command} {self.path}")
                self.send_response(204)
                self.end_headers()

            def log_message(self, _format: str, *_args) -> None:
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def configure_enabled_fake_ai(worker, base_url: str) -> None:
    config = {
        "dailyWatchGoal": 60,
        "weeklyWatchGoal": 420,
        "overDependencyThreshold": 0.3,
        "syncIntervalMinutes": 5,
        "retentionDays": 90,
        "showSidebar": True,
        "theme": "dark",
        "ai": {
            "baseURL": base_url,
            "apiKey": "qa-non-secret-key",
            "chatModel": "qa-no-auto-request-model",
        },
        "assistant": {
            "currentVideoAiAssistantEnabled": True,
            "smartFavoritesQaAiEnabled": False,
        },
        "dynamicBill": {"aiExplanationsEnabled": False},
    }
    worker.evaluate(
        "async config => { await chrome.storage.local.set({ userConfig: config }); }",
        config,
    )


def navigate_public_page(context, page, url: str, label: str):
    for attempt in range(1, 4):
        try:
            response = page.goto(url, wait_until="domcontentloaded", timeout=90_000)
            if response is None or response.status >= 400:
                raise AssertionError(
                    f"Public {label} page failed to load: {response.status if response else 'no response'}"
                )
            return page
        except PlaywrightError as error:
            retryable = "ERR_CONNECTION_CLOSED" in str(error) or isinstance(error, PlaywrightTimeoutError)
            if not retryable or attempt == 3:
                raise
            reason = "timed out" if isinstance(error, PlaywrightTimeoutError) else "was closed"
            print(f"RETRY qa-0.13-public-page-smoke: {label} navigation attempt {attempt} {reason}")
            next_page = context.new_page()
            page.close()
            time.sleep(attempt * 2)
            page = next_page
    raise AssertionError(f"Public {label} page navigation exhausted retries")


def assert_clean_assistant_copy(assistant) -> None:
    visible = assistant.inner_text()
    for term in FORBIDDEN_VISIBLE_TERMS:
        if term.lower() in visible.lower():
            raise AssertionError(f"Current-video assistant leaked visible term: {term}")


def expand_and_check_tabs(page, expected_title: str, part_pattern: str):
    assistant = page.locator("#bdc-current-video-assistant")
    expect(assistant).to_be_visible(timeout=60_000)
    expand = assistant.get_by_role("button", name="展开助手")
    if expand.count() > 0:
        expand.click()
    expect(assistant).to_contain_text(expected_title, timeout=60_000)
    expect(assistant).to_contain_text(re.compile(part_pattern), timeout=60_000)
    for label in ["摘要", "亮点", "问答", "字幕"]:
        tab = assistant.get_by_role("tab", name=label, exact=True)
        expect(tab).to_be_visible(timeout=20_000)
        tab.click()
        assert_clean_assistant_copy(assistant)
    assert_clean_assistant_copy(assistant)
    return assistant


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--single-only",
        action="store_true",
        help="Only verify the public single-part page when multi-part navigation is blocked by the network environment.",
    )
    args = parser.parse_args()

    if not (EXTENSION_ROOT / "manifest.json").exists():
        raise AssertionError("Missing dist/manifest.json. Run npm run build first.")

    ai_probe = AiRequestProbe()
    ai_probe.start()
    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                "",
                channel="msedge",
                headless=False,
                args=[
                    f"--disable-extensions-except={EXTENSION_ROOT}",
                    f"--load-extension={EXTENSION_ROOT}",
                    "--disable-quic",
                    "--window-position=-32000,-32000",
                    "--window-size=1280,900",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--autoplay-policy=user-gesture-required",
                ],
            )
            try:
                deadline = time.monotonic() + 15
                workers = extension_service_workers(context)
                while not workers and time.monotonic() < deadline:
                    try:
                        context.wait_for_event("serviceworker", timeout=1_000)
                    except Exception:
                        pass
                    workers = extension_service_workers(context)
                if not workers:
                    all_workers = [worker.url for worker in context.service_workers]
                    raise AssertionError(f"Bili-Bill MV3 service worker did not load: {all_workers}")
                print(f"CHECK qa-0.13-public-page-smoke: MV3 service worker loaded ({workers[0].url})")
                configure_enabled_fake_ai(workers[0], ai_probe.base_url)

                page = context.pages[0] if context.pages else context.new_page()
                page = navigate_public_page(context, page, SINGLE_PART_URL, "single-part")
                expect(page).to_have_title(re.compile(re.escape(SINGLE_PART_TITLE)), timeout=60_000)
                single_assistant = expand_and_check_tabs(
                    page,
                    SINGLE_PART_TITLE,
                    r"第\s*1(?:\s*/\s*1)?\s*P",
                )
                expect(single_assistant).to_contain_text("当前分 P 已识别", timeout=60_000)

                if not args.single_only:
                    page = navigate_public_page(context, page, MULTI_PART_URL, "multi-part")
                    expect(page).to_have_title(re.compile(re.escape(MULTI_PART_TITLE)), timeout=60_000)
                    expand_and_check_tabs(page, MULTI_VIDEO_TITLE, r"第\s*2\s*/\s*8\s*P")
            finally:
                context.close()
    finally:
        ai_probe.close()

    if ai_probe.requests:
        raise AssertionError(f"Opening or switching assistant tabs sent AI requests: {ai_probe.requests}")
    scope = "single-part" if args.single_only else "single/multi-part"
    print(f"PASS qa-0.13-public-page-smoke: extension loaded, {scope} identity recognized, no automatic AI request")


if __name__ == "__main__":
    main()
