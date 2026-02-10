/**
 * Seed script for local development.
 * Usage: npx tsx seed/seed.ts
 *
 * Creates an admin user with known credentials so you can log in locally.
 * Requires wrangler to be installed (uses local D1).
 */
import bcrypt from "bcryptjs";
import { execSync } from "node:child_process";

const ADMIN_EMAIL = "greg@teachinspire.com";
const ADMIN_NAME = "Greg";
const ADMIN_PASSWORD = "admin123";
const ADMIN_ID = "00000000-0000-0000-0000-000000000001";

async function seed() {
  console.log("Hashing password...");
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const sql = `INSERT OR REPLACE INTO users (id, email, name, password_hash, role, language_preference, profile) VALUES ('${ADMIN_ID}', '${ADMIN_EMAIL}', '${ADMIN_NAME}', '${hash}', 'admin', 'fr', '{}');`;

  console.log(`Seeding admin user: ${ADMIN_EMAIL}`);
  execSync(
    `npx wrangler d1 execute promptomatik-db --local --command="${sql}"`,
    { stdio: "inherit" }
  );

  console.log("Done! You can log in with:");
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
