// Receives Razorpay webhooks and checks their signature.
// Storage is not wired up yet: a verified event is acknowledged and its ID and type are logged, nothing else.
const crypto = require('crypto');

// Razorpay sends an HMAC-SHA256 of the raw request body, hex-encoded, in the X-Razorpay-Signature header.
function verifySignature(rawBody, signature, secret) {
  if (typeof rawBody !== 'string' || typeof signature !== 'string' || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    res.statusCode = 500;
    return res.end('Webhook secret is not configured');
  }
  const raw = await readRawBody(req);
  const signature = req.headers['x-razorpay-signature'];
  if (!verifySignature(raw, signature, secret)) {
    res.statusCode = 400;
    return res.end('Invalid signature');
  }
  let event;
  try { event = JSON.parse(raw); } catch (e) {
    res.statusCode = 400;
    return res.end('Invalid JSON');
  }
  // Log only the event type and ID. The payload contains payer details, so it is not logged.
  console.log('razorpay event', event.event, event.event_id || event.id || '');
  res.statusCode = 200;
  return res.end('ok');
}

module.exports = handler;
module.exports.verifySignature = verifySignature;
