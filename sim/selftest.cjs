// node sim/selftest.cjs — no network. Checks the pure parts of the toolkit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pngBytes, pdfBytes } = require('./fixtures.cjs');
const { loadEnv, todayIso, daysAgoIso, slugify, RpcError, parseCode } = require('./actor.cjs');
const { formatLogLine, formatBug } = require('./report.cjs');

const png = pngBytes();
assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
const pdf = pdfBytes('Elif Kaya');
assert.equal(pdf.slice(0, 5).toString(), '%PDF-', 'PDF header');
assert.ok(pdf.toString().includes('Elif Kaya'));

const env = loadEnv(path.join(__dirname, '..', '.env'));
assert.ok(env.EXPO_PUBLIC_SUPABASE_URL.startsWith('https://'));
assert.ok(env.EXPO_PUBLIC_SUPABASE_ANON_KEY.length > 20);

assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(daysAgoIso(0), todayIso());
assert.ok(daysAgoIso(6) < todayIso());

assert.equal(slugify('Doç. Dr. Selin Aydın'), 'selin-aydin');
assert.equal(parseCode(new RpcError('PENDING_REVIEWS: 2')).code, 'PENDING_REVIEWS');
assert.equal(parseCode(new RpcError('PENDING_REVIEWS: 2')).detail, '2');
assert.equal(parseCode(new Error('boom')).code, 'UNKNOWN');

const line = formatLogLine({ at: '2026-09-19T09:00:00.000Z', who: 'elif-kaya', name: 'submit_assignment', args: { p_note: 'x' }, ok: true, result: 'abc' });
assert.ok(line.includes('submit_assignment') && line.includes('→'));
const bugText = formatBug({ who: 'elif-kaya', did: 'submit', expected: 'ok', got: 'ERR', code: 'X', severity: 'wrong' });
assert.ok(bugText.startsWith('- **[wrong]**'));
fs.mkdirSync(path.join(__dirname, 'log'), { recursive: true });
console.log('selftest ok');
