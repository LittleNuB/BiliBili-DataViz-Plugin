import { useEffect, useMemo, useState } from 'preact/hooks';
import { requestSW } from '../../utils/messaging';
import { BILI_BLUE, BILI_PINK } from '../../../src/shared/constants';
import type { AiConfig, UserConfig } from '../../../src/shared/types/config';
import type {
  FavoriteSyncResult,
  SmartFavoriteOverview,
  SmartFavoriteResult,
  SmartFavoriteSearchResponse,
  SmartFavoriteTreeNode,
  SmartIndexResult,
} from '../../../src/shared/types/favorite';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';

const CARD = {
  background: '#222244',
  border: '1px solid #333355',
  borderRadius: '8px',
  padding: '12px',
};

export function SmartFavoritesPage() {
  const [overview, setOverview] = useState<SmartFavoriteOverview | null>(null);
  const [config, setConfig] = useState<AiConfig>({ baseURL: 'https://api.deepseek.com', apiKey: '', chatModel: 'deepseek-v4-flash' });
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SmartFavoriteSearchResponse | null>(null);
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [pathResults, setPathResults] = useState<SmartFavoriteResult[]>([]);
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { void refreshAll(); }, []);

  const treeRows = useMemo(() => getVisibleTreeRows(overview?.tree ?? [], expandedTree), [overview, expandedTree]);

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      const [cfg, data] = await Promise.all([
        requestSW<UserConfig>('GET_CONFIG'),
        requestSW<SmartFavoriteOverview>('GET_SMART_FAVORITES'),
      ]);
      setConfig(cfg.ai);
      setOverview(data);
      if (selectedPath.length > 0) {
        setPathResults(await requestSW<SmartFavoriteResult[]>('GET_SMART_FAVORITES_BY_PATH', { path: selectedPath, limit: 200 }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveAiConfig() {
    setBusy('save');
    setError(null);
    try {
      await requestSW('UPDATE_CONFIG', { ai: config });
      setNotice('AI 配置已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function syncFavorites() {
    setBusy('sync');
    setError(null);
    try {
      const result = await requestSW<FavoriteSyncResult>('SYNC_FAVORITES');
      setNotice(`已同步 ${result.folders} 个收藏夹，${result.items} 个视频`);
      setOverview(await requestSW<SmartFavoriteOverview>('GET_SMART_FAVORITES'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function buildIndex() {
    setBusy('index');
    setError(null);
    try {
      const result = await requestSW<SmartIndexResult>('BUILD_SMART_FAVORITE_INDEX', { maxItems: 200 });
      setNotice(`智能索引完成：新增/更新 ${result.indexed} 条，失败 ${result.failed} 条，跳过 ${result.skipped} 条`);
      setOverview(await requestSW<SmartFavoriteOverview>('GET_SMART_FAVORITES'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setBusy('search');
    setError(null);
    try {
      setSearch(await requestSW<SmartFavoriteSearchResponse>('SEARCH_SMART_FAVORITES', { query: q, limit: 30 }));
      setSelectedPath([]);
      setPathResults([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  function toggleTreeNode(path: string[]) {
    const key = pathKey(path);
    setExpandedTree(current => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function selectTreePath(path: string[]) {
    setBusy('path');
    setError(null);
    try {
      setSelectedPath(path);
      setSearch(null);
      setPathResults(await requestSW<SmartFavoriteResult[]>('GET_SMART_FAVORITES_BY_PATH', { path, limit: 200 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  function expandAllTree() {
    setExpandedTree(new Set(collectExpandablePathKeys(overview?.tree ?? [])));
  }

  function collapseAllTree() {
    setExpandedTree(new Set());
  }

  if (loading) return <div style={{ padding: '16px' }}><LoadingSkeleton height={420} /></div>;

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {error && <Status color="#FF6B6B" text={error} />}
      {notice && <Status color="#00D4AA" text={notice} />}

      <section style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '12px' }}>
          <Metric label="收藏夹" value={overview?.folders.length ?? 0} />
          <Metric label="收藏视频" value={overview?.totalItems ?? 0} />
          <Metric label="索引成功" value={overview?.indexedItems ?? 0} />
          <Metric label="索引失败" value={overview?.failedItems ?? 0} />
          <Metric label="待索引" value={overview?.pendingItems ?? 0} />
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <ActionButton label={busy === 'sync' ? '同步中...' : '同步收藏夹'} onClick={syncFavorites} disabled={!!busy} />
          <ActionButton label={busy === 'index' ? '生成中...' : '生成智能索引'} onClick={buildIndex} disabled={!!busy || !overview?.totalItems} />
          <ActionButton label="刷新" onClick={refreshAll} disabled={!!busy} variant="ghost" />
        </div>
      </section>

      <section style={CARD}>
        <div style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>AI 配置</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <TextInput value={config.baseURL} onInput={value => setConfig({ ...config, baseURL: value })} placeholder="Base URL" />
          <TextInput value={config.chatModel} onInput={value => setConfig({ ...config, chatModel: value })} placeholder="模型" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
          <TextInput value={config.apiKey} onInput={value => setConfig({ ...config, apiKey: value })} placeholder="API Key" password />
          <ActionButton label={busy === 'save' ? '保存中...' : '保存'} onClick={saveAiConfig} disabled={!!busy} />
        </div>
      </section>

      <section style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
          <TextInput value={query} onInput={setQuery} placeholder="输入模糊描述，例如：苏德战争 库尔斯克" onEnter={runSearch} />
          <ActionButton label={busy === 'search' ? '搜索中...' : '搜索'} onClick={runSearch} disabled={!!busy || !query.trim()} />
        </div>
        {search && (
          <div style={{ color: '#9090A0', fontSize: '12px', marginTop: '8px' }}>
            扩展词：{search.rewrittenTerms.length ? search.rewrittenTerms.join('、') : '无'}
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '12px', alignItems: 'start' }}>
        <section style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <div style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 600 }}>AI 分类树</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <TreeAction label="展开" onClick={expandAllTree} disabled={!overview?.tree.length} />
              <TreeAction label="收起" onClick={collapseAllTree} disabled={!overview?.tree.length} />
            </div>
          </div>
          <div style={{ color: '#666', fontSize: '11px', lineHeight: 1.5, marginBottom: '8px' }}>
            未分类包含模型归入未分类、索引失败和待索引内容；失败项再次生成索引会重试。
          </div>
          {treeRows.length === 0 ? (
            <div style={{ color: '#666', fontSize: '12px', lineHeight: 1.6 }}>同步并生成智能索引后显示分类</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {treeRows.map(row => (
                <TreeRow
                  key={row.path.join('/')}
                  row={row}
                  expanded={expandedTree.has(pathKey(row.path))}
                  selected={pathKey(selectedPath) === pathKey(row.path)}
                  onToggle={() => toggleTreeNode(row.path)}
                  onSelect={() => { void selectTreePath(row.path); }}
                />
              ))}
            </div>
          )}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <ResultSection
            search={search}
            selectedPath={selectedPath}
            pathResults={pathResults}
            busy={busy}
          />
        </section>
      </div>
    </div>
  );
}

function ResultSection({
  search,
  selectedPath,
  pathResults,
  busy,
}: {
  search: SmartFavoriteSearchResponse | null;
  selectedPath: string[];
  pathResults: SmartFavoriteResult[];
  busy: string;
}) {
  if (search) {
    return (
      <>
        <ResultHeader title="搜索结果" count={search.results.length} />
        {search.results.length === 0 ? (
          <EmptyPanel text="没有找到匹配收藏" />
        ) : (
          search.results.map(result => <ResultCard key={result.item.itemKey} result={result} />)
        )}
      </>
    );
  }

  if (selectedPath.length > 0) {
    const title = selectedPath.join(' / ');
    return (
      <>
        <ResultHeader title={title} count={pathResults.length} />
        {busy === 'path' ? (
          <EmptyPanel text="正在加载分类内容..." />
        ) : pathResults.length === 0 ? (
          <EmptyPanel text="这个分类下暂时没有视频" />
        ) : (
          pathResults.map(result => <ResultCard key={result.item.itemKey} result={result} />)
        )}
      </>
    );
  }

  return (
    <>
      <ResultHeader title="分类内容" count={0} />
      <EmptyPanel text="请选择一个分类或输入搜索" />
    </>
  );
}

function ResultHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ ...CARD, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
      <div style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </div>
      <div style={{ color: BILI_BLUE, fontSize: '12px', whiteSpace: 'nowrap' }}>{count} 个视频</div>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div style={{ ...CARD, color: '#9090A0', fontSize: '13px', textAlign: 'center', padding: '40px 12px' }}>
      {text}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#1A1A2E', borderRadius: '6px', padding: '10px', textAlign: 'center' }}>
      <div style={{ color: '#FFFFFF', fontSize: '20px', fontWeight: 700 }}>{value}</div>
      <div style={{ color: '#9090A0', fontSize: '11px', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

function Status({ color, text }: { color: string; text: string }) {
  return <div style={{ ...CARD, color, fontSize: '13px' }}>{text}</div>;
}

function TextInput({
  value,
  onInput,
  placeholder,
  password,
  onEnter,
}: {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
  password?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      value={value}
      type={password ? 'password' : 'text'}
      placeholder={placeholder}
      onInput={event => onInput((event.target as HTMLInputElement).value)}
      onKeyDown={event => { if (event.key === 'Enter') onEnter?.(); }}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: '#1A1A2E',
        border: '1px solid #333355',
        color: '#FFFFFF',
        borderRadius: '6px',
        padding: '9px 10px',
        fontSize: '12px',
        outline: 'none',
      }}
    />
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant = 'solid',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'solid' | 'ghost';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: variant === 'solid' ? BILI_PINK : 'transparent',
        color: variant === 'solid' ? '#FFFFFF' : '#A0A0B0',
        border: variant === 'solid' ? 'none' : '1px solid #333355',
        borderRadius: '6px',
        padding: '9px 12px',
        fontSize: '12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function TreeAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: '#1A1A2E',
        color: '#A0A0B0',
        border: '1px solid #333355',
        borderRadius: '5px',
        padding: '3px 7px',
        fontSize: '11px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function TreeRow({
  row,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  row: TreeRowData;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const hasChildren = row.children.length > 0;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '18px 1fr auto',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '3px 4px',
        paddingLeft: `${row.depth * 12 + 2}px`,
        background: selected ? 'rgba(251, 114, 153, 0.16)' : 'transparent',
        border: selected ? `1px solid ${BILI_PINK}` : '1px solid transparent',
        borderRadius: '4px',
        color: 'inherit',
      }}
    >
      <button
        onClick={hasChildren ? onToggle : undefined}
        disabled={!hasChildren}
        title={hasChildren ? (expanded ? '收起' : '展开') : ''}
        style={{
          width: '18px',
          height: '18px',
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: hasChildren ? BILI_BLUE : '#555',
          cursor: hasChildren ? 'pointer' : 'default',
          fontSize: '12px',
          lineHeight: '18px',
        }}
      >
        {hasChildren ? (expanded ? '-' : '+') : ''}
      </button>
      <button
        onClick={onSelect}
        title={row.path.join(' / ')}
        style={{
          minWidth: 0,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: selected ? '#FFFFFF' : row.depth === 0 ? '#FFFFFF' : '#A0A0B0',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: row.depth === 0 ? 600 : 400,
          lineHeight: 1.4,
          overflow: 'hidden',
          textAlign: 'left',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.name}
      </button>
      <span style={{ color: BILI_BLUE, fontSize: '11px' }}>{row.count}</span>
    </div>
  );
}

function ResultCard({ result }: { result: SmartFavoriteResult }) {
  const item = result.item;
  const videoUrl = getVideoUrl(item);
  return (
    <a
      href={videoUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      onClick={event => {
        if (!videoUrl) event.preventDefault();
      }}
      style={{ ...CARD, display: 'grid', gridTemplateColumns: '112px 1fr', gap: '10px', textDecoration: 'none' }}
    >
      <img
        src={item.cover}
        alt=""
        style={{ width: '112px', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: '6px', background: '#1A1A2E' }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 600, lineHeight: 1.4, marginBottom: '5px' }}>{item.title}</div>
        <div style={{ color: '#9090A0', fontSize: '11px', marginBottom: '6px' }}>
          {item.authorName || '未知UP主'} · {item.folderTitle}
        </div>
        <div style={{ color: BILI_BLUE, fontSize: '11px', marginBottom: '6px' }}>
          {(result.smart?.path ?? ['未分类']).join(' / ')}
        </div>
        <div style={{ color: '#A0A0B0', fontSize: '12px', lineHeight: 1.5 }}>
          {result.smart?.summary || item.intro || '暂无摘要'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
          <span style={{ color: '#666', fontSize: '11px' }}>
            {result.reasons.join(' · ')}{result.score > 0 ? ` · 分数 ${Math.round(result.score)}` : ''}
          </span>
          <span style={{ color: videoUrl ? BILI_PINK : '#666', fontSize: '11px', whiteSpace: 'nowrap' }}>
            {videoUrl ? '打开' : '无可用链接'}
          </span>
        </div>
      </div>
    </a>
  );
}

function getVideoUrl(item: SmartFavoriteResult['item']): string | null {
  if (item.bvid) return `https://www.bilibili.com/video/${item.bvid}`;
  if (item.avid) return `https://www.bilibili.com/video/av${item.avid}`;
  return null;
}

interface TreeRowData extends SmartFavoriteTreeNode {
  depth: number;
}

function getVisibleTreeRows(
  nodes: SmartFavoriteTreeNode[],
  expanded: Set<string>,
  depth = 0,
): TreeRowData[] {
  const rows: TreeRowData[] = [];
  for (const node of nodes) {
    rows.push({ ...node, depth });
    if (node.children.length > 0 && expanded.has(pathKey(node.path))) {
      rows.push(...getVisibleTreeRows(node.children, expanded, depth + 1));
    }
  }
  return rows;
}

function collectExpandablePathKeys(nodes: SmartFavoriteTreeNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.children.length > 0) {
      keys.push(pathKey(node.path));
      keys.push(...collectExpandablePathKeys(node.children));
    }
  }
  return keys;
}

function pathKey(path: string[]): string {
  return path.join('\u0001');
}
