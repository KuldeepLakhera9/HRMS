# DESIGN SYSTEM: AIC-ADT Green Innovation (single source of truth for all UI)

Brand source: "AIC-ADT Professional Brand Theme" supplied by the client. Direction: **Clean, Premium, Institutional, Modern, Innovation-focused**. Modern SaaS dashboard with an agricultural/innovation identity. Logo colors are the core identity: `#004B2A` + `#73992A`.
Applies to: web (`apps/web`), mobile (`apps/mobile`), emails, PDFs (payslips later). Tokens live in ONE package, `packages/ui-tokens`, exported as CSS variables (web) and a typed TS object (mobile). No component may contain a hard-coded hex color.

## 1. Rules of use
1. **60-30-10**: 60% white / very light neutral, 30% deep green, 10% leaf green. The app must NOT become "all green".
2. White content area, deep-forest sidebar, leaf green only for active states and highlights, deep green for primary actions and headings.
3. Status colors (green/amber/red) change **only the status indicator** (dot, chip, icon), never the whole card or page.
4. Never rely on color alone: every status has an icon and a text label.
5. Do not use leaf green `#73992A` for small body text or links (contrast about 3.3:1 on white). Use deep green `#004B2A` for text and links.
6. Everything is token-driven so a company can later override branding (logo, name, colors) through `companies.settings.branding` without code changes. Phase 3 ships the AIC-ADT default only.
7. Light theme only for now. The brand supplies no dark palette, so hide the dark-mode toggle behind a feature flag (`ui.darkMode=false`) until a dark palette is approved. Keep the token structure ready for it.

## 2. Color tokens
| Token | Hex | Usage |
|---|---|---|
| `--brand-primary` | `#004B2A` | AIC Deep Green: primary buttons, headings, links, navbar accents |
| `--brand-secondary` | `#73992A` | AIC Leaf Green: accent, highlights, active states, focus ring |
| `--brand-dark` | `#063D27` | Dark Forest: sidebar, dark sections |
| `--brand-hover` | `#00643A` | Primary hover / interactive |
| `--brand-light` | `#E8F0D9` | Selected rows/cards, icon containers, secondary button background |
| `--brand-soft` | `#F3F7EC` | Subtle sections, table headers |
| `--background` | `#F8FAF7` | Application background (Off White) |
| `--surface` | `#FFFFFF` | Cards, popovers, inputs |
| `--text-primary` | `#17231D` | Main text |
| `--text-secondary` | `#647067` | Secondary text |
| `--border` | `#DDE5DC` | Borders and dividers |
| `--success` | `#2E7D32` | Inside geofence, approved, present |
| `--warning` | `#C58B00` | Location warning, pending, late (never as small text) |
| `--danger` | `#C62828` | Outside geofence, rejected, absent, destructive |
| Sidebar text | `#E8EEE9` | Normal nav text |
| Sidebar icon | `#C7D7C5` | Normal nav icon |

### Derived tokens (proposals, to be approved by the design owner)
| Token | Value | Usage |
|---|---|---|
| `--chart-1..6` | `#004B2A`, `#73992A`, `#A9C46C`, `#00643A`, `#647067`, `#B8C4B6` | Green-based charts with neutral support. Vary lightness so series stay distinguishable; add labels/patterns, never color alone |
| `--status-present-bg/fg` | `#E3F1E4` / `#1F5E23` | Present chip |
| `--status-absent-bg/fg` | `#FBE6E6` / `#8E1B1B` | Absent chip |
| `--status-late-bg/fg` | `#FBF0D5` / `#7A5600` | Late / pending chip |
| `--status-leave-bg/fg` | `#E8F0D9` / `#004B2A` | Leave chip |
| `--status-holiday-bg/fg` | `#EEF1ED` / `#3F4A43` | Holiday chip |
| `--status-weekoff-bg/fg` | `#F3F4F2` / `#647067` | Weekly off chip |
| `--status-od-bg/fg` | `#FFFFFF` / `#004B2A` with 1px `#004B2A` border | On duty / WFH |
| `--nav-hover-bg` | `rgba(115,153,42,0.22)` | Sidebar hover (interpretation: the brief lists leaf green for hover; a translucent tint keeps hover distinct from active) |

