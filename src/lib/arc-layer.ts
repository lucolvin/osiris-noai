/**
 * OSIRIS — arcs through the sky.
 *
 * The arcs are a WebGL custom layer: ribbons of constant pixel width lifted
 * along great circles through MapLibre's own projectTileFor3D, so they curve
 * with the globe and flatten with the 2D map. That function does not clip
 * against the horizon the way MapLibre's surface layers do, so each point is
 * tested here against the planet itself: the camera is recovered from the
 * horizon plane MapLibre hands every custom layer, and a point is hidden when
 * the line of sight to it passes through the Earth. The same vertex shader
 * drives an offscreen picking pass, so what can be clicked is exactly what is
 * drawn.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { ARC_STRIDE, packArcs, rgb, type ArcSpec } from './arcs';

interface ToneColors { support: string; oppose: string; neutral: string }
const DEFAULT_TONES: ToneColors = { support: '#b388ff', oppose: '#ff5ccb', neutral: '#8c7cff' };

/** Hidden behind the planet? Shared by every vertex shader here. */
const IN_SIGHT = `
float inSight(vec2 merc, float elevation) {
#ifdef GLOBE
  vec4 plane = u_projection_clipping_plane;
  if (plane.w > -1e-6 || u_projection_transition < 0.999) return 1.0;
  // The horizon plane is (unit normal toward the camera, -1 / camera distance): the camera, in Earth radii.
  vec3 cam = plane.xyz * (-1.0 / plane.w);
  vec3 p = projectToSphere(merc, merc) * (1.0 + (elevation + 2000.0) / GLOBE_RADIUS);
  vec3 ray = p - cam;
  float a = dot(ray, ray);
  float b = 2.0 * dot(cam, ray);
  float c = dot(cam, cam) - 1.0;
  float disc = b * b - 4.0 * a * c;
  if (disc <= 0.0) return 1.0;
  float t = (-b - sqrt(disc)) / (2.0 * a);
  return (t > 0.0 && t < 0.9995) ? 0.0 : 1.0;
#else
  return 1.0;
#endif
}

/**
 * MapLibre's projectTileFor3D, except for the units of height. A custom layer
 * on the globe takes metres; on the flat map (2D, and the globe once it flattens
 * close in) it takes mercator units, a whole world wide. Handing metres to the
 * flat map raised every arc a few thousand times too high, so it shot off the
 * screen as a beam. Here the flat side gets metres converted at the point's own
 * latitude, and the globe side is MapLibre's own.
 */
vec4 place(vec2 merc, float metres) {
  float flatZ = metres * cosh(3.14159265 * (1.0 - 2.0 * merc.y)) / 40075016.686;
#ifdef GLOBE
  vec4 globe = u_projection_matrix * vec4(projectToSphere(merc, merc) * (1.0 + metres / GLOBE_RADIUS), 1.0);
  if (u_projection_transition > 0.999) return globe;
  return mix(u_projection_fallback_matrix * vec4(merc, flatZ, 1.0), globe, u_projection_transition);
#else
  return u_projection_matrix * vec4(merc, flatZ, 1.0);
#endif
}`;

