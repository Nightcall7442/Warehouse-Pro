#!/usr/bin/env node
/*
  Плёнка для лендинга: видео → кадры webp → запись в src/components/landing/film.ts.

    node scripts/landing-film.mjs <видео.mp4> <имя> [fps=8] [widths=960,1920] [quality=66]

  Нужен ffmpeg в PATH (локально его нет — резать в CI или в песочнице
  Higgsfield, а сюда класть готовую папку кадров: тогда скрипт запускается
  с --frames-only и лишь пересчитывает манифест):

    node scripts/landing-film.mjs --frames-only <имя>

  Кадры ложатся в public/landing/film/<имя>/w<ширина>/001.webp… — по папке на
  ширину; первый кадр — постер под холстом, поэтому он должен быть самым
  «спокойным» кадром ролика. Меньшая ширина получает качество на 4 выше:
  на телефоне кадр смотрят вплотную.
*/
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = process.argv.slice(2);
const framesOnly = args[0] === "--frames-only";
const [video, name, fps = "8", widthsArg = "960,1920", quality = "66"] = framesOnly ? [null, args[1]] : args;
const widths = widthsArg.split(",").map(Number).filter(Boolean).sort((a, b) => a - b);
if (!name) { console.error("usage: node scripts/landing-film.mjs <video.mp4> <name> [fps] [width] [quality] | --frames-only <name>"); process.exit(1); }

const dir = join(ROOT, "public", "landing", "film", name);
if (!framesOnly) {
  rmSync(dir, { recursive: true, force: true });
  for (const w of widths) {
    const sub = join(dir, `w${w}`);
    mkdirSync(sub, { recursive: true });
    const q = String(Number(quality) + (w === widths.at(-1) ? 0 : 4));
    execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `fps=${fps},scale=${w}:-2`, "-c:v", "libwebp", "-quality", q, "-compression_level", "6", join(sub, "%03d.webp")], { stdio: "inherit" });
  }
}
if (!existsSync(dir)) { console.error(`нет папки ${dir}`); process.exit(1); }
const found = readdirSync(dir).filter(d => /^w\d+$/.test(d)).map(d => Number(d.slice(1))).sort((a, b) => a - b);
if (found.length === 0) { console.error("папок w<ширина> нет"); process.exit(1); }
const framesOf = w => readdirSync(join(dir, `w${w}`)).filter(f => /^\d{3}\.webp$/.test(f)).sort();
const frames = framesOf(found.at(-1));
if (frames.length === 0) { console.error("кадров нет"); process.exit(1); }
for (const w of found) if (framesOf(w).length !== frames.length) { console.error(`в w${w} кадров не столько, сколько в w${found.at(-1)}`); process.exit(1); }

// Размер — из заголовка первого webp (VP8/VP8L/VP8X), без зависимостей.
function webpSize(buf) {
  const tag = buf.toString("ascii", 12, 16);
  if (tag === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (tag === "VP8L") { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
  return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
}
const size = webpSize(readFileSync(join(dir, `w${found.at(-1)}`, frames[0])));

const filmPath = join(ROOT, "src", "components", "landing", "film.ts");
const src = readFileSync(filmPath, "utf8");
const line = `  ${name}: { count: ${frames.length}, width: ${size.width}, height: ${size.height}, fps: ${Number(fps)}, widths: [${found.join(", ")}] },`;
const re = new RegExp(`^  ${name}: \{[^\n]*\},\n`, "m");
const next = re.test(src) ? src.replace(re, line + "\n") : src.replace(/^} as const;/m, `${line}\n} as const;`);
writeFileSync(filmPath, next);
console.log(`${name}: ${frames.length} кадров ${size.width}×${size.height}, ширины ${found.join("/")} → film.ts`);
