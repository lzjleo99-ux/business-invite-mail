import { Component, type ReactNode } from 'react';

/**
 * 渲染错误边界：子组件抛异常时显示错误详情而不是白屏。
 * 背景：用户（Kayode/Chrome）曾遇到 Settings 页整页白屏且无法复现，
 * 没有错误信息就无法定位——让错误自己显示出来是第一步。
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // 打到 console，便于远程排查
    console.error('[ErrorBoundary]', this.props.label ?? '', error.message, info.componentStack?.slice(0, 500));
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-6 m-4 rounded-lg border border-red-200 bg-red-50 text-red-800 space-y-3">
          <p className="font-semibold">页面渲染出错（{this.props.label ?? 'unknown'}）</p>
          <pre className="text-xs whitespace-pre-wrap bg-white/70 p-2 rounded max-h-48 overflow-auto">
            {this.state.error.message}
            {'\n'}
            {this.state.error.stack?.slice(0, 800)}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-red-600 text-white text-sm"
              onClick={() => this.setState({ error: null })}
            >
              重试 / Retry
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded border border-red-300 text-sm"
              onClick={() => { window.location.replace('/'); }}
            >
              回首页 / Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
