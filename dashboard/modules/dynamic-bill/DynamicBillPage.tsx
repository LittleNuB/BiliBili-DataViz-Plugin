import { useEffect, useMemo, useState } from "preact/hooks";
import type {
  DynamicBillColumn,
  DynamicBillExplanation,
  DynamicBillExplanationResult,
  DynamicBillFeedbackResult,
  DynamicBillFeedbackScope,
  DynamicBillFilterPreference,
  DynamicBillGenerateResult,
  DynamicBillEvidence,
  DynamicBillItem,
  DynamicBillOverview,
  DynamicBillStatus,
  DynamicBillStatusFilter,
  DynamicSyncResult,
  DynamicSyncStatus,
} from "../../../src/shared/types/dynamic-bill";
import type { UserConfig } from "../../../src/shared/types/config";
import { requestSW } from "../../utils/messaging";

const STATUS_FILTERS: Array<{
  key: DynamicBillStatusFilter;
  label: string;
  detail: string;
}> = [
  { key: "active", label: "待查看", detail: "优先展示未打开和已打开，不包含已消费或已处理" },
  { key: "unopened", label: "未打开", detail: "尚未从动态账单打开新投稿" },
  { key: "opened", label: "已打开", detail: "打开过，但尚未确认有效观看" },
  { key: "consumed", label: "已消费", detail: "由观看历史或播放器事件确认" },
  {
    key: "processed",
    label: "已处理",
    detail: "用户手动完成或忽略，不等同于消费",
  },
];

const BILL_COLUMNS = [
  {
    key: "afk_update",
    title: "久违更新",
    detail: "长期窗口有正反馈、近期冷却、最近 7 天有新投稿的已关注 UP。",
    accent: "pink",
    enabled: true,
  },
  {
    key: "variety",
    title: "换换口味",
    detail: "长期分区/标签强、近期明显下降，最近 7 天有已关注 UP 新投稿。",
    accent: "blue",
    enabled: true,
  },
  {
    key: "buried_follow",
    title: "被淹没的关注",
    detail: "有关注关系、近期观看缺席或近乎缺席，最近 7 天有新投稿的 UP。",
    accent: "mint",
    enabled: true,
  },
] as const;

type BillColumnKey = (typeof BILL_COLUMNS)[number]["key"];

interface CreatorReviewPrompt {
  creatorMid: number;
  creatorName: string;
  feedbackCount: number;
}

