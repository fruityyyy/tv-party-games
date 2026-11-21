// Rooms let one server run a separate game for each TV. A phone or TV picks its room with
// ?room=CODE; without one it uses the default room, which is all a TV's own built-in server needs.

const DEFAULT_ROOM = 'TV';
const IDLE_MS = 6 * 60 * 60 * 1000; // forget a room nobody has used for 6 hours

const roomCode = (v) => {
  const code = String(v || '').trim().toUpperCase();
  return /^[A-Z0-9]{3,10}$/.test(code) ? code : DEFAULT_ROOM;
};

// setup(room) adds the game state to a new room.
function createRooms(io, setup) {
  const rooms = new Map();

  function get(code) {
    let room = rooms.get(code);
    if (!room) {
      room = { code, tv: 'tv:' + code, lastUsed: Date.now() };
      setup(room);
      rooms.set(code, room);
    }
    room.lastUsed = Date.now();
    return room;
  }

  setInterval(() => {
    for (const [code, room] of rooms)
      if (Date.now() - room.lastUsed > IDLE_MS && !io.sockets.adapter.rooms.get('room:' + code)) rooms.delete(code);
  }, 10 * 60 * 1000).unref();

  return {
    // Puts a newly connected socket in the room its page asked for.
    enter(socket) {
      const room = get(roomCode(socket.handshake.query.room));
      socket.data.room = room.code;
      socket.join('room:' + room.code);
      socket.onAny(() => { room.lastUsed = Date.now(); });
      return room;
    },
    socketsOf(room, playerId) {
      return [...io.of('/').sockets.values()].filter((s) => s.data.room === room.code && s.data.playerId === playerId);
    },
    joinUrl(base, code) {
      code = roomCode(code);
      return code === DEFAULT_ROOM ? `${base}/play` : `${base}/play?room=${code}`;
    },
    all: () => rooms.values(),
  };
}

module.exports = { createRooms, roomCode, DEFAULT_ROOM };
