import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Select from '@radix-ui/react-select';
import type { FontRef } from '../../core/types';
import {
  BUNDLED_FONTS,
  CATEGORY_LABEL,
  FONT_CATEGORIES,
  familyToId,
  filterFonts,
  findFont,
  loadCatalog,
  loadedCatalog,
  nearestWeight,
  previewCssUrl,
  styleLabel,
  type CatalogFont,
  type FontCategoryId,
} from '../../fonts/catalog';
import { ensureFont } from '../../fonts/loader';
import { pushRecentFont, readRecentFonts } from './recent';
import './FontPicker.css';

export type FontPickerProps = {
  value: FontRef;
  onChange(font: FontRef): void;
  /** Families used in the open document; adds an "In this document" filter. */
  documentFonts?: string[];
};

export const ROW_HEIGHT = 36;
const VIEW_HEIGHT = ROW_HEIGHT * 8;
const OVERSCAN = 4;

/* ---------- shared helpers ---------- */

const linked = new Set<string>();
/** Inject a stylesheet once per URL. */
export function loadStylesheet(href: string) {
  if (typeof document === 'undefined' || linked.has(href)) return;
  linked.add(href);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.crossOrigin = 'anonymous';
  document.head.appendChild(l);
}

/** Load the glyphs of a family's own name so its row can be set in its face. Bundled faces need nothing. */
function loadPreview(entry: CatalogFont) {
  if (entry.bundled || entry.local) return;
  loadStylesheet(previewCssUrl(entry));
}

const faceStyle = (family: string) => ({ fontFamily: `"${family.replace(/"/g, '')}", var(--font-ui)` });

const synthetic = (family: string, weight = 400): CatalogFont => ({
  id: familyToId(family),
  family,
  category: 'sans',
  weights: [weight],
  italic: false,
  local: true,
});

function useCatalog(): CatalogFont[] {
  const [list, setList] = useState<CatalogFont[]>(() => loadedCatalog() ?? BUNDLED_FONTS);
  useEffect(() => {
    let live = true;
    void loadCatalog().then((l) => {
      if (live) setList(l);
    });
    return () => {
      live = false;
    };
  }, []);
  return list;
}

