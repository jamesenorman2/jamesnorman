/* Ridge-line flight engine: white lines on true black, flown over in perspective.
   createFlight(canvas, {
     sample(row, n) -> meta     fill Float32Array `row` (heights ~0..1.4) for the n-th line; return anything to tag it
     rate() -> number           new lines per second (before the visitor's speed setting)
     onNear(meta)               called each frame with the tag of the line just ahead of the ship
     onAhead(meta)              the same for a line further ahead (for autopilots); cam.userAt says when the visitor last steered
     rows, points, rowWidth, amp, horizon (0-1 down the screen, default 0.34), interactive (false: no steering, keys or wheel)
   }) */
export function createFlight(canvas, opts = {}) {
  const ROWS = opts.rows || 72, POINTS = opts.points || 160;
  const ROW_W = opts.rowWidth || 4, AMP = opts.amp || 0.5;
  const NEAR = 0.22, FAR = 14, SPAN = FAR - NEAR;
  const CAM_X = 1.6, CAM_LO = 0.1, CAM_HI = 1.6;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0.62, tx: 0, ty: 0.62, roll: 0, speed: 1, tspeed: 1, userAt: -1e9 };   // userAt: last time the visitor steered
  const keys = new Set();
  const history = Array.from({ length: ROWS }, () => new Float32Array(POINTS));
  const meta = new Array(ROWS).fill(null);
  const sx = new Float32Array(POINTS), sy = new Float32Array(POINTS);
  let W = 0, H = 0, DPR = 1, head = 0, clock = 0, count = 0, last = performance.now(), running = true;

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * DPR; canvas.height = H * DPR;
  }
  addEventListener('resize', resize);
  resize();

  // steering (skipped with { interactive: false }, for a banner that must not take over the keys or the scroll wheel)
  const interactive = opts.interactive !== false;
  function steer(x, y) {
    const r = canvas.getBoundingClientRect();
    cam.tx = (((x - r.left) / r.width) - 0.5) * 2 * CAM_X;
    cam.ty = CAM_LO + (1 - (y - r.top) / r.height) * (CAM_HI - CAM_LO);
  }
  if (interactive) {
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) { steer(e.clientX, e.clientY); cam.userAt = performance.now(); } });
  canvas.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { steer(e.clientX, e.clientY); cam.userAt = performance.now(); } });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.tspeed = Math.max(0.3, Math.min(3, cam.tspeed * (e.deltaY > 0 ? 0.9 : 1.1)));
  }, { passive: false });
  const steerKeys = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'];
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (steerKeys.includes(k)) { keys.add(k); e.preventDefault(); cam.userAt = performance.now(); }
    else if (k === '+' || k === '=') cam.tspeed = Math.min(3, cam.tspeed * 1.2);
    else if (k === '-' || k === '_') cam.tspeed = Math.max(0.3, cam.tspeed / 1.2);
  });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  }

  function push() {
    head = (head + 1) % ROWS;
    const row = history[head];
    row.fill(0);
    meta[head] = opts.sample ? opts.sample(row, count++) : null;
  }
  for (let i = 0; i < ROWS; i++) push();

  function update(dt) {
    const step = dt * 1.6;
    if (keys.has('arrowleft') || keys.has('a')) cam.tx -= step * CAM_X;
    if (keys.has('arrowright') || keys.has('d')) cam.tx += step * CAM_X;
    if (keys.has('arrowup') || keys.has('w')) cam.ty += step;
    if (keys.has('arrowdown') || keys.has('s')) cam.ty -= step;
    cam.tx = Math.max(-CAM_X, Math.min(CAM_X, cam.tx));
    cam.ty = Math.max(CAM_LO, Math.min(CAM_HI, cam.ty));
    const k = 1 - Math.exp(-dt * 2.5), px = cam.x;
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.speed += (cam.tspeed - cam.speed) * k;
    const vx = (cam.x - px) / Math.max(dt, 1e-3);
    cam.roll += ((reduceMotion ? 0 : Math.max(-0.35, Math.min(0.35, -vx * 0.12))) - cam.roll) * k;
  }

  function draw(phase) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2); ctx.rotate(cam.roll); ctx.translate(-W / 2, -H / 2);
    const f = Math.max(W * 0.55, H * 0.75), horizon = H * (opts.horizon || 0.34), gap = SPAN / ROWS, pad = Math.hypot(W, H);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#000';
    for (let a = 0; a < ROWS; a++) {
      const z = FAR - (a + phase) * gap;
      if (z <= NEAR) continue;
      const idx = (head - a + ROWS) % ROWS, row = history[idx], s = f / z, ground = horizon + cam.y * s;
      for (let i = 0; i < POINTS; i++) {
        sx[i] = W / 2 + ((i / (POINTS - 1) - 0.5) * ROW_W - cam.x) * s;
        sy[i] = horizon + (cam.y - row[i] * AMP) * s;
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(-pad, ground);
      for (let i = 0; i < POINTS; i++) ctx.lineTo(sx[i], sy[i]);
      // hide the farther lines behind this one: everything farther sits above this line's ground, so filling
      // down to the ground (not the bottom of the screen) is enough, and saves painting the screen 70 times over
      ctx.lineTo(W + pad, ground); ctx.lineTo(W + pad, ground + 2); ctx.lineTo(-pad, ground + 2);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = Math.max(0, Math.min((FAR - z) / (SPAN * 0.4), (z - NEAR) / 0.35, 1));
      ctx.lineWidth = Math.min(3, Math.max(0.6, 0.35 * s / 100));
      ctx.beginPath();
      ctx.moveTo(-pad, ground);
      for (let i = 0; i < POINTS; i++) ctx.lineTo(sx[i], sy[i]);
      ctx.lineTo(W + pad, ground);
      ctx.stroke();
      if (a === ROWS - 6 && opts.onNear) opts.onNear(meta[idx]);   // the line just ahead of the ship
      if (a === ROWS - 22 && opts.onAhead) opts.onAhead(meta[idx]); // a little further ahead, for an autopilot to aim at
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    update(dt);
    clock += dt * (opts.rate ? opts.rate() : 12) * cam.speed;
    while (clock >= 1) { clock -= 1; push(); }
    draw(clock);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { cam, stop() { running = false; } };
}
