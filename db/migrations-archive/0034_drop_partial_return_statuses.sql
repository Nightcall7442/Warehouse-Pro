-- Drops the "partially_returned" and "partial_return_kept" order statuses.
-- A partial return is now expressed by editing the order's lines (the returned
-- units go back to stock and off the total), and a partial payment by the
-- payment row plus the shop's debt — neither needs a status of its own.
-- Any surviving rows are folded into the status they actually represent:
-- goods were handed over, so they are delivered.
UPDATE `orders` SET `status` = 'delivered'
WHERE `status` IN ('partially_returned', 'partial_return_kept');
--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `status`
  enum('new','processing','shipped','pending','delivered','cancelled','returned')
  NOT NULL DEFAULT 'new';
