// Fails when a component hardcodes a colour or a size instead of using a design
// token. Literal values are allowed only in styles/tokens.css.
//   - CSS (styles/*.css except tokens.css): no hex/rgb/hsl colours, no raw
//     palette steps (--emerald-500 …), no px sizes above 6px outside @media.
//   - TS/TSX (app, components, features, lib): no hex/rgb/hsl colours and no
//     numeric px values in inline styles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const walk = (dir, exts) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(p, exts);
  return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
}) : [];

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const PALETTE = /var\(--(emerald|stone|ink|amber|red|blue)-\d+\)/;

for (const file of walk(path.join(root, 'styles'), ['.css'])) {
  if (path.basename(file) === 'tokens.css') continue;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^\s*@media/.test(line) || /^\s*\/\*/.test(line)) return;
    const rel = `${path.relative(root, file)}:${i + 1}`;
    if (COLOUR.test(line)) problems.push(`${rel} literal colour`);
    if (PALETTE.test(line)) problems.push(`${rel} uses a primitive palette step; use a semantic token`);
    for (const m of line.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)px\b/g)) if (Number(m[1]) > 6) problems.push(`${rel} literal size ${m[0]}`);
  });
}
for (const dir of ['app', 'components', 'features', 'lib']) {
  for (const file of walk(path.join(root, dir), ['.ts', '.tsx'])) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const rel = `${path.relative(root, file)}:${i + 1}`;
      if (/check-tokens:\s*allow/.test(line)) return;
      if (COLOUR.test(line)) problems.push(`${rel} literal colour`);
      for (const style of line.matchAll(/style=\{\{([^}]*)\}\}/g)) {
        // Unitless non-size properties and zero are fine; any other number or px value is a hardcoded size.
        const body = style[1].replace(/\b(opacity|flex|flexGrow|flexShrink|zIndex|order|lineHeight)\s*:\s*[\d.]+/g, '');
        const sizes = [...body.matchAll(/:\s*([\d.]+)\s*(?=,|$)/g)].filter((m) => Number(m[1]) !== 0);
        if (/\b\d+(\.\d+)?px\b/.test(body) || sizes.length) problems.push(`${rel} literal size in inline style`);
      }
    });
  }
}
if (problems.length) { console.error(`Design token check failed (${problems.length}):\n${problems.join('\n')}`); process.exit(1); }
console.log('Design token check passed: no hardcoded colours or sizes outside tokens.css.');
