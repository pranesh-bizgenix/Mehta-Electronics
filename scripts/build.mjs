import fs from 'node:fs';
import path from 'node:path';

const destination = path.resolve('dist');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const entry of ['src', 'public', 'scripts', 'package.json', 'package-lock.json', 'README.md', '.env.example']) {
  fs.cpSync(path.resolve(entry), path.join(destination, entry), { recursive: true });
}
console.log(`Production artifact created at ${destination}`);