### shadcn/ui variable mapping (adapt to the Tailwind version in the repo)
```css
:root {
  --brand-primary:#004B2A; --brand-secondary:#73992A; --brand-dark:#063D27; --brand-hover:#00643A;
  --brand-light:#E8F0D9; --brand-soft:#F3F7EC;
  --background:#F8FAF7; --surface:#FFFFFF; --text-primary:#17231D; --text-secondary:#647067; --border:#DDE5DC;
  --success:#2E7D32; --warning:#C58B00; --danger:#C62828;

  /* shadcn semantic names */
  --foreground:var(--text-primary);
  --card:var(--surface);            --card-foreground:var(--text-primary);
  --popover:var(--surface);         --popover-foreground:var(--text-primary);
  --primary:var(--brand-primary);   --primary-foreground:#FFFFFF;
  --secondary:var(--brand-light);   --secondary-foreground:var(--brand-primary);
  --muted:var(--brand-soft);        --muted-foreground:var(--text-secondary);
  --accent:var(--brand-soft);       --accent-foreground:var(--brand-primary);
  --destructive:var(--danger);      --destructive-foreground:#FFFFFF;
  --input:var(--border);            --ring:var(--brand-secondary);

  --sidebar:var(--brand-dark);      --sidebar-foreground:#E8EEE9;
  --sidebar-primary:var(--brand-secondary); --sidebar-primary-foreground:#FFFFFF;
  --sidebar-accent:rgba(115,153,42,0.22);   --sidebar-accent-foreground:#FFFFFF;
  --sidebar-border:rgba(255,255,255,0.08);  --sidebar-ring:var(--brand-secondary);

  --radius-card:14px; --radius-modal:16px; --radius-control:8px; --radius-badge:999px;
  --shadow-card:0 4px 20px rgba(0,75,42,0.06);
}
```

## 3. Typography
**Inter**, self-hosted through `next/font` (no external font request: faster and works inside your network). Weights 400, 500, 600, 700 only. Use `font-variant-numeric: tabular-nums` for numbers, tables and statistics.
| Element | Spec |
|---|---|
| Page heading (Dashboard) | 32px / 700 |
| Section heading | 20px / 600 |
| Card label (Total Employees) | 14px / 500 |
| Statistic number (248) | 30px / 700 |
| Body | 14-16px / 400 |
| Buttons | 14px / 500-600 |
| Navigation | 14px / 500 |
Mobile uses Inter via `expo-font` with the same scale (slightly reduced headings).

## 4. Shape, shadow, icons, motion
- Radius: cards 14px, buttons 8px, inputs 8px, modals 16px, badges 999px. Avoid `rounded-full` except avatars and badges.
- Shadow: only `--shadow-card`. No heavy black shadows.
- Icons: **Lucide**, stroke 1.75, 16/18/20px. Icon containers use `--brand-light` background with `--brand-primary` icon.
- Motion: 150-200 ms ease-out, opacity/transform only (GPU friendly). Respect `prefers-reduced-motion`. No decorative animation on data-heavy screens.

