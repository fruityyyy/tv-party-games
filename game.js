// Sequence rules engine. Pure game state, no networking.
const crypto = require('crypto');

// Standard Sequence board. 'W' = free corner (counts for every team).
const BOARD = [
  ['W', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', 'W'],
  ['6C', '5C', '4C', '3C', '2C', 'AH', 'KH', 'QH', '10H', '10S'],
  ['7C', 'AS', '2D', '3D', '4D', '5D', '6D', '7D', '9H', 'QS'],
  ['8C', 'KS', '6C', '5C', '4C', '3C', '2C', '8D', '8H', 'KS'],
  ['9C', 'QS', '7C', '6H', '5H', '4H', 'AH', '9D', '7H', 'AS'],
  ['10C', '10S', '8C', '7H', '2H', '3H', 'KH', '10D', '6H', '2D'],
  ['QC', '9S', '9C', '8H', '9H', '10H', 'QH', 'QD', '5H', '3D'],
  ['KC', '8S', '10C', 'QC', 'KC', 'AC', 'AD', 'KD', '4H', '4D'],
  ['AC', '7S', '6S', '5S', '4S', '3S', '2S', '2H', '3H', '5D'],
  ['W', 'AD', 'KD', 'QD', '10D', '9D', '8D', '7D', '6D', 'W'],
];

const TEAMS = [
  { id: 'blue', name: 'Blue', color: '#2f6fed' },
  { id: 'green', name: 'Green', color: '#1fa155' },
  { id: 'red', name: 'Red', color: '#e0393e' },
];

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const MAX_PLAYERS = 12;

// Two-eyed jacks are wild, one-eyed jacks remove an opponent chip.
function jackType(card) {
  if (card === 'JC' || card === 'JD') return 'wild';
  if (card === 'JH' || card === 'JS') return 'remove';
  return null;
}

function autoHandSize(n) {
  if (n <= 2) return 7;
  if (n <= 4) return 6;
  if (n <= 6) return 5;
  if (n <= 9) return 4;
  return 3;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newDeck() {
  const deck = [];
  for (let copy = 0; copy < 2; copy++)
    for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return shuffle(deck);
}

const grid = (v) => Array.from({ length: 10 }, () => Array.from({ length: 10 }, v));

class GameError extends Error {}

class Game {
  constructor() {
    this.players = new Map(); // id -> player
    this.adminId = null;
    this.teamCount = 2;
    this.handSizeSetting = 5;
    this.sequencesSetting = 'auto'; // or a fixed number of sequences to win
    this.phase = 'lobby';
    this.resetRound();
  }

  resetRound() {
    this.chips = grid(() => null);
    this.seqMark = grid(() => []); // teams whose sequence includes this cell
    this.sequences = [];
    this.deck = [];
    this.discard = [];
    this.order = [];
    this.turn = 0;
    this.deadUsed = false;
    this.lastMove = null;
    this.winner = null;
    this.moveCount = 0;
    this.pending = null; // card committed this turn, being aimed on the TV
  }

  get activeTeams() { return TEAMS.slice(0, this.teamCount); }
  get sequencesToWin() {
    if (this.sequencesSetting !== 'auto') return this.sequencesSetting;
    return this.teamCount === 2 ? 2 : 1;
  }
  get currentPlayerId() { return this.phase === 'playing' ? this.order[this.turn] : null; }

  // ---------- lobby ----------

  join(name) {
    name = String(name || '').trim().slice(0, 16);
    if (!name) throw new GameError('Enter a name');
    if (this.phase !== 'lobby') throw new GameError('A game is in progress. Wait for the next round.');
    if (this.players.size >= MAX_PLAYERS) throw new GameError('The table is full (12 players)');
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(16).toString('hex');
    const p = { id, token, name, team: this.smallestTeam(), hand: [], connected: true, joinedAt: Date.now() };
    this.players.set(id, p);
    if (!this.adminId) this.adminId = id;
    return p;
  }

  byToken(token) {
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  smallestTeam() {
    const counts = this.activeTeams.map((t) => ({ id: t.id, n: 0 }));
    for (const p of this.players.values()) {
      const c = counts.find((x) => x.id === p.team);
      if (c) c.n++;
    }
    counts.sort((a, b) => a.n - b.n);
    return counts[0].id;
  }

  requireAdmin(pid) {
    if (pid !== this.adminId) throw new GameError('Only the admin can do that');
  }

  requireLobby() {
    if (this.phase === 'playing') throw new GameError('Not while a game is running');
  }

  setTeam(pid, targetId, team) {
    this.requireAdmin(pid);
    this.requireLobby();
    const p = this.players.get(targetId);
    if (!p) throw new GameError('No such player');
    if (!this.activeTeams.some((t) => t.id === team)) throw new GameError('No such team');
    p.team = team;
  }

  setTeamCount(pid, n) {
    this.requireAdmin(pid);
    this.requireLobby();
    if (n !== 2 && n !== 3) throw new GameError('Teams must be 2 or 3');
    this.teamCount = n;
    // Rebalance in join order so every team gets players.
    [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
      .forEach((p, i) => { p.team = this.activeTeams[i % n].id; });
  }

  setHandSize(pid, v) {
    this.requireAdmin(pid);
    this.requireLobby();
    if (v !== 'auto' && !(Number.isInteger(v) && v >= 3 && v <= 7)) throw new GameError('Hand size must be auto or 3–7');
    this.handSizeSetting = v;
  }

  setSequences(pid, v) {
    this.requireAdmin(pid);
    this.requireLobby();
    if (v !== 'auto' && !(Number.isInteger(v) && v >= 1 && v <= 4)) throw new GameError('Sequences to win must be auto or 1–4');
    this.sequencesSetting = v;
  }

  autoTeams(pid) {
    this.requireAdmin(pid);
    this.requireLobby();
    const ps = shuffle([...this.players.values()]);
    ps.forEach((p, i) => { p.team = this.activeTeams[i % this.teamCount].id; });
  }

  kick(pid, targetId) {
    this.requireAdmin(pid);
    this.requireLobby();
    if (targetId === pid) throw new GameError("You can't remove yourself");
    if (!this.players.delete(targetId)) throw new GameError('No such player');
  }

  makeAdmin(pid, targetId) {
    this.requireAdmin(pid);
    if (!this.players.has(targetId)) throw new GameError('No such player');
    this.adminId = targetId;
  }

  leave(pid) {
    if (this.phase === 'playing') throw new GameError('You can leave after the game');
    this.players.delete(pid);
    if (this.adminId === pid) this.adminId = this.players.keys().next().value || null;
  }

  // ---------- game flow ----------

  start(pid) {
    this.requireAdmin(pid);
    this.requireLobby();
    const byTeam = this.activeTeams.map((t) => [...this.players.values()].filter((p) => p.team === t.id));
    const sizes = byTeam.map((t) => t.length);
    if (this.players.size < 2) throw new GameError('Need at least 2 players');
    if (sizes.some((n) => n === 0)) throw new GameError('Every team needs at least one player');
    if (sizes.some((n) => n !== sizes[0])) throw new GameError(`Teams must be equal size (now ${sizes.join(' / ')})`);

    this.resetRound();
    // Seat players alternating teams, starting from a random team.
    const startTeam = crypto.randomInt(this.teamCount);
    for (let i = 0; i < sizes[0]; i++)
      for (let t = 0; t < this.teamCount; t++) this.order.push(byTeam[(t + startTeam) % this.teamCount][i].id);

    this.deck = newDeck();
    const handSize = this.handSizeSetting === 'auto' ? autoHandSize(this.players.size) : this.handSizeSetting;
    for (const p of this.players.values()) p.hand = this.deck.splice(0, handSize);
    this.phase = 'playing';
  }

  backToLobby(pid) {
    this.requireAdmin(pid);
    this.phase = 'lobby';
    for (const p of this.players.values()) p.hand = [];
    this.resetRound();
  }

  draw() {
    if (!this.deck.length) {
      this.deck = shuffle(this.discard);
      this.discard = [];
    }
    return this.deck.pop();
  }

  owns(r, c, team) {
    return r >= 0 && r < 10 && c >= 0 && c < 10 && (BOARD[r][c] === 'W' || this.chips[r][c] === team);
  }

  legalTargets(card, team) {
    const out = [];
    const type = jackType(card);
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++) {
        if (BOARD[r][c] === 'W') continue;
        const chip = this.chips[r][c];
        if (type === 'wild' ? !chip
          : type === 'remove' ? chip && chip !== team && !this.seqMark[r][c].length
          : BOARD[r][c] === card && !chip) out.push([r, c]);
      }
    return out;
  }

  isDead(card) {
    return !jackType(card) && this.legalTargets(card, null).length === 0;
  }

  requireTurn(pid) {
    if (this.phase !== 'playing') throw new GameError('The game is not running');
    if (this.currentPlayerId !== pid) throw new GameError("It's not your turn");
    return this.players.get(pid);
  }

  play(pid, cardIndex, r, c) {
    const p = this.requireTurn(pid);
    const card = p.hand[cardIndex];
    if (!card) throw new GameError('Pick a card first');
    if (!this.legalTargets(card, p.team).some(([a, b]) => a === r && b === c))
      throw new GameError("That card can't go there");

    const type = jackType(card);
    let removed = null;
    let newSeqs = [];
    if (type === 'remove') {
      removed = this.chips[r][c];
      this.chips[r][c] = null;
    } else {
      this.chips[r][c] = p.team;
      newSeqs = this.detectSequences(r, c, p.team);
    }

    p.hand.splice(cardIndex, 1);
    this.discard.push(card);
    const drawn = this.draw();
    if (drawn) p.hand.push(drawn);

    this.moveCount++;
    this.lastMove = { id: this.moveCount, playerId: pid, name: p.name, team: p.team, card, r, c, removed, newSequences: newSeqs.length };

    const count = this.sequences.filter((s) => s.team === p.team).length;
    if (count >= this.sequencesToWin) {
      this.winner = p.team;
      this.phase = 'ended';
    } else {
      this.advance();
    }
  }

  // ---------- commit, aim, place ----------
  // The card stays private until the player commits to it. Once committed it is shown on
  // the TV and can't be taken back; the player then moves a cursor between its legal spots.

  commit(pid, cardIndex) {
    const p = this.requireTurn(pid);
    if (this.pending) throw new GameError('You already chose a card');
    const card = p.hand[cardIndex];
    if (!card) throw new GameError('Pick a card first');
    const targets = this.legalTargets(card, p.team);
    if (!targets.length) throw new GameError("That card can't be played right now");
    // Start in the middle of the board for jacks, on the first spot otherwise.
    const cursor = jackType(card) ? this.nearest(targets, 4.5, 4.5) : targets[0];
    this.pending = { playerId: pid, cardIndex, card, targets, cursor };
  }

  requirePending(pid) {
    this.requireTurn(pid);
    if (!this.pending) throw new GameError('Choose a card first');
    return this.pending;
  }

  aimSpot(pid, i) {
    const pd = this.requirePending(pid);
    if (!pd.targets[i]) throw new GameError('No such spot');
    pd.cursor = pd.targets[i];
  }

  // Moves the cursor to the closest legal spot in a direction, favouring straight lines.
  aimMove(pid, dir) {
    const pd = this.requirePending(pid);
    const [dr, dc] = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir] || [0, 0];
    if (!dr && !dc) throw new GameError('Unknown direction');
    const [r, c] = pd.cursor;
    let best = null, bestScore = Infinity;
    for (const [tr, tc] of pd.targets) {
      const along = (tr - r) * dr + (tc - c) * dc;
      if (along <= 0) continue;
      const across = Math.abs((tr - r) * dc) + Math.abs((tc - c) * dr);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = [tr, tc]; }
    }
    if (best) pd.cursor = best;
  }

  nearest(targets, r, c) {
    let best = targets[0], d = Infinity;
    for (const t of targets) {
      const e = (t[0] - r) ** 2 + (t[1] - c) ** 2;
      if (e < d) { d = e; best = t; }
    }
    return best;
  }

  place(pid) {
    const pd = this.requirePending(pid);
    this.pending = null;
    this.play(pid, pd.cardIndex, pd.cursor[0], pd.cursor[1]);
  }

  // Swap a dead card (both spots taken) for a new one. Once per turn, doesn't end the turn.
  swapDead(pid, cardIndex) {
    const p = this.requireTurn(pid);
    if (this.pending) throw new GameError('You already chose a card');
    const card = p.hand[cardIndex];
    if (!card) throw new GameError('Pick a card first');
    if (!this.isDead(card)) throw new GameError("That card isn't dead");
    if (this.deadUsed) throw new GameError('You can only swap one dead card per turn');
    p.hand.splice(cardIndex, 1);
    this.discard.push(card);
    const drawn = this.draw();
    if (drawn) p.hand.push(drawn);
    this.deadUsed = true;
  }

  // Lets a player with no legal move (or the admin, for an absent player) pass.
  skip(pid) {
    if (this.phase !== 'playing') throw new GameError('The game is not running');
    const cur = this.players.get(this.currentPlayerId);
    if (pid !== this.adminId) {
      if (pid !== cur.id) throw new GameError("It's not your turn");
      if (cur.hand.some((card) => this.legalTargets(card, cur.team).length)) throw new GameError('You still have a playable card');
    }
    this.lastMove = { id: ++this.moveCount, playerId: cur.id, name: cur.name, team: cur.team, skipped: true };
    this.advance();
  }

  advance() {
    this.turn = (this.turn + 1) % this.order.length;
    this.deadUsed = false;
    this.pending = null;
  }

  detectSequences(r, c, team) {
    const found = [];
    for (const [dr, dc] of DIRS) {
      let sr = r, sc = c;
      while (this.owns(sr - dr, sc - dc, team)) { sr -= dr; sc -= dc; }
      const line = [];
      for (let cr = sr, cc = sc; this.owns(cr, cc, team); cr += dr, cc += dc) line.push([cr, cc]);
      for (let i = 0; i + 5 <= line.length; i++) {
        const win = line.slice(i, i + 5);
        if (!win.some(([a, b]) => a === r && b === c)) continue;
        // A new sequence may share at most one chip with this team's existing sequences.
        const overlap = win.filter(([a, b]) => this.seqMark[a][b].includes(team)).length;
        if (overlap > 1) continue;
        const seq = { team, cells: win };
        this.sequences.push(seq);
        for (const [a, b] of win) this.seqMark[a][b].push(team);
        found.push(seq);
      }
    }
    return found;
  }

  // ---------- views ----------

  publicState() {
    const teams = this.activeTeams.map((t) => ({
      ...t,
      sequences: this.sequences.filter((s) => s.team === t.id).length,
    }));
    const seat = (id) => this.order.indexOf(id);
    const players = [...this.players.values()]
      .sort((a, b) => (this.order.length ? seat(a.id) - seat(b.id) : a.joinedAt - b.joinedAt))
      .map((p) => ({ id: p.id, name: p.name, team: p.team, connected: p.connected, cards: p.hand.length, admin: p.id === this.adminId }));
    return {
      phase: this.phase,
      board: BOARD,
      chips: this.chips,
      locked: this.seqMark.map((row) => row.map((t) => t.length > 0)),
      sequences: this.sequences,
      teams,
      players,
      teamCount: this.teamCount,
      handSize: this.handSizeSetting,
      sequencesSetting: this.sequencesSetting,
      sequencesToWin: this.sequencesToWin,
      currentPlayerId: this.currentPlayerId,
      lastMove: this.lastMove,
      pending: this.pending && {
        playerId: this.pending.playerId,
        card: this.pending.card,
        kind: jackType(this.pending.card) || 'normal',
        targets: this.pending.targets,
        cursor: this.pending.cursor,
      },
      winner: this.winner,
      deckCount: this.deck.length,
    };
  }

  privateState(pid) {
    const p = this.players.get(pid);
    if (!p) return null;
    return {
      you: { id: p.id, name: p.name, team: p.team, admin: p.id === this.adminId },
      hand: p.hand.map((card) => ({ card, targets: this.legalTargets(card, p.team), dead: this.isDead(card) })),
      deadUsed: this.deadUsed,
    };
  }
}

module.exports = { Game, GameError, BOARD, TEAMS, jackType };
