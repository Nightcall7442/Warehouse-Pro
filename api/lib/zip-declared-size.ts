/*
  Сколько zip обещает распаковать — по его оглавлению, до распаковки.

  xlsx — это zip. Разбор (exceljs) разворачивает архив целиком в память, и
  файл в 7 МБ с миллионом одинаковых строк раскрывается в гигабайты
  (zip-бомба): оператор пробной организации клал инстанс одним импортом
  (аудит 20.09.2026). Центральный каталог в конце архива хранит размер
  каждой записи до сжатия — сумма читается за микросекунды и без
  распаковки. Архив, который врёт в оглавлении, затем не пройдёт CRC у
  разборщика, так что честного ответа хватает.

  Возвращает сумму объявленных размеров; для ZIP64 (размеры 0xFFFFFFFF) —
  Infinity: такому файлу в импорте делать нечего.
*/
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

export function zipDeclaredSize(buf: Buffer): number | null {
  if (buf.length < EOCD_MIN) return null;
  // Запись конца каталога — в последних 22 байтах + комментарий до 64 КБ.
  const from = Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT);
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cenOffset === 0xffffffff) return Infinity;

  let total = 0;
  let p = cenOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) return null;
    const uncompressed = buf.readUInt32LE(p + 24);
    if (uncompressed === 0xffffffff) return Infinity;
    total += uncompressed;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}
