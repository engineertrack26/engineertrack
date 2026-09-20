const fs = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'log');
const BUGS = path.join(ROOT, 'bugs.md');
const ACCOUNTS = path.join(ROOT, 'accounts.md');
const WIDTH = Number(process.env.SIM_LOG_WIDTH) || 600;

function short(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '' : s.length > WIDTH ? s.slice(0, WIDTH - 3) + '…' : s;
}
function formatLogLine({ at, who, name, args, ok, result, error }) {
  const head = `- \`${at.slice(11, 19)}\` **${name}** ${short(args)}`;
  return ok ? `${head} → ${short(result)}` : `${head} → **ERROR** ${short(error)}`;
}
function appendLog(slug, line) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${slug}\n\n`);
  fs.appendFileSync(file, line + '\n');
}
function formatBug({ who, did, expected, got, code, severity, reproduces }) {
  return `- **[${severity}]** ${who} — ${did}. Expected: ${expected}. Got: ${got}${code ? ` (\`${code}\`)` : ''}.${reproduces === false ? ' Did not reproduce on retry.' : ''}`;
}
function appendBug(entry) {
  if (!fs.existsSync(BUGS)) fs.writeFileSync(BUGS, '# Simulation findings\n\nSeverity: blocker = flow cannot continue · wrong = rule/data wrong · rough = works but reads badly.\n\n');
  fs.appendFileSync(BUGS, formatBug(entry) + '\n');
}
const ACCOUNT_HEADER = '# Simulation accounts\n\nAll under `@sim.engineertrack.test`. Group join code and student codes are filled as they are created.\n\n| Role | Name | Email | Password | Company | Character | Student code | Group code | Avatar |\n|---|---|---|---|---|---|---|---|---|\n';
function writeAccount(row) {
  if (!fs.existsSync(ACCOUNTS)) fs.writeFileSync(ACCOUNTS, ACCOUNT_HEADER);
  const cells = [row.role, row.name, row.email, row.password, row.company || '', row.character || '', row.studentCode || '', row.groupCode || '', row.avatar || ''];
  const text = fs.readFileSync(ACCOUNTS, 'utf8');
  const line = `| ${cells.join(' | ')} |`;
  const existing = text.split('\n').findIndex((l) => l.includes(`| ${row.email} |`));
  if (existing === -1) fs.appendFileSync(ACCOUNTS, line + '\n');
  else { const lines = text.split('\n'); lines[existing] = line; fs.writeFileSync(ACCOUNTS, lines.join('\n')); }
}
function readAccounts() {
  if (!fs.existsSync(ACCOUNTS)) return [];
  return fs.readFileSync(ACCOUNTS, 'utf8').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Role') && !l.startsWith('|---'))
    .map((l) => { const c = l.split('|').slice(1, -1).map((s) => s.trim());
      return { role: c[0], name: c[1], email: c[2], password: c[3], company: c[4], character: c[5], studentCode: c[6], groupCode: c[7], avatar: c[8] }; });
}
module.exports = { formatLogLine, appendLog, formatBug, appendBug, writeAccount, readAccounts, LOG_DIR, BUGS, ACCOUNTS };