export function DynamicBillPage() {
  const [statusFilter, setStatusFilter] = useState<DynamicBillStatusFilter>("active");
  const [overview, setOverview] = useState<DynamicBillOverview | null>(null);
  const [items, setItems] = useState<DynamicBillItem[]>([]);
  const [userConfig, setUserConfig] = useState<UserConfig | null>(null);
  const [selectedBillKey, setSelectedBillKey] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [processingBillKey, setProcessingBillKey] = useState("");
  const [creatorReviewPrompt, setCreatorReviewPrompt] =
    useState<CreatorReviewPrompt | null>(null);
  const [notice, setNotice] = useState("");
  const activeStatus =
    STATUS_FILTERS.find((item) => item.key === statusFilter) ?? STATUS_FILTERS[0];
  const syncState = overview?.syncState;
  const isSyncing = syncing || syncState?.status === "syncing";
  const isAiEnabled = userConfig?.dynamicBill.aiExplanationsEnabled === true;
  const isAiConfigured = Boolean(userConfig?.ai.apiKey.trim());
  const aiAvailability = {
    enabled: isAiEnabled,
    configured: isAiConfigured,
    model: userConfig?.ai.chatModel ?? "",
  };
  const overviewNotice = overview
    ? describeOverview(overview)
    : "正在读取动态账单同步状态。";
  const afkItems = useMemo(
    () => items.filter((item) => item.column === "afk_update"),
    [items],
  );
  const varietyItems = useMemo(
    () => items.filter((item) => item.column === "variety"),
    [items],
  );
  const buriedFollowItems = useMemo(
    () => items.filter((item) => item.column === "buried_follow"),
    [items],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => matchesStatusFilter(item, statusFilter)),
    [items, statusFilter],
  );
  const selectedItem =
    visibleItems.find((item) => item.billKey === selectedBillKey) ??
    visibleItems[0] ??
    null;
  const statusCounts = useMemo(() => countByStatus(items), [items]);

  useEffect(() => {
    refreshConfig().catch((error) => {
      setNotice(`读取 AI 配置失败：${describeError(error)}`);
    });
    refreshFilterPreference().catch((error) => {
      setNotice(`读取筛选偏好失败：${describeError(error)}`);
    });
    refreshOverview().catch((error) => {
      setNotice(`读取动态账单状态失败：${describeError(error)}`);
    });
    refreshBillItems().catch((error) => {
      setNotice(`读取动态账单失败：${describeError(error)}`);
    });
  }, []);

  useEffect(() => {
    setSelectedBillKey((current) =>
      chooseSelectedBillKey(current, items, statusFilter),
    );
  }, [items, statusFilter]);

  async function refreshOverview() {
    const next = await requestSW<DynamicBillOverview>(
      "GET_DYNAMIC_BILL_OVERVIEW",
    );
    setOverview(next);
  }

  async function refreshConfig() {
    setUserConfig(await requestSW<UserConfig>("GET_CONFIG"));
  }

  async function refreshFilterPreference() {
    const preference = await requestSW<DynamicBillFilterPreference>(
      "GET_DYNAMIC_BILL_FILTER",
    );
    setStatusFilter(preference.status);
  }

  async function refreshBillItems() {
    const next = await requestSW<DynamicBillItem[]>("GET_DYNAMIC_BILL_ITEMS");
    setItems(next);
    setSelectedBillKey((current) =>
      chooseSelectedBillKey(current, next, statusFilter),
    );
  }

  async function generateLocalBill(): Promise<DynamicBillGenerateResult> {
    const result = await requestSW<DynamicBillGenerateResult>(
      "GENERATE_DYNAMIC_BILL",
    );
    setOverview(result.overview);
    setItems(result.items);
    setSelectedBillKey((current) =>
      chooseSelectedBillKey(current, result.items, statusFilter),
    );
    return result;
  }

  async function handleStatusFilterChange(nextStatus: DynamicBillStatusFilter) {
    setStatusFilter(nextStatus);
    setSelectedBillKey((current) =>
      chooseSelectedBillKey(current, items, nextStatus),
    );
    try {
      await requestSW<DynamicBillFilterPreference>("UPDATE_DYNAMIC_BILL_FILTER", {
        status: nextStatus,
      });
    } catch (error) {
      setNotice(`保存筛选偏好失败：${describeError(error)}`);
    }
  }

  async function handleOpenVideo(item: DynamicBillItem) {
    setProcessingBillKey(item.billKey);
    setNotice("");
    try {
      await requestSW<DynamicBillItem>("OPEN_DYNAMIC_BILL_VIDEO", {
        billKey: item.billKey,
      });
      await refreshBillItems();
      setNotice(`已打开《${item.evidence.newVideo.title || item.evidence.newVideo.bvid}》，账单状态推进为已打开。`);
    } catch (error) {
      setNotice(`打开新视频失败：${describeError(error)}`);
    } finally {
      setProcessingBillKey("");
    }
  }

  async function handleMarkProcessed(item: DynamicBillItem) {
    setProcessingBillKey(item.billKey);
    setNotice("");
    try {
      await requestSW<DynamicBillItem>("MARK_DYNAMIC_BILL_ITEM_PROCESSED", {
        billKey: item.billKey,
      });
      await refreshBillItems();
      setNotice(`已将「${item.creatorName}」标记为已处理；该动作不等同于已消费。`);
    } catch (error) {
      setNotice(`标记已处理失败：${describeError(error)}`);
    } finally {
      setProcessingBillKey("");
    }
  }

  async function handleAddFeedback(
    item: DynamicBillItem,
    scope: DynamicBillFeedbackScope,
  ) {
    setProcessingBillKey(item.billKey);
    setNotice("");
    try {
      const result = await requestSW<DynamicBillFeedbackResult>(
        "ADD_DYNAMIC_BILL_FEEDBACK",
        {
          billKey: item.billKey,
          scope,
        },
      );
      await refreshBillItems();
      setNotice(describeFeedbackResult(result));
      if (result.summary.shouldShowCreatorReviewPrompt) {
        setCreatorReviewPrompt({
          creatorMid: result.item.creatorMid,
          creatorName: result.item.creatorName,
          feedbackCount: result.summary.count,
        });
      }
    } catch (error) {
      setNotice(`保存少提醒反馈失败：${describeError(error)}`);
    } finally {
      setProcessingBillKey("");
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setNotice("");
    try {
      const result = await generateLocalBill();
      setNotice(describeGenerateResult(result));
    } catch (error) {
      setNotice(`生成本地账单失败：${describeError(error)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggleAiExplanations() {
    const current = userConfig ?? await requestSW<UserConfig>("GET_CONFIG");
    const nextEnabled = !current.dynamicBill.aiExplanationsEnabled;
    setNotice("");
    try {
      await requestSW("UPDATE_CONFIG", {
        dynamicBill: {
          aiExplanationsEnabled: nextEnabled,
        },
      });
      await refreshConfig();
      setNotice(nextEnabled
        ? "已启用动态账单 AI 解释；生成时只会发送已入选账单项的必要视频元数据和紧凑证据事实。"
        : "已关闭动态账单 AI 解释；页面继续显示本地证据结果。");
    } catch (error) {
      setNotice(`更新 AI 解释开关失败：${describeError(error)}`);
    }
  }

  async function handleBuildExplanations() {
    setExplaining(true);
    setNotice("");
    try {
      const total: DynamicBillExplanationResult = {
        status: "idle",
        processed: 0,
        generated: 0,
        failed: 0,
        skipped: 0,
        fallback: 0,
        pending: 0,
        items,
      };
      let guard = Math.ceil(Math.max(items.length, 1) / 6) + 2;
      let includeFailedInNextBatch = true;
      do {
        const batch = await requestSW<DynamicBillExplanationResult>(
          "BUILD_DYNAMIC_BILL_EXPLANATIONS",
          {
            maxItems: 6,
            includeFailed: includeFailedInNextBatch,
          },
        );
        includeFailedInNextBatch = false;
        total.status = batch.status;
        total.processed += batch.processed;
        total.generated += batch.generated;
        total.failed += batch.failed;
        total.skipped += batch.skipped;
        total.fallback += batch.fallback;
        total.pending = batch.pending;
        total.items = batch.items;
        setItems(batch.items);
        setNotice(describeExplanationResult(total));
        if (
          batch.status === "disabled"
          || batch.status === "not_configured"
          || batch.processed === 0
        ) {
          break;
        }
      } while (total.pending > 0 && guard-- > 0);
      await refreshBillItems();
    } catch (error) {
      setNotice(`生成 AI 解释失败：${describeError(error)}。页面仍展示本地证据结果。`);
      await refreshBillItems().catch(() => {});
    } finally {
      setExplaining(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setNotice("");
    try {
      const result = await requestSW<DynamicSyncResult>("SYNC_DYNAMIC_UPDATES");
      setOverview(result.overview);
      let nextNotice = describeSyncResult(result);
      if (result.status === "success") {
        try {
          setGenerating(true);
          const generated = await generateLocalBill();
          nextNotice = `${nextNotice} ${describeGenerateResult(generated)}`;
        } catch (generateError) {
          await refreshBillItems().catch(() => {});
          nextNotice = `${nextNotice} 但生成本地账单失败：${describeError(generateError)}`;
        }
      } else {
        await refreshBillItems().catch(() => {});
      }
      setNotice(nextNotice);
    } catch (error) {
      setNotice(`动态同步请求失败：${describeError(error)}`);
      await refreshOverview().catch(() => {});
      await refreshBillItems().catch(() => {});
    } finally {
      setGenerating(false);
      setSyncing(false);
    }
  }

  return (
    <div className="dynamic-bill-page">
      <header className="dynamic-bill-hero">
        <div>
          <span className="dynamic-bill-kicker">消费前 / 已关注视频投稿</span>
          <h2>动态账单</h2>
          <p>
            面向兴趣再平衡，久违更新、换换口味和被淹没的关注由本地规则入选和排序；AI 只生成解释展示，未启用、未配置或失败时继续显示本地证据结果。
          </p>
        </div>
        <div className="dynamic-bill-scope">
          <strong>解释数据范围</strong>
          <span>
            AI 只接收已入选账单项的新视频标题/简介、UP 名、分区/标签、发布时间、时长和紧凑证据事实；不发送完整历史、完整关注列表、Cookie、用户 mid、个人资料或反馈记录。
          </span>
          <div className="dynamic-bill-scope-actions">
            <button
              type="button"
              className="dynamic-bill-sync-button"
              disabled={isSyncing || generating || explaining}
              onClick={handleSync}
            >
              {isSyncing ? "同步中..." : "同步并刷新"}
            </button>
            <button
              type="button"
              className="dynamic-bill-sync-button is-secondary"
              disabled={isSyncing || generating || explaining}
              onClick={handleGenerate}
            >
              {generating ? "生成中..." : "生成本地账单"}
            </button>
            <button
              type="button"
              className="dynamic-bill-sync-button is-secondary"
              disabled={isSyncing || generating || explaining || items.length === 0}
              onClick={handleBuildExplanations}
            >
              {explaining ? "解释生成中..." : "生成 AI 解释"}
            </button>
            <button
              type="button"
              className="dynamic-bill-sync-button is-ghost"
              disabled={isSyncing || generating || explaining}
              onClick={handleToggleAiExplanations}
            >
              {isAiEnabled ? "关闭 AI 解释" : "启用 AI 解释"}
            </button>
          </div>
        </div>
      </header>

      <section
        className="dynamic-bill-status-grid"
        aria-label="动态账单数据状态"
      >
        <StatusMetric
          label="动态同步"
          value={syncStatusLabel(syncState?.status ?? "idle")}
          detail={lastSyncDetail(overview)}
        />
        <StatusMetric
          label="已关注 UP"
          value={String(overview?.activeFollowedCreatorCount ?? 0)}
          detail={`关注时间已知 ${overview?.followAgeKnownCount ?? 0} / 未知 ${overview?.followAgeUnknownCount ?? 0}`}
        />
        <StatusMetric
          label="最近投稿"
          value={String(overview?.recentVideoUpdateCount ?? 0)}
          detail={`最近 ${overview?.updateWindowDays ?? 7} 天视频投稿池`}
        />
        <StatusMetric
          label="本地账单"
          value={String(items.length)}
          detail={`久违更新 ${afkItems.length} / 换换口味 ${varietyItems.length} / 被淹没的关注 ${buriedFollowItems.length}`}
        />
      </section>

      <section
        className="dynamic-bill-status-copy"
        aria-label="动态账单同步说明"
      >
        <strong>{notice || overviewNotice}</strong>
        <span>
          本切片启用三类本地证据栏目；状态只会从未打开向已打开、已消费、已处理推进。AI 置信度仅展示，不参与入选、排序、状态推进或少提醒规则。
        </span>
      </section>

      <section className="dynamic-bill-filters" aria-label="账单状态筛选">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={statusFilter === item.key ? "is-selected" : ""}
            aria-pressed={statusFilter === item.key}
            data-testid={`dynamic-bill-filter-${item.key}`}
            onClick={() => handleStatusFilterChange(item.key)}
          >
            <span>{item.label}</span>
            <strong>{statusCounts[item.key] ?? 0}</strong>
          </button>
        ))}
      </section>

      <section className="dynamic-bill-layout">
        <div className="dynamic-bill-board" aria-label="动态账单栏目">
          {BILL_COLUMNS.map((column) => {
            const columnItems = isDynamicBillColumn(column.key)
              ? visibleItems.filter((item) => item.column === column.key)
              : [];
            const columnCount = isDynamicBillColumn(column.key)
              ? items.filter((item) => item.column === column.key).length
              : 0;
            const emptyCopy = getColumnEmptyCopy(
              column,
              overview,
              activeStatus.label,
              columnCount,
            );

            return (
              <article
                className={`dynamic-bill-column tone-${column.accent}`}
                key={column.key}
              >
                <div className="dynamic-bill-column-head">
                  <div>
                    <h3>{column.title}</h3>
                    <p>{column.detail}</p>
                  </div>
                  <span
                    title={`${activeStatus.label} ${columnItems.length} / 全部 ${columnCount}`}
                    data-testid={`dynamic-bill-column-count-${column.key}`}
                  >
                    {columnItems.length}/{columnCount}
                  </span>
                </div>
                {columnItems.length > 0 ? (
                  <div className="dynamic-bill-item-list">
                    {columnItems.map((item) => (
                      <button
                        type="button"
                        className={`dynamic-bill-item-card ${
                          selectedItem?.billKey === item.billKey
                            ? "is-selected"
                            : ""
                        }`}
                        key={item.billKey}
                        data-testid="dynamic-bill-item-card"
                        onClick={() => setSelectedBillKey(item.billKey)}
                      >
                        <span className="dynamic-bill-card-meta">
                          #{item.localRank} · {statusLabel(item.status)}
                        </span>
                        <strong>{item.creatorName}</strong>
                        <span className="dynamic-bill-card-title">
                          {item.evidence.newVideo.title || item.evidence.newVideo.bvid}
                        </span>
                        <span className="dynamic-bill-card-fact">
                          {cardFact(item)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="dynamic-bill-empty">
                    <strong>{emptyCopy.title}</strong>
                    <p>{emptyCopy.detail}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <aside className="dynamic-bill-detail" aria-label="账单项详情">
          {selectedItem ? (
            <BillItemDetail
              item={selectedItem}
              busy={processingBillKey === selectedItem.billKey}
              creatorReviewPrompt={
                creatorReviewPrompt?.creatorMid === selectedItem.creatorMid
                  ? creatorReviewPrompt
                  : null
              }
              onAddFeedback={handleAddFeedback}
              onDismissCreatorReviewPrompt={() => setCreatorReviewPrompt(null)}
              onMarkProcessed={handleMarkProcessed}
              onOpenVideo={handleOpenVideo}
              aiAvailability={aiAvailability}
            />
          ) : (
            <EmptyDetail status={activeStatus} />
          )}
        </aside>
      </section>
    </div>
  );
}

function BillItemDetail({
  aiAvailability,
  busy,
  creatorReviewPrompt,
  item,
  onAddFeedback,
  onDismissCreatorReviewPrompt,
  onMarkProcessed,
  onOpenVideo,
}: {
  aiAvailability: {
    enabled: boolean;
    configured: boolean;
    model: string;
  };
  busy: boolean;
  creatorReviewPrompt: CreatorReviewPrompt | null;
  item: DynamicBillItem;
  onAddFeedback: (item: DynamicBillItem, scope: DynamicBillFeedbackScope) => void;
  onDismissCreatorReviewPrompt: () => void;
  onMarkProcessed: (item: DynamicBillItem) => void;
  onOpenVideo: (item: DynamicBillItem) => void;
}) {
  const evidence = item.evidence;
  const isBuriedFollow = evidence.kind === "buried_follow";
  const isProcessed = item.status === "processed";
  return (
    <>
      <span className="dynamic-bill-kicker">
        {columnTitle(item.column)} / {statusLabel(item.status)}
      </span>
      <h3>{item.creatorName}</h3>
      <p>
        新投稿：{evidence.newVideo.title || evidence.newVideo.bvid}
      </p>
      <ExplanationPanel item={item} aiAvailability={aiAvailability} />
      <div className="dynamic-bill-status-copy">
        <strong>处理状态</strong>
        <span>{statusFlowCopy(item)}</span>
      </div>
      <div className="dynamic-bill-status-copy">
        <strong>关注关系证据</strong>
        <span>{followEvidenceCopy(evidence)}</span>
      </div>
      <div className="dynamic-bill-status-copy">
        <strong>新投稿证据</strong>
        <span>
          最近 {evidence.thresholds.updateWindowDays} 天投稿《{evidence.newVideo.title || evidence.newVideo.bvid}》，
          bvid {evidence.newVideo.bvid}；同一新视频排除窗口为 {evidence.thresholds.recentSameVideoWindowDays} 天。
        </span>
      </div>
      {evidence.interest ? (
        <div className="dynamic-bill-status-copy">
          <strong>
            {interestKindLabel(evidence.interest.kind)}：{evidence.interest.label}
          </strong>
          <span>
            长期正反馈占比 {formatPercent(evidence.interest.longPositiveShare)}；
            近期正反馈占比 {formatPercent(evidence.interest.recentPositiveShare)}；
            下降 {formatPercent(evidence.interest.positiveDropRatio)}。
          </span>
        </div>
      ) : null}
      <div className="dynamic-bill-evidence-grid">
        <EvidenceStat
          label={`${longWindowLabel(evidence)} ${evidence.longWindow.windowDays} 天`}
          value={isBuriedFollow
            ? `${evidence.longWindow.watchedCount} 次本地观看`
            : `${evidence.longWindow.positiveWatchCount} 次正反馈`}
          detail={isBuriedFollow
            ? `${evidence.longWindow.positiveWatchCount} 次正反馈 · 平均完成度 ${formatPercent(evidence.longWindow.avgCompletion)}`
            : `${evidence.longWindow.watchedCount} 次观看 · 平均完成度 ${formatPercent(evidence.longWindow.avgCompletion)}`}
        />
        <EvidenceStat
          label={`${recentWindowLabel(evidence)} ${evidence.recentWindow.windowDays} 天`}
          value={isBuriedFollow
            ? `${evidence.recentWindow.watchedCount} 次观看`
            : `${evidence.recentWindow.positiveWatchCount} 次正反馈`}
          detail={isBuriedFollow
            ? `${evidence.recentWindow.positiveWatchCount} 次正反馈 · 缺席或近乎缺席`
            : `${evidence.recentWindow.watchedCount} 次观看 · 冷却比 ${formatPercent(evidence.cooldownRatio)}`}
        />
      </div>
      <div className="dynamic-bill-status-copy">
        <strong>规则阈值</strong>
        <span>{thresholdCopy(evidence)}</span>
      </div>
      <ul className="dynamic-bill-fact-list">
        {evidence.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <div className="dynamic-bill-status-copy">
        <strong>{evidence.interest ? "本地兴趣代表视频" : "本地历史代表视频"}</strong>
        <span>
          {item.historyBvids.length > 0
            ? item.historyBvids.join("、")
            : "长期窗口中没有可展示的近期以前代表 bvid。"}
        </span>
      </div>
      {creatorReviewPrompt ? (
        <div
          className="dynamic-bill-creator-review"
          data-testid="dynamic-bill-creator-review-prompt"
        >
          <strong>是否考虑取关这个 UP？</strong>
          <span>
            你已经 {creatorReviewPrompt.feedbackCount} 次选择少提醒「{creatorReviewPrompt.creatorName}」。
            可以打开 UP 主页自行检查；Bili-Bill 不会修改你的关注关系，也不会提供插件内取关。
          </span>
          <div className="dynamic-bill-feedback-actions">
            <a
              href={spaceUrl(creatorReviewPrompt.creatorMid)}
              target="_blank"
              rel="noreferrer"
              data-testid="dynamic-bill-review-open-creator"
            >
              打开 UP 主页
            </a>
            <button
              type="button"
              data-testid="dynamic-bill-review-dismiss"
              onClick={onDismissCreatorReviewPrompt}
            >
              暂不处理
            </button>
          </div>
        </div>
      ) : null}
      <div className="dynamic-bill-action-grid">
        <button
          type="button"
          className="is-primary"
          disabled={busy}
          data-testid="dynamic-bill-open-video"
          onClick={() => onOpenVideo(item)}
        >
          打开新视频
        </button>
        <button
          type="button"
          disabled={busy || isProcessed}
          data-testid="dynamic-bill-mark-processed"
          onClick={() => onMarkProcessed(item)}
        >
          {isProcessed ? "已处理" : "标记已处理"}
        </button>
        <button
          type="button"
          disabled={busy}
          data-testid="dynamic-bill-less-creator"
          onClick={() => onAddFeedback(item, "creator")}
        >
          少提醒这个 UP
        </button>
        {evidence.interest ? (
          <button
            type="button"
            disabled={busy}
            data-testid="dynamic-bill-less-topic"
            onClick={() => onAddFeedback(item, "topic")}
          >
            少提醒这个主题
          </button>
        ) : null}
        <a href={spaceUrl(item.creatorMid)} target="_blank" rel="noreferrer">
          打开 UP 主页
        </a>
      </div>
    </>
  );
}

function ExplanationPanel({
  aiAvailability,
  item,
}: {
  aiAvailability: {
    enabled: boolean;
    configured: boolean;
    model: string;
  };
  item: DynamicBillItem;
}) {
  const explanation = item.explanation;
  const hasAiExplanation = explanation?.status === "generated";
  const summary = hasAiExplanation
    ? explanation.summary
    : localFallbackSummary(item);
  const reason = hasAiExplanation
    ? explanation.reason
    : localFallbackReason(item);
  const viewingAngle = hasAiExplanation
    ? explanation.viewingAngle
    : localFallbackViewingAngle(item);
  const keywords = hasAiExplanation
    ? explanation.keywords
    : localFallbackKeywords(item);

  return (
    <div
      className={`dynamic-bill-ai-panel ${hasAiExplanation ? "is-ai" : "is-fallback"}`}
      data-testid={`dynamic-bill-explanation-${hasAiExplanation ? "ai" : "fallback"}`}
    >
      <div className="dynamic-bill-ai-head">
        <div>
          <strong>{hasAiExplanation ? "AI 解释" : "本地证据说明"}</strong>
          <span>{explanationStateCopy(explanation, aiAvailability)}</span>
        </div>
        {hasAiExplanation ? (
          <em title="置信度只展示，不参与入选、排序或后续规则">
            置信度 {Math.round(explanation.confidence * 100)}%
          </em>
        ) : null}
      </div>
      <div className="dynamic-bill-ai-grid">
        <section>
          <span>摘要</span>
          <p>{summary}</p>
        </section>
        <section>
          <span>为什么出现</span>
          <p>{reason}</p>
        </section>
        <section>
          <span>观看角度</span>
          <p>{viewingAngle}</p>
        </section>
      </div>
      {keywords.length > 0 ? (
        <div className="dynamic-bill-keywords" aria-label="解释关键词">
          {keywords.map((keyword) => (
            <span key={keyword}>{keyword}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyDetail({
  status,
}: {
  status: { key: DynamicBillStatusFilter; label: string; detail: string };
}) {
  return (
    <>
      <span className="dynamic-bill-kicker">选中账单项</span>
      <h3>暂无{status.label}项</h3>
      <p>
        生成本地账单后，选择卡片即可查看长期窗口、近期窗口、新投稿和排除同视频观看的证据事实。
      </p>
      <div className="dynamic-bill-status-copy">
        <strong>当前筛选：{status.label}</strong>
        <span>{status.detail}</span>
      </div>
    </>
  );
}

function syncStatusLabel(status: DynamicSyncStatus) {
  switch (status) {
    case "syncing":
      return "同步中";
    case "success":
      return "已同步";
    case "not_logged_in":
      return "未登录";
    case "failed":
      return "同步失败";
    default:
      return "待同步";
  }
}

function lastSyncDetail(overview: DynamicBillOverview | null): string {
  const state = overview?.syncState;
  if (!state) return "正在读取状态";
  if (state.status === "syncing") return `阶段：${stageLabel(state.stage)}`;
  if (state.lastSuccessAt > 0)
    return `最后成功：${formatTime(state.lastSuccessAt)}`;
  if (state.lastFinishedAt > 0)
    return `最后尝试：${formatTime(state.lastFinishedAt)}`;
  return "尚未完成同步";
}

function describeOverview(overview: DynamicBillOverview): string {
  const state = overview.syncState;
  if (state.status === "not_logged_in") {
    return "需要先登录 B 站账号，Bili-Bill 才能同步你的关注关系和关注动态；已存在的本地证据仍可读取。";
  }
  if (state.status === "failed") {
    return `动态同步失败：${state.lastError ?? "未知错误"}。已保留本地已有动态数据和账单项。`;
  }
  if (state.status === "success") {
    return `已同步 ${overview.activeFollowedCreatorCount} 个关注 UP，最近 ${overview.updateWindowDays} 天视频投稿 ${overview.recentVideoUpdateCount} 条。`;
  }
  if (state.status === "syncing") {
    return `正在同步动态账单数据，当前阶段：${stageLabel(state.stage)}。`;
  }
  return "尚未同步动态账单数据；可以手动同步关注关系和最近视频投稿。";
}

function describeSyncResult(result: DynamicSyncResult): string {
  if (result.status === "not_logged_in") {
    return "同步未完成：当前没有可用的 B 站登录态。";
  }
  if (result.status === "failed") {
    return `同步失败：${result.error ?? "未知错误"}。已保留本地已有动态数据。`;
  }
  return `同步完成：关注 UP ${result.followedCreatorsStored} 个，最近视频投稿 ${result.videoUpdatesStored} 条，过滤非视频动态 ${result.filteredNonVideoCount} 条。`;
}

function describeGenerateResult(result: DynamicBillGenerateResult): string {
  return `本地账单生成 ${result.itemCount} 项：久违更新 ${result.columnItemCounts.afk_update} 项，换换口味 ${result.columnItemCounts.variety} 项，被淹没的关注 ${result.columnItemCounts.buried_follow} 项；扫描最近投稿 ${result.candidatesScanned} 条，排除近期已看同视频 ${result.excludedRecentSameVideoCount} 条，长期/关注记忆证据不足 ${result.excludedNoLongSignalCount} 个，近期仍活跃 ${result.excludedRecentActiveCount} 个，本地少提醒阈值排除 ${result.excludedByFeedbackCount} 个。`;
}

function describeExplanationResult(result: DynamicBillExplanationResult): string {
  if (result.status === "disabled") {
    return `AI 解释未启用，已为 ${result.fallback} 个账单项展示本地证据结果。`;
  }
  if (result.status === "not_configured") {
    return `AI 未配置 API Key，已为 ${result.fallback} 个账单项展示本地证据结果。`;
  }
  const pending = result.pending > 0 ? `，剩余 ${result.pending} 个待处理` : "";
  return `AI 解释处理 ${result.processed} 项：成功 ${result.generated} 项，失败 ${result.failed} 项，跳过 ${result.skipped} 项${pending}；失败项仍展示本地证据结果。`;
}

function describeFeedbackResult(result: DynamicBillFeedbackResult): string {
  const target = result.summary.scope === "creator" ? "UP" : "主题";
  const threshold = result.summary.scope === "creator"
    ? result.summary.thresholds.creatorBlockCount
    : result.summary.thresholds.topicBlockCount;
  const nextRule = result.summary.isBlocked
    ? `已达到 ${threshold} 次阈值，下次生成不会再写入这个${target}的相关候选`
    : `下次生成会降低这个${target}的排序权重；累计 ${threshold} 次后不再写入候选`;
  const reviewCopy = result.summary.shouldShowCreatorReviewPrompt
    ? "；已展示取关思考提示，但不会修改 B 站关注关系"
    : "";

  return `已在本地记录「${result.summary.label}」少提醒 ${result.summary.count} 次，${nextRule}。这不会把当前账单项标记为已处理${reviewCopy}。`;
}

function getColumnEmptyCopy(
  column: {
    key: BillColumnKey;
    title: string;
    enabled: boolean;
  },
  overview: DynamicBillOverview | null,
  statusLabel: string,
  columnItemCount: number,
): { title: string; detail: string } {
  if (!column.enabled) {
    return {
      title: "后续切片未启用",
      detail: "本 PR 不生成该栏目账单项，避免偷跑后续 issue 范围。",
    };
  }
  if (!overview) {
    return {
      title: "正在读取账单数据",
      detail: "同步状态加载后会显示关注快照、最近视频投稿池和本地账单项数量。",
    };
  }
  if (overview.syncState.status === "not_logged_in" && columnItemCount === 0) {
    return {
      title: "需要登录 B 站后同步",
      detail: "未登录时不会生成虚假账单；若本地已有证据，仍可直接展示。",
    };
  }
  if (overview.activeFollowedCreatorCount === 0) {
    return {
      title: "还没有关注快照",
      detail: "完成同步后，会从已关注 UP 的视频投稿池中寻找本地账单候选。",
    };
  }
  if (overview.recentVideoUpdateCount === 0) {
    return {
      title: "最近 7 天暂无已关注视频投稿",
      detail: "非视频动态已被过滤，不会进入动态账单候选池。",
    };
  }
  if (column.key === "variety") {
    return {
      title: `暂无${statusLabel}换换口味`,
      detail: "可能是长期分区/标签强度不足、近期没有明显下降，或最近新投稿没有命中下降兴趣。",
    };
  }
  if (column.key === "buried_follow") {
    return {
      title: `暂无${statusLabel}被淹没的关注`,
      detail: "可能是缺少长期关注、特别关注或近期窗口以前弱观看等关注记忆信号，或该 UP 最近 30 天仍在观看。",
    };
  }
  return {
    title: `暂无${statusLabel}久违更新`,
    detail: "可能是长期正反馈不足、近期仍在观看，或同一新视频已在近期观看历史中出现。",
  };
}

function isDynamicBillColumn(key: BillColumnKey): key is DynamicBillColumn {
  return key === "afk_update" || key === "variety" || key === "buried_follow";
}

function columnTitle(column: DynamicBillColumn): string {
  return BILL_COLUMNS.find((item) => item.key === column)?.title ?? column;
}

function cardFact(item: DynamicBillItem): string {
  if (item.column === "buried_follow") {
    return `${followShortCopy(item.evidence)} · 近期观看 ${item.evidence.recentWindow.watchedCount} 次`;
  }
  const interest = item.evidence.interest;
  if (interest) {
    return `${interestKindLabel(interest.kind)}「${interest.label}」 · 长期占比 ${formatPercent(interest.longPositiveShare)} · 下降 ${formatPercent(interest.positiveDropRatio)}`;
  }
  return `长期正反馈 ${item.evidence.longWindow.positiveWatchCount} 次 · 近期正反馈 ${item.evidence.recentWindow.positiveWatchCount} 次`;
}

function explanationStateCopy(
  explanation: DynamicBillExplanation | undefined,
  aiAvailability: {
    enabled: boolean;
    configured: boolean;
    model: string;
  },
): string {
  if (explanation?.status === "generated") {
    return `由 ${explanation.model || aiAvailability.model || "AI"} 生成；只用于展示解释，不参与入选、排序或后续规则。`;
  }
  if (explanation?.status === "failed") {
    return `AI 生成失败：${explanation.error ?? "未知错误"}；以下使用本地规则事实解释。`;
  }
  if (explanation?.status === "not_configured" || (aiAvailability.enabled && !aiAvailability.configured)) {
    return "AI 未配置 API Key；以下使用本地规则事实解释。";
  }
  if (explanation?.status === "disabled" || !aiAvailability.enabled) {
    return "AI 解释未启用；以下使用本地规则事实解释。";
  }
  return "尚未生成 AI 解释；以下使用本地规则事实解释。";
}

function localFallbackSummary(item: DynamicBillItem): string {
  return `来自已关注 UP「${item.creatorName}」的新投稿《${item.evidence.newVideo.title || item.evidence.newVideo.bvid}》。`;
}

function localFallbackReason(item: DynamicBillItem): string {
  const facts = localExplanationFacts(item).slice(0, 2).join(" ");
  return `这个视频出现是因为它已由「${columnTitle(item.column)}」本地规则入选：${facts || localColumnReason(item)}。`;
}

function localFallbackViewingAngle(item: DynamicBillItem): string {
  if (item.column === "variety" && item.evidence.interest) {
    return `把它当作回到「${item.evidence.interest.label}」这个长期兴趣的一次口味切换。`;
  }
  if (item.column === "buried_follow") {
    return "把它当作一次低压力回访，判断这个长期关注是否仍值得保留注意力。";
  }
  return "先看它是否能补回一条近期冷却的历史兴趣线。";
}

function localFallbackKeywords(item: DynamicBillItem): string[] {
  return Array.from(new Set([
    columnTitle(item.column),
    item.evidence.newVideo.tagName,
    ...(item.evidence.interest ? [item.evidence.interest.label] : []),
    ...item.evidence.newVideo.tags,
  ].map((keyword) => keyword.trim()).filter(Boolean))).slice(0, 8);
}

function localExplanationFacts(item: DynamicBillItem): string[] {
  return item.evidence.facts
    .filter((fact) => !fact.includes("少提醒") && !fact.includes("反馈"))
    .slice(0, 3);
}

function localColumnReason(item: DynamicBillItem): string {
  if (item.column === "variety" && item.evidence.interest) {
    return `长期兴趣「${item.evidence.interest.label}」近期下降，但最近有已关注 UP 新投稿命中。`;
  }
  if (item.column === "buried_follow") {
    return "关注关系仍在，本地近期观看缺席或近乎缺席，且最近有新投稿。";
  }
  return "长期窗口有正反馈、近期冷却，且最近有新投稿。";
}

function thresholdCopy(evidence: DynamicBillEvidence): string {
  const positiveRule = `正反馈为完成度 ≥ ${formatPercent(evidence.thresholds.positiveCompletionRate)}、观看 ≥ ${formatDuration(evidence.thresholds.minPositiveWatchSeconds)} 或已收藏`;
  const sameVideoRule = `近期同一新视频排除窗口为 ${evidence.thresholds.recentSameVideoWindowDays} 天`;
  const feedbackRule = `本地少提醒第 ${evidence.thresholds.feedbackDampenCount} 次开始降权，UP 累计 ${evidence.thresholds.feedbackCreatorBlockCount} 次或主题累计 ${evidence.thresholds.feedbackTopicBlockCount} 次后不再写入候选`;

  if (evidence.kind === "variety") {
    return `长期兴趣正反馈不少于 ${evidence.thresholds.minInterestPositiveViews} 次，长期正反馈占比 ≥ ${formatPercent(evidence.thresholds.minInterestLongPositiveShare)}；近期正反馈不高于长期节奏的 ${formatPercent(evidence.thresholds.maxInterestRecentPositiveRatio)}；最近 ${evidence.thresholds.updateWindowDays} 天新投稿必须命中该分区/标签；${positiveRule}；${sameVideoRule}；${feedbackRule}。`;
  }
  if (evidence.kind === "buried_follow") {
    return `基础入选必须是已关注 UP、最近 ${evidence.thresholds.updateWindowDays} 天有新视频投稿、近期 ${evidence.thresholds.recentWindowDays} 天观看不超过 ${evidence.thresholds.maxBuriedRecentWatchCount} 次且正反馈不超过 ${evidence.thresholds.maxBuriedRecentPositiveWatchCount} 次；关注记忆信号至少满足：已关注不少于 ${evidence.thresholds.minBuriedFollowAgeDays} 天、特别关注、或近期窗口以前弱观看不少于 ${evidence.thresholds.minBuriedWeakWatchCount} 次之一；${positiveRule}；${sameVideoRule}；${feedbackRule}。`;
  }

  return `长期 UP 正反馈不少于 ${evidence.thresholds.minCreatorPositiveViews} 次；近期正反馈不高于长期节奏的 ${formatPercent(evidence.thresholds.recentCooldownRatio)}；${positiveRule}；${sameVideoRule}；${feedbackRule}。`;
}

function longWindowLabel(evidence: DynamicBillEvidence): string {
  if (evidence.kind === "buried_follow") return "长期观看";
  return evidence.interest ? "长期兴趣" : "长期";
}

function recentWindowLabel(evidence: DynamicBillEvidence): string {
  if (evidence.kind === "buried_follow") return "近期缺席";
  return evidence.interest ? "近期兴趣" : "近期";
}

function followEvidenceCopy(evidence: DynamicBillEvidence): string {
  const special = evidence.follow.special ? "；特别关注" : "";
  const memorySignals = evidence.follow.memorySignals?.length
    ? `；关注记忆信号：${followMemorySignalsCopy(evidence.follow.memorySignals)}`
    : "";
  return `${followShortCopy(evidence)}${special}${memorySignals}。`;
}

function followShortCopy(evidence: DynamicBillEvidence): string {
  if (evidence.follow.followAgeDays !== undefined) {
    return `已关注约 ${evidence.follow.followAgeDays} 天`;
  }
  return "已关注，关注时长未知";
}

function followMemorySignalsCopy(signals: NonNullable<DynamicBillEvidence["follow"]["memorySignals"]>): string {
  return signals.map((signal) => {
    switch (signal) {
      case "long_follow":
        return "长期关注";
      case "special_follow":
        return "特别关注";
      case "weak_watch":
        return "历史弱观看";
      default:
        return signal;
    }
  }).join("、");
}

function interestKindLabel(kind: "category" | "tag"): string {
  return kind === "category" ? "分区" : "标签";
}

function matchesStatusFilter(item: DynamicBillItem, statusFilter: DynamicBillStatusFilter): boolean {
  if (statusFilter === "active") {
    return item.status === "unopened" || item.status === "opened";
  }
  return item.status === statusFilter;
}

function chooseSelectedBillKey(
  current: string,
  items: DynamicBillItem[],
  statusFilter: DynamicBillStatusFilter,
): string {
  const visible = items.filter((item) => matchesStatusFilter(item, statusFilter));
  return current && visible.some((item) => item.billKey === current)
    ? current
    : visible[0]?.billKey ?? "";
}

function countByStatus(items: DynamicBillItem[]): Record<DynamicBillStatusFilter, number> {
  const unopened = items.filter((item) => item.status === "unopened").length;
  const opened = items.filter((item) => item.status === "opened").length;
  return {
    active: unopened + opened,
    unopened,
    opened,
    consumed: items.filter((item) => item.status === "consumed").length,
    processed: items.filter((item) => item.status === "processed").length,
  };
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "following":
      return "关注关系";
    case "dynamic-feed":
      return "动态 feed";
    case "video-detail":
      return "视频详情补全";
    case "storage":
      return "本地写入";
    case "complete":
      return "完成";
    default:
      return "等待";
  }
}

function statusLabel(status: DynamicBillStatus): string {
  return STATUS_FILTERS.find((item) => item.key === status)?.label ?? "未打开";
}

function statusFlowCopy(item: DynamicBillItem): string {
  const events = [
    item.openedAt ? `打开于 ${formatTime(item.openedAt)}` : "尚未从动态账单打开",
    item.consumedAt ? `消费确认于 ${formatTime(item.consumedAt)}` : "尚未确认有效观看",
    item.processedAt ? `处理于 ${formatTime(item.processedAt)}` : "尚未手动处理",
  ];
  return `${statusLabel(item.status)}：${events.join("；")}。`;
}

function spaceUrl(mid: number): string {
  return `https://space.bilibili.com/${mid}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN");
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function StatusMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="dynamic-bill-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function EvidenceStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="dynamic-bill-evidence-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
