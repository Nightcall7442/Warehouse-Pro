import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isSafePhotoValue, SAFE_IMAGE_TYPES } from "../lib/photo-value";

/**
 * Поле фотографии — вход, доступный роли агента.
 *
 * Ручки agent.uploadMyShopPhoto и agent.saveVisitPhoto открыты самой
 * многочисленной роли и принимали `z.string().url()` — то есть ЛЮБОЙ адрес, —
 * а также любой подтип data:image/, включая svg+xml.
 *
 * Отсюда две беды:
 *
 *  • SVG — документ со сценариями. Отданный с нашего домена как image/svg+xml
 *    и открытый по прямой ссылке, он выполняет их в нашем происхождении, со
 *    всеми куками. Внутри тега img он безопасен, но ссылку на фотографию
 *    можно открыть и отдельной вкладкой.
 *
 *  • Ручка /api/photos/product/:id переадресовывала на сохранённый адрес —
 *    любой. Ссылка на чужой сайт, начинающаяся с настоящего адреса системы:
 *    такую удобно вставлять в письма, ей верят.
 */

describe("Что принимается в поле фотографии", () => {
  it("обычные картинки проходят", () => {
    expect(isSafePhotoValue("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isSafePhotoValue("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isSafePhotoValue("data:image/webp;base64,UklGRg==")).toBe(true);
  });

  it("SVG не проходит", () => {
    // Ровно то, чем внедряют сценарий: тип валиден по прежнему выражению
    // /^data:(image\/[\w.+-]+);base64,/ и потому проходил насквозь.
    expect(isSafePhotoValue("data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==")).toBe(false);
    expect(isSafePhotoValue("data:image/SVG+XML;base64,PHN2Zz4=")).toBe(false);
  });

  it("не-картинки не проходят, как бы ни выглядели", () => {
    expect(isSafePhotoValue("data:text/html;base64,PGgxPtCf")).toBe(false);
    expect(isSafePhotoValue("data:application/javascript;base64,YWxlcnQ=")).toBe(false);
    expect(isSafePhotoValue("data:image/png,notbase64")).toBe(false);
    expect(isSafePhotoValue("")).toBe(false);
    expect(isSafePhotoValue("просто строка")).toBe(false);
  });

  it("ссылка принимается только по https", () => {
    expect(isSafePhotoValue("https://bucket.s3.eu-north-1.amazonaws.com/a.jpg")).toBe(true);
    // Открытым текстом фотографии ходить незачем, да и подменить их проще.
    expect(isSafePhotoValue("http://example.com/a.jpg")).toBe(false);
    expect(isSafePhotoValue("//example.com/a.jpg")).toBe(false);
    expect(isSafePhotoValue("javascript:alert(1)")).toBe(false);
  });

  it("список типов белый, а не чёрный", () => {
    // Новый опасный тип не должен проходить сам собой оттого, что его забыли
    // внести в перечень запрещённых.
    expect(SAFE_IMAGE_TYPES.has("image/svg+xml")).toBe(false);
    expect(SAFE_IMAGE_TYPES.has("image/png")).toBe(true);
  });
});

describe("Куда позволено переадресовывать", () => {
  const OLD = { ...process.env };

  beforeEach(() => {
    process.env.S3_BUCKET = "wp-photos";
    process.env.S3_REGION = "eu-north-1";
  });

  afterEach(() => {
    process.env = { ...OLD };
  });

  async function guard() {
    const mod = await import("../photos");
    return mod.isAllowedPhotoTarget;
  }

  it("на своё хранилище — можно", async () => {
    const ok = await guard();
    expect(ok("https://wp-photos.s3.eu-north-1.amazonaws.com/products/1/a.jpg")).toBe(true);
  });

  it("на чужой адрес — нельзя", async () => {
    const ok = await guard();
    expect(ok("https://evil.example.com/a.jpg")).toBe(false);
    // Похожие имена не должны обманывать: проверка точная, а не «начинается с»
    // и не «содержит».
    expect(ok("https://wp-photos.s3.eu-north-1.amazonaws.com.evil.com/a.jpg")).toBe(false);
    expect(ok("https://evil-wp-photos.s3.eu-north-1.amazonaws.com/a.jpg")).toBe(false);
  });

  it("по http — нельзя даже на своё хранилище", async () => {
    const ok = await guard();
    expect(ok("http://wp-photos.s3.eu-north-1.amazonaws.com/a.jpg")).toBe(false);
  });

  it("мусор вместо адреса — нельзя", async () => {
    const ok = await guard();
    expect(ok("не адрес")).toBe(false);
    expect(ok("")).toBe(false);
  });
});
