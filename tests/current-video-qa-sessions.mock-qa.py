from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MOCK_HTML = ROOT / "tests" / "current-video-qa-sessions.mock.html"
FORBIDDEN_VISIBLE_TERMS = [
    "未消费",
    "猜你喜欢",
    "fallback",
    "transcript",
    "confidence",
    "sourceHash",
    "segmentId",
    "subtitle_url",
    "BVID",
    "CID",
    "document is not defined",
]


def assert_clean_visible_text(page):
    text = page.locator("body").inner_text()
    for term in FORBIDDEN_VISIBLE_TERMS:
        assert term not in text, f"visible raw term leaked: {term}"


def assert_no_horizontal_overflow(page):
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
    assert not overflow, "page has horizontal overflow"


def run_viewport(page, width, height):
    page.set_viewport_size({"width": width, "height": height})
    page.goto(MOCK_HTML.as_uri())
    expect(page.get_by_role("heading", name="问这个视频")).to_be_visible()
    expect(page.get_by_label("会话列表")).to_be_visible()
    expect(page.get_by_text("工具能力边界（2）")).to_be_visible()
    expect(page.get_by_text("本次参考：示例视频：工具能力边界")).to_be_visible()
    expect(page.get_by_text("回答：有证据")).to_be_visible()
    expect(page.get_by_text("来源：《工具能力边界》 · P1（主视频） · B站字幕")).to_be_visible()
    expect(page.get_by_role("button", name="打开来源视频")).to_be_visible()
    expect(page.get_by_role("button", name="预览跳转").first).to_be_visible()
    expect(page.get_by_role("button", name="确认跳转")).to_be_visible()
    expect(page.get_by_role("button", name="返回原位置")).to_be_visible()
    expect(page.get_by_text("请把要问的内容说完整")).to_be_visible()
    expect(page.get_by_text("基于此前视频文本")).to_be_visible()
    expect(page.get_by_role("button", name="在当前视频再问").first).to_be_visible()
    expect(page.get_by_label("本地数据与隐私管理")).to_be_visible()
    expect(page.get_by_text("当前视频问答会话")).to_be_visible()
    expect(page.get_by_role("button", name="清理问答会话")).to_be_visible()
    assert_clean_visible_text(page)
    assert_no_horizontal_overflow(page)


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()
            run_viewport(page, 1280, 900)
            run_viewport(page, 390, 820)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
