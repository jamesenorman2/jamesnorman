/* The Agents house light effects, drawn on the graphics chip (WebGL2): soft volumetric beams, glowing points and wispy smoke,
   added together with a bloom, then laid over the 2D floor in one go. Optional: the admin switch "Agents house: light effects",
   or ?glhouse=1 on the address. If WebGL2 isn't available the page carries on with its normal 2D drawing. */
(function () {
  const H = { n: 0, ok: false, fail: false, tried: false, drawn: false };
  let gl, pSpr, pBlur, pOut, buf, data, T = {}, w = 0, h = 0, vao, empty, dpr = 1;
  const MAX = 4000, STRIDE = 12, U = {};
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = (v, f, id) => { const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, v)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); p.__id = id; return p; };
  const loc = (p, n) => U[n + p.__id] || (U[n + p.__id] = gl.getUniformLocation(p, n));
  const FULL = `#version 300 es
out vec2 v_uv; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const target = (iw, ih) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, iw, ih, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f, w: iw, h: ih };
  };
  function init() {
    H.tried = true;
    try {
      const c = document.createElement('canvas');
      gl = c.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
      if (!gl) throw new Error('no WebGL2'); H.canvas = c;
      // kind 0: a beam (a cone of light from A to B, widest at B); kind 1: a round glow; kind 2: a puff of smoke
      pSpr = prog(`#version 300 es
in vec4 a_p; in vec4 a_c; in vec4 a_m; uniform vec2 u_res; out vec4 v_c; out vec2 v_d; out float v_t; out vec2 v_w; flat out float v_kind; flat out float v_seed;
void main(){ float kind = a_m.z; v_kind = kind; v_c = a_c; v_seed = a_m.w; vec2 pos;
  if (kind < 0.5) { vec2 p0 = a_p.xy, p1 = a_p.zw, d = p1 - p0; float len = max(length(d), 0.001); vec2 dir = d / len, n = vec2(-dir.y, dir.x);
    float along = (gl_VertexID == 1 || gl_VertexID == 3) ? 1.0 : 0.0, side = gl_VertexID < 2 ? -1.0 : 1.0, q = max(a_m.x, a_m.y) * 2.2 + 2.0;
    pos = mix(p0, p1, along) + n * side * q; v_d = vec2(side * q, 0.0); v_t = along; v_w = a_m.xy; }
  else { float R = a_m.x * 2.0; vec2 cn = vec2((gl_VertexID & 1) == 1 ? 1.0 : -1.0, gl_VertexID < 2 ? -1.0 : 1.0); pos = a_p.xy + cn * R; v_d = cn; v_t = 0.0; v_w = vec2(1.0); }
  gl_Position = vec4(pos.x / u_res.x * 2.0 - 1.0, 1.0 - pos.y / u_res.y * 2.0, 0.0, 1.0); }`,
        `#version 300 es
precision mediump float; in vec4 v_c; in vec2 v_d; in float v_t; in vec2 v_w; flat in float v_kind; flat in float v_seed; out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){ float I;
  if (v_kind < 0.5) { float w = max(mix(v_w.x, v_w.y, v_t), 0.5) * 0.5, g = exp(-(v_d.x * v_d.x) / (2.0 * w * w)), core = exp(-(v_d.x * v_d.x) / (2.0 * w * w * 0.05));
    I = (g * 0.7 + core * 0.8) * pow(max(v_w.x, 0.5) / max(mix(v_w.x, v_w.y, v_t), 0.5), 0.6) * (1.0 - 0.3 * v_t) * smoothstep(0.0, 0.04, v_t); }
  else { float r = length(v_d); if (r > 1.0) discard; I = exp(-r * r * (v_kind > 1.5 ? 2.6 : 5.0)) * (1.0 - smoothstep(0.7, 1.0, r));
    if (v_kind > 1.5) I *= 0.45 + 1.1 * noise(v_d * 3.0 + v_seed * 17.0); }
  float a = clamp(I * v_c.a, 0.0, 1.0); o = vec4(v_c.rgb * a, a); }`, 'spr');
      pBlur = prog(FULL, `#version 300 es
precision mediump float; in vec2 v_uv; uniform sampler2D u_t; uniform vec2 u_dir; out vec4 o;
void main(){ vec4 s = texture(u_t, v_uv) * 0.227027; vec2 d = u_dir;
  s += (texture(u_t, v_uv + d * 1.3846) + texture(u_t, v_uv - d * 1.3846)) * 0.316216; s += (texture(u_t, v_uv + d * 3.2308) + texture(u_t, v_uv - d * 3.2308)) * 0.070270; o = s; }`, 'blur');
      pOut = prog(FULL, `#version 300 es
