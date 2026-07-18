from pathlib import Path
import os
import subprocess
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MOCK_HTML = ROOT / "tests" / "current-video-assistant-shell.mock.html"
MOCK_URL = "https://www.bilibili.com/video/BV1ShellMock9"
PLAYER_MONITOR_BUNDLE = ROOT / "dist" / "content" / "player-monitor.js"
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
    "MOCK_PRIMARY_TEXT_STORAGE_READ_FAILED",
    "MOCK_PRIMARY_TEXT_STORAGE_WRITE_FAILED",
]
FULL_TEXT_OR_SEARCH_ACTIONS = {
    "GET_CURRENT_VIDEO_SUMMARY",
    "GET_VIDEO_KNOWLEDGE",
    "SEARCH_CURRENT_VIDEO_SEGMENTS",
}


def route_mock(route):
    request = route.request
    parsed = urlparse(request.url)
    path = parsed.path
    if path.startswith("/video/"):
        route.fulfill(
            status=200,
            content_type="text/html; charset=utf-8",
            body=MOCK_HTML.read_text(encoding="utf-8"),
        )
        return

    local_path = ROOT / path.lstrip("/")
    if local_path.exists() and local_path.is_file():
        content_type = "application/javascript; charset=utf-8" if local_path.suffix == ".js" else "text/plain; charset=utf-8"
        route.fulfill(
            status=200,
            content_type=content_type,
            body=local_path.read_bytes(),
        )
        return

    route.fulfill(status=404, body="not found")


def build_player_monitor_bundle():
    npm = "npm.cmd" if os.name == "nt" else "npm"
    command = [npm, "exec", "--", "vite", "build", "--config", "vite.player-monitor.config.ts"]
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=120,
    )
    if result.returncode != 0:
        raise AssertionError(f"player-monitor content bundle build failed:\n{result.stdout}")
    if not PLAYER_MONITOR_BUNDLE.exists():
        raise AssertionError(f"player-monitor content bundle was not generated: {PLAYER_MONITOR_BUNDLE}")


def message_actions(page):
    return page.evaluate("[...(window.__assistantMockMessages || [])].map((message) => message.action)")


def last_message_for(page, action):
    return page.evaluate(
        """(action) => {
            const messages = window.__assistantMockMessages || [];
            return [...messages].reverse().find((message) => message.action === action) || null;
        }""",
        action,
    )


def message_count_for(page, action):
    return page.evaluate(
        """(action) => (window.__assistantMockMessages || [])
            .filter((message) => message.action === action).length""",
        action,
    )


def assert_no_full_text_or_search(page):
    actions = message_actions(page)
    leaked = [action for action in actions if action in FULL_TEXT_OR_SEARCH_ACTIONS]
    assert leaked == [], f"unexpected user-action request before interaction: {leaked}"


def assert_clean_visible_text(page):
    text = page.locator("body").inner_text()
    for term in FORBIDDEN_VISIBLE_TERMS:
        assert term not in text, f"visible raw term leaked: {term}"


def assert_no_horizontal_overflow(page):
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
    assert not overflow, "page has horizontal overflow"


