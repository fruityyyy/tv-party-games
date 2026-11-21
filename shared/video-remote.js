// Phone side of the YouTube panel: paste links, see what's on, control the TV player.
function createVideoRemote(socket, host) {
  const style = document.createElement('style');
  style.textContent = `
    .vr { margin-top: 18px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.12); }
    .vr h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 8px; font-weight: 700; }
    .vr .now { background: rgba(255,255,255,0.08); border-radius: 10px; padding: 10px 12px; }
    .vr .title { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vr .sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .vr .ctl { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 10px; }
    .vr .ctl + .ctl { grid-template-columns: repeat(4, 1fr); margin-top: 6px; }
    .vr .ctl button { padding: 8px 0; font-size: 15px; border-radius: 9px; }
    .vr .ctl button.txt { font-size: 12px; }
    .vr .q { font-size: 13px; display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .vr .q span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vr .q small { color: var(--muted); }
    .vr form { display: flex; gap: 6px; margin-top: 10px; }
    .vr form input { flex: 1; min-width: 0; padding: 10px; font-size: 15px; }
    .vr form button { padding: 10px 14px; }
    .vr .hint { font-size: 12px; color: var(--muted); margin-top: 6px; }
  `;
  document.head.appendChild(style);

  host.classList.add('vr');
  host.innerHTML = `
    <h3>Video on the TV</h3>
    <div class="now" id="vrNow" style="display:none">
      <div class="title" id="vrTitle"></div>
      <div class="sub" id="vrSub"></div>
      <div class="ctl">
        <button data-v="prev" aria-label="Previous video">⏮</button>
        <button data-v="back" class="txt" aria-label="Back 10 seconds">−10s</button>
        <button data-v="pause" id="vrPause" aria-label="Pause">⏸</button>
        <button data-v="fwd" class="txt" aria-label="Forward 10 seconds">+10s</button>
        <button data-v="skip" aria-label="Next video">⏭</button>
      </div>
      <div class="ctl">
        <button data-v="down" class="txt" aria-label="Volume down">Vol −</button>
        <button data-v="up" class="txt" aria-label="Volume up">Vol +</button>
        <button data-v="big" id="vrBig" class="txt" aria-label="Bigger video">Big</button>
        <button data-v="stop" aria-label="Stop video">✕</button>
      </div>
    </div>
    <div id="vrQueue"></div>
    <form id="vrForm">
      <input id="vrLink" type="url" inputmode="url" placeholder="Paste a YouTube link" autocomplete="off" spellcheck="false">
      <button type="submit">Add</button>
    </form>
    <div class="hint" id="vrHint">In YouTube tap Share → Copy link, then paste it here. Similar videos keep playing after it.</div>`;

  const $v = (id) => host.querySelector('#' + id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  $v('vrForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const link = $v('vrLink').value.trim();
    if (!link) return;
    socket.emit('video:add', link);
    $v('vrLink').value = '';
    $v('vrLink').blur();
  });

  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v], [data-vq]');
    if (!b) return;
    const v = b.dataset.v;
    if (b.dataset.vq) socket.emit('video:remove', +b.dataset.vq);
    else if (v === 'pause') socket.emit('video:pause');
    else if (v === 'skip') socket.emit('video:skip');
    else if (v === 'prev') socket.emit('video:prev');
    else if (v === 'back') socket.emit('video:seek', -1);
    else if (v === 'fwd') socket.emit('video:seek', 1);
    else if (v === 'up') socket.emit('video:volume', 1);
    else if (v === 'down') socket.emit('video:volume', -1);
    else if (v === 'big') socket.emit('video:big');
    else if (v === 'stop' && confirm('Stop the video and clear the queue?')) socket.emit('video:stop');
  });

  function render(video) {
    if (!video) return;
    $v('vrNow').style.display = video.active ? '' : 'none';
    if (video.active) {
      $v('vrTitle').textContent = video.title || 'Loading…';
      $v('vrSub').textContent = `${video.paused ? 'Paused' : 'Playing'} · ${video.inMix ? `Mix from ${video.by}'s video` : `added by ${video.by}`} · volume ${video.volume}`;
      $v('vrPause').textContent = video.paused ? '▶' : '⏸';
      $v('vrBig').textContent = video.big ? 'Small' : 'Big';
    }
    $v('vrQueue').innerHTML = video.queue.length
      ? '<div class="sub" style="margin:10px 0 2px">Up next</div>' + video.queue.map((q) =>
          `<div class="q"><span>${esc(q.title)}</span><small>${esc(q.by)}</small><button class="small" data-vq="${q.id}" aria-label="Remove">✕</button></div>`).join('')
      : '';
    $v('vrHint').style.display = video.active ? 'none' : '';
  }

  return { render };
}
