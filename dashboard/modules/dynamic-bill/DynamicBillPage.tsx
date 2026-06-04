import { useEffect, useState } from "preact/hooks";
import type {
  DynamicBillOverview,
  DynamicSyncResult,
  DynamicSyncStatus,
} from "../../../src/shared/types/dynamic-bill";
import { requestSW } from "../../utils/messaging";

type DynamicBillStatus = "unopened" | "opened" | "consumed" | "processed";

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
    title: "久违更新",
    detail: "过去有正反馈、近期冷却的已关注 UP 新投稿。",
    accent: "pink",
  },
  {
    title: "换换口味",
    detail: "长期兴趣中近期占比下降的分区或标签新投稿。",
    accent: "blue",
  },
  {
    title: "被淹没的关注",
    detail: "关注关系稳定、近期几乎没有消费的 UP 新投稿。",
    accent: "mint",
  },
] as const;

export function DynamicBillPage() {
  const [status, setStatus] = useState<DynamicBillStatus>("unopened");
  const [overview, setOverview] = useState<DynamicBillOverview | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const activeStatus =
    STATUS_FILTERS.find((item) => item.key === status) ?? STATUS_FILTERS[0];
  const syncState = overview?.syncState;
  const isSyncing = syncing || syncState?.status === "syncing";
  const overviewNotice = overview
    ? describeOverview(overview)
    : "正在读取动态账单同步状态。";
  const emptyCopy = getEmptyCopy(overview, activeStatus.label);

  useEffect(() => {
    refreshOverview().catch((error) => {
      setNotice(`读取动态账单状态失败：${describeError(error)}`);
    });
  }, []);

  async function refreshOverview() {
    const next = await requestSW<DynamicBillOverview>(
      "GET_DYNAMIC_BILL_OVERVIEW",
    );
    setOverview(next);
  }

  async function handleSync() {
    setSyncing(true);
    setNotice("");
    try {
      const result = await requestSW<DynamicSyncResult>("SYNC_DYNAMIC_UPDATES");
      setOverview(result.overview);
      setNotice(describeSyncResult(result));
    } catch (error) {
      setNotice(`动态同步请求失败：${describeError(error)}`);
      await refreshOverview().catch(() => {});
    } finally {
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
            这里将作为 Bili-Bill
            的一级入口，用本地规则和必要解释帮助用户看见被近期口味覆盖的长期关注。
          </p>
        </div>
        <div className="dynamic-bill-scope">
          <strong>同步范围</strong>
          <span>
            只同步已关注 UP 最近 7 天的视频投稿动态；非视频动态不会进入账单池。
          </span>
          <button
            type="button"
            className="dynamic-bill-sync-button"
            disabled={isSyncing}
            onClick={handleSync}
          >
            {isSyncing ? "同步中..." : "同步关注动态"}
          </button>
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
          detail="关注快照写入本地仓库"
        />
        <StatusMetric
          label="最近投稿"
          value={String(overview?.recentVideoUpdateCount ?? 0)}
          detail={`最近 ${overview?.updateWindowDays ?? 7} 天视频投稿池`}
        />
        <StatusMetric
          label="关注时间"
          value={`${overview?.followAgeKnownCount ?? 0} / ${overview?.followAgeUnknownCount ?? 0}`}
          detail="已知 / 未知；未知时不展示虚假时长"
        />
      </section>

      <section
        className="dynamic-bill-status-copy"
        aria-label="动态账单同步说明"
      >
        <strong>{notice || overviewNotice}</strong>
        <span>
          本任务只同步数据池，不生成久违更新、换换口味或被淹没的关注规则账单。
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
            <strong>0</strong>
          </button>
        ))}
      </section>

      <section className="dynamic-bill-layout">
        <div className="dynamic-bill-board" aria-label="动态账单栏目">
          {BILL_COLUMNS.map((column) => (
            <article
              className={`dynamic-bill-column tone-${column.accent}`}
              key={column.title}
            >
              <div className="dynamic-bill-column-head">
                <div>
                  <h3>{column.title}</h3>
                  <p>{column.detail}</p>
                </div>
                <span>0</span>
              </div>
              <div className="dynamic-bill-empty">
                <strong>{emptyCopy.title}</strong>
                <p>{emptyCopy.detail}</p>
              </div>
            </article>
          ))}
        </div>

        <aside className="dynamic-bill-detail" aria-label="账单项详情占位">
          <span className="dynamic-bill-kicker">选中账单项</span>
          <h3>详情结构占位</h3>
          <p>
            真实账单项接入后，这里会展示 UP 主、新投稿、本地证据事实、AI
            解释、本地历史代表视频与操作入口。
          </p>
          <div className="dynamic-bill-status-copy">
            <strong>当前筛选：{activeStatus.label}</strong>
            <span>{activeStatus.detail}</span>
          </div>
          <div className="dynamic-bill-action-grid">
            <button type="button" disabled>
              打开新视频
            </button>
            <button type="button" disabled>
              打开 UP 主页
            </button>
            <button type="button" disabled>
              标记已处理
            </button>
            <button type="button" disabled>
              少提醒这个 UP
            </button>
            <button type="button" disabled>
              少提醒这个主题
            </button>
          </div>
        </aside>
      </section>
    </div>
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
    return "需要先登录 B 站账号，Bili-Bill 才能同步你的关注关系和关注动态。";
  }
  if (state.status === "failed") {
    return `动态同步失败：${state.lastError ?? "未知错误"}。已保留本地已有动态数据。`;
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

function getEmptyCopy(
  overview: DynamicBillOverview | null,
  statusLabel: string,
): { title: string; detail: string } {
  if (!overview) {
    return {
      title: "正在读取账单数据",
      detail: "同步状态加载后会显示关注快照和最近视频投稿池数量。",
    };
  }
  if (overview.syncState.status === "not_logged_in") {
    return {
      title: "需要登录 B 站后同步",
      detail: "未登录时页面不会崩溃，也不会尝试生成虚假的账单项。",
    };
  }
  if (overview.activeFollowedCreatorCount === 0) {
    return {
      title: "还没有关注快照",
      detail:
        "完成同步后，这里会基于已关注 UP 的视频投稿池等待后续规则引擎生成账单项。",
    };
  }
  if (overview.recentVideoUpdateCount === 0) {
    return {
      title: "最近 7 天暂无已关注视频投稿",
      detail: "非视频动态已被过滤，不会进入动态账单候选池。",
    };
  }
  return {
    title: `${statusLabel}账单项将在后续任务生成`,
    detail:
      "当前任务只准备已关注视频投稿池；三栏兴趣再平衡规则由后续 issue 接入。",
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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN");
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
