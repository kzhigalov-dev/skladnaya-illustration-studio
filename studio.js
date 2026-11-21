'use strict';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const planner = globalThis.IllustrationPlanner;
const composition = IllustrationComposition;
const {catalog, presets, colorRoles, element, backdrop, imageFor, validatePalette, dataUrl} = Library;
const formats = [[1200,630], [1000,1000], [800,1200]];
const storageKey = 'skladnaya-studio-v2';
const historyLimit = 60;
const undoStack = [];
const redoStack = [];
const layerThumbs = Object.fromEntries(Object.entries(catalog).map(([key, item]) => [key, dataUrl(item.assets[2].svg)]));
const variantDescriptions = {
  cluster: 'Плотная группа',
  diagonal: 'Движение по диагонали',
  headline: 'Свободное поле под текст'
};
const exampleQueries = {
  title: ['Новая глава', 'Свести дебет с кредитом'],
  objects: ['Книга, телефон', 'Лампа, две монеты']
};
const transform = (item, scale) => 'translate(' + item.x + ' ' + item.y + ') rotate(' + item.angle + ') scale(' + scale + ')';
const dimensions = scene => formats[scene.format];
const variantId = id => id === 'editorial' ? 'headline' : id;
let scene = {
  objects: [], nextId: 1, scale: 1, variant: 'cluster', mode: 'title',
  format: 0, detail: 'L', palette: 0, customPalettes: [], selected: 0,
  query: 'Учусь управлять деньгами', title: '', manual: false, ordered: false, heroId: 0
};
let drag = null;
let layoutDraft = null;
let layoutSource = null;
let paletteDraft = null;
let uploadRequest = 0;

function status(message = '', kind = '') {
  $('status').textContent = message;
  $('status').dataset.kind = kind;
}

function saveDraft() {
  try { localStorage.setItem(storageKey, JSON.stringify(scene)); } catch { /* Editor stays usable without storage. */ }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(storageKey));
    if (!draft || !formats[draft.format] || !['S','L'].includes(draft.detail) ||
      !['title','objects'].includes(draft.mode) || !Array.isArray(draft.objects) ||
      draft.objects.length > planner.maxObjects || !Number.isFinite(draft.scale) || draft.scale <= 0 ||
      !Number.isSafeInteger(draft.nextId) || typeof draft.title !== 'string' ||
      typeof draft.query !== 'string' || !draft.objects.every(item => Object.hasOwn(catalog, item.key) &&
        Number.isSafeInteger(item.id) && [item.x, item.y, item.angle].every(Number.isFinite) &&
        typeof item.mono === 'boolean')) return false;
    draft.customPalettes = draft.customPalettes.map(record => validatePalette(record));
    if (!allPalettes(draft)[draft.palette]) draft.palette = 0;
    scene = draft;
    return true;
  } catch { return false; }
}

function allPalettes(current = scene) { return [...presets, ...current.customPalettes]; }
function currentPalette(current = scene) { return allPalettes(current)[current.palette]; }
function remember(before) {
  undoStack.push(before);
  if (undoStack.length > historyLimit) undoStack.shift();
  redoStack.length = 0;
}

function change(edit, message) {
  const previous = structuredClone(scene);
  edit(scene);
  if (JSON.stringify(previous) !== JSON.stringify(scene)) remember(previous);
  if (message) status(message);
  refresh();
}

function restoreFrom(source, destination, message) {
  if (!source.length) return;
  destination.push(structuredClone(scene));
  scene = source.pop();
  $('alternatives').replaceChildren();
  status(message);
  refresh({input:true});
}

function addItem(current, key, role = 'main') {
  return {id:current.nextId++, key, mono:role === 'background', x:0, y:0, angle:0};
}

