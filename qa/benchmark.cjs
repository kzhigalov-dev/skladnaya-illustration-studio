'use strict';

const fixtures = {
  '--second': './held-out-v2.json',
  '--third': './held-out-v3.json',
  '--final': './held-out-final.json',
  '--paraphrase': './paraphrase-final.json',
  '--fresh': './fresh-40.json',
  '--validation': './validation-40.json',
};
const requested = process.argv.find(arg => Object.hasOwn(fixtures, arg));
const cases = require(fixtures[requested] || './held-out.json');
const expectedKinds = ['literal', 'metaphor', 'ambiguous', 'unfit'];
const plannerIndex = process.argv.indexOf('--planner');
const planner = require(plannerIndex < 0 ? '../planner.js' : require('node:path').resolve(process.argv[plannerIndex + 1]));
const keys = new Set(['book', 'coin', 'flowers', 'folder', 'lamp', 'pen', 'phone', 'phones', 'puzzle', 'wallet']);
const totals = Object.fromEntries(expectedKinds.map(kind => [kind, { passed: 0, total: 0 }]));

for (const test of cases) {
  const outcome = planner.interpretTitle(test.title);
  const candidates = outcome.items;
  const target = candidates.find(item => item.role === 'main');
  const recognizable = target && test.acceptable.includes(target.key);
  const noneExcluded = candidates.every(item => !test.excluded.includes(item.key));
  const schema = candidates.every(item => keys.has(item.key) && ['main', 'background'].includes(item.role));
  const valid = schema && (test.kind === 'unfit'
    ? candidates.length === 0 && outcome.status === 'empty'
    : recognizable && noneExcluded);
  totals[test.kind].total++;
  totals[test.kind].passed += Number(Boolean(valid));
  if (!valid) console.log('REVIEW %s: %s -> %s', test.kind, test.title, JSON.stringify(outcome));
}
const representable = expectedKinds.slice(0, 3).reduce((sum, kind) => sum + totals[kind].passed, 0);
console.log(JSON.stringify(totals, null, 2));
console.log('First suggestion: %d/34. Appropriate no-result: %d/6.', representable, totals.unfit.passed);
if (process.argv.includes('--gate') && (representable !== 34 || totals.unfit.passed !== 6)) process.exitCode = 1;
