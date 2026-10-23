ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ambulance_subrole VARCHAR(20),
    ADD COLUMN IF NOT EXISTS ambulance_id INTEGER REFERENCES ambulances(id) ON DELETE SET NULL;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL;

ALTER TABLE emergencies
    ADD COLUMN IF NOT EXISTS priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL';

ALTER TABLE emergencies
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(36);

ALTER TABLE ambulances
    ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

ALTER TABLE emergency_assignments
    ALTER COLUMN hospital_id DROP NOT NULL;

UPDATE users AS crew
SET ambulance_subrole = 'EC_DRIVER', ambulance_id = ambulance.id
FROM ambulances AS ambulance
WHERE ambulance.driver_user_id = crew.id
  AND crew.ambulance_subrole IS NULL;

CREATE TABLE IF NOT EXISTS emergency_actions (
    id SERIAL PRIMARY KEY,
    emergency_id INTEGER NOT NULL REFERENCES emergencies(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    ambulance_id INTEGER REFERENCES ambulances(id),
    action_type VARCHAR(30) NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_emergency_actions_emergency_id ON emergency_actions (emergency_id);
CREATE INDEX IF NOT EXISTS ix_emergency_actions_user_id ON emergency_actions (user_id);
CREATE INDEX IF NOT EXISTS ix_emergency_actions_ambulance_id ON emergency_actions (ambulance_id);
CREATE INDEX IF NOT EXISTS ix_users_ambulance_id ON users (ambulance_id);
CREATE INDEX IF NOT EXISTS ix_users_hospital_id ON users (hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_emergencies_user_idempotency_key
    ON emergencies (user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;