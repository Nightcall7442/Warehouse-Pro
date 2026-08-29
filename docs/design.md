# Warehouse Pro — Design System v2

## 1. Objective

Combine neumorphic depth with skeuomorphic materiality. The UI should feel like a physical control panel — leather-trimmed sidebar, brushed-metal KPI gauges, inset buttons with realistic press travel, paper-textured data cards. Not a flat SaaS dashboard — a *tool* that lives on a desk.

**Style DNA:** Neumorphism provides the soft shadow system (raised/pressed states). Skeuomorphism adds material textures, realistic lighting, and physical metaphors. Together: a dashboard that feels *manufactured*, not *generated*.

**Non-goals:** flat design, glassmorphism, cartoonish skeuomorphism (no wood-grain tables or 3D-rendered screws).

---

## 2. Product Context

**What:** Multi-tenant warehouse management SaaS — orders, inventory, agents, analytics, billing.
**Who:** CEO, operators, field agents, supervisors, merchandisers, couriers. Uzbekistan market, Russian UI.
**Usage pattern:** Daily operational tool. 90% of time: order list, product catalog, stock levels.
**Devices:** Desktop-first (CEO/operator), mobile-responsive (agent in field). PWA with offline order creation.

---

## 3. Visual Foundations

### 3.1 Color Palette

**Light theme:**

| Token | Value | Role |
|-------|-------|------|
| `--color-canvas` | `#e8e4de` | Warm linen background — like a desk surface |
| `--color-canvas-alt` | `#e0dbd4` | Slightly darker variant for alternating sections |
| `--color-surface` | `#f0ece6` | Card background — bleached paper feel |
| `--color-surface-raised` | `#f5f1eb` | Elevated panels, dropdowns |
| `--color-surface-inset` | `#ddd8d0` | Inset areas (pressed buttons, input fields) |
| `--color-border` | `#d4cfc6` | Subtle border — like a pressed seam |
| `--color-border-strong` | `#b8b2a6` | Emphasized borders, bevels |
| `--color-primary` | `#0d9488` | Teal-600 — the brand accent |
| `--color-primary-hover` | `#0f766e` | Teal-700 |
| `--color-primary-subtle` | `rgba(13,148,136,0.10)` | Tinted backgrounds |
| `--color-success` | `#16a34a` | Green-600 — stock available, completed |
| `--color-warning` | `#d97706` | Amber-600 — low stock, pending |
| `--color-danger` | `#dc2626` | Red-600 — errors, out of stock |
| `--color-info` | `#0284c7` | Sky-600 — informational |

**Dark theme:**

| Token | Value | Role |
|-------|-------|------|
| `--color-canvas` | `#171412` | Deep espresso — warm dark, not cold black |
| `--color-surface` | `#211e1a` | Dark leather surface |
| `--color-surface-raised` | `#2a2620` | Elevated dark panels |
| `--color-primary` | `#2dd4bf` | Teal-400 — brighter for dark bg |
| `--color-success` | `#4ade80` | Green-400 |
| `--color-warning` | `#fbbf24` | Amber-400 |
| `--color-danger` | `#f87171` | Red-400 |

### 3.2 Typography

| Role | Font | Weight | Size | Line-height | Notes |
|------|------|--------|------|-------------|-------|
| Display / H1 | Inter | 700 | 32px | 1.2 | Embossed effect via text-shadow |
| H2 | Inter | 600 | 24px | 1.3 | |
| H3 | Inter | 600 | 18px | 1.4 | |
| Body | Inter | 400 | 14px | 1.6 | |
| Body emphasis | Inter | 500 | 14px | 1.6 | |
| Caption / label | Inter | 500 | 12px | 1.4 | Uppercase, letter-spacing +0.5px |
| Data / numbers | JetBrains Mono | 500 | 14px | 1.4 | Tabular figures |
| Code / IDs | JetBrains Mono | 400 | 12px | 1.4 | |

**Embossed headings (skeuomorphic touch):**
```css
h1, h2, h3 {
  text-shadow: 0 1px 0 rgba(255,255,255,0.6), 0 -1px 0 rgba(0,0,0,0.1);
}
```

