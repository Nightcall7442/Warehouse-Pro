UPDATE `payments` r JOIN `payments` o ON o.`id` = r.`reversal_of`
SET r.`received_at` = o.`received_at`, r.`received_by` = o.`received_by`
WHERE r.`received_at` IS NULL AND o.`received_at` IS NOT NULL;
