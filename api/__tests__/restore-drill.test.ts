/**
 * Репетиция восстановления: разбор копии на выражения и её место в расписании.
 * Само разворачивание — на настоящей базе: real-db/restore-drill.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { splitStatements, scratchDatabaseName } from "../cron/restore-drill";

describe("разбор копии на выражения", () => {
  it("режет по «;» в конце строки, комментарии и пустые строки отбрасывает", () => {
    const sql = [
      "-- Warehouse Pro — логическая копия",
      "",
      "/*!40101 SET NAMES utf8mb4 */;",
      "DROP TABLE IF EXISTS `t`;",
      "CREATE TABLE `t` (",
      "  `id` int NOT NULL,",
      "  `note` varchar(10) DEFAULT 'a;b'",
      ") ENGINE=InnoDB;",
      "",
      "INSERT INTO `t` (`id`,`note`) VALUES (1,'x;\\ny'),(2,NULL);",
    ].join("\n");
    const out = splitStatements(sql);
    expect(out).toHaveLength(4);
    expect(out[2]).toMatch(/^CREATE TABLE `t` \([\s\S]*\) ENGINE=InnoDB$/);
    expect(out[3]).toBe("INSERT INTO `t` (`id`,`note`) VALUES (1,'x;\\ny'),(2,NULL)");
  });

  it("тело триггера между DELIMITER ;; — одно выражение", () => {
    const sql = [
      "DROP TRIGGER IF EXISTS `tr`;",
      "DELIMITER ;;",
      "CREATE TRIGGER `tr` BEFORE INSERT ON `t` FOR EACH ROW BEGIN",
      "  SET NEW.id = NEW.id + 1;",
      "  SET NEW.note = 'z';",
      "END;;",
      "DELIMITER ;",
      "SET FOREIGN_KEY_CHECKS=1;",
    ].join("\n");
    const out = splitStatements(sql);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatch(/^CREATE TRIGGER[\s\S]*END$/);
    expect(out[1]).toContain("SET NEW.id = NEW.id + 1;");
    expect(out[2]).toBe("SET FOREIGN_KEY_CHECKS=1");
  });

  it("черновая база названа по боевой — её не спутать и не жалко стереть", () => {
    expect(scratchDatabaseName("railway")).toBe("railway_restore_drill");
  });
});

describe("место в расписании и в тревогах", () => {
  it("раз в неделю после ночной копии; метрика и тревога на неё есть", () => {
    const sched = readFileSync("api/cron/scheduler.ts", "utf-8");
    expect(sched).toContain('name: "restore-drill"');
    expect(sched).toContain("daily: { hour: 5, minute: 0, weekday: 0 }");
    expect(readFileSync("api/prometheus-metrics.ts", "utf-8")).toContain("backup_restore_drill_last_success_timestamp_seconds");
    const alerts = readFileSync("docs/observability/alerts.yml", "utf-8");
    expect(alerts).toContain("alert: РепетицияВосстановленияУстарела");
    expect(alerts).toContain("backup_restore_drill_last_success_timestamp_seconds > 8 * 86400");
  });

  it("черновая база стирается, чем бы ни кончилось дело", () => {
    const src = readFileSync("api/cron/restore-drill.ts", "utf-8");
    const fin = src.slice(src.indexOf("} finally {"));
    expect(fin).toContain("DROP DATABASE IF EXISTS");
  });
});
