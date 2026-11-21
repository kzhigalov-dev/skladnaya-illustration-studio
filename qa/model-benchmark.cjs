'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { model, schema, messages, decode } = require('../semantic-protocol.js');
const planner = require('../planner.js');

const fixture = process.argv[2];
if (!fixture) throw new Error('Usage: node qa/model-benchmark.cjs qa/fresh-40.json [result.json]');
const cases = JSON.parse(fs.readFileSync(path.resolve(fixture), 'utf8').replace(/^\uFEFF/u, ''));
const target = 'http://127.0.0.1:11434/api/chat';

function passes(plan, test) {
  if (test.kind === 'unfit') return plan.status === 'empty' && !plan.items.length;
  const main = plan.items.find(item => item.role === 'main');
  return Boolean(main && test.acceptable.includes(main.key) &&
    plan.items.every(item => !test.excluded.includes(item.key)));
}

async function analyze(title) {
  const excluded = planner.excludedKeys(title);
  const response = await fetch(target, {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, messages: messages(title, excluded), format: schema, stream: false, think: false,
      options: { num_ctx: 2048, num_predict: 220, temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error('Ollama returned ' + response.status + ': ' + await response.text());
  const completion = await response.json();
  return decode(completion.message?.content, excluded);
}

async function main() {
  const rows = [];
  for (const test of cases) {
    const start = performance.now();
    const lexicalPass = passes(planner.interpretTitle(test.title), test);
    let plan, error;
    try {
      plan = await analyze(test.title);
    } catch (failure) {
      error = failure.message;
    }
    const modelPass = Boolean(plan && passes(plan, test));
    const elapsed = performance.now() - start;
    rows.push({ ...test, lexicalPass, modelPass, elapsed, plan, error });
    const keys = plan?.items.map(item => item.key).join(',') || (plan ? 'none' : error);
    console.log('%s %dms %s %s -> %s', modelPass ? 'PASS' : 'REVIEW',
      Math.round(elapsed), test.kind, test.title, keys);
  }
  const byKind = {};
  for (const row of rows) {
    const summary = byKind[row.kind] ??= { total: 0, lexical: 0, model: 0 };
    summary.total++;
    summary.lexical += Number(row.lexicalPass);
    summary.model += Number(row.modelPass);
  }
  const durations = rows.slice(1).map(row => row.elapsed).toSorted((a, b) => a - b);
  const summary = {
    model, byKind, errors: rows.filter(row => row.error).length,
    coldMs: Math.round(rows[0]?.elapsed ?? 0),
    warmMedianMs: Math.round(durations[Math.floor(durations.length / 2)] ?? 0),
    warmP95Ms: Math.round(durations[Math.ceil(durations.length * .95) - 1] ?? 0),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify({ summary, rows }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