const ARC_VERT = `
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_prev;
layout(location = 2) in vec3 a_next;
layout(location = 3) in vec2 a_meta;   // side, t along the arc
layout(location = 4) in vec3 a_style;  // tone, id, highlight
layout(location = 5) in vec3 a_info;   // strength, birth, kind
layout(location = 6) in float a_len;   // km
layout(location = 7) in float a_peak;  // metres, the arc's full height
uniform vec2 u_viewport;
uniform float u_ratio;
uniform float u_lift;
uniform float u_ceiling; // metres: no arc rises above this, so none reaches the camera
uniform float u_wrap;    // which copy of the world, on the flat map
uniform float u_now;
uniform float u_dim;
uniform float u_hover;
uniform float u_widen;
out float v_side;
out float v_t;
out float v_strength;
out float v_age;
out float v_kind;
out float v_tone;
out float v_id;
out float v_hl;
out float v_len;
out float v_vis;
${IN_SIGHT}
vec2 screen(vec4 c) { return c.xy / c.w * u_viewport * 0.5; }
void main() {
  // The whole arc is lowered as one, so it keeps its shape rather than flattening on top.
  float lift = min(u_lift, u_ceiling / max(a_peak, 1.0));
  vec2 wrap = vec2(u_wrap, 0.0);
  float elevation = a_pos.z * lift;
  vec4 cur = place(a_pos.xy + wrap, elevation);
  vec4 prv = place(a_prev.xy + wrap, a_prev.z * lift);
  vec4 nxt = place(a_next.xy + wrap, a_next.z * lift);
  vec2 d = screen(nxt) - screen(prv);
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float kind = a_info.z;
  float hovered = abs(a_style.y - u_hover) < 0.5 ? 1.0 : 0.0;
  // Band width in pixels: room for a soft glow either side of the line.
  float width = (kind > 2.5 ? 6.0 : kind > 1.5 ? 8.0 : kind > 0.5 ? 6.0 : 7.0 + 5.0 * a_info.x);
  width *= 1.0 + 0.6 * max(a_style.z * u_dim, hovered);
  width = width * u_ratio + u_widen;
  // Multiplying by w cancels the perspective divide: constant width on screen.
  cur.xy += normal * a_meta.x * width / u_viewport * cur.w;
  gl_Position = cur;
  v_side = a_meta.x;
  v_t = a_meta.y;
  v_strength = a_info.x;
  v_age = u_now - a_info.y;
  v_kind = kind;
  v_tone = a_style.x;
  v_id = a_style.y;
  v_hl = max(a_style.z, hovered);
  v_len = a_len;
  v_vis = inSight(a_pos.xy, elevation);
}`;

const ARC_FRAG = `
precision highp float;
in float v_side;
in float v_t;
in float v_strength;
in float v_age;
in float v_kind;
in float v_tone;
in float v_id;
in float v_hl;
in float v_len;
in float v_vis;
uniform vec3 u_support;
uniform vec3 u_oppose;
uniform vec3 u_neutral;
uniform float u_now;
uniform float u_motion; // 0 when the viewer asked for reduced motion
uniform float u_flow;   // 1 while the run is live: pulses travel, dashes march
uniform float u_dim;    // 1 while something is selected
out vec4 fragColor;

/** Soft-edged on/off along the arc: duty is the share that is on. */
float dashes(float s, float duty) {
  float f = fract(s);
  return smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(duty, duty + 0.06, f));
}

void main() {
  if (v_vis < 0.5 || v_age < 0.0) discard;
  // The arc draws itself from speaker to target.
  float reveal = u_motion > 0.5 ? clamp(v_age / 1.1, 0.0, 1.0) : 1.0;
  reveal = 1.0 - pow(1.0 - reveal, 3.0);
  if (v_t > reveal) discard;

#ifdef PICK
  float id = v_id + 1.0;
  fragColor = vec4(mod(id, 256.0) / 255.0, mod(floor(id / 256.0), 256.0) / 255.0, floor(id / 65536.0) / 255.0, 1.0);
#else
  float d = abs(v_side);
  float core = exp(-d * d * 18.0);
  float halo = exp(-d * d * 3.0) * 0.3;
  float head = reveal < 1.0 ? smoothstep(0.1, 0.0, reveal - v_t) * 1.4 : 0.0;

  // Colour says how things stand: violet aligned or agreeing, magenta opposed or disputing, indigo between.
  vec3 tone = v_tone < 0.5 ? u_support : v_tone < 1.5 ? u_oppose : u_neutral;
  // Evidence from the feeds is quieter, a pale wash of its tone.
  if (v_kind > 0.5 && v_kind < 1.5) tone = mix(tone, vec3(0.86, 0.83, 0.96), 0.35);
  // "Weighing an actor" marches toward the actor; every other arc is a solid line. Spacing is in km along the arc.
  float s = v_t * v_len;
  float pattern = v_kind > 2.5 ? mix(0.18, 1.0, dashes(s / 140.0 - u_now * 0.9 * u_flow * u_motion, 0.5)) : 1.0;

  float speed = v_kind > 1.5 ? 0.5 : 0.22;
  float phase = fract(v_t - u_now * speed + v_strength * 3.7);
  float pulse = u_flow * u_motion * smoothstep(0.9, 1.0, phase) * 1.2;

  float base = v_kind > 0.5 && v_kind < 1.5 ? 0.55 : 0.9;
  float flash = 1.0 + 1.2 * exp(-v_age * 1.4) * u_motion;
  // Interactions from earlier rounds settle back, never out.
  float settle = v_kind > 1.5 ? mix(1.0, 0.45, clamp((v_age - 30.0) / 40.0, 0.0, 1.0)) : 1.0;
  float ends = mix(0.35, 1.0, smoothstep(0.0, 0.05, v_t) * smoothstep(1.0, 0.95, v_t));
  // A selection lights what belongs to it and lets the rest recede.
  float focus = mix(1.0, mix(0.13, 1.35, v_hl), u_dim) * mix(1.0, 1.35, v_hl * (1.0 - u_dim));

  // The drawing tip glows along the line itself, not across the whole ribbon.
  float alpha = clamp(((core + halo) * pattern * base * (0.55 + 0.45 * v_strength) + head * (core + halo * 0.5) + pulse * core) * flash * settle * ends * focus, 0.0, 1.0);
  vec3 col = mix(tone, vec3(1.0), clamp(core * 0.3 + head * 0.5 + pulse * 0.6, 0.0, 1.0));
  fragColor = vec4(col * alpha, alpha);
#endif
}`;

