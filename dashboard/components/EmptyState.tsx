interface Props {
  message?: string;
}

export function EmptyState({ message = '暂无数据' }: Props) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '60px 20px',
      color: '#9090A0',
    }}>
      <div style={{ fontSize: '36px', marginBottom: '12px' }}>📊</div>
      <div style={{ fontSize: '14px' }}>{message}</div>
      <div style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>
        去B站看几个视频后回来查看数据分析
      </div>
    </div>
  );
}
