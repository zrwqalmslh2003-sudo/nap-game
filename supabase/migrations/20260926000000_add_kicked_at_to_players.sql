ALTER TABLE players ADD COLUMN IF NOT EXISTS kicked_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN players.kicked_at IS 'Timestamp when the player was kicked by the host. NULL = not kicked.';