const Chevron = () => (
  <svg className="cs-fp-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 10l5 5 5-5" />
  </svg>
);
const Check = () => (
  <svg className="cs-fp-icon cs-fp-check" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const SearchIcon = () => (
  <svg className="cs-fp-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </svg>
);

/** The font a family switch produces: nearest weight, italic kept where the family has it. */
function fontFor(entry: CatalogFont, current: FontRef): FontRef {
  return {
    family: entry.family,
    weight: nearestWeight(entry.weights, current.weight),
    style: current.style === 'italic' && entry.italic ? 'italic' : 'normal',
  };
}

/* ---------- family popover ---------- */

type Item = { entry: CatalogFont; recent: boolean };

function FamilyList({
  list,
  value,
  documentFonts,
  onPick,
  onClose,
}: {
  list: CatalogFont[];
  value: FontRef;
  documentFonts?: string[];
  onPick(entry: CatalogFont): void;
  onClose(): void;
}) {
  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<FontCategoryId>('all');
  const [recent] = useState(readRecentFonts);
  const [scrollTop, setScrollTop] = useState(0);

  // Families the catalogue lacks (uploaded or unknown) still show up when the document uses them.
  const all = useMemo(() => {
    const extra = [...new Set([value.family, ...(documentFonts ?? [])])]
      .filter((f) => f && !findFont(list, f))
      .map((f) => synthetic(f));
    return [...list, ...extra];
  }, [list, value.family, documentFonts]);

  const items = useMemo<Item[]>(() => {
    const found = filterFonts(all, query, cat, documentFonts);
    if (query.trim() || cat !== 'all' || !recent.length)
      return found.map((entry) => ({ entry, recent: false }));
    const recents = recent.map((f) => findFont(all, f)).filter((e): e is CatalogFont => !!e);
    const seen = new Set(recents.map((e) => e.family));
    return [
      ...recents.map((entry) => ({ entry, recent: true })),
      ...found.filter((e) => !seen.has(e.family)).map((entry) => ({ entry, recent: false })),
    ];
  }, [all, query, cat, documentFonts, recent]);

  const [highlight, setHighlight] = useState(() =>
    Math.max(
      0,
      items.findIndex((i) => i.entry.family === value.family),
    ),
  );

  const scrollTo = (top: number) => {
    const max = Math.max(0, items.length * ROW_HEIGHT - VIEW_HEIGHT);
    const t = Math.max(0, Math.min(max, top));
    if (listRef.current) listRef.current.scrollTop = t;
    setScrollTop(t);
  };
  const reveal = (i: number) => {
    const top = i * ROW_HEIGHT;
    if (top < scrollTop) scrollTo(top);
    else if (top + ROW_HEIGHT > scrollTop + VIEW_HEIGHT) scrollTo(top + ROW_HEIGHT - VIEW_HEIGHT);
  };

  // Open on the current family.
  useEffect(() => {
    inputRef.current?.focus();
    if (highlight > 0) scrollTo(highlight * ROW_HEIGHT - VIEW_HEIGHT / 2 + ROW_HEIGHT / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + VIEW_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visible = items.slice(first, last);

  useEffect(() => {
    visible.forEach((i) => loadPreview(i.entry));
  });

  const reset = () => {
    setHighlight(0);
    scrollTo(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const next =
        e.key === 'ArrowDown' ? Math.min(items.length - 1, highlight + 1) : Math.max(0, highlight - 1);
      setHighlight(next);
      reveal(next);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (!items.length) return;
      const step = Math.floor(VIEW_HEIGHT / ROW_HEIGHT) - 1;
      const next = Math.max(0, Math.min(items.length - 1, highlight + (e.key === 'PageDown' ? step : -step)));
      setHighlight(next);
      reveal(next);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[Math.min(highlight, items.length - 1)];
      if (it) onPick(it.entry);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const cats = FONT_CATEGORIES.filter((c) => c.id !== 'document' || (documentFonts?.length ?? 0) > 0);
  const listId = `${baseId}-list`;
  const optId = (i: number) => `${baseId}-opt-${i}`;
  const active = items.length ? Math.min(highlight, items.length - 1) : -1;

  return (
    <div className="cs-fp-panel">
      <label className="cs-fp-search">
        <SearchIcon />
        <input
          ref={inputRef}
          autoFocus
          type="text"
          role="combobox"
          aria-label="Search fonts"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optId(active) : undefined}
          placeholder={`Search ${list.length.toLocaleString('en-US')} fonts`}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            reset();
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className="cs-fp-chips" role="group" aria-label="Font category">
        {cats.map((c) => (
          <button
            key={c.id}
            type="button"
            className="cs-fp-chip"
            aria-pressed={cat === c.id}
            onClick={() => {
              setCat(c.id);
              reset();
              inputRef.current?.focus();
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div
        ref={listRef}
        id={listId}
        className="cs-fp-list"
        role="listbox"
        aria-label="Fonts"
        tabIndex={-1}
        style={{ height: Math.min(VIEW_HEIGHT, Math.max(items.length, 1) * ROW_HEIGHT) }}
        onScroll={(e) => {
          const t = e.currentTarget.scrollTop;
          if (Math.abs(t - scrollTop) >= ROW_HEIGHT / 2) setScrollTop(t);
        }}
      >
        {items.length ? (
          <div className="cs-fp-sizer" style={{ height: items.length * ROW_HEIGHT }}>
            {visible.map((it, k) => {
              const i = first + k;
              const selected = it.entry.family === value.family;
              return (
                <div
                  key={`${it.recent ? 'r' : 'f'}-${it.entry.family}`}
                  id={optId(i)}
                  role="option"
                  aria-selected={selected}
                  data-highlighted={i === active ? '' : undefined}
                  className="cs-fp-row"
                  style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                  onMouseMove={() => i !== highlight && setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(it.entry)}
                >
                  <span className="cs-fp-name" style={faceStyle(it.entry.family)}>
                    {it.entry.family}
                  </span>
                  {selected ? (
                    <Check />
                  ) : (
                    <span className="cs-fp-meta">
                      {it.recent ? 'Recent' : CATEGORY_LABEL[it.entry.category]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="cs-fp-empty">No fonts found</div>
        )}
      </div>
    </div>
  );
}

/** The family field: a trigger set in the current face, opening a searchable list of every font. */
export function FontFamilyPicker({ value, onChange, documentFonts }: FontPickerProps) {
  const list = useCatalog();
  const [open, setOpen] = useState(false);
  const entry = findFont(list, value.family);

  useEffect(() => {
    if (entry) loadPreview(entry);
  }, [entry]);

  const pick = (e: CatalogFont) => {
    const font = fontFor(e, value);
    pushRecentFont(e.family);
    setOpen(false);
    void ensureFont(font);
    onChange(font);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="cs-fp-field cs-fp-trigger"
          aria-label={`Font family, ${value.family}`}
        >
          <span className="cs-fp-value" style={faceStyle(value.family)}>
            {value.family}
          </span>
          <Chevron />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="cs-fp-pop"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          aria-label="Choose font"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <FamilyList
            list={list}
            value={value}
            documentFonts={documentFonts}
            onPick={pick}
            onClose={() => setOpen(false)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Weight and style options for a family, e.g. Regular, Italic, Bold, Bold Italic. */
export function styleOptions(
  entry: CatalogFont,
): { value: string; label: string; weight: number; style: 'normal' | 'italic' }[] {
  const out: { value: string; label: string; weight: number; style: 'normal' | 'italic' }[] = [];
  for (const w of entry.weights) {
    out.push({ value: `${w}-normal`, label: styleLabel(w, 'normal'), weight: w, style: 'normal' });
    if (entry.italic)
      out.push({ value: `${w}-italic`, label: styleLabel(w, 'italic'), weight: w, style: 'italic' });
  }
  return out;
}

/** The weight/style field for the current family. */
export function FontStylePicker({ value, onChange }: Omit<FontPickerProps, 'documentFonts'>) {
  const list = useCatalog();
  const entry = findFont(list, value.family) ?? synthetic(value.family, value.weight);
  const options = styleOptions(entry);
  const weight = nearestWeight(entry.weights, value.weight);
  const style = value.style === 'italic' && entry.italic ? 'italic' : 'normal';
  const current = `${weight}-${style}`;

  return (
    <Select.Root
      value={current}
      onValueChange={(v) => {
        const o = options.find((x) => x.value === v);
        if (!o) return;
        const font: FontRef = { family: value.family, weight: o.weight, style: o.style };
        void ensureFont(font);
        onChange(font);
      }}
    >
      <Select.Trigger className="cs-fp-field cs-fp-style" aria-label="Font style">
        <span className="cs-fp-value">
          <Select.Value>{styleLabel(weight, style)}</Select.Value>
        </span>
        <Select.Icon className="cs-fp-icon-wrap">
          <Chevron />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="cs-fp-pop cs-fp-select"
          position="popper"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <Select.Viewport className="cs-fp-select-viewport">
            {options.map((o) => (
              <Select.Item key={o.value} value={o.value} className="cs-fp-select-item">
                <Select.ItemText>
                  <span style={{ fontWeight: o.weight, fontStyle: o.style }}>{o.label}</span>
                </Select.ItemText>
                <Select.ItemIndicator className="cs-fp-select-indicator">
                  <Check />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

/** Family and weight/style fields, stacked, for the inspector's Text section. */
export function FontPicker(props: FontPickerProps) {
  return (
    <div className="cs-fp">
      <FontFamilyPicker {...props} />
      <FontStylePicker value={props.value} onChange={props.onChange} />
    </div>
  );
}

export default FontPicker;