function arrange(current, variant) {
  if (!current.objects.length) return;
  const [width,height] = dimensions(current);
  const input = current.objects.map(item => ({
    id:item.id, key:item.key, width:catalog[item.key].width, height:catalog[item.key].height,
    role:item.mono ? 'background' : 'main', rotation:item.angle
  }));
  if (!current.ordered) {
    const heroIndex = input.findIndex(item => item.id === current.heroId && item.role === 'main');
    if (heroIndex > 0) input.unshift(input.splice(heroIndex,1)[0]);
  }
  const layout = composition.compose(input, {width, height, variant, preserveOrder:current.ordered, heroId:current.heroId});
  const positions = new Map(layout.items.map(item => [item.id, item]));
  const byId = new Map(current.objects.map(item => [item.id, {...item, ...positions.get(item.id)}]));
  current.objects = layout.order.map(id => byId.get(id));
  current.heroId = layout.heroId;
  current.scale = layout.scale;
  current.variant = variant;
  current.manual = false;
  delete current.manualProjection;
}

function renderArt(root, current, {editor = false, palette = currentPalette(current)} = {}) {
  const [width,height] = dimensions(current);
  root.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  root.setAttribute('overflow', 'hidden');
  const clipId = 'artboard-bounds';
  const clip = element('clipPath', {id:clipId});
  clip.append(element('rect', {width,height}));
  const defs = element('defs');
  defs.append(clip);
  const framing = element('g', {'clip-path':'url(#' + clipId + ')'});
  framing.append(backdrop(width, height, current.detail, palette));

  for (const item of current.objects) {
    const label = catalog[item.key].name;
    const group = element('g', {
      id:'item-' + item.key + '-' + item.id, transform:transform(item, current.scale)
    });
    const title = element('title');
    title.textContent = label;
    group.append(title, imageFor(item, current.detail, palette));
    if (editor) {
      group.dataset.id = item.id;
      group.dataset.key = item.key;
      group.dataset.role = item.mono ? 'background' : 'main';
      group.setAttribute('aria-label', label);
    }
    framing.append(group);
  }
  if (editor) {
    const selection = current.objects.find(item => item.id === current.selected);
    if (selection) {
      const asset = catalog[selection.key];
      const guide = element('g', {'data-editor':'selection', transform:transform(selection,current.scale), 'pointer-events':'none'});
      guide.append(element('rect', {
        x:-asset.width/2, y:-asset.height/2, width:asset.width, height:asset.height,
        fill:'none', stroke:'#6f3bbc', 'stroke-width':1.5, 'stroke-dasharray':'5 3',
        'vector-effect':'non-scaling-stroke'
      }));
      framing.append(guide);
    }
  }
  root.replaceChildren(defs, framing);
}

function svgFile(current = scene, palette = currentPalette(current)) {
  const [width,height] = dimensions(current);
  const root = element('svg', {width,height});
  const title = element('title');
  title.textContent = current.title || 'Композиция';
  renderArt(root,current,{palette});
  root.prepend(title);
  return new XMLSerializer().serializeToString(root);
}

function thumb(key) {
  const img = document.createElement('img');
  img.src = layerThumbs[key];
  img.alt = '';
  return img;
}

function renderLayers() {
  const target = document.activeElement?.dataset.layer;
  $('layers').replaceChildren(...scene.objects.slice().reverse().map(item => {
    const button = document.createElement('button');
    button.className = 'layer';
    button.type = 'button';
    button.dataset.layer = item.id;
    button.dataset.key = item.key;
    button.dataset.role = item.mono ? 'background' : 'main';
    button.setAttribute('aria-pressed', String(item.id === scene.selected));
    const name = document.createElement('span');
    name.textContent = catalog[item.key].name;
    const role = document.createElement('span');
    role.textContent = item.mono ? 'Фоновый' : 'Основной';
    button.append(thumb(item.key),name,role);
    button.onclick = () => select(item.id);
    return button;
  }));
  if (target) $('layers').querySelector('[data-layer="' + target + '"]')?.focus({preventScroll:true});
  const selected = scene.objects.find(item => item.id === scene.selected);
  $('layer-count').textContent = scene.objects.length;
  $('edit').hidden = !selected;
  $('edit').disabled = !selected;
  $('mono').checked = Boolean(selected?.mono);
  $('object-name').textContent = selected ? catalog[selected.key].name : '';
  const index = scene.objects.indexOf(selected);
  $('edit').querySelector('[data-op="front"]').disabled = index === scene.objects.length - 1;
  $('edit').querySelector('[data-op="rear"]').disabled = index <= 0;
  $('edit').querySelector('[data-op="copy"]').disabled = scene.objects.length >= planner.maxObjects;
}

