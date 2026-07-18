from pathlib import Path
import mimetypes
import os
import subprocess
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
POPUP_HTML = ROOT / "dist" / "popup" / "index.html"
POPUP_BUNDLE = ROOT / "dist" / "popup.js"
MOCK_SCRIPT = ROOT / "tests" / "current-video-popup.mock.js"
POPUP_URL = "http://popup.mock/popup"
PROTECTED_ACTIONS = {
    "GET_CURRENT_VIDEO_SUMMARY",
    "GET_VIDEO_KNOWLEDGE",
    "SEARCH_CURRENT_VIDEO_SEGMENTS",
    "REQUEST_CURRENT_VIDEO_SEGMENT_JUMP",
}
FORBIDDEN_VISIBLE_TERMS = [
    "未消费",
    "猜你喜欢",
    "fallback",
    "transcript",
    "confidence",
    "sourceHash",
    "segmentId",
    "subtitle_url",
    "MOCK_POPUP_PRIMARY_TEXT_STORAGE_READ_FAILED",
    "PRIMARY_TEXT",
]


def build_popup_bundle():
    npm = "npm.cmd" if os.name == "nt" else "npm"
    result = subprocess.run(
        [npm, "run", "build"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
    )
    if result.returncode != 0:
        raise AssertionError(f"popup production build failed:\n{result.stdout}")
    if not POPUP_HTML.exists() or not POPUP_BUNDLE.exists():
        raise AssertionError("popup production artifact was not generated")


def route_popup(route):
    parsed = urlparse(route.request.url)
    if parsed.path == "/popup":
        html = POPUP_HTML.read_text(encoding="utf-8")
        mock = MOCK_SCRIPT.read_text(encoding="utf-8")
        html = html.replace("</head>", f"<script>{mock}</script></head>")
        route.fulfill(status=200, content_type="text/html; charset=utf-8", body=html)
        return

    local_path = ROOT / "dist" / parsed.path.lstrip("/")
    if local_path.exists() and local_path.is_file():
        content_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
        route.fulfill(status=200, content_type=content_type, body=local_path.read_bytes())
        return

    route.fulfill(status=404, body="not found")


def messages_for(page, action):
    return page.evaluate(
        """(action) => (window.__popupMockMessages || []).filter(message => message.action === action)""",
        action,
    )


def last_message_for(page, action):
    messages = messages_for(page, action)
    return messages[-1] if messages else None


def assert_no_protected_actions(page):
    actions = page.evaluate("(window.__popupMockMessages || []).map(message => message.action)")
    assert not PROTECTED_ACTIONS.intersection(actions), f"popup sent protected actions automatically: {actions}"


def assert_clean_page(page):
    visible = page.locator("body").inner_text()
    for term in FORBIDDEN_VISIBLE_TERMS:
        assert term not in visible, f"popup leaked raw visible term: {term}"
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
    assert not overflow, "popup has horizontal overflow"


def run_manual_exact_flow(page):
    page.route("**/*", route_popup)
    page.goto(POPUP_URL)
    expect(page.get_by_text("Popup 授权 Mock 视频").first).to_be_visible()
    assert_no_protected_actions(page)

    page.get_by_role("button", name="重新检测字幕").click()
    page.wait_for_function(
        "(window.__popupMockMessages || []).some(message => message.action === 'GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE')"
    )
    assert_no_protected_actions(page)

    page.get_by_role("button", name="刷新摘要").click()
    expect(page.get_by_text("手动摘要已使用精确的当前正文来源。")).to_be_visible()
    page.get_by_role("button", name="刷新", exact=True).click()
    page.locator("input[placeholder='例如：模型架构那段']").fill("授权测试")
    page.get_by_role("button", name="检索", exact=True).click()
    expect(page.get_by_role("button", name="预览跳转")).to_be_visible()
    page.get_by_role("button", name="预览跳转").click()
    page.get_by_role("button", name="确认跳转").click()
    expect(page.get_by_role("button", name="返回原位置")).to_be_visible()

    expected = page.evaluate("window.__popupMockSourceV2")
    for action in PROTECTED_ACTIONS:
        message = last_message_for(page, action)
        assert message, f"manual popup flow did not send {action}"
        assert message["params"].get("primaryTextSelectionsReady") is True
        assert message["params"].get("selectedSourceIdentityKey") == expected

    page.get_by_role("button", name="返回原位置").click()
    expect(page.get_by_text("已返回 0:12。")).to_be_visible()
    assert_clean_page(page)


def run_stale_saved_source_flow(page):
    page.route("**/*", route_popup)
    page.goto(f"{POPUP_URL}?savedV1=1")
    expect(page.get_by_text("Popup 授权 Mock 视频").first).to_be_visible()
    assert_no_protected_actions(page)

    page.get_by_role("button", name="刷新摘要").click()
    page.get_by_role("button", name="刷新", exact=True).click()
    page.locator("input[placeholder='例如：模型架构那段']").fill("失效来源")
    page.get_by_role("button", name="检索", exact=True).click()
    page.wait_for_function(
        "(window.__popupMockMessages || []).some(message => message.action === 'SEARCH_CURRENT_VIDEO_SEGMENTS')"
    )
    page.wait_for_timeout(50)
    expect(page.get_by_role("button", name="预览跳转")).to_have_count(0)

    saved_v1 = page.evaluate("window.__popupMockSourceV1")
    active_v2 = page.evaluate("window.__popupMockSourceV2")
    for action in ["GET_CURRENT_VIDEO_SUMMARY", "GET_VIDEO_KNOWLEDGE", "SEARCH_CURRENT_VIDEO_SEGMENTS"]:
        message = last_message_for(page, action)
        assert message
        assert message["params"].get("primaryTextSelectionsReady") is True
        assert message["params"].get("selectedSourceIdentityKey") == saved_v1
        assert message["params"].get("selectedSourceIdentityKey") != active_v2
    assert len(messages_for(page, "REQUEST_CURRENT_VIDEO_SEGMENT_JUMP")) == 0
    assert_clean_page(page)


def run_blocked_flow(page, query, expected_message):
    page.route("**/*", route_popup)
    page.goto(f"{POPUP_URL}?{query}")
    expect(page.get_by_text("Popup 授权 Mock 视频").first).to_be_visible()
    assert_no_protected_actions(page)

    page.get_by_role("button", name="刷新摘要").click()
    expect(page.get_by_text(expected_message).first).to_be_visible()
    page.get_by_role("button", name="刷新", exact=True).click()
    page.locator("input[placeholder='例如：模型架构那段']").fill("不应发送")
    page.get_by_role("button", name="检索", exact=True).click()
    assert_no_protected_actions(page)
    assert_clean_page(page)


def new_checked_page(browser):
    page = browser.new_page(viewport={"width": 390, "height": 760})
    errors = []
    page.on("console", lambda message: errors.append(f"console {message.type}: {message.text}") if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    return page, errors


def main():
    build_popup_bundle()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            manual, manual_errors = new_checked_page(browser)
            run_manual_exact_flow(manual)
            assert not manual_errors, "\n".join(manual_errors)
            manual.close()

            stale, stale_errors = new_checked_page(browser)
            run_stale_saved_source_flow(stale)
            assert not stale_errors, "\n".join(stale_errors)
            stale.close()

            rejected, rejected_errors = new_checked_page(browser)
            run_blocked_flow(rejected, "rejectStorage=1", "保存的主要文本来源选择读取失败")
            assert not rejected_errors, "\n".join(rejected_errors)
            rejected.close()

            missing, missing_errors = new_checked_page(browser)
            run_blocked_flow(missing, "missingIdentity=1", "当前视频分 P 身份信息不完整")
            assert not missing_errors, "\n".join(missing_errors)
            missing.close()

            print("current-video popup real UI QA passed: open/reprobe no generation, manual exact summary/knowledge/search/jump/return, stale saved source fail-closed, storage and identity failures blocked, no raw visible leak, no overflow, no console errors")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