precision mediump float; in vec2 v_uv; uniform sampler2D u_s, u_b1, u_b2; uniform float u_k1, u_k2; out vec4 o;
void main(){ vec3 c = texture(u_s, v_uv).rgb + texture(u_b1, v_uv).rgb * u_k1 + texture(u_b2, v_uv).rgb * u_k2; o = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0)); }`, 'out');
      buf = gl.createBuffer(); data = new Float32Array(MAX * STRIDE); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const at = (n, off) => { const l = gl.getAttribLocation(pSpr, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, STRIDE * 4, off * 4); gl.vertexAttribDivisor(l, 1); };
      at('a_p', 0); at('a_c', 4); at('a_m', 8);
      empty = gl.createVertexArray(); return true;
    } catch (e) { H.fail = true; return false; }
  }
  function size(W, Hh, d) {
    const nw = Math.max(2, Math.round(W * d)), nh = Math.max(2, Math.round(Hh * d)); dpr = d; if (nw === w && nh === h) return; w = nw; h = nh; H.canvas.width = w; H.canvas.height = h;
    for (const k of Object.keys(T)) { gl.deleteTexture(T[k].t); gl.deleteFramebuffer(T[k].f); }
    T = { s: target(w, h), a: target(Math.max(2, w >> 2), Math.max(2, h >> 2)), b: target(Math.max(2, w >> 2), Math.max(2, h >> 2)), c: target(Math.max(2, w >> 3), Math.max(2, h >> 3)), d: target(Math.max(2, w >> 3), Math.max(2, h >> 3)) };
  }
  H.wanted = () => { const q = new URLSearchParams(location.search).get('glhouse'); if (q === '0') return false; if (q === '1') return true; try { return !!(window.JN_STICK && window.JN_STICK.cfg && window.JN_STICK.cfg.switches && window.JN_STICK.cfg.switches.glhouse === true); } catch (e) { return false; } };
  // call at the start of each frame; true means draw the effects through here instead of in 2D
  H.begin = (W, Hh, d) => {
    H.ok = false; if (H.fail || !H.wanted()) return false; if (!H.tried && !init()) return false; size(W, Hh, d); H.n = 0; H.ok = true; return true;
  };
  H.beam = (x0, y0, x1, y1, rgb, w0, w1, a) => { if (!H.ok || H.n >= MAX) return; const o = H.n++ * STRIDE; data[o] = x0 * dpr; data[o + 1] = y0 * dpr; data[o + 2] = x1 * dpr; data[o + 3] = y1 * dpr; data[o + 4] = rgb[0]; data[o + 5] = rgb[1]; data[o + 6] = rgb[2]; data[o + 7] = a; data[o + 8] = w0 * dpr; data[o + 9] = w1 * dpr; data[o + 10] = 0; data[o + 11] = 0; };
  H.glow = (x, y, r, rgb, a) => { if (!H.ok || H.n >= MAX) return; const o = H.n++ * STRIDE; data[o] = x * dpr; data[o + 1] = y * dpr; data[o + 2] = 0; data[o + 3] = 0; data[o + 4] = rgb[0]; data[o + 5] = rgb[1]; data[o + 6] = rgb[2]; data[o + 7] = a; data[o + 8] = r * dpr; data[o + 9] = 0; data[o + 10] = 1; data[o + 11] = 0; };
  H.smoke = (x, y, r, rgb, a, seed) => { if (!H.ok || H.n >= MAX) return; const o = H.n++ * STRIDE; data[o] = x * dpr; data[o + 1] = y * dpr; data[o + 2] = 0; data[o + 3] = 0; data[o + 4] = rgb[0]; data[o + 5] = rgb[1]; data[o + 6] = rgb[2]; data[o + 7] = a; data[o + 8] = r * dpr; data[o + 9] = 0; data[o + 10] = 2; data[o + 11] = seed || 0; };
  const pass = (p, src, dst, dir) => { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h); gl.useProgram(p); gl.bindVertexArray(empty); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t);
    gl.uniform1i(loc(p, 'u_t'), 0); gl.uniform2f(loc(p, 'u_dir'), dir[0] / src.w, dir[1] / src.h); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  // draw everything queued this frame onto the 2D floor, added to what is there
  H.flush = (ctx2d, W, Hh, bloom) => {
    if (!H.ok) return; H.drawn = true;
    gl.disable(gl.DEPTH_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, T.s.f); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (H.n) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(pSpr); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, H.n * STRIDE); gl.uniform2f(loc(pSpr, 'u_res'), w, h); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, H.n); gl.disable(gl.BLEND);
    }
    pass(pBlur, T.s, T.a, [1, 0]); pass(pBlur, T.a, T.b, [0, 1]); pass(pBlur, T.b, T.c, [1, 0]); pass(pBlur, T.c, T.d, [0, 1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(pOut); gl.bindVertexArray(empty);
    [[T.s, 0, 'u_s'], [T.b, 1, 'u_b1'], [T.d, 2, 'u_b2']].forEach(([t, i, n]) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t.t); gl.uniform1i(loc(pOut, n), i); });
    gl.uniform1f(loc(pOut, 'u_k1'), 0.9 * bloom); gl.uniform1f(loc(pOut, 'u_k2'), 0.7 * bloom); gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx2d.save(); ctx2d.setTransform(1, 0, 0, 1, 0, 0); ctx2d.globalCompositeOperation = 'lighter'; ctx2d.globalAlpha = 1; ctx2d.drawImage(H.canvas, 0, 0, w, h, 0, 0, ctx2d.canvas.width, ctx2d.canvas.height); ctx2d.restore();
  };
  window.HFX = H;
})();
