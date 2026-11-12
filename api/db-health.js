// Checks that the server can reach the Supabase Postgres database.
// Runs only on the server: DATABASE_URL (which contains the database password) is read from Vercel environment variables, never sent to the browser.
const { Pool } = require('pg');

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true }, // Supabase requires TLS
      max: 1,
    });
  }
  return pool;
}

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  if (!process.env.DATABASE_URL) {
    res.statusCode = 500;
    return res.end('DATABASE_URL is not configured');
  }
  try {
    const r = await getPool().query('select now() as server_time');
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, server_time: r.rows[0].server_time }));
  } catch (e) {
    // Log the error class only: driver messages can echo connection details.
    console.error('db-health failed', e.code || e.name);
    res.statusCode = 503;
    return res.end(JSON.stringify({ ok: false }));
  }
}

module.exports = handler;
