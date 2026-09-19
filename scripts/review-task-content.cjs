// Apply versioned language-review corrections to the completed machine draft.
// No network or database access. Re-running is safe.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const en = require('../src/i18n/task-content/en.json');
const corrections = require('../docs/task-content-tr-corrections.json');
const target = path.join(root, 'src/i18n/task-content/tr.json');
const tr = JSON.parse(fs.readFileSync(target, 'utf8'));
const fields = ['objective', 'task', 'criterion'];
for (const [id, source] of Object.entries(en)) {
  for (const field of fields) {
    if (!tr[id]?.[field]?.trim()) throw new Error(`Incomplete translation: ${id}.${field}`);
  }
}
for (const [id, row] of Object.entries(corrections)) {
  if (!en[id]) throw new Error(`Unknown correction ID: ${id}`);
  for (const [field, value] of Object.entries(row)) {
    if (!fields.includes(field) || typeof value !== 'string' || !value.trim()) throw new Error(`Invalid correction: ${id}.${field}`);
    tr[id][field] = value;
  }
}
for (const [id, row] of Object.entries(tr)) for (const field of fields) {
  // "Redacted" means privacy masking, NOT editing/correcting a document.
  // Scope this terminology correction to source fields explicitly using it.
  if (/redacted/i.test(en[id][field])) {
    row[field] = row[field].replace(/düzeltilmiş|düzenlenmiş/g, 'hassas bilgileri gizlenmiş');
  }
  row[field] = row[field].replace(/Uygulamaya/g, 'uygulamaya').replace(/Uygulamada/g, 'uygulamada')
    .replace(/Süpervizör/g, 'İşyeri sorumlusu').replace(/süpervizör/g, 'işyeri sorumlusu')
    .replace(/Denetim otoritesi/g, 'İşyeri sorumlusu').replace(/denetim otoritesi/g, 'işyeri sorumlusu')
    .replace(/\u200b/g, '');
}
fs.writeFileSync(target, JSON.stringify(tr, null, 2) + '\n');
console.log(`Reviewed corrections applied to ${Object.keys(corrections).length} triplets`);
