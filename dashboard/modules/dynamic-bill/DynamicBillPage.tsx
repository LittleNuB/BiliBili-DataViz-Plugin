import { useEffect, useMemo, useState } from "preact/hooks";
import type {
  DynamicBillColumn,
  DynamicBillGenerateResult,
  DynamicBillEvidence,
  DynamicBillItem,
  DynamicBillOverview,
  DynamicBillStatus,
  DynamicSyncResult,
  DynamicSyncStatus,
} from "../../../src/shared/types/dynamic-bill";
import { requestSW } from "../../utils/messaging";

const STATUS_FILTERS: Array<{
  key: DynamicBillStatus;
  label: string;
  detail: string;
}> = [
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

export function DynamicBillPage() {
  const [status, setStatus] = useState<DynamicBillStatus>("unopened");
  const [overview, setOverview] = useState<DynamicBillOverview | null>(null);
  const [items, setItems] = useState<DynamicBillItem[]>([]);
  const [selectedBillKey, setSelectedBillKey] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const activeStatus =
    STATUS_FILTERS.find((item) => item.key === status) ?? STATUS_FILTERS[0];
  const syncState = overview?.syncState;
  const isSyncing = syncing || syncState?.status === "syncing";
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
    () => items.filter((item) => item.status === status),
    [items, status],
  );
  const selectedItem =
    visibleItems.find((item) => item.billKey === selectedBillKey) ??
    visibleItems[0] ??
    null;
  const statusCounts = useMemo(() => countByStatus(items), [items]);

  useEffect(() => {
    refreshOverview().catch((error) => {
      setNotice(`读取动态账单状态失败：${describeError(error)}`);
    });
    refreshBillItems().catch((error) => {
      setNotice(`读取动态账单失败：${describeError(error)}`);
    });
  }, []);

  async function refreshOverview() {
    const next = await requestSW<DynamicBillOverview>(
      "GET_DYNAMIC_BILL_OVERVIEW",
    );
    setOverview(next);
  }

  async function refreshBillItems() {
    const next = await requestSW<DynamicBillItem[]>("GET_DYNAMIC_BILL_ITEMS");
    setItems(next);
    setSelectedBillKey((current) =>
      current && next.some((item) => item.billKey === current)
        ? current
        : next[0]?.billKey ?? "",
    );
  }

  async function generateLocalBill(): Promise<DynamicBillGenerateResult> {
    const result = await requestSW<DynamicBillGenerateResult>(
      "GENERATE_DYNAMIC_BILL",
    );
    setOverview(result.overview);
    setItems(result.items);
    setSelectedBillKey((current) =>
      current && result.items.some((item) => item.billKey === current)
        ? current
        : result.items[0]?.billKey ?? "",
    );
    return result;
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
            久违更新、换换口味和被淹没的关注用本地观看历史、关注快照和最近投稿池生成，不接 AI，也不上传完整历史或完整关注列表。
          </p>
        </div>
        <div className="dynamic-bill-scope">
          <strong>本地证据范围</strong>
          <span>
            同步已关注 UP 最近 7 天视频投稿；生成时按长期正反馈、长期兴趣落差或关注记忆信号分别入栏，并排除近期已看过的同一新视频。
          </span>
          <div className="dynamic-bill-scope-actions">
            <button
              type="button"
              className="dynamic-bill-sync-button"
              disabled={isSyncing || generating}
              onClick={handleSync}
            >
              {isSyncing ? "同步中..." : "同步并刷新"}
            </button>
            <button
              type="button"
              className="dynamic-bill-sync-button is-secondary"
              disabled={isSyncing || generating}
              onClick={handleGenerate}
            >
              {generating ? "生成中..." : "生成本地账单"}
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
          本切片启用三类本地证据栏目；状态推进和筛选持久化留给 #8，负反馈累计、topic 降低和取关提示留给 #9 闭环。
        </span>
      </section>

      <section className="dynamic-bill-filters" aria-label="账单状态筛选">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={status === item.key ? "is-selected" : ""}
            onClick={() => setStatus(item.key)}
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
                  <span>{columnCount}</span>
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
            <BillItemDetail item={selectedItem} />
          ) : (
            <EmptyDetail status={activeStatus} />
          )}
        </aside>
      </section>
    </div>
  );
}

