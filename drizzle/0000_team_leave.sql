CREATE TABLE `people` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL UNIQUE, `name` text NOT NULL, `allowance` integer NOT NULL DEFAULT 25, `used` integer NOT NULL DEFAULT 0, `role` text NOT NULL DEFAULT 'employee');
CREATE TABLE `requests` (`id` text PRIMARY KEY NOT NULL, `person` text NOT NULL REFERENCES `people`(`id`), `start` text NOT NULL, `end` text NOT NULL, `type` text NOT NULL DEFAULT 'Vacation', `status` text NOT NULL DEFAULT 'pending', `note` text NOT NULL DEFAULT '', `decision_note` text NOT NULL DEFAULT '', `submitted` text NOT NULL, `decided` text);
CREATE INDEX `idx_requests_person_start` ON `requests` (`person`, `start`);
CREATE INDEX `idx_requests_status_start` ON `requests` (`status`, `start`);