const PING_VERT = `
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_pos;
layout(location = 2) in vec4 a_ping;   // rgb, size in px
layout(location = 3) in vec3 a_time;   // start, period, once
uniform vec2 u_viewport;
uniform float u_ratio;
uniform float u_now;
uniform float u_motion;
uniform float u_wrap;
out vec2 v_corner;
out vec3 v_color;
out float v_phase;
out float v_alive;
${IN_SIGHT}
void main() {
  vec4 c = projectTileFor3D(a_pos + vec2(u_wrap, 0.0), 0.0);
  float px = a_ping.w * u_ratio;
  gl_Position = c + vec4(a_corner * px / u_viewport * 2.0 * c.w, 0.0, 0.0);
  float age = u_now - a_time.x;
  float ph = age / a_time.y;
  v_alive = (age < 0.0 || (a_time.z > 0.5 && ph > 1.0) || u_motion < 0.5 || inSight(a_pos, 0.0) < 0.5) ? 0.0 : 1.0;
  v_phase = fract(ph);
  v_corner = a_corner;
  v_color = a_ping.rgb;
}`;

const PING_FRAG = `
precision mediump float;
in vec2 v_corner;
in vec3 v_color;
in float v_phase;
in float v_alive;
out vec4 fragColor;
void main() {
  if (v_alive < 0.5) discard;
  float r = length(v_corner);
  float ring = smoothstep(0.14, 0.0, abs(r - v_phase)) * (1.0 - v_phase);
  float a = ring * 0.8;
  if (a < 0.01) discard;
  fragColor = vec4(v_color * a, a);
}`;

/* ───────────────────────────── The arc layer ───────────────────────────── */

interface Ping { pos: [number, number]; color: [number, number, number]; size: number; start: number; period: number; once: boolean }

const clock = () => performance.now() / 1000;

/** Stamps when each new arc starts drawing, staggered so a burst draws in sequence rather than at once. */
export function stampBirths(births: Map<string, number>, keys: string[], now = clock()): void {
  const fresh = keys.filter(k => !births.has(k));
  const gap = fresh.length > 1 ? Math.min(0.14, 3 / fresh.length) : 0;
  fresh.forEach((k, i) => births.set(k, now + i * gap));
}

type Programs = { arc: WebGLProgram; pick: WebGLProgram; ping: WebGLProgram };

/**
 * The arc layer. A map layer that draws links (Network Intel) creates an
 * instance under its own id.
 */
