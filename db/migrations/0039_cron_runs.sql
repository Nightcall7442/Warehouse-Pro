CREATE TABLE `cron_runs` (
	`job` varchar(64) NOT NULL,
	`last_success_at` timestamp,
	`last_error_at` timestamp,
	`last_error` text,
	CONSTRAINT `cron_runs_job` PRIMARY KEY(`job`)
);