### 3.3 Spacing Scale

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64` — 4px base.

- Page padding: 24px (desktop), 16px (mobile)
- Card padding: 20px
- Card gap: 16px
- Section gap: 32px

### 3.4 Border Radius

| Element | Radius |
|---------|--------|
| Cards, panels | `12px` |
| Buttons, inputs | `8px` |
| Small chips, tags | `6px` |
| Avatars, icon buttons | `9999px` |

### 3.5 Shadows — Neumorphic + Skeuomorphic

**Core shadow system (neumorphic base):**
```css
--shadow-raised:  5px 5px 14px rgba(140,130,115,0.30), -5px -5px 14px rgba(255,255,255,0.50);
--shadow-pressed: inset 3px 3px 8px rgba(140,130,115,0.25), inset -3px -3px 8px rgba(255,255,255,0.40);
--shadow-sm:      2px 2px 6px rgba(140,130,115,0.20), -2px -2px 6px rgba(255,255,255,0.40);
--shadow-md:      6px 6px 18px rgba(140,130,115,0.28), -6px -6px 18px rgba(255,255,255,0.45);
--shadow-lg:      10px 10px 28px rgba(140,130,115,0.32), -10px -10px 28px rgba(255,255,255,0.40);
```

**Skeuomorphic layer — inner bevel on cards:**
```css
.card {
  box-shadow: var(--shadow-raised);
  border: 1px solid rgba(255,255,255,0.30); /* top-left bevel highlight */
  border-bottom-color: rgba(0,0,0,0.06);    /* bottom-right bevel shadow */
}
```

**Skeuomorphic layer — inset elements (inputs, pressed buttons):**
```css
.inset {
  box-shadow: var(--shadow-pressed);
  border: 1px solid rgba(0,0,0,0.08);
  border-top-color: rgba(0,0,0,0.12);
  background: var(--color-surface-inset);
}
```

### 3.6 Materials & Textures

**Sidebar — brushed leather:**
```css
.sidebar {
  background: linear-gradient(180deg, #2a2520 0%, #221e1a 100%);
  border-right: 1px solid rgba(255,255,255,0.06);
  box-shadow: inset -1px 0 0 rgba(0,0,0,0.20), 2px 0 8px rgba(0,0,0,0.15);
  /* Subtle noise texture via SVG filter */
  background-image: url("data:image/svg+xml,..."); /* 2% noise overlay */
}
```

**KPI cards — brushed metal accent strip:**
```css
.kpi-card {
  position: relative;
  overflow: hidden;
}
.kpi-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover));
  /* Brushed metal: horizontal micro-lines */
  background-image: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 1px,
    rgba(255,255,255,0.08) 1px,
    rgba(255,255,255,0.08) 2px
  );
}
```

**Buttons — physical press states:**
```css
.btn-default {
  box-shadow: var(--shadow-sm);
  border: 1px solid rgba(255,255,255,0.25);
  border-bottom-color: rgba(0,0,0,0.08);
  transition: box-shadow 0.1s ease, transform 0.1s ease;
}
.btn-default:active {
  box-shadow: var(--shadow-pressed);
  transform: translateY(1px); /* physical press travel */
}
```

**Status indicator LEDs:**
```css
.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.3), 0 0 4px currentColor;
  /* Glowing LED effect */
}
```

---

## 4. Accessibility

- **Contrast:** WCAG AA (4.5:1 body, 3:1 large text). Embossed text uses shadow, not color reduction.
- **Focus:** `2px solid var(--color-primary)` with `2px` offset. Visible on both light and dark surfaces.
- **Touch targets:** 44x44px mobile minimum. Desktop buttons: 36px min height.
- **Color independence:** Status uses icon + text + LED dot. Never color alone.
- **Reduced motion:** `prefers-reduced-motion` disables press animations and shadow transitions.

---

## 5. Voice & Tone

- **Language:** Russian. Direct, operational. "Заказ создан" not "Ваш заказ успешно оформлен."
- **Errors:** Specific. "Недостаточно товара (доступно: 5)" not "Ошибка."
- **Empty states:** Guide. "Пока нет заказов. Создайте первый заказ."
- **Numbers:** `1 250 000 сум` (spaces, symbol after).

---

## 6. Component Specifications

### 6.1 Tables

**Structure:** Skeuomorphic data table with inset header, raised rows.

```
┌─────────────────────────────────────────────┐
│ ╔═══════════════════════════════════════════╗│  ← Inset header (pressed-in)
│ ║ №  │ Заказ    │ Магазин  │ Сумма  │ Статус║│
│ ╠═══════════════════════════════════════════╣│
│ ║ 1  │ ORD-001  │ Shop A   │ 12,000 │ ✓    ║│  ← Raised row (neumorphic)
│ ║ 2  │ ORD-002  │ Shop B   │  8,500 │ ○    ║│  ← Alternating bg (subtle)
│ ║ 3  │ ORD-003  │ Shop C   │ 23,100 │ ✓    ║│
│ ╚═══════════════════════════════════════════╝│
│ Страница 1 из 12              ← 1 2 3 ... → │  ← Pagination bar
└─────────────────────────────────────────────┘
```

- **Header:** Inset shadow, slightly darker bg (`--color-surface-inset`), uppercase labels
- **Rows:** Raised shadow on hover, 1px bottom border as separator
- **Zebra:** Alternating rows with 2% opacity difference
- **Sticky header:** Stays visible on scroll
- **Row hover:** Subtle lift (shadow intensifies), cursor pointer
- **Compact mode:** 32px row height for dense data views

### 6.2 KPI Cards

**Structure:** Metal-gauge inspired. Top accent strip + inset value area.

```
┌──────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ← 4px teal accent strip (brushed metal)
│                              │
│  📦  Заказы                  │  ← Icon (neumorphic circle) + label
│      1 247                   │  ← Large value (embossed)
│      ↑ 12% к прошлому мес.   │  ← Trend arrow + comparison
│                              │
│  ▁▂▃▅▆▇  sparkline           │  ← 7-day sparkline
└──────────────────────────────┘
```

- **Icon:** Neumorphic circle (raised), teal-tinted background
- **Value:** Large (28px), embossed text-shadow, monospace numbers
- **Trend:** Green up-arrow / red down-arrow + percentage
- **Sparkline:** Mini area chart, 7-day period, teal fill with 10% opacity
- **Grid:** 4 columns desktop, 2 tablet, 1 mobile

### 6.3 Charts

**Style:** Skeuomorphic chart area with inset grid, raised data points.

- **Background:** Inset panel with subtle grid lines
- **Lines/Bars:** Solid fill, no gradients. Teal primary, muted secondaries.
- **Data points:** Raised dots with shadow (not flat circles)
- **Tooltip:** Raised card (neumorphic), appears on hover, shows exact value
- **Legend:** Horizontal, below chart, icon + label style
- **Axis labels:** Monospace, muted color

### 6.4 Status Badges

**Style:** Physical LED indicators + embossed pill badges.

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ ● Новый │  │ ● В обр.│  │ ✓ Готов │  │ ✕ Отм. │
└─────────┘  └─────────┘  └─────────┘  └─────────┘
  (blue)       (amber)      (green)      (red)
```

