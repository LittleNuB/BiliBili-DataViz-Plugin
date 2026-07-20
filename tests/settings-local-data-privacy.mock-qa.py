from pathlib import Path
import json
import re

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
MOCK_HTML = ROOT / "tests" / "settings-local-data-privacy.mock.html"

FORBIDDEN_VISIBLE_TERMS = [
    "未消费",
    "猜你喜欢",
    "fall" + "back",
    "trans" + "cript",
    "confidence",
    "source" + "Hash",
    "segment" + "Id",
    "subtitle" + "_url",
    "BV" + "ID",
    "C" + "ID",
    "raw provider",
    "runtime error",
]

FORBIDDEN_EXPORT_TERMS = [
    "Cookie",
    "Key",
    "fall" + "back",
    "trans" + "cript",
    "confidence",
    "source" + "Hash",
    "segment" + "Id",
    "subtitle" + "_url",
    "BV" + "ID",
    "C" + "ID",
    "exportedAt",
    "diagnosticSchema",
    "usageBytes",
    "bilibiliSubtitleSources",
    "syncStatus",
    "C:\\",
    "/Users/",
]


def assert_no_forbidden_text(text: str, terms: list[str], label: str):
    for term in terms:
        if term.lower() in text.lower():
            raise AssertionError(f"{label} exposed forbidden term: {term}")


