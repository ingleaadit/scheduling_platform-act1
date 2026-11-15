// Splits src/prototype.html (the single-file source) into the files that are served:
//   app.css, app.js, index.html (client booking page) and console.html (therapist console).
// Run: node build.js
const fs = require('fs');
const src = fs.readFileSync('src/prototype.html', 'utf8');

const cssStart = src.indexOf('<style>');
const cssEnd = src.indexOf('</style>', cssStart);
const jsStart = src.lastIndexOf('<script>');
const jsEnd = src.lastIndexOf('</script>');
if (cssStart < 0 || cssEnd < 0 || jsStart < 0 || jsEnd < 0) throw new Error('Could not find the style or script block in src/prototype.html');

const css = src.slice(cssStart + '<style>'.length, cssEnd).trim() + '\n';
const body = src.slice(cssEnd + '</style>'.length, jsStart).trim();
const js = src.slice(jsStart + '<script>'.length, jsEnd).trim() + '\n';
const fontLink = (src.slice(0, cssStart).match(/<link rel="stylesheet"[^>]*>/) || [''])[0];

// The therapist console signs in with Supabase, so it also loads the Supabase browser library and config.js.
fs.copyFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'supabase.js');
const authScripts = '<script src="supabase.js"></script>\n<script src="config.js"></script>\n';

const crypto = require('crypto');
const VER = crypto.createHash('sha1').update(css + js + body).digest('hex').slice(0, 10);
const SITE = 'https://schedulingplatform-act1.vercel.app';
const page = (side, title, desc) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#3A5A40">
<meta name="robots" content="${side === 'demo' ? 'index, follow' : 'noindex, nofollow'}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
${side === 'therapist' ? '<link rel="manifest" href="manifest.webmanifest">\n' : ''}<meta property="og:type" content="website">
<meta property="og:site_name" content="Practice">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${fontLink}
<link rel="stylesheet" href="app.css">
</head>
<body>
${body}
${side === 'therapist' ? authScripts : ''}<script>window.APP_SIDE='${side}';window.APP_V='${VER}'</script>
<script src="app.js"></script>
</body>
</html>
`;

fs.writeFileSync('app.css', css);
fs.writeFileSync('app.js', js);
fs.writeFileSync('index.html', page('client', 'Book a session', 'Book, move or cancel a therapy session in a couple of taps. Reminders and payment details come with your booking.'));
fs.writeFileSync('console.html', page('therapist', 'Practice console', 'Sign in to your practice: sessions, clients, reminders and payments in one place.'));
fs.writeFileSync('demo.html', page('demo', 'Demo: practice console', 'Try the practice console and the client booking page with example data. No account needed, nothing is sent or saved.'));
fs.writeFileSync('version.json', JSON.stringify({ v: VER }) + '\n');
console.log('Built app.css, app.js, index.html, console.html');
