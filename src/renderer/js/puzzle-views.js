import { sortingItems, shuffleForSorting, scoreSorting, shuffled, memoryPairs, buildCrossword, entryCells, crosswordLetters, scoreCrossword } from './puzzles.js';
import { sanitizeModuleDescriptionHtml, escapeHtml, escapeAttr, attachPointerDrag } from './utils.js';

/**
 * Anzeige von Reihenfolge, Memory und Kreuzworträtsel (aufgerufen aus
 * h5p-renderer.js). Die Auswertung liest den Zustand aus dem DOM, siehe
 * answer-eval.js; die Logik steht in puzzles.js.
 */

const description = (content) => (content.taskDescription
  ? `<div class="puzzle-description">${sanitizeModuleDescriptionHtml(content.taskDescription)}</div>` : '');

const image = (url, cls, alt = '') => (url
  ? `<img class="${cls}" src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" draggable="false" />` : '');

// ==================== REIHENFOLGE ====================

/**
 * Elemente gemischt; umsortiert wird per Ziehen (Finger, Stift, Maus) oder
 * mit den Pfeilknöpfen (Tastatur). Jedes Element trägt seine Stelle in der
 * Lösung als data-index.
 */
export function renderSorting(div, content, { suppressFeedback = false } = {}) {
  const items = sortingItems(content);
  if (items.length < 2) {
    div.innerHTML = '<p class="hint">Für eine Reihenfolge braucht es mindestens zwei Elemente.</p>';
    return;
  }
  const horizontal = content.layout === 'horizontal';
  const [prev, next] = horizontal ? ['←', '→'] : ['↑', '↓'];
  div.innerHTML = `
    <div class="sort-task">
      ${description(content)}
      <ol class="sort-list${horizontal ? ' sort-horizontal' : ''}"></ol>
      <p class="hint">Zum Umsortieren ziehen oder die Pfeile benutzen.</p>
      ${suppressFeedback ? '' : `<div class="puzzle-actions"><button type="button" class="btn btn-primary btn-sm sort-check">Überprüfen</button></div>
      <div class="puzzle-feedback sort-feedback"></div>`}
    </div>`;
  const list = div.querySelector('.sort-list');
  const feedback = div.querySelector('.sort-feedback');

  const changed = () => {
    list.querySelectorAll('.sort-item').forEach((el, i) => {
      el.classList.remove('is-right', 'is-wrong');
      el.querySelector('.sort-pos').textContent = String(i + 1);
    });
    if (feedback) feedback.innerHTML = '';
  };

  const clearMarker = () => list.querySelectorAll('.drop-before, .drop-after')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  // Vor oder hinter das Element unter dem Zeiger – je nachdem, über welcher Hälfte er steht.
  const slotAt = (target, info, self) => {
    const li = target && target.closest ? target.closest('.sort-item') : null;
    if (!li || li === self || !list.contains(li)) return null;
    const r = li.getBoundingClientRect();
    const after = horizontal ? info.x > r.left + r.width / 2 : info.y > r.top + r.height / 2;
    return { li, after };
  };
  const scrollContainer = document.getElementById('mainContent');

  for (const item of shuffleForSorting(items)) {
    const li = document.createElement('li');
    li.className = 'sort-item';
    li.dataset.index = String(item.index);
    li.innerHTML = `
      <span class="sort-pos" aria-hidden="true"></span>
      ${image(item.imageUrl, 'sort-img', item.text)}
      ${item.text ? `<span class="sort-text">${escapeHtml(item.text)}</span>` : ''}
      <span class="sort-moves">
        <button type="button" class="sort-prev" aria-label="Eins nach vorn">${prev}</button>
        <button type="button" class="sort-next" aria-label="Eins nach hinten">${next}</button>
      </span>`;
    li.querySelector('.sort-prev').addEventListener('click', (e) => {
      if (li.previousElementSibling) { li.previousElementSibling.before(li); changed(); }
      e.currentTarget.focus();
    });
    li.querySelector('.sort-next').addEventListener('click', (e) => {
      if (li.nextElementSibling) { li.nextElementSibling.after(li); changed(); }
      e.currentTarget.focus();
    });
    attachPointerDrag(li, {
      scrollContainer,
      onHover: (target, info) => {
        clearMarker();
        const slot = target && slotAt(target, info, li);
        if (slot) slot.li.classList.add(slot.after ? 'drop-after' : 'drop-before');
      },
      onDrop: (target, info) => {
        const slot = slotAt(target, info, li);
        if (!slot) return;
        slot.li[slot.after ? 'after' : 'before'](li);
        changed();
      },
    });
    list.appendChild(li);
  }
  changed();

  div.querySelector('.sort-check')?.addEventListener('click', () => {
    const els = [...list.querySelectorAll('.sort-item')];
    const given = els.map((el) => items[Number(el.dataset.index)].key);
    els.forEach((el, i) => {
      const right = given[i] === items[i].key;
      el.classList.toggle('is-right', right);
      el.classList.toggle('is-wrong', !right);
    });
    const score = scoreSorting(items.map((it) => it.key), given);
    feedback.innerHTML = score.isCorrect
      ? '<span class="puzzle-right">✅ Richtig sortiert!</span>'
      : `<span style="font-weight:600;">${score.pairs} von ${score.totalPairs} Paaren stehen richtig hintereinander.</span>`;
  });
}

