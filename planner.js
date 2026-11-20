'use strict';

// The interpreter only refers to items from the original illustration library.
const IllustrationPlanner = (() => {
  const maxObjects = 16;
  const maxInput = 1200;
  const labels = Object.freeze({
    flowers: 'Букет', book: 'Книга', phone: 'Телефон', puzzle: 'Пазлы',
    coin: 'Монета', phones: 'Наушники', lamp: 'Лампа', wallet: 'Кошелёк',
    folder: 'Папка', pen: 'Ручка',
  });

  // Match inflected object names, keeping them separate from theme vocabulary.
  const aliases = [
    ['flowers', /^(?:букет(?:а|у|ом|е|ы|ов|ам|ами|ах)?|цветок|цвет(?:ка|ку|ком|ке|ы|ов|ам|ами|ах)|тюльпан(?:а|у|ом|е|ы|ов|ам|ами|ах)?|ваз(?:а|у|ы|ой|е|ы|ам|ами|ах)?|bouquets?|flowers?)$/u],
    ['book', /^(?:книг(?:а|у|и|е|ой|ам|ами|ах)|книг|книж(?:ка|ку|ки|ке|кой|кам|ками|ках|ек)|учебник(?:а|у|ом|е|и|ов|ам|ами|ах)?|books?)$/u],
    ['phone', /^(?:телефон(?:а|у|ом|е|ы|ов|ам|ами|ах)?|смартфон(?:а|у|ом|е|ы|ов|ам|ами|ах)?|мобильник(?:а|у|ом|е|и|ов|ам|ами|ах)?|айфон(?:а|у|ом|е|ы|ов|ам|ами|ах)?|(?:smart|i)?phones?)$/u],
    ['puzzle', /^(?:пазл(?:а|у|ом|е|ы|ов|ам|ами|ах)?|головолом(?:ка|ку|ки|ке|кой|ок|кам|ками|ках)|puzzles?)$/u],
    ['coin', /^(?:монет(?:а|у|ы|е|ой|ою|ам|ами|ах)?|монетк(?:а|у|и|е|ой|ам|ами|ах)|копе(?:йка|йку|йки|йке|йкой|ек|йкам|йками|йках)|нумизматик(?:а|и|е|у|ой)|coins?)$/u],
    ['phones', /^(?:наушник(?:а|у|ом|е|и|ов|ам|ами|ах)?|гарнитур(?:а|у|ы|ой|е|ам|ами|ах)?|амбушюр(?:а|ы|у|ой|ам|ами|ах)?|(?:headphones?|headsets?|earphones?))$/u],
    ['lamp', /^(?:бра|ламп(?:а|у|ы|е|ой|ою|ам|ами|ах)?|лампоч(?:ка|ку|ки|ке|кой|кам|ками|ках|ек)|(?:светильник|ночник)(?:а|у|ом|е|и|ов|ам|ами|ах)?|lamps?)$/u],
    ['wallet', /^(?:кошел(?:ек|ька|ьку|ьком|ьке|ьки|ьков|ькам|ьками|ьках)|бумажник(?:а|у|ом|е|и|ов|ам|ами|ах)?|портмоне|wallets?)$/u],
    ['folder', /^(?:пап(?:ка|ку|ки|ке|кой|ок|кам|ками|ках)|скоросшивател(?:ь|я|ю|ем|е|и|ей|ям|ями|ях)|folders?)$/u],
    ['pen', /^(?:руч(?:ка|ку|ки|ке|кой|ек|кам|ками|ках)|авторуч(?:ка|ку|ки|ке|кой|ек|кам|ками|ках)|пер(?:о|а|у|ом|е|ья|ьев)|pens?)$/u],
  ];

  const quantities = new Map([
    ['ноль', 0], ['один', 1], ['одна', 1], ['одно', 1], ['одну', 1],
    ['два', 2], ['две', 2], ['пара', 2], ['пару', 2], ['полтора', 1.5], ['полторы', 1.5],
    ['три', 3], ['четыре', 4], ['пять', 5], ['шесть', 6], ['семь', 7],
    ['восемь', 8], ['девять', 9], ['десять', 10], ['одиннадцать', 11],
    ['двенадцать', 12], ['дюжина', 12], ['тринадцать', 13], ['четырнадцать', 14],
    ['пятнадцать', 15], ['шестнадцать', 16],
  ]);
  const separators = new Set([',', '.', ';', ':', '!', '?', '+', '&', '/', '\n', 'и', 'или', 'либо', 'плюс', 'а', 'но', 'зато', 'and', 'with', 'с', 'со']);
  const negativeMarkers = new Set([
    'без', 'кроме', 'исключая', 'убери', 'убрать', 'исключи', 'исключить', 'не',
    'никаких', 'никакого', 'никакой', 'никакую', 'without', 'except',
  ]);
  const removalCommands = new Set(['убери', 'убрать', 'исключи', 'исключить']);
  const listConnectors = new Set(['и', 'или', 'либо', 'and']);
  const genitiveModifier = /^\p{L}{3,}(?:ого|его|ых|их|ой|ей)$/u;
  const action = /^(?:добав(?:ь|ьте|ить)|покаж(?:и|ите)|показывать|остав(?:ь|ьте|ить)|дай|дайте|возьми|постав(?:ь|ьте)|встав(?:ь|ьте)|нуж(?:ен|на|но|ны)|использ(?:уй|уйте|овать)|надо|хоч(?:у|ется))$/u;
  const descriptor = /^(?:(?:настольн|шариков|перьев|мобильн|проводн|беспроводн|денежн|бумажн|цветочн|художественн|нов|стар|лишн|больш|маленьк|тяжел|легк)(?:ый|ий|ая|ое|ые|ие|ую|юю|ой|ей|ого|его|ому|ему|ых|их|ыми|ими|ым|им|ом|ем)|(?:наш|ваш|мо|сво)(?:я|й|и|е|их|ими|им|ем|их|ю|а|у|его|ему|ими)?|каких|либо|какой|то|этот|эти)$/u;
  const background = /^(?:фон(?:ов\p{L}*)?|монохром\p{L}*|сер(?:ый|ая|ое|ые|ую|ой)|background)$/u;
  const foreground = /^(?:цветн\p{L}*|главн\p{L}*|основн\p{L}*|foreground)$/u;

  function normalize(value) {
    return value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е');
  }

  function tokensOf(input) {
    // Preserve original spelling in feedback and keep punctuation as scope boundaries.
    return [...input.normalize('NFKC').matchAll(/[−-]?\d+(?:[.,]\d+)?|[\p{L}\p{M}]+|[,;.!?:\n+×&/]/gu)]
      .map(match => ({ raw: match[0], value: normalize(match[0]) }));
  }

  function objectKey(word) {
    return aliases.find(([, pattern]) => pattern.test(word))?.[0];
  }

  function impliedExclusion(word) {
    if (/^(?:экран|гаджет|девайс|созвон|звон)\p{L}*$/u.test(word)) return 'phone';
    if (/^(?:мелоч|сдач|наличн)\p{L}*$/u.test(word)) return 'coin';
    if (/^(?:документ|бумаг)\p{L}*$/u.test(word)) return 'folder';
    return undefined;
  }

  function quantity(word) {
    if (quantities.has(word)) return quantities.get(word);
    if (/^[−-]?\d+(?:[.,]\d+)?$/u.test(word)) return Number(word.replace('−', '-').replace(',', '.'));
    return undefined;
  }

  function readNegation(tokens) {
    const positions = new Set();
    const keys = new Set();
    const exclusionKey = word => objectKey(word) ?? impliedExclusion(word);
    function negatedObject(cursor) {
      const start = cursor;
      while (cursor < start + 4) {
        const word = tokens[cursor]?.value;
        if (word === undefined) break;
        if (exclusionKey(word)) break;
        if (!action.test(word) && !descriptor.test(word) && !background.test(word) &&
            !foreground.test(word) && quantity(word) === undefined && word !== 'только') {
          const next = tokens[cursor + 1]?.value ?? '';
          if (!genitiveModifier.test(word) || !exclusionKey(next)) break;
        }
        cursor++;
      }
      return cursor;
    }

    for (const [index, { value }] of tokens.entries()) {
      if (!negativeMarkers.has(value)) continue;
      if (value === 'не' && ['только', 'просто'].includes(tokens[index + 1]?.value)) continue;
      positions.add(index);
      let start = index + 1;
      while (start < tokens.length) {
        const stop = negatedObject(start);
        const word = tokens[stop]?.value ?? '';
        if (!/^\p{L}+$/u.test(word) || separators.has(word)) break;
        // Keep predicates such as "не стыкуются" as positive evidence of a problem.
        if (value === 'не' && stop === start && !objectKey(word) && !impliedExclusion(word)) break;
        // Removing noise suggests an audio scene. Removing headphones excludes an asset.
        if (removalCommands.has(value) && !objectKey(word) && !impliedExclusion(word)) break;
        for (let cursor = start; cursor <= stop; cursor++) positions.add(cursor);
        const key = exclusionKey(word);
        if (key) keys.add(key);
        if (!listConnectors.has(tokens[stop + 1]?.value)) break;
        const next = negatedObject(stop + 2);
        if (!exclusionKey(tokens[next]?.value ?? '')) break;
        positions.add(stop + 1);
        start = stop + 2;
      }
    }
    return { keys, positions };
  }

  function reject(message) {
    return { items: [], status: 'empty', message };
  }

  function parseObjects(input) {
    const text = String(input ?? '').trim();
    if (!text) return reject('Укажите предметы, например «две монеты и книга».');
    if (text.length > maxInput) return reject('Сократите список предметов до 1200 знаков.');
    const tokens = tokensOf(text);
    const { keys: excluded, positions } = readNegation(tokens);
    const items = [];
    const unknown = new Set();
    const invalid = new Set();
    let excess = false;
    let count;
    let countSign = 1;
    let nextRole = 'main';
    let name = [];

    function finishName() {
      if (name.length) unknown.add(name.join(' '));
      else if (count !== undefined) invalid.add('Укажите предмет после количества.');
      name = [];
      count = undefined;
      countSign = 1;
    }

    for (let index = 0; index < tokens.length; index++) {
      const { raw, value } = tokens[index];
      if (positions.has(index) || separators.has(value)) {
        finishName();
        nextRole = 'main';
        continue;
      }
      if (value === 'не' && ['только', 'просто'].includes(tokens[index + 1]?.value)) {
        index++;
        continue;
      }
      if (value === 'минус' && quantity(tokens[index + 1]?.value ?? '') !== undefined) {
        countSign = -1;
        continue;
      }
      if (value === 'на' && /^(?:фоне|заднем)$/u.test(tokens[index + 1]?.value ?? '')) {
        nextRole = 'background';
        index += tokens[index + 2]?.value === 'плане' ? 2 : 1;
        continue;
      }
      if (background.test(value) || foreground.test(value)) {
        nextRole = background.test(value) ? 'background' : 'main';
        continue;
      }
      const numeric = quantity(value);
      if (numeric !== undefined) {
        if (count !== undefined || name.length) finishName();
        count = numeric * countSign;
        countSign = 1;
        continue;
      }
      if (action.test(value) || descriptor.test(value)) continue;
      const key = objectKey(value);
      if (!key) {
        name.push(raw);
        continue;
      }
      if (name.length) {
        // A space alone may separate object names, as well as a comma.
        unknown.add(name.join(' '));
        name = [];
      }
      if (/^[xх×]$/u.test(tokens[index + 1]?.value ?? '')) {
        const postfix = quantity(tokens[index + 2]?.value ?? '');
        if (postfix !== undefined) {
          count = postfix;
          index += 2;
        }
      }
      const copies = count ?? 1;
      if (!Number.isInteger(copies) || copies < 1) {
        invalid.add('Количество для «' + labels[key] + '» должно быть целым числом от 1.');
      } else if (!excluded.has(key)) {
        const added = Math.min(copies, maxObjects - items.length);
        for (let copy = 0; copy < added; copy++) items.push({ key, role: nextRole });
        if (added < copies) excess = true;
      }
      count = undefined;
      nextRole = 'main';
    }
    finishName();

    const notes = [];
    if (unknown.size) notes.push('Не найдены в библиотеке: ' + [...unknown].join(', ') + '.');
    notes.push(...invalid);
    if (excess) notes.push('На холст добавлены первые ' + maxObjects + ' предметов.');
    if (excluded.size) notes.push('Исключены: ' + [...excluded].map(key => labels[key]).join(', ') + '.');
    if (!items.length) return reject(notes.join(' ') || 'Укажите хотя бы один предмет из библиотеки.');
    return {
      items,
      status: unknown.size || invalid.size || excess ? 'partial' : 'ok',
      message: notes.join(' ') || 'Предметы расставлены в указанном порядке.',
      layout: 'cluster',
    };
  }

  // Weighted themes combine strong idioms and ordinary lexical evidence. Asterisks
  // match inflections, but only from a word boundary (e.g. учёба, never ручка).
  const themes = [
    {
      key: 'finance', title: 'Деньги и сбережения', layout: 'cluster',
      main: ['wallet', 'coin'], background: [],
      cues: [[8, 'деньг*|денеж*|бюджет*|финанс*|накоп*|доход*|расход*|сбереж*|зарплат*|banking|sav* money|budget*'],
        [5, 'оплат*|банк*|копить|коплю|копим|копил*|скопи*|эконом*|вклад*|инвест*|купюр*|капитал*|кошел*'],
        [4, 'покуп*|заработ*|наличн*|тратить|траты|монет*|кредит*|долг|долги|долгов|долгами|ценник*|сдача'],
        [8, 'финансовая подушка|на черный день|деньги любят счет|по карману|затянуть пояс|влететь в копеечку|свести концы с концами'],
        [8, ['карман*|звен*|сдач*|пересчита*|платим|платит*|платеж*', 'мелоч*|копееч*|рубл*']],
        [6, 'помеща* в карман*|вмести* в карман*|глубин* карман*']],
    },
    {
      key: 'learning', title: 'Учёба и знания', layout: 'diagonal',
      main: ['book', 'pen'], background: ['lamp'],
      cues: [[8, 'учеб*|учусь|учимся|учить*|школ*|урок*|экзамен*|зачет*|знани*|образован*|ученик*|студент*|study*|learn*'],
        [4, 'запомн*|повторен*|трениров* памяти|конспект*|лекци*|задани*|университет*|тетрад*|домашка|диктант*|семинар*'],
        [8, 'гранит науки|век живи век учись|первый звонок|снова за парт*']],
    },
    {
      key: 'reading', title: 'Чтение и истории', layout: 'editorial',
      main: ['book'], background: ['lamp'],
      cues: [[8, 'нов* глав*|переверн* страниц*|глав* жизни|открытая книга|между строк|впиш* в историю|окно в мир'],
        [7, 'чита*|чтени*|книжн*|литератур*|библиотек*|роман*|рассказ*|сказк*|reading'],
        [4, 'страниц*|сюжет*|погруж* в книг*|геро* книг*|закладк*']],
    },
    {
      key: 'digital', title: 'Связь и цифровой мир', layout: 'diagonal',
      main: ['phone'], background: ['phones'],
      cues: [[8, 'на одной волн*|на проводе|выйти на связь|всегда на связи|весь мир в кармане|держ* связь|остава* на связи'],
        [6, 'звон*|созвон*|позвон*|переписк*|мессенджер*|соцсет*|уведомлен*|экран*|видеосвяз*|онлайн|интернет*|цифров*|смс|смартфон*|абонент*|удален* встреч*|online'],
        [4, 'связь|контакт*|сообщен*|приложен*|разговор*|дистанцион*|дозвон*|безбумажн*'],
        [8, ['расстоян*|далек*|километр*|издалека|через города',
          'разговор*|связ*|встреч*|ниточ*|протян*|мост*|письм*|ответ*|рядом|близк*']]],
    },
    {
      key: 'audio', title: 'Музыка и звук', layout: 'cluster',
      main: ['phones'], background: ['phone'],
      cues: [[8, 'музык*|саундтрек*|подкаст*|аудио*|плейлист*|песн*|мелоди*|акустик*|ритм*|music|soundtrack*|playlist*'],
        [6, 'слуша*|послуш*|прослуш*|услыш*|слыш*|трек*|громкост*|звук*|концерт*|джаз*|песня|шепот*|эхо|озвуч*|голос*|шум*'],
        [8, 'включ* звук*|город звучит|звуки города|пойм* ритм*|музыка в голове'],
        [9, ['частот*|волна|волну|вибрац*|радио*', 'голос*|звуч*|звон*|тишин*|сердц*|слуша*|услыш*|слыш*']]],
    },
    {
      key: 'pause', title: 'Пауза и внимание', layout: 'editorial',
      main: ['book'], background: ['lamp', 'flowers'],
      cues: [[9, 'цифров* детокс|полезная пауза|тих* утро|время для себя|режим полета|проветрить мысли|верну* к себе'],
        [6, 'тишин*|отдох*|замедл*|выдох*|выключ* уведомл*|перезагруз*|офлайн|заземл*|отключ* экран*|осознан*'],
        [5, 'передышк*|пауза|отдых*|тих*|уют*|спокойств*|сосредоточ*'],
        [8, ['вечер*|утро|полчаса|час тишины', 'к себе|себя|выдох*|отойти|перевести дыхание']]],
    },
    {
      key: 'renewal', title: 'Обновление и новый рост', layout: 'diagonal',
      main: ['flowers', 'lamp'], background: [],
      cues: [[9, 'второе дыхание|новый вдох|вдохнуть заново|вдохнуть жизнь|время расцветать|дать себе шанс|начать заново|нов* начал*|выход из зоны комфорта'],
        [6, 'возрожден*|обновлен*|расцвет*|распуска*|пробужден*|новая жизнь|второй шанс|новый рост']],
    },
    {
      key: 'puzzle', title: 'Решение из деталей', layout: 'cluster',
      main: ['puzzle', 'pen'], background: [],
      cues: [[9, 'пазл сложи*|слож* пазл*|собрать по частям|части целого|мозаик*|кусочки целого|ключ к задач*|свести концы*|вместе мы сила|распут* клубок'],
        [7, 'головолом*|задач*|разгад*|загадк*|логик*|решени*|декомпози*|состыков*|настольн* игр*|teamwork|problem solv*'],
        [4, 'команд*|вместе|сочетан*|собер* вместе|стратег*|алгоритм*|схема'],
        [8, ['собр*|собер*|слож*|состав*|сошл*|совпал*|стык*|состыков*|соедин*|найд*|потеря*|един*|общ*',
          'част*|фрагмент*|кусоч*|оскол*|детал*|элемент*|шаг*|целое|целиком|точк*']],
        [8, ['ключ|ключик|отмычк*', 'вопрос*|сложност*|загадк*|ответ*|решени*']]],
    },
    {
      key: 'order', title: 'Порядок и документы', layout: 'cluster',
      main: ['folder', 'pen'], background: [],
      cues: [[9, 'по полочкам|все по местам|разгрести завалы|дело в папке|бумажная работа|с чистого стола'],
        [7, 'документ*|архив*|порядок|упорядоч*|бумаг*|канцеляр*|сортиров*|картотек*|организова*'],
        [5, 'отчет*|досье|делопроизводств*|офис*|проект*|договор*|списки|расписани*|бюрократ*|файлы|разлож*|работа|работу|работе|рабоч* стол*'],
        [8, ['хран*|сохран*|сбереч*|собр*|бережно|перелист*',
          'памят*|воспоминан*|обложк*|важн*|выдержк*|письм*']]],
    },
    {
      key: 'writing', title: 'Записи и планы', layout: 'diagonal',
      main: ['pen', 'book'], background: ['lamp'],
      cues: [[8, 'с чистого листа|постав* точку|черным по белому|возьми* перо|первый черновик|дневник*'],
        [7, 'писать|напис*|запис*|заметк*|блокнот*|журнал*|подпиш*|письм*|почерк*|рукопис*|writing'],
        [5, 'план|плана|планы|планов|планирован*|наброс*|черновик*|подпис*|нарис*|рисован*|скетч*|перечень|заполн*|сценари*'],
        [8, ['мысл*|чувств*|идея|идеи|идею|слов*', 'форм*|строк*|бумаг*|наброс*|зафиксир*|выраз*']]],
    },
    {
      key: 'spark', title: 'Идеи и вдохновение', layout: 'editorial',
      main: ['lamp', 'pen'], background: ['puzzle'],
      cues: [[9, 'эврика|озарен*|свет в конце тоннел*|лампочка зажглась|зажечь искру|поймать идею|горит идеей|вспышка мысли|первая искра'],
        [7, 'вдохнов*|идея|идеи|идею|творчес*|озарить|изобрета*|инсайт*|креатив*|brainstorm*'],
        [4, 'свет|освет*|ламп*|светильник*|сумерк*|поздний вечер|работа ночью'],
        [8, ['проблеск*|просвет*|сиян*|огон*|свет*|искра|искр*', 'надежд*|тоннел*|туннел*|темнот*|тьма|путь|мысл*']]],
    },
    {
      key: 'flowers', title: 'Цветы и знаки внимания', layout: 'editorial',
      main: ['flowers'], background: [],
      cues: [[8, 'весна|весенн*|расцвет*|зацвел*|цветен*|подар*|букет*|тюльпан*|цветочн*|gift*|spring'],
        [6, 'свидан*|сюрприз*|поздрав*|знак внимани*|благодар*|праздник*|день рожден*|романтик*|новый рост'],
        [8, 'цветы без повода|язык цветов|весна на пороге'],
        [8, ['лето|летний|летние|тепл*|солнечн*|сезон*', 'угол|дома|комнат*|подоконник*|вдохн*|оживи*']]],
    },
  ];

  const cuePattern = pattern => new RegExp(
    '(?:^|[^\\p{L}])(?:' + pattern.replaceAll('*', '\\p{L}*') + ')(?=$|[^\\p{L}])', 'u',
  );
  const scoredThemes = themes.map(theme => ({
    ...theme,
    cues: theme.cues.map(([weight, pattern]) => [weight, [pattern].flat().map(cuePattern)]),
  }));

  function viable(term, keys) {
    const items = [];
    for (const key of term.main) {
      if (!keys.has(key)) items.push({ key, role: 'main' });
    }
    for (const key of term.background) {
      if (!keys.has(key)) items.push({ key, role: items.length ? 'background' : 'main' });
    }
    return items;
  }

  function forConstraints(theme, excluded) {
    if (theme.key === 'digital' && excluded.has('phone')) {
      return { ...theme, title: 'Письменное общение', main: ['pen', 'folder'], background: [] };
    }
    if (theme.key === 'flowers' && excluded.has('flowers')) {
      return { ...theme, title: 'Личное послание', main: ['pen'], background: ['phone'] };
    }
    if (theme.key === 'puzzle' && excluded.has('puzzle')) {
      return { ...theme, title: 'Правила и счёт', main: ['pen'], background: ['book'] };
    }
    return theme;
  }

  function buildPlan(theme, other, direct, excluded) {
    const first = viable(theme, excluded);
    const second = other ? viable(other, excluded) : [];
    const items = [...new Set(direct)].map(key => ({ key, role: 'main' }));
    for (const entry of [first[0], second[0], ...first.slice(1), ...second.slice(1)]) {
      if (entry && !items.some(item => item.key === entry.key)) items.push(entry);
      if (items.length >= 3) break;
    }
    return {
      items,
      theme: other ? theme.title + ' · ' + other.title.toLowerCase() : theme.title,
      layout: theme.layout,
    };
  }

  function interpretTitle(input) {
    const text = String(input ?? '').trim();
    if (!text) return reject('Введите заголовок или опишите идею несколькими словами.');
    if (text.length > maxInput) return reject('Сократите описание до 1200 знаков.');
    const tokens = tokensOf(text);
    const { keys: excluded, positions } = readNegation(tokens);
    for (const index of positions) {
      const key = impliedExclusion(tokens[index].value);
      if (key) excluded.add(key);
    }
    // Mask the removed words instead of joining distant words into a false idiom.
    const positive = tokens.map((token, index) => positions.has(index) ? '·' : token.value).join(' ');
    const direct = tokens.map((token, index) => {
      if (positions.has(index)) return undefined;
      const key = objectKey(token.value);
      if (key === 'pen' && /^(?:двер|шкаф|окн|чаш|сумк|чемодан|птиц)/u.test(tokens[index + 1]?.value ?? '')) return undefined;
      return key && !excluded.has(key) ? key : undefined;
    }).filter(Boolean);
    const uniqueDirect = [...new Set(direct)];
    const isOnlyNames = uniqueDirect.length && tokens.every(({ value }, index) =>
      positions.has(index) || separators.has(value) || objectKey(value) || quantity(value) !== undefined ||
      descriptor.test(value) || background.test(value) || foreground.test(value) || action.test(value));
    if (isOnlyNames) {
      const plan = parseObjects(text);
      return { ...plan, theme: 'Предметы из заголовка' };
    }

    const unplugged = (excluded.has('phone') || excluded.has('phones')) &&
      /(?:^| )(?:(?:день|утро|вечер|неделя|жизнь|час|детокс|offline|weekend)|отключ\p{L}*|отдых\p{L}*)(?=$| )/u.test(positive);
    const paperless = excluded.has('folder') &&
      [...positions].some(index => /^(?:документ|бумаг)\p{L}*$/u.test(tokens[index].value));
    const candidates = scoredThemes
      .map(theme => ({
        ...forConstraints(theme, excluded),
        score: theme.cues.reduce((score, [weight, cues]) => score + (cues.every(cue => cue.test(positive)) ? weight : 0), 0) +
          (theme.key === 'pause' && unplugged ? 9 : 0) + (theme.key === 'digital' && paperless ? 8 : 0),
      }))
      .filter(theme => theme.score >= 4 && viable(theme, excluded).length)
      .toSorted((a, b) => b.score - a.score);

    if (!candidates.length && !uniqueDirect.length) {
      const message = excluded.size
        ? 'Учёл исключения. Добавьте тему или назовите подходящий предмет.'
        : 'Пока не нашёл подходящий сюжет в библиотеке. Уточните тему или назовите предметы.';
      return reject(message);
    }
    if (!candidates.length) {
      return {
        items: uniqueDirect.map(key => ({ key, role: 'main' })),
        status: 'ok',
        message: 'Использованы предметы, явно названные в заголовке.',
        theme: 'Предметы из заголовка',
        layout: 'cluster',
      };
    }

    const [best, next] = candidates;
    // A second evidenced concept adds a meaningful object rather than filling empty space.
    const combine = next && next.score >= Math.max(6, best.score * .6) &&
      next.main.some(key => !excluded.has(key) && !best.main.includes(key)) ? next : undefined;
    const plan = buildPlan(best, combine, uniqueDirect, excluded);
    const alternative = next && next.score >= 5 ? buildPlan(next, undefined, uniqueDirect, excluded) : null;
    const alternatives = alternative && alternative.items.length &&
      new Set([...alternative.items, ...plan.items].map(item => item.key)).size >
        Math.min(alternative.items.length, plan.items.length)
      ? [alternative] : [];
    return {
      ...plan,
      alternatives,
      status: best.score < 6 && !uniqueDirect.length ? 'partial' : 'ok',
      message: 'Тема: ' + plan.theme.toLowerCase() + '.',
    };
  }

  return Object.freeze({ labels, maxObjects, parseObjects, interpretTitle });
})();

if (typeof module === 'object' && module.exports) module.exports = IllustrationPlanner;
else globalThis.IllustrationPlanner = IllustrationPlanner;
