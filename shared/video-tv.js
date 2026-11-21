// TV side of the YouTube panel. The player lives in one fixed box that is laid over whichever
// [data-video-slot] element is visible, so switching screens never reloads the video.
function createTvVideo(socket) {
  const box = document.createElement('div');
  box.id = 'videoBox';
  box.style.cssText = 'position:absolute;z-index:4;background:#000;border-radius:1vh;overflow:hidden;display:none';
  box.innerHTML = '<div id="ytPlayer"></div>';
  document.body.appendChild(box);

  let player = null;
  let ready = false;
  let pending = [];
  let volume = 60;
  let errors = 0;
  let lastId = null;
  let mixNext = null; // Mix to continue with once the pasted video is over
  const history = [];  // videos played so far, for the back button

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('ytPlayer', {
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => {
          ready = true;
          player.setVolume(volume);
          pending.forEach(run);
          pending = [];
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) { errors = 0; report(false); }
          else if (e.data === YT.PlayerState.PAUSED) report(true);
          else if (e.data === YT.PlayerState.ENDED) { socket.emit('video:ended'); continueMix(); }
        },
        // 100/101/150: removed, private or not allowed outside YouTube. Skip along the Mix.
        onError: () => {
          if (++errors > 5) { errors = 0; socket.emit('video:ended'); return; }
          setTimeout(() => (mixNext ? continueMix() : player.nextVideo()), 800);
        },
      },
    });
  };

  function report(paused) {
    const d = player.getVideoData ? player.getVideoData() : {};
    if (!paused && d.video_id && d.video_id !== lastId) {
      // A new video inside the Mix started: let queued videos go first.
      if (lastId !== null) socket.emit('video:ended');
      lastId = d.video_id;
      if (history[history.length - 1] !== d.video_id) history.push(d.video_id);
      if (history.length > 50) history.shift();
    }
    socket.emit('video:now', { title: d.title, videoId: d.video_id, index: player.getPlaylistIndex(), paused });
  }

  // The Mix's first entry is the pasted video itself, so start from the second.
  function continueMix() {
    if (!mixNext) return;
    player.loadPlaylist({ list: mixNext, listType: 'playlist', index: 1 });
    mixNext = null;
  }

  function run(cmd) {
    if (!ready) { pending.push(cmd); return; }
    if (cmd.type === 'load') {
      lastId = null;
      errors = 0;
      mixNext = cmd.mix || null;
      if (cmd.videoId) player.loadVideoById(cmd.videoId);
      else player.loadPlaylist({ list: cmd.list, listType: 'playlist', index: cmd.index || 0 });
    } else if (cmd.type === 'next') {
      if (mixNext) continueMix();
      else player.nextVideo();
    }
    else if (cmd.type === 'prev') previous();
    else if (cmd.type === 'seek') seek(cmd.delta);
    else if (cmd.type === 'pause') player.pauseVideo();
    else if (cmd.type === 'play') player.playVideo();
    else if (cmd.type === 'stop') { player.stopVideo(); lastId = null; mixNext = null; }
    else if (cmd.type === 'volume') player.setVolume(cmd.value);
  }

  // Quick repeated taps add up (+10, +10 = +20) instead of each starting from the same spot.
  let seekTarget = 0, seekAt = 0;
  function seek(delta) {
    const base = Date.now() - seekAt < 1500 ? seekTarget : player.getCurrentTime();
    seekTarget = Math.max(0, base + delta);
    seekAt = Date.now();
    player.seekTo(seekTarget, true);
  }

  // Back: the video before this one, followed by its own Mix. With nothing before it, start over.
  function previous() {
    if (history.length < 2) { player.seekTo(0, true); return; }
    history.pop();
    const id = history.pop();
    lastId = null; // going back is not "this video ended", so queued videos don't jump in
    errors = 0;
    mixNext = 'RD' + id;
    player.loadVideoById(id);
  }

  socket.on('video:cmd', (cmd) => {
    if (cmd.type === 'volume') volume = cmd.value;
    run(cmd);
  });

  // Lay the box over the visible slot; hide it when there is none or nothing is playing.
  function place(active) {
    const slot = [...document.querySelectorAll('[data-video-slot]')].find((s) => s.offsetParent !== null);
    if (!active || !slot) { box.style.display = 'none'; return; }
    const r = slot.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  return { place };
}
