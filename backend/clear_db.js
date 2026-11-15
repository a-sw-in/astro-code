const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbs = [
  path.join(__dirname, 'astro_code_blue.db'),
  path.join(__dirname, 'astro_support.db'),
];

for (const dbPath of dbs) {
  try {
    const db = new DatabaseSync(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    for (const t of tables) {
      if (!t.name.startsWith('sqlite_')) {
        db.prepare(`DELETE FROM "${t.name}"`).run();
        console.log(`Cleared ${t.name} in ${path.basename(dbPath)}`);
      }
    }
  } catch (err) {
    console.error(`Error on ${dbPath}:`, err.message);
  }
}
console.log('Done clearing databases.');
