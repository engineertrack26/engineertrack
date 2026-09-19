// Build the display-only English catalogue from the canonical SQL seed.
// Usage: node scripts/task-content-catalog.cjs [--check]
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'docs/task-triplets-migration.sql'), 'utf8');
const row = /^\s*\('((?:[^']|'')*)', (\d+), (\d+), (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'\)[,]?\r?$/gm;
const catalog = {};
for (const match of sql.matchAll(row)) {
  const [, code, level, kpi, index, objective, task, criterion] = match;
  const id = `${code}.${level}.${kpi}.${index}`;
  if (catalog[id]) throw new Error(`Duplicate key: ${id}`);
  catalog[id] = Object.fromEntries(Object.entries({ objective, task, criterion })
    .map(([field, text]) => [field, text.replace(/''/g, "'")]));
}
if (Object.keys(catalog).length !== 480) throw new Error('Expected exactly 480 source triplets');
const target = path.join(root, 'src/i18n/task-content/en.json');
const output = JSON.stringify(catalog, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw new Error('English catalogue is out of sync with SQL seed');
} else {
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== output &&
      fs.existsSync(path.join(root, 'src/i18n/task-content/tr.json'))) {
    throw new Error('Source changed: review/retranslate affected Turkish entries before replacing the English snapshot');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output);
}
console.log(`English catalogue: ${Object.keys(catalog).length} triplets verified`);
