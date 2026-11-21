const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { Game, GameError } = require('./game');

// The YouTube panel is shared by both games: next to server.js in the TV app, one level up in development.
const SHARED = [path.join(__dirname, 'shared'), path.join(__dirname, '../shared')].find((d) => fs.existsSync(d));
const { VideoHub, VideoError, attachVideo } = require(path.join(SHARED, 'video-server'));
const { createRooms } = require(path.join(SHARED, 'rooms'));

const PORT = Number(process.env.PORT) || 3001;

// Phones need an address they can reach, so prefer the machine's LAN IP.
function lanIp() {
  let addrs = [];
  try {
    addrs = Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  } catch {
    // Android 11+ blocks this; the TV app passes --public-url instead.
  }
  return addrs.find((a) => a.startsWith('192.168.')) || addrs.find((a) => a.startsWith('10.')) || addrs[0] || 'localhost';
}
const urlArg = process.argv.find((a) => a.startsWith('--public-url='));
let BASE_URL = ((urlArg && urlArg.slice('--public-url='.length)) || process.env.PUBLIC_URL || `http://${lanIp()}:${PORT}`).replace(/\/$/, '');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// One game per room. A TV at home uses the default room; in the cloud every TV has its own code.
const rooms = createRooms(io, (room) => {
  room.game = new Game();
  room.video = new VideoHub((cmd) => io.to(room.tv).emit('video:cmd', cmd), () => sync(room));
});

// In the cloud the public address comes from the request (e.g. https://name.onrender.com).
const baseFor = (req) => (process.env.CLOUD ? `https://${req.get('host')}` : BASE_URL);

app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(SHARED));
app.get('/', (req, res) => res.redirect('/tv'));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public/tv.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public/play.html')));
app.get('/api/info', (req, res) => res.json({ joinUrl: rooms.joinUrl(baseFor(req), req.query.room) }));
// The TV app calls this when the TV joins a different network, so the QR code follows it.
// Only the TV itself may change it.
app.get('/api/public-url', (req, res) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const url = String(req.query.url || '');
  if (!local || !/^https?:\/\/[\w.:-]+$/.test(url)) return res.status(403).end();
  BASE_URL = url.replace(/\/$/, '');
  io.emit('info');
  res.json({ ok: true });
});
app.get('/api/qr.svg', async (req, res) => {
  res.type('image/svg+xml').send(await QRCode.toString(rooms.joinUrl(baseFor(req), req.query.room), { type: 'svg', margin: 1 }));
});

function sync(room) {
  const { game, video } = room;
  const pub = { ...game.publicState(), video: video.publicState() };
  io.to(room.tv).emit('state', pub);
  for (const p of game.players.values())
    for (const s of rooms.socketsOf(room, p.id)) s.emit('state', { ...pub, ...game.privateState(p.id) });
}

function refreshConnected(room) {
  for (const p of room.game.players.values()) p.connected = rooms.socketsOf(room, p.id).length > 0;
}

io.on('connection', (socket) => {
  const room = rooms.enter(socket);
  const { game, video } = room;
  const pid = () => socket.data.playerId;

  // Wrap every handler so rule violations go back to the sender as a message.
  const on = (event, fn) => socket.on(event, (...args) => {
    try {
      fn(...args);
      sync(room);
    } catch (e) {
      const known = e instanceof GameError || e instanceof VideoError;
      if (!known) console.error(e);
      socket.emit('toast', known ? e.message : 'Something went wrong');
    }
  });

  on('tv:hello', () => {
    socket.join(room.tv);
    for (const cmd of video.resumeCommands()) socket.emit('video:cmd', cmd);
  });
  attachVideo(socket, video, (s) => game.players.get(s.data.playerId)?.name, on);

  on('join', ({ name, token } = {}) => {
    // A phone that is already seated keeps its seat instead of joining twice.
    let p = (token && game.byToken(token)) || game.players.get(socket.data.playerId);
    if (!p) p = game.join(name);
    socket.data.playerId = p.id;
    socket.emit('joined', { token: p.token });
    refreshConnected(room);
  });

  on('admin:team', ({ playerId, team }) => game.setTeam(pid(), playerId, team));
  on('admin:spymaster', (playerId) => game.setSpymaster(pid(), playerId));
  on('admin:timer', (seconds) => game.setTimer(pid(), seconds));
  on('admin:autoTeams', () => game.autoTeams(pid()));
  on('admin:kick', (playerId) => {
    game.kick(pid(), playerId);
    for (const s of rooms.socketsOf(room, playerId)) { s.emit('kicked'); s.data.playerId = null; }
  });
  on('admin:makeAdmin', (playerId) => game.makeAdmin(pid(), playerId));
  on('admin:start', () => game.start(pid()));
  on('admin:again', () => game.playAgain(pid()));
  on('admin:pass', () => game.pass(pid()));
  on('admin:lobby', () => game.backToLobby(pid()));

  on('clue', ({ word, number } = {}) => game.giveClue(pid(), word, number));
  on('vote', (i) => game.vote(pid(), i));
  on('reveal', (i) => game.reveal(pid(), i));
  on('endTurn', () => game.endTurn(pid()));
  on('leave', () => { game.leave(pid()); socket.data.playerId = null; });

  socket.on('disconnect', () => { refreshConnected(room); sync(room); });
});

// Turn timer.
setInterval(() => {
  for (const room of rooms.all())
    if (room.game.tick()) { io.to('room:' + room.code).emit('toast', "Time's up!"); sync(room); }
}, 500);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Codenames is running.`);
  console.log(`  TV:      ${BASE_URL}/tv`);
  console.log(`  Players: ${BASE_URL}/play`);
});
