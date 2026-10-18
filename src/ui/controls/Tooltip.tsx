import * as T from '@radix-ui/react-tooltip';
import { useState, type ReactNode } from 'react';
import { formatShortcut } from '../../state/commands';

/**
 * Tooltip that opens on hover or keyboard focus. Focus that arrives programmatically
 * (a menu or popover handing focus back to its button) does not open it.
 */
export function Tip({
  label,
  shortcut,
  children,
  side = 'bottom',
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  return (
    <T.Root
      delayDuration={400}
      open={open}
      onOpenChange={(o) => {
        if (!o) return setOpen(false);
        const el = document.activeElement as HTMLElement | null;
        // Radix asks to open on focus too; allow it only for keyboard focus.
        const byFocus = el?.matches?.('[data-tip-trigger]') && !el.matches(':hover');
        setOpen(!byFocus || !!el?.matches(':focus-visible'));
      }}
    >
      <T.Trigger asChild data-tip-trigger="">
        {children}
      </T.Trigger>
      <T.Portal>
        <T.Content className="tooltip" side={side} sideOffset={6}>
          {label}
          {shortcut && (
            <span className="kbd">
              {shortcut.length === 1 || shortcut.startsWith('⇧') ? shortcut : formatShortcut(shortcut)}
            </span>
          )}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TipProvider = T.Provider;
