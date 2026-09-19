const fs = require('node:fs');
const path = require('node:path');
const FILE = path.join(__dirname, '..', 'state.json');
function read() { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
/** Re-reads, applies patch(state), writes. Parallel writers each patch one key, so last-write-wins on the whole file is avoided. */
function merge(patch) {
  for (let i = 0; i < 5; i++) {
    try { const s = read(); patch(s); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); return s; }
    catch (e) { if (i === 4) throw e; }
  }
}
module.exports = { read, merge, FILE };