def run_flow(page):
    page.route("**/*", route_mock)
    page.goto(MOCK_URL)
    expect(page.locator("#bdc-current-video-assistant")).to_be_visible()
    expect(page.get_by_text("展开助手")).to_be_visible()
    assert_no_full_text_or_search(page)

    page.get_by_text("展开助手").click()
    expect(page.get_by_text("主要文本来源").first).to_be_visible()
    expect(page.get_by_text("本地转录")).to_have_count(0)
    expect(page.get_by_text("暂不可用", exact=True)).to_have_count(0)
    expect(page.get_by_text("问这个视频", exact=True)).to_be_visible()
    assert_no_full_text_or_search(page)

    page.get_by_role("button", name="重新检测字幕").first.click()
    expect(page.get_by_text("B站字幕").first).to_be_visible()
    expect(page.get_by_text("用于视频助手").first).to_be_visible()
    actions_after_redetect = message_actions(page)
    assert "GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE" in actions_after_redetect
    assert not any(action in FULL_TEXT_OR_SEARCH_ACTIONS for action in actions_after_redetect)

    expect(page.locator(".bdc-assistant-source-card").filter(has_text="B站字幕").get_by_text("查看来源")).to_have_count(0)
    storage_before_select = page.evaluate("window.__assistantMockStorage.currentVideoPrimaryTextSelections || null")
    assert storage_before_select in (None, {}), "source card must not save the assistant source before explicit selection"

    page.locator(".bdc-assistant-source-card").filter(has_text="B站字幕").get_by_role("button", name="用于视频助手").click()
    expect(page.get_by_text("已用于当前视频助手").first).to_be_visible()
    storage_after_select = page.evaluate("window.__assistantMockStorage.currentVideoPrimaryTextSelections || {}")
    assert storage_after_select, "explicit assistant source selection was not saved"

    page.get_by_role("button", name="重新检测字幕").first.click()
    page.wait_for_function(
        """() => [...(window.__assistantMockMessages || [])].reverse().some(
            (message) => message.action === "GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE"
                && message.params?.selectedSourceIdentityKey
        )"""
    )
    refresh_message = last_message_for(page, "GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE")
    assert refresh_message["params"].get("selectedSourceIdentityKey"), "selected source key was not sent with subtitle refresh"

    page.locator("textarea").fill("subagent 在哪里")
    page.get_by_role("button", name="提问").click()
    expect(page.get_by_text("回答：有证据")).to_be_visible()
    expect(page.get_by_text("引用片段", exact=True)).to_be_visible()
    search_message = last_message_for(page, "SEARCH_CURRENT_VIDEO_SEGMENTS")
    assert search_message["params"].get("selectedSourceIdentityKey"), "selected source key was not sent with search"

    page.get_by_role("button", name="预览跳转").first.click()
    expect(page.get_by_text("确认跳转前预览")).to_be_visible()
    page.get_by_role("button", name="确认跳转").click()
    expect(page.get_by_text("返回原位置")).to_be_visible()
    jump_message = last_message_for(page, "REQUEST_CURRENT_VIDEO_SEGMENT_JUMP")
    assert jump_message["params"].get("selectedSourceIdentityKey"), "selected source key was not sent with jump"

    page.get_by_role("button", name="返回原位置").click()
    expect(page.get_by_text("已返回")).to_be_visible()

    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def run_missing_selection_flow(page):
    page.route("**/*", route_mock)
    page.goto(MOCK_URL)
    expect(page.locator("#bdc-current-video-assistant")).to_be_visible()

    page.get_by_text("展开助手").click()
    expect(page.get_by_text("主要文本来源").first).to_be_visible()
    page.get_by_role("button", name="重新检测字幕").first.click()
    expect(page.get_by_text("B站字幕").first).to_be_visible()
    page.locator(".bdc-assistant-source-card").filter(has_text="B站字幕").get_by_role("button", name="用于视频助手").click()
    expect(page.get_by_text("已用于当前视频助手").first).to_be_visible()

    storage_after_select = page.evaluate("window.__assistantMockStorage.currentVideoPrimaryTextSelections || {}")
    saved_keys = list(storage_after_select.values())
    assert saved_keys, "explicit V1 source selection was not saved"
    saved_v1_key = saved_keys[0]

    page.evaluate("window.__assistantMockReplaceSubtitleSource()")
    search_count_before = message_count_for(page, "SEARCH_CURRENT_VIDEO_SEGMENTS")
    page.get_by_role("button", name="重新检测字幕").first.click()
    page.wait_for_function(
        """(expected) => [...(window.__assistantMockMessages || [])].reverse().some(
            (message) => message.action === "GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE"
                && message.params?.selectedSourceIdentityKey === expected
        )""",
        arg=saved_v1_key,
    )

    expect(page.get_by_text("此前选择的主要文本来源已经不可用").first).to_be_visible()
    expect(page.locator("textarea")).to_be_disabled()
    expect(page.get_by_role("button", name="提问")).to_be_disabled()
    assert message_count_for(page, "SEARCH_CURRENT_VIDEO_SEGMENTS") == search_count_before

    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def run_late_switch_flow(page):
    page.route("**/*", route_mock)
    page.goto(MOCK_URL)
    expect(page.locator("#bdc-current-video-assistant")).to_be_visible()

    page.get_by_text("展开助手").click()
    expect(page.get_by_text("主要文本来源").first).to_be_visible()
    page.evaluate("window.__assistantMockSwitchDuringTranscript()")
    page.get_by_role("button", name="重新检测字幕").first.click()

    expect(page.get_by_text("当前视频或分 P 已切换，请在当前分 P 重新检测字幕。")).to_be_visible()
    expect(page.locator(".bdc-assistant-source-card").filter(has_text="B站字幕")).to_have_count(0)
    assert_no_full_text_or_search(page)
    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def run_deferred_storage_flow(page):
    page.route("**/*", route_mock)
    page.goto(f"{MOCK_URL}?subtitleCached=1&sourceVersion=v2&deferPrimaryTextStorage=1&savedSource=v1")
    expect(page.locator("#bdc-current-video-assistant")).to_be_visible()

    page.get_by_text("展开助手").click()
    expect(page.get_by_text("正在读取本页保存的主要文本来源选择").first).to_be_visible()
    expect(page.locator("textarea")).to_be_disabled()
    expect(page.get_by_role("button", name="提问")).to_be_disabled()

    counts_before = {
        action: message_count_for(page, action)
        for action in [
            "GET_CURRENT_VIDEO_SUMMARY",
            "GET_VIDEO_KNOWLEDGE",
            "SEARCH_CURRENT_VIDEO_SEGMENTS",
            "REQUEST_CURRENT_VIDEO_SEGMENT_JUMP",
        ]
    }
    page.get_by_role("button", name="提问").evaluate("(button) => button.click()")
    for action, count in counts_before.items():
        assert message_count_for(page, action) == count, f"{action} should stay blocked before storage resolves"

    saved_v1_key = page.evaluate(
        """() => Object.values(window.__assistantMockStorage.currentVideoPrimaryTextSelections || {})[0] || null"""
    )
    assert saved_v1_key and saved_v1_key.endswith("mock-source-hash-hidden-v1")
    page.evaluate("window.__assistantMockResolvePrimaryTextStorage()")
    expect(page.get_by_text("此前选择的主要文本来源已经不可用").first).to_be_visible()
    expect(page.locator("textarea")).to_be_disabled()
    expect(page.get_by_role("button", name="提问")).to_be_disabled()

    page.get_by_role("button", name="重新检测字幕").first.click()
    page.wait_for_function(
        """(expected) => [...(window.__assistantMockMessages || [])].reverse().some(
            (message) => message.action === "GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE"
                && message.params?.selectedSourceIdentityKey === expected
        )""",
        arg=saved_v1_key,
    )
    refresh_message = last_message_for(page, "GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE")
    assert refresh_message["params"].get("selectedSourceIdentityKey") == saved_v1_key
    assert refresh_message["params"].get("selectedSourceIdentityKey") != page.evaluate("window.__assistantMockCurrentSourceIdentityKey()")

    page.get_by_role("button", name="提问").evaluate("(button) => button.click()")
    assert message_count_for(page, "SEARCH_CURRENT_VIDEO_SEGMENTS") == counts_before["SEARCH_CURRENT_VIDEO_SEGMENTS"]
    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def run_single_v2_without_saved_selection_flow(page):
    page.route("**/*", route_mock)
    page.goto(f"{MOCK_URL}?subtitleCached=1&sourceVersion=v2")
    expect(page.locator("#bdc-current-video-assistant")).to_be_visible()

    page.get_by_text("展开助手").click()
    page.get_by_role("button", name="重新检测字幕").first.click()
    expect(page.get_by_text("B站字幕").first).to_be_visible()
    expect(page.locator("textarea")).to_be_enabled()
    current_v2_key = page.evaluate("window.__assistantMockCurrentSourceIdentityKey()")

    page.locator("textarea").fill("subagent 在哪里")
    page.get_by_role("button", name="提问").click()
    expect(page.get_by_text("回答：有证据")).to_be_visible()
    search_message = last_message_for(page, "SEARCH_CURRENT_VIDEO_SEGMENTS")
    assert search_message["params"].get("primaryTextSelectionsReady") is True
    assert search_message["params"].get("selectedSourceIdentityKey") == current_v2_key

    page.get_by_role("button", name="预览跳转").first.click()
    page.get_by_role("button", name="确认跳转").click()
    jump_message = last_message_for(page, "REQUEST_CURRENT_VIDEO_SEGMENT_JUMP")
    assert jump_message["params"].get("primaryTextSelectionsReady") is True
    assert jump_message["params"].get("selectedSourceIdentityKey") == current_v2_key

    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def run_rejected_storage_single_v2_flow(page):
    page.route("**/*", route_mock)
    page.goto(f"{MOCK_URL}?subtitleCached=1&sourceVersion=v2&rejectPrimaryTextStorage=1&savedSource=v1")
    expect(page.locator("#bdc-current-video-assistant")).to_be_visible()

    page.get_by_text("展开助手").click()
    expect(page.get_by_text("正在读取本页保存的主要文本来源选择").first).to_be_visible()
    expect(page.locator("textarea")).to_be_disabled()
    expect(page.get_by_role("button", name="读取摘要")).to_be_disabled()
    expect(page.get_by_role("button", name="刷新节点")).to_be_disabled()

    blocked_actions = [
        "GET_CURRENT_VIDEO_SUMMARY",
        "GET_VIDEO_KNOWLEDGE",
        "SEARCH_CURRENT_VIDEO_SEGMENTS",
        "REQUEST_CURRENT_VIDEO_SEGMENT_JUMP",
    ]
    counts_before_reject = {action: message_count_for(page, action) for action in blocked_actions}
    page.get_by_role("button", name="读取摘要").evaluate("(button) => button.click()")
    page.get_by_role("button", name="刷新节点").evaluate("(button) => button.click()")
    page.get_by_role("button", name="重新检测字幕").first.evaluate("(button) => button.click()")
    page.locator("textarea").evaluate(
        """(textarea) => {
            textarea.value = "subagent 在哪里";
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }"""
    )
    page.get_by_role("button", name="提问").evaluate("(button) => button.click()")
    for action, count in counts_before_reject.items():
        assert message_count_for(page, action) == count, f"{action} should stay blocked while storage read is pending"

    page.evaluate("window.__assistantMockRejectPrimaryTextStorage()")
    expect(page.get_by_text("保存的主要文本来源选择读取失败").first).to_be_visible()
    current_v2_key = page.evaluate("window.__assistantMockCurrentSourceIdentityKey()")
    expect(page.locator("textarea")).to_be_disabled()

    counts_after_reject = {action: message_count_for(page, action) for action in blocked_actions}
    page.get_by_role("button", name="读取摘要").evaluate("(button) => button.click()")
    page.get_by_role("button", name="刷新节点").evaluate("(button) => button.click()")
    page.get_by_role("button", name="提问").evaluate("(button) => button.click()")
    for action, count in counts_after_reject.items():
        assert message_count_for(page, action) == count, f"{action} should stay blocked after storage read rejection"

    page.get_by_role("button", name="重新检测字幕").first.click()
    expect(page.get_by_text("B站字幕").first).to_be_visible()
    refresh_after_reject = last_message_for(page, "GET_CURRENT_VIDEO_TRANSCRIPT_EVIDENCE")
    assert refresh_after_reject["params"].get("primaryTextSelectionsReady") is False
    assert not refresh_after_reject["params"].get("selectedSourceIdentityKey")

    page.evaluate("window.__assistantMockRejectNextPrimaryTextStorageSet()")
    page.locator(".bdc-assistant-source-card").filter(has_text="B站字幕").get_by_role("button", name="用于视频助手").click()
    expect(page.get_by_text("保存主要文本来源失败").first).to_be_visible()
    expect(page.locator("textarea")).to_be_disabled()
    expect(page.get_by_role("button", name="读取摘要")).to_be_disabled()
    expect(page.get_by_role("button", name="刷新节点")).to_be_disabled()
    storage_after_failed_set = page.evaluate("window.__assistantMockStorage.currentVideoPrimaryTextSelections || {}")
    assert current_v2_key not in list(storage_after_failed_set.values()), "failed save must roll back in-memory selection"
    counts_after_failed_set = {action: message_count_for(page, action) for action in blocked_actions}
    page.get_by_role("button", name="读取摘要").evaluate("(button) => button.click()")
    page.get_by_role("button", name="刷新节点").evaluate("(button) => button.click()")
    page.get_by_role("button", name="提问").evaluate("(button) => button.click()")
    for action, count in counts_after_failed_set.items():
        assert message_count_for(page, action) == count, f"{action} should stay blocked after source save rejection"

    page.locator(".bdc-assistant-source-card").filter(has_text="B站字幕").get_by_role("button", name="用于视频助手").click()
    expect(page.get_by_text("已用于当前视频助手").first).to_be_visible()
    expect(page.locator("textarea")).to_be_enabled()
    expect(page.get_by_role("button", name="读取摘要")).to_be_enabled()
    expect(page.get_by_role("button", name="刷新节点")).to_be_enabled()
    storage_after_success = page.evaluate("window.__assistantMockStorage.currentVideoPrimaryTextSelections || {}")
    assert current_v2_key in list(storage_after_success.values()), "successful explicit selection must persist exact V2"

    page.locator("textarea").fill("subagent 在哪里")
    page.get_by_role("button", name="提问").click()
    expect(page.get_by_text("回答：有证据")).to_be_visible()
    search_message = last_message_for(page, "SEARCH_CURRENT_VIDEO_SEGMENTS")
    assert search_message["params"].get("primaryTextSelectionsReady") is True
    assert search_message["params"].get("selectedSourceIdentityKey") == current_v2_key

    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def main():
    build_player_monitor_bundle()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            deferred_storage, deferred_storage_errors = new_checked_page(browser, viewport={"width": 1280, "height": 820})
            run_deferred_storage_flow(deferred_storage)
            assert not deferred_storage_errors, "\n".join(deferred_storage_errors)
            deferred_storage.close()

            single_v2, single_v2_errors = new_checked_page(browser, viewport={"width": 1280, "height": 820})
            run_single_v2_without_saved_selection_flow(single_v2)
            assert not single_v2_errors, "\n".join(single_v2_errors)
            single_v2.close()

            rejected_storage, rejected_storage_errors = new_checked_page(browser, viewport={"width": 1280, "height": 820})
            run_rejected_storage_single_v2_flow(rejected_storage)
            assert not rejected_storage_errors, "\n".join(rejected_storage_errors)
            rejected_storage.close()

            late_switch, late_switch_errors = new_checked_page(browser, viewport={"width": 1280, "height": 820})
            run_late_switch_flow(late_switch)
            assert not late_switch_errors, "\n".join(late_switch_errors)
            late_switch.close()

            missing_selection, missing_selection_errors = new_checked_page(browser, viewport={"width": 1280, "height": 820})
            run_missing_selection_flow(missing_selection)
            assert not missing_selection_errors, "\n".join(missing_selection_errors)
            missing_selection.close()

            desktop, desktop_errors = new_checked_page(browser, viewport={"width": 1280, "height": 820})
            run_flow(desktop)
            assert not desktop_errors, "\n".join(desktop_errors)
            desktop.close()

            mobile, mobile_errors = new_checked_page(browser, viewport={"width": 390, "height": 760}, is_mobile=True)
            run_flow(mobile)
            assert not mobile_errors, "\n".join(mobile_errors)
            mobile.close()

            print("current-video primary-text real UI QA passed: deferred and rejected storage readiness, missing saved source, single-source fallback, desktop/mobile source selection, no automatic full-text request, search/jump/return, no raw visible leak, no overflow, no console errors")
        finally:
            browser.close()


def new_checked_page(browser, **kwargs):
    page = browser.new_page(**kwargs)
    errors = []
    page.on("console", lambda message: errors.append(f"console {message.type}: {message.text}") if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    return page, errors


if __name__ == "__main__":
    main()
