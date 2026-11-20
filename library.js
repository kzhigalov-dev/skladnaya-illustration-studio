'use strict';

const Library = (() => {
  // Figma node IDs, ordered as L foreground, L background, S foreground, S background.
  const sources = {
    book: ['Книга','21:29965','24:6273','24:3810','24:6934'],
    phone: ['Телефон','21:25472','24:6327','24:4746','24:6990'],
    puzzle: ['Пазлы','21:417','24:6214','24:4903','24:7147'],
    coin: ['Монета','24:2207','24:6795','24:5345','24:7205'],
    phones: ['Наушники','23:122','24:6484','24:5089','24:7344'],
    lamp: ['Лампа','23:121','24:6569','24:5485','24:7429'],
    wallet: ['Кошелёк','23:211','24:6660','24:4594','24:7568'],
    folder: ['Папка','24:1899','24:6772','24:4430','24:7520'],
    pen: ['Ручка','24:1734','24:6747','24:4287','24:7543'],
    flowers: ['Букет','28:11628','30:11902','28:11629','28:11766']
  };

  const ns = 'http://www.w3.org/2000/svg';
  const parser = new DOMParser();
  const colorRoles = ['Фон','Тон фона','Акцент фона','Контур','Акцент 1','Акцент 2','Акцент 3','Светлый'];
  const presetNames = ['Лаванда','Абрикос','Аквамарин'];
  const presets = SWATCHES.map((colors, motif) => ({colors, motif, name: presetNames[motif]}));
  const paintAttributes = new Set(['fill', 'stroke', 'stop-color']);
  const normalize = color => ({white:'#ffffff',black:'#000000'})[color.toLowerCase()] ?? color.toLowerCase();
  const backRoles = new Set([0,1,2]);

  function element(tag, attributes = {}) {
    const node = document.createElementNS(ns, tag);
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  function read(svg, colors, allowedRoles) {
    const root = parser.parseFromString(svg, 'image/svg+xml').documentElement;
    if (root.localName !== 'svg') throw new Error('Некорректный исходный SVG');
    const [x,y,width,height] = root.getAttribute('viewBox').split(/[ ,]+/).map(Number);
    const roles = new Map(colors.map((color, role) => [normalize(color), role]).filter(([,role]) => allowedRoles.has(role)));
    return { svg, root, x, y, width, height, roles };
  }

  const catalog = Object.fromEntries(Object.entries(sources).map(([key, [name, ...nodeIds]]) => {
    const roles = new Set(colorRoles.keys());
    const assets = ART[key].map((svg, index) => ({...read(svg, SWATCHES[0], roles), source: nodeIds[index]}));
    return [key, {name, assets, width: assets[0].width, height: assets[0].height}];
  }));
  const backs = ART.back.map((svg, i) => read(svg, SWATCHES[i % 3], backRoles));

  function materialize(asset, palette, prefix) {
    const root = document.importNode(asset.root, true);
    const nodes = [root, ...root.querySelectorAll('*')];
    const ids = new Map(nodes.filter(node => node.id).map(node => [node.id, prefix + node.id]));
    for (const node of nodes) {
      for (const attr of [...node.attributes]) {
        let value = attr.value;
        if (attr.localName === 'id') value = ids.get(value);
        if (paintAttributes.has(attr.localName)) {
          const role = asset.roles.get(normalize(value));
          if (role !== undefined) value = palette.colors[role];
        }
        if (attr.localName === 'href' && value.startsWith('#') && ids.has(value.slice(1))) {
          value = '#' + ids.get(value.slice(1));
        }
        value = value.replace(/url\(['"]?#([^)'"]+)['"]?\)/g, (all, id) => ids.has(id) ? 'url(#' + ids.get(id) + ')' : all);
        if (value !== attr.value) attr.value = value;
      }
    }
    const group = element('g');
    for (const attr of root.attributes) {
      if (['width','height','viewBox','xmlns','preserveAspectRatio'].includes(attr.name)) continue;
      group.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    group.append(...root.childNodes);
    return group;
  }

  function imageFor(item, detail, palette) {
    const source = catalog[item.key];
    const asset = source.assets[(detail === 'S' ? 2 : 0) + Number(item.mono)];
    const factor = Math.min(source.width / asset.width, source.height / asset.height);
    const group = materialize(asset, palette, 'obj' + item.id + '_');
    group.setAttribute('transform', 'scale(' + factor + ') translate(' + (-asset.x - asset.width/2) + ' ' + (-asset.y - asset.height/2) + ')');
    return group;
  }

  function backdrop(width, height, detail, palette) {
    const asset = backs[palette.motif + (detail === 'S' ? 3 : 0)];
    const scale = Math.max(width / asset.width, height / asset.height);
    const x = (width - asset.width * scale) / 2 - asset.x * scale;
    const y = (height - asset.height * scale) / 2 - asset.y * scale;
    const art = materialize(asset, palette, 'bg_');
    art.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + scale + ')');
    const fill = element('rect', {width,height,fill:palette.colors[0]});
    const group = element('g', {id:'background'});
    group.append(fill, art);
    return group;
  }

  function validatePalette(record, motif = 0) {
    const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
    if (!record || !Array.isArray(record.colors) || record.colors.length !== colorRoles.length || !record.colors.every(isHex)) {
      throw Error('Нужен JSON с массивом colors из восьми цветов #RRGGBB. См. образец.');
    }
    return {
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0,40) : 'Своя палитра',
      motif: [0,1,2].includes(record.motif) ? record.motif : motif,
      colors: record.colors.map(c => c.toLowerCase())
    };
  }

  const dataUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return {catalog, presets, colorRoles, element, backdrop, imageFor, validatePalette, dataUrl};
})();
