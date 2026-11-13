// Shared database pool for the server functions. Same connection rules as api/db-health.js:
// the integration's URL carries sslmode=require, which makes pg ignore our ssl option (including the CA), so strip it.
const { Pool } = require('pg');

function connectionString() {
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('supa');
    return u.toString();
  } catch (e) {
    return raw;
  }
}

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      ssl: { rejectUnauthorized: true, ca: process.env.SUPABASE_CA_CERT || undefined },
      max: 1,
    });
  }
  return pool;
}

module.exports = { getPool };
