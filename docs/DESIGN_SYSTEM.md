# UX Audit design system

## Foundation
UX Audit uses a shared, dark, shadcn/ui-inspired visual foundation across its main dashboard, IA discovery, page audit, benchmarking, Past Findings, coaching and model/cost views.

- Background: `--ds-bg` (#0a0d13)
- Sidebar: `--ds-sidebar` (#0c1119)
- Surface: `--ds-panel` (#111823), raised surface `--ds-panel-2` (#151e2b)
- Text: `--ds-text` (#e8edf5), supporting text `--ds-muted` (#9aa7b9)
- Accent: `--ds-accent` (#a78bfa), with green reserved for connected/success states.
- Radius: `--ds-radius` (13px); consistent 8px-based spacing and visible keyboard focus.

## Shared shell
`app/product-shell.tsx` owns persistent navigation, active-page state, page breadcrumbs and the OpenRouter connection indicator. Embedded mode hides the shell chrome, but keeps the same design tokens and component styling.

## Reusable components
Import from `app/ui.tsx`:
- `Button`: primary, secondary, ghost and danger variants; small/medium/large sizes.
- `Badge`: neutral, success, warning, danger and accent tones.
- `Card`: shared bordered surface and radius.
- `PageHeading`: eyebrow, title, description and page actions.
- `TextField`: label, validation, and supporting text.
- `EmptyState`: consistent no-data and recovery states.

## Implementation rules
1. Use the shared shell for page-level navigation; inner screens should not create a second application sidebar.
2. Prefer shared components and `--ds-*` tokens over per-page hex values.
3. Preserve legible muted text, a strong focus ring, responsive layouts and reduced-motion support.
4. Green is for confirmed success/connection, amber for warnings, and rose for errors. Purple is the primary action/accent, not a severity signal.
5. Keep screenshot evidence itself unmodified; dark mode styles the audit workspace around the captured website, not the captured website image.
