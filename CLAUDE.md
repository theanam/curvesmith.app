# CLAUDE.md: Curvesmith

Browser vector editor (curvesmith.app), static on GitHub Pages. Product spec: `docs/design/SPEC.md`; native format: `docs/CURVS_FORMAT.md`; approved mockups: `docs/design/mockups/`.

## Standing rules
- Commit author: anam.ahmed.a@gmail.com (set in repo git config). Commit only when asked; tests must pass first (`npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`).
- Every feature gets tests. Format adapters get golden round-trip tests (`tests/fixtures/<format>`).
- After a noticeable UI change run `npm run screenshot` (README images, tour images, og-image).
- New notable feature: add it to the first-run tour (`src/ui/tour/Tour.tsx`) and Help page.
- UI copy is short, icons where icons are conventional, never "this, not that" phrasing. No emoji.
- Never use window.alert/confirm/prompt: use `src/ui/controls/Dialog.tsx` (Radix).
- Tokens only (`src/styles/tokens.css`), both themes. One accent: Volt.
- Every region sits in an `ErrorBoundary`.
- Google Analytics is injected only when `GA_ID` is set (only the Pages deploy sets it from the repo variable).
- Dev server port 5186.

## Layout
`src/core` model/geometry/history (no DOM) · `src/render` canvas renderer, overlays, hit-testing · `src/tools` one module per tool · `src/formats` adapters behind `registry.ts` · `src/fonts` Google Fonts catalog/loader/outlines · `src/state` store, commands, files, persistence · `src/ui` React shell.
