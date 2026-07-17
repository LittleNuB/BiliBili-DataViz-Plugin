from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MOCK_URL = (ROOT / "tests" / "current-video-primary-text.mock.html").as_uri()
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
]


def assert_clean_visible_text(page):
    text = page.locator("body").inner_text()
    for term in FORBIDDEN_VISIBLE_TERMS:
        assert term not in text, f"visible raw term leaked: {term}"


def assert_no_horizontal_overflow(page):
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
    assert not overflow, "page has horizontal overflow"


def run_flow(page):
    page.goto(MOCK_URL)
    expect(page.get_by_test_id("subtitle-state")).to_contain_text("可能有 AI 字幕")
    expect(page.get_by_test_id("primary-state")).to_contain_text("暂无正文")
    expect(page.get_by_test_id("request-count")).to_have_text("完整文本请求：0")

    page.get_by_test_id("auth-toggle").check()
    expect(page.get_by_test_id("request-count")).to_have_text("完整文本请求：0")

    page.get_by_test_id("redetect").click()
    expect(page.get_by_test_id("subtitle-state")).to_contain_text("没有探测到字幕轨道")
    expect(page.get_by_test_id("request-count")).to_have_text("完整文本请求：0")

    page.get_by_test_id("enable-ai-subtitle").click()
    expect(page.get_by_test_id("subtitle-state")).to_contain_text("已探测到字幕轨道")
    expect(page.get_by_test_id("primary-state")).to_contain_text("暂无正文")

    page.get_by_test_id("redetect").click()
    expect(page.get_by_test_id("subtitle-state")).to_contain_text("已取得")
    expect(page.get_by_test_id("primary-state")).to_contain_text("B站字幕可用")
    expect(page.get_by_test_id("switch-hint")).to_contain_text("只有一个来源")
    expect(page.locator(".source-card")).to_have_count(1)
    expect(page.get_by_test_id("request-count")).to_have_text("完整文本请求：0")

    page.get_by_test_id("add-local").click()
    expect(page.locator(".source-card")).to_have_count(2)
    expect(page.get_by_test_id("primary-state")).to_contain_text("请选择")
    page.locator(".source-card").filter(has_text="本地转录").get_by_text("查看").click()
    expect(page.get_by_test_id("primary-state")).to_contain_text("请选择")
    page.locator(".source-card").filter(has_text="本地转录").get_by_text("用于视频助手").click()
    expect(page.get_by_test_id("primary-state")).to_contain_text("本地转录正在用于视频助手")

    page.get_by_test_id("clear-current").click()
    expect(page.get_by_test_id("status")).to_contain_text("不会自动切换")
    expect(page.get_by_test_id("primary-state")).to_contain_text("暂无正文")
    expect(page.locator(".source-card")).to_have_count(1)
    expect(page.get_by_test_id("request-count")).to_have_text("完整文本请求：0")

    page.locator(".source-card").filter(has_text="B站字幕").get_by_text("用于视频助手").click()
    expect(page.get_by_test_id("primary-state")).to_contain_text("B站字幕正在用于视频助手")

    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            desktop, desktop_errors = new_checked_page(browser, viewport={"width": 1280, "height": 820})
            run_flow(desktop)
            assert not desktop_errors, "\n".join(desktop_errors)
            desktop.close()

            mobile, mobile_errors = new_checked_page(browser, viewport={"width": 390, "height": 760}, is_mobile=True)
            run_flow(mobile)
            assert not mobile_errors, "\n".join(mobile_errors)
            mobile.close()

            print("current-video primary-text mock QA passed: desktop/mobile states, no full-text auto request, no raw visible leak, no overflow, no console errors")
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
