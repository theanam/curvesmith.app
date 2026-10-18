import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './icons';
import { ISSUES_URL } from '../state/commands';

type Props = {
  /** Shown in the fallback ("The inspector hit a problem"). */
  region: string;
  children: ReactNode;
  /** Full-screen fallback for the app root. */
  full?: boolean;
  /** Reset the boundary when this value changes (e.g. the active document). */
  resetKey?: unknown;
};

type State = { error: Error | null; key: unknown };

/** Keeps a crash in one region from taking down the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.region}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const body = encodeURIComponent(
      `**Where:** ${this.props.region}\n\n**Error:** ${error.message}\n\n**Steps to reproduce:**\n1. `,
    );
    return (
      <div className={`crash ${this.props.full ? 'full' : ''}`} role="alert">
        <strong>The {this.props.region} hit a problem.</strong>
        <span className="muted">Your document is safe. Try again, or reload if it keeps happening.</span>
        <div className="row">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            <Icon name="reset" /> Try again
          </button>
          {this.props.full && (
            <button className="btn" onClick={() => location.reload()}>
              Reload
            </button>
          )}
          <a
            className="btn btn-ghost"
            href={`${ISSUES_URL}/new?title=${encodeURIComponent(error.message.slice(0, 80))}&body=${body}`}
            target="_blank"
            rel="noopener"
          >
            <Icon name="bug" /> Report
          </a>
        </div>
      </div>
    );
  }
}
