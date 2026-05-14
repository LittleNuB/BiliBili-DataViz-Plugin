import { Component } from 'preact';

interface Props {
  children: preact.ComponentChildren;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  componentDidCatch(error: Error) {
    this.setState({ hasError: true, error: error.message });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#FF6B6B',
        }}>
          <div style={{ fontSize: '14px' }}>渲染错误: {this.state.error}</div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: '12px',
              padding: '8px 20px',
              background: '#FB7299',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