function BillItemDetail({ item }: { item: DynamicBillItem }) {
  const evidence = item.evidence;
  const isBuriedFollow = evidence.kind === "buried_follow";
  return (
    <>
      <span className="dynamic-bill-kicker">
        {columnTitle(item.column)} / {statusLabel(item.status)}
      </span>
      <h3>{item.creatorName}</h3>
      <p>
        新投稿：{evidence.newVideo.title || evidence.newVideo.bvid}
      </p>
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
      <div className="dynamic-bill-action-grid">
        <a href={videoUrl(evidence.newVideo.bvid)} target="_blank" rel="noreferrer">
          打开新视频
        </a>
        <a href={spaceUrl(item.creatorMid)} target="_blank" rel="noreferrer">
          打开 UP 主页
        </a>
      </div>
    </>
  );
}

function EmptyDetail({
  status,
}: {
  status: { key: DynamicBillStatus; label: string; detail: string };
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
  return `本地账单生成 ${result.itemCount} 项：久违更新 ${result.columnItemCounts.afk_update} 项，换换口味 ${result.columnItemCounts.variety} 项，被淹没的关注 ${result.columnItemCounts.buried_follow} 项；扫描最近投稿 ${result.candidatesScanned} 条，排除近期已看同视频 ${result.excludedRecentSameVideoCount} 条，长期/关注记忆证据不足 ${result.excludedNoLongSignalCount} 个，近期仍活跃 ${result.excludedRecentActiveCount} 个。`;
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

function thresholdCopy(evidence: DynamicBillEvidence): string {
  const positiveRule = `正反馈为完成度 ≥ ${formatPercent(evidence.thresholds.positiveCompletionRate)}、观看 ≥ ${formatDuration(evidence.thresholds.minPositiveWatchSeconds)} 或已收藏`;
  const sameVideoRule = `近期同一新视频排除窗口为 ${evidence.thresholds.recentSameVideoWindowDays} 天`;

  if (evidence.kind === "variety") {
    return `长期兴趣正反馈不少于 ${evidence.thresholds.minInterestPositiveViews} 次，长期正反馈占比 ≥ ${formatPercent(evidence.thresholds.minInterestLongPositiveShare)}；近期正反馈不高于长期节奏的 ${formatPercent(evidence.thresholds.maxInterestRecentPositiveRatio)}；最近 ${evidence.thresholds.updateWindowDays} 天新投稿必须命中该分区/标签；${positiveRule}；${sameVideoRule}。`;
  }
  if (evidence.kind === "buried_follow") {
    return `基础入选必须是已关注 UP、最近 ${evidence.thresholds.updateWindowDays} 天有新视频投稿、近期 ${evidence.thresholds.recentWindowDays} 天观看不超过 ${evidence.thresholds.maxBuriedRecentWatchCount} 次且正反馈不超过 ${evidence.thresholds.maxBuriedRecentPositiveWatchCount} 次；关注记忆信号至少满足：已关注不少于 ${evidence.thresholds.minBuriedFollowAgeDays} 天、特别关注、或近期窗口以前弱观看不少于 ${evidence.thresholds.minBuriedWeakWatchCount} 次之一；${positiveRule}；${sameVideoRule}。`;
  }

  return `长期 UP 正反馈不少于 ${evidence.thresholds.minCreatorPositiveViews} 次；近期正反馈不高于长期节奏的 ${formatPercent(evidence.thresholds.recentCooldownRatio)}；${positiveRule}；${sameVideoRule}。`;
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

function countByStatus(items: DynamicBillItem[]): Record<DynamicBillStatus, number> {
  return {
    unopened: items.filter((item) => item.status === "unopened").length,
    opened: items.filter((item) => item.status === "opened").length,
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

function videoUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`;
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
