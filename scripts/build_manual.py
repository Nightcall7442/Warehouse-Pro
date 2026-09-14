# -*- coding: utf-8 -*-
"""
Собирает «Руководство дистрибьютора» из содержания (scripts/manual_content.py)
и снимков (артефакт screenshots с index.json и выносками).

Выход: docs/manual/manual.ru.html, manual.uz.html (печатная вёрстка A4, из них
scripts/manual-pdf.mjs делает PDF), docs/manual/index.html — читалка с
разделами по клику (боковое меню, поиск, снимок во весь экран, RU/UZ), и
docs/manual/img/*.webp с нарисованными цифрами выносок.

Запуск: SHOTS=<распакованный артефакт> python scripts/build_manual.py
"""
import os, sys, json, html, base64
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from manual_content import DOC  # noqa: E402

SHOTS = Path(os.environ.get("SHOTS", ROOT / "screenshots"))
OUT = ROOT / "docs" / "manual"
IMG = OUT / "img"
LANGS = ["ru", "uz"]
INDEX = json.loads((SHOTS / "index.json").read_text(encoding="utf-8")) if (SHOTS / "index.json").exists() else {"web": [], "mobile": []}

def font(size):
    for name in ("arialbd.ttf", "segoeuib.ttf", "DejaVuSans-Bold.ttf"):
        for base in (Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts", Path("/usr/share/fonts/truetype/dejavu")):
            p = base / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()

def shot_entry(kind, lang, role, screen):
    for e in INDEX.get(kind, []):
        if e.get("lang") == lang and e.get("role") == role and e.get("screen") == screen:
            return e
    return None

def render_image(kind, lang, role, screen, callouts):
    """PNG → webp с нарисованными цифрами; возвращает (относительный путь, список найденных номеров)."""
    src = SHOTS / kind / lang / role / f"{screen}.png"
    if not src.exists():
        return None, []
    rel = Path("img") / f"{kind}-{lang}-{role}-{screen}.webp"
    dst = OUT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    entry = shot_entry(kind, lang, role, screen) or {}
    marks = {m["key"]: m for m in entry.get("marks", [])}
    im = Image.open(src).convert("RGB")
    draw = ImageDraw.Draw(im)
    found = []
    # Координаты выносок — в CSS-пикселях окна (веб 1440, телефон 390);
    # снимок телефона снят с плотностью 3 — масштабируем.
    k = im.width / (1440 if kind == "web" else 390)
    r = int((20 if kind == "web" else 13) * k)
    f = font(int((22 if kind == "web" else 14) * k))
    for key, _text in callouts:
        m0 = marks.get(key)
        if not m0:
            continue
        n = len(found) + 1   # нумеруем только то, что нашлось на снимке
        m = {kk: int(round(m0[kk] * k)) for kk in ("x", "y", "w", "h")}
        cx = max(r + 2, min(im.width - r - 2, m["x"] - r - 4))
        cy = max(r + 2, min(im.height - r - 2, m["y"] + min(m["h"], 40) // 2))
        # обводка элемента
        draw.rounded_rectangle([m["x"] - 3, m["y"] - 3, m["x"] + m["w"] + 3, m["y"] + m["h"] + 3], radius=int(8 * k), outline=(214, 88, 40), width=max(2, int(3 * k)))
        # кружок с номером
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(214, 88, 40), outline=(255, 255, 255), width=max(2, int(3 * k)))
        tw = draw.textlength(str(n), font=f)
        draw.text((cx - tw / 2, cy - f.size * 0.58), str(n), fill=(255, 255, 255), font=f)
        found.append((n, key))
    maxw = 1400 if kind == "web" else 640
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    im.save(dst, "WEBP", quality=84, method=6)
    return rel.as_posix(), found

LOGO = (ROOT / "docs" / "assets" / "logo-horizontal.svg")
LOGO_URI = "data:image/svg+xml;base64," + base64.b64encode(LOGO.read_bytes()).decode() if LOGO.exists() else ""

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
:root { --ink:#1c1b19; --muted:#6b665c; --line:#d9d3c7; --paper:#ffffff; --accent:#14636b; --accent-soft:#e6f0f1; --warn:#9a4a1c; --warn-soft:#fbeee6; --tip:#2d5a27; --tip-soft:#e9f2e6; }
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif; font-size:10.6pt; line-height:1.5; }
h1,h2,h3 { font-family:"Manrope","Segoe UI",system-ui,sans-serif; letter-spacing:-0.01em; text-wrap:balance; }
.cover { height:257mm; display:flex; flex-direction:column; justify-content:space-between; page-break-after:always; }
.cover .logo { height:34px; }
.cover h1 { font-size:34pt; line-height:1.1; margin:0 0 10px; }
.cover .sub { font-size:15pt; color:var(--muted); margin:0; }
.cover .band { border-top:3px solid var(--accent); padding-top:14px; display:flex; justify-content:space-between; color:var(--muted); font-size:9.5pt; }
.cover .who { margin-top:60px; max-width:70ch; font-size:11.5pt; }
.cover .roles { margin-top:22px; display:flex; flex-wrap:wrap; gap:8px; }
.cover .roles span { border:1px solid var(--accent); color:var(--accent); border-radius:999px; padding:4px 12px; font-size:9.5pt; font-weight:600; }
.cover h1::before { content:""; display:block; width:56px; height:6px; background:var(--accent); border-radius:3px; margin-bottom:18px; }
.toc { page-break-after:always; }
.toc h2 { margin-top:0; }
.toc ol { list-style:none; padding:0; margin:0; }
.toc li { display:flex; justify-content:space-between; border-bottom:1px dotted var(--line); padding:6px 0; }
.toc li.sub { padding-left:18px; color:var(--muted); }
.toc a { color:inherit; text-decoration:none; }
section.chapter { page-break-before:always; }
section.chapter:first-of-type { page-break-before:auto; }
h2 { font-size:20pt; margin:0 0 6px; color:var(--accent); }
h2 .kicker { display:block; font-size:9pt; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); font-weight:600; margin-bottom:4px; }
h3 { font-size:13.5pt; margin:18px 0 6px; }
p { margin:0 0 8px; max-width:78ch; }
ol.steps { margin:6px 0 10px; padding-left:0; counter-reset:step; list-style:none; }
ol.steps li { position:relative; padding-left:34px; margin:0 0 7px; max-width:78ch; }
ol.steps li::before { counter-increment:step; content:counter(step); position:absolute; left:0; top:1px; width:24px; height:24px; border-radius:50%; background:var(--accent); color:#fff; font-weight:700; font-size:10pt; display:flex; align-items:center; justify-content:center; }
ul.bullets { margin:6px 0 10px; padding-left:18px; }
ul.bullets li { margin:0 0 5px; max-width:78ch; }
.box { border-left:4px solid var(--accent); background:var(--accent-soft); padding:8px 12px; margin:10px 0; max-width:82ch; page-break-inside:avoid; }
.box.warn { border-color:var(--warn); background:var(--warn-soft); }
.box.tip { border-color:var(--tip); background:var(--tip-soft); }
.box b { display:block; font-size:9pt; letter-spacing:.1em; text-transform:uppercase; margin-bottom:2px; }
.check { list-style:none; padding:0; margin:8px 0 12px; }
.check li { padding-left:26px; position:relative; margin:0 0 4px; }
.check li::before { content:""; position:absolute; left:0; top:3px; width:14px; height:14px; border:1.5px solid var(--accent); border-radius:3px; }
table { border-collapse:collapse; width:100%; margin:8px 0 12px; font-size:9.6pt; page-break-inside:auto; }
th, td { border:1px solid var(--line); padding:6px 8px; vertical-align:top; text-align:left; }
th { background:var(--accent-soft); font-weight:700; }
tr { page-break-inside:avoid; }
figure { margin:12px 0 14px; page-break-inside:avoid; }
figure img { width:100%; height:auto; border:1px solid var(--line); border-radius:6px; }
figure.mobile { display:grid; grid-template-columns:62mm 1fr; gap:12px; align-items:start; }
figure.mobile img { width:62mm; }
figcaption { font-size:9.4pt; color:var(--muted); margin-top:6px; }
.legend { list-style:none; padding:0; margin:6px 0 0; font-size:9.4pt; }
.legend li { display:flex; gap:8px; margin:0 0 3px; align-items:baseline; }
.legend .n { flex:0 0 18px; height:18px; border-radius:50%; background:#d65828; color:#fff; font-weight:700; font-size:8.5pt; display:inline-flex; align-items:center; justify-content:center; }
.role { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:6px 0 14px; }
.role div { border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:9.6pt; }
.role b { display:block; color:var(--accent); font-size:8.6pt; letter-spacing:.1em; text-transform:uppercase; margin-bottom:3px; }
@media screen { body { background:#f1eee8; } .page { max-width:210mm; margin:0 auto; padding:18mm 16mm; background:#fff; } }
"""

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap">'

LBL = {
  "ru": {"toc": "Содержание", "tip": "Совет", "warn": "Внимание", "check": "Проверка", "fig": "Рис.", "morning": "Утро", "day": "День", "evening": "Вечер", "part": "Глава"},
  "uz": {"toc": "Mundarija", "tip": "Maslahat", "warn": "Diqqat", "check": "Tekshiruv", "fig": "Rasm", "morning": "Ertalab", "day": "Kun", "evening": "Kechqurun", "part": "Bob"},
}

def esc(s): return html.escape(s or "")

def slug(chapter_id, n):
    return f"{chapter_id}-{n}"

def render_chapter(lang, ch, fig_state):
    """HTML тела главы (без <section>) и список подразделов [(id, title)] для меню."""
    L = LBL[lang]
    tx = lambda t: (t or {}).get(lang) or (t or {}).get("ru") or ""
    out = []
    subs = []
    for b in ch["blocks"]:
        t = b["t"]
        if t == "p": out.append(f"<p>{esc(tx(b['x']))}</p>")
        elif t == "h3":
            sid = slug(ch["id"], len(subs) + 1)
            subs.append((sid, tx(b["x"])))
            out.append(f"<h3 id='{sid}'>{esc(tx(b['x']))}</h3>")
        elif t == "steps": out.append("<ol class='steps'>" + "".join(f"<li>{esc(tx(i))}</li>" for i in b["items"]) + "</ol>")
        elif t == "bullets": out.append("<ul class='bullets'>" + "".join(f"<li>{esc(tx(i))}</li>" for i in b["items"]) + "</ul>")
        elif t in ("tip", "warn"): out.append(f"<div class='box {t}'><b>{esc(L[t])}</b>{esc(tx(b['x']))}</div>")
        elif t == "check": out.append(f"<div class='box'><b>{esc(L['check'])}</b><ul class='check'>" + "".join(f"<li>{esc(tx(i))}</li>" for i in b["items"]) + "</ul></div>")
        elif t == "table":
            out.append("<div class='tablewrap'><table><thead><tr>" + "".join(f"<th>{esc(tx(h))}</th>" for h in b["header"]) + "</tr></thead><tbody>"
                       + "".join("<tr>" + "".join(f"<td>{esc(tx(c))}</td>" for c in row) + "</tr>" for row in b["rows"]) + "</tbody></table></div>")
        elif t == "role":
            out.append("<div class='role'>" + "".join(f"<div><b>{esc(L[k])}</b>{esc(tx(b[k]))}</div>" for k in ("morning", "day", "evening")) + "</div>")
        elif t == "fig":
            kind, role, screen = b["fig"]
            rel, found = render_image(kind, lang, role, screen, b.get("callouts", []))
            if not rel:
                continue
            fig_state["n"] += 1
            texts = {key: txt for key, txt in b.get("callouts", [])}
            legend = "".join(f"<li><span class='n'>{n}</span><span>{esc(tx(texts[key]))}</span></li>" for n, key in found)
            cap = f"<figcaption>{esc(L['fig'])} {fig_state['n']}. {esc(tx(b['cap']))}</figcaption>" + (f"<ul class='legend'>{legend}</ul>" if legend else "")
            if kind == "mobile":
                out.append(f"<figure class='mobile'><img src='{rel}' alt='{esc(tx(b['cap']))}' loading='lazy'><div>{cap}</div></figure>")
            else:
                out.append(f"<figure><img src='{rel}' alt='{esc(tx(b['cap']))}' loading='lazy'>{cap}</figure>")
    return "".join(out), subs

def build(lang):
    """Печатная книга: обложка, оглавление, главы подряд (A4)."""
    L = LBL[lang]
    tx = lambda t: (t or {}).get(lang) or (t or {}).get("ru") or ""
    parts = []
    parts.append(f"""<div class="page"><div class="cover">
      <div>{'<img class="logo" src="' + LOGO_URI + '" alt="Warehouse Pro">' if LOGO_URI else ''}</div>
      <div><h1>{esc(tx(DOC['title']))}</h1><p class="sub">{esc(tx(DOC['subtitle']))}</p>
        <p class="who">{esc(tx(DOC['chapters'][0]['blocks'][0]['x']))}</p>
        <div class="roles">{''.join(f"<span>{esc(tx(ch['title']))}</span>" for ch in DOC['chapters'] if ch['id'].startswith('role-'))}</div></div>
      <div class="band"><span>{esc(tx(DOC['edition']))}</span><span>warehouse-pro.uz</span></div>
    </div></div>""")
    toc = ["<div class='toc'><h2>%s</h2><ol>" % esc(L["toc"])]
    for ch in DOC["chapters"]:
        toc.append(f"<li><a href='#{ch['id']}'>{esc(tx(ch['title']))}</a></li>")
        for b in ch["blocks"]:
            if b["t"] == "h3":
                toc.append(f"<li class='sub'><span>{esc(tx(b['x']))}</span></li>")
    toc.append("</ol></div>")
    parts.append("".join(toc))
    fig_state = {"n": 0}
    for ch in DOC["chapters"]:
        body, _subs = render_chapter(lang, ch, fig_state)
        parts.append(f"<section class='chapter' id='{ch['id']}'><h2>{esc(tx(ch['title']))}</h2>{body}</section>")
    page = (f"<!doctype html><html lang='{lang}'><head><meta charset='utf-8'><title>{esc(tx(DOC['title']))}</title>{FONTS}<style>{CSS}</style></head><body>"
            + parts[0] + "<div class='page'>" + "".join(parts[1:]) + "</div></body></html>")
    (OUT / f"manual.{lang}.html").write_text(page, encoding="utf-8", newline="\n")

# ── Читалка: разделы по клику ───────────────────────────────────────────────
#
# Книга на 60 страниц читается с экрана плохо: чтобы найти «как принять
# возврат», человек крутит вверх-вниз. Здесь тот же текст и те же снимки, но
# открыт один раздел; слева меню разделов и подразделов, сверху — «я
# оператор / директор / …», поиск по тексту, RU/UZ, снимок во весь экран по
# клику, внизу раздела — «дальше». Оба языка в одном файле: одна ссылка
# клиенту, переключение без перезагрузки.

READER_LBL = {
  "ru": {"sections": "Разделы", "search": "Поиск по руководству", "iam": "Я —", "print": "Печать / PDF", "prev": "Назад", "next": "Дальше",
         "of": "из", "nothing": "Ничего не найдено", "menu": "Меню", "toTop": "Наверх", "doc": "руководство"},
  "uz": {"sections": "Bo'limlar", "search": "Qo'llanma bo'yicha qidiruv", "iam": "Men —", "print": "Chop etish / PDF", "prev": "Orqaga", "next": "Keyingi",
         "of": "/", "nothing": "Hech narsa topilmadi", "menu": "Menyu", "toTop": "Yuqoriga", "doc": "qo'llanma"},
}
GRP = {
  "ru": {"grp:rollout": "Внедрение", "grp:roles": "Рабочий день роли", "grp:money": "Как система считает", "grp:help": "Помощь"},
  "uz": {"grp:rollout": "Joriy etish", "grp:roles": "Rolning ish kuni", "grp:money": "Tizim qanday hisoblaydi", "grp:help": "Yordam"},
}

READER_CSS = """
:root { --ink:#1c1b19; --muted:#6b665c; --line:#d9d3c7; --paper:#ffffff; --ground:#f1eee8; --accent:#14636b; --accent-soft:#e6f0f1; --warn:#9a4a1c; --warn-soft:#fbeee6; --tip:#2d5a27; --tip-soft:#e9f2e6; --mark:#d65828; --top:56px; --side:292px; }
* { box-sizing:border-box; }
html { color-scheme: light; }
body { margin:0; background:var(--ground); color:var(--ink); font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif; font-size:15px; line-height:1.55; }
h1,h2,h3 { font-family:"Manrope","Segoe UI",system-ui,sans-serif; letter-spacing:-0.01em; text-wrap:balance; }
[data-lang] { display:none; } html[data-ui="ru"] [data-lang="ru"], html[data-ui="uz"] [data-lang="uz"] { display:revert; }
button { font:inherit; }
a { color:var(--accent); }
/* верх */
.top { position:fixed; inset:0 0 auto 0; height:var(--top); background:var(--paper); border-bottom:1px solid var(--line); display:flex; align-items:center; gap:10px; padding:0 14px; z-index:30; }
.top .brand { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--ink); font-family:"Manrope",sans-serif; font-weight:700; white-space:nowrap; }
.top .brand img { height:22px; }
.top .brand span { color:var(--muted); font-weight:600; }
.menu-btn { display:none; border:1px solid var(--line); background:var(--paper); border-radius:8px; padding:6px 10px; cursor:pointer; white-space:nowrap; }
.chips { display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; margin-left:8px; align-items:center; }
.chips::-webkit-scrollbar { display:none; }
.chips .lbl { color:var(--muted); font-size:13px; white-space:nowrap; }
.chips button { border:1px solid var(--line); background:var(--paper); color:var(--ink); border-radius:999px; padding:4px 11px; font-size:13px; cursor:pointer; white-space:nowrap; }
.chips button:hover { border-color:var(--accent); color:var(--accent); }
.chips button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
.search { margin-left:auto; position:relative; flex:0 1 300px; min-width:140px; }
.search input { width:100%; border:1px solid var(--line); border-radius:8px; padding:7px 10px 7px 32px; background:var(--ground); font:inherit; font-size:14px; }
.search input:focus { outline:2px solid var(--accent); outline-offset:1px; background:var(--paper); }
.search svg { position:absolute; left:10px; top:9px; width:16px; height:16px; color:var(--muted); pointer-events:none; }
.results { position:absolute; top:40px; right:0; width:min(520px, 92vw); max-height:60vh; overflow:auto; background:var(--paper); border:1px solid var(--line); border-radius:10px; box-shadow:0 14px 40px -12px rgba(28,27,25,.35); display:none; z-index:40; }
.results.open { display:block; }
.results a { display:block; padding:9px 12px; border-bottom:1px solid var(--line); text-decoration:none; color:var(--ink); font-size:14px; }
.results a:last-child { border-bottom:0; } .results a:hover, .results a:focus { background:var(--accent-soft); outline:none; }
.results .where { font-size:12px; color:var(--muted); display:block; }
.results mark { background:#ffe8a3; color:inherit; padding:0 1px; border-radius:2px; }
.results .none { padding:12px; color:var(--muted); }
.lang { display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; flex:none; }
.lang button { border:0; background:var(--paper); padding:6px 10px; cursor:pointer; font-weight:600; color:var(--muted); }
.lang button.on { background:var(--accent); color:#fff; }
.print-btn { border:1px solid var(--line); background:var(--paper); border-radius:8px; padding:6px 10px; cursor:pointer; white-space:nowrap; }
/* каркас */
.shell { display:grid; grid-template-columns:var(--side) 1fr; min-height:100vh; padding-top:var(--top); }
.side { position:sticky; top:var(--top); height:calc(100vh - var(--top)); overflow-y:auto; background:var(--paper); border-right:1px solid var(--line); padding:14px 10px 30px; }
.side .grp { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:700; margin:14px 8px 6px; }
.side a { display:block; text-decoration:none; color:var(--ink); padding:7px 10px; border-radius:8px; font-size:14px; line-height:1.3; }
.side a:hover { background:var(--ground); }
.side a.on { background:var(--accent-soft); color:var(--accent); font-weight:600; }
.side a.sub { padding-left:24px; font-size:13px; color:var(--muted); }
.side a.sub.on { color:var(--accent); }
.side a.sub::before { content:"·"; margin-right:6px; }
.side .hide { display:none; }
.backdrop { display:none; position:fixed; inset:0; background:rgba(28,27,25,.4); z-index:19; }
/* содержание */
.content { padding:26px clamp(16px, 4vw, 48px) 60px; max-width:980px; width:100%; }
.crumb { font-size:13px; color:var(--muted); margin-bottom:8px; display:flex; gap:8px; align-items:center; }
.crumb .pos { margin-left:auto; font-variant-numeric:tabular-nums; }
section.chapter { display:none; background:var(--paper); border:1px solid var(--line); border-radius:14px; padding:26px clamp(18px, 3vw, 40px) 30px; }
section.chapter.on { display:block; animation:in .18s ease-out; }
@keyframes in { from { opacity:.4; transform:translateY(4px);} to { opacity:1; transform:none;} }
@media (prefers-reduced-motion: reduce) { section.chapter.on { animation:none; } }
h2 { font-size:26px; margin:0 0 10px; color:var(--accent); }
h3 { font-size:18px; margin:24px 0 8px; scroll-margin-top:calc(var(--top) + 14px); }
p { margin:0 0 10px; max-width:74ch; }
ol.steps { margin:6px 0 12px; padding-left:0; counter-reset:step; list-style:none; }
ol.steps li { position:relative; padding-left:38px; margin:0 0 9px; max-width:74ch; }
ol.steps li::before { counter-increment:step; content:counter(step); position:absolute; left:0; top:0; width:26px; height:26px; border-radius:50%; background:var(--accent); color:#fff; font-weight:700; font-size:13px; display:flex; align-items:center; justify-content:center; }
ul.bullets { margin:6px 0 12px; padding-left:20px; } ul.bullets li { margin:0 0 6px; max-width:74ch; }
.box { border-left:4px solid var(--accent); background:var(--accent-soft); padding:10px 14px; margin:12px 0; max-width:80ch; border-radius:0 8px 8px 0; }
.box.warn { border-color:var(--warn); background:var(--warn-soft); } .box.tip { border-color:var(--tip); background:var(--tip-soft); }
.box b { display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase; margin-bottom:2px; }
.check { list-style:none; padding:0; margin:8px 0 4px; } .check li { padding-left:26px; position:relative; margin:0 0 5px; }
.check li::before { content:""; position:absolute; left:0; top:4px; width:15px; height:15px; border:1.5px solid var(--accent); border-radius:3px; }
.tablewrap { overflow-x:auto; margin:8px 0 14px; }
table { border-collapse:collapse; width:100%; font-size:14px; }
th, td { border:1px solid var(--line); padding:7px 9px; vertical-align:top; text-align:left; } th { background:var(--accent-soft); }
figure { margin:16px 0 20px; }
figure img { width:100%; height:auto; border:1px solid var(--line); border-radius:8px; cursor:zoom-in; background:#fff; }
figure.mobile { display:grid; grid-template-columns:260px 1fr; gap:16px; align-items:start; }
figure.mobile img { width:260px; }
figcaption { font-size:13.5px; color:var(--muted); margin-top:8px; }
.legend { list-style:none; padding:0; margin:8px 0 0; font-size:13.5px; }
.legend li { display:flex; gap:8px; margin:0 0 4px; align-items:baseline; }
.legend .n { flex:0 0 20px; height:20px; border-radius:50%; background:var(--mark); color:#fff; font-weight:700; font-size:12px; display:inline-flex; align-items:center; justify-content:center; }
.role { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin:6px 0 16px; }
.role div { border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:14px; }
.role b { display:block; color:var(--accent); font-size:11px; letter-spacing:.1em; text-transform:uppercase; margin-bottom:3px; }
.pager { display:flex; justify-content:space-between; gap:10px; margin-top:30px; padding-top:18px; border-top:1px solid var(--line); }
.pager button { border:1px solid var(--line); background:var(--paper); border-radius:10px; padding:10px 14px; cursor:pointer; max-width:48%; text-align:left; color:var(--ink); }
.pager button.next { text-align:right; margin-left:auto; border-color:var(--accent); color:var(--accent); font-weight:600; }
.pager button small { display:block; color:var(--muted); font-size:12px; font-weight:400; }
.pager button:disabled { visibility:hidden; }
/* снимок во весь экран */
.lightbox { position:fixed; inset:0; background:rgba(28,27,25,.88); display:none; align-items:center; justify-content:center; z-index:50; padding:20px; cursor:zoom-out; }
.lightbox.open { display:flex; }
.lightbox img { max-width:100%; max-height:100%; border-radius:6px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
.lightbox .cap { position:absolute; left:0; right:0; bottom:0; padding:12px 20px; color:#fff; font-size:14px; text-align:center; background:linear-gradient(transparent, rgba(0,0,0,.6)); }
.to-top { position:fixed; right:18px; bottom:18px; border:1px solid var(--line); background:var(--paper); border-radius:999px; padding:8px 14px; cursor:pointer; box-shadow:0 8px 24px -10px rgba(28,27,25,.4); display:none; z-index:20; }
.to-top.show { display:block; }
@media (max-width: 900px) {
  .shell { grid-template-columns:1fr; }
  .side { position:fixed; left:0; top:var(--top); width:min(320px, 86vw); transform:translateX(-102%); transition:transform .2s; z-index:20; box-shadow:0 20px 60px rgba(0,0,0,.25); }
  .side.open { transform:none; } .backdrop.open { display:block; }
  .menu-btn { display:inline-block; }
  .chips { display:none; }
  .print-btn { display:none; }
  .top { gap:8px; padding:0 10px; }
  .menu-btn span { display:none; }
  .top .brand img { height:18px; }
  .search { min-width:100px; }
  .top .brand span { display:none; }
  .search { flex:1 1 120px; }
  figure.mobile { grid-template-columns:1fr; } figure.mobile img { width:min(260px, 100%); }
}
@media print {
  .top, .side, .backdrop, .pager, .to-top, .crumb, .lightbox { display:none !important; }
  .shell { display:block; padding:0; } .content { max-width:none; padding:0; }
  section.chapter { display:block !important; border:0; border-radius:0; padding:0; page-break-before:always; }
  html[data-ui="ru"] [data-lang="uz"], html[data-ui="uz"] [data-lang="ru"] { display:none !important; }
  figure img { cursor:default; }
}
"""

READER_JS = r"""
(function () {
  var html = document.documentElement;
  var CH = window.CHAPTERS;            // [{id, group}]
  var TITLES = window.TITLES;          // {lang: {id: title, "grp:…": title, doc: title}}
  var LBL = window.LBL;
  var state = { lang: "ru", id: CH[0].id };
  try { state.lang = localStorage.getItem("wp-manual-lang") || state.lang; } catch (e) {}

  function known(id) { return CH.some(function (c) { return c.id === id; }); }
  function parseHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!h) return null;
    var parts = h.split("/"), lang = null, id = parts[0], sub = parts[1] || null;
    if (parts[0] === "ru" || parts[0] === "uz") { lang = parts[0]; id = parts[1] || CH[0].id; sub = parts[2] || null; }
    if (!known(id)) {
      // Ссылка прямо на подраздел: role-operator-2 → глава role-operator
      var m = id.match(/^(.*)-\d+$/);
      if (m && known(m[1])) { sub = id; id = m[1]; } else id = CH[0].id;
    }
    return { lang: lang, id: id, sub: sub };
  }
  function idx() { for (var i = 0; i < CH.length; i++) if (CH[i].id === state.id) return i; return 0; }

  var side = document.querySelector(".side"), backdrop = document.querySelector(".backdrop");
  function closeSide() { side.classList.remove("open"); backdrop.classList.remove("open"); }

  function render(sub, push) {
    html.setAttribute("data-ui", state.lang);
    html.lang = state.lang;
    try { localStorage.setItem("wp-manual-lang", state.lang); } catch (e) {}
    var L = LBL[state.lang], i = idx();
    document.querySelectorAll("section.chapter").forEach(function (s) { s.classList.toggle("on", s.dataset.id === state.id); });
    document.querySelectorAll(".side a").forEach(function (a) {
      var on = a.dataset.id === state.id && ((a.dataset.sub || "") === (sub || ""));
      a.classList.toggle("on", on);
      if (a.classList.contains("sub")) a.classList.toggle("hide", a.dataset.id !== state.id);
    });
    document.querySelectorAll(".chips button").forEach(function (b) { b.classList.toggle("on", b.dataset.id === state.id); });
    document.querySelectorAll(".lang button").forEach(function (b) { b.classList.toggle("on", b.dataset.lang === state.lang); });
    var input = document.querySelector(".search input");
    input.placeholder = input.getAttribute("data-ph-" + state.lang); input.setAttribute("aria-label", input.placeholder);
    var grp = CH[i].group ? (TITLES[state.lang][CH[i].group] + " › ") : "";
    document.querySelector(".crumb .where").textContent = grp + TITLES[state.lang][state.id];
    document.querySelector(".crumb .pos").textContent = (i + 1) + " " + L.of + " " + CH.length;
    document.querySelectorAll("section.chapter.on .pager").forEach(function (p) {
      var prev = p.querySelector(".prev"), next = p.querySelector(".next");
      prev.disabled = i === 0; next.disabled = i === CH.length - 1;
      if (i > 0) { prev.dataset.id = CH[i - 1].id; prev.innerHTML = "← " + L.prev + "<small>" + TITLES[state.lang][CH[i - 1].id] + "</small>"; }
      if (i < CH.length - 1) { next.dataset.id = CH[i + 1].id; next.innerHTML = L.next + " →<small>" + TITLES[state.lang][CH[i + 1].id] + "</small>"; }
    });
    document.title = TITLES[state.lang][state.id] + " — " + TITLES[state.lang].doc;
    var hash = "#" + state.lang + "/" + state.id + (sub ? "/" + sub : "");
    if (push && location.hash !== hash) history.pushState(null, "", hash);
    closeSide();
    if (sub) {
      var el = document.querySelector("section.chapter.on [id='" + sub + "']");
      if (el) { el.scrollIntoView({ block: "start" }); return; }
    }
    window.scrollTo({ top: 0 });
  }
  function go(id, sub, lang) { if (lang) state.lang = lang; state.id = id; render(sub || null, true); }

  document.querySelector(".menu-btn").addEventListener("click", function () { side.classList.toggle("open"); backdrop.classList.toggle("open"); });
  backdrop.addEventListener("click", closeSide);

  // Снимок во весь экран
  var lb = document.querySelector(".lightbox");
  function openLightbox(img) { lb.querySelector("img").src = img.src; lb.querySelector(".cap").textContent = img.alt; lb.classList.add("open"); }
  function closeLightbox() { lb.classList.remove("open"); }

  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-go]");
    if (a) { e.preventDefault(); if (!a.disabled) go(a.dataset.id, a.dataset.sub || null, a.dataset.lang || null); return; }
    var img = e.target.closest("figure img");
    if (img) { openLightbox(img); return; }
    if (e.target.closest(".lightbox")) closeLightbox();
  });
  document.querySelectorAll(".lang button").forEach(function (b) { b.addEventListener("click", function () { state.lang = b.dataset.lang; render(null, true); }); });
  document.querySelector(".print-btn").addEventListener("click", function () { window.print(); });
  window.addEventListener("popstate", function () { var p = parseHash(); if (!p) return; if (p.lang) state.lang = p.lang; state.id = p.id; render(p.sub, false); });

  // Клавиши: ← → между разделами, / — в поиск, Esc — закрыть
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") { if (e.key === "Escape") { e.target.blur(); closeResults(); } return; }
    if (e.key === "ArrowRight" && idx() < CH.length - 1) go(CH[idx() + 1].id);
    else if (e.key === "ArrowLeft" && idx() > 0) go(CH[idx() - 1].id);
    else if (e.key === "/") { e.preventDefault(); document.querySelector(".search input").focus(); }
    else if (e.key === "Escape") { closeLightbox(); closeSide(); }
  });

  // Поиск по тексту текущего языка: заголовки, абзацы, шаги, таблицы, подписи
  var input = document.querySelector(".search input"), results = document.querySelector(".results");
  function closeResults() { results.classList.remove("open"); }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) { closeResults(); return; }
    var out = [], n = 0, re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    document.querySelectorAll("[data-lang='" + state.lang + "'] section.chapter").forEach(function (sec) {
      var chId = sec.dataset.id, head = TITLES[state.lang][chId], sub = null, subTitle = null;
      sec.querySelectorAll("h3, p, li, td, figcaption").forEach(function (el) {
        if (el.tagName === "H3") { sub = el.id; subTitle = el.textContent; }
        var text = el.textContent, pos = text.toLowerCase().indexOf(q);
        if (pos < 0 || n >= 40) return;
        n++;
        var from = Math.max(0, pos - 60), to = Math.min(text.length, pos + q.length + 90);
        var snip = (from ? "…" : "") + text.slice(from, to) + (to < text.length ? "…" : "");
        var hl = esc(snip).replace(re, function (m) { return "<mark>" + m + "</mark>"; });
        out.push("<a href='#' data-go data-id='" + chId + "' data-sub='" + (sub || "") + "'><span class='where'>" + esc(head) + (subTitle ? " › " + esc(subTitle) : "") + "</span>" + hl + "</a>");
      });
    });
    results.innerHTML = out.length ? out.join("") : "<div class='none'>" + LBL[state.lang].nothing + "</div>";
    results.classList.add("open");
  }
  input.addEventListener("input", function () { search(input.value); });
  input.addEventListener("focus", function () { if (input.value.trim().length >= 2) search(input.value); });
  document.addEventListener("click", function (e) { if (!e.target.closest(".search")) closeResults(); });
  results.addEventListener("click", function () { closeResults(); input.blur(); });

  var toTop = document.querySelector(".to-top");
  window.addEventListener("scroll", function () { toTop.classList.toggle("show", window.scrollY > 600); }, { passive: true });
  toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

  var p = parseHash();
  if (p) { if (p.lang) state.lang = p.lang; state.id = p.id; }
  render(p ? p.sub : null, false);
})();
"""

def group_of(cid):
    if cid == "rollout": return "grp:rollout"
    if cid == "roles" or cid.startswith("role-"): return "grp:roles"
    if cid == "money": return "grp:money"
    if cid in ("faq", "glossary"): return "grp:help"
    return None

def build_reader():
    """docs/manual/index.html — оба языка в одном файле, переключение без перезагрузки."""
    chapters = [{"id": ch["id"], "group": group_of(ch["id"])} for ch in DOC["chapters"]]
    titles, sides, mains, chips = {}, {}, {}, {}
    for lang in LANGS:
        tx = lambda t: (t or {}).get(lang) or (t or {}).get("ru") or ""
        titles[lang] = {"doc": tx(DOC["title"])}
        titles[lang].update(GRP[lang])
        fig_state = {"n": 0}
        side, main, last_grp = [], [], None
        for ch in DOC["chapters"]:
            body, subs = render_chapter(lang, ch, fig_state)
            titles[lang][ch["id"]] = tx(ch["title"])
            g = group_of(ch["id"])
            if g and g != last_grp:
                side.append(f"<div class='grp'>{esc(GRP[lang][g])}</div>")
                last_grp = g
            side.append(f"<a href='#{lang}/{ch['id']}' data-go data-id='{ch['id']}'>{esc(tx(ch['title']))}</a>")
            for sid, title in subs:
                side.append(f"<a class='sub hide' href='#{lang}/{ch['id']}/{sid}' data-go data-id='{ch['id']}' data-sub='{sid}'>{esc(title)}</a>")
            main.append(f"<section class='chapter' data-id='{ch['id']}'><h2>{esc(tx(ch['title']))}</h2>{body}"
                        f"<div class='pager'><button class='prev' data-go data-id='{ch['id']}'></button><button class='next' data-go data-id='{ch['id']}'></button></div></section>")
        sides[lang] = "".join(side)
        mains[lang] = "".join(main)
        chips[lang] = "".join(f"<button data-go data-id='{ch['id']}'>{esc(tx(ch['title']).split(' (')[0])}</button>" for ch in DOC["chapters"] if ch["id"].startswith("role-"))
    # Скрипт — отдельным файлом: внутри продукта действует CSP script-src 'self',
    # и встроенный <script> там не выполнится.
    js = ("window.CHAPTERS=" + json.dumps(chapters, ensure_ascii=False) + ";window.TITLES=" + json.dumps(titles, ensure_ascii=False)
          + ";window.LBL=" + json.dumps(READER_LBL, ensure_ascii=False) + ";\n" + READER_JS)
    (OUT / "reader.js").write_text(js, encoding="utf-8", newline="\n")
    js_data = "<script src='reader.js' defer></script>"
    R = READER_LBL
    both = lambda key: "".join(f"<span data-lang='{l}'>{esc(R[l][key])}</span>" for l in LANGS)
    page = f"""<!doctype html><html lang='ru' data-ui='ru'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<title>{esc(titles['ru']['doc'])}</title>{FONTS}<style>{READER_CSS}</style></head><body>
<header class='top'>
  <button class='menu-btn' aria-label='{esc(R['ru']['menu'])}'>☰ {both('sections')}</button>
  <a class='brand' href='#' data-go data-id='{DOC['chapters'][0]['id']}'>{'<img src="' + LOGO_URI + '" alt="Warehouse Pro">' if LOGO_URI else 'Warehouse Pro'}<span data-lang='ru'>· {esc(R['ru']['doc'])}</span><span data-lang='uz'>· {esc(R['uz']['doc'])}</span></a>
  <nav class='chips'><span class='lbl'>{both('iam')}</span>{''.join(f"<span data-lang='{l}' style='display:contents'>{chips[l]}</span>" for l in LANGS)}</nav>
  <div class='search'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' aria-hidden='true'><circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/></svg>
    <input type='search' placeholder='{esc(R['ru']['search'])}' data-ph-ru='{esc(R['ru']['search'])}' data-ph-uz='{esc(R['uz']['search'])}' aria-label='{esc(R['ru']['search'])}'><div class='results'></div></div>
  <div class='lang'><button data-lang='ru'>RU</button><button data-lang='uz'>UZ</button></div>
  <button class='print-btn'>{both('print')}</button>
</header>
<div class='backdrop'></div>
<div class='shell'>
  <aside class='side'>{''.join(f"<nav data-lang='{l}'>{sides[l]}</nav>" for l in LANGS)}</aside>
  <main class='content'>
    <div class='crumb'><span class='where'></span><span class='pos'></span></div>
    {''.join(f"<div data-lang='{l}'>{mains[l]}</div>" for l in LANGS)}
  </main>
</div>
<div class='lightbox' role='dialog'><img alt=''><div class='cap'></div></div>
<button class='to-top'>↑ {both('toTop')}</button>
{js_data}</body></html>"""
    (OUT / "index.html").write_text(page, encoding="utf-8", newline="\n")

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for lang in LANGS:
        build(lang)
    build_reader()
    n = len(list(IMG.glob("*.webp"))) if IMG.exists() else 0
    print(f"{OUT}: manual.ru.html, manual.uz.html, index.html, images {n}")
