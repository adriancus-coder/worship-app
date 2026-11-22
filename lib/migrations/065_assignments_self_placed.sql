-- "Vin" to the invitation puts the person on their usual positions by themselves
-- (lib/assignments.js followAttendance). self_placed marks those rows: another answer takes
-- them off again, while the rows the leader (or the person as a leader) placed by hand stay.
ALTER TABLE event_assignments ADD COLUMN self_placed INTEGER NOT NULL DEFAULT 0;
