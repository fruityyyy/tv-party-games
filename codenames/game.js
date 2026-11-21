// Codenames rules engine. Pure game state, no networking.
const crypto = require('crypto');
const WORDS = require('./words');

const TEAMS = [
  { id: 'red', name: 'Red', color: '#d8433b' },
  { id: 'blue', name: 'Blue', color: '#2f6fed' },
];
const MAX_PLAYERS = 16;
const SIZE = 25;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const other = (team) => (team === 'red' ? 'blue' : 'red');

class GameError extends Error {}

class Game {
  constructor() {
    this.players = new Map(); // id -> player
    this.adminId = null;
    this.timerSetting = 0; // seconds per turn, 0 = no timer
    this.phase = 'lobby';
    this.round = 0;
    this.resetRound();
  }

  resetRound() {
    this.words = [];
    this.key = [];       // 'red' | 'blue' | 'neutral' | 'assassin' per card
    this.revealed = [];  // false, or { by, team } once guessed
    this.startingTeam = null;
    this.turnTeam = null;
    this.stage = null;   // 'clue' | 'guess'
    this.clue = null;    // { word, number, team }
    this.guessesLeft = null; // null = unlimited
    this.guessesMade = 0;
    this.clueLog = [];
    this.votes = new Map(); // playerId -> card index the player suggests
    this.lastReveal = null;
    this.winner = null;
    this.winReason = null;
    this.turnEndsAt = null;
  }

  // ---------- lobby ----------

  join(name) {
    name = String(name || '').trim().slice(0, 16);
    if (!name) throw new GameError('Enter a name');
    if (this.players.size >= MAX_PLAYERS) throw new GameError(`The room is full (${MAX_PLAYERS} players)`);
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(16).toString('hex');
    // Players who join mid-game become operatives on the smaller team.
    const p = { id, token, name, team: this.smallestTeam(), spymaster: false, connected: true, joinedAt: Date.now() };
    this.players.set(id, p);
    if (!this.adminId) this.adminId = id;
    return p;
  }