// ==================== MEMORY ====================

/**
 * Memory: Karten aufdecken, zwei zur Zeit. Ein Übungsspiel – es zählt nicht
 * in der Auswertung (informational in h5p-types.js). Züge und gefundene
 * Paare stehen am Spielfeld (data-moves, data-found, data-total).
 */
export function renderMemory(div, content) {
  const pairs = memoryPairs(content);
  if (pairs.length < 2) {
    div.innerHTML = '<p class="hint">Für ein Memory braucht es mindestens zwei Paare.</p>';
    return;
  }
  const face = (side) => `${image(side.imageUrl, 'mem-img', side.text)}${side.text ? `<span class="mem-text">${escapeHtml(side.text)}</span>` : ''}`;

  const start = () => {
    const cards = shuffled(pairs.flatMap((p, i) => [{ pair: i, side: p.a }, { pair: i, side: p.b }]));
    div.innerHTML = `
      <div class="mem-task">
        ${description(content)}
        <div class="mem-status"><span class="mem-moves">Züge: 0</span><span class="mem-found">Paare: 0 / ${pairs.length}</span></div>
        <div class="mem-board" data-moves="0" data-found="0" data-total="${pairs.length}">
          ${cards.map((c, i) => `
            <button type="button" class="mem-card" data-pair="${c.pair}" aria-label="Karte ${i + 1}, verdeckt">
              <span class="mem-inner">
                <span class="mem-back" aria-hidden="true">?</span>
                <span class="mem-front">${face(c.side)}</span>
              </span>
            </button>`).join('')}
        </div>
        <div class="puzzle-feedback mem-done"></div>
      </div>`;
    const board = div.querySelector('.mem-board');
    let open = [];
    let busy = false;
    let moves = 0;
    let found = 0;
    const status = () => {
      board.dataset.moves = String(moves);
      board.dataset.found = String(found);
      div.querySelector('.mem-moves').textContent = `Züge: ${moves}`;
      div.querySelector('.mem-found').textContent = `Paare: ${found} / ${pairs.length}`;
    };
    const label = (card, shown) => card.setAttribute('aria-label', shown
      ? `Karte: ${card.querySelector('.mem-front').textContent.trim() || 'Bild'}` : 'Karte, verdeckt');

    board.querySelectorAll('.mem-card').forEach((card) => card.addEventListener('click', () => {
      if (busy || card.classList.contains('is-open') || card.classList.contains('is-found')) return;
      card.classList.add('is-open');
      label(card, true);
      open.push(card);
      if (open.length < 2) return;
      moves++;
      const [x, y] = open;
      open = [];
      if (x.dataset.pair === y.dataset.pair) {
        found++;
        x.classList.add('is-found'); y.classList.add('is-found');
        status();
        if (found === pairs.length) {
          div.querySelector('.mem-done').innerHTML = `<span class="puzzle-right">🎉 Geschafft in ${moves} Zügen!</span>
            <button type="button" class="btn btn-secondary btn-sm mem-again">🔁 Nochmal</button>`;
          div.querySelector('.mem-again').addEventListener('click', start);
        }
        return;
      }
      status();
      busy = true;
      setTimeout(() => {
        x.classList.remove('is-open'); y.classList.remove('is-open');
        label(x, false); label(y, false);
        busy = false;
      }, 1100);
    }));
  };
  start();
}

// ==================== KREUZWORTRÄTSEL ====================

/**
 * Kreuzworträtsel: ein Eingabefeld je Buchstabe (so öffnet sich auf Tablet
 * und Handy die Tastatur). Das Gitter ergibt sich aus Wörtern und Startwert
 * (puzzles.js) – alle Schüler sehen dasselbe, die Auswertung baut es nach.
 */
