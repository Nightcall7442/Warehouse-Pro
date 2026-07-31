import cron from "node-cron";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { runBackup } from "./backup";

/**
 * FIX: P0.4 — entry point for the backup container.
 *
 * The backup job used to be reachable only as an HTTP endpoint on the web process,
 * which meant it competed with live traffic and depended on an external scheduler
 * calling it. This runs in its own container (see the `backup` stage in the
 * Dockerfile) on BACKUP_SCHEDULE, and the HTTP endpoint stays for on-demand runs.
 *
 * `node dist/cron/backup-runner.js --now` runs one backup and exits — that is the
 * form to use for a manual restore drill.
 */

const runOnce = process.argv.includes("--now");

async function runAndLog(trigger: string): Promise<boolean> {
  logger.info("backup started", { trigger });
  try {
    const result = await runBackup();
    if (result.success) {
      logger.info("backup finished", {
        trigger,
        key: result.key,
        size: result.size,
        plaintextSize: result.plaintextSize,
        durationMs: result.durationMs,
        verified: result.verified,
      });
    } else {
      logger.error("backup unsuccessful", { trigger, message: result.message, durationMs: result.durationMs });
    }
    return result.success;
  } catch (err) {
    // runBackup already converts its own failures into a result; reaching here means
    // something outside it broke, and the scheduler must survive it.
    logger.error("backup threw", { trigger, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

if (runOnce) {
  const ok = await runAndLog("manual");
  process.exit(ok ? 0 : 1);
}

if (!cron.validate(env.backupSchedule)) {
  logger.error("invalid BACKUP_SCHEDULE, refusing to start", { schedule: env.backupSchedule });
  process.exit(1);
}

// noOverlap: a dump that runs longer than the interval must not start a second one
// on top of itself — two mysqldumps and two uploads would compete for the same
// database and the same object key.
const task = cron.schedule(env.backupSchedule, () => runAndLog("schedule"), {
  timezone: "UTC",
  noOverlap: true,
});

logger.info("backup scheduler started", {
  schedule: env.backupSchedule,
  timezone: "UTC",
  nextRun: task.getNextRun()?.toISOString() ?? null,
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, stopping backup scheduler`);
  await task.stop();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
