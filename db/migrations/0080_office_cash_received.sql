UPDATE `payments` p LEFT JOIN `users` u ON u.`id` = p.`created_by`
SET p.`received_at` = COALESCE(p.`paid_at`, p.`created_at`), p.`received_by` = u.`id`
WHERE p.`type` = 'payment' AND p.`payment_method` = 'cash' AND p.`received_at` IS NULL
  AND (u.`id` IS NULL OR u.`role` IN ('ceo', 'operator', 'superadmin'));