## 5. Components
**Sidebar** (background `--brand-dark`): logo area "AIC-ADT / INCUBATION CENTRE" (use the supplied SVG logo when provided; text placeholder until then). Items: icon `#C7D7C5`, text `#E8EEE9`; hover `--nav-hover-bg`; **active = solid `#73992A` background, white text** (brand spec). Active item also gets `aria-current="page"`. Collapsible to icons with tooltips. Items come from permissions (Phase 1). Optional variant for stricter accessibility: `data-nav-active="tinted"` = 3px leaf-green left bar + `rgba(115,153,42,0.18)` background + white text (white on dark forest is about 12:1, white on solid leaf green is about 3.3:1). Implement the variant as a token switch; default is the brand spec.
**Top bar**: white surface, 1px `--border` bottom, page title/breadcrumbs, search trigger (Ctrl+K), notifications bell, profile menu. (Assumption: the brief's "navbar" in deep green is realized through brand accents; if the client wants a deep-green top bar, switch `--topbar-bg`.)
**Buttons**: Primary `--brand-primary` bg / white text, hover `--brand-hover`. Secondary `--brand-light` bg / `--brand-primary` text. Outline: 1px `--brand-primary` border, transparent bg. Ghost for tertiary. Destructive uses `--danger`. Focus ring 2px `--ring` with 2px offset. Loading state keeps width, shows spinner.
**Cards**: white, 1px `--border`, radius 14px, `--shadow-card`. Stat card: label (14/500, secondary), big number (30/700), trend line with arrow and text, icon container top right (`--brand-light`).
**Tables**: header `--brand-soft` with secondary text 12-13px/600 uppercase optional; row hover `#F8FAF7`; selected row `--brand-light`; sticky header; compact density option; row actions in a menu.
**Badges / status chips**: pill, tokens from section 2 (bg + fg), always icon + label.
**Inputs**: white, 1px `--border`, radius 8px, focus ring leaf green, error border `--danger` with message text and icon; helper text secondary.
**Dialogs/sheets**: radius 16px, overlay `rgba(23,35,29,0.45)`.
**Toasts**: white card, left color bar by type, icon + text.
**Skeletons**: `--brand-soft` base with a subtle shimmer (disabled under reduced motion). Every page shows skeletons within 100 ms.
**Empty states**: soft icon in `--brand-light` circle, one-line explanation, one primary action.
**Charts**: `--chart-*` palette, thin grid in `--border`, tooltips as small white cards, legends with labels, accessible table fallback for each chart.
**Calendar**: day cells use status chip tokens; today has a deep-green ring; weekly off/holiday cells are neutral; selected range uses `--brand-light`.
**Login**: split layout: deep-forest panel with logo and short tagline on the left, off-white background with the form card on the right; stacks on mobile.
**Geofence / attendance card** (web and mobile):
```
+-----------------------------------------+
| (pin) Attendance Location               |
|                                         |
|        (green dot) Inside Geofence      |
|  AIC-ADT Campus                         |
|  Distance: 42 meters                    |
|  (check) Location verified              |
|          [ Mark Attendance ]            |
+-----------------------------------------+
```
Only the status indicator changes: Inside = `--success`, Warning/borderline/low accuracy = `--warning`, Outside = `--danger`. The button stays deep green (disabled or "Request approval" when outside per policy). Map: geofence circle stroke `#73992A`, fill `rgba(115,153,42,0.15)`; user dot `#004B2A` with accuracy halo `rgba(0,75,42,0.12)`; outside state turns the dot and halo to danger.
**Emails / PDFs**: deep-green header strip with logo, Inter (or system fallback in email), off-white body, deep-green buttons.

## 6. Layout
App shell: fixed sidebar (240px, collapsed 72px), content max width 1440px with 24-32px padding, 8px spacing grid, cards in a responsive grid (4/2/1 columns). Mobile: bottom navigation for the 4 main areas and sheet menus.

## 7. Accessibility and verification
- WCAG 2.1 AA target. Approximate contrast on white/off-white: deep green about 10:1, text secondary about 5:1, success and danger above 5:1, **leaf green about 3.3:1 (OK for non-text UI such as focus rings, borders, icons; NOT for small text)**, **warning amber about 3:1 (indicator only; use the darker `--status-late-fg` for text)**. The agent must compute exact ratios in an automated test over all token pairs actually used (foreground/background), fail on pairs below 4.5:1 for text or 3:1 for UI components, and list documented exceptions (known: white text on solid leaf-green active nav item, about 3.3:1; mitigation: bold weight and the `tinted` variant switch).
- Visible focus on every interactive element, full keyboard operation, `aria-current`, labels, error association, touch targets at least 44px on mobile.
- Provide `/dev/design-system` (non-production) rendering every token, component and state. Playwright visual snapshots of this page guard against accidental theme drift.
- CI lint: fail on hex/rgb color literals outside `packages/ui-tokens` and the tokens CSS.
