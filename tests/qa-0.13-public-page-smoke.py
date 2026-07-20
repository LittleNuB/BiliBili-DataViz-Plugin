import argparse
from pathlib import Path
import re
import time

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = ROOT / "dist"
SINGLE_PART_URL = "https://www.bilibili.com/video/BV1uVLX6uEYC/"
MULTI_PART_URL = "https://www.bilibili.com/video/BV1NCgVzoEG9/?p=2"
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
AI_HOSTS = ["api.deepseek.com", "api.openai.com"]


def extension_service_workers(context) -> list[str]:
    return [
        worker.url
        for worker in context.service_workers
        if re.fullmatch(r"chrome-extension://[^/]+/background\.js", worker.url)
    ]


def assert_clean_assistant_copy(assistant) -> None:
    visible = assistant.inner_text()
    for term in FORBIDDEN_VISIBLE_TERMS:
        if term.lower() in visible.lower():
            raise AssertionError(f"Current-video assistant leaked visible term: {term}")


def expand_and_check_tabs(page):
    assistant = page.locator("#bdc-current-video-assistant")
    expect(assistant).to_be_visible(timeout=60_000)
    expand = assistant.get_by_role("button", name="展开助手")
    if expand.count() > 0:
        expand.click()
    for label in ["摘要", "亮点", "问答", "字幕"]:
        expect(assistant.get_by_role("tab", name=label, exact=True)).to_be_visible(timeout=20_000)
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

    ai_requests = []
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
            print(f"CHECK qa-0.13-public-page-smoke: MV3 service worker loaded ({workers[0]})")

            page = context.pages[0] if context.pages else context.new_page()
            page.on(
                "request",
                lambda request: ai_requests.append(request.url)
                if any(host in request.url for host in AI_HOSTS)
                else None,
            )

            response = page.goto(SINGLE_PART_URL, wait_until="domcontentloaded", timeout=90_000)
            if response is None or response.status >= 400:
                raise AssertionError(f"Public single-part page failed to load: {response.status if response else 'no response'}")
            single_assistant = expand_and_check_tabs(page)
            expect(single_assistant).to_contain_text("当前分 P 已识别", timeout=60_000)

            if not args.single_only:
                response = page.goto(MULTI_PART_URL, wait_until="domcontentloaded", timeout=90_000)
                if response is None or response.status >= 400:
                    raise AssertionError(f"Public multi-part page failed to load: {response.status if response else 'no response'}")
                multi_assistant = expand_and_check_tabs(page)
                expect(multi_assistant).to_contain_text(re.compile(r"第\s*2\s*/\s*\d+\s*P"), timeout=60_000)
        finally:
            context.close()

    if ai_requests:
        raise AssertionError(f"Opening or expanding the assistant sent AI requests: {ai_requests}")
    scope = "single-part" if args.single_only else "single/multi-part"
    print(f"PASS qa-0.13-public-page-smoke: extension loaded, {scope} identity recognized, no automatic AI request")


if __name__ == "__main__":
    main()
