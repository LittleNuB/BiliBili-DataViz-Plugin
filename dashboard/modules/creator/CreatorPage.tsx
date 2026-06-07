import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { creatorData, creatorLoading, creatorError } from '../../signals';
import { requestSW } from '../../utils/messaging';
import type {
  CreatorFollowDataCoverage,
  CreatorFollowStatus,
  CreatorFollowStatusGroup,
  CreatorRanking,
  NewCreator,
} from '../../../src/shared/types/analytics';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { formatTimeHHMM } from '../../../src/shared/utils/format';

const GROUP_ORDER: CreatorFollowStatus[] = ['followed', 'not_followed', 'unknown'];

const GROUP_COPY: Record<CreatorFollowStatus, { title: string; description: string; empty: string }> = {
  followed: {
    title: '已关注',
    description: '这些 UP 出现在最近观看历史中，并且仍在当前本地关注快照的 active 关注列表里。',
    empty: '最近观看历史里暂时没有匹配到仍在关注的 UP。',
  },
  not_followed: {
    title: '未关注',
    description: '这些 UP 出现在最近观看历史中，但不在当前本地 active 关注快照里。',
    empty: '在关注快照可用时，未发现最近看过但当前未关注的 UP。',
  },
  unknown: {
    title: '状态未知',
    description: '关注快照尚不可用或无法可靠判断时，观看过的 UP 会先放在这里。',
    empty: '当前没有需要标记为状态未知的 UP。',
  },
};

const STATUS_TONE: Record<CreatorFollowStatus, string> = {
  followed: 'is-followed',
  not_followed: 'is-not-followed',
  unknown: 'is-unknown',
};

export function CreatorPage() {
  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    creatorLoading.value = true;
    creatorError.value = null;
    try {
      creatorData.value = await requestSW<typeof creatorData.value>('GET_CREATOR_DATA');
    } catch (e) {
      creatorError.value = (e as Error).message;
    } finally {
      creatorLoading.value = false;
    }
  }

  if (creatorLoading.value) return <div style={{ padding: '16px' }}><LoadingSkeleton height={400} /></div>;
  if (creatorError.value) return <div style={{ padding: '16px', color: '#FF6B6B' }}>{creatorError.value}</div>;
  const d = creatorData.value;
  if (!d) return <EmptyState />;

  const followGroups = normalizeFollowGroups(d.followGroups, d.topCreators);

  return (
    <ErrorBoundary>
      <div className="creator-page" data-testid="creator-relationships-page">
        <section className="creator-hero">
          <div>
            <span>Creator Relationships</span>
            <h2>按关注状态理解 UP 关系</h2>
            <p>
              这里只使用本地观看历史和本地关注快照做判断。没有关注快照时会显示状态未知，不会把未知误写成未关注。
            </p>
          </div>
          <div className={`creator-coverage ${d.followDataCoverage?.hasSnapshot ? 'is-ready' : 'is-missing'}`} data-testid="creator-follow-coverage">
            <strong>{d.followDataCoverage?.hasSnapshot ? '关注快照可用' : '关注状态不可判定'}</strong>
            <span>{coverageCopy(d.followDataCoverage)}</span>
          </div>
        </section>

        <section className="creator-follow-board" aria-label="创作者关注状态分组">
          {followGroups.map(group => (
            <FollowStatusColumn key={group.status} group={group} coverage={d.followDataCoverage} />
          ))}
        </section>

        <section className="creator-secondary-grid">
          <CreatorPanel title="TOP 10 UP" data-testid="creator-top-panel">
            {d.topCreators.length > 0 ? (
              <div className="creator-list is-compact">
                {d.topCreators.map((creator, index) => (
                  <CreatorListItem key={creator.mid} creator={creator} rank={index + 1} />
                ))}
              </div>
            ) : (
              <PanelEmpty copy="暂无最近 30 天创作者观看数据。" />
            )}
          </CreatorPanel>

          <CreatorPanel title="深度绑定" data-testid="creator-deep-bond-panel">
            {d.deepBondCreators.length > 0 ? (
              <div className="creator-list is-compact">
                {d.deepBondCreators.map(creator => (
                  <CreatorListItem key={creator.mid} creator={creator} evidence="高完播和连续观看" />
                ))}
              </div>
            ) : (
              <PanelEmpty copy="暂未发现高完播、连续观看都明显集中的 UP。" />
            )}
          </CreatorPanel>
        </section>

        <section className="creator-secondary-grid">
          <CreatorPanel title="本月新发现" data-testid="creator-new-panel">
            {d.newCreators.length > 0 ? (
              <div className="creator-list is-compact">
                {d.newCreators.map(creator => (
                  <NewCreatorItem key={creator.mid} creator={creator} />
                ))}
              </div>
            ) : (
              <PanelEmpty copy="本月暂未发现首次进入观看历史的 UP。" />
            )}
          </CreatorPanel>

          <CreatorPanel title="过度依赖提醒" data-testid="creator-overdependency-panel">
            {d.overDependency ? (
              <div className="creator-alert">
                <strong>{d.overDependency.creator.name}</strong>
                <span>
                  最近 30 天约 {d.overDependency.percentage}% 的 B 站观看时间集中在这位 UP。可以把它当作消费集中度提示，而不是关注关系结论。
                </span>
              </div>
            ) : (
              <PanelEmpty copy="最近 30 天没有发现观看时间过度集中到单一 UP。" />
            )}
          </CreatorPanel>
        </section>
      </div>
    </ErrorBoundary>
  );
}

