import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target) : entry.name.endsWith('.js') || entry.name.endsWith('.mjs') ? [target] : [];
  });
}

for (const file of [...files('src'), ...files('public'), ...files('scripts'), ...(fs.existsSync('test') ? files('test') : [])]) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log('Syntax lint passed.');
