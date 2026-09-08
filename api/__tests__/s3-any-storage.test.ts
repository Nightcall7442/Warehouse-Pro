/**
 * Хранилище не обязано быть амазоновским.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Клиент S3 создавался в шести местах, а публичный адрес файла собирался
 * строкой в четырёх — и всегда по амазоновскому образцу:
 *
 *     https://<бакет>.s3.<регион>.amazonaws.com/<ключ>
 *
 * Любое S3-совместимое хранилище — Cloudflare R2, Backblaze B2, Yandex Object
 * Storage — говорит по тому же протоколу, но раздаёт файлы по своему домену.
 * Загрузка туда прошла бы успешно, а ссылка получилась бы неверной: фотография
 * лежит на месте и не открывается. Виноватой выглядела бы «загрузка».
 *
 * Отдельно опасна проверка в /api/photos: она разрешала переадресацию ровно на
 * амазоновский хост. На чужом хранилище она отвергала бы наши же файлы.
 *
 * ── Почему это важно именно сейчас ──────────────────────────────────────────
 *
 * У R2 бесплатны 10 ГБ и, что важнее, раздача. Фотографии товаров тянут при
 * каждом открытии каталога, и на обычном S3 счёт растёт именно от неё.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const env: Record<string, unknown> = {};
vi.mock("../lib/env", () => ({ env }));

const { publicUrl, allowedPhotoHost, isS3Configured, serverSideEncryption } = await import("../lib/s3");

beforeEach(() => {
  env.s3Bucket = "wp-photos";
  env.s3Region = "eu-central-1";
  env.s3AccessKey = "ключ";
  env.s3SecretKey = "секрет";
  env.s3Endpoint = "";
  env.s3PublicUrl = "";
  env.s3ForcePathStyle = false;
});

describe("адрес файла", () => {
  it("без своего домена — привычный амазоновский", () => {
    expect(publicUrl("products/1/a.jpg"))
      .toBe("https://wp-photos.s3.eu-central-1.amazonaws.com/products/1/a.jpg");
  });

  it("со своим доменом — он и используется", () => {
    // Так выглядит выданный R2 домен.
    env.s3PublicUrl = "https://pub-abc123.r2.dev";
    expect(publicUrl("products/1/a.jpg")).toBe("https://pub-abc123.r2.dev/products/1/a.jpg");
  });

  it("лишняя косая черта в настройке не ломает ссылку", () => {
    env.s3PublicUrl = "https://cdn.example.com/";
    expect(publicUrl("shops/2/b.png")).toBe("https://cdn.example.com/shops/2/b.png");
  });
});

describe("куда разрешено переадресовывать", () => {
  it("на амазоновский хост, когда своего домена нет", () => {
    expect(allowedPhotoHost()).toBe("wp-photos.s3.eu-central-1.amazonaws.com");
  });

  it("на свой домен, когда он задан", () => {
    env.s3PublicUrl = "https://pub-abc123.r2.dev";
    expect(allowedPhotoHost()).toBe("pub-abc123.r2.dev");
  });

  it("хост совпадает с тем, куда ведут сами ссылки", () => {
    /*
      Главное правило. Разойдись эти двое — и приложение выдавало бы ссылки,
      которые само же и отвергает: фотографии не открывались бы, а причина
      лежала бы в проверке безопасности, куда за ней никто не пойдёт.
    */
    for (const base of ["", "https://pub-abc123.r2.dev", "https://cdn.example.com"]) {
      env.s3PublicUrl = base;
      const url = new URL(publicUrl("products/1/a.jpg"));
      expect(url.hostname).toBe(allowedPhotoHost());
    }
  });

  it("кривой адрес в настройке не открывает дверь", () => {
    // «Не смогли разобрать» обязано значить «никуда», а не «куда угодно».
    env.s3PublicUrl = "не адрес";
    expect(allowedPhotoHost()).toBeNull();
  });

  it("без хранилища переадресации нет вовсе", () => {
    env.s3Bucket = "";
    expect(allowedPhotoHost()).toBeNull();
    expect(isS3Configured()).toBe(false);
  });
});

describe("просьба зашифровать", () => {
  it("на AWS — просим", () => {
    // Там объект ляжет незашифрованным, если не попросить.
    expect(serverSideEncryption()).toEqual({ ServerSideEncryption: "AES256" });
  });

  it("на чужом хранилище — не просим", () => {
    /*
      R2 и B2 шифруют содержимое сами и всегда, а незнакомый заголовок
      отвергают вместе со всем запросом. Отправь мы его — ночная копия падала
      бы КАЖДУЮ ночь ради шифрования, которое там и так включено, и увидели бы
      это не раньше, чем копия понадобится.
    */
    env.s3Endpoint = "https://abc123.r2.cloudflarestorage.com";
    expect(serverSideEncryption()).toEqual({});
  });
});