export function createArcLayer(id: string): CustomLayerInterface & {
  setArcs(arcs: ArcSpec[], dim: boolean): void;
  setPings(pings: Ping[]): void;
  setLive(live: boolean): void;
  setTones(tones: [number, number, number][]): void;
  setHover(id: number): void;
  pick(x: number, y: number): number | null;
} {
  let gl: WebGL2RenderingContext | null = null;
  let map: MlMap | null = null;
  const programs = new Map<string, Programs>();
  let arcs: ArcSpec[] = [];
  let pings: Ping[] = [];
  let arcBuf: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number } | null = null;
  let pingBuf: { vao: WebGLVertexArrayObject; quad: WebGLBuffer; inst: WebGLBuffer; count: number } | null = null;
  let arcsDirty = false;
  let pingsDirty = false;
  let live = false;
  let dim = false;
  let hover = -1;
  let tones: [number, number, number][] = [DEFAULT_TONES.support, DEFAULT_TONES.oppose, DEFAULT_TONES.neutral].map(rgb);
  let lastBirth = 0;
  // A pick happens on a pointer event, between frames: it reuses the last frame's projection and shaders.
  let lastProjection: CustomRenderMethodInput['defaultProjectionData'] | null = null;
  let lastShader: CustomRenderMethodInput['shaderData'] | null = null;
  let pickTarget: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const compile = (type: number, src: string) => {
    const s = gl!.createShader(type)!;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      const log = gl!.getShaderInfoLog(s);
      gl!.deleteShader(s);
      throw new Error(`Arc layer shader failed: ${log}`);
    }
    return s;
  };
  const link = (vertSrc: string, fragSrc: string) => {
    const p = gl!.createProgram()!;
    const vs = compile(gl!.VERTEX_SHADER, vertSrc);
    const fs = compile(gl!.FRAGMENT_SHADER, fragSrc);
    gl!.attachShader(p, vs);
    gl!.attachShader(p, fs);
    gl!.linkProgram(p);
    gl!.deleteShader(vs);
    gl!.deleteShader(fs);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) {
      const log = gl!.getProgramInfoLog(p);
      gl!.deleteProgram(p);
      throw new Error(`Arc layer link failed: ${log}`);
    }
    return p;
  };
  /** One set of programs per projection variant: the prelude changes with the projection. */
  const programsFor = (shader: CustomRenderMethodInput['shaderData']): Programs => {
    const key = `${shader.variantName}\0${shader.define}`;
    let set = programs.get(key);
    if (!set) {
      const head = `#version 300 es\n${shader.vertexShaderPrelude}\n${shader.define}\n`;
      set = {
        arc: link(head + ARC_VERT, `#version 300 es\n${ARC_FRAG}`),
        pick: link(head + ARC_VERT, `#version 300 es\n#define PICK\n${ARC_FRAG}`),
        ping: link(head + PING_VERT, `#version 300 es\n${PING_FRAG}`),
      };
      programs.set(key, set);
    }
    return set;
  };

  // Attribute slots are fixed in the shaders (layout locations), so one VAO serves the drawing and the picking programs.
  const attrib = (loc: number, size: number, stride: number, offset: number, divisor = 0) => {
    gl!.enableVertexAttribArray(loc);
    gl!.vertexAttribPointer(loc, size, gl!.FLOAT, false, stride, offset);
    gl!.vertexAttribDivisor(loc, divisor);
  };

  const freeArcs = () => {
    if (!gl || !arcBuf) return;
    gl.deleteVertexArray(arcBuf.vao); gl.deleteBuffer(arcBuf.vbo); gl.deleteBuffer(arcBuf.ibo);
    arcBuf = null;
  };
  const freePings = () => {
    if (!gl || !pingBuf) return;
    gl.deleteVertexArray(pingBuf.vao); gl.deleteBuffer(pingBuf.quad); gl.deleteBuffer(pingBuf.inst);
    pingBuf = null;
  };

  const buildArcs = () => {
    const g = gl!;
    freeArcs();
    if (!arcs.length) return;
    const { vertices, indices } = packArcs(arcs);
    const vao = g.createVertexArray()!;
    g.bindVertexArray(vao);
    const vbo = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, vbo);
    g.bufferData(g.ARRAY_BUFFER, vertices, g.STATIC_DRAW);
    const S = ARC_STRIDE * 4;
    attrib(0, 3, S, 0);
    attrib(1, 3, S, 12);
    attrib(2, 3, S, 24);
    attrib(3, 2, S, 36);
    attrib(4, 3, S, 44);
    attrib(5, 3, S, 56);
    attrib(6, 1, S, 68);
    attrib(7, 1, S, 72);
    const ibo = g.createBuffer()!;
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, indices, g.STATIC_DRAW);
    g.bindVertexArray(null);
    arcBuf = { vao, vbo, ibo, count: indices.length };
  };

  const buildPings = () => {
    const g = gl!;
    freePings();
    if (!pings.length) return;
    const vao = g.createVertexArray()!;
    g.bindVertexArray(vao);
    const quad = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), g.STATIC_DRAW);
    attrib(0, 2, 8, 0);
    const data = new Float32Array(pings.length * 9);
    pings.forEach((p, i) => data.set([p.pos[0], p.pos[1], ...p.color, p.size, p.start, p.period, p.once ? 1 : 0], i * 9));
    const inst = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, inst);
    g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    attrib(1, 2, 36, 0, 1);
    attrib(2, 4, 36, 8, 1);
    attrib(3, 3, 36, 24, 1);
    g.bindVertexArray(null);
    pingBuf = { vao, quad, inst, count: pings.length };
  };

  const setProjection = (program: WebGLProgram, proj: NonNullable<CustomRenderMethodInput['defaultProjectionData']>) => {
    const u = (n: string) => gl!.getUniformLocation(program, n);
    gl!.uniformMatrix4fv(u('u_projection_matrix'), false, proj.mainMatrix as Float32List);
    gl!.uniform4fv(u('u_projection_tile_mercator_coords'), proj.tileMercatorCoords as Float32List);
    gl!.uniform4fv(u('u_projection_clipping_plane'), proj.clippingPlane as Float32List);
    gl!.uniform1f(u('u_projection_transition'), proj.projectionTransition);
    gl!.uniformMatrix4fv(u('u_projection_fallback_matrix'), false, proj.fallbackMatrix as Float32List);
  };

  /** Arcs a thousand kilometres high mean nothing over a city: they settle as the view closes in. */
  const liftFor = (zoom: number) => (zoom <= 3.5 ? 1 : Math.max(0.12, 1 - (zoom - 3.5) * 0.22));

  /**
   * The highest an arc may rise this frame: a fifth of the camera's height.
   * Close in, the camera sits a few kilometres up while a long arc can still
   * peak far above that; past the camera its points project inside out, and
   * the line smears into a beam. Kept below it, an arc stays a clean line.
   */
  const ceilingFor = (m: MlMap) => {
    const centre = m.getCenter();
    const metresPerPixel = (40075016.686 * Math.cos((centre.lat * Math.PI) / 180)) / (512 * 2 ** m.getZoom());
    const toCentre = (0.5 * m.getCanvas().clientHeight) / Math.tan((m.getVerticalFieldOfView() * Math.PI) / 360);
    return 0.2 * toCentre * metresPerPixel * Math.cos((m.getPitch() * Math.PI) / 180);
  };

  /**
   * World copies to draw. The globe wraps on its own, but the flat map shows
   * the world side by side, and an arc over the date line runs past ±180 into
   * the next copy: drawn once, it is cut off wherever the view sits on the
   * other side of the line.
   */
  const wrapsFor = (shader: CustomRenderMethodInput['shaderData']) =>
    !shader.define.includes('GLOBE') && map!.getRenderWorldCopies() ? [-1, 0, 1] : [0];

  const arcUniforms = (program: WebGLProgram, proj: NonNullable<CustomRenderMethodInput['defaultProjectionData']>, now: number, widen: number) => {
    const g = gl!;
    g.useProgram(program);
    setProjection(program, proj);
    const u = (n: string) => g.getUniformLocation(program, n);
    g.uniform2f(u('u_viewport'), g.drawingBufferWidth, g.drawingBufferHeight);
    g.uniform1f(u('u_ratio'), window.devicePixelRatio || 1);
    g.uniform1f(u('u_lift'), liftFor(map!.getZoom()));
    g.uniform1f(u('u_ceiling'), ceilingFor(map!));
    g.uniform1f(u('u_now'), now);
    g.uniform1f(u('u_motion'), reduced ? 0 : 1);
    g.uniform1f(u('u_flow'), live ? 1 : 0);
    g.uniform1f(u('u_dim'), dim ? 1 : 0);
    g.uniform1f(u('u_hover'), hover);
    g.uniform1f(u('u_widen'), widen);
    g.uniform3f(u('u_support'), ...tones[0]);
    g.uniform3f(u('u_oppose'), ...tones[1]);
    g.uniform3f(u('u_neutral'), ...tones[2]);
  };

  return {
    id,
    type: 'custom',
    renderingMode: '3d',

    setArcs(next, dimOthers) {
      arcs = next;
      dim = dimOthers;
      arcsDirty = true;
      lastBirth = next.reduce((m, a) => Math.max(m, a.birth), 0);
      map?.triggerRepaint();
    },
    setPings(next) { pings = next; pingsDirty = true; map?.triggerRepaint(); },
    setLive(v) { live = v; map?.triggerRepaint(); },
    setTones(t) { tones = t; map?.triggerRepaint(); },
    setHover(id) { if (id !== hover) { hover = id; map?.triggerRepaint(); } },

    pick(x, y) {
      if (!gl || !map || !arcBuf || !lastProjection || !lastShader) return null;
      const g = gl;
      let set: Programs;
      try { set = programsFor(lastShader); } catch { return null; }
      const w = g.drawingBufferWidth, h = g.drawingBufferHeight;
      if (!pickTarget || pickTarget.w !== w || pickTarget.h !== h) {
        if (pickTarget) { g.deleteFramebuffer(pickTarget.fbo); g.deleteTexture(pickTarget.tex); }
        const tex = g.createTexture()!;
        g.bindTexture(g.TEXTURE_2D, tex);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
        const fbo = g.createFramebuffer()!;
        g.bindFramebuffer(g.FRAMEBUFFER, fbo);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
        pickTarget = { fbo, tex, w, h };
      }
      // Everything changed here is put back, so MapLibre's own view of the GL state stays true.
      const saved = {
        fbo: g.getParameter(g.FRAMEBUFFER_BINDING),
        program: g.getParameter(g.CURRENT_PROGRAM),
        vao: g.getParameter(g.VERTEX_ARRAY_BINDING),
        viewport: g.getParameter(g.VIEWPORT) as Int32Array,
        clear: g.getParameter(g.COLOR_CLEAR_VALUE) as Float32Array,
        blend: g.isEnabled(g.BLEND),
        depth: g.isEnabled(g.DEPTH_TEST),
        texture: g.getParameter(g.TEXTURE_BINDING_2D),
      };
      g.bindFramebuffer(g.FRAMEBUFFER, pickTarget.fbo);
      g.viewport(0, 0, w, h);
      g.clearColor(0, 0, 0, 0);
      g.clear(g.COLOR_BUFFER_BIT);
      g.disable(g.BLEND);
      g.disable(g.DEPTH_TEST);
      const ratio = w / (g.canvas as HTMLCanvasElement).clientWidth;
      arcUniforms(set.pick, lastProjection, clock(), 8 * ratio);
      g.bindVertexArray(arcBuf.vao);
      for (const wrap of wrapsFor(lastShader)) {
        g.uniform1f(g.getUniformLocation(set.pick, 'u_wrap'), wrap);
        g.drawElements(g.TRIANGLES, arcBuf.count, g.UNSIGNED_INT, 0);
      }

      // A small box, nearest hit to the cursor wins: a line a few pixels wide is otherwise hard to hit.
      const px = Math.round(x * ratio);
      const py = Math.round(h - y * ratio);
      const R = Math.round(6 * ratio);
      const x0 = Math.max(0, px - R), y0 = Math.max(0, py - R);
      const bw = Math.min(w - x0, R * 2 + 1), bh = Math.min(h - y0, R * 2 + 1);
      let best: number | null = null;
      if (bw > 0 && bh > 0) {
        const buf = new Uint8Array(bw * bh * 4);
        g.readPixels(x0, y0, bw, bh, g.RGBA, g.UNSIGNED_BYTE, buf);
        let bestDist = Infinity;
        for (let iy = 0; iy < bh; iy++) {
          for (let ix = 0; ix < bw; ix++) {
            const o = (iy * bw + ix) * 4;
            const id = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
            if (!id) continue;
            const dist = (x0 + ix - px) ** 2 + (y0 + iy - py) ** 2;
            if (dist < bestDist) { bestDist = dist; best = id - 1; }
          }
        }
      }

      g.bindFramebuffer(g.FRAMEBUFFER, saved.fbo);
      g.viewport(saved.viewport[0], saved.viewport[1], saved.viewport[2], saved.viewport[3]);
      g.clearColor(saved.clear[0], saved.clear[1], saved.clear[2], saved.clear[3]);
      if (saved.blend) g.enable(g.BLEND);
      if (saved.depth) g.enable(g.DEPTH_TEST);
      g.useProgram(saved.program);
      g.bindVertexArray(saved.vao);
      g.bindTexture(g.TEXTURE_2D, saved.texture);
      return best !== null && best < arcs.length ? best : null;
    },

    onAdd(m, context) {
      map = m;
      gl = context as WebGL2RenderingContext;
      arcsDirty = pingsDirty = true;
    },

    onRemove() {
      if (gl) {
        freeArcs();
        freePings();
        if (pickTarget) { gl.deleteFramebuffer(pickTarget.fbo); gl.deleteTexture(pickTarget.tex); }
        for (const p of programs.values()) { gl.deleteProgram(p.arc); gl.deleteProgram(p.pick); gl.deleteProgram(p.ping); }
      }
      programs.clear();
      pickTarget = null;
      lastProjection = null;
      lastShader = null;
      gl = null;
      map = null;
    },

    render(_ctx, args) {
      if (!gl || !map) return;
      const proj = args.defaultProjectionData;
      if (!proj || !args.shaderData?.vertexShaderPrelude) return;
      let set: Programs;
      try { set = programsFor(args.shaderData); }
      catch (err) { console.error('[OSIRIS] Arc layer:', err instanceof Error ? err.message : err); return; }
      lastProjection = proj;
      lastShader = args.shaderData;
      if (arcsDirty) { buildArcs(); arcsDirty = false; }
      if (pingsDirty) { buildPings(); pingsDirty = false; }
      if (!arcBuf && !pingBuf) return;

      const now = clock();
      const g = gl;
      // Occlusion is computed per vertex against the planet, so the depth buffer is not needed (and near the
      // surface it would only flicker).
      g.disable(g.DEPTH_TEST);
      g.depthMask(false);
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

      const wraps = wrapsFor(args.shaderData);
      if (arcBuf) {
        arcUniforms(set.arc, proj, now, 0);
        g.bindVertexArray(arcBuf.vao);
        for (const wrap of wraps) {
          g.uniform1f(g.getUniformLocation(set.arc, 'u_wrap'), wrap);
          g.drawElements(g.TRIANGLES, arcBuf.count, g.UNSIGNED_INT, 0);
        }
      }
      if (pingBuf) {
        const p = set.ping;
        g.useProgram(p);
        setProjection(p, proj);
        const u = (n: string) => g.getUniformLocation(p, n);
        g.uniform2f(u('u_viewport'), g.drawingBufferWidth, g.drawingBufferHeight);
        g.uniform1f(u('u_ratio'), window.devicePixelRatio || 1);
        g.uniform1f(u('u_now'), now);
        g.uniform1f(u('u_motion'), reduced ? 0 : 1);
        g.bindVertexArray(pingBuf.vao);
        for (const wrap of wraps) {
          g.uniform1f(u('u_wrap'), wrap);
          g.drawArraysInstanced(g.TRIANGLES, 0, 6, pingBuf.count);
        }
      }
      g.bindVertexArray(null);

      // Keep animating while the run is live and while arcs are still drawing in.
      const pending = now < lastBirth + 2.5 || pings.some(pg => (!pg.once ? live : now < pg.start + pg.period));
      if (!reduced && (live || pending)) map.triggerRepaint();
    },
  };
}
