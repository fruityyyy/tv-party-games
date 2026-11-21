// Shared helpers for the TV and phone pages.
const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };

function parseCard(card) {
  return { rank: card.slice(0, -1), suit: card.slice(-1) };
}

function isRed(card) {
  const s = card.slice(-1);
  return s === 'H' || s === 'D';
}

function jackType(card) {
  if (card === 'JC' || card === 'JD') return 'wild';
  if (card === 'JH' || card === 'JS') return 'remove';
  return null;
}

function cardLabel(card) {
  const { rank, suit } = parseCard(card);
  return rank + SUIT_GLYPH[suit];
}

// Classes and inner HTML for one card face, used for board cells and hand cards alike.
function faceClass(card) {
  const { rank } = parseCard(card);
  return 'face' + (isRed(card) ? ' red' : '') + ('JQK'.includes(rank) ? ' court' : '');
}

function faceHTML(card) {
  const { rank, suit } = parseCard(card);
  const g = SUIT_GLYPH[suit];
  return `<span class="idx"><span class="rank">${rank}</span><span class="suit">${g}</span></span><span class="pip">${g}</span>`;
}

// Sets the board's cell size. Height may differ from width so the board can fill the screen.
function setCellSize(cw, ch, gap) {
  const s = document.documentElement.style;
  s.setProperty('--cw', Math.floor(cw) + 'px');
  s.setProperty('--ch', Math.floor(ch) + 'px');
  s.setProperty('--u', Math.floor(Math.min(cw, ch)) + 'px');
  s.setProperty('--gap', gap + 'px');
}

// Builds the 10x10 board once and returns an update function.
function createBoard(el, { onCell } = {}) {
  const cells = [];
  let built = false;

  function build(board) {
    el.innerHTML = '';
    for (let r = 0; r < 10; r++) {
      cells[r] = [];
      for (let c = 0; c < 10; c++) {
        const key = board[r][c];
        const d = document.createElement('div');
        if (key === 'W') {
          d.className = 'cell face free';
          d.innerHTML = '<span class="star">★</span>';
        } else {
          d.className = 'cell ' + faceClass(key);
          d.innerHTML = faceHTML(key);
        }
        const chip = document.createElement('div');
        chip.className = 'chip';
        const num = document.createElement('div');
        num.className = 'num';
        d.append(chip, num);
        if (onCell) d.addEventListener('click', () => onCell(r, c));
        el.appendChild(d);
        cells[r][c] = { el: d, chip, num };
      }
    }
    built = true;
  }

  // `numbered`: label the targets 1, 2… so a phone can pick them by number.
  return function update(state, { targets = [], selected = null, ghost = null, numbered = false, removing = false } = {}) {
    if (!built) build(state.board);
    el.classList.toggle('choosing', targets.length > 0);
    el.classList.toggle('removing', removing);
    const numbers = new Map(numbered ? targets.map(([r, c], i) => [r * 10 + c, i + 1]) : []);
    const colors = Object.fromEntries(state.teams.map((t) => [t.id, t.color]));
    const tset = new Set(targets.map(([r, c]) => r * 10 + c));
    const lm = state.lastMove;
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++) {
        const { el: d, chip, num } = cells[r][c];
        num.textContent = numbers.get(r * 10 + c) || '';
        d.classList.toggle('numbered', numbers.has(r * 10 + c));
        const team = state.chips[r][c];
        // On the phone, preview your chip on the spot you picked.
        const isSel = !!selected && selected[0] === r && selected[1] === c;
        const shown = team || (isSel && ghost) || null;
        chip.style.color = shown ? colors[shown] : '';
        d.classList.toggle('has-chip', !!shown);
        d.classList.toggle('ghost', isSel && !!ghost && !team);
        d.classList.toggle('locked', !!state.locked[r][c]);
        d.classList.toggle('target', tset.has(r * 10 + c));
        d.classList.toggle('selected', isSel);
        d.classList.toggle('last', !!lm && !lm.skipped && lm.r === r && lm.c === c);
      }
  };
}