  byToken(token) {
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  teamPlayers(team) {
    return [...this.players.values()].filter((p) => p.team === team).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  smallestTeam() {
    const [a, b] = TEAMS.map((t) => this.teamPlayers(t.id).length);
    return b < a ? 'blue' : 'red';
  }

  spymasterOf(team) {
    return this.teamPlayers(team).find((p) => p.spymaster) || null;
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
    if (!TEAMS.some((t) => t.id === team)) throw new GameError('No such team');
    if (p.team !== team) p.spymaster = false;
    p.team = team;
  }

  // One spymaster per team; picking a new one replaces the old.
  setSpymaster(pid, targetId) {
    this.requireAdmin(pid);
    this.requireLobby();
    const p = this.players.get(targetId);
    if (!p) throw new GameError('No such player');
    for (const q of this.teamPlayers(p.team)) q.spymaster = q === p;
  }

  setTimer(pid, seconds) {
    this.requireAdmin(pid);
    this.requireLobby();
    if (![0, 60, 90, 120, 180].includes(seconds)) throw new GameError('Timer must be off, 1, 1½, 2 or 3 minutes');
    this.timerSetting = seconds;
  }

  autoTeams(pid) {
    this.requireAdmin(pid);
    this.requireLobby();
    shuffle([...this.players.values()]).forEach((p, i) => { p.team = TEAMS[i % 2].id; p.spymaster = false; });
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
    for (const t of TEAMS) {
      const ps = this.teamPlayers(t.id);
      if (ps.length < 2) throw new GameError(`${t.name} needs at least 2 players (a spymaster and a guesser)`);
      // No spymaster chosen: the first to join leads.
      if (!ps.some((p) => p.spymaster)) ps[0].spymaster = true;
    }
    this.deal();
  }

  // Same teams, fresh words, and each team's spymaster role passes to the next player.
  playAgain(pid) {
    this.requireAdmin(pid);
    if (this.phase !== 'ended') throw new GameError('Finish this game first');
    for (const t of TEAMS) {
      const ps = this.teamPlayers(t.id);
      if (ps.length < 2) throw new GameError(`${t.name} needs at least 2 players`);
      const i = ps.findIndex((p) => p.spymaster);
      ps.forEach((p) => { p.spymaster = false; });
      ps[(i + 1) % ps.length].spymaster = true;
    }
    this.deal();
  }

  deal() {
    this.resetRound();
    this.round++;
    this.startingTeam = TEAMS[crypto.randomInt(2)].id;
    this.words = shuffle([...WORDS]).slice(0, SIZE);
    // The starting team has one more agent to find (9 vs 8).
    this.key = shuffle([
      ...Array(9).fill(this.startingTeam),
      ...Array(8).fill(other(this.startingTeam)),
      ...Array(7).fill('neutral'),
      'assassin',
    ]);
    this.revealed = Array(SIZE).fill(false);
    this.phase = 'playing';
    this.beginTurn(this.startingTeam);
  }

  backToLobby(pid) {
    this.requireAdmin(pid);
    this.phase = 'lobby';
    this.resetRound();
  }

  beginTurn(team) {
    this.turnTeam = team;
    this.stage = 'clue';
    this.clue = null;
    this.guessesLeft = null;
    this.guessesMade = 0;
    this.votes.clear();
    this.turnEndsAt = this.timerSetting ? Date.now() + this.timerSetting * 1000 : null;
  }

  requirePlaying() {
    if (this.phase !== 'playing') throw new GameError('The game is not running');
  }

  giveClue(pid, word, number) {
    this.requirePlaying();
    const p = this.players.get(pid);
    if (!p || !p.spymaster || p.team !== this.turnTeam) throw new GameError("It's not your turn to give a clue");
    if (this.stage !== 'clue') throw new GameError('Your team is already guessing');
    word = String(word || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z'-]{0,23}$/.test(word)) throw new GameError('The clue must be one word, letters only');
    if (this.words.some((w, i) => !this.revealed[i] && w === word)) throw new GameError("You can't use a word that's on the board");
    if (!(number === 'inf' || (Number.isInteger(number) && number >= 0 && number <= 9))) throw new GameError('Pick a number from 0 to 9 or ∞');
    this.clue = { word, number, team: p.team };
    this.clueLog.push(this.clue);
    // Official rule: one guess more than the number. 0 and ∞ allow unlimited guesses.
    this.guessesLeft = number === 'inf' || number === 0 ? null : number + 1;
    this.stage = 'guess';
    this.votes.clear();
  }

  requireGuesser(pid) {
    this.requirePlaying();
    const p = this.players.get(pid);
    if (!p || p.team !== this.turnTeam || p.spymaster) throw new GameError("It's not your team's turn to guess");
    if (this.stage !== 'guess') throw new GameError('Wait for your spymaster’s clue');
    return p;
  }

  requireHidden(i) {
    if (!Number.isInteger(i) || i < 0 || i >= SIZE) throw new GameError('No such card');
    if (this.revealed[i]) throw new GameError('That card is already revealed');
  }

  // Suggestions are shown on the TV so the team can talk it over. Tap again to withdraw.
  vote(pid, i) {
    const p = this.requireGuesser(pid);
    if (i === null || this.votes.get(p.id) === i) { this.votes.delete(p.id); return; }
    this.requireHidden(i);
    this.votes.set(p.id, i);
  }

  reveal(pid, i) {
    const p = this.requireGuesser(pid);
    this.requireHidden(i);
    const team = this.turnTeam;
    const color = this.key[i];
    this.revealed[i] = { by: p.id, team };
    this.guessesMade++;
    this.votes.clear();
    this.lastReveal = { index: i, word: this.words[i], color, name: p.name, team, id: this.revealed.filter(Boolean).length };

    if (color === 'assassin') return this.finish(other(team), 'assassin');
    for (const t of TEAMS) if (this.remaining(t.id) === 0) return this.finish(t.id, 'agents');
    if (color !== team) return this.beginTurn(other(team));
    if (this.guessesLeft !== null && --this.guessesLeft === 0) this.beginTurn(other(team));
  }

  endTurn(pid) {
    const p = this.requireGuesser(pid);
    if (this.guessesMade === 0) throw new GameError('Make at least one guess first');
    this.beginTurn(other(p.team));
  }

  // Admin escape hatch: someone left, or the table agreed to move on.
  pass(pid) {
    this.requireAdmin(pid);
    this.requirePlaying();
    this.beginTurn(other(this.turnTeam));
  }

  // Called by the server's clock; returns true when the turn ran out.
  tick(now = Date.now()) {
    if (this.phase !== 'playing' || !this.turnEndsAt || now < this.turnEndsAt) return false;
    this.beginTurn(other(this.turnTeam));
    return true;
  }

  remaining(team) {
    return this.key.filter((k, i) => k === team && !this.revealed[i]).length;
  }

  finish(team, reason) {
    this.phase = 'ended';
    this.winner = team;
    this.winReason = reason;
    this.turnEndsAt = null;
    this.votes.clear();
  }

  // ---------- views ----------

  publicState() {
    const ended = this.phase === 'ended';
    return {
      phase: this.phase,
      round: this.round,
      teams: TEAMS.map((t) => ({ ...t, remaining: this.remaining(t.id), total: t.id === this.startingTeam ? 9 : 8 })),
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, team: p.team, spymaster: p.spymaster, admin: p.id === this.adminId, connected: p.connected,
      })),
      timerSetting: this.timerSetting,
      // Everyone sees the colour of revealed cards; the whole key shows once the game is over.
      cards: this.words.map((word, i) => ({
        word,
        color: this.revealed[i] || ended ? this.key[i] : null,
        revealed: !!this.revealed[i],
        votes: [...this.votes].filter(([, v]) => v === i).map(([pid]) => this.players.get(pid)?.name).filter(Boolean),
      })),
      startingTeam: this.startingTeam,
      turnTeam: this.turnTeam,
      stage: this.stage,
      clue: this.clue,
      guessesLeft: this.guessesLeft,
      guessesMade: this.guessesMade,
      clueLog: this.clueLog,
      lastReveal: this.lastReveal,
      winner: this.winner,
      winReason: this.winReason,
      turnEndsAt: this.turnEndsAt,
      now: Date.now(),
    };
  }

  privateState(pid) {
    const p = this.players.get(pid);
    if (!p) return {};
    return {
      you: { id: p.id, name: p.name, team: p.team, spymaster: p.spymaster, admin: p.id === this.adminId },
      // Only spymasters get the key.
      key: p.spymaster && this.phase !== 'lobby' ? this.key : null,
      myVote: this.votes.has(p.id) ? this.votes.get(p.id) : null,
    };
  }
}

module.exports = { Game, GameError, TEAMS };
