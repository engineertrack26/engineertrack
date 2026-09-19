// One-off, explicitly authorized catalogue translation. Never imported by the app.
// Sends ONLY the checked-in English catalogue; no environment, users or DB access.
// This public endpoint may change; checked-in translations are the runtime source.
// node scripts/translate-task-content.cjs --allow-external-translation
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../src/i18n/task-content');
if (!process.argv.includes('--allow-external-translation')) throw new Error('Explicit external translation consent required');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const target = path.join(dir, 'tr.json');
const tr = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const fields = ['objective', 'task', 'criterion'];
const jobs = Object.entries(en).flatMap(([id, row]) => fields.filter(field => !tr[id]?.[field])
  .map(field => ({ id, field, source: row[field] })));
let cursor = 0, complete = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function save() {
  const sorted = Object.fromEntries(Object.keys(en).filter(id => tr[id]).map(id => [id,
    Object.fromEntries(fields.filter(field => tr[id][field]).map(field => [field, tr[id][field]]))]));
  fs.writeFileSync(target, JSON.stringify(sorted, null, 2) + '\n');
}
async function translate(source) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const url = new URL('https://clients5.google.com/translate_a/t');
      url.search = new URLSearchParams({ client: 'dict-chrome-ex', sl: 'en', tl: 'tr', q: source }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
      const data = await response.json();
      const result = typeof data[0] === 'string' ? data[0].trim() : '';
      if (!result || result === source) throw new Error('Empty or unchanged translation');
      return result;
    } catch (error) {
      if (attempt === 3) throw error;
      await wait(1500 * (attempt + 1));
    }
  }
}
async function worker() {
  while (cursor < jobs.length) {
    const { id, field, source } = jobs[cursor++];
    const result = await translate(source);
    tr[id] ??= {};
    tr[id][field] = result;
    complete++;
    if (complete % 30 === 0) { save(); console.log(`${complete}/${jobs.length} fields translated`); }
    await wait(100);
  }
}
Promise.all([worker(), worker()]).then(() => {
  save(); console.log(`Complete: ${Object.keys(tr).length} Turkish triplets`);
}).catch(error => { save(); console.error(error.message); process.exitCode = 1; });