export function renderCrossword(div, content, { suppressFeedback = false } = {}) {
  const puzzle = buildCrossword(content);
  const { layout, words } = puzzle;
  if (!layout.entries.length) {
    div.innerHTML = '<p class="hint">Noch keine Wörter – jedes Lösungswort braucht mindestens zwei Buchstaben.</p>';
    return;
  }
  const dirName = { across: 'waagerecht', down: 'senkrecht' };
  // Je Feld: Nummer und zu welchen Einträgen (Index in layout.entries) es gehört.
  const at = new Map();
  const cellInfo = (r, c) => {
    const k = `${r},${c}`;
    if (!at.has(k)) at.set(k, {});
    return at.get(k);
  };
  layout.entries.forEach((e, i) => {
    entryCells(e).forEach(([r, c], n) => {
      const info = cellInfo(r, c);
      info[e.dir] = i;
      if (n === 0) info.number = e.number;
    });
  });

  let gridHtml = '';
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (!layout.cells[r][c]) { gridHtml += '<div class="cw-block"></div>'; continue; }
      const info = cellInfo(r, c);
      gridHtml += `<div class="cw-cell">${info.number ? `<span class="cw-num">${info.number}</span>` : ''}
        <input type="text" data-r="${r}" data-c="${c}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false"
          aria-label="Feld Zeile ${r + 1}, Spalte ${c + 1}" /></div>`;
    }
  }
  const clueList = (dir) => layout.entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.dir === dir)
    .map(({ e, i }) => {
      const w = words[e.wordIndex];
      return `<li data-entry="${i}"><span class="cw-clue-num">${e.number}</span>
        <span class="cw-clue-text">${escapeHtml(w.clue || '…')} <span class="cw-clue-len">(${e.length})</span></span>
        ${image(w.imageUrl, 'cw-clue-img', w.clue)}</li>`;
    }).join('');

  div.innerHTML = `
    <div class="cw-task">
      ${description(content)}
      <div class="cw-bar">
        <div class="cw-current" aria-live="polite"></div>
        <button type="button" class="btn btn-secondary btn-sm cw-erase" title="Buchstaben löschen (wie die Rücktaste)">⌫</button>
      </div>
      <div class="cw-body">
        <div class="cw-grid" style="--cw-cols:${layout.cols};">${gridHtml}</div>
        <div class="cw-clues">
          ${layout.entries.some((e) => e.dir === 'across') ? `<div><h4>Waagerecht</h4><ol>${clueList('across')}</ol></div>` : ''}
          ${layout.entries.some((e) => e.dir === 'down') ? `<div><h4>Senkrecht</h4><ol>${clueList('down')}</ol></div>` : ''}
        </div>
      </div>
      ${suppressFeedback ? '' : `<div class="puzzle-actions"><button type="button" class="btn btn-primary btn-sm cw-check">Überprüfen</button></div>
      <div class="puzzle-feedback cw-feedback"></div>`}
    </div>`;

  const grid = div.querySelector('.cw-grid');
  const current = div.querySelector('.cw-current');
  const feedback = div.querySelector('.cw-feedback');
  const inputAt = (r, c) => grid.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
  const posOf = (input) => [Number(input.dataset.r), Number(input.dataset.c)];
  let active = 0; // Index in layout.entries
  let lastInput = null; // zuletzt aktives Feld – Ziel des ⌫-Knopfs

  const showEntry = (i) => {
    active = i;
    const e = layout.entries[i];
    grid.querySelectorAll('.cw-in-word').forEach((el) => el.classList.remove('cw-in-word'));
    entryCells(e).forEach(([r, c]) => inputAt(r, c).parentElement.classList.add('cw-in-word'));
    div.querySelectorAll('.cw-clues li').forEach((li) => li.classList.toggle('cw-clue-active', Number(li.dataset.entry) === i));
    current.innerHTML = `<strong>${e.number} ${dirName[e.dir]}:</strong> ${escapeHtml(words[e.wordIndex].clue || '…')}`;
  };
  const focusCell = (r, c) => {
    const input = inputAt(r, c);
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  };
  // Nächstes bzw. voriges Feld im aktiven Wort.
  const step = (input, delta) => {
    const [r, c] = posOf(input);
    const cells = entryCells(layout.entries[active]);
    const n = cells.findIndex(([rr, cc]) => rr === r && cc === c);
    const target = cells[n + delta];
    return target ? inputAt(target[0], target[1]) : null;
  };
  const clearMarks = () => {
    grid.querySelectorAll('.is-right, .is-wrong').forEach((el) => el.classList.remove('is-right', 'is-wrong'));
    div.querySelectorAll('.cw-clue-done').forEach((el) => el.classList.remove('cw-clue-done'));
    if (feedback) feedback.innerHTML = '';
  };

  // Rücktaste: Feld leeren, ist es schon leer, das vorige im Wort.
  const erase = (input) => {
    clearMarks();
    if (input.value) { input.value = ''; input.focus(); return; }
    const prevInput = step(input, -1);
    if (prevInput) { prevInput.value = ''; prevInput.focus(); } else input.focus();
  };

  grid.addEventListener('focusin', (ev) => {
    const input = ev.target.closest('input');
    if (!input) return;
    lastInput = input;
    const info = cellInfo(...posOf(input));
    const dir = layout.entries[active].dir;
    if (info[dir] !== undefined) showEntry(info[dir]);
    else showEntry(info.across ?? info.down);
  });
  // Klick auf das schon aktive Feld wechselt die Richtung (wo zwei Wörter kreuzen).
  grid.addEventListener('pointerdown', (ev) => {
    const input = ev.target.closest('input');
    if (!input || document.activeElement !== input) return;
    const info = cellInfo(...posOf(input));
    const other = layout.entries[active].dir === 'across' ? info.down : info.across;
    if (other !== undefined) showEntry(other);
  });
  grid.addEventListener('input', (ev) => {
    const input = ev.target.closest('input');
    if (!input) return;
    const letters = crosswordLetters(input.value);
    input.value = letters.length ? letters[letters.length - 1] : '';
    clearMarks();
    if (input.value) {
      const nextInput = step(input, 1);
      if (nextInput) { nextInput.focus(); nextInput.select(); }
    }
  });
  grid.addEventListener('keydown', (ev) => {
    const input = ev.target.closest('input');
    if (!input) return;
    const [r, c] = posOf(input);
    const moves = { ArrowRight: [0, 1, 'across'], ArrowLeft: [0, -1, 'across'], ArrowDown: [1, 0, 'down'], ArrowUp: [-1, 0, 'down'] };
    if (moves[ev.key]) {
      ev.preventDefault();
      const [dr, dc, dir] = moves[ev.key];
      const info = cellInfo(r, c);
      if (info[dir] !== undefined && layout.entries[active].dir !== dir) { showEntry(info[dir]); return; }
      // Über Lücken hinweg bis zum nächsten Buchstabenfeld in dieser Richtung.
      for (let rr = r + dr, cc = c + dc; rr >= 0 && cc >= 0 && rr < layout.rows && cc < layout.cols; rr += dr, cc += dc) {
        if (focusCell(rr, cc)) break;
      }
      return;
    }
    if (ev.key === 'Backspace') {
      ev.preventDefault();
      erase(input);
    }
  });
  // Eigener Knopf, weil viele Android-Tastaturen die Rücktaste in einem leeren
  // Feld nicht melden. Er nimmt den Fokus nicht weg – die Tastatur bleibt offen.
  const eraseBtn = div.querySelector('.cw-erase');
  eraseBtn.addEventListener('pointerdown', (ev) => ev.preventDefault());
  eraseBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
  eraseBtn.addEventListener('click', () => {
    if (!lastInput) {
      const [r, c] = entryCells(layout.entries[active])[0];
      lastInput = inputAt(r, c);
    }
    erase(lastInput);
  });
  div.querySelectorAll('.cw-clues li').forEach((li) => li.addEventListener('click', () => {
    const i = Number(li.dataset.entry);
    const cells = entryCells(layout.entries[i]);
    const empty = cells.find(([r, c]) => !inputAt(r, c).value) || cells[0];
    // Erst das Wort wählen: Beim Fokussieren eines Kreuzungsfelds bleibt dann seine Richtung.
    showEntry(i);
    focusCell(empty[0], empty[1]);
  }));
  showEntry(0);

  div.querySelector('.cw-check')?.addEventListener('click', () => {
    clearMarks();
    const score = scoreCrossword(puzzle, (r, c) => inputAt(r, c)?.value || '');
    const okEntries = new Set();
    score.perEntry.forEach((p, i) => { if (p.ok) okEntries.add(i); });
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const input = inputAt(r, c);
        if (!input || !input.value) continue;
        const info = cellInfo(r, c);
        if (input.value !== layout.cells[r][c]) input.parentElement.classList.add('is-wrong');
        else if (okEntries.has(info.across) || okEntries.has(info.down)) input.parentElement.classList.add('is-right');
      }
    }
    div.querySelectorAll('.cw-clues li').forEach((li) => li.classList.toggle('cw-clue-done', okEntries.has(Number(li.dataset.entry))));
    feedback.innerHTML = score.correct === score.total
      ? '<span class="puzzle-right">✅ Alles richtig!</span>'
      : `<span style="font-weight:600;">${score.correct} von ${score.total} Wörtern richtig</span>`;
  });
}
