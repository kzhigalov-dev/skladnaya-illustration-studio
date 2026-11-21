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
  const boundsAt = (item, x, y) => ({
    ...item, x, y, left:x - item.width / 2, top:y - item.height / 2,
    right:x + item.width / 2, bottom:y + item.height / 2,
  });

  function canvasAreas(width, height, variant) {
    const padding = Math.min(width, height) * .055;
    const art = {x:padding, y:padding, width:width - 2 * padding, height:height - 2 * padding};
    if (variant !== 'headline') return {art, safeZone:null};
    const safeZone = {...art};
    if (width / height >= .95) {
      safeZone.width = width * .32 - padding;
      art.x = width * .38;
      art.width = width - padding - art.x;
    } else {
      safeZone.height = height * .29 - padding;
      art.y = height * .34;
      art.height = height - padding - art.y;
    }
    return {art, safeZone};
  }

  function rotatedBounds(item) {
    const angle = radians(item.rotation || 0);
    const {width, height} = item;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    return {...item, width:width * cos + height * sin, height:width * sin + height * cos};
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

  function preferredAngles(item, hero, variant, tall, rank) {
    const accent = area(item) < area(hero) * .17;
    const portrait = tall ? 24 : 0;
    if (item.role === 'background') {
      if (variant === 'diagonal') return [-139 + portrait, -152, -108];
      return rank % 2 ? [-146 + portrait, -110, 152] : [-135 + portrait, -82, 154];
    }
    if (variant === 'diagonal') {
      const diagonal = tall ? 64 : 34;
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
    const offsets = variant === 'diagonal' ? [.54, .36] : aspect > 1.2 ? [.57, -.06] : [.42, .19];
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

  function placementPenalty(candidate, placed, hero, directionPenalty, requestedContact, targetAspect) {
    let overlapPenalty = 0;
    for (const other of placed) {
      const overlap = intersect(candidate, other);
      const covered = overlap / Math.min(area(candidate), area(other));
      const isBackdrop = candidate.role === 'background' || other.role === 'background';
      const limit = isBackdrop ? .48 : .25;
      overlapPenalty += Math.max(0, covered - limit) * 15;
      if (other === hero && requestedContact) {
        // A modest overlap closes the gap between two isometric silhouettes.
        overlapPenalty += Math.abs(covered - (isBackdrop ? .23 : .105)) * 1.7;
      } else {
        overlapPenalty += covered * (isBackdrop ? .25 : .85);
      }
    }
    const frame = envelope([...placed, candidate]);
    const aspectPenalty = Math.abs(Math.log((frame.width / frame.height) / targetAspect));
    return overlapPenalty + directionPenalty + aspectPenalty * .42;
  }

  function buildCandidate(items, heroSource, art, variant, seedAngle) {
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
      const directions = preferredAngles(item, hero, variant, facing, rank);
      const accent = area(item) < area(hero) * .17;
      const backdrop = item.role === 'background';
      const distances = backdrop ? [.64, .78, .93, 1.12]
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
              !accent, art.width / art.height);
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

  function coveredFraction(box, foreground) {
    const overlaps = foreground.filter(other => intersect(box, other) > 0).map(other => ({
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

  function fit(placed, art, variant) {
    const frame = envelope(placed);
    const scale = Math.min(art.width / frame.width, art.height / frame.height);
    const spareX = art.width - frame.width * scale;
    const spareY = art.height - frame.height * scale;
    const bias = variant === 'headline' ? .72 : variant === 'diagonal' ? .64 : .5;
    const left = art.x + spareX * bias;
    const top = art.y + spareY * bias;
    return {
      scale,
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
    if (!items.length) return {items:[], scale:1, order:[], safeZone, heroId:null};
    const input = items.map(rotatedBounds);
    const preferredHero = input.find(item => item.id === heroId);
    const firstPrimary = input.find(item => item.role !== 'background');
    const hero = preferredHero?.role === 'background'
      ? firstPrimary || preferredHero
      : preferredHero || firstPrimary || input[0];
    const order = paintOrder(input, hero, preserveOrder);
    let winner;
    let highest = -Infinity;
    for (const angle of [0, -18, 18, -36, 36, 72]) {
      const placed = buildCandidate(input, hero, art, variant, angle);
      const layer = order.map(id => placed.find(box => box.id === id));
      const hidden = layer.map((box, index) => coveredFraction(box, layer.slice(index + 1)));
      const overlaps = hidden.reduce((sum, fraction) => sum + fraction, 0);
      const blocked = hidden.some((fraction, index) => fraction > (layer[index].role === 'background' ? .66 : .43));
      if (blocked) continue;
      const result = fit(placed, art, variant);
      const sourceContact = placed.some(box => box.reference);
      const score = Math.log(result.scale) - angle * angle * .000065 - overlaps * .16 + (sourceContact ? .21 : 0);
      if (score > highest) {
        winner = result;
        highest = score;
      }
    }
    const result = winner || fit(fallback(input, art), art, variant);
    return {...result, order, safeZone, heroId:hero.id};
  }

  return {compose, variants};
})();

if (typeof module !== 'undefined') module.exports = IllustrationComposition;
