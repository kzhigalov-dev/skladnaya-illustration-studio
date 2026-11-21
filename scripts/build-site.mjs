import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(root, 'dist');
const files = [
  'index.html', 'style.css', 'mark.svg', 'assets.js', 'flowers.js', 'art-metrics.js', 'library.js',
  'planner.js', 'composition.js', 'studio.js', 'palette.json',
  'semantic-protocol.js', 'local-intelligence.js', 'intelligence-worker.js',
  'demo.mp4', 'README.md',
];

mkdirSync(join(target, 'examples'), {recursive: true});
for (const file of files) copyFileSync(join(root, file), join(target, file));
for (const file of readdirSync(join(root, 'examples'))) {
  copyFileSync(join(root, 'examples', file), join(target, 'examples', file));
}
console.log('Сборка для Sites готова.');
