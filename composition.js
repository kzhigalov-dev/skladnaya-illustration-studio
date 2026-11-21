'use strict';

// All geometry is in canonical library units until the final uniform fit.
const IllustrationComposition = (() => {
  const variants = Object.freeze([
    {id:'cluster', label:'В фокусе'},
    {id:'diagonal', label:'Диагональ'},
    {id:'headline', label:'Под заголовок'},
  ]);
  const radians = degrees => degrees * Math.PI / 180;
  const area = box => box.width * box.height;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const boundsAt = (item, x, y) => ({
    ...item, x, y, left:x - item.width / 2, top:y - item.height / 2,
    right:x + item.width / 2, bottom:y + item.height / 2,
  });

  function canonGrid(width, height) {
    // Van de Graaf / the Golden Canon: mirrored page diagonals, intersections
    // at thirds, and the 1:2 inner-to-outer margins of a ninths module.
    const modules = [1, 2, 3, 6, 7, 8];
    const diagonals = [
      [0,0,1,1], [0,1,1,0],
      [0,1,.5,0], [.5,0,1,1], [0,0,.5,1], [.5,1,1,0],
    ].map(([x1,y1,x2,y2]) => ({x1:x1*width, y1:y1*height, x2:x2*width, y2:y2*height}));
    return {
      vertical:modules.map(n => width * n / 9),
      horizontal:modules.map(n => height * n / 9),
      diagonals,
      foci:[1,2].flatMap(y => [1,2].map(x => ({x:width*x/3, y:height*y/3}))),
    };
  }

  function canvasAreas(width, height, variant) {
    const padding = Math.min(width, height) * .055;
    const art = {x:padding, y:padding, width:width - 2 * padding, height:height - 2 * padding};
    if (variant !== 'headline') return {art, safeZone:null};
    // The headline shares the canon's inner margin and a third-length split.
    // Half a module is left between the text area and the illustration.
    const safeZone = {x:width/9, y:height/9, width:width*2/3, height:height*2/3};
    if (width / height >= .95) {
      safeZone.width = width * 2/9;
      art.x = width * 3.5/9;
      art.width = width - padding - art.x;
    } else {
      safeZone.height = height * 2/9;
      art.y = height * 3.5/9;
      art.height = height - padding - art.y;
    }
    return {art, safeZone};
  }

  function rotatedBounds(item) {
    const angle = radians(item.rotation || 0);
    const {width, height} = item;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const profile = item.optical;
    const samples = [];
    const rows = profile?.rows ?? [];
    const dx = width * ((profile?.x ?? .5) - .5);
    const dy = height * ((profile?.y ?? .5) - .5);
    for (const [row, cells] of rows.entries()) {
      for (let col = 0; col < cells.length; col++) {
        const weight = parseInt(cells[col],16) / 15;
        if (weight < .06) continue;
        const x = width * ((col+.5)/cells.length - .5);
        const y = height * ((row+.5)/rows.length - .5);
        samples.push({x:x*cos-y*sin, y:x*sin+y*cos, weight, crown:y < -height*.06});
      }
    }
    return {
      ...item,
      width:width*Math.abs(cos) + height*Math.abs(sin),
      height:width*Math.abs(sin) + height*Math.abs(cos),
      profile:{
        x:dx*cos-dy*sin, y:dx*sin+dy*cos,
        mass:width * height * (profile?.area ?? .66),
        rows, samples, opacity:samples.reduce((sum,cell) => sum + cell.weight,0), cos, sin,
        sourceWidth:width, sourceHeight:height
      }
    };
  }

  function envelope(boxes) {
    const left = Math.min(...boxes.map(box => box.left));
    const top = Math.min(...boxes.map(box => box.top));
    return {
      left, top,
      width:Math.max(...boxes.map(box => box.right)) - left,
      height:Math.max(...boxes.map(box => box.bottom)) - top,
    };
  }

  function intersect(a, b) {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }

  function contact(item, anchor, angle, distance) {
    const x = Math.cos(radians(angle));
    const y = Math.sin(radians(angle));
    const edge = Math.min((anchor.width + item.width) / (2 * Math.abs(x)),
      (anchor.height + item.height) / (2 * Math.abs(y)));
    return boundsAt(item, anchor.x + x * edge * distance, anchor.y + y * edge * distance);
  }

  function preferredAngles(item, hero, variant, tall, rank, slope) {
    const accent = area(item) < area(hero) * .17;
    const portrait = tall ? 24 : 0;
    if (item.role === 'background') {
      if (variant === 'diagonal') return [slope - 180, slope - 159, slope - 194];
      return rank % 2 ? [-146 + portrait, -110, 152] : [-135 + portrait, -82, 154];
    }
    if (variant === 'diagonal') {
      const diagonal = slope;
      return rank % 2 ? [diagonal - 180, -126, -172] : [diagonal, diagonal + 26, 9];
    }
    if (accent) return rank % 2 ? [25 + portrait, -26, 155] : [-47 - portrait, 47, -146];
    return rank % 2 ? [-35 - portrait, 156, 69] : [148 - portrait, 73, -110];
  }

  function referenceAnchor(item, hero, variant, art, seedAngle) {
    // The phone lays over the page edge in the source compositions. A rectangular
    // overlap score alone treats the book's transparent corners as occupied.
    if (hero.key !== 'book' || item.key !== 'phone' || item.role === 'background' ||
        hero.rotation || item.rotation || seedAngle !== 0) return null;
    const aspect = art.width / art.height;
    const diagonal = aspect < .91 ? [.29, .48] : [.54, .36];
    const offsets = variant === 'diagonal' ? diagonal
      : variant === 'headline' ? [.35, .28]
      : aspect > 1.2 ? [.57, -.06] : [.42, .19];
    return {...boundsAt(item, hero.x + hero.width * offsets[0], hero.y + hero.height * offsets[1]), reference:true};
  }

  function walletAccent(item, placed, hero) {
    if (hero.key !== 'lamp' || hero.role === 'background' || item.key !== 'coin' ||
        item.role === 'background' || item.rotation) return null;
    const wallet = placed.find(box => box.key === 'wallet' && box.role !== 'background' && !box.rotation);
    if (!wallet) return null;
    // Keep the small coin in the wallet's orbit even when the larger lamp leads.
    // A small gap keeps it readable at thumbnail size.
    const side = wallet.x < hero.x ? -1 : 1;
    const gap = Math.min(wallet.height, item.height) * .12;
    const x = wallet.x + side * ((wallet.width + item.width) / 2 + gap);
    return {...boundsAt(item, x, wallet.y - wallet.height * .30), reference:true};
  }

  function tallBackdrop(box) {
    return box.role === 'background' && box.profile.opacity && box.height > box.width*1.12;
  }

  function placementPenalty(candidate, placed, hero, directionPenalty, requestedContact, targetAspect, protectCrown) {
    let overlapPenalty = 0;
    for (const other of placed) {
      const overlap = intersect(candidate, other);
      const small = area(candidate) <= area(other) ? candidate : other;
      const large = small === candidate ? other : candidate;
      const boxOverlap = overlap / area(small);
      const covered = placed.length < 4 && boxOverlap > .045 && small.profile.opacity && large.profile.opacity
        ? Math.max(silhouetteCovered(small,[large]), boxOverlap * .26)
        : boxOverlap;
      const isBackdrop = candidate.role === 'background' || other.role === 'background';
      const limit = isBackdrop ? .48 : .25;
      overlapPenalty += Math.max(0, covered - limit) * 15;
      if (other === hero && requestedContact) {
        // A modest overlap closes the gap between two isometric silhouettes.
        overlapPenalty += Math.abs(covered - (isBackdrop ? .23 : .105)) * 1.7;
      } else {
        overlapPenalty += covered * (isBackdrop ? .25 : .85);
      }
      if (protectCrown && tallBackdrop(candidate) && other.role !== 'background') {
        overlapPenalty += silhouetteCovered(candidate,[other],candidate.width*.075)*1.2;
      }
    }
    const frame = envelope([...placed, candidate]);
    const aspectPenalty = Math.abs(Math.log((frame.width / frame.height) / targetAspect));
    return overlapPenalty + directionPenalty + aspectPenalty * .42;
  }

  function buildCandidate(items, heroSource, art, variant, seedAngle, slope) {
    const hero = boundsAt(heroSource, 0, 0);
    const placed = [hero];
    const facing = art.height > art.width * 1.05;
    const remaining = items.filter(item => item !== heroSource).sort((a, b) => area(b) - area(a));
    for (const [rank, item] of remaining.entries()) {
      const reference = (rank === 0 && referenceAnchor(item, hero, variant, art, seedAngle)) ||
        walletAccent(item, placed, hero);
      if (reference) {
        placed.push(reference);
        continue;
      }
      const directions = preferredAngles(item, hero, variant, facing, rank, slope);
      const accent = area(item) < area(hero) * .17;
      const backdrop = item.role === 'background';
      const separate = backdrop && variant === 'diagonal';
      const distances = separate ? [1.05, 1.18]
        : backdrop ? [.64, .78, .93, 1.12]
        : accent ? [1.13, .87, 1.27]
        : [.77, .91, 1.1];
      const anchors = rank < 2 ? [hero] : placed;
      let best;
      let bestPenalty = Infinity;
      for (const anchor of anchors) {
        for (const [directionIndex, direction] of directions.entries()) {
          for (const distance of distances) {
            const box = contact(item, anchor, direction + seedAngle, distance);
            const penalty = placementPenalty(box, placed, hero,
              directionIndex * .20 + (anchor === hero ? 0 : .1),
              !accent && !separate, art.width / art.height, variant === 'cluster' && art.width>art.height*1.3);
            if (penalty < bestPenalty) {
              best = box;
              bestPenalty = penalty;
            }
          }
        }
      }
      placed.push(best);
    }
    return placed;
  }

  function paintOrder(items, hero, preserveOrder) {
    if (preserveOrder) return items.map(item => item.id);
    return [
      ...items.filter(item => item !== hero && item.role === 'background'),
      hero,
      ...items.filter(item => item !== hero && item.role !== 'background'),
    ].map(item => item.id);
  }

  function opacityAt(box, x, y) {
    const {cos,sin,rows,sourceWidth,sourceHeight} = box.profile;
    const dx = x - box.x, dy = y - box.y;
    const col = dx*cos + dy*sin;
    const row = dy*cos - dx*sin;
    const cells = rows[Math.floor((row/sourceHeight + .5)*rows.length)];
    if (!cells) return 0;
    const char = cells[Math.floor((col/sourceWidth + .5)*cells.length)];
    return char ? parseInt(char,16)/15 : 0;
  }

  function silhouetteCovered(box, foreground, crownGap = 0) {
    let occupied = 0;
    let tested = 0;
    for (const sample of box.profile.samples) {
      if (crownGap && !sample.crown) continue;
      const x = sample.x + box.x, y = sample.y + box.y;
      tested += sample.weight;
      let opacity = 0;
      for (const other of foreground) {
        if (x < other.left-crownGap || x > other.right+crownGap || y < other.top-crownGap || y > other.bottom+crownGap) continue;
        opacity = Math.max(opacity, other.profile.opacity ? opacityAt(other,x,y) : 1);
        if (crownGap && other.profile.opacity) {
          opacity = Math.max(opacity,
            opacityAt(other,x+crownGap,y)*.65, opacityAt(other,x-crownGap,y)*.65,
            opacityAt(other,x,y+crownGap)*.65, opacityAt(other,x,y-crownGap)*.65);
        }
        if (opacity === 1) break;
      }
      occupied += opacity * sample.weight;
    }
    return tested ? occupied/tested : 0;
  }

  function coveredFraction(box, foreground) {
    const crossing = foreground.filter(other => intersect(box, other) > 0);
    if (!crossing.length) return 0;
    if (box.profile.opacity) return silhouetteCovered(box,crossing);
    const overlaps = crossing.map(other => ({
      left:Math.max(other.left, box.left), right:Math.min(other.right, box.right),
      top:Math.max(other.top, box.top), bottom:Math.min(other.bottom, box.bottom),
    }));
    const edges = [...new Set(overlaps.flatMap(other => [other.left, other.right]))].sort((a, b) => a - b);
    let covered = 0;
    for (let i = 1; i < edges.length; i++) {
      const left = edges[i - 1], right = edges[i];
      const spans = overlaps.filter(other => other.left < right && other.right > left).sort((a, b) => a.top - b.top);
      let occupied = 0, bottom = box.top;
      for (const other of spans) {
        occupied += Math.max(0, other.bottom - Math.max(bottom, other.top));
        bottom = Math.max(bottom, other.bottom);
      }
      covered += occupied * (right - left);
    }
    return covered / area(box);
  }

  function opticalBalance(placed, frame) {
    let x = 0, y = 0, total = 0;
    for (const box of placed) {
      const weight = box.profile.mass * (box.role === 'background' ? .48 : 1);
      x += (box.x + box.profile.x - frame.left) * weight;
      y += (box.y + box.profile.y - frame.top) * weight;
      total += weight;
    }
    return {x:x/total, y:y/total};
  }

  function fit(placed, art, grid, variant, heroId) {
    const frame = envelope(placed);
    const maxScale = Math.min(art.width / frame.width, art.height / frame.height);
    const optical = opticalBalance(placed, frame);
    const hero = placed.find(box => box.id === heroId);
    const heroX = hero.x + hero.profile.x - frame.left;
    const heroY = hero.y + hero.profile.y - frame.top;
    const centerX = art.x + art.width/2;
    // A compact group on a tall canvas needs an optical center, especially
    // when snapping toward the upper focus would leave a large empty bottom.
    const compactPortrait = variant === 'cluster' && art.height > art.width*1.15 &&
      frame.height*maxScale < art.height*.70;
    const centerY = art.y + art.height * (compactPortrait ? .51 : variant === 'headline' ? .50 : .47);
    const foci = grid.foci.filter(focus => focus.x >= art.x && focus.y >= art.y);
    const focusPull = variant === 'cluster' ? .24 : .43;
    const verticalFocusPull = compactPortrait ? .14 : focusPull;
    let winner;
    let highest = -Infinity;
    for (const fraction of [1, .96, .91]) {
      const scale = maxScale*fraction;
      const spareX = art.width - frame.width*scale;
      const spareY = art.height - frame.height*scale;
      for (const focus of foci) {
        // Translate the whole group together, using both its visible weight and
        // the chosen focus. Limits keep even transparent edges inside the frame.
        const centeredX = centerX - optical.x*scale;
        const centeredY = centerY - optical.y*scale;
        const focusedX = focus.x - heroX*scale;
        const focusedY = focus.y - heroY*scale;
        const left = clamp(centeredX*(1-focusPull)+focusedX*focusPull, art.x, art.x+spareX);
        const top = clamp(centeredY*(1-verticalFocusPull)+focusedY*verticalFocusPull, art.y, art.y+spareY);
        const massError = Math.hypot((left-centeredX)/art.width, (top-centeredY)/art.height);
        const focusError = Math.hypot((left-focusedX)/art.width*focusPull, (top-focusedY)/art.height*verticalFocusPull);
        const score = Math.log(scale) - massError*.46 - focusError;
        if (score > highest) {
          winner = {scale,left,top,score};
          highest = score;
        }
      }
    }
    const {scale,left,top,score} = winner;
    return {
      scale, score,
      items:placed.map(box => ({id:box.id, x:left + (box.x - frame.left) * scale, y:top + (box.y - frame.top) * scale})),
    };
  }

  function fallback(items, art) {
    // Large, crowded sets get balanced shelves with visible gaps between items.
    // Try each column count because rotated objects do not have equal aspect ratios.
    const gap = Math.max(...items.map(item => Math.max(item.width, item.height))) * .06;
    let best;
    let largest = 0;
    for (let columns = 1; columns <= items.length; columns++) {
      const rows = [];
      for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
      const placed = [];
      let top = 0;
      for (const row of rows) {
        const rowHeight = Math.max(...row.map(item => item.height));
        const rowWidth = row.reduce((sum, item) => sum + item.width, 0) + gap * (row.length - 1);
        let left = -rowWidth / 2;
        for (const item of row) {
          placed.push(boundsAt(item, left + item.width / 2, top + rowHeight / 2));
          left += item.width + gap;
        }
        top += rowHeight + gap;
      }
      const frame = envelope(placed);
      const scale = Math.min(art.width / frame.width, art.height / frame.height);
      if (scale > largest) {
        largest = scale;
        best = placed;
      }
    }
    return best;
  }

  function compose(items, {width, height, variant = 'cluster', preserveOrder = false, heroId}) {
    const {art, safeZone} = canvasAreas(width, height, variant);
    const grid = canonGrid(width,height);
    if (!items.length) return {items:[], scale:1, order:[], safeZone, grid, heroId:null};
    const input = items.map(rotatedBounds);
    const preferredHero = input.find(item => item.id === heroId);
    const firstPrimary = input.find(item => item.role !== 'background');
    const hero = preferredHero?.role === 'background'
      ? firstPrimary || preferredHero
      : preferredHero || firstPrimary || input[0];
    const order = paintOrder(input, hero, preserveOrder);
    const slope = Math.atan2(height,width)*180/Math.PI;
    let winner;
    let highest = -Infinity;
    for (const angle of [0, -18, 18, -36, 36, 72]) {
      const placed = buildCandidate(input, hero, art, variant, angle, slope);
      const layer = order.map(id => placed.find(box => box.id === id));
      const hidden = layer.map((box, index) => coveredFraction(box, layer.slice(index + 1)));
      const overlaps = hidden.reduce((sum, fraction) => sum + fraction, 0);
      const blocked = hidden.some((fraction, index) => fraction > (layer[index].role === 'background' ? .66 : .43));
      if (blocked) continue;
      const result = fit(placed, art, grid, variant, hero.id);
      const sourceContact = placed.some(box => box.reference);
      // Leave breathing room around the upper silhouette of a tall backdrop.
      // Its lower half can still cross the foreground to connect the group.
      const crownConflict = variant === 'cluster' && width > height*1.3
        ? layer.reduce((sum, box, index) => sum + (tallBackdrop(box)
          ? silhouetteCovered(box,layer.slice(index+1),box.width*.075) : 0),0)
        : 0;
      const score = result.score - angle * angle * .000065 - overlaps * .19 - crownConflict*.52 + (sourceContact ? .21 : 0);
      if (score > highest) {
        winner = result;
        highest = score;
      }
    }
    const {items:positions, scale} = winner || fit(fallback(input, art), art, grid, variant, hero.id);
    return {items:positions, scale, order, safeZone, grid, heroId:hero.id};
  }

  return {compose, variants, canonGrid};
})();

if (typeof module !== 'undefined') module.exports = IllustrationComposition;