function renderPalette() {
  const palettes = allPalettes();
  $('palette').replaceChildren(...palettes.map((palette,index) => new Option(palette.name, String(index))));
  $('palette').selectedIndex = scene.palette;
  $('chips').replaceChildren(...currentPalette().colors.map((color,index) => {
    const swatch = document.createElement('span');
    swatch.style.backgroundColor = color;
    swatch.title = colorRoles[index] + ' · ' + color.toUpperCase();
    return swatch;
  }));
}

function renderMode(restoreText = false) {
  $('mode').value = scene.mode;
  $('promptLabel').textContent = scene.mode === 'title' ? 'Заголовок или метафора' : 'Предметы через запятую';
  $('query').placeholder = scene.mode === 'title' ? 'Например, «Новая глава»' : 'Например, «Книга, две монеты»';
  if (restoreText) $('query').value = scene.query;
  $('examples').replaceChildren(...exampleQueries[scene.mode].map(query => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = query;
    button.onclick = () => { $('query').value = query; generate(); };
    return button;
  }));
}

function refresh({input = false} = {}) {
  const [width,height] = dimensions(scene);
  $('artboard').style.setProperty('--aspect', String(width/height));
  $('format').selectedIndex = scene.format;
  $('detail').value = scene.detail;
  $('dimensions').textContent = width + ' × ' + height + ' px';
  $('scene-title').textContent = scene.title;
  $('scene-meta').textContent = scene.detail + ' · SVG';
  $('empty').hidden = scene.objects.length > 0;
  $('vary').disabled = !scene.objects.length;
  $('save').disabled = !scene.objects.length;
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
  if (input) renderMode(true);
  renderArt(canvas,scene,{editor:true});
  renderLayers();
  renderPalette();
  saveDraft();
}

function select(id) {
  scene.selected = id;
  renderArt(canvas,scene,{editor:true});
  renderLayers();
  saveDraft();
}

function showAlternatives(options, query) {
  $('alternatives').replaceChildren(...(options ?? []).slice(0,2).map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.theme;
    button.onclick = () => {
      applySuggestion(option, query);
      status('Выбрана трактовка «' + option.theme + '».');
      $('alternatives').replaceChildren();
    };
    return button;
  }));
}

function suggest(current, result, query, mode) {
  current.query = query;
  current.title = query;
  current.mode = mode;
  current.ordered = mode === 'objects';
  current.objects = result.items.map(item => addItem(current,item.key,item.role));
  current.selected = current.objects[0]?.id ?? 0;
  current.heroId = current.selected;
  const variant = variantId(result.layout);
  arrange(current, composition.variants.some(item => item.id === variant) ? variant : 'cluster');
}

function applySuggestion(result, query) {
  change(current => suggest(current,result,query,$('mode').value));
}

function generate(initial = false) {
  const query = $('query').value.trim();
  const mode = $('mode').value;
  const result = mode === 'objects' ? planner.parseObjects(query) : planner.interpretTitle(query);
  if (result.items.length) {
    if (initial) {
      suggest(scene,result,query,mode);
      refresh();
    } else applySuggestion(result,query);
  }
  const noResult = !result.items.length && scene.objects.length;
  status(result.message + (noResult ? ' На холсте предыдущая композиция.' : ''), result.status === 'ok' ? '' : 'warning');
  showAlternatives(result.alternatives,query);
}

function offsetBounds(item, scale) {
  const source = catalog[item.key];
  const a = item.angle * Math.PI / 180;
  return [
    scale * (Math.abs(Math.cos(a))*source.width + Math.abs(Math.sin(a))*source.height)/2,
    scale * (Math.abs(Math.sin(a))*source.width + Math.abs(Math.cos(a))*source.height)/2
  ];
}