function FollowStatusColumn({
  group,
  coverage,
}: {
  group: CreatorFollowStatusGroup;
  coverage?: CreatorFollowDataCoverage;
}) {
  const copy = GROUP_COPY[group.status];
  return (
    <section className={`creator-follow-column ${STATUS_TONE[group.status]}`} data-testid={`creator-follow-group-${group.status}`}>
      <div className="creator-follow-head">
        <div>
          <h3>{copy.title}</h3>
          <p>{groupDescription(group.status, coverage)}</p>
        </div>
        <strong data-testid={`creator-follow-count-${group.status}`}>{group.count}</strong>
      </div>
      {group.creators.length > 0 ? (
        <div className="creator-list">
          {group.creators.map(creator => (
            <CreatorListItem key={creator.mid} creator={creator} />
          ))}
        </div>
      ) : (
        <div className="creator-empty" data-testid={`creator-follow-empty-${group.status}`}>
          <strong>{copy.empty}</strong>
          <p>{emptyStateDetail(group.status, coverage)}</p>
        </div>
      )}
    </section>
  );
}

function CreatorPanel({
  title,
  children,
  ...props
}: {
  title: string;
  children: ComponentChildren;
  'data-testid'?: string;
}) {
  return (
    <section className="creator-panel" {...props}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function CreatorListItem({
  creator,
  rank,
  evidence,
}: {
  creator: CreatorRanking;
  rank?: number;
  evidence?: string;
}) {
  return (
    <article className="creator-item" data-testid="creator-item">
      {rank !== undefined && <span className="creator-rank">{rank}</span>}
      <div className="creator-item-main">
        <strong>{creator.name || `UP ${creator.mid}`}</strong>
        <span>
          {creator.videoCount} 个视频 · {formatTimeHHMM(creator.totalWatchTime)} · 完播 {Math.round(creator.avgCompletion * 100)}%
        </span>
        {evidence && <small>{evidence}</small>}
      </div>
      <div className="creator-item-tags">
        <StatusChip status={creator.followStatus ?? 'unknown'} />
        {creator.isDeepBond && <em>深度绑定</em>}
      </div>
    </article>
  );
}

function NewCreatorItem({ creator }: { creator: NewCreator }) {
  return (
    <article className="creator-item" data-testid="creator-new-item">
      <div className="creator-item-main">
        <strong>{creator.name || `UP ${creator.mid}`}</strong>
        <span>
          首次观看 {creator.firstWatchDate} · 后续观看 {creator.subsequentViews} 次
        </span>
        <small>{creator.retained ? '证据：本月重复观看' : '证据：本月首次出现'}</small>
      </div>
      <div className="creator-item-tags">
        <StatusChip status={creator.followStatus ?? 'unknown'} />
      </div>
    </article>
  );
}

function StatusChip({ status }: { status: CreatorFollowStatus }) {
  return <span className={`creator-status ${STATUS_TONE[status]}`}>{GROUP_COPY[status].title}</span>;
}

function PanelEmpty({ copy }: { copy: string }) {
  return (
    <div className="creator-panel-empty">
      {copy}
    </div>
  );
}

function normalizeFollowGroups(
  groups: CreatorFollowStatusGroup[] | undefined,
  topCreators: CreatorRanking[],
): CreatorFollowStatusGroup[] {
  const byStatus = new Map((groups ?? []).map(group => [group.status, group]));
  return GROUP_ORDER.map(status => byStatus.get(status) ?? {
    status,
    creators: status === 'unknown' ? topCreators.map(creator => ({ ...creator, followStatus: 'unknown' as const })) : [],
    count: status === 'unknown' ? topCreators.length : 0,
  });
}

function coverageCopy(coverage?: CreatorFollowDataCoverage): string {
  if (!coverage) return '旧版数据未提供关注快照覆盖信息，页面会按状态未知处理。';
  if (coverage.hasSnapshot) {
    const syncedAt = coverage.snapshotSyncedAt ? ` · 快照时间 ${formatSnapshotTime(coverage.snapshotSyncedAt)}` : '';
    return `当前 active 关注 UP ${coverage.activeFollowedCreatorCount} 个${syncedAt}。`;
  }

  switch (coverage.reason) {
    case 'syncing':
      return '关注快照正在同步，完成前不会判断已关注或未关注。';
    case 'not_logged_in':
      return '关注数据不可用：当前浏览器未登录或 B 站接口拒绝返回关注列表。';
    case 'sync_failed':
      return `关注快照同步失败，暂不判断关注状态${coverage.lastError ? `：${coverage.lastError}` : '。'}`;
    default:
      return '尚未同步关注快照，请先在动态账单中同步关注数据。';
  }
}

function groupDescription(status: CreatorFollowStatus, coverage?: CreatorFollowDataCoverage): string {
  if (status === 'unknown' && !coverage?.hasSnapshot) return coverageCopy(coverage);
  return GROUP_COPY[status].description;
}

function emptyStateDetail(status: CreatorFollowStatus, coverage?: CreatorFollowDataCoverage): string {
  if (status === 'followed' && !coverage?.hasSnapshot) return '需要可用的本地关注快照后才能确认哪些 UP 仍被关注。';
  if (status === 'not_followed' && !coverage?.hasSnapshot) return '关注快照缺失时不会把任何 UP 判定为未关注。';
  if (status === 'unknown' && coverage?.hasSnapshot) return '本地关注快照已经可用，最近观看过的 UP 均已完成已关注或未关注判断。';
  return GROUP_COPY[status].description;
}

function formatSnapshotTime(value: number): string {
  const millis = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(millis).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
