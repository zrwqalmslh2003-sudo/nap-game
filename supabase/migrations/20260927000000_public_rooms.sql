ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS room_name text;

CREATE TABLE IF NOT EXISTS room_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  reported_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_reports_room_reporter_unique UNIQUE (room_id, reported_by)
);

CREATE INDEX IF NOT EXISTS rooms_public_waiting_created_idx
  ON rooms (is_public, status, created_at DESC);
