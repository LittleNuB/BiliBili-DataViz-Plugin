import os

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("BILI_BILL_QA_BASE_URL", "http://127.0.0.1:4173")
MOCK_URL = f"{BASE_URL}/tests/experiment-blind-boxes.mock.html"
BOX_IDS = ["random_explore", "cross_region", "hidden_favorite", "creator_archive"]
BOX_TITLES = ["随机探索", "跨区漫游", "冷门收藏", "UP 主考古"]
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


def assert_no_horizontal_overflow(page, label: str) -> None:
    dimensions = page.evaluate(
        """() => ({
            bodyClient: document.body.clientWidth,
            bodyScroll: document.body.scrollWidth,
            rootClient: document.documentElement.clientWidth,
            rootScroll: document.documentElement.scrollWidth,
        })"""
    )
    if dimensions["bodyScroll"] > dimensions["bodyClient"] + 1:
        raise AssertionError(f"{label}: body overflow {dimensions}")
    if dimensions["rootScroll"] > dimensions["rootClient"] + 1:
        raise AssertionError(f"{label}: root overflow {dimensions}")


def assert_clean_visible_copy(page) -> None:
    visible = page.locator("body").inner_text()
    for term in FORBIDDEN_VISIBLE_TERMS:
        if term.lower() in visible.lower():
            raise AssertionError(f"Visible blind-box copy leaked forbidden term: {term}")


def box(page, box_id: str):
    return page.locator(f'[data-box-id="{box_id}"]')


def assert_fixed_order(page) -> None:
    titles = page.locator("[data-box-id] > div:first-child > div:first-child > div:first-child").all_inner_texts()
    if titles != BOX_TITLES:
        raise AssertionError(f"Unexpected blind-box order: {titles}")


def run_ready_mode(page) -> None:
    page.set_viewport_size({"width": 1280, "height": 820})
    page.goto(f"{MOCK_URL}?mode=ready", wait_until="networkidle")
    expect(page.get_by_text("视频盲盒", exact=True)).to_be_visible()
    expect(page.locator("[data-box-id]")).to_have_count(4)
    assert_fixed_order(page)

    for box_id in BOX_IDS:
        card = box(page, box_id)
        expect(card.get_by_text("候选来源：", exact=False)).to_be_visible()
        expect(card.get_by_text("真实 B 站候选：", exact=False)).to_be_visible()
        card.locator('[data-action="reveal"]').click()

    expect(page.locator('[data-action="open-video"]')).to_have_count(4)
    for link in page.locator('[data-action="open-video"]').all():
        href = link.get_attribute("href") or ""
        if not href.startswith("https://www.bilibili.com/video/"):
            raise AssertionError(f"Unexpected blind-box video URL: {href}")

    expect(box(page, "random_explore")).to_contain_text("已使用真实 B 站候选")
    expect(box(page, "cross_region")).to_contain_text("已使用真实 B 站候选")
    expect(box(page, "creator_archive")).to_contain_text("已使用真实 B 站候选")
    expect(box(page, "hidden_favorite")).to_contain_text("本卡不使用；固定从本地收藏回访")
    expect(box(page, "hidden_favorite")).to_contain_text("它不是外部探索")
    assert_clean_visible_copy(page)
    assert_no_horizontal_overflow(page, "ready desktop")

    page.set_viewport_size({"width": 320, "height": 760})
    assert_no_horizontal_overflow(page, "ready mobile")


def run_failure_mode(page) -> None:
    page.set_viewport_size({"width": 1280, "height": 820})
    page.goto(f"{MOCK_URL}?mode=failure", wait_until="networkidle")
    expect(page.locator("[data-box-id]")).to_have_count(4)
    assert_fixed_order(page)

    for box_id in BOX_IDS:
        card = box(page, box_id)
        expect(card.get_by_text("候选来源：", exact=False)).to_be_visible()
        expect(card.get_by_text("真实 B 站候选：", exact=False)).to_be_visible()
        card.locator('[data-action="explain"]').click()

    expect(page.locator('[data-action="open-video"]')).to_have_count(0)
    expect(page.get_by_text("当前没有可用于探索的近期视频", exact=True)).to_be_visible()
    expect(page.get_by_text("这次没有取得真实分区候选", exact=True)).to_be_visible()
    expect(page.get_by_text("本地收藏暂时打不开", exact=True)).to_be_visible()
    expect(page.get_by_text("暂时无法取得 UP 公开投稿", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="重新生成这一页")).to_have_count(4)
    assert_clean_visible_copy(page)
    assert_no_horizontal_overflow(page, "failure desktop")

    page.set_viewport_size({"width": 320, "height": 760})
    assert_no_horizontal_overflow(page, "failure mobile")


def main() -> None:
    console_errors = []
    page_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        run_ready_mode(page)
        run_failure_mode(page)
        browser.close()

    if console_errors:
        raise AssertionError(f"Blind-box console errors: {console_errors}")
    if page_errors:
        raise AssertionError(f"Blind-box page errors: {page_errors}")
    print("PASS experiment-blind-boxes.mock-qa")


if __name__ == "__main__":
    main()
