// YouTube on the TV, shared by both games. Phones queue links, the TV plays them.
// Each pasted video plays inside its YouTube Mix, so similar videos keep playing after it.

class VideoError extends Error {}

// Accepts watch, youtu.be, shorts, live, embed and playlist links, or a bare video id.
function parseYouTube(input) {
  const text = String(input || '').trim();
  if (/^[\w-]{11}$/.test(text)) return { videoId: text, list: null };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let videoId = null;
  if (host === 'youtu.be') videoId = url.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = url.searchParams.get('v');
    const m = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/);
    if (m) videoId = m[1];
  } else return null;
  const list = url.searchParams.get('list');
  if (videoId && !/^[\w-]{11}$/.test(videoId)) videoId = null;
  if (!videoId && !list) return null;
  return { videoId, list: list && /^[\w-]+$/.test(list) ? list : null };
}

async function fetchTitle(item) {
  const page = item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : `https://www.youtube.com/playlist?list=${item.list}`;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return (await res.json()).title || null;
  } catch {
    // Offline or blocked: keep the placeholder title.
  }
  return null;
}

class VideoHub {
  // toTv(cmd) sends a command to the TV page; changed() resyncs everyone.
  constructor(toTv, changed) {
    this.toTv = toTv;
    this.changed = changed;
    this.volume = 60;
    this.reset();
  }

  reset() {
    this.current = null; // what was pasted: { id, videoId, list, title, by }
    this.queue = [];
    this.now = null;     // what the TV reports is playing right now (may be later in the Mix)
    this.paused = false;
    this.big = false;
    this.nextId = 1;
    this.loadedAt = 0;
  }

  // A pasted playlist plays as is. A pasted video plays first, then its Mix ('RD' + id) carries on.
  static cmdFor(item) {
    if (item.list) return { type: 'load', list: item.list };
    return { type: 'load', videoId: item.videoId, mix: 'RD' + item.videoId };
  }

  add(by, link) {
    const parsed = parseYouTube(link);
    if (!parsed) throw new VideoError('That doesn’t look like a YouTube link');
    if (this.queue.length >= 30) throw new VideoError('The queue is full');
    const item = { id: this.nextId++, ...parsed, title: parsed.list && !parsed.videoId ? 'Playlist' : 'YouTube video', by };
    if (!this.current) this.play(item);
    else this.queue.push(item);
    fetchTitle(item).then((t) => { if (t) { item.title = t; this.changed(); } });
  }

  play(item) {
    this.current = item;
    this.now = null;
    this.paused = false;
    this.loadedAt = Date.now();
    this.toTv(VideoHub.cmdFor(item));
  }

  // Skip: someone's queued video goes first, otherwise move along the Mix.
  skip() {
    this.requireActive();
    if (this.queue.length) this.play(this.queue.shift());
    else this.toTv({ type: 'next' });
  }

  previous() {
    this.requireActive();
    this.toTv({ type: 'prev' });
  }

  seek(delta) {
    this.requireActive();
    this.toTv({ type: 'seek', delta: delta > 0 ? 10 : -10 });
  }

  // The TV finished a video. Queued videos interrupt the Mix; otherwise the Mix carries on by itself.
  // The TV can report the same switch twice (video ended, then the next one started), so
  // reports right after a new video was loaded are ignored.
  ended() {
    if (Date.now() - this.loadedAt < 4000) return;
    if (this.queue.length) this.play(this.queue.shift());
  }

  togglePause() {
    this.requireActive();
    this.paused = !this.paused;
    this.toTv({ type: this.paused ? 'pause' : 'play' });
  }

  changeVolume(delta) {
    this.volume = Math.max(0, Math.min(100, this.volume + (delta > 0 ? 10 : -10)));
    this.toTv({ type: 'volume', value: this.volume });
  }

  toggleBig() {
    this.requireActive();
    this.big = !this.big;
  }

  remove(id) {
    this.queue = this.queue.filter((q) => q.id !== id);
  }

  stop() {
    this.reset();
    this.toTv({ type: 'stop' });
  }

  // The TV reports what it is playing, so phones can show the title.
  report({ title, videoId, index, paused } = {}) {
    if (!this.current) return;
    this.now = { title: String(title || '').slice(0, 120), videoId, index: Number.isInteger(index) ? index : 0 };
    if (typeof paused === 'boolean') this.paused = paused;
  }

  requireActive() {
    if (!this.current) throw new VideoError('Nothing is playing');
  }

  // A TV page that (re)loads picks up where playback was.
  resumeCommands() {
    const cmds = [{ type: 'volume', value: this.volume }];
    if (this.current) {
      const cmd = VideoHub.cmdFor(this.current);
      // Pasted playlists resume at the same position; a Mix restarts from the video that was on.
      if (this.current.list) cmd.index = this.now?.index || 0;
      else if (this.now?.videoId) Object.assign(cmd, { videoId: this.now.videoId, mix: 'RD' + this.now.videoId });
      cmds.push(cmd);
      if (this.paused) cmds.push({ type: 'pause' });
    }
    return cmds;
  }

  publicState() {
    return {
      active: !!this.current,
      title: this.now?.title || this.current?.title || null,
      by: this.current?.by || null,
      inMix: !!(this.now && this.current && this.now.videoId && this.now.videoId !== this.current.videoId),
      queue: this.queue.map(({ id, title, by }) => ({ id, title, by })),
      paused: this.paused,
      big: this.big,
      volume: this.volume,
    };
  }
}

// Wires the phone and TV socket events. nameOf(socket) returns the player's name, or null if not seated.
function attachVideo(socket, hub, nameOf, run) {
  const requireSeat = () => {
    const name = nameOf(socket);
    if (!name) throw new VideoError('Join the game first');
    return name;
  };
  run('video:add', (link) => hub.add(requireSeat(), link));
  run('video:skip', () => { requireSeat(); hub.skip(); });
  run('video:prev', () => { requireSeat(); hub.previous(); });
  run('video:seek', (d) => { requireSeat(); hub.seek(+d); });
  run('video:pause', () => { requireSeat(); hub.togglePause(); });
  run('video:volume', (d) => { requireSeat(); hub.changeVolume(+d); });
  run('video:big', () => { requireSeat(); hub.toggleBig(); });
  run('video:remove', (id) => { requireSeat(); hub.remove(+id); });
  run('video:stop', () => { requireSeat(); hub.stop(); });
  // From the TV page only.
  run('video:now', (info) => { if (socket.rooms.has('tv')) hub.report(info); });
  run('video:ended', () => { if (socket.rooms.has('tv')) hub.ended(); });
}

module.exports = { VideoHub, VideoError, attachVideo, parseYouTube };
