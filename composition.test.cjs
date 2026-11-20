'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');
const {compose, variants} = require('./composition.js');

const context = vm.createContext({});
for (const filename of ['assets.js', 'flowers.js']) {
  vm.runInContext(readFileSync(join(__dirname, filename), 'utf8'), context);
}
const art = vm.runInContext('ART', context);
const keys = Object.keys(art).filter(key => key !== 'back');
const formats = [[1200, 630], [1000, 1000], [800, 1200]];
const referenceScenes = [['book', 'phone'], ['wallet', 'coin', 'lamp'], ['phones', 'flowers']];

function item(key, id, role = 'main', rotation = 0) {
  const [width, height] = art[key][0].match(/viewBox="([^"]+)"/)[1].split(' ').slice(2).map(Number);
  return {key, id, role, rotation, width, height};
}

function fittedBounds(layer, position, scale) {
  const angle = layer.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const halfWidth = (layer.width * cos + layer.height * sin) * scale / 2;
  const halfHeight = (layer.width * sin + layer.height * cos) * scale / 2;
  return {
    left:position.x - halfWidth, right:position.x + halfWidth,
    top:position.y - halfHeight, bottom:position.y + halfHeight,
  };
}

test('the three reference motifs hold together in every supported format', () => {
  for (const scene of referenceScenes) {
    const layers = scene.map((key, id) => item(key, id,
      key === 'lamp' || key === 'flowers' ? 'background' : 'main'));
    for (const [width, height] of formats) {
      const compact = compose(layers, {width, height, variant:'cluster'});
      const diagonal = compose(layers, {width, height, variant:'diagonal'});
      const headline = compose(layers, {width, height, variant:'headline'});
      assert.equal(compact.heroId, 0);
      if (layers.some(layer => layer.role === 'background')) {
        assert.equal(layers[compact.order[0]].role, 'background');
      }
      assert.notDeepEqual(compact.items, diagonal.items);
      assert.notDeepEqual(diagonal.items, headline.items);
      if (scene[0] === 'book') {
        const [book, phone] = layers.map(layer => fittedBounds(layer,
          compact.items.find(position => position.id === layer.id), compact.scale));
        assert.ok(phone.left < book.right && phone.right > book.left &&
          phone.top < book.bottom && phone.bottom > book.top,
        'phone overlaps the book edge');
      }
    }
  }
});

test('rotated and repeated subjects stay inside the canvas and leave the text zone open', () => {
  for (let count = 1; count <= 16; count++) {
    const layers = Array.from({length:count}, (_, id) => item(keys[(id + count) % keys.length], id,
      id % 5 === 4 ? 'background' : 'main', id % 4 * 15));
    for (const [width, height] of formats) {
      for (const {id:variant} of variants) {
        const options = {width, height, variant, preserveOrder:true};
        const result = compose(layers, options);
        assert.deepEqual(compose(layers, options), result);
        assert.deepEqual(result.items.map(position => position.id).sort((a, b) => a - b),
          layers.map(layer => layer.id));
        assert.deepEqual(result.order, layers.map(layer => layer.id));
        assert.equal(Boolean(result.safeZone), variant === 'headline');
        assert.ok(result.scale > 0);
        for (const position of result.items) {
          const box = fittedBounds(layers[position.id], position, result.scale);
          const margin = Math.min(width, height) * .055 - .001;
          assert.ok(box.left >= margin && box.right <= width - margin &&
            box.top >= margin && box.bottom <= height - margin);
          if (result.safeZone) {
            const zone = result.safeZone;
            assert.ok(box.left >= zone.x + zone.width || box.top >= zone.y + zone.height);
          }
        }
      }
    }
  }
});