def assert_no_horizontal_overflow(page, label: str):
    overflow = page.evaluate(
        """() => Math.ceil(document.documentElement.scrollWidth - window.innerWidth)"""
    )
    if overflow > 1:
        raise AssertionError(f"{label} has horizontal overflow: {overflow}px")


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 820})
        console_errors: list[str] = []
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )

        page.goto(MOCK_HTML.as_uri())
        assert_no_horizontal_overflow(page, "desktop settings mock")

        for title in [
            "观看历史",
            "收藏与智能索引",
            "B站字幕正文",
            "摘要与亮点",
            "问答会话",
            "动态账单",
            "盲盒抽取记录",
        ]:
            expect(page.get_by_text(title, exact=True).first).to_be_visible()

        body_text = page.locator("body").inner_text()
        assert_no_forbidden_text(body_text, FORBIDDEN_VISIBLE_TERMS, "settings mock")
        if "本地转写" in body_text or "转写模型" in body_text or "ASR" in body_text:
            raise AssertionError("settings mock exposed unavailable local transcription copy")

        blind_card = page.locator('[data-card="blind-box"]')
        expect(blind_card.get_by_text("2 条")).to_be_visible()
        expect(blind_card.get_by_text("不提供单独开关或单独清理入口")).to_be_visible()
        if blind_card.locator("input, button").count() != 0:
            raise AssertionError("blind-box card should be count-only")

        page.get_by_role("button", name="刷新状态").click()
        expect(page.get_by_text("本地数据状态已刷新。", exact=True)).to_be_visible()
        page.reload()
        expect(page.locator("#blind-count")).to_have_text("2 条")
        assert_no_forbidden_text(page.locator("body").inner_text(), FORBIDDEN_VISIBLE_TERMS, "reloaded settings mock")

        page.get_by_role("button", name="清理观看历史").click()
        expect(page.locator("#history-count")).to_have_text("0 条")
        expect(page.get_by_text("已清理观看历史")).to_be_visible()

        page.get_by_role("button", name="清理收藏与索引").click()
        expect(page.locator("#favorite-count")).to_have_text("0 条")
        expect(page.locator("#pending-index")).to_have_text("0")

        page.get_by_role("button", name="清理字幕缓存").click()
        expect(page.locator("#subtitle-count")).to_have_text("0 个来源")
        expect(page.get_by_text("已清理B站字幕正文")).to_be_visible()

        page.get_by_role("button", name="清理摘要亮点缓存").click()
        expect(page.locator("#summary-count")).to_have_text("0 个分P")

        page.get_by_role("button", name="清理问答会话").click()
        expect(page.locator("#qa-count")).to_have_text("0 个会话")

        page.get_by_role("button", name="清理动态账单").click()
        expect(page.locator("#dynamic-count")).to_have_text("0 项")

        first_pause = page.locator("[data-pause-item]").first
        expect(first_pause).to_be_visible()
        first_pause.get_by_role("button", name="恢复提醒").click()
        expect(first_pause).to_have_class(re.compile(r".*\bhidden\b.*"))
        expect(page.get_by_text("已恢复")).to_be_visible()

        page.get_by_role("button", name="模拟部分失败").click()
        expect(page.get_by_text("收藏与智能索引、问答会话")).to_be_visible()

        page.get_by_role("button", name="导出诊断摘要").click()
        diagnostic_dialog = page.get_by_role("dialog", name="确认导出诊断摘要")
        expect(diagnostic_dialog).to_be_visible()
        expect(diagnostic_dialog.get_by_text("诊断文件只会保存到本机，不会自动上传。", exact=True)).to_be_visible()
        expect(diagnostic_dialog.get_by_text("包含", exact=True)).to_be_visible()
        expect(diagnostic_dialog.get_by_text("不包含", exact=True)).to_be_visible()
        if page.evaluate("() => window.__lastDiagnosticExport ?? null") is not None:
            raise AssertionError("diagnostic export started before explicit confirmation")
        diagnostic_dialog.get_by_role("button", name="确认导出").click()
        diagnostic = page.evaluate("() => window.__lastDiagnosticExport")
        expected_top_level = {"导出时间", "应用", "隐私边界", "本地数据类别", "功能状态"}
        if set(diagnostic.keys()) != expected_top_level:
            raise AssertionError(f"diagnostic export schema mismatch: {set(diagnostic.keys())}")
        if set(diagnostic["隐私边界"].keys()) != {"包含", "不包含"}:
            raise AssertionError("diagnostic privacy boundary schema mismatch")
        if any(set(category.keys()) != {"类别", "数量", "占用字节"} for category in diagnostic["本地数据类别"]):
            raise AssertionError("diagnostic category schema mismatch")
        category_labels = [category["类别"] for category in diagnostic["本地数据类别"]]
        if len(category_labels) != 8 or "本地 AI 设置" not in category_labels:
            raise AssertionError(f"diagnostic category coverage mismatch: {category_labels}")
        exported = json.dumps(diagnostic, ensure_ascii=False)
        assert_no_forbidden_text(exported, FORBIDDEN_EXPORT_TERMS, "diagnostic export")
        if "完整记录正文" in exported or "原文片段" in exported:
            raise AssertionError("diagnostic export contains full-record wording")

        page.get_by_role("button", name="清理本地数据").click()
        expect(page.locator("#confirm-clear")).to_be_disabled()
        page.locator("#confirm-text").fill("删除")
        expect(page.locator("#confirm-clear")).to_be_disabled()
        page.locator("#confirm-text").fill("清理本地数据")
        expect(page.locator("#confirm-clear")).to_be_enabled()
        page.locator("#confirm-clear").click()
        expect(page.locator("#history-count")).to_have_text("0 条")
        expect(page.locator("#blind-count")).to_have_text("0 条")
        expect(page.get_by_text("本地 AI 设置和功能开关也已恢复为默认状态")).to_be_visible()

        page.set_viewport_size({"width": 360, "height": 780})
        assert_no_horizontal_overflow(page, "mobile settings mock")
        assert_no_forbidden_text(page.locator("body").inner_text(), FORBIDDEN_VISIBLE_TERMS, "mobile settings mock")

        page.goto(MOCK_HTML.as_uri() + "?pauses=empty")
        expect(page.get_by_text("当前没有暂停提醒的 UP。", exact=True)).to_be_visible()
        expect(page.locator("[data-pause-item]:visible")).to_have_count(0)
        assert_no_horizontal_overflow(page, "empty-pause settings mock")

        if console_errors:
            raise AssertionError("console errors: " + "\n".join(console_errors))
        browser.close()


if __name__ == "__main__":
    main()
