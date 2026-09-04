/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* shadcn/radix compatibility */
        border:     "hsl(var(--border))",
        input:      "hsl(var(--input))",
        ring:       "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        /* Design tokens — single source of truth via CSS vars */
        canvas:          "var(--color-canvas)",
        surface:         "var(--color-surface)",
        "surface-light": "var(--color-surface-light)",
        "border-custom": "var(--color-border-custom)",
        "border-subtle": "var(--color-border-subtle)",

        "text-primary":   "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary":  "var(--color-text-tertiary)",
        "text-inverse":   "var(--color-text-inverse)",

        primary: {
          DEFAULT: "var(--color-primary)",
          hover:   "var(--color-primary-hover)",
          foreground: "hsl(var(--primary-foreground))",
        },

        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger:  "var(--color-danger)",
        info:    "var(--color-info)",

        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT:             "hsl(var(--sidebar-background))",
          foreground:          "hsl(var(--sidebar-foreground))",
          primary:             "hsl(var(--sidebar-primary))",
          "primary-foreground":"hsl(var(--sidebar-primary-foreground))",
          accent:              "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border:              "hsl(var(--sidebar-border))",
          ring:                "hsl(var(--sidebar-ring))",
        },
      },

      fontFamily: {
        display: ['"DM Sans"', 'system-ui', 'sans-serif'],
        body:    ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"DM Sans"', 'sans-serif'],
        nav:     ['"DM Sans"', 'system-ui', 'sans-serif'],
        data:    ['"DM Sans"', 'sans-serif'],
        label:   ['"DM Sans"', 'sans-serif'],
      },

      borderRadius: {
        xl:  "calc(var(--radius) + 4px)",
        lg:  "var(--radius)",
        md:  "calc(var(--radius) - 2px)",
        sm:  "calc(var(--radius) - 4px)",
      },

      boxShadow: {
        xs:  "0 1px 2px 0 rgb(0 0 0 / 0.04)",
        sm:  "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        md:  "0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)",
        glow:"0 0 0 3px color-mix(in srgb, var(--color-primary) 15%, transparent)",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%":      { opacity: "0" },
        },
        "pulse-gps": {
          "0%":   { transform: "scale(1)", opacity: "0.5" },
          "100%": { transform: "scale(3)", opacity: "0" },
        },
        /*
          Последний кадр — "none", а не "translateY(0)". Разница невидимая,
          но решающая.

          Обе анимации ниже стоят с forwards: последний кадр остаётся
          применённым навсегда. Пока там был translateY(0), элемент до конца
          жизни держал transform — а любой transform, кроме none, делает
          элемент точкой отсчёта для position: fixed внутри себя.

          Обёртка страницы в Layout.tsx как раз animate-fade-up. Поэтому «низ
          экрана» для всего её содержимого означал низ обёртки: панель с
          кнопкой «Продолжить» на новом заказе вставала посреди экрана, а под
          ней до нижней навигации оставалась мёртвая полоса в полсотни точек.
          Выдвижная корзина и модальные окна обходили это порталом в body.

          В index.css есть свои кадры fadeUp с тем же смыслом, но побеждают
          эти: утилиты Tailwind идут в каскаде позже.
        */
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "none" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to:   { opacity: "1", transform: "none" },
        },
      },

      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
        "caret-blink":    "caret-blink 1.25s ease-out infinite",
        "pulse-gps":      "pulse-gps 2s ease-out infinite",
        /*
          Без forwards — и это главное здесь, а не сами кадры.

          Пока анимация с forwards держит transform, элемент до конца жизни
          остаётся точкой отсчёта для position: fixed внутри себя. Написать в
          последнем кадре transform: none не помогает: заливка всё равно
          оставляет свойство анимированным, и браузер считает его матрицей —
          проверено, computed так и остаётся matrix(1, 0, 0, 1, 0, 0).

          Обёртка страницы в Layout.tsx как раз animate-fade-up, поэтому «низ
          экрана» для всего её содержимого означал низ обёртки: панель с
          кнопкой «Продолжить» на новом заказе вставала посреди экрана, а под
          ней до нижней навигации зияла мёртвая полоса в 55 точек. Выдвижная
          корзина и модальные окна обходили это порталом в body.

          Без заливки элемент после анимации возвращается к своему обычному
          виду — а он и есть нужный: opacity 1, никакого transform. Выглядит
          так же, но «низ экрана» снова означает низ экрана.
        */
        "fade-up":        "fade-up 0.3s ease",
        "slide-in":       "slide-in 0.25s ease forwards",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    function({ addUtilities }) {
      addUtilities({
        ".safe-area-pb": { "padding-bottom": "env(safe-area-inset-bottom)" },
        ".safe-area-pt": { "padding-top":    "env(safe-area-inset-top)"    },
      });
    },
  ],
}
