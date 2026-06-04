import { useState } from 'preact/hooks';

type DynamicBillStatus = 'unopened' | 'opened' | 'consumed' | 'processed';

const STATUS_FILTERS: Array<{
  key: DynamicBillStatus;
  label: string;
  detail: string;
}> = [
  { key: 'unopened', label: '未打开', detail: '尚未从动态账单打开新投稿' },
  { key: 'opened', label: '已打开', detail: '打开过，但尚未确认有效观看' },
  { key: 'consumed', label: '已消费', detail: '由观看历史或播放器事件确认' },
  { key: 'processed', label: '已处理', detail: '用户手动完成或忽略，不等同于消费' },
];

const BILL_COLUMNS = [
  {
    title: '久违更新',
    detail: '过去有正反馈、近期冷却的已关注 UP 新投稿。',
    accent: 'pink',
  },
  {
    title: '换换口味',
    detail: '长期兴趣中近期占比下降的分区或标签新投稿。',
    accent: 'blue',
  },
  {
    title: '被淹没的关注',
    detail: '关注关系稳定、近期几乎没有消费的 UP 新投稿。',
    accent: 'mint',
  },
] as const;

export function DynamicBillPage() {
  const [status, setStatus] = useState<DynamicBillStatus>('unopened');
  const activeStatus = STATUS_FILTERS.find(item => item.key === status) ?? STATUS_FILTERS[0];

  return (
    <div className="dynamic-bill-page">
      <header className="dynamic-bill-hero">
        <div>
          <span className="dynamic-bill-kicker">消费前 / 已关注视频投稿</span>
          <h2>动态账单</h2>
          <p>
            这里将作为 Bili-Bill 的一级入口，用本地规则和必要解释帮助用户看见被近期口味覆盖的长期关注。
          </p>
        </div>
        <div className="dynamic-bill-scope">
          <strong>当前任务范围</strong>
          <span>Shell、导航、四态文案与结构占位</span>
        </div>
      </header>

      <section className="dynamic-bill-status-grid" aria-label="动态账单数据状态">
        <StatusMetric label="动态同步" value="待接入" detail="后续任务会同步最近 7 天视频投稿" />
        <StatusMetric label="长期窗口" value="180 天" detail="用于识别耐久兴趣，不足时需明确提示" />
        <StatusMetric label="近期窗口" value="30 天" detail="用于判断近期消费结构变化" />
        <StatusMetric label="AI 解释" value="可选增强" detail="不参与入选规则或排序" />
      </section>

      <section className="dynamic-bill-filters" aria-label="账单状态筛选">
        {STATUS_FILTERS.map(item => (
          <button
            key={item.key}
            type="button"
            className={status === item.key ? 'is-selected' : ''}
            onClick={() => setStatus(item.key)}
          >
            <span>{item.label}</span>
            <strong>0</strong>
          </button>
        ))}
      </section>

      <section className="dynamic-bill-layout">
        <div className="dynamic-bill-board" aria-label="动态账单栏目">
          {BILL_COLUMNS.map(column => (
            <article className={`dynamic-bill-column tone-${column.accent}`} key={column.title}>
              <div className="dynamic-bill-column-head">
                <div>
                  <h3>{column.title}</h3>
                  <p>{column.detail}</p>
                </div>
                <span>0</span>
              </div>
              <div className="dynamic-bill-empty">
                <strong>{activeStatus.label}账单项将在这里显示</strong>
                <p>当前页面只建立入口结构；同步、规则引擎和真实账单项由后续任务接入。</p>
              </div>
            </article>
          ))}
        </div>

        <aside className="dynamic-bill-detail" aria-label="账单项详情占位">
          <span className="dynamic-bill-kicker">选中账单项</span>
          <h3>详情结构占位</h3>
          <p>
            真实账单项接入后，这里会展示 UP 主、新投稿、本地证据事实、AI 解释、本地历史代表视频与操作入口。
          </p>
          <div className="dynamic-bill-status-copy">
            <strong>当前筛选：{activeStatus.label}</strong>
            <span>{activeStatus.detail}</span>
          </div>
          <div className="dynamic-bill-action-grid">
            <button type="button" disabled>打开新视频</button>
            <button type="button" disabled>打开 UP 主页</button>
            <button type="button" disabled>标记已处理</button>
            <button type="button" disabled>少提醒这个 UP</button>
            <button type="button" disabled>少提醒这个主题</button>
          </div>
        </aside>
      </section>
    </div>
  );
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
