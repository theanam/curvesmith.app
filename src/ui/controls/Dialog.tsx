import * as D from '@radix-ui/react-dialog';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../icons';

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  /** Accessible description; visually hidden when `hideDescription`. */
  description?: string;
  hideDescription?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
  width?: number;
  className?: string;
  style?: CSSProperties;
  bodyClassName?: string;
};

/** App dialog built on Radix Dialog (focus trap, Esc, aria). Never use window.alert/confirm/prompt. */
export function Dialog(p: Props) {
  return (
    <D.Root open={p.open} onOpenChange={p.onOpenChange}>
      <D.Portal>
        <D.Overlay className="dialog-overlay" />
        <D.Content
          className={`dialog ${p.className ?? ''}`}
          style={{ ...(p.width ? { width: `min(${p.width}px, calc(100vw - 32px))` } : {}), ...p.style }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const root = e.currentTarget as HTMLElement;
            const target =
              root.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, .btn-primary') ??
              root;
            target.focus({ preventScroll: true });
          }}
        >
          <div className="dialog-head">
            <D.Title className="dialog-title">{p.title}</D.Title>
            {p.headerExtra}
            <D.Close asChild>
              <button className="icon-btn" aria-label="Close" style={{ marginLeft: 'auto' }}>
                <Icon name="close" />
              </button>
            </D.Close>
          </div>
          {p.description ? (
            <D.Description
              className={p.hideDescription ? 'sr-only' : 'dialog-desc'}
              style={p.hideDescription ? undefined : { padding: '16px 20px 0' }}
            >
              {p.description}
            </D.Description>
          ) : (
            <D.Description className="sr-only">
              {typeof p.title === 'string' ? p.title : 'Dialog'}
            </D.Description>
          )}
          <div className={`dialog-body ${p.bodyClassName ?? ''}`}>{p.children}</div>
          {p.footer && <div className="dialog-foot">{p.footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
