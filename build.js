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

const page = (side, title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
${fontLink}
<link rel="stylesheet" href="app.css">
</head>
<body>
${body}
<script>window.APP_SIDE='${side}'</script>
<script src="app.js"></script>
</body>
</html>
`;

fs.writeFileSync('app.css', css);
fs.writeFileSync('app.js', js);
fs.writeFileSync('index.html', page('client', 'Book a session'));
fs.writeFileSync('console.html', page('therapist', 'Practice console'));
console.log('Built app.css, app.js, index.html, console.html');
