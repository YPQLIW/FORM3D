import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useAppStore } from '../../state/appStore';

interface Props {
  name: string;
  children: ReactNode;
}

/** 한 패널의 오류가 전체 프로그램을 멈추지 않도록 격리 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[FORM3D] ${this.props.name} 오류`, error, info.componentStack);
    useAppStore.getState().log('error', `${this.props.name} 영역 오류: ${error.message}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-[11px] text-red-300">
        <p className="font-semibold">{this.props.name} 영역에서 오류가 발생했습니다.</p>
        <p className="mt-1 break-all text-red-300/80">{this.state.error.message}</p>
        <button
          type="button"
          className="mt-2 rounded border border-red-400/50 px-2 py-0.5 hover:bg-red-500/20"
          onClick={() => this.setState({ error: null })}
        >
          다시 시도
        </button>
      </div>
    );
  }
}