function keepReachable(item, x, y, current = scene) {
  const [width,height] = dimensions(current);
  const [halfWidth,halfHeight] = offsetBounds(item,current.scale);
  const mx = Math.min(halfWidth,width/2);
  const my = Math.min(halfHeight,height/2);
  item.x = Math.max(mx,Math.min(width-mx,x));
  item.y = Math.max(my,Math.min(height-my,y));
}

function addFromLibrary(key) {
  if (scene.objects.length >= planner.maxObjects) {
    status('На холсте уже ' + planner.maxObjects + ' предметов.', 'warning');
    return;
  }
  const source = catalog[key];
  const [width,height] = dimensions(scene);
  if (scene.objects.length && (source.width*scene.scale > width || source.height*scene.scale > height)) {
    const candidate = structuredClone(scene);
    const item = addItem(candidate,key);
    candidate.objects.push(item);
    candidate.selected = item.id;
    openLayout(candidate, 'Добавление предмета «' + source.name + '» требует общего уменьшения. Выберите раскладку.');
    return;
  }
  change(current => {
    const item = addItem(current,key);
    current.selected = item.id;
    if (!current.objects.length) {
      current.objects.push(item);
      arrange(current,'cluster');
      current.title = catalog[key].name;
      return;
    }
    const [width,height] = dimensions(current);
    const [newW,newH] = offsetBounds(item,current.scale);
    const anchors = [[.78,.72],[.24,.72],[.8,.26],[.24,.26],[.5,.5]];
    const occupied = current.objects.map(other => ({other, bounds:offsetBounds(other,current.scale)}));
    let leastOverlap = Infinity;
    let best;
    for (const [xFraction,yFraction] of anchors) {
      keepReachable(item,width*xFraction,height*yFraction,current);
      let overlap = 0;
      for (const {other,bounds:[w,h]} of occupied) {
        overlap += Math.max(0,Math.min(item.x+newW,other.x+w)-Math.max(item.x-newW,other.x-w)) *
          Math.max(0,Math.min(item.y+newH,other.y+h)-Math.max(item.y-newH,other.y-h));
      }
      if (overlap < leastOverlap) { leastOverlap = overlap; best = [item.x,item.y]; }
    }
    [item.x,item.y] = best;
    current.objects.push(item);
    current.manual = true;
    delete current.manualProjection;
  }, 'Добавлен предмет «' + catalog[key].name + '».');
}

const offsets = {left:[-8,0], right:[8,0], up:[0,-8], down:[0,8]};
function operate(operation) {
  const index = scene.objects.findIndex(item => item.id === scene.selected);
  if (index < 0 || (operation === 'copy' && scene.objects.length >= planner.maxObjects)) return;
  const label = catalog[scene.objects[index].key].name;
  change(current => {
    const item = current.objects[index];
    if (offsets[operation]) {
      const [dx,dy] = offsets[operation];
      keepReachable(item,item.x+dx,item.y+dy,current);
    }
    if (operation === 'rotate') {
      item.angle = (item.angle+15)%360;
      keepReachable(item,item.x,item.y,current);
    }
    if (operation === 'copy') {
      const copy = {...item, id:current.nextId++};
      keepReachable(copy,item.x+22,item.y+22,current);
      current.objects.splice(index+1,0,copy);
      current.selected = copy.id;
    }
    if (['remove','front','rear'].includes(operation)) {
      current.objects.splice(index,1);
      if (operation === 'front') current.objects.push(item);
      if (operation === 'rear') current.objects.unshift(item);
      if (operation === 'remove') current.selected = current.objects[Math.min(index,current.objects.length-1)]?.id ?? 0;
    }
    current.manual = true;
    delete current.manualProjection;
  }, offsets[operation] ? 'Предмет «' + label + '» перемещён.' : '');
}

