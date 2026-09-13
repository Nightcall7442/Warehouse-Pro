# -*- coding: utf-8 -*-
"""
Собирает «Руководство дистрибьютора» из содержания (scripts/manual_content.py)
и снимков (артефакт screenshots с index.json и выносками).

Выход: docs/manual/manual.ru.html, manual.uz.html (печатная вёрстка A4, из них
scripts/manual-pdf.mjs делает PDF), docs/manual/img/*.webp с нарисованными
цифрами выносок.

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

def build(lang):
    L = LBL[lang]
    tx = lambda t: (t or {}).get(lang) or (t or {}).get("ru") or ""
    parts = []
    fig_no = 0
    # обложка
    parts.append(f"""<div class="page"><div class="cover">
      <div>{'<img class="logo" src="' + LOGO_URI + '" alt="Warehouse Pro">' if LOGO_URI else ''}</div>
      <div><h1>{esc(tx(DOC['title']))}</h1><p class="sub">{esc(tx(DOC['subtitle']))}</p>
        <p class="who">{esc(tx(DOC['chapters'][0]['blocks'][0]['x']))}</p>
        <div class="roles">{''.join(f"<span>{esc(tx(ch['title']))}</span>" for ch in DOC['chapters'] if ch['id'].startswith('role-'))}</div></div>
      <div class="band"><span>{esc(tx(DOC['edition']))}</span><span>warehouse-pro.uz</span></div>
    </div></div>""")
    # оглавление
    toc = ["<div class='toc'><h2>%s</h2><ol>" % esc(L["toc"])]
    for ch in DOC["chapters"]:
        toc.append(f"<li><a href='#{ch['id']}'>{esc(tx(ch['title']))}</a></li>")
        for b in ch["blocks"]:
            if b["t"] == "h3":
                toc.append(f"<li class='sub'><span>{esc(tx(b['x']))}</span></li>")
    toc.append("</ol></div>")
    parts.append("".join(toc))
    # главы
    for ch in DOC["chapters"]:
        out = [f"<section class='chapter' id='{ch['id']}'><h2>{esc(tx(ch['title']))}</h2>"]
        for b in ch["blocks"]:
            t = b["t"]
            if t == "p": out.append(f"<p>{esc(tx(b['x']))}</p>")
            elif t == "h3": out.append(f"<h3>{esc(tx(b['x']))}</h3>")
            elif t == "steps": out.append("<ol class='steps'>" + "".join(f"<li>{esc(tx(i))}</li>" for i in b["items"]) + "</ol>")
            elif t == "bullets": out.append("<ul class='bullets'>" + "".join(f"<li>{esc(tx(i))}</li>" for i in b["items"]) + "</ul>")
            elif t in ("tip", "warn"): out.append(f"<div class='box {t}'><b>{esc(L[t])}</b>{esc(tx(b['x']))}</div>")
            elif t == "check": out.append(f"<div class='box'><b>{esc(L['check'])}</b><ul class='check'>" + "".join(f"<li>{esc(tx(i))}</li>" for i in b["items"]) + "</ul></div>")
            elif t == "table":
                out.append("<table><thead><tr>" + "".join(f"<th>{esc(tx(h))}</th>" for h in b["header"]) + "</tr></thead><tbody>"
                           + "".join("<tr>" + "".join(f"<td>{esc(tx(c))}</td>" for c in row) + "</tr>" for row in b["rows"]) + "</tbody></table>")
            elif t == "role":
                out.append("<div class='role'>" + "".join(f"<div><b>{esc(L[k])}</b>{esc(tx(b[k]))}</div>" for k in ("morning", "day", "evening")) + "</div>")
            elif t == "fig":
                kind, role, screen = b["fig"]
                rel, found = render_image(kind, lang, role, screen, b.get("callouts", []))
                if not rel:
                    continue
                fig_no += 1
                texts = {key: txt for key, txt in b.get("callouts", [])}
                legend = "".join(f"<li><span class='n'>{n}</span><span>{esc(tx(texts[key]))}</span></li>" for n, key in found)
                cap = f"<figcaption>{esc(L['fig'])} {fig_no}. {esc(tx(b['cap']))}</figcaption>" + (f"<ul class='legend'>{legend}</ul>" if legend else "")
                if kind == "mobile":
                    out.append(f"<figure class='mobile'><img src='{rel}' alt='{esc(tx(b['cap']))}'><div>{cap}</div></figure>")
                else:
                    out.append(f"<figure><img src='{rel}' alt='{esc(tx(b['cap']))}'>{cap}</figure>")
        out.append("</section>")
        parts.append("".join(out))
    page = (f"<!doctype html><html lang='{lang}'><head><meta charset='utf-8'><title>{esc(tx(DOC['title']))}</title>{FONTS}<style>{CSS}</style></head><body>"
            + parts[0] + "<div class='page'>" + "".join(parts[1:]) + "</div></body></html>")
    (OUT / f"manual.{lang}.html").write_text(page, encoding="utf-8", newline="\n")

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for lang in LANGS:
        build(lang)
    n = len(list(IMG.glob("*.webp"))) if IMG.exists() else 0
    print(f"{OUT}: manual.ru.html, manual.uz.html, images {n}")
