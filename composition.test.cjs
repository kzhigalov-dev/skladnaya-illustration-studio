'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');
const {compose, variants, canonGrid} = require('./composition.js');

const context = vm.createContext({});
for (const filename of ['assets.js', 'flowers.js', 'art-metrics.js']) {
  vm.runInContext(readFileSync(join(__dirname, filename), 'utf8'), context);
}
const art = vm.runInContext('ART', context);
const metrics = vm.runInContext('ArtMetrics', context);
const keys = Object.keys(art).filter(key => key !== 'back');
const formats = [[1200, 630], [1000, 1000], [800, 1200]];
const referenceScenes = [['book', 'phone'], ['wallet', 'coin', 'lamp'], ['phones', 'flowers']];

function item(key, id, role = 'main', rotation = 0) {
  const [width, height] = art[key][0].match(/viewBox="([^"]+)"/)[1].split(' ').slice(2).map(Number);
  return {key, id, role, rotation, width, height, optical:metrics[key][Number(role === 'background')]};
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

test('the main subject survives layer reordering independently of paint order', () => {
  const layers = [item('phone', 2), item('book', 1)];
  const options = {width:1200, height:630, preserveOrder:true, heroId:1};
  assert.equal(compose(layers, options).heroId, 1);
  assert.deepEqual(compose(layers, options).order, [2, 1]);
  layers[1].role = 'background';
  assert.equal(compose(layers, options).heroId, 2);
  assert.equal(compose([layers[0]], options).heroId, 2);
});

test('canon lines, focal intersections and the headline area follow the same canvas modules', () => {
  for (const [width, height] of formats) {
    const grid = canonGrid(width, height);
    assert.deepEqual(grid.vertical, [1, 2, 3, 6, 7, 8].map(n => width*n/9));
    assert.deepEqual(grid.horizontal, [1, 2, 3, 6, 7, 8].map(n => height*n/9));
    for (const {x,y} of grid.foci) {
      const linesThroughFocus = grid.diagonals.filter(({x1,y1,x2,y2}) => {
        const crossProduct = (x-x1)*(y2-y1) - (y-y1)*(x2-x1);
        return Math.abs(crossProduct) < .001 && x >= x1 && x <= x2;
      });
      assert.ok(linesThroughFocus.length >= 2);
    }
    const {safeZone} = compose([item('book', 1)], {width, height, variant:'headline'});
    assert.equal(safeZone.x, width/9);
    assert.equal(safeZone.y, height/9);
    assert.equal(width >= height ? safeZone.width : safeZone.height, (width >= height ? width : height)*2/9);
  }
});

test('optical centering compensates for asymmetric silhouettes without changing scale', () => {
  const lightLeft = {id:1, width:300, height:500, optical:{x:.2,y:.5,area:.5}};
  const lightRight = {...lightLeft, optical:{...lightLeft.optical,x:.8}};
  const options = {width:1200,height:630,variant:'cluster'};
  const left = compose([lightLeft], options);
  const right = compose([lightRight], options);
  assert.equal(left.scale, right.scale);
  assert.ok(left.items[0].x > right.items[0].x);
});