function setFormat(format) {
  change(current => {
    const [oldWidth,oldHeight] = dimensions(current);
    if (current.manual && !current.manualProjection) {
      current.manualProjection = {
        width:oldWidth, height:oldHeight, scale:current.scale,
        positions:current.objects.map(({id,x,y}) => ({id,x,y}))
      };
    }
    current.format = format;
    if (!current.manual) {
      arrange(current,current.variant);
      return;
    }
    const [width,height] = dimensions(current);
    const baseline = current.manualProjection;
    const factor = Math.min(width / baseline.width, height / baseline.height);
    current.scale = baseline.scale * factor;
    const positions = new Map(baseline.positions.map(item => [item.id,item]));
    for (const item of current.objects) {
      const original = positions.get(item.id);
      item.x = width/2 + (original.x-baseline.width/2)*factor;
      item.y = height/2 + (original.y-baseline.height/2)*factor;
    }
  });
}

function openLayout(source = scene, hint = 'Выберите расположение предметов.') {
  layoutSource = source;
  layoutDraft = scene.variant;
  $('layout-hint').textContent = hint;
  $('layout-options').replaceChildren(...composition.variants.map(({id,label}) => {
    const sample = structuredClone(layoutSource);
    arrange(sample,id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layout-choice';
    button.dataset.variant = id;
    button.setAttribute('aria-pressed', String(id === layoutDraft));
    const img = document.createElement('img');
    img.alt = '';
    img.src = dataUrl(svgFile(sample));
    const text = document.createElement('span');
    text.textContent = variantDescriptions[id] ?? label;
    button.append(img,text);
    button.onclick = () => {
      layoutDraft = id;
      for (const choice of $('layout-options').children) choice.setAttribute('aria-pressed', String(choice === button));
    };
    return button;
  }));
  $('layout-dialog').returnValue = '';
  $('layout-dialog').showModal();
}

function showPalette(palette) {
  paletteDraft = structuredClone(palette);
  $('palette-name').value = paletteDraft.name;
  $('palette-fields').replaceChildren(...colorRoles.map((role,index) => {
    const label = document.createElement('label');
    label.textContent = role;
    const field = document.createElement('input');
    field.type = 'color';
    field.value = paletteDraft.colors[index];
    field.oninput = () => {
      paletteDraft.colors[index] = field.value;
      $('palette-input-preview').src = dataUrl(svgFile(scene,paletteDraft));
    };
    label.append(field);
    return label;
  }));
  $('palette-input-preview').src = dataUrl(svgFile(scene,paletteDraft));
  $('palette-dialog').returnValue = '';
  $('palette-dialog').showModal();
}

function canvasPoint(e) {
  return new DOMPoint(e.clientX,e.clientY).matrixTransform(canvas.getScreenCTM().inverse());
}

canvas.onpointerdown = event => {
  if (!event.isPrimary || event.button !== 0) return;
  const group = event.target.closest('[data-id]');
  if (!group) return;
  const item = scene.objects.find(other => other.id === Number(group.dataset.id));
  scene.selected = item.id;
  canvas.focus({preventScroll:true});
  const point = canvasPoint(event);
  drag = {item, before:structuredClone(scene), dx:point.x-item.x, dy:point.y-item.y,
    cx:event.clientX, cy:event.clientY, moved:false};
  canvas.setPointerCapture(event.pointerId);
  renderArt(canvas,scene,{editor:true});
  renderLayers();
};

canvas.onpointermove = event => {
  if (!drag || !canvas.hasPointerCapture(event.pointerId)) return;
  if (!drag.moved && Math.hypot(event.clientX-drag.cx,event.clientY-drag.cy) < 3) return;
  const point = canvasPoint(event);
  keepReachable(drag.item,point.x-drag.dx,point.y-drag.dy);
  const before = drag.before.objects.find(item => item.id === drag.item.id);
  drag.moved = drag.item.x !== before.x || drag.item.y !== before.y;
  canvas.classList.toggle('is-dragging',drag.moved);
  const value = transform(drag.item,scene.scale);
  canvas.querySelector('[data-id="' + drag.item.id + '"]').setAttribute('transform',value);
  canvas.querySelector('[data-editor="selection"]').setAttribute('transform',value);
};

canvas.onlostpointercapture = () => {
  if (drag?.moved) {
    scene.manual = true;
    delete scene.manualProjection;
    remember(drag.before);
    status('Предмет перемещён.');
  }
  drag = null;
  canvas.classList.remove('is-dragging');
  refresh();
};

canvas.onkeydown = event => {
  const operation = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',Delete:'remove'}[event.key];
  if (!operation || !scene.selected) return;
  event.preventDefault();
  operate(operation);
};

$('generate-form').onsubmit = event => { event.preventDefault(); generate(); };
$('mode').onchange = () => {
  scene.mode = $('mode').value;
  scene.query = $('query').value;
  $('alternatives').replaceChildren();
  status('');
  renderMode();
  saveDraft();
};
$('query').oninput = () => { scene.query = $('query').value; saveDraft(); };
$('format').onchange = () => setFormat($('format').selectedIndex);
$('detail').onchange = () => change(current => { current.detail = $('detail').value; });
$('palette').onchange = () => change(current => { current.palette = $('palette').selectedIndex; });
$('edit').onclick = event => {
  const operation = event.target.closest('[data-op]')?.dataset.op;
  if (operation) operate(operation);
};
$('mono').onchange = () => change(current => {
  current.objects.find(item => item.id === current.selected).mono = $('mono').checked;
  current.manual = true;
});
$('vary').onclick = () => openLayout();
$('layout-dialog').onclose = () => {
  if ($('layout-dialog').returnValue === 'apply') {
    change(current => {
      if (layoutSource !== current) {
        current.objects = layoutSource.objects;
        current.nextId = layoutSource.nextId;
        current.selected = layoutSource.selected;
      }
      arrange(current,layoutDraft);
    },'Раскладка применена.');
  }
  layoutDraft = null;
  layoutSource = null;
};
$('palette-edit').onclick = () => {
  uploadRequest++;
  showPalette({...currentPalette(),name:'Своя палитра'});
};
$('palette-dialog').onclose = () => {
  if ($('palette-dialog').returnValue === 'apply') {
    const palette = validatePalette({...paletteDraft,name:$('palette-name').value});
    change(current => {
      current.customPalettes.push(palette);
      current.palette = allPalettes(current).length - 1;
    }, 'Палитра применена.');
  }
  paletteDraft = null;
};
$('upload').onchange = async event => {
  const file = event.target.files[0];
  const request = ++uploadRequest;
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 16_384) throw Error('Файл палитры должен занимать не больше 16 КБ.');
    const record = JSON.parse(await file.text());
    if (request !== uploadRequest) return;
    showPalette(validatePalette(record,currentPalette().motif));
  } catch (err) {
    if (request === uploadRequest) status(err instanceof SyntaxError ? 'Не удалось прочитать JSON палитры.' : err.message, 'warning');
  }
};
$('undo').onclick = () => restoreFrom(undoStack,redoStack,'Изменение отменено.');
$('redo').onclick = () => restoreFrom(redoStack,undoStack,'Изменение повторено.');
document.addEventListener('keydown',event => {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.target.closest('input, textarea, [contenteditable], dialog')) return;
  const key = event.code;
  if (key === 'KeyZ' || key === 'KeyY') {
    event.preventDefault();
    if (key === 'KeyY' || event.shiftKey) $('redo').click(); else $('undo').click();
  }
});
$('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([svgFile()],{type:'image/svg+xml;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Складная-' + dimensions(scene).join('x') + '.svg';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),3000);
};

for (const [key,item] of Object.entries(catalog)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.key = key;
  button.title = 'Добавить: ' + item.name;
  button.setAttribute('aria-label',button.title);
  button.append(thumb(key),item.name);
  button.onclick = () => addFromLibrary(key);
  $('library').append(button);
}
$('library-count').textContent = Object.keys(catalog).length;
if (restoreDraft()) refresh({input:true});
else {
  renderMode(true);
  generate(true);
}

