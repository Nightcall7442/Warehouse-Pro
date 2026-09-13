# -*- coding: utf-8 -*-
"""Собирает руководство по ролям из снимков (артефакт screenshots): docs/training/README*.md + webp и guide.html.

Запуск: SHOTS=<папка с распакованным артефактом> python scripts/build_training.py
"""
import os, sys, json, html
from pathlib import Path
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from training_content import GUIDE

ROOT = Path(__file__).resolve().parents[1]
SHOTS = Path(os.environ.get("SHOTS", ROOT / "screenshots"))   # распакованный артефакт screenshots
SCRATCH = Path(os.environ.get("OUT", ROOT / "docs" / "training"))
DOCS = ROOT / "docs" / "training"
IMG = DOCS / "img"
LANGS = ["ru", "uz"]

def convert(kind, lang, role, screen):
    src = SHOTS / kind / lang / role / f"{screen}.png"
    if not src.exists():
        return None
    rel = Path("img") / kind / lang / role / f"{screen}.webp"
    dst = DOCS / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        im = Image.open(src).convert("RGB")
        maxw = 1280 if kind == "web" else 640
        if im.width > maxw:
            im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
        im.save(dst, "WEBP", quality=82, method=6)
    return rel.as_posix()

def build_md(lang):
    L = lambda pair: pair[0] if lang == "ru" else pair[1]
    title = "Warehouse Pro — руководство по ролям" if lang == "ru" else "Warehouse Pro — rollar bo'yicha qo'llanma"
    note = ("Снимки сделаны с настоящего приложения на демонстрационных данных (организация «Demo UZ»). Русская версия: README.md, узбекская: README.uz.md."
            if lang == "ru" else
            "Suratlar haqiqiy ilovadan namunaviy ma'lumotlarda olingan («Demo UZ» tashkiloti). Ruscha: README.md, o'zbekcha: README.uz.md.")
    out = [f"# {title}", "", note, ""]
    out.append("## " + ("Содержание" if lang == "ru" else "Mundarija"))
    for sec in GUIDE:
        out.append(f"- [{sec[lang]}](#{sec['key']})")
    out.append("")
    for sec in GUIDE:
        out.append(f'<a id="{sec["key"]}"></a>')
        out.append(f"## {sec[lang]}")
        out.append("")
        out.append(L(sec["intro"]))
        out.append("")
        for i, st in enumerate(sec["steps"], 1):
            out.append(f"{i}. {st[lang]}")
            if st["img"]:
                rel = convert(*st["img"][:1], lang, *st["img"][1:])
                if rel:
                    out.append("")
                    out.append(f"   ![{sec[lang]} — {i}]({rel})")
            out.append("")
    (DOCS / ("README.md" if lang == "ru" else "README.uz.md")).write_text("\n".join(out), encoding="utf-8", newline="\n")

