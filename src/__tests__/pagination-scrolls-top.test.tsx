// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange";

/**
 * Следующая страница списка открывается сверху.
 *
 * Жалоба владельца: «при переходе на следующую страницу список не
 * возвращается к началу, а открывается с середины или конца — везде».
 * Кнопка «Далее» стоит под списком; строки подменяются, а прокрутка
 * остаётся. Стережётся и хук, и то, что он стоит у КАЖДОГО списка со
 * страницами: завтрашний новый список без него вернёт жалобу.
 */
let scrolled: number[] = [];
beforeEach(() => {
  scrolled = [];
  vi.stubGlobal("scrollTo", (o: { top: number }) => { scrolled.push(o.top); });
  Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
});

function Page({ page, listTop }: { page: number; listTop: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollTopOnChange(page, listTop === null ? undefined : ref);
  return <div ref={el => { (ref as React.MutableRefObject<HTMLDivElement | null>).current = el; if (el) el.getBoundingClientRect = () => ({ top: listTop ?? 0 } as DOMRect); }}>{page}</div>;
}

describe("хук: прокрутка к началу при смене страницы", () => {
  it("первый показ не трогает прокрутку", () => {
    render(<Page page={1} listTop={null} />);
    expect(scrolled).toEqual([]);
  });

  it("без элемента списка — к началу страницы", () => {
    const r = render(<Page page={1} listTop={null} />);
    r.rerender(<Page page={2} listTop={null} />);
    expect(scrolled).toEqual([0]);
  });

  it("с элементом списка — к его началу с зазором под закреплённую шапку", () => {
    const r = render(<Page page={1} listTop={-300} />);
    r.rerender(<Page page={2} listTop={-300} />);
    // список на 300 px выше верхнего края окна: 900 − 300 − 72
    expect(scrolled).toEqual([528]);
  });

  it("если начало списка и так видно — не дёргает", () => {
    const r = render(<Page page={1} listTop={40} />);
    r.rerender(<Page page={2} listTop={40} />);
    expect(scrolled).toEqual([]);
  });
});

describe("хук стоит у каждого списка со страницами", () => {
  const ROOT = path.join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p); }
      else if (/\.tsx$/.test(name)) files.push(p);
    }
  };
  walk(path.join(ROOT, "pages")); walk(path.join(ROOT, "components"));

  it("где есть состояние page — есть и useScrollTopOnChange(page", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const paged = /const \[page, setPage\]\s*=\s*(useState|useUrlState)/.test(src);
      if (paged && !/useScrollTopOnChange\(page/.test(src)) missing.push(path.relative(process.cwd(), f));
    }
    expect(missing, "списки со страницами без прокрутки к началу:\n" + missing.join("\n")).toEqual([]);
    expect(files.length).toBeGreaterThan(50);
  });
});
