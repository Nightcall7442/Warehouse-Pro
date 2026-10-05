import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { serveStaticFiles } from "../lib/vite";
import { VIDEO_SRC, VIDEO_POSTER, VIDEO_SECONDS } from "../../src/components/pitch/pitch-content";

/**
 * Демо-ролик на /demo: как его отдаёт сервер и что лежит в репозитории.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. Сервер отдаёт ролик КУСКАМИ: на «Range: bytes=…» — 206 с Content-Range.
 *    Без этого Safari на iPhone ролик не играет вовсе, а перемотка в Chrome
 *    качает все 14 МБ с начала. Проверяется тот же serveStaticFiles, что в
 *    бою, со сжатием перед ним, как в boot.ts: сжатый 206 — битый ролик.
 * 2. HEAD и тип video/mp4; ролика нет — 404, а не оболочка приложения
 *    (иначе плеер получил бы HTML и показал бы сломанный значок).
 * 3. /pitch при папке public/pitch/ рядом — по-прежнему страница с карточкой,
 *    а не 404 и не список файлов: папка и маршрут называются одинаково.
 * 4. Файлы в репозитории: ролик — настоящий MP4 с moov ДО mdat (faststart:
 *    играет, не докачавшись), длительность совпадает с подписью на странице,
 *    обложка на месте; service worker не кладёт их в предкэш (14 МБ на
 *    каждый телефон с установленной PWA — при первом же обновлении).
 */

const VIDEO_FILE = path.join("public", VIDEO_SRC);
const POSTER_FILE = path.join("public", VIDEO_POSTER);

let root = "";
const SIZE = 5000;
let app: Hono;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "p13-static-"));
  mkdirSync(path.join(root, "pitch"));
  writeFileSync(path.join(root, "index.html"), readFileSync("index.html", "utf8"));
  writeFileSync(path.join(root, "pitch", "demo-uz.mp4"), Buffer.alloc(SIZE, 7));
  app = new Hono();
  app.use("*", compress());
  serveStaticFiles(app as never, { root });
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe("сервер отдаёт ролик", () => {
  it("Range — 206 с Content-Range и нужной длиной, без сжатия", async () => {
    const r = await app.request(VIDEO_SRC, { headers: { range: "bytes=100-1099", "accept-encoding": "gzip, br" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-range")).toBe(`bytes 100-1099/${SIZE}`);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-encoding")).toBeNull();
    expect((await r.arrayBuffer()).byteLength).toBe(1000);
  });

  it("открытый диапазон «с N до конца» — то, что шлёт Safari", async () => {
    const r = await app.request(VIDEO_SRC, { headers: { range: `bytes=${SIZE - 10}-` } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes ${SIZE - 10}-${SIZE - 1}/${SIZE}`);
    expect((await r.arrayBuffer()).byteLength).toBe(10);
  });

  it("HEAD — 200, video/mp4 и размер", async () => {
    const r = await app.request(VIDEO_SRC, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-length")).toBe(String(SIZE));
  });

  it("ролика нет — 404 JSON, а не оболочка приложения", async () => {
    const r = await app.request("/pitch/nope.mp4", { headers: { accept: "*/*" } });
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toMatch(/json/);
  });

  it("/pitch рядом с папкой public/pitch — страница с карточкой", async () => {
    const r = await app.request("/pitch", { headers: { accept: "text/html" } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('<html lang="uz"');
    expect(html).toContain("Pitch Day 3.0");
  });
});

describe("ролик в репозитории", () => {
  const video = readFileSync(VIDEO_FILE);

  it("настоящий MP4, faststart: moov раньше mdat", () => {
    expect(video.subarray(4, 8).toString("latin1")).toBe("ftyp");
    const moov = video.indexOf("moov", 0, "latin1");
    const mdat = video.indexOf("mdat", 0, "latin1");
    expect(moov).toBeGreaterThan(0);
    expect(moov).toBeLessThan(mdat);
  });

  it("длительность — как в подписи на странице (2:44)", () => {
    // mvhd: версия(1) флаги(3) создан(4) изменён(4) timescale(4) duration(4) — для версии 0.
    const at = video.indexOf("mvhd", 0, "latin1") + 4;
    expect(video[at]).toBe(0);
    const timescale = video.readUInt32BE(at + 12);
    const duration = video.readUInt32BE(at + 16);
    expect(Math.floor(duration / timescale)).toBe(VIDEO_SECONDS);
    expect(VIDEO_SECONDS).toBe(2 * 60 + 44);
  });

  it("размер разумный для страницы, обложка на месте", () => {
    expect(statSync(VIDEO_FILE).size).toBeLessThan(25 * 1024 * 1024);
    expect(statSync(POSTER_FILE).size).toBeGreaterThan(10_000);
  });

  it("service worker не предкэширует ролик и обложку", () => {
    const cfg = readFileSync("vite.config.ts", "utf8");
    const glob = cfg.match(/globPatterns:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(glob).not.toBe("");
    expect(glob).not.toMatch(/mp4|jpe?g|webm/);
  });
});