def build_html():
    """Одна страница, переключатель ru/uz, снимки — отдельными файлами артефакта."""
    files = {}
    def img_for(st, lang):
        if not st["img"]:
            return None
        rel = convert(st["img"][0], lang, *st["img"][1:])
        if rel:
            files[rel] = (DOCS / rel).as_posix()
        return rel
    secs = []
    for sec in GUIDE:
        steps = []
        for i, st in enumerate(sec["steps"], 1):
            imgs = {lang: img_for(st, lang) for lang in LANGS}
            steps.append({"n": i, "ru": st["ru"], "uz": st["uz"], "img": imgs, "kind": st["img"][0] if st["img"] else None})
        secs.append({"key": sec["key"], "ru": sec["ru"], "uz": sec["uz"], "intro": {"ru": sec["intro"][0], "uz": sec["intro"][1]}, "steps": steps})
    data = json.dumps(secs, ensure_ascii=False)
    page = f"""<title>Warehouse Pro: руководство по ролям</title>
<style>
:root{{--bg:#f6f4ef;--panel:#ffffff;--ink:#22201c;--muted:#6b665c;--line:#e2ddd2;--accent:#1f6f78;--accent-ink:#ffffff;--chip:#eef3f2}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#17161a;--panel:#201f24;--ink:#ece9e2;--muted:#a39e93;--line:#34323a;--accent:#5fb3bb;--accent-ink:#0f1a1c;--chip:#26303a}}}}
:root[data-theme="dark"]{{--bg:#17161a;--panel:#201f24;--ink:#ece9e2;--muted:#a39e93;--line:#34323a;--accent:#5fb3bb;--accent-ink:#0f1a1c;--chip:#26303a}}
body{{background:var(--bg);color:var(--ink);font:15px/1.55 "Manrope","Segoe UI",system-ui,sans-serif;margin:0}}
.wrap{{max-width:1040px;margin:0 auto;padding:28px 20px 80px}}
header{{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:8px}}
h1{{font-size:26px;margin:0;letter-spacing:-.01em;text-wrap:balance}}
.lang{{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}}
.lang button{{border:0;background:transparent;color:var(--ink);padding:8px 16px;font:inherit;font-weight:600;cursor:pointer}}
.lang button[aria-pressed="true"]{{background:var(--accent);color:var(--accent-ink)}}
.note{{color:var(--muted);margin:0 0 20px}}
nav.toc{{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px}}
nav.toc a{{background:var(--chip);color:var(--ink);text-decoration:none;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:600}}
section{{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:0 0 18px}}
section h2{{margin:0 0 6px;font-size:20px}}
section .intro{{color:var(--muted);margin:0 0 16px;max-width:70ch}}
ol{{margin:0;padding-left:22px;display:grid;gap:18px}}
li{{max-width:70ch}}
figure{{margin:10px 0 0;display:grid;gap:6px}}
figure img{{width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:var(--bg)}}
figure.mobile img{{max-width:320px}}
figure figcaption{{color:var(--muted);font-size:12px}}
footer{{color:var(--muted);font-size:12px;margin-top:30px}}
a:focus-visible,button:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
@media (prefers-reduced-motion: no-preference){{section{{scroll-margin-top:12px}}}}
</style>
<div class="wrap">
<header>
  <h1 id="ttl">Warehouse Pro — руководство по ролям</h1>
  <div class="lang" role="group" aria-label="Язык / Til">
    <button type="button" data-lang="ru" aria-pressed="true">Русский</button>
    <button type="button" data-lang="uz" aria-pressed="false">O'zbekcha</button>
  </div>
</header>
<p class="note" id="note"></p>
<nav class="toc" id="toc"></nav>
<div id="body"></div>
<footer id="foot"></footer>
</div>
<script>
const DATA = {data};
const TXT = {{
  ru: {{ title: "Warehouse Pro — руководство по ролям", note: "Снимки сделаны с настоящего приложения на демонстрационных данных (организация «Demo UZ»).", cap: "Снимок экрана", foot: "Собрано автоматически из текущей сборки; при изменении экранов снимки обновляются тем же прогоном." }},
  uz: {{ title: "Warehouse Pro — rollar bo'yicha qo'llanma", note: "Suratlar haqiqiy ilovadan namunaviy ma'lumotlarda olingan («Demo UZ» tashkiloti).", cap: "Ekran surati", foot: "Joriy yig'ilmadan avtomatik tuzilgan; ekranlar o'zgarsa, suratlar o'sha prognoz bilan yangilanadi." }},
}};
function esc(s){{return s.replace(/[&<>"]/g,c=>({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}}[c]));}}
function render(lang){{
  document.documentElement.lang = lang;
  document.getElementById("ttl").textContent = TXT[lang].title;
  document.getElementById("note").textContent = TXT[lang].note;
  document.getElementById("foot").textContent = TXT[lang].foot;
  document.getElementById("toc").innerHTML = DATA.map(s => `<a href="#${{s.key}}">${{esc(s[lang])}}</a>`).join("");
  document.getElementById("body").innerHTML = DATA.map(s => `
    <section id="${{s.key}}"><h2>${{esc(s[lang])}}</h2><p class="intro">${{esc(s.intro[lang])}}</p><ol>
      ${{s.steps.map(st => `<li>${{esc(st[lang])}}${{st.img[lang] ? `<figure class="${{st.kind}}"><img loading="lazy" src="${{st.img[lang]}}" alt="${{esc(TXT[lang].cap)}}: ${{esc(s[lang])}} ${{st.n}}"><figcaption>${{esc(TXT[lang].cap)}} ${{st.n}}</figcaption></figure>` : ""}}</li>`).join("")}}
    </ol></section>`).join("");
  document.querySelectorAll(".lang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  try {{ localStorage.setItem("guide-lang", lang); }} catch {{}}
}}
document.querySelectorAll(".lang button").forEach(b => b.addEventListener("click", () => render(b.dataset.lang)));
let start = "ru"; try {{ const s = localStorage.getItem("guide-lang"); if (s === "uz") start = "uz"; }} catch {{}}
render(start);
</script>
"""
    out = SCRATCH / "guide.html"
    out.write_text(page, encoding="utf-8", newline="\n")
    (SCRATCH / "guide-files.json").write_text(json.dumps(files, ensure_ascii=False, indent=1), encoding="utf-8")
    return out, files

if __name__ == "__main__":
    DOCS.mkdir(parents=True, exist_ok=True)
    for lang in LANGS:
        build_md(lang)
    out, files = build_html()
    total = sum(os.path.getsize(DOCS / f) for f in files)
    print(f"md: {DOCS}; html: {out}; images: {len(files)} ({total/1024/1024:.1f} MB)")