- **Shape:** Rounded pill (`border-radius: 9999px`)
- **LED dot:** 8px circle with inner shadow + outer glow matching status color
- **Background:** 10% tint of status color
- **Text:** 12px, 500 weight, status color
- **States:** `new` = blue, `processing` = amber, `completed` = green, `cancelled` = red

### 6.5 Forms

**Style:** Inset fields with realistic depth. Physical input feel.

```
┌──────────────────────────────────────┐
│ Название                             │  ← Label (uppercase, embossed)
│ ┌──────────────────────────────────┐ │
│ │                                  │ │  ← Inset input field
│ │  Введите название...             │ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Категория                            │
│ ┌──────────────────────────────────┐ │
│ │ ▼ Выберите категорию             │ │  ← Inset select
│ └──────────────────────────────────┘ │
│                                      │
│      [ Сохранить ]  [ Отмена ]       │  ← Raised primary + ghost secondary
└──────────────────────────────────────┘
```

- **Input fields:** Inset shadow, `--color-surface-inset` bg, 1px inner border
- **Focus state:** Teal ring glow, inset shadow intensifies slightly
- **Error state:** Red border-bottom, error message below field in red
- **Labels:** Uppercase, 12px, embossed, letter-spacing +0.5px
- **Primary button:** Raised shadow, teal bg, physical press (translateY + shadow-pressed)
- **Secondary button:** Raised shadow, transparent bg, subtle border
- **Disabled:** Flatten shadow to 0, reduce opacity to 0.5

---

## 7. Anti-Patterns

| Pattern | Why it's banned |
|---------|----------------|
| Gradient hero sections | Tool, not marketing page |
| Emoji in headings | Unprofessional for warehouse ops |
| Skeleton loaders everywhere | Only for initial page load |
| Floating action buttons | Desktop — actions in toolbars |
| Confetti animations | Warehouse ops, not a game |
| Infinite scroll on tables | Pagination — operators need page numbers |
| Tooltip-only info | Show it; tooltips are supplements |
| Excessive texture | Skeuomorphic, not cartoonish. No wood grain, no 3D screws. |

---

## 8. Decision-Making

1. **Clarity** — state understood in <2 seconds
2. **Efficiency** — minimum clicks to complete task
3. **Consistency** — same element = same behavior everywhere
4. **Physicality** — does it feel like a real object?
5. **Aesthetics** — last priority

---

## 9. Workflow

1. `index.css` — palette, typography, shadow system, material textures
2. `tailwind.config.js` — font families, radius, shadow tokens
3. `src/components/ui/` — extend shadcn components with skeuomorphic styles
4. Layout — sidebar (leather), header (metal), content shell
5. Shared components — KPI cards, status badges, data tables
6. Pages — Dashboard first, then Orders, Products, Warehouse
7. Dark mode at each step
8. Mobile responsiveness last
