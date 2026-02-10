-- Seed admin user for local development
-- Password: "admin123" — generate hash with: node -e "require('bcryptjs').hash('admin123', 10).then(console.log)"
-- Replace the placeholder hash before running
INSERT OR IGNORE INTO users (id, email, name, password_hash, role, language_preference, profile)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'greg@teachinspire.com',
  'Greg',
  '$2a$10$REPLACE_WITH_GENERATED_HASH',
  'admin',
  'fr',
  '{}'
);
