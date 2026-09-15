# -*- coding: utf-8 -*-
"""
Кадры для лендинга: docs/landing/shots/<язык>/*.webp → public/landing/<язык>/*.webp.

Сырые кадры делает CI (scripts/landing-shots-collect.mjs): веб 2880×2000,
телефон 1170×2532. На странице они стоят в оправе окна и телефона, поэтому
здесь — только приведение к весу, который можно грузить лениво:

  · веб      → 1600 px по ширине, webp q80  (≈150 КБ)
  · телефон  →  780 px по ширине, webp q82  (≈120 КБ)

Никакой обрезки и «улучшений»: кадр обязан остаться настоящим экраном.
Скругления, тени и затухание края делает CSS на странице.

Запуск: python scripts/landing_shots.py
"""
import json
import sys
from pathlib import Path

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "landing" / "shots"
OUT = ROOT / "public" / "landing"

RULES = {"web-": (1600, 80), "mobile-": (780, 82)}


MANIFEST: dict[str, dict[str, list[int]]] = {}


def note(lang: str, name: str, im: Image.Image) -> None:
    MANIFEST.setdefault(lang, {})[name] = [im.width, im.height]


def process(src: Path, dst: Path) -> str:
    kind = next((k for k in RULES if src.name.startswith(k)), None)
    if not kind:
        return "пропущен: не web-/mobile-"
    width, quality = RULES[kind]
    im = Image.open(src).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=quality, method=6)
    note(dst.parent.name, dst.stem, im)
    return f"{im.width}×{im.height}, {dst.stat().st_size // 1024} КБ"


# ── Вырезка карты для главы «Контроль» ──────────────────────────────────────
# Из кадра «Слежение» берётся только карта — без бокового меню и панели
# агентов: сверху лежит своя анимация (маршруты, заряд, пробег). Границы —
# доли кадра, чтобы вырезка переживала пересъёмку в другой плотности.
MAP_BOX = (0.408, 0.208, 0.950, 0.888)  # left, top, right, bottom


def crop_map(src: Path, dst: Path) -> str:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    box = (round(w * MAP_BOX[0]), round(h * MAP_BOX[1]), round(w * MAP_BOX[2]), round(h * MAP_BOX[3]))
    im = im.crop(box)
    if im.width > 1400:
        im = im.resize((1400, round(im.height * 1400 / im.width)), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=82, method=6)
    note(dst.parent.name, dst.stem, im)
    return f"{im.width}×{im.height}, {dst.stat().st_size // 1024} КБ"


# ── Веб-кадр без бокового меню: только содержание ───────────────────────────
# В главах о заказах, складе, деньгах кадр должен быть о своём — таблице,
# показателях, графике, — а не о меню приложения, одинаковом на каждом кадре.
# Боковое меню занимает первые 18,5 % ширины (1440 → 266 px); сверху срезаем
# полосу заголовка страницы, чтобы в оправе сразу шли показатели.
CONTENT_BOX = (0.185, 0.0, 1.0, 1.0)


def crop_content(src: Path, dst: Path) -> str:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    box = (round(w * CONTENT_BOX[0]), round(h * CONTENT_BOX[1]), round(w * CONTENT_BOX[2]), round(h * CONTENT_BOX[3]))
    im = im.crop(box)
    if im.width > 1600:
        im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, "WEBP", quality=80, method=6)
    note(dst.parent.name, dst.stem, im)
    return f"{im.width}×{im.height}, {dst.stat().st_size // 1024} КБ"


def main() -> int:
    if not SRC.exists():
        print(f"нет {SRC} — сначала CI на ветке docs/landing-*")
        return 1
    total = 0
    for lang_dir in sorted(p for p in SRC.iterdir() if p.is_dir()):
        for src in sorted(lang_dir.glob("*.webp")):
            dst = OUT / lang_dir.name / src.name
            print(f"{lang_dir.name}/{src.name}: {process(src, dst)}")
            total += 1
    for lang_dir in sorted(p for p in SRC.iterdir() if p.is_dir()):
        for src in sorted(lang_dir.glob("web-*.webp")):
            print(f"{lang_dir.name}/{src.stem}-content: {crop_content(src, OUT / lang_dir.name / (src.stem + '-content.webp'))}")
        src = lang_dir / "web-supervisor-map.webp"
        if src.exists():
            print(f"{lang_dir.name}/map-crop: {crop_map(src, OUT / lang_dir.name / 'map-crop.webp')}")
    # Размеры — для стража: пропорции в shots.ts обязаны совпадать с файлами,
    # иначе телефон в оправе выходит приземистым или обрезанным.
    (OUT / "manifest.json").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"готово: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
