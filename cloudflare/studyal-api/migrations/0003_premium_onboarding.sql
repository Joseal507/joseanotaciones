
ALTER TABLE users ADD COLUMN onboarding_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT;

ALTER TABLE profiles ADD COLUMN edad INTEGER;
ALTER TABLE profiles ADD COLUMN es_menor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN permiso_menor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN tipo_usuario TEXT;
ALTER TABLE profiles ADD COLUMN escuela TEXT;
ALTER TABLE profiles ADD COLUMN referral_source TEXT;
ALTER TABLE profiles ADD COLUMN objetivo TEXT;

UPDATE users SET onboarding_version = 0, onboarding_completed = 0;
UPDATE profiles SET onboarding_completo = 0;
