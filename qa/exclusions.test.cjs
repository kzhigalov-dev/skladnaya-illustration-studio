'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { interpretTitle, parseObjects } = require('../planner.js');

const literalExclusions = [
  ['Телефон и книга, но исключить телефон', ['book']],
  ['Книга, две монеты, новая лампа, без яркой лампы', ['book', 'coin', 'coin']],
  ['Фоновая лампа, три монеты и кошелёк; никаких монет', ['lamp', 'wallet']],
  ['Папка, не использовать папку; наушники', ['phones']],
  ['Монета, книга и лампа; без одной монеты и настольной лампы', ['book']],
  ['Телефон, только без смартфона', []],
];

const titleExclusions = [
  ['Слушаю подкаст, но без смартфона и фоновой лампы', 'phones', ['phone', 'lamp']],
  ['Учёба, никаких учебников; добавьте ручку', 'pen', ['book']],
  ['Вечернее чтение без яркого настольного светильника', 'book', ['lamp']],
  ['Оплатить картой без бумажника, без мелочи', 'phone', ['wallet', 'coin']],
  ['Читаю книгу без телефона и наушников, но с лампой', 'book', ['phone', 'phones']],
];

for (const [prompt, expected] of literalExclusions) {
  test('exact list: ' + prompt, () => {
    const actual = parseObjects(prompt);
    assert.deepEqual(actual.items.map(item => item.key), expected);
    if (!expected.length) assert.equal(actual.status, 'empty');
  });
}

for (const [prompt, expected, excluded] of titleExclusions) {
  test('title: ' + prompt, () => {
    const actual = interpretTitle(prompt);
    assert.equal(actual.items.find(item => item.role === 'main')?.key, expected);
    const all = [actual, ...(actual.alternatives ?? [])].flatMap(plan => plan.items);
    assert.deepEqual(all.filter(item => excluded.includes(item.key)), []);
  });
}
