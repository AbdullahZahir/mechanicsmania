/*
 * Canvas scenario animations, drawn in the style of an old mechanics
 * textbook plate: ink-outlined shapes with engraved contour shading,
 * a red/blue/brass vector-color convention (force=crimson, velocity/
 * kinematic=navy, acceleration/highlight=brass), motion trails, ground
 * shadows and live "instrument plate" readouts -- built to read as a
 * detailed illustration, not a flat modern UI animation.
 *
 * One `render(ctx, w, h, t, params)` function per visual type, driven by
 * a shared requestAnimationFrame loop. `params` is a plain object of
 * whatever numeric knowns + the solved value were available for the
 * current problem -- animations degrade gracefully to sensible defaults
 * when a value wasn't supplied.
 */

// Declared before anything that could touch it. `refreshPalette()` runs at
// module load and calls `repaintActiveScenes()`, so if this Map were declared
// further down the file it would still be in its temporal dead zone at that
// moment — which throws, aborts the rest of the file, and leaves every later
// binding (rocketHandle, CRADLE, the renderers) undefined.
const oneShotCanvases = new Map();

function registerOneShot(canvas, redraw) {
  if (!canvas) return;
  oneShotCanvases.set(canvas, redraw);
  for (const key of oneShotCanvases.keys()) {
    if (!key.isConnected) oneShotCanvases.delete(key);
  }
}

// Scenes driven by requestAnimationFrame pick up a palette change on their
// next frame. One-shot canvases — the moment-of-inertia figures — do not, and
// would stay drawn in the old theme until something rebuilt them.
function repaintActiveScenes() {
  for (const [canvas, redraw] of oneShotCanvases) {
    if (canvas.isConnected) redraw();
    else oneShotCanvases.delete(canvas);
  }
}

// The canvas palette is sampled from the same CSS custom properties that style
// the rest of the interface, so a theme switch repaints the diagrams too and
// there is exactly one place where a colour is defined.
const PALETTE = {};

const PALETTE_TOKENS = {
  ink: "--fg",
  inkSoft: "--fg-muted",
  paper: "--stage",
  panel: "--bg-raised",
  rule: "--line-strong",
  crimson: "--vector-force",
  navy: "--vector-velocity",
  brass: "--vector-accel",
  forest: "--vector-energy",
};

const PALETTE_FALLBACK = {
  ink: "#e8e6e1", inkSoft: "#a4a8ad", paper: "#10151a", panel: "#1b2026",
  rule: "#3d4751", crimson: "#d2504a", navy: "#5b9dd9", brass: "#c9a227", forest: "#6aa87a",
};

function refreshPalette() {
  const cs = getComputedStyle(document.documentElement);
  for (const [key, token] of Object.entries(PALETTE_TOKENS)) {
    const value = cs.getPropertyValue(token).trim();
    PALETTE[key] = value || PALETTE_FALLBACK[key];
  }
  // Aliases kept for renderers that predate the token names.
  PALETTE.accent = PALETTE.navy;
  PALETTE.accent2 = PALETTE.crimson;
  PALETTE.accent3 = PALETTE.brass;
  PALETTE.danger = PALETTE.crimson;
  PALETTE.text = PALETTE.ink;
  PALETTE.dim = PALETTE.inkSoft;
  PALETTE.track = PALETTE.rule;
  // nameplate/sideNameplate ask for PALETTE.stage; without this alias the key is
  // undefined, assigning it to fillStyle is a silent no-op, and the plate behind
  // a name was filled with whatever colour the caller happened to leave set.
  PALETTE.stage = PALETTE.paper;
  PALETTE.shadow = cs.getPropertyValue("--line").trim() || "#2c343d";

  if (typeof repaintActiveScenes === "function") repaintActiveScenes();
}

refreshPalette();

const FONT_LABEL = '"IBM Plex Mono", Consolas, monospace';

let animHandle = null;
let animResizeObserver = null;


function stopAnimation() {
  if (animHandle) cancelAnimationFrame(animHandle);
  animHandle = null;
  if (animResizeObserver) animResizeObserver.disconnect();
  animResizeObserver = null;
}

// Sizes `canvas`'s drawing buffer to match its parent element, and keeps it
// in sync via ResizeObserver -- more reliable than a window "resize" listener
// since it also fires on layout shifts the window itself never sees (e.g. a
// web font finishing its swap after first paint).
function fitCanvasToParent(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;

  function apply(width, height) {
    const w = Math.max(width, 1);
    const h = Math.max(height, 1);
    // Skip no-op resizes so a repaint can never nudge the layout.
    if (canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return;
    }
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // clientWidth/clientHeight give the CONTENT box. getBoundingClientRect()
  // would include the parent's border, and sizing the canvas to that makes it
  // taller than the space it sits in -- which grows the parent, which grows
  // the canvas on the next repaint. That fed back 2px per paint, without
  // bound, every time the scene was redrawn.
  apply(parent.clientWidth, parent.clientHeight);

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) apply(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(parent);
  return observer;
}

function startAnimation(canvas, visual, params, mode = "scene") {
  stopAnimation();
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  animResizeObserver = fitCanvasToParent(canvas, ctx);

  // Spelled with the hyphen the key is actually registered under. The
  // underscore alias further down happens to exist, but it is an alias — one
  // tidy-up away from leaving this line reaching for undefined, and an
  // unrecognised `visual` would then throw inside the rAF loop and kill the
  // results-screen animation outright instead of degrading to a stock figure.
  const renderFn =
    mode === "freebody" ? renderFreeBody
    : mode === "graphs" ? renderMotionGraphs
    : (RENDERERS[visual] || RENDERERS["linear-motion"]);
  // Fail closed: a chapter wired to a visual nobody has written yet leaves the
  // stage blank, which is recoverable. A throw here is not.
  if (typeof renderFn !== "function") return;
  const start = performance.now();

  function paint(t) {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    renderFn(ctx, w, h, t, params);
  }

  // Draw frame zero synchronously. Waiting for requestAnimationFrame leaves
  // the canvas blank whenever rAF is throttled -- a backgrounded tab, a
  // hidden pane -- and the diagram simply never appears.
  paint(0);

  // A reader who has asked the OS to reduce motion gets a single
  // representative still rather than a continuous loop.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    paint(0.85);
    return;
  }

  function frame(now) {
    paint((now - start) / 1000);
    animHandle = requestAnimationFrame(frame);
  }
  animHandle = requestAnimationFrame(frame);
}

/* ---------------------------- math + easing ---------------------------- */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, f) { return a + (b - a) * f; }
function easeInOut(t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }

function norm(val, fallback, cap) {
  if (val === undefined || val === null || isNaN(val)) return fallback;
  const s = Math.sign(val) || 1;
  return s * clamp(Math.abs(val), 0.001, cap) / cap;
}

/* ---------------------------- primitives ---------------------------- */

function drawArrow(ctx, x1, y1, x2, y2, color, width = 2.4) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const headLen = 8 + width;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawDashedLine(ctx, x1, y1, x2, y2, color = PALETTE.rule, width = 1.2, dash = [4, 4]) {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx, x, y, text, color = PALETTE.ink, size = 12, align = "center") {
  ctx.fillStyle = color;
  ctx.font = `500 ${size}px ${FONT_LABEL}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawCaption(ctx, x, y, text, color = PALETTE.inkSoft, size = 11) {
  ctx.fillStyle = color;
  ctx.font = `400 ${size}px ${FONT_LABEL}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawShadow(ctx, x, y, w, alpha = 0.5) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(w / 2, 2), Math.max(w / 7, 1.5), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Engraving-style shaded sphere: ink outline, contour hatch lines on the
// shadow side, a bare highlight fleck opposite -- reads as "plate 3D"
// without any modern gradient fill.
function sphereShade(ctx, x, y, r, strokeColor = PALETTE.ink, fillColor = PALETTE.panel) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = strokeColor;
  ctx.globalAlpha = 0.38;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    const rr = (r * i) / 5.6;
    ctx.beginPath();
    ctx.arc(x + r * 0.32, y + r * 0.32, rr, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = strokeColor;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x - r * 0.34, y - r * 0.34, r * 0.26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawWheel(ctx, x, y, r, angle, color = PALETTE.ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.24, Math.sin(a) * r * 0.24);
    ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

// A small wheeled cart body -- replaces the plain block for ground-based
// scenes (kinematics/forces/momentum/work) so motion reads as an object
// rolling rather than a shape sliding in a vacuum.
function drawCart(ctx, x, groundY, w, h, wheelSpin, color = PALETTE.ink, fill = PALETTE.panel) {
  const wheelR = h * 0.22;
  const bodyY = groundY - wheelR * 2 - h * 0.5 + 2;
  ctx.save();
  ctx.translate(x, bodyY);
  ctx.fillStyle = fill;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(6, h * 0.18));
  ctx.fill();
  ctx.stroke();
  ctx.save();
  roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(6, h * 0.18));
  ctx.clip();
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  for (let d = -w; d < w; d += 7) {
    ctx.beginPath();
    ctx.moveTo(d, h / 2);
    ctx.lineTo(d + h, -h / 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  drawWheel(ctx, x - w * 0.28, groundY - wheelR, wheelR, wheelSpin, color);
  drawWheel(ctx, x + w * 0.28, groundY - wheelR, wheelR, wheelSpin, color);
  drawShadow(ctx, x, groundY + 3, w * 1.2);
  return { bodyTopY: bodyY - h / 2, bodyCenterY: bodyY };
}

function drawGround(ctx, w, h, y) {
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(w * 0.05, y);
  ctx.lineTo(w * 0.95, y);
  ctx.stroke();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1;
  for (let x = w * 0.05; x < w * 0.95; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 8, y + 9);
    ctx.stroke();
  }
}

// Measuring-tape ruler beneath the ground line, with tick marks -- gives
// scenes a sense of scale/distance like a textbook diagram would.
function drawRuler(ctx, w, h, y, offsetPx = 0) {
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  for (let x = w * 0.05; x < w * 0.95; x += 24) {
    const major = Math.round((x - w * 0.05 + offsetPx) / 24) % 5 === 0;
    ctx.beginPath();
    ctx.moveTo(x, y + 11);
    ctx.lineTo(x, y + (major ? 17 : 14));
    ctx.stroke();
  }
}

function drawSpringCoil(ctx, x1, y1, x2, y2, coils, color = PALETTE.ink) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const amp = 10;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const segs = coils * 2;
  for (let i = 1; i <= segs; i++) {
    const f = i / segs;
    const side = i % 2 === 0 ? 1 : -1;
    const bx = x1 + ux * len * f + px * amp * side;
    const by = y1 + uy * len * f + py * amp * side;
    ctx.lineTo(bx, by);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // shading pass, offset slightly, faint -- suggests coil roundness
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBar(ctx, x, y0, width, height, frac, color, label, valueText) {
  const bh = height * clamp(frac, 0, 1);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x - width / 2, y0 - height, width, height);
  ctx.strokeStyle = PALETTE.rule;
  for (let i = 1; i < 4; i++) {
    const ty = y0 - (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x - width / 2, ty);
    ctx.lineTo(x - width / 2 - 4, ty);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x - width / 2, y0 - bh, width, Math.max(bh, 1.5));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x - width / 2, y0 - bh, width, Math.max(bh, 1.5));
  drawLabel(ctx, x, y0 + 16, label, PALETTE.ink, 13);
  if (valueText) drawCaption(ctx, x, y0 - height - 12, valueText, PALETTE.inkSoft, 11);
}

// Fading dotted trail through an array of {x,y} points, oldest first.
function drawTrail(ctx, pts, color) {
  pts.forEach((pt, i) => {
    const alpha = ((i + 1) / pts.length) * 0.4;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// Deterministic trail generator: samples a position function at N points in
// the recent past, without needing per-frame mutable state.
function trailFromFn(t, span, count, posFn) {
  const pts = [];
  for (let i = count; i >= 1; i--) {
    const back = (i / count) * span;
    pts.push(posFn(Math.max(t - back, 0)));
  }
  return pts;
}

function drawAngleArc(ctx, cx, cy, r, a0, a1, color, label) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  ctx.restore();
  const mid = (a0 + a1) / 2;
  drawCaption(ctx, cx + Math.cos(mid) * (r + 13), cy + Math.sin(mid) * (r + 13), label, color, 12);
}

// A small boxed "instrument plate" of live values, drawn directly on the
// canvas -- typewriter numerals in a ruled card, matching the homepage
// readouts.
function drawDataPlate(ctx, x, y, w, lines) {
  const lineH = 15;
  const h = 12 + lines.length * lineH;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = PALETTE.panel;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `400 11px ${FONT_LABEL}`;
  lines.forEach((ln, i) => {
    const ty = y + 10 + i * lineH;
    ctx.fillStyle = PALETTE.ink;
    // Most callers pass a [label, value] PAIR. fillText stringifies whatever it
    // is given, so a pair used to arrive on the canvas through
    // Array.prototype.toString -- the reader saw "R,3.00 m", comma and all,
    // with the value jammed against the label instead of ranged right. Nothing
    // caught it because intercepting fillText proves only that it was called.
    if (Array.isArray(ln)) {
      const label = ln[0], value = ln[1], colour = ln[2];
      ctx.fillText(String(label), x + 8, ty);
      // A third entry is a colour for the value alone: rampgames.js passes
      // triples, and an instrument plate wants the number tinted, not the name.
      if (colour) ctx.fillStyle = colour;
      ctx.textAlign = "right";
      // A sparse pair reads better as a blank than as the word "undefined";
      // fmt() already hands back an em dash for a value that is genuinely absent.
      ctx.fillText(value === undefined || value === null ? "" : String(value), x + w - 8, ty);
      ctx.textAlign = "left";
    } else {
      ctx.fillText(String(ln), x + 8, ty);
    }
  });
  ctx.restore();
  return h;
}

function fmt(n, d = 2) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return n.toFixed(d);
}

/* ---------------------------- renderers ---------------------------- */

const RENDERERS = {};

RENDERERS["linear-motion"] = function (ctx, w, h, t, p) {
  const groundY = h * 0.68;
  drawGround(ctx, w, h, groundY);
  drawRuler(ctx, w, h, groundY, (t * 30) % 24);

  const vi = p.vi ?? p.v ?? 1;
  const a = p.a ?? 0;
  const cycle = 3.4;

  const posAt = (tt) => {
    const tm = tt % cycle;
    return 0.5 * (vi * tm + 0.5 * a * tm * tm);
  };
  const maxX = Math.max(Math.abs(0.5 * (vi * cycle + 0.5 * a * cycle * cycle)), 20);
  const dir = (vi >= 0 ? 1 : -1) || 1;
  const toPx = (x) => w * 0.16 + w * 0.68 * ((clamp((x / maxX) * dir, -1, 1) + 1) / 2);

  const trail = trailFromFn(t, 0.6, 10, (tt) => ({ x: toPx(posAt(tt)), y: groundY - 6 }));
  drawTrail(ctx, trail, PALETTE.navy);

  const px = toPx(posAt(t));
  const tm = t % cycle;
  const spin = (t * (Math.abs(vi) + 1) * 2) % (Math.PI * 2) * Math.sign(dir);
  drawCart(ctx, px, groundY, 46, 24, spin, PALETTE.ink);

  const vNow = vi + a * tm;
  const vLen = norm(vNow, 0.5, Math.max(Math.abs(vi) + Math.abs(a) * cycle, 1)) * 70;
  if (Math.abs(vLen) > 4) {
    drawArrow(ctx, px, groundY - 52, px + vLen, groundY - 52, PALETTE.navy, 2.4);
    drawLabel(ctx, px + vLen / 2, groundY - 66, "v", PALETTE.navy, 14);
  }
  if (a) {
    const aLen = norm(a, 0.4, Math.max(Math.abs(a), 1) * 2) * 55;
    drawArrow(ctx, px, groundY - 38, px + aLen, groundY - 38, PALETTE.brass, 2.4);
    drawLabel(ctx, px + aLen / 2, groundY - 22, "a", PALETTE.brass, 13);
  }

  drawDataPlate(ctx, w - 128, 10, 120, [
    `t = ${fmt(tm)} s`,
    `v = ${fmt(vNow)} m/s`,
    `a = ${fmt(a)} m/s²`,
  ]);
  drawCaption(ctx, w / 2, h * 0.1, "Fig. — Rectilinear Motion", PALETTE.inkSoft, 12.5);
};

RENDERERS["forces"] = function (ctx, w, h, t, p) {
  const groundY = h * 0.68;
  drawGround(ctx, w, h, groundY);
  drawRuler(ctx, w, h, groundY, 0);
  const cx = w / 2;
  const Fa = p.Fa, Ff = p.Ff, weight = p.weight, Fn = p.Fn, a = p.a ?? 0;

  const moving = Math.abs(a) > 0.01 || Math.abs(Fa || 0) > Math.abs(Ff || 0);
  const spin = moving ? (t * 3) % (Math.PI * 2) : Math.sin(t * 8) * 0.05;
  const squish = 1 - clamp((weight || 0) / 4000, 0, 0.08);

  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(1, squish);
  ctx.translate(-cx, 0);
  drawCart(ctx, cx, groundY / squish, 58, 30, spin, PALETTE.ink);
  ctx.restore();

  if (Ff && moving) {
    for (let i = 0; i < 4; i++) {
      const dx = ((t * 90 + i * 23) % 70) - 35;
      ctx.globalAlpha = 0.28 * (1 - Math.abs(dx) / 35);
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.beginPath();
      ctx.arc(cx - dx, groundY + 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (Fa) drawArrow(ctx, cx - 78, groundY - 32, cx - 34, groundY - 32, PALETTE.crimson, 2.6);
  if (Fa) drawLabel(ctx, cx - 78, groundY - 48, "Fa", PALETTE.crimson, 13);
  if (Ff) drawArrow(ctx, cx + 34, groundY - 32, cx + (Fa ? 66 : 10), groundY - 32, PALETTE.forest, 2.4);
  if (Ff) drawLabel(ctx, cx + 48, groundY - 48, "Ff", PALETTE.forest, 13);
  if (weight || weight === 0) {
    drawArrow(ctx, cx, groundY - 30, cx, groundY + 6, PALETTE.navy, 2.4);
    drawLabel(ctx, cx + 24, groundY - 6, "mg", PALETTE.navy, 12);
  }
  if (Fn || Fn === 0) {
    drawArrow(ctx, cx, groundY - 30, cx, groundY - 76, PALETTE.brass, 2.4);
    drawLabel(ctx, cx + 22, groundY - 70, "Fn", PALETTE.brass, 12);
  }

  drawDataPlate(ctx, w - 128, 10, 120, [
    `Fa = ${fmt(Fa, 1)} N`,
    `Ff = ${fmt(Ff, 1)} N`,
    `a  = ${fmt(a)} m/s²`,
  ]);
  drawCaption(ctx, w / 2, h * 0.1, "Fig. — Forces on the Body", PALETTE.inkSoft, 12.5);
};

RENDERERS["momentum"] = function (ctx, w, h, t, p) {
  const groundY = h * 0.36;
  drawGround(ctx, w, h, groundY);
  const v = p.v ?? p.vf ?? p.vi ?? 1;
  const speed = clamp(Math.abs(v), 0.2, 8);
  const cycle = 4;
  const dir = v >= 0 ? 1 : -1;
  const posFrac = (tt) => {
    // Ping-pong rather than wrap. `% cycle` sent the cart back across half the
    // stage in a single frame every cycle/speed seconds -- as often as twice a
    // second at high v -- and because only the cart reset while the ground and
    // ruler stayed put, it read as the cart jumping backwards rather than as
    // the scene restarting.
    const u = ((tt * speed) % (2 * cycle)) / cycle;      // 0 .. 2
    const f = u <= 1 ? u : 2 - u;                        // 0 -> 1 -> 0, continuous
    return dir >= 0 ? f : 1 - f;
  };
  const toPx = (tt) => w * 0.15 + w * 0.5 * posFrac(tt);

  const trail = trailFromFn(t, 0.7, 12, (tt) => ({ x: toPx(tt), y: groundY - 22 }));
  drawTrail(ctx, trail, PALETTE.navy);

  const px = toPx(t);
  const spin = (t * speed * 2) % (Math.PI * 2) * dir;
  drawCart(ctx, px, groundY, 40, 22, spin, PALETTE.ink);
  drawArrow(ctx, px, groundY - 46, px + dir * 58, groundY - 46, PALETTE.navy, 2.4);
  drawLabel(ctx, px + dir * 29, groundY - 60, "p = mv", PALETTE.navy, 12.5);
  drawCaption(ctx, w / 2, h * 0.08, "Fig. — Momentum & Impulse", PALETTE.inkSoft, 12.5);

  const mass = p.mass ?? 1;
  const pVal = p.p ?? mass * v;
  const J = p.J ?? p.changeOfp;

  const barY = h * 0.95;
  const barH = h * 0.34;
  const bars = [{ x: w * 0.28, label: "p (momentum)", val: pVal, color: PALETTE.navy }];
  if (J !== undefined && J !== null) bars.push({ x: w * 0.62, label: "J (impulse)", val: J, color: PALETTE.crimson });
  else bars.push({ x: w * 0.62, label: "p (scaled ×1.4)", val: pVal * 1.4, color: PALETTE.crimson });

  const maxMag = Math.max(...bars.map((b) => Math.abs(b.val)), 1);
  bars.forEach((b) => {
    const frac2 = clamp(Math.abs(b.val) / maxMag, 0.04, 1);
    drawBar(ctx, b.x, barY, 46, barH, frac2, b.color, b.label, `${b.val.toFixed(2)}`);
  });
};

RENDERERS["collision"] = function (ctx, w, h, t, p) {
  const groundY = h * 0.6;
  drawGround(ctx, w, h, groundY);
  drawRuler(ctx, w, h, groundY, 0);
  const cycle = 3.8;
  const tt = t % cycle;
  const half = cycle / 2;
  const m1 = Math.max(p.m1 ?? p.mass ?? 1, 0.3);
  const m2 = Math.max(p.m2 ?? p.mass ?? 1, 0.3);
  const r1 = 16 + clamp(m1, 0, 10) * 2.6;
  const r2 = 16 + clamp(m2, 0, 10) * 2.6;
  const centerX = w / 2;
  const inelastic = p.inelastic;
  const contactT = half;

  let x1, x2;
  if (tt < half) {
    const f = easeInOut(tt / half);
    x1 = w * 0.16 + (centerX - r1 - w * 0.16) * f;
    x2 = w * 0.84 - (w * 0.84 - centerX - r2) * f;
  } else {
    const f = easeOut((tt - half) / half);
    if (inelastic) {
      x1 = centerX + (w * 0.32) * f;
      x2 = x1 + r1 + r2 - 4;
    } else {
      x1 = centerX - r1 - (w * 0.32) * f;
      x2 = centerX + r2 + (w * 0.32) * f;
    }
  }

  // impact burst at contact
  const sinceContact = tt - contactT;
  if (sinceContact >= 0 && sinceContact < 0.22) {
    const f = sinceContact / 0.22;
    ctx.strokeStyle = PALETTE.brass;
    ctx.globalAlpha = 1 - f;
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2;
      const rr = 8 + f * 22;
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(ang) * rr * 0.4, groundY - r1 + Math.sin(ang) * rr * 0.4);
      ctx.lineTo(centerX + Math.cos(ang) * rr, groundY - r1 + Math.sin(ang) * rr);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawShadow(ctx, x1, groundY + 3, r1 * 1.5);
  if (!(inelastic && tt >= half)) drawShadow(ctx, x2, groundY + 3, r2 * 1.5);

  sphereShade(ctx, x1, groundY - r1, r1, PALETTE.crimson);
  if (!(inelastic && tt >= half)) {
    sphereShade(ctx, x2, groundY - r2, r2, PALETTE.navy);
  }

  drawDataPlate(ctx, w - 150, 10, 142, [
    `m1=${fmt(m1, 1)}  m2=${fmt(m2, 1)} kg`,
    inelastic ? "Inelastic: p conserved" : "Elastic: p & KE conserved",
  ]);
  drawCaption(ctx, w / 2, h * 0.12, inelastic ? "Fig. — Inelastic Collision" : "Fig. — Elastic Collision", PALETTE.inkSoft, 12.5);
};

// Exact parabolic valley profile -- used identically for drawing the curve
// AND for placing anything that must sit on it, so nothing can drift off
// the line the way a mismatched Bezier-vs-lerp approximation would.
function valleyY(f, topY, bottomY) {
  return topY + (bottomY - topY) * (1 - Math.pow(2 * f - 1, 2));
}

RENDERERS["energy"] = function (ctx, w, h, t, p) {
  // curved valley the ball rolls along, trading PE for KE -- kept in the
  // upper ~60% of the canvas so it never collides with the bar chart below
  const leftX = w * 0.1, rightX = w * 0.9;
  const topY = h * 0.2;
  const bottomY = h * 0.56;

  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let f = 0; f <= 1.001; f += 0.02) {
    const x = lerp(leftX, rightX, f);
    const y = valleyY(f, topY, bottomY);
    if (f === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  for (let f = 0; f <= 1; f += 0.08) {
    const x = lerp(leftX, rightX, f);
    const y = valleyY(f, topY, bottomY);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
  }

  const cyc = (Math.sin(t * 1.3) + 1) / 2;
  const hasSpring = p.Uspring || p.dspring || p.k;
  const keFrac = p.KE !== undefined ? clamp(Math.abs(p.KE) / (Math.abs(p.KE) + Math.abs(p.Ug || 1) + 1), 0.05, 1) : cyc;
  const ugFrac = p.Ug !== undefined ? clamp(Math.abs(p.Ug) / (Math.abs(p.KE || 1) + Math.abs(p.Ug) + 1), 0.05, 1) : 1 - cyc;

  // ball position: high KE (fast) -> near bottom of valley; high Ug -> near top
  const posFrac = clamp(0.5 + (ugFrac - keFrac) * 0.46, 0.06, 0.94);
  const bx = lerp(leftX, rightX, posFrac);
  const curveY = valleyY(posFrac, topY, bottomY);
  const ballR = 15;
  drawShadow(ctx, bx, curveY + 3, 30);
  sphereShade(ctx, bx, curveY - ballR, ballR, PALETTE.ink);

  if (hasSpring) {
    // a small spring bumper sitting in the floor of the valley, compressing
    // and extending in place -- not floating disconnected off to the side
    const springX = lerp(leftX, rightX, 0.5);
    const springBaseY = valleyY(0.5, topY, bottomY) + ballR + 4;
    const springTopY = springBaseY - 16 - 26 * (1 - cyc);
    drawSpringCoil(ctx, springX, springBaseY, springX, springTopY, 5, PALETTE.brass);
  }

  const barBaseY = h * 0.94;
  const barW = 40;
  const maxBarH = h * 0.22;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(w * 0.12, barBaseY);
  ctx.lineTo(w * 0.88, barBaseY);
  ctx.stroke();
  drawCaption(ctx, w * 0.14, barBaseY - maxBarH - 14, "Energy (J)", PALETTE.inkSoft, 11);

  const bars = [
    { label: "KE", frac: keFrac, color: PALETTE.navy, x: w * 0.32, val: p.KE },
    { label: "Ug", frac: ugFrac, color: PALETTE.crimson, x: w * 0.52, val: p.Ug },
  ];
  if (hasSpring) bars.push({ label: "Uspring", frac: clamp(1 - cyc, 0.05, 1), color: PALETTE.brass, x: w * 0.72, val: p.Uspring });
  bars.forEach((b) => {
    const valText = typeof b.val === "number" ? b.val.toFixed(2) : undefined;
    drawBar(ctx, b.x, barBaseY, barW, maxBarH, b.frac, b.color, b.label, valText);
  });

  drawCaption(ctx, w / 2, h * 0.08, "Fig. — Exchange of Mechanical Energy", PALETTE.inkSoft, 12.5);
};

RENDERERS["work"] = function (ctx, w, h, t, p) {
  const costheta = p.costheta;
  const angle = costheta !== undefined ? Math.acos(clamp(costheta, -1, 1)) : 0;
  const hasIncline = angle > 0.08;

  const groundY = h * 0.72;
  if (hasIncline) {
    const baseX = w * 0.14, baseY = groundY, runX = w * 0.86, riseY = groundY - (runX - baseX) * Math.tan(angle) * 0.35;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(runX, riseY);
    ctx.lineTo(runX, baseY);
    ctx.closePath();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    for (let d = 0; d < w; d += 10) {
      ctx.beginPath();
      ctx.moveTo(baseX + d, baseY);
      ctx.lineTo(baseX + d - 40, baseY - 40);
      ctx.stroke();
    }
    ctx.restore();
    drawAngleArc(ctx, runX, baseY, 34, Math.PI, Math.PI + angle, PALETTE.navy, `θ=${Math.round((angle * 180) / Math.PI)}°`);
    drawDashedLine(ctx, baseX, baseY, runX, baseY, PALETTE.rule, 1, [3, 4]);

    const cycle = 3;
    const f = (t % cycle) / cycle;
    const bx = lerp(baseX + 20, runX - 10, f);
    const by = lerp(baseY - 4, riseY + 4, f);
    drawShadow(ctx, bx, by + 14, 40);
    const spin = (t * 3) % (Math.PI * 2);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(-angle);
    ctx.translate(-bx, -by);
    drawCart(ctx, bx, by + 14, 40, 22, spin, PALETTE.ink);
    ctx.restore();
    drawArrow(ctx, bx - 42 * Math.cos(angle), by + 14 - 42 * Math.sin(angle), bx - 10 * Math.cos(angle), by + 14 - 10 * Math.sin(angle), PALETTE.crimson, 2.6);
    drawLabel(ctx, bx - 40, by - 6, "Fa", PALETTE.crimson, 13);

    drawDataPlate(ctx, w - 128, 10, 118, [`d = ${fmt(p.d, 1)} m`, `Fa = ${fmt(p.Fa, 1)} N`]);
    drawCaption(ctx, w / 2, h * 0.1, "Fig. — Work Along an Incline", PALETTE.inkSoft, 12.5);
    return;
  }

  drawGround(ctx, w, h, groundY);
  drawRuler(ctx, w, h, groundY, 0);
  const cycle = 3;
  const frac = (t % cycle) / cycle;
  const px = w * 0.18 + w * 0.55 * frac;

  drawArrow(ctx, w * 0.09, groundY - 22, w * 0.09 + 40, groundY - 22, PALETTE.crimson, 2.6);
  const spin = (t * 3) % (Math.PI * 2);
  drawCart(ctx, px, groundY, 42, 24, spin, PALETTE.ink);

  drawDashedLine(ctx, w * 0.18, groundY - 44, px, groundY - 44, PALETTE.rule, 1, [4, 5]);
  drawArrow(ctx, w * 0.18, groundY - 44, w * 0.18, groundY - 34, PALETTE.inkSoft, 1.2);
  drawArrow(ctx, px, groundY - 44, px, groundY - 34, PALETTE.inkSoft, 1.2);
  drawLabel(ctx, (w * 0.18 + px) / 2, groundY - 56, "d", PALETTE.navy, 13);

  drawDataPlate(ctx, w - 118, 10, 108, [`d = ${fmt(p.d, 1)} m`, `Fa = ${fmt(p.Fa, 1)} N`]);
  drawCaption(ctx, w / 2, h * 0.12, "Fig. — Work Across a Displacement", PALETTE.inkSoft, 12.5);
};

RENDERERS["rotational"] = function (ctx, w, h, t, p) {
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.3;
  const omega = p.omega ?? p.omega_dyn ?? p.omega_i ?? p.omega_f ?? 1.2;
  const angle = t * clamp(omega, -6, 6);

  drawShadow(ctx, cx, cy + R + 14, R * 1.3, 0.1);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2.2;
  ctx.fillStyle = PALETTE.panel;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.strokeStyle = i % 2 === 0 ? PALETTE.ink : PALETTE.rule;
    ctx.lineWidth = i % 2 === 0 ? 1.8 : 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.16, Math.sin(a) * R * 0.16);
    ctx.lineTo(Math.cos(a) * R * 0.94, Math.sin(a) * R * 0.94);
    ctx.stroke();
  }
  // rim engraving ticks
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1;
  for (let i = 0; i < 36; i++) {
    const a = (i * Math.PI) / 18;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.94, Math.sin(a) * R * 0.94);
    ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    ctx.stroke();
  }
  ctx.restore();

  // fading trail of the marked point along the rim
  const trail = trailFromFn(t, 1.2, 16, (tt) => {
    const a = tt * clamp(omega, -6, 6);
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  drawTrail(ctx, trail, PALETTE.crimson);

  const dotX = cx + R * Math.cos(angle);
  const dotY = cy + R * Math.sin(angle);
  drawArrow(ctx, cx, cy, dotX, dotY, PALETTE.crimson, 2);
  sphereShade(ctx, dotX, dotY, 9, PALETTE.brass);

  const tanAngle = angle + Math.PI / 2 * Math.sign(omega || 1);
  drawArrow(ctx, dotX, dotY, dotX + 40 * Math.cos(tanAngle), dotY + 40 * Math.sin(tanAngle), PALETTE.navy, 2.2);
  drawLabel(ctx, dotX + 46 * Math.cos(tanAngle), dotY + 46 * Math.sin(tanAngle), "v", PALETTE.navy, 13);

  const angleTraveled = angle % (Math.PI * 2);
  drawAngleArc(ctx, cx, cy, R * 0.4, 0, angleTraveled, PALETTE.brass, "θ");

  drawDataPlate(ctx, 10, 10, 118, [`ω = ${fmt(omega)} rad/s`, `v = ${fmt(omega * R * 0.01)} m/s`]);
  drawCaption(ctx, w / 2, h * 0.08, "Fig. — Rotational Motion", PALETTE.inkSoft, 12.5);
};

RENDERERS["oscillation"] = function (ctx, w, h, t, p) {
  const A = clamp(Math.abs(p.A ?? p.A_calc ?? 40), 10, 60);
  const omega = clamp(Math.abs(p.omega_osc ?? p.omega_calc ?? 2.4), 0.6, 6);
  const phi = p.phi ?? p.phi_calc ?? 0;
  const isPendulum = p.pendulum;

  if (isPendulum) {
    const pivotX = w / 2, pivotY = h * 0.16;
    const len = h * 0.56;
    const thetaMax = (A / 60) * 0.6;
    const thetaAt = (tt) => thetaMax * Math.cos(omega * tt + phi);
    const bobAt = (tt) => {
      const th = thetaAt(tt);
      return { x: pivotX + len * Math.sin(th), y: pivotY + len * Math.cos(th) };
    };

    // mounting bracket
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pivotX - 30, pivotY);
    ctx.lineTo(pivotX + 30, pivotY);
    ctx.stroke();
    for (let d = -26; d <= 26; d += 8) {
      ctx.beginPath();
      ctx.moveTo(pivotX + d, pivotY);
      ctx.lineTo(pivotX + d - 6, pivotY + 8);
      ctx.stroke();
    }

    drawAngleArc(ctx, pivotX, pivotY, 46, Math.PI / 2 - thetaMax, Math.PI / 2 + thetaMax, PALETTE.brass, "");
    const trail = trailFromFn(t, 1.4, 18, bobAt);
    drawTrail(ctx, trail, PALETTE.navy);

    const bob = bobAt(t);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(bob.x, bob.y);
    ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2);
    ctx.fill();

    const th = thetaAt(t);
    const dth = -thetaMax * omega * Math.sin(omega * t + phi);
    const speed = Math.abs(dth) * len * 0.02;
    if (speed > 2) {
      const tangent = th + Math.PI / 2;
      const dir = Math.sign(dth) || 1;
      drawArrow(ctx, bob.x, bob.y, bob.x + dir * speed * 12 * Math.sin(tangent), bob.y + dir * speed * 12 * Math.cos(tangent), PALETTE.navy, 2);
    }

    drawShadow(ctx, bob.x, pivotY + len + 18, 30, 0.08);
    sphereShade(ctx, bob.x, bob.y, 16, PALETTE.navy);

    drawDataPlate(ctx, 10, 10, 108, [`θ = ${fmt((th * 180) / Math.PI, 1)}°`]);
    drawCaption(ctx, w / 2, h * 0.06, "Fig. — Simple Pendulum", PALETTE.inkSoft, 12.5);
    return;
  }

  const topY = h * 0.12;
  const centerY = h * 0.52;
  const x = w / 2;
  const yAt = (tt) => centerY + A * Math.cos(omega * tt + phi) * (h / 260);
  const y = yAt(t);

  // ceiling mount
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - 28, topY - 6);
  ctx.lineTo(x + 28, topY - 6);
  ctx.stroke();
  for (let d = -24; d <= 24; d += 8) {
    ctx.beginPath();
    ctx.moveTo(x + d, topY - 6);
    ctx.lineTo(x + d - 6, topY + 2);
    ctx.stroke();
  }

  const yTop = centerY - A * (h / 260);
  const yBot = centerY + A * (h / 260);
  drawDashedLine(ctx, x - 60, yTop, x + 60, yTop, PALETTE.rule, 1, [3, 4]);
  drawDashedLine(ctx, x - 60, yBot, x + 60, yBot, PALETTE.rule, 1, [3, 4]);
  drawCaption(ctx, x - 72, yTop, "+A", PALETTE.inkSoft, 11);
  drawCaption(ctx, x - 72, yBot, "-A", PALETTE.inkSoft, 11);

  const trail = trailFromFn(t, 1.0, 14, (tt) => ({ x: x + 30, y: yAt(tt) }));
  drawTrail(ctx, trail, PALETTE.navy);

  drawSpringCoil(ctx, x, topY, x, y - 24, 9, PALETTE.ink);
  drawShadow(ctx, x, y + 26, 50, 0.1);
  sphereShade(ctx, x, y, 20, PALETTE.crimson);

  const v = -A * omega * Math.sin(omega * t + phi) * (h / 260);
  if (Math.abs(v) > 2) drawArrow(ctx, x + 26, y, x + 26, y + clamp(v, -40, 40), PALETTE.navy, 2);

  drawDataPlate(ctx, 10, 10, 110, [`x = ${fmt(y - centerY)} px`, `T = ${fmt((2 * Math.PI) / omega)} s`]);
  drawCaption(ctx, w / 2, h * 0.06, "Fig. — Spring-Mass Oscillation", PALETTE.inkSoft, 12.5);
};

RENDERERS["calculus"] = function (ctx, w, h, t, p) {
  const padL = w * 0.1, padR = w * 0.92, midY = h * 0.5, amp = h * 0.24;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  for (let gx = padL; gx <= padR; gx += (padR - padL) / 12) {
    ctx.beginPath();
    ctx.moveTo(gx, midY - amp - 14);
    ctx.lineTo(gx, midY + amp + 14);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(padL, midY);
  ctx.lineTo(padR, midY);
  ctx.moveTo(padL, midY - amp - 14);
  ctx.lineTo(padL, midY + amp + 14);
  ctx.stroke();

  const a = p.a_const ?? p.alpha_t ?? 0;
  const v0 = p.v0 ?? p.omega0_calc ?? 1;
  const x0 = p.x0 ?? p.theta0_calc ?? 0;
  const span = 4;
  const xAt = (tt) => x0 + v0 * tt + 0.5 * a * tt * tt;
  const vAt = (tt) => v0 + a * tt;

  let maxAbs = 1;
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const tt = (i / 80) * span;
    const x = xAt(tt);
    pts.push(x);
    if (Math.abs(x) > maxAbs) maxAbs = Math.abs(x);
  }
  ctx.strokeStyle = PALETTE.navy;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  pts.forEach((x, i) => {
    const px = padL + (padR - padL) * (i / 80);
    const py = midY - (x / maxAbs) * amp;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // faint v(t) overlay, secondary curve
  let maxV = 1;
  const vpts = [];
  for (let i = 0; i <= 80; i++) {
    const v = vAt((i / 80) * span);
    vpts.push(v);
    if (Math.abs(v) > maxV) maxV = Math.abs(v);
  }
  ctx.strokeStyle = PALETTE.crimson;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  vpts.forEach((v, i) => {
    const px = padL + (padR - padL) * (i / 80);
    const py = midY - (v / maxV) * amp * 0.7;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const cycle = span;
  const tt = t % cycle;
  const xNow = xAt(tt);
  const px = padL + (padR - padL) * (tt / cycle);
  const py = midY - (xNow / maxAbs) * amp;
  sphereShade(ctx, px, py, 8, PALETTE.crimson);

  drawDataPlate(ctx, w - 128, 10, 118, [
    `t = ${fmt(tt)} s`,
    `x = ${fmt(xNow)}`,
    `v = ${fmt(vAt(tt))}`,
  ]);
  drawCaption(ctx, w / 2, h * 0.08, "Fig. — x(t) [solid] & v(t) [dashed]", PALETTE.inkSoft, 12);
};

RENDERERS["projectile"] = function (ctx, w, h, t, p) {
  const groundY = h * 0.86;
  const v0 = clamp(Math.abs(p.v0_p ?? 20), 1, 200);
  const thetaDeg = clamp(p.theta_p ?? 45, 1, 89);
  const theta = (thetaDeg * Math.PI) / 180;
  const g = GRAVITY;

  const v0x = v0 * Math.cos(theta);
  const v0y = v0 * Math.sin(theta);
  const flight = (2 * v0y) / g;
  const range = v0x * flight;
  const apex = (v0y * v0y) / (2 * g);

  // Fit the whole arc into the frame, preserving the true aspect ratio of the
  // trajectory so a 60-degree launch visibly looks steeper than a 30.
  const padL = w * 0.1, padR = w * 0.94;
  const usableW = padR - padL, usableH = groundY - h * 0.16;
  const scale = Math.min(usableW / Math.max(range, 1e-6), usableH / Math.max(apex, 1e-6));
  const X = (x) => padL + x * scale;
  const Y = (y) => groundY - y * scale;

  drawGround(ctx, w, h, groundY);

  // full trajectory, drawn faintly ahead of the projectile
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i <= 90; i++) {
    const tt = (i / 90) * flight;
    const px = X(v0x * tt), py = Y(v0y * tt - 0.5 * g * tt * tt);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();

  const cycle = flight * 1.25;
  const tt = clamp((t % cycle), 0, flight);
  const x = v0x * tt, y = v0y * tt - 0.5 * g * tt * tt;
  const px = X(x), py = Y(y);

  // travelled path, solid
  ctx.strokeStyle = PALETTE.navy;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const s = (i / 60) * tt;
    const sx = X(v0x * s), sy = Y(v0y * s - 0.5 * g * s * s);
    i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
  }
  ctx.stroke();

  // apex guide
  const apexX = X(range / 2), apexY = Y(apex);
  drawDashedLine(ctx, apexX, apexY, apexX, groundY, PALETTE.rule, 1, [2, 4]);
  drawCaption(ctx, apexX, apexY - 12, `h max ${apex.toFixed(1)} m`, PALETTE.inkSoft, 10.5);

  // range bracket
  drawDashedLine(ctx, padL, groundY + 14, X(range), groundY + 14, PALETTE.rule, 1, [2, 4]);
  drawCaption(ctx, (padL + X(range)) / 2, groundY + 24, `range ${range.toFixed(1)} m`, PALETTE.inkSoft, 10.5);

  // launch angle arc
  drawAngleArc(ctx, padL, groundY, 34, -theta, 0, PALETTE.brass, `${thetaDeg.toFixed(0)}°`);

  // live velocity components at the projectile
  const vy = v0y - g * tt;
  const vScale = 26 / Math.max(v0, 1e-6);
  drawArrow(ctx, px, py, px + v0x * vScale, py, PALETTE.navy, 1.8);
  drawArrow(ctx, px, py, px, py - vy * vScale, PALETTE.crimson, 1.8);
  drawArrow(ctx, px, py, px + v0x * vScale, py - vy * vScale, PALETTE.brass, 2.2);

  drawShadow(ctx, px, groundY, 16, 0.35);
  sphereShade(ctx, px, py, 7, PALETTE.ink);

  drawDataPlate(ctx, 10, 10, 152, [
    `v0x = ${fmt(v0x)} m/s  (const)`,
    `vy  = ${fmt(vy)} m/s`,
    `t   = ${fmt(tt)} / ${fmt(flight)} s`,
  ]);
  drawCaption(ctx, w / 2, h * 0.07, "Fig. — Projectile Trajectory", PALETTE.inkSoft, 12);
};

RENDERERS["gravitation"] = function (ctx, w, h, t, p) {
  const cx = w * 0.38, cy = h * 0.52;
  const R = Math.min(w, h) * 0.3;
  const centralR = clamp(Math.min(w, h) * 0.075, 14, 30);
  const satR = 8;

  // Field falls off as 1/r^2, so the guide rings thin out with distance.
  for (let i = 1; i <= 4; i++) {
    const rr = R * (0.45 + i * 0.22);
    ctx.save();
    ctx.globalAlpha = 0.5 / (i * i * 0.35 + 1);
    ctx.strokeStyle = PALETTE.rule;
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // orbit path
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const period = 5.5;
  const ang = (t / period) * Math.PI * 2;
  const sx = cx + R * Math.cos(ang), sy = cy + R * Math.sin(ang);

  const trail = trailFromFn(t, 1.6, 20, (tt) => {
    const a = (tt / period) * Math.PI * 2;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  drawTrail(ctx, trail, PALETTE.navy);

  // central body, with a little surface hatching so it reads as a sphere
  sphereShade(ctx, cx, cy, centralR, PALETTE.brass);
  drawLabel(ctx, cx, cy + centralR + 14, "m₁", PALETTE.brass, 11);

  // the force is always centre-pointing, and equal and opposite on each body
  drawArrow(ctx, sx, sy, sx + (cx - sx) * 0.28, sy + (cy - sy) * 0.28, PALETTE.crimson, 2);
  drawArrow(ctx, cx, cy, cx + (sx - cx) * 0.32, cy + (sy - cy) * 0.32, PALETTE.crimson, 1.6);

  // velocity is tangential: perpendicular to the radius, never toward m1
  const tangent = ang + Math.PI / 2;
  drawArrow(ctx, sx, sy, sx + 34 * Math.cos(tangent), sy + 34 * Math.sin(tangent), PALETTE.navy, 2);
  drawLabel(ctx, sx + 46 * Math.cos(tangent), sy + 46 * Math.sin(tangent), "v", PALETTE.navy, 11);

  sphereShade(ctx, sx, sy, satR, PALETTE.ink);

  // radius marker
  drawDashedLine(ctx, cx, cy, sx, sy, PALETTE.rule, 1, [2, 4]);
  drawLabel(ctx, (cx + sx) / 2, (cy + sy) / 2 - 10, "r", PALETTE.inkSoft, 11);

  drawDataPlate(ctx, w - 172, 12, 160, [
    `F     = ${fmt(p.F_grav, 3)} N`,
    `g     = ${fmt(p.g_field, 3)} N/kg`,
    `v_orb = ${fmt(p.v_orbit, 1)} m/s`,
    `v_esc = ${fmt(p.v_escape, 1)} m/s`,
  ]);
  drawCaption(ctx, w / 2, h * 0.06, "Fig. — Orbit under Universal Gravitation", PALETTE.inkSoft, 12);
};

RENDERERS["varforce"] = function (ctx, w, h, t, p) {
  // W = the area under F(x). Sweeping the shaded region left to right makes
  // the integral something you watch accumulate rather than merely assert.
  const padL = w * 0.13, padR = w * 0.94;
  const baseY = h * 0.78, topY = h * 0.16;

  const F0 = p.F0_var ?? 5;
  const c = p.c_var ?? 3;
  const d = Math.abs(p.dx_var ?? 4) || 4;

  const Fat = (x) => F0 + c * x;
  let hi = Math.max(Fat(0), Fat(d), 0), lo = Math.min(Fat(0), Fat(d), 0);
  if (Math.abs(hi - lo) < 1e-9) { hi = lo + 1; }
  const X = (x) => padL + (x / d) * (padR - padL);
  const Y = (F) => baseY - ((F - lo) / (hi - lo)) * (baseY - topY);

  // axes
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(padL, topY - 6); ctx.lineTo(padL, baseY); ctx.lineTo(padR, baseY);
  ctx.stroke();
  if (lo < 0 && hi > 0) {
    ctx.save(); ctx.globalAlpha = 0.6;
    drawDashedLine(ctx, padL, Y(0), padR, Y(0), PALETTE.rule, 1, [2, 4]);
    ctx.restore();
  }

  const sweep = clamp((t % 4.5) / 3.2, 0, 1) * d;

  // accumulated area = work done so far
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  for (let i = 0; i <= 60; i++) ctx.lineTo(X((i / 60) * sweep), Y(Fat((i / 60) * sweep)));
  ctx.lineTo(X(sweep), Y(0));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // the force curve
  ctx.strokeStyle = PALETTE.crimson;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const x = (i / 80) * d;
    i === 0 ? ctx.moveTo(X(x), Y(Fat(x))) : ctx.lineTo(X(x), Y(Fat(x)));
  }
  ctx.stroke();

  // marker riding the curve
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.arc(X(sweep), Y(Fat(sweep)), 4, 0, Math.PI * 2);
  ctx.fill();
  drawDashedLine(ctx, X(sweep), Y(Fat(sweep)), X(sweep), Y(0), PALETTE.rule, 1, [2, 3]);

  const workSoFar = F0 * sweep + 0.5 * c * sweep * sweep;
  drawLabel(ctx, padL + 8, topY + 4, "F (N)", PALETTE.crimson, 11, "left");
  drawCaption(ctx, (padL + padR) / 2, baseY + 20, "x (m)", PALETTE.inkSoft, 10);
  drawLabel(ctx, X(sweep / 2), Y(0) - 16, `W = ${workSoFar.toFixed(1)} J`, PALETTE.brass, 12);

  drawDataPlate(ctx, w - 170, 12, 158, [
    `F(x) = ${fmt(F0, 1)} + ${fmt(c, 1)}·x`,
    `x    = ${fmt(sweep, 2)} / ${fmt(d, 2)} m`,
    `W    = ∫F dx = ${fmt(workSoFar, 2)} J`,
  ]);
  drawCaption(ctx, w / 2, h * 0.07, "Fig. — Work as the Area Under F(x)", PALETTE.inkSoft, 12);
};

// (An underscored alias of "linear-motion" used to live here as a belt-and-
// braces guard for the fallback bug at startAnimation. The fallback now names
// the real hyphenated key, and nothing referenced the alias, so it is gone.)

/* ---------------------------- Chapter 11: classic problem types ---------------------------- */

function easeIn(t) { t = clamp(t, 0, 1); return t * t * t; }

function quadBezier(p0, p1, p2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

// A square hanging mass -- like drawCart's body but with no wheels, for
// objects suspended from a string rather than rolling on the ground.
function drawHangingBlock(ctx, x, y, size, color = PALETTE.ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, -size / 2, -size / 2, size, size, 4);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  roundRect(ctx, -size / 2, -size / 2, size, size, 4);
  ctx.clip();
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  for (let d = -size; d < size; d += 7) {
    ctx.beginPath();
    ctx.moveTo(d, size / 2);
    ctx.lineTo(d + size, -size / 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function drawAtwoodScene(ctx, w, h, t, p, flywheel) {
  const pivotX = w / 2, pivotY = h * 0.18;
  const pulleyR = flywheel ? 30 : 20;
  const restY = h * 0.6;
  const groundY = h * 0.93;

  const m1 = Math.max(p.m1 ?? 1, 0.2);
  const m2 = Math.max(p.m2 ?? 1.6, 0.2);
  const fallingSide = (p.a !== undefined ? p.a >= 0 : m2 >= m1) ? 2 : 1;

  const cycle = 3.4;
  const uRaw = (t % cycle) / cycle;
  const maxTravel = h * 0.22;
  const s = maxTravel * uRaw * uRaw; // constant-acceleration shape, resets each cycle

  let y1 = restY, y2 = restY;
  if (fallingSide === 2) { y1 = restY - s; y2 = restY + s; }
  else { y1 = restY + s; y2 = restY - s; }

  // mount bracket
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pivotX - 40, pivotY - pulleyR - 6);
  ctx.lineTo(pivotX + 40, pivotY - pulleyR - 6);
  ctx.stroke();
  for (let d = -36; d <= 36; d += 8) {
    ctx.beginPath();
    ctx.moveTo(pivotX + d, pivotY - pulleyR - 6);
    ctx.lineTo(pivotX + d - 6, pivotY - pulleyR + 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY - pulleyR - 6);
  ctx.lineTo(pivotX, pivotY - pulleyR);
  ctx.stroke();

  const leftX = pivotX - pulleyR, rightX = pivotX + pulleyR;

  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(leftX, pivotY);
  ctx.lineTo(leftX, y1);
  ctx.moveTo(rightX, pivotY);
  ctx.lineTo(rightX, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, pulleyR, Math.PI, 0);
  ctx.stroke();

  const spin = s / pulleyR;
  if (flywheel) {
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(spin);
    ctx.fillStyle = PALETTE.panel;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, pulleyR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, pulleyR - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5; i++) {
      const ang = (i * Math.PI * 2) / 5;
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(ang) * (pulleyR - 6), Math.sin(ang) * (pulleyR - 6));
      ctx.stroke();
    }
    ctx.restore();
  } else {
    drawWheel(ctx, pivotX, pivotY, pulleyR, spin, PALETTE.ink);
  }

  const size1 = 24 + clamp(m1, 0, 10) * 2.6;
  const size2 = 24 + clamp(m2, 0, 10) * 2.6;
  drawShadow(ctx, leftX, groundY, size1 * 1.1, 0.1);
  drawShadow(ctx, rightX, groundY, size2 * 1.1, 0.1);
  drawHangingBlock(ctx, leftX, y1 + size1 / 2, size1, PALETTE.crimson);
  drawHangingBlock(ctx, rightX, y2 + size2 / 2, size2, PALETTE.navy);
  drawLabel(ctx, leftX, y1 + size1 / 2, "m1", PALETTE.crimson, 12);
  drawLabel(ctx, rightX, y2 + size2 / 2, "m2", PALETTE.navy, 12);
  drawArrow(ctx, leftX, y1, leftX, y1 - 22, PALETTE.brass, 2);
  drawArrow(ctx, rightX, y2, rightX, y2 - 22, PALETTE.brass, 2);
  drawArrow(ctx, leftX, y1 + size1 / 2, leftX, y1 + size1 / 2 + 22, PALETTE.forest, 2);
  drawArrow(ctx, rightX, y2 + size2 / 2, rightX, y2 + size2 / 2 + 22, PALETTE.forest, 2);

  drawGround(ctx, w, h, groundY);

  const plateLines = flywheel
    ? [`a = ${fmt(p.a)} m/s²`, `T1 = ${fmt(p.T1)} N`, `T2 = ${fmt(p.T2)} N`]
    : [`a = ${fmt(p.a)} m/s²`, `T = ${fmt(p.T)} N`];
  drawDataPlate(ctx, 10, 10, 130, plateLines);
  drawCaption(ctx, w / 2, h * 0.06, flywheel ? "Fig. — Atwood Machine with a Massive Pulley" : "Fig. — Atwood Machine", PALETTE.inkSoft, 12);
}

RENDERERS["atwood"] = function (ctx, w, h, t, p) { drawAtwoodScene(ctx, w, h, t, p, false); };
RENDERERS["atwood-flywheel"] = function (ctx, w, h, t, p) { drawAtwoodScene(ctx, w, h, t, p, true); };

RENDERERS["rolling-race"] = function (ctx, w, h, t, p) {
  const topX = w * 0.12, topY = h * 0.18;
  const botX = w * 0.82, botY = h * 0.82;
  const kShape = p.k_shape ?? 0.4;
  const objR = 18;

  function wedgePath() {
    ctx.beginPath();
    ctx.moveTo(topX, botY);
    ctx.lineTo(topX, topY);
    ctx.lineTo(botX, botY);
    ctx.closePath();
  }
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.8;
  wedgePath();
  ctx.stroke();
  ctx.save();
  wedgePath();
  ctx.clip();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1;
  for (let d = 0; d < w + h; d += 10) {
    ctx.beginPath();
    ctx.moveTo(topX + d, botY);
    ctx.lineTo(topX + d - 60, botY - 60);
    ctx.stroke();
  }
  ctx.restore();

  const rampLen = Math.hypot(botX - topX, botY - topY) || 1;
  const rdx = (botX - topX) / rampLen, rdy = (botY - topY) / rampLen;
  const ndx = rdy, ndy = -rdx; // outward normal, away from the wedge

  const posAt = (tt) => {
    const cyc = 3;
    const u = (tt % cyc) / cyc;
    const travel = u * u; // constant-acceleration shape
    return {
      x: lerp(topX, botX, travel) + ndx * objR,
      y: lerp(topY, botY, travel) + ndy * objR,
      travel,
    };
  };

  const trail = trailFromFn(t, 0.6, 10, (tt) => posAt(tt));
  drawTrail(ctx, trail, PALETTE.rule);

  const cur = posAt(t);
  const spinAngle = (cur.travel * rampLen) / objR;
  drawShadow(ctx, cur.x - ndx * objR * 0.7, cur.y - ndy * objR * 0.7, objR * 1.3, 0.12);

  if (kShape < 0.45) {
    sphereShade(ctx, cur.x, cur.y, objR, PALETTE.crimson);
  } else if (kShape < 0.6) {
    drawWheel(ctx, cur.x, cur.y, objR, spinAngle, PALETTE.navy);
  } else if (kShape < 0.85) {
    sphereShade(ctx, cur.x, cur.y, objR, PALETTE.forest);
    ctx.save();
    ctx.translate(cur.x, cur.y);
    ctx.rotate(spinAngle);
    ctx.strokeStyle = PALETTE.paper;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, objR * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(cur.x, cur.y);
    ctx.rotate(spinAngle);
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, objR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(objR, 0);
    ctx.stroke();
    ctx.restore();
  }

  drawDashedLine(ctx, topX, topY, topX, botY, PALETTE.rule, 1, [3, 4]);
  drawLabel(ctx, topX - 16, (topY + botY) / 2, "h", PALETTE.navy, 13);
  const theta = Math.atan2(botY - topY, botX - topX);
  drawAngleArc(ctx, botX, botY, 40, Math.PI, Math.PI + theta, PALETTE.brass, "θ");

  const transFrac = 1 / (1 + kShape), rotFrac = kShape / (1 + kShape);
  drawBar(ctx, w - 78, h * 0.94, 22, h * 0.28, transFrac, PALETTE.navy, "trans", undefined);
  drawBar(ctx, w - 46, h * 0.94, 22, h * 0.28, rotFrac, PALETTE.brass, "rot", undefined);

  drawDataPlate(ctx, 10, 10, 130, [`k = ${fmt(kShape)}`, `v = ${fmt(p.v_roll)} m/s`, `a = ${fmt(p.a_roll)} m/s²`]);
  drawCaption(ctx, w / 2, h * 0.06, "Fig. — Rolling Race Down an Incline", PALETTE.inkSoft, 12);
};

/* The solver's loop-the-loop, drawn on the SAME track the sandbox integrates.

   The previous version placed the cart by angle with a hand-tuned
   `warpA * sin(2*pi*u)` term bolted on to fake the speeding up and slowing
   down. That warp is what made the cart appear to spin on its own axis while
   going round, and it is why the normal force jumped as the cart reached
   ground level: the drawn motion and the reported force came from two
   different descriptions of the same ride.

   Here the position comes from arc length along the real track, driven by the
   real equation of motion, so the cart's wheels sit on the rails everywhere
   and the force arrows agree with where it actually is. */

/* One integration per (R, h), cached: time in, arc length out. Doing this at
   draw time for every frame would re-solve the whole ride sixty times a
   second for a picture that never changes. */
let coasterTimelineCache = null;

function coasterTimeline(R, h) {
  if (coasterTimelineCache && coasterTimelineCache.R === R && coasterTimelineCache.h === h) {
    return coasterTimelineCache;
  }
  const p = { R, h };
  const track = coasterTrack(p);
  const dt = 1 / 240;
  // Nudge off the crest: the raised cosine has exactly zero slope there, so a
  // cart released precisely at rest at the top never starts.
  let s = track.total * 0.004;
  let v = 0;
  const times = [0], arc = [s];
  let t = 0;
  while (t < 30 && s < track.total) {
    const at = coasterAt(track, s);
    const a = -GRAVITY * Math.sin(at.slope);
    v += a * dt;
    s += v * dt;
    t += dt;
    if (times.length < 4000 && t - times[times.length - 1] > 1 / 120) {
      times.push(t); arc.push(s);
    }
  }
  coasterTimelineCache = { R, h, track, times, arc, duration: t };
  return coasterTimelineCache;
}

RENDERERS["loop-coaster"] = function (ctx, w, h, t, p) {
  const R = Number.isFinite(p.R_loop) ? clamp(p.R_loop, 0.6, 10) : 3;
  const height = Number.isFinite(p.h_loop) ? clamp(p.h_loop, 0.5, 30) : Math.max(2.7 * R, 8);
  const tl = coasterTimeline(R, height);
  const track = tl.track;

  // Frame the whole circuit, plus the release height.
  const world = newWorld(0, 0);
  includePoint(world, 0, height, 0);
  track.pts.forEach((q, i) => { if (i % 12 === 0) includePoint(world, q.x, q.y, 0); });
  const view = fitView("solver-coaster", w, h, world, { pad: 0.12 });

  // where the cart is now, by arc length
  const cyc = t % (tl.duration + 0.8);
  let s = 0;
  if (cyc < tl.duration) {
    let lo = 0, hi = tl.times.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tl.times[mid] <= cyc) lo = mid; else hi = mid;
    }
    const span = tl.times[hi] - tl.times[lo] || 1e-9;
    const f = (cyc - tl.times[lo]) / span;
    s = tl.arc[lo] + (tl.arc[hi] - tl.arc[lo]) * f;
  } else {
    s = track.total;      // held at the end for a beat before it loops
  }
  const at = coasterAt(track, s);

  // --- rails --------------------------------------------------------------
  const gauge = Math.max(view.S(R * 0.055), 3);
  const rail = (offset, alpha, width) => {
    ctx.save();
    ctx.strokeStyle = PALETTE.rule; ctx.globalAlpha = alpha; ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < track.pts.length; i += 2) {
      const q = track.pts[i];
      const a = coasterAt(track, track.s[i]);
      const px = view.X(q.x) + -a.ty * offset;
      const py = view.Y(q.y) - a.tx * offset;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  };
  rail(0, 0.2, gauge * 3.2);
  rail(-gauge, 0.85, 1.4);
  rail(gauge, 0.85, 1.4);

  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.globalAlpha = 0.3; ctx.lineWidth = 1;
  const step = Math.max(track.total / 80, 0.2);
  for (let d = 0; d <= track.total; d += step) {
    const a = coasterAt(track, d);
    ctx.beginPath();
    ctx.moveTo(view.X(a.x) + -a.ty * gauge * 1.5, view.Y(a.y) - a.tx * gauge * 1.5);
    ctx.lineTo(view.X(a.x) - -a.ty * gauge * 1.5, view.Y(a.y) + a.tx * gauge * 1.5);
    ctx.stroke();
  }
  ctx.restore();

  drawGround(ctx, 0, view.Y(0) + gauge * 3, w);

  // release height and the 2.5R the loop demands
  [[height, PALETTE.brass, "release h"], [2.5 * R, PALETTE.crimson, "2.5R minimum"]].forEach(([yy, col, lab]) => {
    const gy = view.Y(yy);
    if (gy < 6 || gy > h - 6) return;
    ctx.save();
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    ctx.restore();
    drawLabel(ctx, w - 8, gy - 8, lab, col, 10, "right");
  });

  // --- the cart, wheels on the rails --------------------------------------
  const cw = Math.max(view.S(R * 0.42), 14);
  const ch = cw * 0.6;
  const wheelR = Math.max(cw * 0.13, 2.5);
  const cx = view.X(at.x), cy = view.Y(at.y);
  const ang = Math.atan2(-at.ty, at.tx);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillStyle = PALETTE.ink;
  [-cw * 0.3, cw * 0.3].forEach((dx) => {
    ctx.beginPath(); ctx.arc(dx, -wheelR, wheelR, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = PALETTE.navy;
  ctx.globalAlpha = 0.92;
  const by = -wheelR * 2 - ch;
  ctx.beginPath();
  ctx.moveTo(-cw / 2, by + ch);
  ctx.lineTo(-cw / 2 + ch * 0.25, by);
  ctx.lineTo(cw / 2 - ch * 0.15, by);
  ctx.lineTo(cw / 2, by + ch);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.restore();

  // --- forces, from the same state the cart is drawn at -------------------
  // Speed from energy, which is exact for a frictionless track and avoids
  // carrying a second integrated quantity that could drift out of step.
  const v2 = Math.max(2 * GRAVITY * (height - at.y), 0);
  const kappa = coasterCurvature(track, s);
  const mass = Number.isFinite(p.mass_loop) ? p.mass_loop : 200;
  const N = mass * (v2 * kappa + GRAVITY * Math.cos(at.slope));
  const scale = 40 / Math.max(mass * GRAVITY, 1);
  const ax = cx + -at.ty * wheelR * 2, ay = cy - at.tx * wheelR * 2;
  drawArrow(ctx, ax, ay, ax, ay + mass * GRAVITY * scale, PALETTE.navy, 1.8);
  if (N > 0) {
    drawArrow(ctx, ax, ay, ax + -at.ty * N * scale, ay - at.tx * N * scale, PALETTE.forest, 2);
  } else {
    drawLabel(ctx, cx, cy - 26, "N would be negative — it leaves the rails", PALETTE.crimson, 10);
  }

  drawZoomBar(ctx, w, h, view, "m");
  drawDataPlate(ctx, w - 178, 12, 166, [
    ["R", fmt(R) + " m"],
    ["h", fmt(height) + " m"],
    ["height now", fmt(at.y) + " m"],
    ["speed", fmt(Math.sqrt(v2)) + " m/s"],
    ["N", fmt(Math.max(N, 0)) + " N"],
    ["needs h >", fmt(2.5 * R) + " m"],
  ]);
};

RENDERERS["ballistic-pendulum"] = function (ctx, w, h, t, p) {
  const pivotX = w * 0.62, pivotY = h * 0.14;
  const len = h * 0.5;
  const thetaMax = 0.55;
  const restBobY = pivotY + len;
  const gunX = w * 0.06;

  const cycle = 4.2;
  const flightFrac = 0.28, flashFrac = 0.04, swingFrac = 0.5;
  const uAll = (t % cycle) / cycle;

  function thetaAt(u) {
    if (u < flightFrac + flashFrac) return 0;
    if (u < flightFrac + flashFrac + swingFrac) {
      const ul = (u - flightFrac - flashFrac) / swingFrac;
      return ul < 0.5
        ? thetaMax * Math.sin((Math.PI / 2) * (ul / 0.5))
        : thetaMax * Math.cos((Math.PI / 2) * ((ul - 0.5) / 0.5));
    }
    return 0;
  }

  let phaseLabel = "Bullet approaching";
  if (uAll >= flightFrac && uAll < flightFrac + flashFrac) phaseLabel = "Impact";
  else if (uAll < flightFrac + flashFrac + swingFrac && uAll >= flightFrac + flashFrac) {
    const ul = (uAll - flightFrac - flashFrac) / swingFrac;
    phaseLabel = ul < 0.5 ? "Swinging up" : "Swinging down";
  } else if (uAll >= flightFrac + flashFrac + swingFrac) phaseLabel = "Reset";

  const theta = thetaAt(uAll);
  const bobX = pivotX + len * Math.sin(theta);
  const bobY = pivotY + len * Math.cos(theta);

  // mounting bracket
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pivotX - 30, pivotY);
  ctx.lineTo(pivotX + 30, pivotY);
  ctx.stroke();
  for (let d = -26; d <= 26; d += 8) {
    ctx.beginPath();
    ctx.moveTo(pivotX + d, pivotY);
    ctx.lineTo(pivotX + d - 6, pivotY + 8);
    ctx.stroke();
  }

  drawAngleArc(ctx, pivotX, pivotY, 44, Math.PI / 2 - thetaMax, Math.PI / 2 + thetaMax, PALETTE.rule, "");

  // gun
  ctx.strokeStyle = PALETTE.ink;
  ctx.fillStyle = PALETTE.panel;
  ctx.lineWidth = 2;
  roundRect(ctx, gunX - 18, restBobY - 10, 26, 18, 3);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gunX + 8, restBobY - 2);
  ctx.lineTo(gunX + 34, restBobY - 2);
  ctx.lineWidth = 4;
  ctx.stroke();

  if (uAll < flightFrac) {
    const ul = uAll / flightFrac;
    const bulletX = lerp(gunX + 34, pivotX, ul);
    const trail = trailFromFn(t, 0.15, 6, (tt) => {
      const uu = (tt % cycle) / cycle;
      const ul2 = clamp(uu / flightFrac, 0, 1);
      return { x: lerp(gunX + 34, pivotX, ul2), y: restBobY };
    });
    drawTrail(ctx, trail, PALETTE.brass);
    ctx.fillStyle = PALETTE.crimson;
    ctx.beginPath();
    ctx.ellipse(bulletX, restBobY, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (uAll >= flightFrac && uAll < flightFrac + flashFrac) {
    const f = (uAll - flightFrac) / flashFrac;
    ctx.strokeStyle = PALETTE.brass;
    ctx.globalAlpha = 1 - f;
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2;
      const rr = 8 + f * 20;
      ctx.beginPath();
      ctx.moveTo(pivotX + Math.cos(ang) * rr * 0.4, restBobY + Math.sin(ang) * rr * 0.4);
      ctx.lineTo(pivotX + Math.cos(ang) * rr, restBobY + Math.sin(ang) * rr);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const trailBob = trailFromFn(t, 1.0, 14, (tt) => {
    const uu = (tt % cycle) / cycle;
    const th = thetaAt(uu);
    return { x: pivotX + len * Math.sin(th), y: pivotY + len * Math.cos(th) };
  });
  drawTrail(ctx, trailBob, PALETTE.navy);

  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(bobX, bobY);
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2);
  ctx.fill();

  drawShadow(ctx, bobX, pivotY + len + 16, 34, 0.08);
  drawHangingBlock(ctx, bobX, bobY, 34, PALETTE.navy);
  if (uAll >= flightFrac) {
    ctx.fillStyle = PALETTE.crimson;
    ctx.beginPath();
    ctx.arc(bobX, bobY, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawDataPlate(ctx, 10, 10, 155, [phaseLabel, `vc = ${fmt(p.v_common_bp)} m/s`, `h = ${fmt(p.h_bp, 3)} m`]);
  drawCaption(ctx, w / 2, h * 0.06, "Fig. — Ballistic Pendulum", PALETTE.inkSoft, 12);
};

/* ============================================================================
   Free-body diagrams
   ----------------------------------------------------------------------------
   Force labels follow the AP scoring conventions: Fg / FN / Ff / FT / Fa are
   accepted, whereas a bare "g" is explicitly not an acceptable label for the
   gravitational force. Every arrow is drawn from the body outward, and the
   arrow lengths are scaled relative to the largest force present so their
   relative sizes carry meaning.
   ========================================================================== */

// deg: 0 = right, 90 = up (screen y is flipped when drawing).
function force(label, deg, magnitude, color) {
  return { label, deg, magnitude: Math.abs(magnitude || 0), color };
}

function buildFreeBody(context, p) {
  const g = GRAVITY;
  // Arrow LENGTH is the diagram's argument, so a mass that falls through to 1
  // draws mg at a fifth of its true size beside a solver-sized normal force.
  // On a ramp that made the weight the shortest arrow on screen, directly
  // beneath a caption saying the normal force is the smaller of the two.
  const mass = p.mass ?? p.mass_dyn ?? p.mass_osc ?? p.mass_loop
    ?? p.mass_r ?? p.mass_e ?? p.mass_car ?? p.mass_phys ?? p.m1_cm ?? p.m1
    // Every new chapter brings its own mass key, and every one of them has to
    // be in this chain: a key that is missing falls through to 1 kg and draws
    // the weight arrow at the 26px floor beside a solver-sized normal force,
    // which is the one thing the arrow LENGTHS are supposed to mean.
    ?? p.mass_d ?? p.mass_bank ?? p.mass_sp ?? p.m_pp ?? p.m_ang
    ?? p.m_beam ?? p.m_load ?? p.m1_2d ?? p.m2_2d ?? p.m_boat ?? 1;
  const Fg = p.weight ?? mass * g;

  switch (context) {
    case "projectile":
      return {
        note: "Once it leaves the launcher, gravity is the only force acting. There is no forward force carrying it along.",
        bodies: [{ caption: "Projectile in flight", shape: "ball", forces: [force("Fg", 270, Fg, PALETTE.navy)] }],
      };

    case "gravitation":
      return {
        note: "Gravity is the only force on an orbiting body, and it points at the centre the whole way round. Nothing pushes it forward, and nothing pushes it outward.",
        bodies: [{
          caption: "Body in circular orbit", shape: "ball",
          forces: [force("Fg (toward the centre)", 180, p.F_grav ?? 10, PALETTE.crimson)],
        }],
      };

    case "ramp": {
      const th = (p.theta_ramp ?? 30) * Math.PI / 180;
      // Drawn in the ROTATED frame, because that is the frame the algebra
      // uses. N is perpendicular to the surface and equals mg*cos(theta) --
      // assuming N = mg on a slope is a standard lost mark.
      const deg = p.theta_ramp ?? 30;
      // Down-slope points right-and-down; up-slope is its opposite. The solver
      // takes Fa positive UP the slope, so the arrow has to as well -- drawn
      // down-slope it contradicted the equation printed beside it.
      const upSlope = 180 - deg;
      const downSlope = -deg;
      const list = [
        force("Fg", 270, Fg, PALETTE.navy),
        force("FN", 90 - deg, p.Fn_r ?? Fg * Math.cos(th), PALETTE.forest),
        // The decomposition IS the chapter. Showing an undecomposed weight on
        // the diagram a student copies onto the exam defeats the point.
        force("mg·sinθ (along)", downSlope, Fg * Math.sin(th), PALETTE.crimson),
        force("mg·cosθ (into)", 270 - deg, Fg * Math.cos(th), PALETTE.brass),
      ];
      const fk = p.Ff_r ?? p.Ff_static;
      // Friction opposes MOTION. Pinning it up-slope taught the misconception
      // that friction on a ramp always points uphill.
      const movingUp = (p.v0_r ?? 0) > 0 || (p.Fa_r ?? 0) > Fg * Math.sin(th);
      if (fk) list.push(force("f (opposes the motion)", movingUp ? downSlope : upSlope, fk, PALETTE.ink));
      if (p.Fa_r) list.push(force("Fa (up the slope)", upSlope, p.Fa_r, PALETTE.brass));
      return {
        note: "Resolve along and perpendicular to the SURFACE, not horizontally and vertically. The normal force balances only mg·cosθ, so N is smaller than the weight on every slope.",
        bodies: [{ caption: "Block on the slope", shape: "box", forces: list }],
      };
    }

    case "elevator": {
      const a = p.a_elev ?? 0;
      const N = p.Fn_e ?? mass * (g + a);
      return {
        note: a > 0
          ? "Accelerating upward, so N must exceed mg to produce the net upward force. The rider feels heavy — but their weight has not changed. This also covers a lift SLOWING on the way down, which is accelerating upward too."
          : a < 0
            ? "Accelerating downward, so N is less than mg. At a = −g the floor supplies nothing at all and the rider floats."
            : "No acceleration, so N and mg balance exactly and the scale reads the true weight. Moving is not the same as accelerating.",
        bodies: [{
          caption: "Rider on the scale", shape: "box",
          forces: [force("FN (what the scale reads)", 90, N, PALETTE.forest),
                   force("Fg = mg", 270, Fg, PALETTE.navy)],
        }],
      };
    }

    case "roundabout": {
      const bank = p.theta_bank ?? 0;
      const aT = p.a_tangential ?? 0;
      const ac = (Number.isFinite(p.v_car) && p.r_track) ? (p.v_car * p.v_car) / p.r_track : null;
      const list = [
        // On a bank the normal force tilts with the surface, and grows.
        force("FN", 90 - bank, p.Fn_car ?? (bank ? Fg / Math.cos(bank * Math.PI / 180) : Fg), PALETTE.forest),
        force("Fg", 270, Fg, PALETTE.navy),
      ];
      if (ac !== null) list.push(force("f inward (= mv²/r)", 180, mass * ac, PALETTE.crimson));
      // Friction is only purely inward when the driver is holding a steady
      // speed. Accelerating adds a tangential component -- that is the whole
      // friction circle, and drawing one arrow hides it.
      if (aT) list.push(force("f along the track (= ma_t)", 90, mass * Math.abs(aT), PALETTE.brass));
      return {
        note: aT
          ? "Friction is doing two jobs at once: turning the board inward and changing its speed along the track. The two are perpendicular, so the tyres must supply their vector sum — and they let go when it exceeds μₛg."
          : "Friction is the ONLY horizontal force, and it points inward — toward the centre of the circle. There is no outward force on the board; what feels like one is the board turning under you while you continue straight.",
        bodies: [{ caption: "Skateboard on the curve", shape: "box", forces: list }],
      };
    }

    // ---- C-2: the centre of mass has no surface under it ----
    case "com":
      return {
        note: "There is no surface here and no single body. Internal forces come in third-law pairs that cancel exactly, so they cannot shift the centre of mass however violent they are. Only a net EXTERNAL force accelerates it — which is why an exploding shell's fragments scatter while their centre of mass carries on along the original parabola.",
        bodies: [{
          caption: "The system as a whole", shape: "ball",
          forces: [force("F_ext (the only force that matters)", 270, p.F_ext_cm ?? Fg, PALETTE.crimson)],
        }],
      };

    case "blockstack": {
      const mTop = p.m_top ?? 2;
      // Nothing touches the top block except the block beneath it, so the ONLY
      // horizontal force on it is friction -- and it points FORWARD. Students
      // arrive expecting friction to oppose motion; here it causes it.
      return {
        note: "Isolate the TOP block. Nothing touches it except the block underneath, so friction is the only horizontal force on it — and it points forward, in the direction of motion. Friction is what accelerates the top block, not what slows it. The pair separates the moment the friction it needs exceeds μₛ·m_top·g.",
        bodies: [{
          caption: "The top block alone", shape: "box",
          forces: [
            force("FN (from the block below)", 90, mTop * g, PALETTE.forest),
            force("Fg", 270, mTop * g, PALETTE.navy),
            force("f (forward — this drives it)", 0, p.f_on_top ?? mTop * 2, PALETTE.crimson),
          ],
        }],
      };
    }

    case "orbital":
      return {
        note: "One force, and it points at the focus the whole way round. There is no forward force carrying the body along its path, and no outward force balancing gravity — if anything balanced it the body would travel in a straight line. The velocity arrow is not a force.",
        bodies: [{
          caption: "Satellite anywhere on its orbit", shape: "ball",
          forces: [force("Fg = GMm/r² (toward the focus)", 180, p.F_grav ?? 10, PALETTE.crimson)],
        }],
      };

    case "forces": {
      const list = [force("Fg", 270, Fg, PALETTE.navy)];
      if (p.Fn !== undefined && p.Fn !== 0) list.push(force("FN", 90, p.Fn, PALETTE.brass));
      if (p.Fa) list.push(force("Fa", 0, p.Fa, PALETTE.crimson));
      if (p.Ff) list.push(force("Ff", 180, p.Ff, PALETTE.forest));
      return { note: "Resolve along x and y, then apply ΣF = ma to each axis separately.", bodies: [{ caption: "The block", shape: "box", forces: list }] };
    }

    case "atwood":
    case "atwood_flywheel": {
      const T1 = p.T1 ?? p.T ?? 0, T2 = p.T2 ?? p.T ?? 0;
      const w1 = (p.m1 ?? 1) * g, w2 = (p.m2 ?? 1) * g;
      return {
        note: context === "atwood_flywheel"
          ? "With a massive pulley the two tensions differ — that difference is what supplies the net torque."
          : "A massless pulley means one tension throughout the string.",
        bodies: [
          { caption: "m₁ (rising)", shape: "box", forces: [force("FT", 90, T1 || w1, PALETTE.brass), force("Fg", 270, w1, PALETTE.navy)] },
          { caption: "m₂ (falling)", shape: "box", forces: [force("FT", 90, T2 || w2, PALETTE.brass), force("Fg", 270, w2, PALETTE.navy)] },
        ],
      };
    }

    case "rolling_race": {
      const th = ((p.theta_roll ?? 0.5) * 180) / Math.PI;
      return {
        note: "Friction at the contact point supplies the torque that makes it roll — but it does no work, because that point is momentarily at rest.",
        bodies: [{
          caption: `On the incline (θ ≈ ${th.toFixed(0)}°)`, shape: "ball",
          forces: [
            force("Fg", 270, Fg, PALETTE.navy),
            force("FN", 90 + th, Fg * Math.cos((th * Math.PI) / 180), PALETTE.brass),
            force("fs", 180 + th, Fg * Math.sin((th * Math.PI) / 180) * 0.5, PALETTE.forest),
          ],
        }],
      };
    }

    case "loop_coaster": {
      const m = p.mass_loop ?? 1;
      return {
        note: "At the top both forces point the same way — downward, toward the centre. That is why the minimum speed condition is FN = 0.",
        bodies: [
          { caption: "At the top of the loop", shape: "cart", forces: [force("Fg", 270, m * g, PALETTE.navy), force("FN", 270, p.N_top ?? m * g, PALETTE.brass)] },
          { caption: "At the bottom of the loop", shape: "cart", forces: [force("FN", 90, p.N_bottom ?? m * g * 3, PALETTE.brass), force("Fg", 270, m * g, PALETTE.navy)] },
        ],
      };
    }

    case "ballistic_pendulum": {
      const m = (p.m1_bp ?? 0) + (p.m2_bp ?? 1);
      return {
        note: "During the impact the impulse is enormous and brief, so momentum is conserved. Only afterwards does energy analysis take over for the swing.",
        bodies: [{ caption: "Block + embedded bullet", shape: "box", forces: [force("FT", 90, m * g, PALETTE.brass), force("Fg", 270, m * g, PALETTE.navy)] }],
      };
    }

    case "osc_spring":
    case "osc_general": {
      const k = p.k_osc ?? p.k ?? 50, A = p.A ?? 0.1;
      return {
        note: "The spring force always points back toward equilibrium. That restoring behaviour, F = −kx, is what makes the motion harmonic.",
        bodies: [{ caption: "Mass on the spring", shape: "box", forces: [force("Fs = −kx", 90, k * A, PALETTE.crimson), force("Fg", 270, Fg, PALETTE.navy)] }],
      };
    }

    case "osc_pendulum":
      return {
        note: "Only the component of gravity along the arc restores the bob. The radial component is balanced by the tension.",
        bodies: [{ caption: "Pendulum bob", shape: "ball", forces: [force("FT", 105, Fg, PALETTE.brass), force("Fg", 270, Fg, PALETTE.navy)] }],
      };

    case "rotDynamics":
      return {
        note: "Centripetal force is the net inward force, not an extra one to add on top of the others.",
        bodies: [{
          caption: "Rotating mass", shape: "ball",
          forces: [
            force("Fc (net, inward)", 180, p.F_cent ?? 10, PALETTE.crimson),
            force("Ft (tangential)", 90, p.F_tang ?? 5, PALETTE.navy),
          ],
        }],
      };

    case "work_grav":
    case "energy":
      return {
        note: "Gravity does negative work going up and positive work coming down; the normal force does none at all.",
        bodies: [{ caption: "The object", shape: "ball", forces: [force("Fg", 270, Fg, PALETTE.navy), force("FN", 90, Fg, PALETTE.brass)] }],
      };

    /* ---- the 2026 chapters ------------------------------------------------
       Two cases below share a switch body, and each of them chooses its own
       note from `context`. A shared note is worse than no note: the quadratic
       chapter reading "v_term = mg/b" is a wrong answer printed in the app's
       own voice. */

    case "drag_linear":
    case "drag_quadratic": {
      const quadratic = context === "drag_quadratic";
      const vNow = p.v_drag, vT = p.v_term;
      // The first panel is the reader's own instant when they gave one, so the
      // drag arrow there is their number rather than a decorative stub.
      let ratio = 0.28;
      if (Number.isFinite(vNow) && Number.isFinite(vT) && vT > 0) {
        const rr = clamp(Math.abs(vNow) / vT, 0, 1);
        ratio = quadratic ? rr * rr : rr;
      }
      const Fd = p.Fd_drag ?? Fg * ratio;
      return {
        note: quadratic
          ? "Quadratic drag goes as the SQUARE of the speed, so doubling the speed quadruples the retarding force — which is why v_term = √(mg/c) and not mg/c. Terminal speed is still an asymptote: the arrows close on each other and never quite meet."
          : "This free body CHANGES as the fall goes on, which is what makes the chapter hard. mg never moves; the drag arrow climbs into it. At terminal speed the two are exactly equal and opposite and the acceleration is zero — the body is still moving, it has simply stopped speeding up. Since v(t) = v_term(1 − e^(−t/τ)) it never actually gets there; quote the 95% time t = τ·ln20 instead.",
        bodies: [
          {
            caption: Number.isFinite(vNow) ? "At v = " + fmt(vNow, 1) + " m/s" : "Shortly after release",
            shape: "ball",
            forces: [force("Fg = mg", 270, Fg, PALETTE.navy),
                     force(quadratic ? "F_d = cv²" : "F_d = bv", 90, Fd, PALETTE.crimson)],
          },
          {
            caption: "At terminal speed",
            shape: "ball",
            forces: [force("Fg = mg", 270, Fg, PALETTE.navy),
                     force("F_d = mg exactly", 90, Fg, PALETTE.crimson)],
          },
        ],
      };
    }

    case "collision2d_inelastic":
    case "collision2d_general": {
      const sticks = context === "collision2d_inelastic";
      const ma = p.m1_2d ?? 1, mb = p.m2_2d ?? 1;
      // ONE magnitude for both bodies, because a third-law pair IS one
      // magnitude. Weight and the normal force are left off on purpose: the
      // plane is horizontal so they cancel, and including them would set a
      // different per-body maximum and draw the pair at two different lengths.
      const Fc = ((ma * mb) / Math.max(ma + mb, 1e-9))
        * Math.max(Math.abs(p.v1i_2d ?? 4) + Math.abs(p.v2i_2d ?? 0), 1) * 8;
      const shared = "The plane is horizontal, so gravity and the normal force cancel and take no part. During the impact the only forces are the two the pucks put on each other, and they are equal and opposite — that pair is exactly why the total momentum cannot change. ";
      return {
        note: shared + (sticks
          ? "They leave as one body, so momentum survives and kinetic energy does not: the difference went into deforming them. Solve px and py separately, then vf = √(px²+py²)/(m₁+m₂)."
          : "Conserve px and py as two separate equations. There is no conservation law for the magnitude of p, and adding the speeds instead of the components is the commonest way to lose this question."),
        bodies: [
          { caption: "m₁ during contact", shape: "ball", forces: [force("F on m₁ from m₂", 180, Fc, PALETTE.crimson)] },
          { caption: "m₂ during contact", shape: "ball", forces: [force("F on m₂ from m₁ (equal, opposite)", 0, Fc, PALETTE.crimson)] },
        ],
      };
    }

    case "angmomentum": {
      const Fa2 = p.F_ang ?? 10;
      const thF2 = p.theta_F ?? 90;
      return {
        note: "Left: a mass on a straight line with no force on it whatsoever — and an angular momentum about O that is constant and not zero. L does not require anything to be rotating; it requires a lever arm, r·sinθ, and that length does not change as the mass goes past. Right: only the part of F perpendicular to r turns anything, which is all τ = rF·sinθ says. A force aimed straight at the axle has no torque however hard you push it. Applied for Δt it delivers ΔL = τΔt.",
        bodies: [
          { caption: "Point mass passing O — no forces at all", shape: "ball", forces: [] },
          {
            caption: "Body being spun up by F", shape: "ball",
            forces: [
              force("F, at θ to r", thF2, Fa2, PALETTE.crimson),
              force("F·sinθ — the part that turns it", 90, Fa2 * Math.abs(Math.sin(thF2 * Math.PI / 180)), PALETTE.brass),
            ],
          },
        ],
      };
    }

    case "statics": {
      const Lb = p.L_beam ?? 4;
      const xl = p.x_load ?? Lb * 0.28;
      const Wbeam = (p.m_beam ?? 12) * g;
      const Wload = (p.m_load ?? 30) * g;
      const Rr = (Wbeam * (Lb / 2) + Wload * xl) / Math.max(Lb, 1e-9);
      // The two reactions and the two weights are nudged a few degrees apart.
      // Drawn on the exact axis they land on top of one another and the diagram
      // shows two arrows where there are four.
      return {
        note: "ΣF = 0 is only half of it, and this diagram deliberately throws the other half away: every arrow is drawn from one point, so the POINTS OF APPLICATION are gone and Στ = 0 cannot be read off it. Use the scene tab for the beam with each force where it actually acts, then take torques about whichever point kills the term you know least about — the pivot is your choice, not a fact about the beam.",
        bodies: [{
          caption: "The beam — force balance only",
          shape: "box",
          forces: [
            force("F_left", 96, p.F_left ?? (Wbeam + Wload - Rr), PALETTE.forest),
            force("F_right", 84, p.F_right ?? Rr, PALETTE.forest),
            force("m_beam·g (acts at L/2)", 264, Wbeam, PALETTE.navy),
            force("m_load·g (acts at x_load)", 276, Wload, PALETTE.crimson),
          ],
        }],
      };
    }

    case "relvel": {
      const thHead = p.theta_head ?? 0;
      const push = (p.v_boat ?? 4) * 10;
      return {
        note: "The current is NOT a force on the boat. In the water's own frame the boat simply travels along its heading at v_boat; the ground frame adds the water's velocity on top, which is how the boat ends up downstream with nothing pushing it downstream. Gravity and buoyancy cancel vertically and are left off. The boat is at constant velocity, so the forces that remain cancel too — the interesting vector sum in this chapter is a sum of VELOCITIES, and velocities are not forces.",
        bodies: [{
          caption: "Boat crossing at constant velocity",
          shape: "box",
          forces: [
            force("thrust, along the heading", 90 + thHead, push, PALETTE.crimson),
            force("water resistance", 270 + thHead, push, PALETTE.forest),
          ],
        }],
      };
    }

    case "banked": {
      const thb = p.theta_bank_b ?? 18;
      const thbR = thb * Math.PI / 180;
      const Nb = p.Fn_bank ?? Fg / Math.max(Math.cos(thbR), 1e-6);
      // Centre of the curve to the LEFT, road rising to the right, matching the
      // cross-section on the scene tab so the two figures agree.
      const list = [
        force("FN — perpendicular to the ROAD", 90 + thb, Nb, PALETTE.forest),
        force("Fg = mg", 270, Fg, PALETTE.navy),
        force("N·cosθ = mg", 90, Nb * Math.cos(thbR), PALETTE.brass),
        force("N·sinθ = mv²/R", 180, Nb * Math.sin(thbR), PALETTE.crimson),
      ];
      if (p.mu_bank) {
        const vIdeal = Math.sqrt(Math.max(g * (p.r_bank ?? 45) * Math.tan(thbR), 0));
        const tooFast = (p.v_bank ?? vIdeal) > vIdeal;
        list.push(force(tooFast ? "f, down the bank (too fast)" : "f, up the bank (too slow)",
          tooFast ? 180 + thb : thb, p.mu_bank * Nb, PALETTE.ink));
      }
      return {
        note: "FN is perpendicular to the ROAD, not to the ground, and on a bank it is BIGGER than mg — its vertical component alone has to carry the weight. Its horizontal component is the entire centripetal force; there is no outward force to balance. And the mass cancels out of the speed completely, which is why m is in the question at all.",
        bodies: [{ caption: "Skateboard on the bank, seen head-on", shape: "box", forces: list }],
      };
    }

    case "springs_combo": {
      const ka = p.k1_sp ?? 40, kb = p.k2_sp ?? 60;
      const kSeries = (ka * kb) / Math.max(ka + kb, 1e-9);
      const kPar = ka + kb;
      /* The extension has to be the reader's own, and it has to be the
         extension of the arrangement being drawn. A hardcoded 0.1 m drew a
         spring force of 20 N against an 11.8 N weight on the series panel and
         90 N on the parallel one -- up to 7.7x too long, beside a body that is
         in equilibrium and must therefore show them equal. Falling back to
         mg/k rather than to a fixed length keeps that equilibrium true
         whatever the reader supplied. */
      const xUser = Number.isFinite(p.x_sp) && p.x_sp > 0 ? p.x_sp : null;
      const xS = xUser ?? Fg / Math.max(kSeries, 1e-9);
      const xP = xUser ?? Fg / Math.max(kPar, 1e-9);
      return {
        note: "In SERIES only one spring is in contact with the mass, and the same force runs through both of them — so the two extensions add and the pair comes out SOFTER than either spring on its own: 1/k_eq = 1/k₁ + 1/k₂, and a LONGER period. In PARALLEL both springs touch the mass at the same extension, so their forces add: k_eq = k₁ + k₂, stiffer, shorter period. Nearly everyone predicts these the wrong way round the first time.",
        bodies: [
          {
            caption: "Series — one spring touches the mass", shape: "box",
            forces: [force("F = k_eq·x, through both", 90, kSeries * xS, PALETTE.crimson),
                     force("Fg", 270, Fg, PALETTE.navy)],
          },
          {
            caption: "Parallel — both springs touch it", shape: "box",
            forces: [force("F₁ = k₁x", 96, ka * xP, PALETTE.crimson),
                     force("F₂ = k₂x", 84, kb * xP, PALETTE.forest),
                     force("Fg", 270, Fg, PALETTE.navy)],
          },
        ],
      };
    }

    case "physical_pendulum": {
      const Lpp = p.L_stick_pp ?? 1.2;
      const dpp = p.d_pp ?? 0.35 * Lpp;
      const Wpp = (p.m_pp ?? mass) * g;
      const drawnAngle = 15;
      return {
        note: "The weight acts at the centre of mass, a distance d = " + fmt(dpp, 3)
          + " m from the hole, and that distance is the whole lever arm: τ = −mgd·sinθ. The pivot force has no lever arm about the pivot, so it contributes no torque at all — it is what stops the stick falling, not what swings it. T = 2π√(I_pivot/mgd), and it is the stick's own I = m(L²/12 + d²) that makes T = 2π√(d/g) not merely imprecise here but wrong by tens of percent — the scene tab prints the error for this particular d.",
        bodies: [{
          caption: "Uniform stick, pivoted off centre",
          shape: "box",
          forces: [
            force("Fg = mg, at the centre of mass", 270, Wpp, PALETTE.navy),
            force("F_pivot (no torque about the pivot)", 90, Wpp, PALETTE.brass),
            force("mg·sinθ — the only part with torque", 180, Wpp * Math.sin(drawnAngle * Math.PI / 180), PALETTE.crimson),
          ],
        }],
      };
    }

    default: {
      const list = [force("Fg", 270, Fg, PALETTE.navy), force("FN", 90, Fg, PALETTE.brass)];
      if (p.Fa) list.push(force("Fa", 0, p.Fa, PALETTE.crimson));
      if (p.Ff) list.push(force("Ff", 180, p.Ff, PALETTE.forest));
      return { note: "Isolate the object, draw every force acting on it, then resolve along your chosen axes.", bodies: [{ caption: "The object", shape: "box", forces: list }] };
    }
  }
}

function drawBodyGlyph(ctx, cx, cy, shape) {
  if (shape === "ball") { sphereShade(ctx, cx, cy, 17, PALETTE.ink); return; }
  if (shape === "cart") {
    ctx.fillStyle = PALETTE.panel;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 2;
    roundRect(ctx, cx - 20, cy - 11, 40, 22, 4);
    ctx.fill(); ctx.stroke();
    return;
  }
  drawHangingBlock(ctx, cx, cy, 34, PALETTE.ink);
}

function renderFreeBody(ctx, w, h, t, p) {
  const spec = buildFreeBody(p._context, p);
  const n = spec.bodies.length;
  const colW = w / n;
  // Gentle pulse so the arrows read as live rather than a static image.
  const pulse = 1 + Math.sin(t * 2) * 0.03;

  drawCaption(ctx, w / 2, h * 0.08, "Free-Body Diagram", PALETTE.inkSoft, 12);

  spec.bodies.forEach((body, i) => {
    const cx = colW * (i + 0.5);
    const cy = h * 0.47;

    if (n > 1 && i > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = PALETTE.rule;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(colW * i, h * 0.16);
      ctx.lineTo(colW * i, h * 0.82);
      ctx.stroke();
      ctx.restore();
    }

    // dashed axes through the body, so students see the resolution frame
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawDashedLine(ctx, cx - 78, cy, cx + 78, cy, PALETTE.rule, 1, [2, 4]);
    drawDashedLine(ctx, cx, cy - 74, cx, cy + 74, PALETTE.rule, 1, [2, 4]);
    ctx.restore();

    const maxMag = Math.max(...body.forces.map((f) => f.magnitude), 1e-6);
    body.forces.forEach((f) => {
      const rad = (f.deg * Math.PI) / 180;
      const len = (26 + 44 * (f.magnitude / maxMag)) * pulse;
      const ux = Math.cos(rad), uy = -Math.sin(rad);
      const x2 = cx + ux * len, y2 = cy + uy * len;
      drawArrow(ctx, cx, cy, x2, y2, f.color, 2.4);
      const lx = cx + ux * (len + 20), ly = cy + uy * (len + 14);
      drawLabel(ctx, lx, ly, f.label, f.color, 11.5);
    });

    drawBodyGlyph(ctx, cx, cy, body.shape);
    drawCaption(ctx, cx, h * 0.86, body.caption, PALETTE.inkSoft, 11);
  });

  if (spec.note) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.font = `400 11px ${FONT_LABEL}`;
    wrapText(ctx, spec.note, w / 2, h * 0.94, w * 0.86, 14);
    ctx.restore();
  }
}

function wrapText(ctx, text, cx, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (ctx.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}

/* ============================================================================
   Motion graphs
   ----------------------------------------------------------------------------
   Axes are labelled with units and drawn on a linear scale, which is what the
   scoring guidelines require of a student-drawn graph. The x-t panel carries a
   live tangent line (slope = v) and the v-t panel shades the area swept so far
   (area = displacement), because those two readings are the ones the exam
   actually asks about.
   ========================================================================== */

function buildGraphs(context, p) {
  const g = GRAVITY;
  if (context === "projectile") {
    const v0 = p.v0_p ?? 20;
    const th = ((p.theta_p ?? 45) * Math.PI) / 180;
    const v0y = p.v0y ?? v0 * Math.sin(th);
    const tMax = Math.max((2 * v0y) / g, 0.4);
    return {
      tMax,
      series: [
        { label: "y", unit: "m", color: PALETTE.navy, fn: (t) => v0y * t - 0.5 * g * t * t, annotate: "tangent" },
        { label: "v_y", unit: "m/s", color: PALETTE.crimson, fn: (t) => v0y - g * t, annotate: "area" },
        { label: "a_y", unit: "m/s²", color: PALETTE.brass, fn: () => -g },
      ],
    };
  }
  if (context === "osc_spring" || context === "osc_general" || context === "calc_oscillations") {
    const A = p.A ?? p.A_calc ?? 0.1;
    const om = Math.abs(p.omega_osc ?? p.omega_calc ?? 2) || 2;
    const ph = p.phi ?? p.phi_calc ?? 0;
    return {
      tMax: (2 * Math.PI) / om, // exactly one period
      series: [
        { label: "x", unit: "m", color: PALETTE.navy, fn: (t) => A * Math.cos(om * t + ph), annotate: "tangent" },
        { label: "v", unit: "m/s", color: PALETTE.crimson, fn: (t) => -A * om * Math.sin(om * t + ph), annotate: "area" },
        { label: "a", unit: "m/s²", color: PALETTE.brass, fn: (t) => -A * om * om * Math.cos(om * t + ph) },
      ],
    };
  }
  if (context === "rotKinematics") {
    const w0 = p.omega_i ?? p.omega ?? 2, al = p.alpha ?? 1;
    const tMax = Math.max(p.t ?? 4, 0.4);
    return {
      tMax,
      series: [
        { label: "θ", unit: "rad", color: PALETTE.navy, fn: (t) => w0 * t + 0.5 * al * t * t, annotate: "tangent" },
        { label: "ω", unit: "rad/s", color: PALETTE.crimson, fn: (t) => w0 + al * t, annotate: "area" },
        { label: "α", unit: "rad/s²", color: PALETTE.brass, fn: () => al },
      ],
    };
  }
  // default: straight-line kinematics
  const x0 = p.x0 ?? 0;
  const v0 = p.v0 ?? p.vi ?? p.v ?? 2;
  const a = p.a_const ?? p.a ?? 0;
  const tMax = Math.max(p.t ?? p.t_calc ?? 4, 0.4);
  return {
    tMax,
    series: [
      { label: "x", unit: "m", color: PALETTE.navy, fn: (t) => x0 + v0 * t + 0.5 * a * t * t, annotate: "tangent" },
      { label: "v", unit: "m/s", color: PALETTE.crimson, fn: (t) => v0 + a * t, annotate: "area" },
      { label: "a", unit: "m/s²", color: PALETTE.brass, fn: () => a },
    ],
  };
}

function renderMotionGraphs(ctx, w, h, t, p) {
  const spec = buildGraphs(p._context, p);
  const cycle = spec.tMax * 1.35;
  const cursorT = clamp(t % cycle, 0, spec.tMax);

  const topPad = h * 0.1;
  const panelH = (h - topPad - h * 0.06) / spec.series.length;

  drawCaption(ctx, w / 2, h * 0.05, "Motion Graphs", PALETTE.inkSoft, 12);

  spec.series.forEach((series, i) => {
    const top = topPad + i * panelH;
    const bottom = top + panelH - 16;
    const left = w * 0.13, right = w * 0.96;

    // sample to find the vertical range, then pad it a little
    let lo = Infinity, hi = -Infinity;
    for (let s = 0; s <= 60; s++) {
      const val = series.fn((s / 60) * spec.tMax);
      lo = Math.min(lo, val); hi = Math.max(hi, val);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = -1; hi = 1; }
    if (Math.abs(hi - lo) < 1e-9) { hi = lo + 1; lo -= 1; }
    const span = hi - lo;
    lo -= span * 0.12; hi += span * 0.12;

    const X = (tt) => left + (tt / spec.tMax) * (right - left);
    const Y = (val) => bottom - ((val - lo) / (hi - lo)) * (bottom - top);

    // axes
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom);
    ctx.stroke();

    // zero line, if the range straddles it
    if (lo < 0 && hi > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      drawDashedLine(ctx, left, Y(0), right, Y(0), PALETTE.rule, 1, [2, 4]);
      ctx.restore();
    }

    // ticks with numeric labels — a linear, labelled scale
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = PALETTE.rule;
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const tx = X((k / 4) * spec.tMax);
      ctx.beginPath(); ctx.moveTo(tx, bottom); ctx.lineTo(tx, bottom + 4); ctx.stroke();
      if (i === spec.series.length - 1) {
        drawCaption(ctx, tx, bottom + 12, ((k / 4) * spec.tMax).toFixed(1), PALETTE.inkSoft, 9);
      }
    }
    ctx.restore();
    drawLabel(ctx, left - 8, Y(hi) + 6, hi.toFixed(1), PALETTE.inkSoft, 9, "right");
    drawLabel(ctx, left - 8, Y(lo) - 6, lo.toFixed(1), PALETTE.inkSoft, 9, "right");

    // shaded area under v-t up to the cursor: this equals displacement
    if (series.annotate === "area" && cursorT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = series.color;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      for (let s = 0; s <= 50; s++) {
        const tt = (s / 50) * cursorT;
        ctx.lineTo(X(tt), Y(series.fn(tt)));
      }
      ctx.lineTo(X(cursorT), Y(0));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // the curve
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let s = 0; s <= 90; s++) {
      const tt = (s / 90) * spec.tMax;
      const px = X(tt), py = Y(series.fn(tt));
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // tangent at the cursor on the position graph: its slope is the velocity
    const cy = Y(series.fn(cursorT)), cxp = X(cursorT);
    if (series.annotate === "tangent") {
      const dt = spec.tMax / 200;
      const slope = (series.fn(cursorT + dt) - series.fn(cursorT - dt)) / (2 * dt);
      const dx = (right - left) * 0.13;
      const dtGraph = (dx / (right - left)) * spec.tMax;
      ctx.save();
      ctx.strokeStyle = PALETTE.brass;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cxp - dx, Y(series.fn(cursorT) - slope * dtGraph));
      ctx.lineTo(cxp + dx, Y(series.fn(cursorT) + slope * dtGraph));
      ctx.stroke();
      ctx.restore();
      drawCaption(ctx, cxp + dx + 30, cy - 10, `slope = ${slope.toFixed(1)}`, PALETTE.brass, 9.5);
    }

    ctx.fillStyle = series.color;
    ctx.beginPath();
    ctx.arc(cxp, cy, 3.6, 0, Math.PI * 2);
    ctx.fill();

    drawLabel(ctx, left + 4, top + 8, `${series.label} (${series.unit})`, series.color, 11, "left");
    if (i === spec.series.length - 1) drawCaption(ctx, (left + right) / 2, bottom + 24, "t (s)", PALETTE.inkSoft, 10);
  });
}

/* ============================================================================
   Moment-of-inertia figures
   ----------------------------------------------------------------------------
   Each drawing shows the body, the axis it turns about, and — crucially — the
   mass element the derivation integrates over, highlighted and labelled. The
   choice of element is the part students find hard, so it is drawn rather
   than described.
   ========================================================================== */

const INERTIA_FIGURES = {};

function axisLine(ctx, x1, y1, x2, y2, label) {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = PALETTE.crimson;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
  if (label) drawCaption(ctx, (x1 + x2) / 2 + 22, y1 + 10, label, PALETTE.crimson, 10);
}

INERTIA_FIGURES["rod-center"] = (ctx, w, h) => {
  const cy = h * 0.55, half = w * 0.34;
  ctx.strokeStyle = PALETTE.ink; ctx.fillStyle = PALETTE.panel; ctx.lineWidth = 2;
  roundRect(ctx, w / 2 - half, cy - 7, half * 2, 14, 3); ctx.fill(); ctx.stroke();
  axisLine(ctx, w / 2, cy - h * 0.34, w / 2, cy + h * 0.34, "axis");
  const ex = w / 2 + half * 0.52;
  ctx.fillStyle = PALETTE.brass; ctx.globalAlpha = 0.75;
  ctx.fillRect(ex - 5, cy - 7, 10, 14); ctx.globalAlpha = 1;
  drawCaption(ctx, ex, cy - 20, "dm", PALETTE.brass, 10);
  drawDashedLine(ctx, w / 2, cy + 18, ex, cy + 18, PALETTE.rule, 1, [2, 3]);
  drawCaption(ctx, (w / 2 + ex) / 2, cy + 29, "x", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["rod-end"] = (ctx, w, h) => {
  const cy = h * 0.55, x0 = w * 0.18, len = w * 0.62;
  ctx.strokeStyle = PALETTE.ink; ctx.fillStyle = PALETTE.panel; ctx.lineWidth = 2;
  roundRect(ctx, x0, cy - 7, len, 14, 3); ctx.fill(); ctx.stroke();
  axisLine(ctx, x0, cy - h * 0.34, x0, cy + h * 0.34, "axis");
  const ex = x0 + len * 0.62;
  ctx.fillStyle = PALETTE.brass; ctx.globalAlpha = 0.75;
  ctx.fillRect(ex - 5, cy - 7, 10, 14); ctx.globalAlpha = 1;
  drawCaption(ctx, ex, cy - 20, "dm", PALETTE.brass, 10);
  drawDashedLine(ctx, x0, cy + 18, ex, cy + 18, PALETTE.rule, 1, [2, 3]);
  drawCaption(ctx, (x0 + ex) / 2, cy + 29, "x", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["hoop"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.56, R = Math.min(w, h) * 0.3;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
  axisLine(ctx, cx, cy - h * 0.44, cx, cy + h * 0.4, "axis");
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath(); ctx.arc(cx + R * 0.86, cy - R * 0.2, 5, 0, Math.PI * 2); ctx.fill();
  drawCaption(ctx, cx + R * 0.86 + 14, cy - R * 0.2 - 12, "dm", PALETTE.brass, 10);
  drawDashedLine(ctx, cx, cy, cx + R * 0.86, cy - R * 0.2, PALETTE.rule, 1, [2, 3]);
  drawCaption(ctx, cx + R * 0.42, cy - 4, "R", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["hoop-diameter"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.55, R = Math.min(w, h) * 0.3;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  axisLine(ctx, cx - R * 1.4, cy, cx + R * 1.4, cy, "axis (a diameter)");
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath(); ctx.arc(cx + R * 0.6, cy - R * 0.8, 5, 0, Math.PI * 2); ctx.fill();
  drawCaption(ctx, cx + R * 0.6 + 16, cy - R * 0.8 - 10, "dm", PALETTE.brass, 10);
};

INERTIA_FIGURES["disk"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.56, R = Math.min(w, h) * 0.3;
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // the ring element the integral sweeps
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 6; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.62, R * 0.62 * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  axisLine(ctx, cx, cy - h * 0.44, cx, cy + h * 0.4, "axis");
  drawCaption(ctx, cx + R * 0.62 + 22, cy - 14, "ring dm", PALETTE.brass, 10);
  drawDashedLine(ctx, cx, cy, cx + R * 0.62, cy, PALETTE.rule, 1, [2, 3]);
  drawCaption(ctx, cx + R * 0.3, cy + 12, "r", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["annulus"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.56, R = Math.min(w, h) * 0.3;
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = PALETTE.stage || PALETTE.paper;
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.52, R * 0.52 * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 5; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.78, R * 0.78 * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  axisLine(ctx, cx, cy - h * 0.44, cx, cy + h * 0.4, "axis");
  drawCaption(ctx, cx, cy + h * 0.3, "R₁ inner · R₂ outer", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["sphere"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.55, R = Math.min(w, h) * 0.3;
  sphereShade(ctx, cx, cy, R, PALETTE.ink);
  // the disk slice the derivation reuses
  const z = -R * 0.42, rSlice = Math.sqrt(R * R - z * z);
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.ellipse(cx, cy + z, rSlice, rSlice * 0.24, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  axisLine(ctx, cx, cy - h * 0.44, cx, cy + h * 0.44, "axis");
  drawCaption(ctx, cx + rSlice + 26, cy + z, "disk slice", PALETTE.brass, 10);
  drawDashedLine(ctx, cx + 4, cy, cx + 4, cy + z, PALETTE.rule, 1, [2, 3]);
  drawCaption(ctx, cx + 18, cy + z / 2, "z", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["shell"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.55, R = Math.min(w, h) * 0.3;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const rr = R * (i / 4);
    ctx.beginPath(); ctx.ellipse(cx, cy, R, rr, 0, 0, Math.PI * 2); ctx.stroke();
  }
  const th = Math.PI * 0.34;
  const ry = R * Math.cos(th), rx = R * Math.sin(th);
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 4; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.ellipse(cx, cy - ry, rx, rx * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  axisLine(ctx, cx, cy - h * 0.44, cx, cy + h * 0.44, "axis");
  drawCaption(ctx, cx + rx + 30, cy - ry, "ring at θ", PALETTE.brass, 10);
};

INERTIA_FIGURES["plate"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.56;
  const a = Math.min(w * 0.3, 120), b = Math.min(h * 0.24, 70);
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - a, cy - b); ctx.lineTo(cx + a, cy - b);
  ctx.lineTo(cx + a * 0.72, cy + b); ctx.lineTo(cx - a * 1.28, cy + b);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  axisLine(ctx, cx, cy - h * 0.42, cx, cy + h * 0.4, "z axis");
  drawCaption(ctx, cx + a * 0.5, cy - b - 12, "a", PALETTE.inkSoft, 10);
  drawCaption(ctx, cx - a * 1.2, cy, "b", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["cylinder-diameter"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.55;
  const L = Math.min(w * 0.3, 120), R = Math.min(h * 0.2, 52);
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.rect(cx - L, cy - R, L * 2, R * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx - L, cy, R * 0.3, R, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx + L, cy, R * 0.3, R, 0, 0, Math.PI * 2); ctx.stroke();
  const sx = cx + L * 0.42;
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 4; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.ellipse(sx, cy, R * 0.3, R, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  axisLine(ctx, cx, cy - h * 0.42, cx, cy + h * 0.4, "axis");
  drawCaption(ctx, sx + 30, cy - R - 10, "disk dm", PALETTE.brass, 10);
  drawDashedLine(ctx, cx, cy + R + 12, sx, cy + R + 12, PALETTE.rule, 1, [2, 3]);
  drawCaption(ctx, (cx + sx) / 2, cy + R + 23, "z", PALETTE.inkSoft, 10);
};

INERTIA_FIGURES["parallel_axis"] = (ctx, w, h) => {
  const cx = w * 0.44, cy = h * 0.55, R = Math.min(w, h) * 0.22;
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  axisLine(ctx, cx, cy - h * 0.4, cx, cy + h * 0.38, "");
  drawCaption(ctx, cx, cy - h * 0.44, "centre of mass", PALETTE.crimson, 10);
  const dx = cx + R * 1.9;
  ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(dx, cy - h * 0.4); ctx.lineTo(dx, cy + h * 0.38); ctx.stroke(); ctx.restore();
  drawCaption(ctx, dx + 4, cy - h * 0.44, "new axis", PALETTE.brass, 10);
  drawDashedLine(ctx, cx, cy, dx, cy, PALETTE.rule, 1, [2, 3]);
  drawCaption(ctx, (cx + dx) / 2, cy - 12, "d", PALETTE.inkSoft, 11);
  ctx.fillStyle = PALETTE.ink; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
};

INERTIA_FIGURES["perpendicular_axis"] = (ctx, w, h) => {
  const cx = w / 2, cy = h * 0.56;
  const a = Math.min(w * 0.26, 100), b = Math.min(h * 0.2, 58);
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - a, cy - b); ctx.lineTo(cx + a, cy - b);
  ctx.lineTo(cx + a * 0.74, cy + b); ctx.lineTo(cx - a * 1.26, cy + b);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  drawArrow(ctx, cx, cy, cx, cy - h * 0.36, PALETTE.crimson, 2);
  drawCaption(ctx, cx + 16, cy - h * 0.34, "z", PALETTE.crimson, 11);
  drawArrow(ctx, cx, cy, cx + a * 1.1, cy - b * 0.3, PALETTE.navy, 2);
  drawCaption(ctx, cx + a * 1.2, cy - b * 0.3 - 10, "y", PALETTE.navy, 11);
  drawArrow(ctx, cx, cy, cx - a * 0.9, cy + b * 0.55, PALETTE.brass, 2);
  drawCaption(ctx, cx - a * 1.0, cy + b * 0.7, "x", PALETTE.brass, 11);
};

// Draw one figure into a canvas, sizing it to its container.
function paintInertiaFigure(canvas, shape) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  // clientWidth/clientHeight give the CONTENT box; getBoundingClientRect
  // would add the parent's border and overdraw by 2px each repaint.
  const parent = canvas.parentElement;
  const w = Math.max(parent.clientWidth, 1), h = Math.max(parent.clientHeight, 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const fn = INERTIA_FIGURES[shape];
  if (fn) fn(ctx, w, h);
  registerOneShot(canvas, () => paintInertiaFigure(canvas, shape));
}

/* ---------------------------- rocket set-piece ---------------------------- */

const ROCKET = { mass: 480, thrust: 6200, cycle: 5.2 };

function recomputeRocket() {
  ROCKET.g = GRAVITY;
  ROCKET.weight = ROCKET.mass * ROCKET.g;
  ROCKET.netForce = ROCKET.thrust - ROCKET.weight;
  ROCKET.accel = ROCKET.netForce / ROCKET.mass;
}
recomputeRocket();

let rocketHandle = null;
let rocketResizeObserver = null;

function stopRocketAnim() {
  if (rocketHandle) cancelAnimationFrame(rocketHandle);
  rocketHandle = null;
  if (rocketResizeObserver) rocketResizeObserver.disconnect();
  rocketResizeObserver = null;
}

function startRocketAnim(canvas, readoutEl) {
  stopRocketAnim();
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  rocketResizeObserver = fitCanvasToParent(canvas, ctx);
  const start = performance.now();

  function frame(now) {
    const elapsed = ((now - start) / 1000) % ROCKET.cycle;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    drawRocketScene(ctx, w, h, elapsed);
    if (readoutEl) readoutEl.textContent = rocketReadout(elapsed);
    rocketHandle = requestAnimationFrame(frame);
  }
  rocketHandle = requestAnimationFrame(frame);
}

function rocketReadout(t) {
  const v = ROCKET.accel * t;
  const d = 0.5 * ROCKET.accel * t * t;
  const pad = (n, w) => n.toFixed(2).padStart(w, " ");
  return (
    `LAUNCH LOG\n` +
    `F_net = T − W  = ${pad(ROCKET.netForce, 7)} N\n` +
    `a = F_net / m   = ${pad(ROCKET.accel, 7)} m/s²\n` +
    `t               = ${pad(t, 7)} s\n` +
    `v = a t         = ${pad(v, 7)} m/s\n` +
    `d = ½ a t²      = ${pad(d, 7)} m`
  );
}

function drawRocketScene(ctx, w, h, t) {
  const padY = h * 0.92;
  const d = 0.5 * ROCKET.accel * t * t;
  const dAtCycle = 0.5 * ROCKET.accel * ROCKET.cycle * ROCKET.cycle;
  const frac = clamp(d / dAtCycle, 0, 1);
  const groundClearance = 60;
  const rocketY = padY - groundClearance - frac * (h - groundClearance - 30);
  const cx = w / 2;

  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  for (let gy = h * 0.1; gy < padY; gy += (padY - h * 0.1) / 5) {
    ctx.beginPath();
    ctx.moveTo(w * 0.08, gy);
    ctx.lineTo(w * 0.92, gy);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 46, padY);
  ctx.lineTo(cx - 34, h * 0.2);
  ctx.moveTo(cx - 46, padY);
  ctx.lineTo(cx - 30, padY - 30);
  ctx.moveTo(cx - 40, padY - 15);
  ctx.lineTo(cx - 34, h * 0.35);
  ctx.stroke();

  drawGround(ctx, w, h, padY);

  if (frac < 0.35) {
    const smokeAlpha = (0.35 - frac) / 0.35;
    for (let i = 0; i < 5; i++) {
      const sx = cx + Math.sin(t * 3 + i) * (14 + i * 6);
      const sy = padY - 4 - i * 7 - (t % 1) * 6;
      ctx.globalAlpha = smokeAlpha * (0.32 - i * 0.05);
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.beginPath();
      ctx.arc(sx, sy, 7 + i * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const flick = 1 + Math.sin(t * 26) * 0.15;
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.moveTo(cx - 7, rocketY + 26);
  ctx.lineTo(cx, rocketY + 26 + 22 * flick);
  ctx.lineTo(cx + 7, rocketY + 26);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.moveTo(cx - 4, rocketY + 26);
  ctx.lineTo(cx, rocketY + 26 + 13 * flick);
  ctx.lineTo(cx + 4, rocketY + 26);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.translate(cx, rocketY);
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.quadraticCurveTo(13, -14, 13, 12);
  ctx.lineTo(13, 26);
  ctx.lineTo(-13, 26);
  ctx.lineTo(-13, 12);
  ctx.quadraticCurveTo(-13, -14, 0, -30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -4, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-13, 14);
  ctx.lineTo(-24, 28);
  ctx.lineTo(-13, 26);
  ctx.closePath();
  ctx.moveTo(13, 14);
  ctx.lineTo(24, 28);
  ctx.lineTo(13, 26);
  ctx.closePath();
  ctx.fillStyle = PALETTE.crimson;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const v = ROCKET.accel * t;
  if (v > 0.3) {
    const vLen = clamp(v * 4, 10, 50);
    drawArrow(ctx, cx + 24, rocketY, cx + 24, rocketY - vLen, PALETTE.navy, 2);
    drawLabel(ctx, cx + 40, rocketY - vLen / 2, "v", PALETTE.navy, 13);
  }
}

/* ---------------------------- Newton's cradle set-piece ---------------------------- */

const CRADLE = { n: 5, ballR: 15, stringLen: 118, theta0: 0.85, m: 0.15, L: 1.1 };

function recomputeCradle() {
  CRADLE.g = GRAVITY;
  CRADLE.vBottom = Math.sqrt(2 * CRADLE.g * CRADLE.L * (1 - Math.cos(CRADLE.theta0)));
  CRADLE.p = CRADLE.m * CRADLE.vBottom;
  CRADLE.KE = 0.5 * CRADLE.m * CRADLE.vBottom * CRADLE.vBottom;
}
recomputeCradle();

// Called by setGravity() so the home-page figures and every scene stay in
// step with whatever value the backend reports.
function onGravityChanged() {
  recomputeRocket();
  recomputeCradle();
}
CRADLE.D = 0.85; // seconds per quarter-swing, artistic pacing
CRADLE.hold = 0.16;
CRADLE.cycle = 4 * CRADLE.D + 2 * CRADLE.hold;

function cradleState(t) {
  const D = CRADLE.D, hold = CRADLE.hold, theta0 = CRADLE.theta0;
  const angles = new Array(CRADLE.n).fill(0);
  let phase = "";
  let flash = 0;

  const seg1 = D;
  const seg2 = D + hold;
  const seg3 = seg2 + 2 * D;
  const seg4 = seg3 + hold;
  const seg5 = seg4 + D;

  if (t < seg1) {
    const f = t / D;
    angles[0] = -theta0 * Math.cos((Math.PI / 2) * f);
    phase = "Ball 1 descending — KE increasing";
  } else if (t < seg2) {
    angles[0] = 0;
    flash = 1 - (t - seg1) / hold;
    phase = "Impulse transmitted through balls 2–4";
  } else if (t < seg3) {
    const tau = t - seg2;
    if (tau < D) {
      const f = tau / D;
      angles[4] = theta0 * Math.sin((Math.PI / 2) * f);
      phase = "Ball 5 ascending — KE → PE";
    } else {
      const f = (tau - D) / D;
      angles[4] = theta0 * Math.cos((Math.PI / 2) * f);
      phase = "Ball 5 descending — PE → KE";
    }
  } else if (t < seg4) {
    angles[4] = 0;
    flash = 1 - (t - seg3) / hold;
    phase = "Impulse transmitted back through balls 4–2";
  } else if (t < seg5) {
    const f = (t - seg4) / D;
    angles[0] = -theta0 * Math.sin((Math.PI / 2) * f);
    phase = "Ball 1 ascending — KE → PE";
  } else {
    angles[0] = -theta0;
    phase = "Ball 1 at rest — about to release";
  }

  return { angles, phase, flash: clamp(flash, 0, 1) };
}

let cradleHandle = null;
let cradleResizeObserver = null;

function stopCradleAnim() {
  if (cradleHandle) cancelAnimationFrame(cradleHandle);
  cradleHandle = null;
  if (cradleResizeObserver) cradleResizeObserver.disconnect();
  cradleResizeObserver = null;
}

function startCradleAnim(canvas, readoutEl) {
  stopCradleAnim();
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  cradleResizeObserver = fitCanvasToParent(canvas, ctx);
  const start = performance.now();

  function frame(now) {
    const elapsed = ((now - start) / 1000) % CRADLE.cycle;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    const state = cradleState(elapsed);
    drawCradleScene(ctx, w, h, state);
    if (readoutEl) readoutEl.textContent = cradleReadout(state);
    cradleHandle = requestAnimationFrame(frame);
  }
  cradleHandle = requestAnimationFrame(frame);
}

function cradleReadout(state) {
  const pad = (n, w) => n.toFixed(3).padStart(w, " ");
  return (
    `CONSERVATION LOG\n` +
    `${state.phase}\n` +
    `v (contact) = ${pad(CRADLE.vBottom, 6)} m/s\n` +
    `p = m v     = ${pad(CRADLE.p, 6)} kg·m/s\n` +
    `KE = ½ m v² = ${pad(CRADLE.KE, 6)} J\n` +
    `— momentum & KE conserved —`
  );
}

function drawCradleScene(ctx, w, h, state) {
  const topY = h * 0.16;
  const cx = w / 2;
  const r = clamp(Math.min(w, h) * 0.075, 9, 17);
  const L = clamp(h * 0.52, 60, 160);
  const spacing = r * 2;
  const n = CRADLE.n;
  const restX = (i) => cx + (i - (n - 1) / 2) * spacing;

  // frame
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 2;
  const frameLeft = restX(0) - 30, frameRight = restX(n - 1) + 30;
  ctx.beginPath();
  ctx.moveTo(frameLeft, topY - 14);
  ctx.lineTo(frameRight, topY - 14);
  ctx.moveTo(frameLeft, topY - 14);
  ctx.lineTo(frameLeft - 14, topY + L + 26);
  ctx.moveTo(frameRight, topY - 14);
  ctx.lineTo(frameRight + 14, topY + L + 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(frameLeft - 30, topY + L + 26);
  ctx.lineTo(frameRight + 30, topY + L + 26);
  ctx.stroke();
  // support hatching on the base
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  for (let x = frameLeft - 28; x < frameRight + 28; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, topY + L + 26);
    ctx.lineTo(x - 6, topY + L + 34);
    ctx.stroke();
  }

  const positions = [];
  for (let i = 0; i < n; i++) {
    const ax = restX(i);
    const angle = state.angles[i];
    const bx = ax + L * Math.sin(angle);
    const by = topY + L * Math.cos(angle);
    positions.push({ ax, bx, by, angle });
  }

  // strings (double, V-shaped, like a real cradle)
  positions.forEach(({ ax, bx, by }) => {
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax - 7, topY - 12);
    ctx.lineTo(bx, by);
    ctx.moveTo(ax + 7, topY - 12);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.arc(ax - 7, topY - 12, 1.6, 0, Math.PI * 2);
    ctx.arc(ax + 7, topY - 12, 1.6, 0, Math.PI * 2);
    ctx.fill();
  });

  // impulse flash across the stationary middle balls
  if (state.flash > 0) {
    ctx.strokeStyle = PALETTE.crimson;
    ctx.globalAlpha = state.flash * 0.8;
    ctx.lineWidth = 3;
    const y = topY + L;
    ctx.beginPath();
    ctx.moveTo(restX(0.5), y);
    ctx.lineTo(restX(n - 1.5), y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  positions.forEach(({ bx, by }) => {
    drawShadow(ctx, bx, topY + L + 24, r * 1.6, 0.1);
  });
  positions.forEach(({ bx, by }, i) => {
    sphereShade(ctx, bx, by, r, PALETTE.ink, PALETTE.panel);
  });

  drawCaption(ctx, w / 2, h * 0.06, "Fig. — Elastic Collision Chain", PALETTE.inkSoft, 11.5);
}

/* ============================================================================
   the cast
   ----------------------------------------------------------------------------
   Two characters that appear wherever their apparatus does, so a reader who
   meets Marcy on the sandbox lift recognises her on the solver's lift too.
   Drawn once here rather than per-renderer, because a character that looks
   different in two places stops being the same character.
   ========================================================================== */

/* Marcy the cat, seated, facing the reader. `s` is her overall height in
   pixels; everything else is a fraction of it, so she reads correctly from a
   14px thumbnail up to a full-size stage. */
function drawMarcy(ctx, x, baseY, s, opts) {
  const o = opts || {};
  // Below this she is a smudge, and every derived radius goes negative --
  // which canvas throws on rather than quietly skipping.
  if (!(s > 6)) return;
  const fur = o.colour || PALETTE.brass;
  const dark = PALETTE.ink;
  const bodyW = s * 0.62;
  const bodyH = s * 0.52;
  const headR = s * 0.26;
  const headY = baseY - bodyH - headR * 0.72;

  ctx.save();

  // tail, curled round to one side, with a slow idle sway
  const sway = Math.sin((o.t || 0) * 1.6) * s * 0.06;
  ctx.strokeStyle = fur;
  ctx.lineWidth = Math.max(s * 0.09, 1.2);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + bodyW * 0.42, baseY - bodyH * 0.18);
  ctx.quadraticCurveTo(x + bodyW * 0.95 + sway, baseY - bodyH * 0.55,
                       x + bodyW * 0.72 + sway, baseY - bodyH * 1.05);
  ctx.stroke();

  // body: a seated wedge, wider at the base
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.moveTo(x - bodyW * 0.34, baseY);
  ctx.quadraticCurveTo(x - bodyW * 0.50, baseY - bodyH * 0.72, x - bodyW * 0.24, baseY - bodyH);
  ctx.lineTo(x + bodyW * 0.24, baseY - bodyH);
  ctx.quadraticCurveTo(x + bodyW * 0.50, baseY - bodyH * 0.72, x + bodyW * 0.34, baseY);
  ctx.closePath();
  ctx.fill();

  // front paws
  const pawX = Math.max(s * 0.09, 0.6), pawY = Math.max(s * 0.05, 0.4);
  ctx.beginPath();
  ctx.ellipse(x - bodyW * 0.20, baseY - s * 0.03, pawX, pawY, 0, 0, Math.PI * 2);
  ctx.ellipse(x + bodyW * 0.20, baseY - s * 0.03, pawX, pawY, 0, 0, Math.PI * 2);
  ctx.fill();

  // ears, before the head so the head's outline sits over their bases
  ctx.beginPath();
  ctx.moveTo(x - headR * 0.86, headY - headR * 0.52);
  ctx.lineTo(x - headR * 1.02, headY - headR * 1.32);
  ctx.lineTo(x - headR * 0.24, headY - headR * 0.86);
  ctx.closePath();
  ctx.moveTo(x + headR * 0.86, headY - headR * 0.52);
  ctx.lineTo(x + headR * 1.02, headY - headR * 1.32);
  ctx.lineTo(x + headR * 0.24, headY - headR * 0.86);
  ctx.closePath();
  ctx.fill();

  // head
  ctx.beginPath();
  ctx.arc(x, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  // face, only once she is big enough for it to land as a face rather than
  // three smudges
  if (s > 26) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(x - headR * 0.36, headY - headR * 0.10, Math.max(headR * 0.11, 1), 0, Math.PI * 2);
    ctx.arc(x + headR * 0.36, headY - headR * 0.10, Math.max(headR * 0.11, 1), 0, Math.PI * 2);
    ctx.fill();
    // nose
    ctx.beginPath();
    ctx.moveTo(x, headY + headR * 0.18);
    ctx.lineTo(x - headR * 0.11, headY + headR * 0.05);
    ctx.lineTo(x + headR * 0.11, headY + headR * 0.05);
    ctx.closePath();
    ctx.fill();
    // whiskers
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(headR * 0.045, 0.6);
    ctx.globalAlpha = 0.65;
    [-1, 1].forEach((side) => {
      [-0.16, 0.02].forEach((dy) => {
        ctx.beginPath();
        ctx.moveTo(x + side * headR * 0.22, headY + headR * (0.12 + dy));
        ctx.lineTo(x + side * headR * 1.28, headY + headR * (0.02 + dy));
        ctx.stroke();
      });
    });
    ctx.globalAlpha = 1;
  }

  // the collar tag, which is where her name lives on the animal herself
  if (s > 30) {
    ctx.strokeStyle = PALETTE.crimson;
    ctx.lineWidth = Math.max(s * 0.035, 1);
    ctx.beginPath();
    ctx.arc(x, headY + headR * 0.86, headR * 0.72, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    ctx.fillStyle = PALETTE.brass;
    ctx.beginPath();
    ctx.arc(x, headY + headR * 1.52, Math.max(s * 0.05, 1.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The nametag above her head, so she is identified in the scene itself and
  // not only in a caption off to one side.
  if (s > 20 && o.tag !== false) {
    nameplate(ctx, x, headY - headR * 1.75, "Marcy the Cat", PALETTE.brass);
  }
}

/* Mr. J's skateboard, seen from the side. `s` is the deck length in pixels.
   Drawn at the origin pointing along +x, so the caller rotates it. */
function drawSkateboard(ctx, x, y, s, angle, opts) {
  const o = opts || {};
  if (!(s > 6)) return;
  const deckH = Math.max(s * 0.075, 2);
  const wheelR = Math.max(s * 0.085, 1.6);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle || 0);

  // wheels first, so the deck sits over the trucks
  ctx.fillStyle = PALETTE.ink;
  [-s * 0.30, s * 0.30].forEach((dx) => {
    ctx.beginPath();
    ctx.arc(dx, -wheelR, wheelR, 0, Math.PI * 2);
    ctx.fill();
  });
  // trucks
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = Math.max(s * 0.035, 1);
  [-s * 0.30, s * 0.30].forEach((dx) => {
    ctx.beginPath();
    ctx.moveTo(dx, -wheelR);
    ctx.lineTo(dx, -wheelR * 2.1);
    ctx.stroke();
  });

  // the deck, with a kick at each end
  const deckY = -wheelR * 2.1 - deckH;
  ctx.fillStyle = o.colour || PALETTE.crimson;
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, deckY - deckH * 0.9);
  ctx.quadraticCurveTo(-s * 0.40, deckY + deckH * 0.2, -s * 0.24, deckY + deckH * 0.2);
  ctx.lineTo(s * 0.24, deckY + deckH * 0.2);
  ctx.quadraticCurveTo(s * 0.40, deckY + deckH * 0.2, s * 0.5, deckY - deckH * 0.9);
  ctx.lineTo(s * 0.5, deckY - deckH * 1.9);
  ctx.quadraticCurveTo(s * 0.36, deckY - deckH * 0.9, s * 0.20, deckY - deckH * 0.9);
  ctx.lineTo(-s * 0.20, deckY - deckH * 0.9);
  ctx.quadraticCurveTo(-s * 0.36, deckY - deckH * 0.9, -s * 0.5, deckY - deckH * 1.9);
  ctx.closePath();
  ctx.fill();

  // grip tape
  ctx.fillStyle = PALETTE.ink;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(-s * 0.22, deckY - deckH * 1.0, s * 0.44, Math.max(deckH * 0.35, 1));
  ctx.globalAlpha = 1;

  ctx.restore();

  // The label rides ON the board, upright rather than rotated, so it stays
  // readable wherever round the circle the board happens to be.
  if (s > 26 && o.tag !== false) {
    nameplate(ctx, x, y - s * 0.52, "Mr. J's Skateboard", PALETTE.crimson);
  }
}

/* A small plate behind a label. Text alone over a busy scene is hard to read,
   and these two names have to survive being drawn on top of a moving picture. */
function nameplate(ctx, x, y, text, colour) {
  const size = 10;
  ctx.save();
  ctx.font = `600 ${size}px ${FONT_LABEL}`;
  const w = ctx.measureText(text).width + 12;
  const h = size + 8;
  ctx.fillStyle = PALETTE.stage;
  ctx.globalAlpha = 0.88;
  roundRectPath(ctx, x - w / 2, y - h, w, h, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  roundRectPath(ctx, x - w / 2, y - h, w, h, 3);
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - h / 2);
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* A nametag pinned to the side of the stage, naming who is in the scene. The
   in-scene plate can be crowded out at small sizes; this one never is. */
function sideNameplate(ctx, x, y, kind, name, colour) {
  ctx.save();
  const label = kind + ": " + name;
  ctx.font = `500 11px ${FONT_LABEL}`;
  const w = ctx.measureText(label).width + 18;
  const h = 24;
  ctx.fillStyle = PALETTE.panel;
  ctx.globalAlpha = 0.75;
  roundRectPath(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.2;
  roundRectPath(ctx, x, y, w, h, 3);
  ctx.stroke();
  // a punched hole, so it reads as a tag rather than a button
  ctx.fillStyle = PALETTE.stage;
  ctx.beginPath();
  ctx.arc(x + 8, y + h / 2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 15, y + h / 2 + 0.5);
  ctx.restore();
}

/* ============================================================================
   auto-expanding view
   ----------------------------------------------------------------------------
   A rocket climbs out of frame; a lift runs off the top of its shaft; a cart
   leaves the visible track. The box on screen is a fixed size, so the only way
   to keep the subject visible is to zoom OUT — shrink what is drawn so more of
   the world fits inside the same rectangle.

   Doing that abruptly is worse than clipping: the whole scene jumps. So the
   fit is a spring. Each frame a scene declares the world rectangle it wants
   visible; the view eases toward enclosing it, and never snaps.

   It also only ever zooms out QUICKLY and back in SLOWLY. A rocket that
   briefly dips below its peak should not have the camera lurch back at it.
   ========================================================================== */

const VIEWFITS = new Map();

// How far the view is allowed to expand relative to its natural scale. Two
// doublings covers a rocket that climbs 30x its own length; beyond that the
// subject is a dot and a bigger number stops helping.
const VIEWFIT_MAX_ZOOM_OUT = 64;

function viewFit(key) {
  let v = VIEWFITS.get(key);
  if (!v) {
    v = { scale: 1, target: 1, cx: 0, cy: 0, tcx: 0, tcy: 0, primed: false };
    VIEWFITS.set(key, v);
  }
  return v;
}

function resetViewFit(key) {
  VIEWFITS.delete(key);
}

/* Ask the view to enclose a world rectangle, and get back the transform to
   draw with. `pad` is a fraction of the box kept clear at the edges so the
   subject never rides the border.

   Returns { scale, ox, oy, X(x), Y(y), S(len) } where X/Y map world to canvas
   and S scales a length. */
function fitView(key, w, h, world, opts) {
  const o = opts || {};
  const pad = o.pad === undefined ? 0.12 : o.pad;
  const ease = o.ease === undefined ? 0.12 : o.ease;      // per frame, out
  const easeBack = o.easeBack === undefined ? 0.035 : o.easeBack;  // per frame, in
  const v = viewFit(key);

  const wx = Math.max(world.maxX - world.minX, 1e-9);
  const wy = Math.max(world.maxY - world.minY, 1e-9);
  const usableW = w * (1 - pad * 2);
  const usableH = h * (1 - pad * 2);

  // The scale that would exactly enclose the requested rectangle.
  const want = Math.min(usableW / wx, usableH / wy);
  const wantCx = (world.minX + world.maxX) / 2;
  const wantCy = (world.minY + world.maxY) / 2;

  // The base scale is a property of the CANVAS, not of one frame. Capturing it
  // once meant a view primed at 1x1 -- which happens whenever the canvas is
  // laid out before its container has size -- stayed 500x too small for ever,
  // and a pane resize could never widen the view again.
  const sizeKey = Math.round(w) + "x" + Math.round(h);
  if (!v.primed || v.sizeKey !== sizeKey) {
    v.scale = v.target = want;
    v.cx = v.tcx = wantCx;
    v.cy = v.tcy = wantCy;
    v.base = want;
    v.sizeKey = sizeKey;
    v.primed = true;
  }

  // Never zoom in past the scale the scene started at -- the apparatus should
  // not creep larger just because the action is currently near the middle.
  const floor = v.base / VIEWFIT_MAX_ZOOM_OUT;
  v.target = clamp(Math.min(want, v.base), floor, v.base);
  v.tcx = wantCx;
  v.tcy = wantCy;

  // Zooming OUT is urgent (the subject is escaping); zooming back IN is not.
  const k = v.target < v.scale ? ease : easeBack;
  v.scale += (v.target - v.scale) * k;
  v.cx += (v.tcx - v.cx) * k;
  v.cy += (v.tcy - v.cy) * k;

  const s = v.scale;
  const ox = w / 2 - v.cx * s;
  const oy = h / 2 + v.cy * s;          // world y is up, canvas y is down
  return {
    scale: s,
    ox, oy,
    X: (x) => ox + x * s,
    Y: (y) => oy - y * s,
    S: (len) => len * s,
    zoomedOut: s < v.base * 0.98,
    zoomFactor: v.base / s,
  };
}

/* Grow a world rectangle so it encloses a point, with a margin. Scenes call
   this for every object they care about, then hand the result to fitView. */
function includePoint(world, x, y, margin) {
  const m = margin || 0;
  world.minX = Math.min(world.minX, x - m);
  world.maxX = Math.max(world.maxX, x + m);
  world.minY = Math.min(world.minY, y - m);
  world.maxY = Math.max(world.maxY, y + m);
  return world;
}

function newWorld(x, y) {
  return { minX: x, maxX: x, minY: y, maxY: y };
}

/* A scale bar, drawn whenever the view has zoomed out. Without it a reader has
   no way to tell that the picture shrank rather than the rocket slowing. */
function drawZoomBar(ctx, w, h, view, unit) {
  if (!view.zoomedOut) return;
  // Choose a round world length that lands between 60 and 160 pixels.
  const targetPx = 110;
  const raw = targetPx / view.scale;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [1, 2, 5, 10];
  let pick = mag;
  for (const st of steps) {
    if (mag * st >= raw * 0.6) { pick = mag * st; break; }
  }
  const px = pick * view.scale;
  const x0 = 16, y0 = h - 18;

  ctx.save();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0 + 5);
  ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0);
  ctx.moveTo(x0 + px, y0 - 5); ctx.lineTo(x0 + px, y0 + 5);
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, x0 + px / 2, y0 - 10, fmt(pick) + " " + (unit || "m"), PALETTE.inkSoft, 10);
  drawLabel(ctx, x0 + px + 34, y0 - 1, "zoomed out " + view.zoomFactor.toFixed(1) + "×", PALETTE.brass, 10);
}

/* Ramp: a block on a slope, with the weight visibly split into the two
 * components that make the problem tractable. The whole pedagogical point is
 * that the axes are along and perpendicular to the SURFACE, so the drawing
 * rotates its force arrows with the ramp rather than keeping them upright. */
RENDERERS["ramp"] = function (ctx, w, h, t, p) {
  const deg = Number.isFinite(p.theta_ramp) ? clamp(p.theta_ramp, 3, 75) : 30;
  const rad = (deg * Math.PI) / 180;

  const padX = 64, baseY = h * 0.80;
  const run = Math.min(w - padX * 2, (h * 0.56) / Math.tan(rad));
  const rise = run * Math.tan(rad);
  const apexX = padX, apexY = baseY - rise;
  const footX = padX + run, footY = baseY;

  drawGround(ctx, 0, baseY, w);

  // the wedge
  ctx.save();
  ctx.fillStyle = PALETTE.panel;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(apexX, apexY); ctx.lineTo(footX, footY); ctx.lineTo(apexX, footY);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(apexX, apexY); ctx.lineTo(footX, footY); ctx.lineTo(apexX, footY);
  ctx.closePath(); ctx.stroke();
  ctx.restore();

  // angle marker at the foot
  ctx.save();
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(footX, footY, 34, Math.PI, Math.PI + rad, false);
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, footX - 52, footY - 14, deg.toFixed(0) + "°", PALETTE.brass, 12);

  // The block slides down the slope and loops, so the scene reads as motion
  // even before any numbers are known.
  // A block below the critical angle must sit still, or the illustration
  // contradicts the very rule the chapter is teaching.
  const muS = Number.isFinite(p.mu_s_r) ? p.mu_s_r : null;
  const holds = muS !== null && Math.tan(rad) <= muS;
  const cycle = 3.4;
  const f = ((t % cycle) / cycle);
  const eased = f * f;                       // constant acceleration, not linear
  const along = holds ? 0.10 : 0.10 + eased * 0.74;
  const bx = apexX + (footX - apexX) * along;
  const by = apexY + (footY - apexY) * along;

  const size = 26;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(rad);
  ctx.fillStyle = PALETTE.navy;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-size / 2, -size, size, size);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.2;
  ctx.strokeRect(-size / 2, -size, size, size);
  ctx.restore();

  // centre of the block, lifted off the surface along the inward normal
  const nx = Math.sin(rad), ny = -Math.cos(rad);
  const cx = bx + nx * (size / 2), cy = by + ny * (size / 2);

  const L = 46;
  // full weight, straight down
  drawArrow(ctx, cx, cy, cx, cy + L, PALETTE.navy, 2);
  drawLabel(ctx, cx + 14, cy + L + 10, "mg", PALETTE.navy, 11);

  // and the two components it resolves into
  const par = L * Math.sin(rad), perp = L * Math.cos(rad);
  const ux = Math.cos(rad), uy = Math.sin(rad);       // down-slope unit vector
  ctx.save(); ctx.setLineDash([3, 3]);
  drawArrow(ctx, cx, cy, cx + ux * par, cy + uy * par, PALETTE.crimson, 1.8);
  drawArrow(ctx, cx, cy, cx - nx * perp, cy - ny * perp, PALETTE.brass, 1.8);
  ctx.restore();
  drawLabel(ctx, cx + ux * par + 20, cy + uy * par + 4, "mg·sinθ", PALETTE.crimson, 10);
  drawLabel(ctx, cx - nx * perp - 24, cy - ny * perp + 14, "mg·cosθ", PALETTE.brass, 10);

  // normal force, along the outward normal -- equal to mg*cos(theta), never mg
  drawArrow(ctx, cx, cy, cx + nx * perp, cy + ny * perp, PALETTE.forest, 2);
  drawLabel(ctx, cx + nx * perp + 16, cy + ny * perp - 8, "N", PALETTE.forest, 11);

  // friction, opposing the slide
  if (p.mu_k_r || p.mu_s_r) {
    const fLen = 30;
    drawArrow(ctx, cx, cy, cx - ux * fLen, cy - uy * fLen, PALETTE.ink, 1.8);
    drawLabel(ctx, cx - ux * fLen - 12, cy - uy * fLen - 8, "f", PALETTE.ink, 11);
  }

  const plate = [];
  if (Number.isFinite(p.mass_r)) plate.push(["m", fmt(p.mass_r) + " kg"]);
  plate.push(["θ", deg.toFixed(0) + "°"]);
  if (Number.isFinite(p.mu_s_r)) plate.push(["μₛ", fmt(p.mu_s_r)]);
  if (Number.isFinite(p.mu_k_r)) plate.push(["μₖ", fmt(p.mu_k_r)]);
  if (Number.isFinite(p.Fn_r)) plate.push(["N", fmt(p.Fn_r) + " N"]);
  if (Number.isFinite(p.a_ramp)) plate.push(["a", fmt(p.a_ramp) + " m/s²"]);
  plate.push(["N vs mg", "N = mg·cosθ"]);
  if (muS !== null) plate.push(["verdict", holds ? "holds — tanθ ≤ μₛ" : "slides — tanθ > μₛ"]);
  drawDataPlate(ctx, w - 178, 12, 166, plate);
};

/* Elevator: a car on a cable with a rider on a scale. The scale needle is the
 * point of the picture -- it is the normal force made visible, and it moves
 * while the true weight arrow beside it does not. */
RENDERERS["elevator"] = function (ctx, w, h, t, p) {
  const shaftX = w * 0.38, shaftW = Math.min(210, w * 0.30);
  const topY = 26, botY = h - 34;

  // shaft rails
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
  ctx.setLineDash([4, 6]);
  [shaftX - 12, shaftX + shaftW + 12].forEach((x) => {
    ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, botY); ctx.stroke();
  });
  ctx.restore();

  const carH = Math.min(150, (botY - topY) * 0.46);
  const cycle = 5.2;
  const ph = (t % cycle) / cycle;
  // Accelerate up, coast, decelerate: the three phases of a real lift ride,
  // and the three cases the chapter asks about.
  let travel, phase, aSign;
  if (ph < 0.3)      { travel = 1 - (ph / 0.3) * 0.5;        phase = "accelerating up";   aSign =  1; }
  else if (ph < 0.6) { travel = 0.5 - ((ph - 0.3) / 0.3) * 0.3; phase = "constant speed";  aSign =  0; }
  else if (ph < 0.9) { travel = 0.2 - ((ph - 0.6) / 0.3) * 0.1; phase = "slowing down";    aSign = -1; }
  else               { travel = 0.1;                          phase = "at rest";          aSign =  0; }
  /* A real lift does not step its acceleration between phases, and a force
     arrow that appears and vanishes at full length reads as a glitch rather
     than as a changing force. Round the corners over a tenth of the cycle so
     the arrow grows and shrinks through zero. */
  const ramp = (edge) => clamp(Math.abs(ph - edge) / 0.05, 0, 1);
  const soften = Math.min(ramp(0.3), ramp(0.6), ramp(0.9), ramp(0));
  aSign *= soften;

  const carY = topY + 34 + (botY - carH - topY - 34) * travel;

  // cable
  ctx.save();
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(shaftX + shaftW / 2, topY); ctx.lineTo(shaftX + shaftW / 2, carY); ctx.stroke();
  ctx.restore();

  // car
  ctx.save();
  ctx.fillStyle = PALETTE.panel; ctx.globalAlpha = 0.6;
  ctx.fillRect(shaftX, carY, shaftW, carH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1.5;
  ctx.strokeRect(shaftX, carY, shaftW, carH);
  ctx.restore();

  // Marcy the cat, on the scale. She rides every lift in the app, up or down,
  // solver or sandbox, so a reader meets the same animal each time.
  const floorY = carY + carH - 14;
  const px = shaftX + shaftW * 0.36;
  ctx.save();
  ctx.fillStyle = PALETTE.brass; ctx.globalAlpha = 0.8;
  ctx.fillRect(px - 22, floorY - 6, 44, 6);
  ctx.restore();
  drawMarcy(ctx, px, floorY - 6, Math.min(52, carH * 0.5), { t });

  // The two arrows that make the chapter's point: N changes, mg does not.
  const base = 40;
  // Interpolate rather than branch, so a softened aSign moves the arrow
  // smoothly between the three lengths instead of snapping between them.
  const nLen = base * (1 + (aSign > 0 ? 0.45 : 0.40) * aSign);
  drawArrow(ctx, px + 46, floorY, px + 46, floorY - nLen, PALETTE.forest, 2.2);
  drawLabel(ctx, px + 62, floorY - nLen - 6, "N", PALETTE.forest, 11);
  drawArrow(ctx, px + 46, floorY - base, px + 46, floorY, PALETTE.navy, 2);
  drawLabel(ctx, px + 62, floorY - 6, "mg", PALETTE.navy, 11);

  // acceleration arrow on the car itself
  if (aSign !== 0) {
    const ax = shaftX + shaftW + 30;
    const ay = carY + carH / 2;
    drawArrow(ctx, ax, ay, ax, ay - aSign * 34, PALETTE.crimson, 2);
    drawLabel(ctx, ax + 14, ay - aSign * 42, "a", PALETTE.crimson, 11);
  }

  // Prefer the reader's own acceleration over the animation's phase. Printing
  // a hardcoded 1.45 beside an entered a = 2 (true ratio 1.204) presented a
  // fabricated number as the answer to the question the chapter asks.
  sideNameplate(ctx, 14, h - 40, "Cat", "Marcy the Cat", PALETTE.brass);

  const aReal = Number.isFinite(p.a_elev) ? p.a_elev : aSign * 2.0;
  const ratio = Math.max(0, (GRAVITY + aReal) / GRAVITY);
  drawDataPlate(ctx, w - 186, 12, 174, [
    ["phase", phase],
    ["scale reads", ratio.toFixed(3) + " × mg"],
    ["true weight", "unchanged"],
    ["N = m(g + a)", ratio > 1.001 ? "N > mg" : ratio < 0.999 ? "N < mg" : "N = mg"],
    Number.isFinite(p.mass_e) ? ["m", fmt(p.mass_e) + " kg"] : ["note", "up is positive"],
  ]);
};

/* Roundabout: a car on a circular track, with the friction circle drawn as an
 * actual circle. The demand vector inside it is the whole idea -- turning and
 * accelerating compete for one budget, and the tyres let go when the vector
 * reaches the rim. */
RENDERERS["roundabout"] = function (ctx, w, h, t, p) {
  const cx = w * 0.36, cy = h * 0.52;
  const R = Math.min(w * 0.26, h * 0.34);

  // the track
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 26; ctx.globalAlpha = 0.22;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.7; ctx.lineWidth = 1.2; ctx.setLineDash([5, 7]);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  const ang = t * 0.85;
  const carX = cx + R * Math.cos(ang), carY = cy + R * Math.sin(ang);

  // Mr. J's skateboard, rolling along its own velocity vector.
  drawSkateboard(ctx, carX, carY, Math.max(R * 0.34, 26), ang + Math.PI / 2);

  // velocity, tangential; centripetal force, inward. Never an outward one --
  // there is no force flinging the car outward, only its own straight-line
  // tendency.
  const tx = -Math.sin(ang), ty = Math.cos(ang);
  drawArrow(ctx, carX, carY, carX + tx * 44, carY + ty * 44, PALETTE.navy, 2);
  drawLabel(ctx, carX + tx * 56, carY + ty * 56, "v", PALETTE.navy, 11);
  drawArrow(ctx, carX, carY, carX + (cx - carX) * 0.32, carY + (cy - carY) * 0.32, PALETTE.crimson, 2.2);
  drawLabel(ctx, carX + (cx - carX) * 0.44, carY + (cy - carY) * 0.44 - 8, "f = mv²/r", PALETTE.crimson, 10);

  // --- the friction circle, drawn to scale -------------------------------
  const gx = w - 132, gy = h * 0.5, gR = Math.min(62, h * 0.20);
  ctx.save();
  ctx.strokeStyle = PALETTE.forest; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(gx, gy, gR, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.28; ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(gx - gR, gy); ctx.lineTo(gx + gR, gy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx, gy - gR); ctx.lineTo(gx, gy + gR); ctx.stroke();
  ctx.restore();

  const budget = Number.isFinite(p.mu_s_track) ? p.mu_s_track * GRAVITY : null;
  const ac = (Number.isFinite(p.v_car) && Number.isFinite(p.r_track) && p.r_track > 0)
    ? (p.v_car * p.v_car) / p.r_track : null;
  const at = Number.isFinite(p.a_tangential) ? p.a_tangential : 0;

  if (budget && ac !== null) {
    const scale = gR / budget;
    const dx = at * scale, dy = -ac * scale;
    const mag = Math.hypot(dx, dy);
    const over = mag > gR;
    drawArrow(ctx, gx, gy, gx + dx, gy + dy, over ? PALETTE.crimson : PALETTE.brass, 2.2);
    drawLabel(ctx, gx, gy + gR + 18,
      over ? "grip exceeded — it slides" : (mag / gR * 100).toFixed(0) + "% of grip used",
      over ? PALETTE.crimson : PALETTE.inkSoft, 10);
  }
  drawLabel(ctx, gx, gy - gR - 12, "friction circle", PALETTE.forest, 10);
  sideNameplate(ctx, 14, h - 40, "Rider", "Mr. J's Skateboard", PALETTE.crimson);

  const plate = [];
  if (Number.isFinite(p.r_track)) plate.push(["r", fmt(p.r_track) + " m"]);
  if (Number.isFinite(p.v_car)) plate.push(["v", fmt(p.v_car) + " m/s"]);
  if (Number.isFinite(p.mu_s_track)) plate.push(["μₛ", fmt(p.mu_s_track)]);
  if (Number.isFinite(p.v_max)) plate.push(["v_max", fmt(p.v_max) + " m/s"]);
  plate.push(["mass", "cancels out"]);
  drawDataPlate(ctx, 12, 12, 158, plate);
};

/* Centre of mass: two or three bodies on an axis with the balance point
 * marked. The balance-beam metaphor is drawn literally, because "closer to
 * the heavier one, in inverse proportion" is the fact worth carrying away. */
RENDERERS["com"] = function (ctx, w, h, t, p) {
  const axisY = h * 0.56, x0 = 80, x1 = w - 80;
  const m1 = Number.isFinite(p.m1_cm) ? p.m1_cm : 3;
  const m2 = Number.isFinite(p.m2_cm) ? p.m2_cm : 1;
  const m3 = Number.isFinite(p.m3_cm) ? p.m3_cm : null;

  // axis
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x0 - 30, axisY); ctx.lineTo(x1 + 30, axisY); ctx.stroke();
  ctx.restore();

  // Place the bodies where the reader put them. Hardcoded thirds drew three
  // evenly spaced masses and a balance point unrelated to the printed x_cm.
  const raw = m3 !== null
    ? [{ m: m1, x: p.x1_cm ?? 0 }, { m: m2, x: p.x2_cm ?? 0.5 }, { m: m3, x: p.x3_cm ?? 1 }]
    : [{ m: m1, x: p.x1_cm ?? 0 }, { m: m2, x: p.x2_cm ?? 1 }];
  const lo = Math.min(...raw.map((b) => b.x));
  const hi = Math.max(...raw.map((b) => b.x));
  const span = hi - lo || 1;
  const bodies = raw.map((b) => ({ m: b.m, f: (b.x - lo) / span, x: b.x }));

  const total = bodies.reduce((s, b) => s + b.m, 0) || 1;
  const comF = bodies.reduce((s, b) => s + b.m * b.f, 0) / total;
  const px = (f) => x0 + (x1 - x0) * f;

  // the beam, tilted very slightly so it reads as a balance rather than a rule
  const wobble = Math.sin(t * 1.2) * 0.9;
  ctx.save();
  ctx.translate(px(comF), axisY);
  ctx.rotate((wobble * Math.PI) / 180);
  ctx.translate(-px(comF), -axisY);
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 3; ctx.globalAlpha = 0.75;
  ctx.beginPath(); ctx.moveTo(x0, axisY); ctx.lineTo(x1, axisY); ctx.stroke();
  ctx.globalAlpha = 1;

  bodies.forEach((b, i) => {
    const r = clamp(9 + Math.sqrt(b.m) * 5, 10, 30);
    const bx = px(b.f);
    sphereShade(ctx, bx, axisY - r, r, i === 0 ? PALETTE.navy : i === 1 ? PALETTE.crimson : PALETTE.forest);
    drawLabel(ctx, bx, axisY + 20, fmt(b.m) + " kg @ " + fmt(b.x) + " m", PALETTE.inkSoft, 10);
  });
  ctx.restore();

  // the pivot, sitting under the centre of mass
  const cxp = px(comF);
  ctx.save();
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.moveTo(cxp, axisY + 4); ctx.lineTo(cxp - 13, axisY + 30); ctx.lineTo(cxp + 13, axisY + 30);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  drawDashedLine(ctx, cxp, axisY - 70, cxp, axisY + 4, PALETTE.brass, 1.2, [3, 4]);
  drawLabel(ctx, cxp, axisY - 82, "centre of mass", PALETTE.brass, 11);

  const plate = [];
  if (Number.isFinite(p.x_cm)) plate.push(["x_cm", fmt(p.x_cm) + " m"]);
  if (Number.isFinite(p.v_cm)) plate.push(["v_cm", fmt(p.v_cm) + " m/s"]);
  if (Number.isFinite(p.a_cm)) plate.push(["a_cm", fmt(p.a_cm) + " m/s²"]);
  if (Number.isFinite(p.M_total)) plate.push(["M", fmt(p.M_total) + " kg"]);
  plate.push(["internal forces", "cannot move it"]);
  drawDataPlate(ctx, w - 190, 12, 178, plate);
};

/* Block on a block: the picture has to make the friction arrow on the TOP
 * block visible and forward-pointing, because "friction is what drives it"
 * is the whole lesson and it contradicts everything friction has meant so far. */
RENDERERS["blockstack"] = function (ctx, w, h, t, p) {
  const baseY = h * 0.72;
  const mTop = Number.isFinite(p.m_top) ? p.m_top : 2;
  const mBot = Number.isFinite(p.m_bot) ? p.m_bot : 5;
  const mu = Number.isFinite(p.mu_between) ? p.mu_between : 0.4;
  const F = Number.isFinite(p.F_push) ? p.F_push : 14;

  const muG = Number.isFinite(p.mu_ground) ? p.mu_ground : 0;
  // Ground friction raises the ceiling too. Leaving it out made the data plate
  // print "slipping" beside a solver answer of "moving together".
  const fMax = mu * GRAVITY * (mTop + mBot) + muG * (mTop + mBot) * GRAVITY;
  const slipping = F > fMax;

  drawGround(ctx, 0, baseY, w);

  // Together they slide as one; slipping, the top block falls behind.
  const cycle = 4.2;
  const f = (t % cycle) / cycle;
  const travel = f * f * w * 0.42;
  const lag = slipping ? f * f * w * 0.13 : 0;

  const bx = w * 0.26 + travel;
  const botW = Math.min(150, w * 0.20), botH = 42;
  const topW = botW * 0.52, topH = 30;

  ctx.save();
  ctx.fillStyle = PALETTE.navy; ctx.globalAlpha = 0.9;
  ctx.fillRect(bx - botW / 2, baseY - botH, botW, botH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.2;
  ctx.strokeRect(bx - botW / 2, baseY - botH, botW, botH);
  ctx.restore();
  drawLabel(ctx, bx, baseY - botH / 2, "m_bot", PALETTE.panel, 10);

  const tx = bx - lag;
  ctx.save();
  ctx.fillStyle = PALETTE.brass; ctx.globalAlpha = 0.92;
  ctx.fillRect(tx - topW / 2, baseY - botH - topH, topW, topH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.2;
  ctx.strokeRect(tx - topW / 2, baseY - botH - topH, topW, topH);
  ctx.restore();
  drawLabel(ctx, tx, baseY - botH - topH / 2, "m_top", PALETTE.stage, 10);

  drawArrow(ctx, bx - botW / 2 - 48, baseY - botH / 2, bx - botW / 2 - 6, baseY - botH / 2,
            PALETTE.crimson, 2.2);
  drawLabel(ctx, bx - botW / 2 - 56, baseY - botH / 2 - 13, "F", PALETTE.crimson, 11);

  // The arrow that matters: friction on the top block points FORWARD.
  const fy = baseY - botH - topH / 2;
  // Equal length and weight, because they ARE equal -- this is the one figure
  // whose whole purpose is Newton's third law, and a longer action arrow
  // teaches the opposite of what the caption says.
  const pairLen = 40;
  drawArrow(ctx, tx, fy, tx + pairLen, fy, PALETTE.forest, 2);
  drawLabel(ctx, tx + pairLen + 10, fy - 11, "f (drives it)", PALETTE.forest, 10, "left");
  // and its third-law partner, backward on the bottom block
  drawArrow(ctx, bx, baseY - botH + 9, bx - pairLen, baseY - botH + 9, PALETTE.forest, 2);
  drawLabel(ctx, bx - 44, baseY - botH + 21, "f' (reaction)", PALETTE.forest, 9, "right");

  drawDataPlate(ctx, w - 186, 12, 174, [
    ["m_top / m_bot", fmt(mTop) + " / " + fmt(mBot) + " kg"],
    ["μ between", fmt(mu)],
    ["F applied", fmt(F) + " N"],
    ["F_max together", fmt(fMax) + " N"],
    ["state", slipping ? "slipping" : "moving together"],
  ]);
};

/* Orbital mechanics: a genuine ellipse with the central body at one FOCUS,
 * swept at the rate Kepler's second law demands. The angle is obtained by
 * solving Kepler's equation M = E − e·sin E for the eccentric anomaly, which
 * is the only way to get the body to actually slow down near aphelion. A
 * constant angular rate would draw the same ellipse and teach the opposite
 * of the law the picture exists to show. */
function eccentricAnomaly(meanAnomaly, e) {
  // Newton-Raphson. f(E) = E − e·sin E − M is monotonic for e < 1, so this
  // converges in a handful of steps from E = M.
  // Newton started from E = M wanders as e approaches 1, because f' = 1 - e cos E
  // collapses near perihelion. Danby's starter leans the first guess the right
  // way, and a bracketed bisection catches whatever Newton still cannot hold.
  const M = meanAnomaly;
  const f = (x) => x - e * Math.sin(x) - M;
  let E = M + 0.85 * e * Math.sign(Math.sin(M) || 1);
  for (let i = 0; i < 40; i++) {
    const fp = 1 - e * Math.cos(E);
    if (Math.abs(fp) < 1e-14) break;
    const step = f(E) / fp;
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  if (Math.abs(f(E)) < 1e-10) return E;

  // f is strictly increasing for e < 1, so M +/- 1 always brackets the root.
  let lo = M - 1, hi = M + 1;
  while (f(lo) > 0) lo -= 1;
  while (f(hi) < 0) hi += 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

RENDERERS["orbital"] = function (ctx, w, h, t, p) {
  // Eccentricity comes from the reader's own numbers when they gave any, so
  // the drawing matches the orbit they are solving rather than a stock one.
  const e = clamp(Number.isFinite(p.e_orb) ? p.e_orb : 0.55, 0, 0.9);
  const a = Math.min(w * 0.30, h * 0.36);
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e;                       // focus offset from the ellipse centre
  const ecx = w * 0.5 + c, ecy = h * 0.5;   // centre, placed so the focus lands mid-canvas
  const fx = w * 0.5, fy = h * 0.5;         // the focus: where the central body sits

  const period = 7.5;
  const at = (tt) => {
    const M = ((tt / period) * Math.PI * 2) % (Math.PI * 2);
    const E = eccentricAnomaly(M, e);
    return { x: ecx - a * Math.cos(E), y: ecy + b * Math.sin(E), E };
  };

  // --- the orbit itself ---------------------------------------------------
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.ellipse(ecx, ecy, a, b, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // --- equal areas in equal times ----------------------------------------
  // Two wedges of identical DURATION, one at perihelion and one at aphelion.
  // They look nothing alike and enclose the same area, which is the whole of
  // Kepler's second law in one picture.
  const sweep = period * 0.08;
  const wedge = (t0, colour) => {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    for (let i = 0; i <= 24; i++) {
      const q = at(t0 + (sweep * i) / 24);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  wedge(0, PALETTE.forest);                 // perihelion: fast, fat, short
  wedge(period / 2, PALETTE.forest);        // aphelion: slow, thin, long

  // --- apsides ------------------------------------------------------------
  const peri = { x: ecx - a, y: ecy };
  const apo = { x: ecx + a, y: ecy };
  drawDashedLine(ctx, apo.x, apo.y, peri.x, peri.y, PALETTE.rule, 1, [2, 5]);
  drawLabel(ctx, peri.x - 4, peri.y - 14, "perihelion", PALETTE.inkSoft, 10);
  drawLabel(ctx, apo.x + 4, apo.y - 14, "aphelion", PALETTE.inkSoft, 10);

  // The empty focus, drawn because "the other one has nothing in it" is the
  // detail that makes an ellipse stop feeling like an off-centre circle.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ecx + c, ecy, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // --- the moving body ----------------------------------------------------
  const s = at(t);
  const trail = trailFromFn(t, 2.2, 26, (tt) => at(tt));
  drawTrail(ctx, trail, PALETTE.navy);

  // The drawn body must not swallow perihelion, or the closest approach --
  // the whole point of a high-eccentricity orbit -- happens out of sight.
  const centralR = clamp(Math.min(Math.min(w, h) * 0.07, a * (1 - e) * 0.55), 6, 28);
  sphereShade(ctx, fx, fy, centralR, PALETTE.brass);
  drawLabel(ctx, fx, fy + centralR + 14, "M", PALETTE.brass, 11);

  // Gravity always points at the focus, never along the path.
  drawArrow(ctx, s.x, s.y, s.x + (fx - s.x) * 0.26, s.y + (fy - s.y) * 0.26, PALETTE.crimson, 2);

  // Velocity is tangent to the ellipse, and its LENGTH tracks the real speed:
  // by vis-viva, v = sqrt(GM(2/r - 1/a)), so it stretches at perihelion.
  const rNow = Math.hypot(s.x - fx, s.y - fy);
  // Vis-viva as a RATIO to the circular speed at the same semi-major axis:
  // sqrt(2a/r - 1) is dimensionless and equals 1 for a circle. Using the raw
  // pixel-unit speed put every arrow under the minimum length, so the arrow
  // never changed at all -- the opposite of what this figure is claiming.
  const speedRatio = Math.sqrt(Math.max(2 * a / rNow - 1, 1e-9));
  const dt = 0.01;
  const ahead = at(t + dt);
  const dx = ahead.x - s.x, dy = ahead.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const vLen = clamp(speedRatio * 22, 11, 56);
  drawArrow(ctx, s.x, s.y, s.x + (dx / len) * vLen, s.y + (dy / len) * vLen, PALETTE.navy, 2);
  drawLabel(ctx, s.x + (dx / len) * (vLen + 12), s.y + (dy / len) * (vLen + 12), "v", PALETTE.navy, 11);

  drawDashedLine(ctx, fx, fy, s.x, s.y, PALETTE.rule, 1, [2, 4]);
  sphereShade(ctx, s.x, s.y, 7, PALETTE.ink);

  const trueE = Number.isFinite(p.e_orb) ? p.e_orb : e;
  const plate = [["e", trueE.toFixed(4) + (Math.abs(trueE - e) > 1e-9 ? " (drawn at 0.90)" : "")]];
  if (Number.isFinite(p.a_semi)) plate.push(["a", fmt(p.a_semi) + " m"]);
  if (Number.isFinite(p.T_kepler)) plate.push(["T", fmt(p.T_kepler) + " s"]);
  if (Number.isFinite(p.r_peri)) plate.push(["r_peri", fmt(p.r_peri) + " m"]);
  if (Number.isFinite(p.r_apo)) plate.push(["r_apo", fmt(p.r_apo) + " m"]);
  plate.push(["shaded", "equal areas, equal times"]);
  drawDataPlate(ctx, w - 176, 12, 164, plate);
};

/* ============================================================================
   The 2026 chapter expansion — eight solver figures
   ----------------------------------------------------------------------------
   Each of these animates the ANSWER: the geometry is built from the reader's
   own knowns and falls back to a textbook default only where a value is
   missing. Two problems recur across all eight and are solved once, here.

   * A scene that runs ONE WAY — a body settling toward terminal speed, two
     pucks colliding, a boat crossing — has no periodic state to loop back to.
     Cutting at the seam teleports a body and drops a drawn force from full
     length to nothing in a single frame, which is the exact artefact this file
     was rebuilt once to remove. `loopFade` dissolves the picture through the
     seam instead, so the reset is never seen and no arrow ever jumps.
   * Real periods and time constants span four orders of magnitude. A stick
     with T = 0.3 s and a stick with T = 9 s are both unwatchable, so those
     figures play at a rate that lands the subject's period in the two-to-three
     second band. Where a figure holds a SECOND body, it is scaled by the same
     factor — so a phase drift on screen is the real one and not an artefact of
     the playback rate.
   ========================================================================== */

const DEG_TO_RAD = Math.PI / 180;

/* 1 through the body of the cycle, 0 exactly at the seam. easeInOut is already
   flat at both ends, so the dissolve has no corner in it. */
function loopFade(t, cycle, edge) {
  if (!(cycle > 0)) return 1;
  const e = Math.min(edge > 0 ? edge : 0.35, cycle / 2);
  const u = ((t % cycle) + cycle) % cycle;
  if (u < e) return easeInOut(u / e);
  if (u > cycle - e) return easeInOut((cycle - u) / e);
  return 1;
}

/* sphereShade assigns globalAlpha inside its own shading pass, so it cannot be
   faded from outside: at alpha 0 the contour hatching and the highlight fleck
   were still on screen after the body itself had gone. This variant takes the
   fade as an argument and multiplies every pass by it. */
function discShade(ctx, x, y, r, colour, alpha) {
  const a = clamp(alpha === undefined ? 1 : alpha, 0, 1);
  if (!(r > 0.6) || a < 0.02) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.panel;
  ctx.fill();
  ctx.lineWidth = Math.min(2, r * 0.3);
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = a * 0.38;
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    ctx.beginPath();
    ctx.arc(x + r * 0.32, y + r * 0.32, (r * i) / 5.6, Math.PI * 0.05, Math.PI * 0.95);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

/* Shared entry guard. Below a dozen pixels half the derived radii and
   half-widths in these figures go negative, and canvas throws on a negative
   arc radius rather than skipping the call; and PALETTE is empty until
   refreshPalette() has run at least once. */
function stageReady(ctx, w, h) {
  return !!(ctx && w > 12 && h > 12 && PALETTE && PALETTE.ink);
}

function numOr(v, fallback) { return Number.isFinite(v) ? v : fallback; }
function posOr(v, fallback) { return Number.isFinite(v) && v > 0 ? v : fallback; }

/* A curved arrow, for the torque and angular-velocity arcs. Drawn as an arc
   plus a head built from the tangent at the far end, so the head always points
   the way the arc sweeps rather than at a fixed screen angle. */
function drawArcArrow(ctx, cx, cy, r, a0, a1, colour, width) {
  if (!(r > 1)) return;
  const wdt = width || 2;
  const dir = a1 >= a0 ? 1 : -1;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = wdt;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1, dir < 0);
  ctx.stroke();
  const hx = cx + Math.cos(a1) * r, hy = cy + Math.sin(a1) * r;
  const tan = a1 + (dir * Math.PI) / 2;
  const head = Math.min(7 + wdt, r * 0.9);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - head * Math.cos(tan - Math.PI / 6), hy - head * Math.sin(tan - Math.PI / 6));
  ctx.lineTo(hx - head * Math.cos(tan + Math.PI / 6), hy - head * Math.sin(tan + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* Drag: the body never actually gets to terminal speed, so the whole job of
 * this figure is to make an asymptote legible. The weight arrow is constant,
 * the drag arrow grows into it, the net arrow shrinks away to nothing, and the
 * trace on the v–t panel bends toward a dashed line it never reaches. */
RENDERERS["drag"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const g = GRAVITY;
  const m = posOr(p.mass_d, 80);

  // Quadratic only when the reader gave c and no b. A chapter that carries both
  // is the linear one with a stray coefficient, and guessing quadratic there
  // would draw a curve that disagrees with the v_term printed beside it.
  const b = posOr(p.b_drag, null);
  const c = posOr(p.c_drag, null);
  const quad = !b && !!c;

  let vT = posOr(p.v_term, null);
  if (!vT) vT = quad ? Math.sqrt((m * g) / c) : b ? (m * g) / b : 55;
  vT = clamp(vT, 0.2, 20000);

  // tau is v_term/g by definition — it is m/b for linear drag, and the same
  // ratio sets the tanh timescale for quadratic. Taking the reader's tau_drag
  // as an independent number let the trace and its own asymptote disagree.
  const tau = vT / g;
  // tanh(g·t/v_term) is the same function the solver prints as
  // v_term·(1 − 2/(e^(2g·t/v_term) + 1)); the identity matters because the two
  // have to agree digit for digit where the trace meets the printed answer.
  const vAt = (tt) => (quad ? vT * Math.tanh(tt / tau) : vT * (1 - Math.exp(-tt / tau)));
  const xAt = (tt) => (quad
    ? vT * tau * Math.log(Math.cosh(tt / tau))
    : vT * tt - vT * tau * (1 - Math.exp(-tt / tau)));
  // F_drag / mg is v/v_term for linear and its square for quadratic. Both reach
  // 1 only in the limit, which is the entire content of the picture.
  const dragFrac = (vv) => { const r = clamp(vv / vT, 0, 1); return quad ? r * r : r; };

  const span = 4 * tau;                 // 98.2% of terminal for linear drag
  const PLAY = 5.0, HOLD = 1.1, cycle = PLAY + HOLD;
  const u = t % cycle;
  const tPhys = u < PLAY ? (u / PLAY) * span : span;   // held at terminal for a beat
  const fade = loopFade(t, cycle, 0.5);
  const v = vAt(tPhys);
  const frac = dragFrac(v);

  const twoUp = w >= 430 && h >= 180;
  const sceneW = twoUp ? w * 0.47 : w;
  const bx = sceneW * 0.42;
  const by = h * 0.47;

  // --- the air the body is falling through --------------------------------
  // The streaks scroll by the DISTANCE fallen, not by the clock, so their
  // speed is exactly proportional to v and they accelerate with the body
  // instead of being animated at some separately chosen rate.
  const spacing = Math.max(Math.min(h * 0.17, 34), 9);
  const scroll = (xAt(tPhys) / Math.max(xAt(span), 1e-9)) * spacing * 7;
  const streakLen = 5 + 20 * clamp(v / vT, 0, 1);
  ctx.save();
  ctx.globalAlpha = 0.30 * fade;
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const sx = sceneW * (0.10 + 0.09 * i);
    if (sx > sceneW - 6) break;
    const band = h * 0.86;
    const phase = ((i * spacing * 0.61 - scroll) % band + band) % band;
    const sy = h * 0.08 + phase;
    // The wrap point sits in full view, so a streak that simply reappeared at
    // the other end teleported the height of the scene. Fading each one out as
    // it approaches either end of the band means nothing visible ever jumps.
    const edge = Math.min(phase, band - phase) / (band * 0.12);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * clamp(edge, 0, 1);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - streakLen);
    ctx.stroke();
    ctx.globalAlpha = a;
  }
  ctx.restore();

  // --- the body and the three arrows --------------------------------------
  const r = clamp(Math.min(sceneW, h) * 0.075, 5, 17);
  discShade(ctx, bx, by, r, PALETTE.navy, fade);

  const Lw = clamp(Math.min(h * 0.24, 72), 14, 78);
  ctx.save();
  ctx.globalAlpha = fade;
  drawArrow(ctx, bx, by, bx, by + Lw, PALETTE.navy, 2.2);
  drawLabel(ctx, bx - 16, by + Lw * 0.7, "mg", PALETTE.navy, 11, "right");
  const dragLen = Lw * frac;
  if (dragLen > 3) {
    drawArrow(ctx, bx, by, bx, by - dragLen, PALETTE.crimson, 2.2);
    drawLabel(ctx, bx - 16, by - dragLen * 0.7, quad ? "cv²" : "bv", PALETTE.crimson, 11, "right");
  }
  const netLen = Lw * (1 - frac);
  const nx = bx + Math.min(46, sceneW * 0.18);
  if (netLen > 3) {
    drawArrow(ctx, nx, by, nx, by + netLen, PALETTE.brass, 2);
    drawLabel(ctx, nx + 8, by + netLen * 0.6, "net", PALETTE.brass, 10, "left");
  } else {
    drawLabel(ctx, nx + 4, by, "net → 0", PALETTE.brass, 10, "left");
  }
  ctx.restore();

  drawCaption(ctx, sceneW / 2, h * 0.09,
    quad ? "Fig. — Quadratic Drag (F = −cv²)" : "Fig. — Linear Drag (F = −bv)", PALETTE.inkSoft, 12);

  // --- the v–t panel ------------------------------------------------------
  if (twoUp) {
    const gx0 = sceneW + w * 0.045, gx1 = w - 14;
    const gy0 = h * 0.24, gy1 = h * 0.80;
    const vMax = vT * 1.16;
    const GX = (tt) => gx0 + (gx1 - gx0) * clamp(tt / span, 0, 1);
    const GY = (vv) => gy1 - (gy1 - gy0) * clamp(vv / vMax, 0, 1);

    ctx.save();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(gx0, gy0 - 6); ctx.lineTo(gx0, gy1); ctx.lineTo(gx1, gy1);
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, gx1, gy1 + 13, "t (s)", PALETTE.inkSoft, 10, "right");
    drawLabel(ctx, gx0 - 2, gy0 - 14, "v (m/s)", PALETTE.inkSoft, 10, "left");

    // The asymptote. It is drawn the full width so it reads as a ceiling, and
    // the trace is clamped below it — a curve that touched its own asymptote
    // would teach the opposite of what the chapter says.
    const ay = GY(vT);
    drawDashedLine(ctx, gx0, ay, gx1, ay, PALETTE.crimson, 1.2, [5, 4]);
    drawLabel(ctx, gx1, ay - 9, "v_term = " + fmt(vT, 1), PALETTE.crimson, 10, "right");

    const curve = (upTo, colour, alpha, width) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i <= 90; i++) {
        const tt = (i / 90) * upTo;
        const gx = GX(tt), gy = GY(vAt(tt));
        if (i === 0) ctx.moveTo(gx, gy); else ctx.lineTo(gx, gy);
      }
      ctx.stroke();
      ctx.restore();
    };
    curve(span, PALETTE.navy, 0.26, 1.4);
    if (tPhys > span * 0.004) curve(tPhys, PALETTE.navy, 1, 2.2);

    // The 95% crossing: the honest answer to "when does it reach terminal".
    const t95 = quad ? tau * Math.atanh(0.95) : tau * Math.log(20);
    if (t95 < span) {
      drawDashedLine(ctx, GX(t95), gy1, GX(t95), GY(0.95 * vT), PALETTE.inkSoft, 1, [3, 3]);
      drawLabel(ctx, GX(t95), gy1 + 13, "95%", PALETTE.inkSoft, 10);
    }
    // The reader's own instant, when they gave one and it is on this axis.
    const tR = p.t_drag;
    if (Number.isFinite(tR) && tR > 0 && tR <= span) {
      drawDashedLine(ctx, GX(tR), gy1, GX(tR), GY(vAt(tR)), PALETTE.brass, 1.2, [4, 3]);
      ctx.fillStyle = PALETTE.brass;
      ctx.beginPath();
      ctx.arc(GX(tR), GY(vAt(tR)), 3.4, 0, Math.PI * 2);
      ctx.fill();
      drawLabel(ctx, GX(tR), GY(vAt(tR)) - 12, "t = " + fmt(tR, 1) + " s", PALETTE.brass, 10);
    }

    ctx.save();
    ctx.globalAlpha = fade;
    discShade(ctx, GX(tPhys), GY(v), 4.4, PALETTE.crimson, fade);
    ctx.restore();
  }

  const plate = [
    ["v", fmt(v, 2) + " m/s"],
    ["v_term", fmt(vT, 2) + " m/s"],
    ["v / v_term", fmt(100 * clamp(v / vT, 0, 1), 1) + " %"],
    ["Fd / mg", fmt(frac, 3)],
    ["τ", fmt(tau, 2) + " s"],
    ["t", fmt(tPhys, 2) + " s"],
    ["fallen", fmt(numOr(p.x_drag, xAt(tPhys)), 1) + " m"],
  ];
  if (Number.isFinite(p.Fd_drag)) plate.push(["Fd", fmt(p.Fd_drag, 1) + " N"]);
  if (Number.isFinite(p.v_drag)) plate.push(["v(t_drag)", fmt(p.v_drag, 2) + " m/s"]);
  drawDataPlate(ctx, 10, Math.max(8, h - 14 - plate.length * 15), Math.min(158, Math.max(w - 20, 20)), plate);
};

/* Two-dimensional collision: the picture has to carry the one idea students
 * lose in 2D — that momentum is conserved COMPONENTWISE, not as a magnitude.
 * So the pucks run on the left and the vector polygon runs on the right, and
 * the incoming chain and the outgoing chain end on the same corner. */
RENDERERS["collision-2d"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const m1 = posOr(p.m1_2d, 2), m2 = posOr(p.m2_2d, 3);
  let v1 = Math.abs(numOr(p.v1i_2d, 6));
  let v2 = Math.abs(numOr(p.v2i_2d, 4));
  let a1 = numOr(p.theta1i_2d, 0) * DEG_TO_RAD;
  let a2 = numOr(p.theta2i_2d, 115) * DEG_TO_RAD;
  // Two pucks both at rest have no collision to show and no polygon to close.
  if (v1 + v2 < 1e-6) { v1 = 6; v2 = 4; a1 = 0; a2 = 115 * DEG_TO_RAD; }

  const P = {
    x: m1 * v1 * Math.cos(a1) + m2 * v2 * Math.cos(a2),
    y: m1 * v1 * Math.sin(a1) + m2 * v2 * Math.sin(a2),
  };

  const inc = [
    { m: m1, v: v1, a: a1, colour: PALETTE.navy, tag: "p₁" },
    { m: m2, v: v2, a: a2, colour: PALETTE.crimson, tag: "p₂" },
  ];

  const have1 = Number.isFinite(p.v1f_2d) && Number.isFinite(p.theta1f_2d);
  const have2 = Number.isFinite(p.v2f_2d) && Number.isFinite(p.theta2f_2d);
  const sticky = !have1 && !have2;
  let out;
  if (sticky) {
    const M = m1 + m2;
    const vf = posOr(p.vf_2d, Math.hypot(P.x, P.y) / M);
    const af = Number.isFinite(p.thetaf_2d) ? p.thetaf_2d * DEG_TO_RAD : Math.atan2(P.y, P.x);
    out = [{ m: M, v: vf, a: af, colour: PALETTE.brass, tag: "p_f" }];
  } else {
    const vec = (vv, dd) => ({ x: vv * Math.cos(dd), y: vv * Math.sin(dd) });
    let q1 = have1 ? vec(m1 * p.v1f_2d, p.theta1f_2d * DEG_TO_RAD) : null;
    let q2 = have2 ? vec(m2 * p.v2f_2d, p.theta2f_2d * DEG_TO_RAD) : null;
    // Whichever outgoing puck the reader is still solving for is recovered from
    // conservation rather than defaulted, so the polygon closes by construction
    // instead of by luck.
    if (!q1) q1 = { x: P.x - q2.x, y: P.y - q2.y };
    if (!q2) q2 = { x: P.x - q1.x, y: P.y - q1.y };
    out = [
      { m: m1, v: Math.hypot(q1.x, q1.y) / m1, a: Math.atan2(q1.y, q1.x), colour: PALETTE.navy, tag: "p₁′" },
      { m: m2, v: Math.hypot(q2.x, q2.y) / m2, a: Math.atan2(q2.y, q2.x), colour: PALETTE.crimson, tag: "p₂′" },
    ];
  }

  const IN = 2.0, FLASH = 0.18, OUT = 2.4, HOLD = 0.6;
  const cycle = IN + FLASH + OUT + HOLD;
  const tc = IN + FLASH / 2;                 // the instant of contact
  const u = t % cycle;
  const fade = loopFade(t, cycle, 0.45);

  const wide = w >= 470 && h >= 200;
  const stageW = wide ? w * 0.60 : w;

  // The world is the whole run, start to finish, and is independent of t — so
  // the fit is computed once per canvas size and the scene never breathes.
  const vMaxAll = Math.max(v1, v2, ...out.map((o) => o.v), 0.1);
  const world = newWorld(0, 0);
  inc.forEach((o) => includePoint(world, -Math.cos(o.a) * o.v * tc, -Math.sin(o.a) * o.v * tc, 0));
  out.forEach((o) => includePoint(world, Math.cos(o.a) * o.v * (IN + FLASH + OUT - tc),
                                        Math.sin(o.a) * o.v * (IN + FLASH + OUT - tc), 0));
  includePoint(world, 0, 0, vMaxAll * 0.35);
  const view = fitView("solver-c2d", stageW, h, world, { pad: 0.16 });

  const rBase = clamp(Math.min(stageW, h) * 0.042, 4, 17);
  const radius = (mm) => rBase * clamp(Math.cbrt((2 * mm) / (m1 + m2)), 0.55, 1.7);

  // --- the lines the pucks run along --------------------------------------
  const lane = (o, sign) => {
    const far = o.v * (IN + FLASH + OUT) * 1.2;
    const ex = Math.cos(o.a) * far * sign, ey = Math.sin(o.a) * far * sign;
    drawDashedLine(ctx, view.X(0), view.Y(0), view.X(ex), view.Y(ey), PALETTE.rule, 1, [3, 6]);
  };
  inc.forEach((o) => lane(o, -1));
  out.forEach((o) => lane(o, 1));

  // --- pucks, and the momentum arrow riding each one -----------------------
  const pMax = Math.max(Math.hypot(P.x, P.y), ...inc.map((o) => o.m * o.v),
                        ...out.map((o) => o.m * o.v), 1e-6);
  const pScale = (Math.min(stageW, h) * 0.19) / pMax;

  const drawBody = (o, uu) => {
    const d = o.v * (uu - tc);
    const wx = Math.cos(o.a) * d, wy = Math.sin(o.a) * d;
    const sx = view.X(wx), sy = view.Y(wy);
    const rr = radius(o.m);
    discShade(ctx, sx, sy, rr, o.colour, fade);
    const len = o.m * o.v * pScale;
    if (len > 4) {
      ctx.save();
      ctx.globalAlpha = fade;
      drawArrow(ctx, sx, sy, sx + Math.cos(o.a) * len, sy - Math.sin(o.a) * len, o.colour, 2.2);
      drawLabel(ctx, sx + Math.cos(o.a) * (len + 14), sy - Math.sin(o.a) * (len + 12), o.tag, o.colour, 10);
      ctx.restore();
    }
  };

  if (u < tc) inc.forEach((o) => drawBody(o, u));
  else out.forEach((o) => drawBody(o, u));

  // contact burst, on the same clock the bodies use
  if (u >= IN && u < IN + FLASH) {
    const f = (u - IN) / FLASH;
    ctx.save();
    ctx.strokeStyle = PALETTE.brass;
    ctx.globalAlpha = (1 - f) * fade;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const rr = rBase * (0.6 + f * 2.2);
      ctx.beginPath();
      ctx.moveTo(view.X(0) + Math.cos(ang) * rr * 0.4, view.Y(0) + Math.sin(ang) * rr * 0.4);
      ctx.lineTo(view.X(0) + Math.cos(ang) * rr, view.Y(0) + Math.sin(ang) * rr);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawZoomBar(ctx, stageW, h, view, "m");
  drawCaption(ctx, stageW / 2, h * 0.07,
    sticky ? "Fig. — 2-D Collision (they stick)" : "Fig. — 2-D Collision (general)", PALETTE.inkSoft, 12);

  // --- the vector polygon --------------------------------------------------
  // Deliberately NOT on fitView: this panel wants a scale locked to the largest
  // momentum in the problem, not one that eases toward a moving target, because
  // the reader is meant to compare two chains drawn on the same ruler.
  if (wide) {
    const px0 = stageW + 10, px1 = w - 12;
    const py0 = h * 0.16, py1 = h * 0.74;
    const pw = px1 - px0, ph = py1 - py0;
    const chain = (list) => {
      const pts = [{ x: 0, y: 0 }];
      let cur = { x: 0, y: 0 };
      list.forEach((o) => {
        cur = { x: cur.x + o.m * o.v * Math.cos(o.a), y: cur.y + o.m * o.v * Math.sin(o.a) };
        pts.push(cur);
      });
      return pts;
    };
    const chainIn = chain(inc), chainOut = chain(out);
    const all = chainIn.concat(chainOut, [P]);
    const bx0 = Math.min(...all.map((q) => q.x)), bx1 = Math.max(...all.map((q) => q.x));
    const by0 = Math.min(...all.map((q) => q.y)), by1 = Math.max(...all.map((q) => q.y));
    const sc = Math.min(pw * 0.82 / Math.max(bx1 - bx0, 1e-6), ph * 0.74 / Math.max(by1 - by0, 1e-6));
    const cx0 = px0 + pw / 2 - ((bx0 + bx1) / 2) * sc;
    const cy0 = py0 + ph / 2 + ((by0 + by1) / 2) * sc;
    const MX = (x) => cx0 + x * sc;
    const MY = (y) => cy0 - y * sc;

    ctx.save();
    ctx.globalAlpha = 0.35;
    drawDashedLine(ctx, px0, MY(0), px1, MY(0), PALETTE.rule, 1, [2, 4]);
    drawDashedLine(ctx, MX(0), py0, MX(0), py1, PALETTE.rule, 1, [2, 4]);
    ctx.restore();

    const drawChain = (pts, list, dash, width) => {
      for (let i = 0; i < list.length; i++) {
        const a = pts[i], bq = pts[i + 1];
        ctx.save();
        if (dash) ctx.setLineDash([5, 4]);
        drawArrow(ctx, MX(a.x), MY(a.y), MX(bq.x), MY(bq.y), list[i].colour, width);
        ctx.restore();
      }
    };
    drawChain(chainIn, inc, false, 2.2);
    drawChain(chainOut, out, true, 1.9);

    // The resultant both chains land on. Drawing it last, over the two chains,
    // is what makes "before = after" a picture rather than a claim.
    drawArrow(ctx, MX(0), MY(0), MX(P.x), MY(P.y), PALETTE.forest, 2.6);
    drawLabel(ctx, MX(P.x) + 6, MY(P.y) - 12, "Σp", PALETTE.forest, 11, "left");

    // componentwise, which is the part the algebra actually uses
    drawDashedLine(ctx, MX(P.x), MY(P.y), MX(P.x), MY(0), PALETTE.forest, 1, [3, 3]);
    drawDashedLine(ctx, MX(P.x), MY(P.y), MX(0), MY(P.y), PALETTE.forest, 1, [3, 3]);
    drawLabel(ctx, MX(P.x / 2), MY(0) + 12, "Σpx = " + fmt(P.x, 1), PALETTE.forest, 9.5);
    drawLabel(ctx, MX(0) - 6, MY(P.y / 2), "Σpy = " + fmt(P.y, 1), PALETTE.forest, 9.5, "right");

    drawCaption(ctx, (px0 + px1) / 2, py1 + 16, "solid: before   dashed: after", PALETTE.inkSoft, 10);
    drawCaption(ctx, (px0 + px1) / 2, h * 0.07, "Momentum polygon (kg·m/s)", PALETTE.inkSoft, 11);
  }

  const plate = [
    ["m1, m2", fmt(m1, 2) + ", " + fmt(m2, 2) + " kg"],
    ["Σpx", fmt(P.x, 2) + " kg·m/s"],
    ["Σpy", fmt(P.y, 2) + " kg·m/s"],
    ["|Σp|", fmt(Math.hypot(P.x, P.y), 2)],
  ];
  if (sticky) {
    plate.push(["vf", fmt(out[0].v, 2) + " m/s"]);
    plate.push(["θf", fmt((out[0].a / DEG_TO_RAD + 360) % 360, 1) + "°"]);
    const keI = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
    const lost = numOr(p.KE_lost_2d, keI - 0.5 * (m1 + m2) * out[0].v * out[0].v);
    plate.push(["KE lost", fmt(lost, 1) + " J", PALETTE.crimson]);
  } else {
    out.forEach((o, i) => plate.push(["v" + (i + 1) + "f", fmt(o.v, 2) + " m/s @ "
      + fmt((o.a / DEG_TO_RAD + 360) % 360, 1) + "°"]));
    // Two reader-supplied outgoing vectors need not add up. Saying so is more
    // use than silently drawing a polygon that does not close.
    const qx = out.reduce((s, o) => s + o.m * o.v * Math.cos(o.a), 0);
    const qy = out.reduce((s, o) => s + o.m * o.v * Math.sin(o.a), 0);
    const miss = Math.hypot(qx - P.x, qy - P.y) / Math.max(Math.hypot(P.x, P.y), 1e-9);
    plate.push(miss < 0.02 ? ["polygon", "closes", PALETTE.forest]
      : ["polygon", "closes to " + fmt(100 * (1 - miss), 1) + "%", PALETTE.crimson]);
  }
  drawDataPlate(ctx, 10, Math.max(8, h - 18 - plate.length * 15), Math.min(184, Math.max(w - 20, 20)), plate);
};

/* Angular momentum: the left panel is the figure that makes L click — a mass
 * travelling in a dead straight line, nothing rotating anywhere, and an
 * angular momentum about O that does not budge because r·sinθ does not. The
 * right panel is the other half of the chapter: a torque, applied for a while,
 * changing L by exactly τΔt. */
RENDERERS["angular-momentum"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const mAng = posOr(p.m_ang, 2);
  const vAng = clamp(Math.abs(numOr(p.v_ang, 5)), 0.05, 5000);
  const rAng = clamp(posOr(p.r_ang, 4), 0.01, 100000);
  const thAng = clamp(Math.abs(numOr(p.theta_ang, 40)), 1, 179) * DEG_TO_RAD;
  const arm = rAng * Math.sin(thAng);                 // the perpendicular lever arm
  const Lpt = numOr(p.L_point, mAng * vAng * arm);

  const twoPanel = w >= 470 && h >= 210;
  const panelW = twoPanel ? w * 0.53 : w;

  /* ---- panel A: straight line past a pivot ------------------------------ */
  // The line is horizontal at world y = arm and the mass runs along +x. Placing
  // the reader's configuration at x = r·cosθ makes the drawn angle their theta
  // exactly: sinθ = arm/r has two solutions and taking the wrong one drew 140°
  // beside a plate that said 40°.
  const along = rAng * Math.cos(thAng);
  const world = newWorld(0, 0);
  includePoint(world, 0, arm, Math.max(arm, Math.abs(along), rAng) * 0.4);
  includePoint(world, Math.abs(along) * 1.7, arm, 0);
  includePoint(world, -Math.abs(along) * 1.7, arm, 0);
  const viewA = fitView("solver-angmom", panelW, h, world, { pad: 0.17 });

  // Run the mass right across the panel and out the far side. Both ends of the
  // pass are outside the clip below, so the wrap is never on screen and this
  // half of the figure needs no dissolve at all — but ONLY because of the clip.
  // Without it the mass carried on into the torque panel and then teleported
  // back across the whole canvas in one frame.
  const halfSpanPx = Math.max(viewA.X(0), panelW - viewA.X(0)) + Math.min(panelW, h) * 0.3 + 40;
  const halfSpan = halfSpanPx / Math.max(viewA.scale, 1e-9);
  const passT = 6.5;
  const massX = -halfSpan + ((t % passT) / passT) * halfSpan * 2;
  const mx = viewA.X(massX), my = viewA.Y(arm);
  const ox = viewA.X(0), oy = viewA.Y(0);

  // The mass being off-panel at the wrap is not enough on its own: the r vector
  // is drawn from O TO the mass, so its on-panel portion swings from hard right
  // to hard left in one frame while the mass itself is out of sight. The moving
  // group is therefore dissolved over the part of the pass that is already
  // beyond the panel edge, sized from the geometry rather than guessed.
  const offStart = (halfSpanPx - viewA.X(0)) / (2 * halfSpanPx);
  const offEnd = (halfSpanPx + viewA.X(0) - panelW) / (2 * halfSpanPx);
  const passFade = loopFade(t, passT, passT * clamp(Math.min(offStart, offEnd) * 0.85, 0.02, 0.4));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, panelW, h);
  ctx.clip();

  // the straight path
  ctx.save();
  ctx.strokeStyle = PALETTE.rule;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, my);
  ctx.lineTo(panelW, my);
  ctx.stroke();
  ctx.restore();

  // the lever arm, with a right-angle tick — this is the length that does not
  // change, and the whole panel exists to say so
  drawArrow(ctx, ox, oy, ox, my, PALETTE.brass, 2);
  const tick = Math.min(8, Math.abs(oy - my) * 0.4);
  if (tick > 2) {
    ctx.save();
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ox, my + tick);
    ctx.lineTo(ox + tick, my + tick);
    ctx.lineTo(ox + tick, my);
    ctx.stroke();
    ctx.restore();
  }
  drawLabel(ctx, ox - 8, (oy + my) / 2, "r·sinθ", PALETTE.brass, 11, "right");

  // the reader's own configuration, held still on the line as a reference
  const gx = viewA.X(along), gy = my;
  drawDashedLine(ctx, ox, oy, gx, gy, PALETTE.inkSoft, 1.2, [4, 4]);
  drawLabel(ctx, (ox + gx) / 2 - 4, (oy + gy) / 2 - 10, "r = " + fmt(rAng, 2) + " m", PALETTE.inkSoft, 10);
  discShade(ctx, gx, gy, 5, PALETTE.inkSoft, 0.5);
  const rDir = Math.atan2(gy - oy, gx - ox);
  drawAngleArc(ctx, gx, gy, Math.min(22, panelW * 0.06), rDir, 0, PALETTE.inkSoft,
    fmt(thAng / DEG_TO_RAD, 0) + "°");

  // the pivot
  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.arc(ox, oy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawLabel(ctx, ox, oy + 16, "O", PALETTE.ink, 11);

  // the mass, and its velocity — constant, because nothing acts on it
  ctx.save();
  ctx.globalAlpha = passFade;
  drawDashedLine(ctx, ox, oy, mx, my, PALETTE.navy, 1, [3, 4]);
  ctx.globalAlpha = passFade;      // drawDashedLine restores, but be explicit
  discShade(ctx, mx, my, clamp(Math.min(panelW, h) * 0.028, 4, 11), PALETTE.navy, passFade);
  const vLen = clamp(panelW * 0.14, 16, 70);
  drawArrow(ctx, mx, my, mx + vLen, my, PALETTE.navy, 2.2);
  drawLabel(ctx, mx + vLen + 12, my - 10, "v", PALETTE.navy, 11);
  ctx.restore();

  ctx.restore();          // end of the panel-A clip

  drawCaption(ctx, panelW / 2, h * 0.07, "Fig. — L of a mass that never turns", PALETTE.inkSoft, 11.5);
  // Reported for the mass CLAMPED to the panel, so the plate always describes
  // the body the reader can actually see rather than one that has run off the
  // edge — and so r and theta change smoothly instead of running away.
  const edgeLo = (0 - ox) / Math.max(viewA.scale, 1e-9);
  const edgeHi = (panelW - ox) / Math.max(viewA.scale, 1e-9);
  const shown = clamp(massX, Math.min(edgeLo, edgeHi), Math.max(edgeLo, edgeHi));
  const plateA = [
    ["r now", fmt(Math.hypot(shown, arm), 2) + " m"],
    ["θ now", fmt(Math.abs(Math.atan2(arm, shown)) / DEG_TO_RAD, 1) + "°"],
    ["r·sinθ (fixed)", fmt(arm, 3) + " m"],
    ["L = mvr·sinθ", fmt(Lpt, 2)],
  ];
  drawDataPlate(ctx, 10, Math.max(8, h - 14 - plateA.length * 15), Math.min(172, Math.max(panelW - 20, 20)), plateA);

  if (!twoPanel) return;

  /* ---- panel B: torque, and the angular impulse it delivers -------------- */
  const bx0 = panelW;
  const bcx = bx0 + (w - bx0) * 0.44;
  const bcy = h * 0.46;
  const R = clamp(Math.min((w - bx0) * 0.30, h * 0.26), 12, 120);

  ctx.save();
  ctx.globalAlpha = 0.4;
  drawDashedLine(ctx, bx0, h * 0.12, bx0, h * 0.88, PALETTE.rule, 1, [3, 5]);
  ctx.restore();

  const I = posOr(p.I_ang, Math.max(mAng * rAng * rAng * 0.5, 0.05));
  const F = posOr(p.F_ang, 12);
  const rF = clamp(posOr(p.r_F, rAng * 0.6), 0.001, 100000);
  const thF = clamp(Math.abs(numOr(p.theta_F, 90)), 1, 179) * DEG_TO_RAD;
  const tau = numOr(p.tau_ang, rF * F * Math.sin(thF));
  const dt = clamp(posOr(p.dt_ang, 3), 0.001, 100000);
  // The demo starts from rest so that the bar pair reads as ΔL rather than as a
  // ratio; omega_ang is the state AFTER the impulse in every one of these
  // problems, so feeding it in as the initial value would double-count it.
  const om0 = 0;
  const alpha = tau / I;
  const dL = numOr(p.dL_ang, tau * dt);

  // Show only as much of Δt as puts a couple of turns on the wheel. A real
  // impulse can be 900 rad of spin, and a wheel drawn at that rate strobes into
  // a blur that says nothing; the plate still reports the whole of ΔL.
  const spinFor = (target) => {
    if (Math.abs(alpha) < 1e-12) return dt;
    const disc = om0 * om0 + 2 * Math.abs(alpha) * target;
    return (Math.sqrt(Math.max(disc, 0)) - om0) / Math.abs(alpha);
  };
  const dtShown = Math.min(dt, spinFor(4 * Math.PI));
  const PLAY_B = 4.0, HOLD_B = 0.9, cycB = PLAY_B + HOLD_B;
  const ub = t % cycB;
  const fadeB = loopFade(t, cycB, 0.4);
  const tb = (Math.min(ub, PLAY_B) / PLAY_B) * dtShown;
  const omNow = om0 + alpha * tb;
  const phi = om0 * tb + 0.5 * alpha * tb * tb;

  // the wheel, drawn by hand so the whole panel can be dissolved through the
  // seam — the spin-up has no state to loop back to
  ctx.save();
  ctx.globalAlpha = fadeB;
  ctx.translate(bcx, bcy);
  ctx.rotate(phi);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.8;
  ctx.fillStyle = PALETTE.panel;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(R * 0.14, 1), 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.strokeStyle = i === 0 ? PALETTE.brass : PALETTE.rule;
    ctx.lineWidth = i === 0 ? 2.2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R * 0.14, Math.sin(a) * R * 0.14);
    ctx.lineTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92);
    ctx.stroke();
  }
  ctx.restore();

  // the applied force, at its own radius and its own angle to that radius
  const appR = clamp((rF / Math.max(rF, rAng)) * R, R * 0.25, R);
  const ax = bcx + appR, ay = bcy;
  const fLen = clamp(Math.min((w - bx0) * 0.22, 54), 12, 60);
  ctx.save();
  ctx.globalAlpha = fadeB;
  drawDashedLine(ctx, bcx, bcy, ax, ay, PALETTE.inkSoft, 1.2, [3, 4]);
  drawLabel(ctx, bcx + appR * 0.5, bcy + 13, "r", PALETTE.inkSoft, 10);
  // theta_F is measured from r, and the picture must show that only the
  // perpendicular part of F turns anything.
  const fdx = Math.cos(-thF) * fLen, fdy = Math.sin(-thF) * fLen;
  drawArrow(ctx, ax, ay, ax + fdx, ay + fdy, PALETTE.crimson, 2.4);
  drawLabel(ctx, ax + fdx + 10, ay + fdy - 8, "F", PALETTE.crimson, 11);
  drawAngleArc(ctx, ax, ay, Math.min(19, fLen * 0.5), -thF, 0, PALETTE.crimson,
    fmt(thF / DEG_TO_RAD, 0) + "°");
  // The sweep is scaled by sinθ_F — the fraction of rF·F that actually becomes
  // torque — so a force aimed near the axle draws a visibly feeble arc.
  const sweep = 0.35 + 1.25 * Math.abs(Math.sin(thF));
  drawArcArrow(ctx, bcx, bcy, R * 0.55, -0.2, -0.2 - Math.sign(tau || 1) * sweep, PALETTE.brass, 2);
  drawLabel(ctx, bcx, bcy - R - 12, "τ = rF·sinθ = " + fmt(tau, 2) + " N·m", PALETTE.brass, 10);
  ctx.restore();

  // ΔL = τΔt, as two bars with the gain shaded between them
  const barY = h * 0.88, barX = bx0 + 16, barW = Math.max((w - bx0) - 32, 10);
  const Lb = I * om0, La = I * (om0 + alpha * dt);
  const Lmax = Math.max(Math.abs(La), Math.abs(Lb), 1e-9);
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = PALETTE.navy;
  ctx.fillRect(barX, barY - 16, barW * clamp(Math.abs(Lb) / Lmax, 0, 1), 6);
  ctx.fillStyle = PALETTE.forest;
  ctx.fillRect(barX, barY - 7, barW * clamp(Math.abs(La) / Lmax, 0, 1), 6);
  ctx.restore();
  drawLabel(ctx, barX, barY + 6, "ΔL = τΔt = " + fmt(dL, 2) + " kg·m²/s", PALETTE.forest, 10, "left");

  drawDataPlate(ctx, bx0 + 12, 10, Math.min(178, Math.max(w - bx0 - 24, 20)), [
    ["I", fmt(I, 3) + " kg·m²"],
    ["ω", fmt(omNow, 2) + " rad/s"],
    ["showing", fmt(dtShown, 2) + " s of Δt = " + fmt(dt, 2) + " s"],
    ["L = Iω", fmt(I * omNow, 2)],
  ]);
};

/* Static equilibrium: two conditions, two halves of the picture. ΣF = 0 is the
 * arrows, Στ = 0 is the pair of arcs about the pivot — drawn to scale, so when
 * they are the same size the beam sits there and when they are not it goes
 * over. A figure that stayed rigid while printing a non-zero net torque would
 * be teaching that torque does nothing.
 *
 * Torques are ANTICLOCKWISE POSITIVE and measured about x_pivot, matching the
 * solver: tau_net is the net moment of the two WEIGHTS about that point, and it
 * is zero exactly when the pivot sits under the centre of mass. */
RENDERERS["statics"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const g = GRAVITY;
  const L = clamp(posOr(p.L_beam, 4), 0.05, 5000);
  const mBeam = Math.max(numOr(p.m_beam, 12), 0);
  const mLoad = Math.max(numOr(p.m_load, 30), 0);
  const xLoad = clamp(numOr(p.x_load, L * 0.28), -1.5 * L, 2.5 * L);
  const xPiv = clamp(numOr(p.x_pivot, 0), -1.5 * L, 2.5 * L);
  const Wb = mBeam * g, Wl = mLoad * g;

  // The three arrangements share one torque sum but not one picture. Drawing
  // props under a beam that is really on a single pivot is exactly how a plate
  // reading tau_net = 25 N·m ends up beside a figure that visibly balances.
  const mode = (Number.isFinite(p.T_stat) || Number.isFinite(p.theta_stat)) ? "cable"
    : (Number.isFinite(p.F_left) || Number.isFinite(p.F_right)) ? "props"
    : Number.isFinite(p.tau_net) ? "single"
    : "props";

  // The moment of the two weights about the reader's pivot, which is what the
  // solver calls tau_net. Anticlockwise positive: a weight to the RIGHT of the
  // pivot turns the beam clockwise and so contributes negatively.
  const tauWeights = -(Wb * (L / 2 - xPiv) + Wl * (xLoad - xPiv));

  const thCable = clamp(Math.abs(numOr(p.theta_stat, 35)), 1, 89) * DEG_TO_RAD;
  const Rr = (Wb * (L / 2) + Wl * xLoad) / L;
  const Rl = Wb + Wl - Rr;
  const FL = numOr(p.F_left, Rl);
  const FR = numOr(p.F_right, Rr);
  // Only the component of the cable tension across the beam has a moment arm
  // about a point ON the beam; the along-beam component's line of action runs
  // straight through it. That is the whole of why T = ... / sinθ.
  const Tcab = posOr(p.T_stat, (Wb * (L / 2) + Wl * xLoad) / Math.max(L * Math.sin(thCable), 1e-9));
  const Tv = Tcab * Math.sin(thCable);
  const hingeY = Wb + Wl - Tv;

  const contrib = [-Wb * (L / 2 - xPiv)];
  if (mLoad > 0) contrib.push(-Wl * (xLoad - xPiv));
  if (mode === "props") { contrib.push(FL * (0 - xPiv)); contrib.push(FR * (L - xPiv)); }
  else if (mode === "cable") { contrib.push(Tv * (L - xPiv)); contrib.push(hingeY * (0 - xPiv)); }
  // A single pivot contributes nothing: its own force has no moment arm about
  // itself, which is why choosing it as the pivot is worth doing.

  let ccwSum = 0, cwSum = 0;
  contrib.forEach((v) => { if (v >= 0) ccwSum += v; else cwSum -= v; });
  const netCcw = ccwSum - cwSum;
  const tauShown = mode === "single" ? numOr(p.tau_net, tauWeights) : netCcw;

  const scaleTau = Math.max(ccwSum, cwSum, Math.abs(tauShown), Math.abs(tauWeights), 1e-9);
  const liftLeft = mode === "props" && FL < -1e-9;
  const liftRight = mode === "props" && FR < -1e-9;

  // What actually turns it, and about what. A prop can only PUSH, so a negative
  // reaction means the beam has already left that support and is pivoting on
  // the other one — which is a different pivot from the one the reader chose.
  let tipTau = 0, tipPivot = xPiv;
  if (mode === "single") tipTau = tauShown;
  else if (liftLeft) { tipPivot = L; tipTau = -(Wb * (L / 2 - L) + Wl * (xLoad - L)); }
  else if (liftRight) { tipPivot = 0; tipTau = -(Wb * (L / 2) + Wl * xLoad); }
  const tips = Math.abs(tipTau) > 0.02 * scaleTau;

  // --- how far over it has gone -------------------------------------------
  // A rigid body turning about the pivot: alpha = tau·cos(phi)/I, integrated
  // rather than eased, so the beam starts from rest the way a real one does.
  const Ipiv = mBeam * ((L * L) / 12 + Math.pow(L / 2 - tipPivot, 2)) + mLoad * Math.pow(xLoad - tipPivot, 2);
  const PHI_STOP = 0.42;
  let phiCcw = 0;
  const TIP_PLAY = 2.6, HOLD_S = 1.5, cycS = TIP_PLAY + HOLD_S;
  const fadeS = tips ? loopFade(t, cycS, 0.5) : 1;
  if (tips && Ipiv > 1e-12 && Math.abs(tipTau) > 1e-12) {
    // Play the fall at whatever rate puts the stop about TIP_PLAY seconds out;
    // a beam that tips in 90 ms and one that takes 12 s are both unwatchable.
    const tChar = Math.sqrt((2 * Ipiv * PHI_STOP) / Math.abs(tipTau));
    const rate = tChar / TIP_PLAY;
    const uSec = Math.min(t % cycS, TIP_PLAY) * rate;
    const dtI = tChar / 400;
    const n = Math.min(Math.max(Math.round(uSec / dtI), 0), 1200);
    let om = 0;
    for (let i = 0; i < n; i++) {
      om += ((tipTau * Math.cos(phiCcw)) / Ipiv) * dtI;
      phiCcw += om * dtI;
      // A rigid stop: the beam meets the ground and its angular VELOCITY goes,
      // but its angle stays continuous, which is what the eye actually tracks.
      if (Math.abs(phiCcw) >= PHI_STOP) { phiCcw = Math.sign(phiCcw) * PHI_STOP; break; }
    }
  }
  // Canvas y runs down, so a positive (anticlockwise) rotation is a negative
  // canvas one. Getting this backwards tipped the beam toward the light end.
  const phi = -phiCcw;

  // --- fit ------------------------------------------------------------------
  const world = newWorld(0, 0);
  includePoint(world, L, 0, 0);
  includePoint(world, xLoad, L * 0.22, 0);
  includePoint(world, xPiv, 0, 0);
  includePoint(world, L / 2, -L * 0.20, L * 0.08);
  if (mode === "cable") includePoint(world, L + L * 0.22 * Math.cos(thCable), L * 0.30, 0);
  const view = fitView("solver-statics", w, h, world, { pad: 0.19 });

  const X = view.X, Y = view.Y;
  const pivPx = { x: X(xPiv), y: Y(0) };
  const rotPx = { x: X(tipPivot), y: Y(0) };
  const beamH = clamp(view.S(L) * 0.035, 3, 14);

  ctx.save();
  ctx.globalAlpha = fadeS;
  ctx.translate(rotPx.x, rotPx.y);
  ctx.rotate(phi);
  ctx.translate(-rotPx.x, -rotPx.y);

  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  roundRectPath(ctx, X(0), Y(0) - beamH / 2, Math.max(view.S(L), 2), beamH, Math.min(3, beamH / 2));
  ctx.fill();
  ctx.stroke();

  if (mLoad > 0) {
    const cw = clamp(view.S(L) * 0.10, 8, 44);
    const chh = cw * 0.72;
    ctx.fillStyle = PALETTE.crimson;
    ctx.globalAlpha = 0.55 * fadeS;
    ctx.fillRect(X(xLoad) - cw / 2, Y(0) - beamH / 2 - chh, cw, chh);
    ctx.globalAlpha = fadeS;
    ctx.strokeStyle = PALETTE.crimson;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(X(xLoad) - cw / 2, Y(0) - beamH / 2 - chh, cw, chh);
  }

  // Weights from the points they actually act at — that is the whole difference
  // between this figure and the free-body tab, where the arms are thrown away.
  const fPx = (F) => clamp((Math.abs(F) / Math.max(Wb + Wl, 1e-9)) * Math.min(h * 0.26, 80), 8, 92);
  drawArrow(ctx, X(L / 2), Y(0), X(L / 2), Y(0) + fPx(Wb), PALETTE.navy, 2);
  drawLabel(ctx, X(L / 2) + 8, Y(0) + fPx(Wb) + 9, "m_beam·g", PALETTE.navy, 10, "left");
  if (mLoad > 0) {
    drawArrow(ctx, X(xLoad), Y(0), X(xLoad), Y(0) + fPx(Wl), PALETTE.crimson, 2);
    drawLabel(ctx, X(xLoad) - 8, Y(0) + fPx(Wl) + 9, "m_load·g", PALETTE.crimson, 10, "right");
  }

  if (mode === "props") {
    [[0, FL, "F_left"], [L, FR, "F_right"]].forEach((entry) => {
      const xx = entry[0], FF = entry[1], lab = entry[2];
      const up = FF >= 0;
      const len = fPx(FF);
      drawArrow(ctx, X(xx), Y(0), X(xx), Y(0) - (up ? len : -len), up ? PALETTE.forest : PALETTE.crimson, 2.2);
      drawLabel(ctx, X(xx), Y(0) - (up ? len + 12 : -len - 12), lab + " = " + fmt(FF, 1) + " N",
        up ? PALETTE.forest : PALETTE.crimson, 10);
    });
  } else if (mode === "cable") {
    const cl = clamp(view.S(L) * 0.30, 26, 150);
    const ex = X(L) + cl * Math.cos(thCable), ey = Y(0) - cl * Math.sin(thCable);
    drawArrow(ctx, X(L), Y(0), ex, ey, PALETTE.brass, 2.4);
    drawLabel(ctx, ex + 6, ey - 10, "T = " + fmt(Tcab, 1) + " N", PALETTE.brass, 10, "left");
    // Only this component has a moment arm about a point on the beam.
    ctx.save();
    ctx.setLineDash([4, 3]);
    drawArrow(ctx, X(L), Y(0), X(L), Y(0) - cl * Math.sin(thCable), PALETTE.forest, 1.7);
    ctx.restore();
    drawLabel(ctx, X(L) - 8, Y(0) - cl * Math.sin(thCable) * 0.6, "T·sinθ", PALETTE.forest, 9.5, "right");
    drawAngleArc(ctx, X(L), Y(0), Math.min(cl * 0.45, 34), -thCable, 0, PALETTE.brass,
      fmt(thCable / DEG_TO_RAD, 0) + "°");
    drawArrow(ctx, X(0), Y(0), X(0), Y(0) - fPx(hingeY), PALETTE.forest, 2);
    drawLabel(ctx, X(0), Y(0) - fPx(hingeY) - 12, "hinge", PALETTE.forest, 10);
  }
  ctx.restore();

  // Supports stay put while the beam turns off them.
  const props = mode === "props" ? [0, L] : mode === "cable" ? [0] : [xPiv];
  props.forEach((xx) => {
    const s = clamp(view.S(L) * 0.045, 5, 18);
    ctx.save();
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(X(xx), Y(0) + beamH / 2);
    ctx.lineTo(X(xx) - s, Y(0) + beamH / 2 + s * 1.6);
    ctx.lineTo(X(xx) + s, Y(0) + beamH / 2 + s * 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });

  // The point the torques are taken about, which is the reader's free choice.
  ctx.save();
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.arc(pivPx.x, pivPx.y, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawLabel(ctx, pivPx.x, pivPx.y + 22, "pivot x = " + fmt(xPiv, 2) + " m", PALETTE.brass, 10);

  // --- the two arcs, drawn to scale ----------------------------------------
  // The gentle pulse is the same idiom the free-body tab uses: it says the
  // figure is live at the moment when, correctly, nothing is moving at all.
  const pulse = 1 + Math.sin(t * 2) * 0.04;
  const arcR = clamp(Math.min(w, h) * 0.13, 14, 74);
  const maxSweep = 2.1;
  const sw = (mag) => clamp((mag / scaleTau) * maxSweep, 0, maxSweep) * pulse;
  if (cwSum > 0) drawArcArrow(ctx, pivPx.x, pivPx.y, arcR, -Math.PI * 0.72, -Math.PI * 0.72 + sw(cwSum), PALETTE.crimson, 2);
  if (ccwSum > 0) drawArcArrow(ctx, pivPx.x, pivPx.y, arcR * 1.30, -Math.PI * 0.28, -Math.PI * 0.28 - sw(ccwSum), PALETTE.forest, 2);
  drawLabel(ctx, pivPx.x, pivPx.y - arcR * 1.5 - 10, "anticlockwise +", PALETTE.forest, 9.5);

  const xCm = (Wb + Wl) > 0 ? (Wb * (L / 2) + Wl * xLoad) / (Wb + Wl) : L / 2;
  const plate = [
    ["supports", mode === "props" ? "two props" : mode === "cable" ? "hinge + cable" : "one pivot"],
    ["Στ ccw", fmt(ccwSum, 1) + " N·m"],
    ["Στ cw", fmt(cwSum, 1) + " N·m"],
    ["τ_net", fmt(tauShown, 2) + " N·m"],
    ["τ of the weights", fmt(tauWeights, 2) + " N·m"],
    ["centre of mass", "x = " + fmt(xCm, 3) + " m"],
    ["verdict", tips ? (liftLeft || liftRight ? "a prop cannot pull" : "not balanced — it tips") : "balanced",
      tips ? PALETTE.crimson : PALETTE.forest],
  ];
  drawDataPlate(ctx, 10, 10, Math.min(200, Math.max(w - 20, 20)), plate);
  drawCaption(ctx, w / 2, h - 12, "Fig. — Static Equilibrium (ΣF = 0 and Στ = 0)", PALETTE.inkSoft, 11);
};

/* Relative velocity: drawn in the GROUND frame, because that is the frame the
 * landing point lives in. The boat points one way and travels another, and the
 * two vectors that add to make that happen are drawn on the boat itself rather
 * than parked in a corner. */
RENDERERS["relative-velocity"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const vB = clamp(posOr(p.v_boat, 4), 0.01, 5000);
  const vC = Math.max(numOr(p.v_current, 1.8), 0);
  const W = clamp(posOr(p.w_river, 90), 0.1, 100000);
  // Past 85 degrees of heading the boat is pointing along the bank and the
  // crossing time runs away to infinity; the reader is told rather than shown a
  // boat that never arrives.
  const thRaw = numOr(p.theta_head, 0);
  const th = clamp(thRaw, -85, 85) * DEG_TO_RAD;

  // Everything the picture shows is derived from the HEADING it draws. The two
  // crossings in this chapter are different trips: t_cross = w/√(v_b²−v_c²) is
  // the aimed-upstream ferry, while heading straight across takes w/v_boat and
  // lands drift = v_c·w/v_boat downstream. Taking t_cross straight out of `p`
  // and printing it under a straight-across boat labelled one trip with the
  // other's time.
  const across = vB * Math.cos(th);
  const downstream = vC - vB * Math.sin(th);
  const tCross = W / across;
  const drift = downstream * tCross;
  const vG = Math.hypot(across, downstream);
  const ferryPossible = vC < vB;
  const ferryAngle = ferryPossible ? Math.asin(clamp(vC / vB, -1, 1)) / DEG_TO_RAD : null;
  const ferryT = ferryPossible ? W / Math.sqrt(Math.max(vB * vB - vC * vC, 1e-12)) : null;
  // A supplied value that does not belong to the drawn heading is reported as
  // the other trip rather than quietly overwriting this one.
  const givenT = Number.isFinite(p.t_cross) && Math.abs(p.t_cross - tCross) > 0.02 * Math.abs(tCross)
    ? p.t_cross : null;

  const world = newWorld(0, 0);
  includePoint(world, drift, W, 0);
  includePoint(world, Math.min(0, drift) - W * 0.22, 0, 0);
  includePoint(world, Math.max(0, drift) + W * 0.22, W, 0);
  const view = fitView("solver-relvel", w, h, world, { pad: 0.15 });

  const bankLo = view.Y(0), bankHi = view.Y(W);

  // --- the river -----------------------------------------------------------
  ctx.save();
  ctx.fillStyle = PALETTE.panel;
  ctx.globalAlpha = 0.45;
  ctx.fillRect(0, bankHi, w, Math.max(bankLo - bankHi, 1));
  ctx.restore();
  [bankLo, bankHi].forEach((yy) => {
    ctx.save();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
    ctx.restore();
  });

  // The water scrolls at the current's own speed, wrapped on the streak
  // spacing, so this part of the picture is seamless whatever the loop does.
  const streakGap = clamp(w * 0.09, 16, 64);
  const flow = ((vC * t * view.scale) % streakGap + streakGap) % streakGap;
  ctx.save();
  ctx.strokeStyle = PALETTE.navy;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1.2;
  const rows = Math.max(Math.floor((bankLo - bankHi) / Math.max(streakGap * 0.55, 6)), 1);
  for (let r = 1; r < rows; r++) {
    const yy = bankHi + (r / rows) * (bankLo - bankHi);
    for (let x = -streakGap; x < w + streakGap; x += streakGap) {
      const sx = x + flow + (r % 2) * streakGap * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, yy);
      ctx.lineTo(sx + streakGap * 0.34, yy);
      ctx.stroke();
    }
  }
  ctx.restore();
  drawLabel(ctx, 12, (bankHi + bankLo) / 2, "current " + fmt(vC, 2) + " m/s →", PALETTE.navy, 10, "left");

  // --- the crossing --------------------------------------------------------
  const PLAY_R = 4.2, HOLD_R = 1.0, cycR = PLAY_R + HOLD_R;
  const uR = t % cycR;
  const fadeR = loopFade(t, cycR, 0.45);
  const prog = clamp(uR / PLAY_R, 0, 1);
  const bxW = drift * prog, byW = W * prog;
  const bxP = view.X(bxW), byP = view.Y(byW);

  drawDashedLine(ctx, view.X(0), bankLo, view.X(drift), bankHi, PALETTE.rule, 1.2, [4, 5]);
  // straight-across reference, so the drift is a gap the eye can measure
  drawDashedLine(ctx, view.X(0), bankLo, view.X(0), bankHi, PALETTE.inkSoft, 1, [2, 5]);

  // landing point and the drift it cost
  ctx.save();
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.arc(view.X(drift), bankHi, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (Math.abs(view.X(drift) - view.X(0)) > 6) {
    drawArrow(ctx, view.X(0), bankHi - 16, view.X(drift), bankHi - 16, PALETTE.crimson, 1.8);
    drawLabel(ctx, view.X(drift / 2), bankHi - 28, "drift = " + fmt(drift, 1) + " m", PALETTE.crimson, 10);
  } else {
    drawLabel(ctx, view.X(drift), bankHi - 20, "lands straight across", PALETTE.forest, 10);
  }

  // --- the boat, pointing along its HEADING while it travels along v_ground -
  const hull = clamp(Math.min(w, h) * 0.055, 7, 26);
  const headScreen = Math.atan2(-Math.cos(th), -Math.sin(th));   // heading, in screen angles
  ctx.save();
  ctx.globalAlpha = fadeR;
  ctx.translate(bxP, byP);
  ctx.rotate(headScreen);
  ctx.fillStyle = PALETTE.brass;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(hull, 0);
  ctx.lineTo(-hull * 0.55, hull * 0.42);
  ctx.lineTo(-hull * 0.75, 0);
  ctx.lineTo(-hull * 0.55, -hull * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // the two vectors that add, drawn head to tail on the boat, and the sum
  const vScale = clamp(Math.min(w, h) * 0.26 / Math.max(vB, vC, 1e-9), 0.5, 400);
  const hx = bxP + Math.sin(-th) * vB * vScale;
  const hy = byP - Math.cos(th) * vB * vScale;
  ctx.save();
  ctx.globalAlpha = fadeR;
  drawArrow(ctx, bxP, byP, hx, hy, PALETTE.navy, 2.2);
  drawLabel(ctx, hx - 10, hy - 8, "v_boat", PALETTE.navy, 10, "right");
  const cx2 = hx + vC * vScale, cy2 = hy;
  if (vC > 1e-9) {
    drawArrow(ctx, hx, hy, cx2, cy2, PALETTE.forest, 2);
    drawLabel(ctx, (hx + cx2) / 2, hy - 10, "v_current", PALETTE.forest, 10);
  }
  drawArrow(ctx, bxP, byP, cx2, cy2, PALETTE.brass, 2.4);
  drawLabel(ctx, cx2 + 8, cy2 + 12, "v_ground", PALETTE.brass, 10, "left");
  ctx.restore();

  const plate = [
    ["v_boat", fmt(vB, 2) + " m/s"],
    ["v_current", fmt(vC, 2) + " m/s"],
    ["heading", fmt(thRaw, 1) + "° upstream"],
    ["v_ground", fmt(vG, 2) + " m/s"],
    ["this trip: t", fmt(tCross, 2) + " s"],
    ["this trip: drift", fmt(drift, 2) + " m"],
    ferryPossible
      ? ["ferry: aim " + fmt(ferryAngle, 1) + "°", fmt(ferryT, 2) + " s, no drift"]
      : ["current ≥ boat", "no heading crosses", PALETTE.crimson],
  ];
  // Named as the other crossing rather than substituted into this one.
  if (givenT !== null) plate.push(["given t_cross", fmt(givenT, 2) + " s (other heading)", PALETTE.brass]);
  drawDataPlate(ctx, Math.max(w - 200, 8), 10, Math.min(190, Math.max(w - 20, 20)), plate);
  drawCaption(ctx, w / 2, h - 10, "Fig. — Crossing, drawn in the ground frame", PALETTE.inkSoft, 11);
};

/* Banked curve, in CROSS-SECTION. A perspective track hides the one thing the
 * chapter is about — the direction of N — so the figure cuts the road in half
 * instead and puts the lap in a small plan-view inset. The centre of the circle
 * is off to the LEFT, which is why N leans that way. */
RENDERERS["banked-curve"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const g = GRAVITY;
  const R = clamp(posOr(p.r_bank, 45), 0.05, 1e6);
  const thB = clamp(Math.abs(numOr(p.theta_bank_b, 18)), 0.4, 75) * DEG_TO_RAD;
  const mu = Math.max(numOr(p.mu_bank, 0), 0);
  const mass = posOr(p.mass_bank, 900);
  const tanT = Math.tan(thB);
  const vIdeal = Math.sqrt(g * R * tanT);
  const v = clamp(posOr(p.v_bank, vIdeal), 0.01, 1e5);

  const vMax = numOr(p.v_max_bank,
    mu * tanT < 1 ? Math.sqrt(Math.max((g * R * (tanT + mu)) / (1 - mu * tanT), 0)) : Infinity);
  const vMin = numOr(p.v_min_bank,
    tanT <= mu ? 0 : Math.sqrt(Math.max((g * R * (tanT - mu)) / (1 + mu * tanT), 0)));
  const N = numOr(p.Fn_bank, mass * (g * Math.cos(thB) + ((v * v) / R) * Math.sin(thB)));
  // Positive means friction has to act DOWN the slope, which is what happens
  // when the board is going faster than the bank alone can turn it.
  const fNeed = mass * (((v * v) / R) * Math.cos(thB) - g * Math.sin(thB));
  const holds = v >= vMin - 1e-9 && v <= vMax + 1e-9;

  const wide = w >= 460 && h >= 210;
  const stageW = wide ? w * 0.62 : w;

  // --- fit the wedge -------------------------------------------------------
  const run = 1;
  const rise = run * tanT;
  const world = newWorld(0, 0);
  includePoint(world, run, rise, 0);
  includePoint(world, run, 0, 0);
  includePoint(world, 0, 0, run * 0.08);
  includePoint(world, run * 0.55, rise * 0.55 + run * 0.30, 0);
  const view = fitView("solver-banked", stageW, h, world, { pad: 0.17 });

  // road surface, from the inner edge (toward the centre) up to the outer edge
  ctx.save();
  ctx.fillStyle = PALETTE.panel;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(view.X(0), view.Y(0));
  ctx.lineTo(view.X(run), view.Y(rise));
  ctx.lineTo(view.X(run), view.Y(0));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(view.X(0), view.Y(0));
  ctx.lineTo(view.X(run), view.Y(rise));
  ctx.stroke();
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(view.X(0), view.Y(0));
  ctx.lineTo(view.X(run), view.Y(0));
  ctx.lineTo(view.X(run), view.Y(rise));
  ctx.stroke();
  ctx.restore();
  drawAngleArc(ctx, view.X(0), view.Y(0), Math.min(view.S(run) * 0.30, 46), -thB, 0, PALETTE.brass,
    fmt(thB / DEG_TO_RAD, 1) + "°");
  drawDashedLine(ctx, view.X(0), view.Y(0), view.X(0) - Math.min(stageW * 0.14, 60), view.Y(0),
    PALETTE.rule, 1, [3, 4]);
  drawLabel(ctx, 8, view.Y(0) - 10, "← centre of the curve", PALETTE.inkSoft, 10, "left");

  // --- where the board actually sits ---------------------------------------
  // Outside the friction window it will not stay put, so it is drawn easing to
  // the side it slips toward. A picture that held still while the numbers said
  // it could not would be the figure lying about the answer.
  const slipTarget = holds ? 0 : (v > vMax ? 0.20 : -0.20);
  const slip = slipTarget * (1 - Math.exp(-t / 1.6));
  const f0 = clamp(0.52 + slip, 0.08, 0.94);
  const sx = view.X(run * f0), sy = view.Y(rise * f0);
  const board = clamp(Math.min(stageW, h) * 0.20, 10, 96);
  drawSkateboard(ctx, sx, sy, board, -thB, {});

  // centre of the rider, lifted off the surface along the outward normal
  const nxs = -Math.sin(thB), nys = -Math.cos(thB);      // outward normal, screen
  const gx = sx + nxs * board * 0.22, gy = sy + nys * board * 0.22;

  const fScale = Math.min(h * 0.24, 78) / Math.max(N, 1e-9);
  const nLen = clamp(N * fScale, 10, 120);
  const wLen = clamp(mass * g * fScale, 8, 120);
  drawArrow(ctx, gx, gy, gx + nxs * nLen, gy + nys * nLen, PALETTE.forest, 2.4);
  drawLabel(ctx, gx + nxs * (nLen + 16), gy + nys * (nLen + 12), "N", PALETTE.forest, 11);
  drawArrow(ctx, gx, gy, gx, gy + wLen, PALETTE.navy, 2.2);
  drawLabel(ctx, gx + 14, gy + wLen * 0.75, "mg", PALETTE.navy, 11, "left");

  // N split the way the algebra splits it: the vertical part holds the weight
  // up, and the horizontal part is the ENTIRE centripetal force.
  const nv = nLen * Math.cos(thB), nh = nLen * Math.sin(thB);
  ctx.save();
  ctx.setLineDash([4, 3]);
  drawArrow(ctx, gx, gy, gx, gy - nv, PALETTE.brass, 1.7);
  drawArrow(ctx, gx, gy, gx - nh, gy, PALETTE.crimson, 1.7);
  ctx.restore();
  drawLabel(ctx, gx + 10, gy - nv - 8, "N·cosθ = mg", PALETTE.brass, 9.5, "left");
  drawLabel(ctx, gx - nh - 6, gy + 13, "N·sinθ = mv²/R", PALETTE.crimson, 9.5, "right");

  if (mu > 0 && Math.abs(fNeed) > 1e-9) {
    const fLen = clamp(Math.abs(fNeed) * fScale, 6, 90);
    const dir = fNeed > 0 ? -1 : 1;         // +fNeed acts DOWN the slope
    const ux = Math.cos(thB) * dir, uy = -Math.sin(thB) * dir;
    drawArrow(ctx, gx, gy, gx + ux * fLen, gy + uy * fLen, PALETTE.ink, 2);
    drawLabel(ctx, gx + ux * (fLen + 16), gy + uy * (fLen + 10), "f", PALETTE.ink, 10);
  }

  drawCaption(ctx, stageW / 2, h * 0.07, "Fig. — Banked Curve, cross-section", PALETTE.inkSoft, 11.5);
  sideNameplate(ctx, 10, h - 34, "Rider", "Mr. J's Skateboard", PALETTE.crimson);

  // --- plan-view inset and the speed window --------------------------------
  if (wide) {
    const ix = stageW + (w - stageW) * 0.46;
    const iy = h * 0.31;
    const ir = clamp(Math.min((w - stageW) * 0.34, h * 0.20), 10, 90);
    ctx.save();
    ctx.strokeStyle = PALETTE.rule;
    ctx.lineWidth = Math.max(ir * 0.16, 3);
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // The lap is played at a watchable rate rather than the real one; the real
    // lap time is printed instead of being acted out.
    const lapReal = (2 * Math.PI * R) / v;
    const lapPlay = clamp(lapReal, 2.5, 8);
    const la = (t / lapPlay) * Math.PI * 2;
    const dx = ix + Math.cos(la) * ir, dy = iy + Math.sin(la) * ir;
    drawDashedLine(ctx, ix, iy, dx, dy, PALETTE.rule, 1, [2, 4]);
    discShade(ctx, dx, dy, Math.max(ir * 0.11, 3), PALETTE.crimson, 1);
    drawArrow(ctx, dx, dy, dx + (ix - dx) * 0.34, dy + (iy - dy) * 0.34, PALETTE.crimson, 1.8);
    drawLabel(ctx, ix, iy, "R = " + fmt(R, 1) + " m", PALETTE.inkSoft, 10);
    drawLabel(ctx, ix, iy - ir - 12, "plan view — " + fmt(lapReal, 1) + " s per lap", PALETTE.inkSoft, 10);

    // the speed window this bank allows
    const gx0 = stageW + 14, gx1 = w - 14, gy = h * 0.66;
    const top = Math.max(Number.isFinite(vMax) ? vMax : v * 1.4, v, vIdeal) * 1.15;
    const SX = (vv) => gx0 + (gx1 - gx0) * clamp(vv / Math.max(top, 1e-9), 0, 1);
    ctx.save();
    ctx.fillStyle = PALETTE.forest;
    ctx.globalAlpha = 0.28;
    const hiV = Number.isFinite(vMax) ? vMax : top;
    ctx.fillRect(SX(vMin), gy - 9, Math.max(SX(hiV) - SX(vMin), 1), 18);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx0, gy + 9);
    ctx.lineTo(gx1, gy + 9);
    ctx.stroke();
    ctx.restore();
    drawDashedLine(ctx, SX(vIdeal), gy - 12, SX(vIdeal), gy + 12, PALETTE.brass, 1.2, [3, 3]);
    drawLabel(ctx, SX(vIdeal), gy - 19, "no-friction v", PALETTE.brass, 9.5);
    drawArrow(ctx, SX(v), gy + 26, SX(v), gy + 11, holds ? PALETTE.crimson : PALETTE.crimson, 2);
    drawLabel(ctx, SX(v), gy + 36, "v = " + fmt(v, 1), PALETTE.crimson, 10);
    drawLabel(ctx, (gx0 + gx1) / 2, gy - 34, mu > 0 ? "speeds this bank can hold" : "frictionless: one speed only",
      PALETTE.inkSoft, 10);
  }

  const plate = [
    ["θ", fmt(thB / DEG_TO_RAD, 1) + "°"],
    ["R", fmt(R, 1) + " m"],
    ["v", fmt(v, 2) + " m/s"],
    ["√(gR·tanθ)", fmt(vIdeal, 2) + " m/s"],
    ["v_min, v_max", fmt(vMin, 2) + ", " + (Number.isFinite(vMax) ? fmt(vMax, 2) : "∞")],
    ["N", fmt(N, 0) + " N"],
    ["verdict", holds ? "holds" : v > vMax ? "too fast — rides up" : "too slow — slides down",
      holds ? PALETTE.forest : PALETTE.crimson],
    ["mass", "cancels from the speed"],
  ];
  drawDataPlate(ctx, 10, Math.max(8, h - 16 - plate.length * 15), Math.min(196, Math.max(w - 20, 20)), plate);
};

/* Springs in series and parallel, side by side, released together. Students
 * predict this backwards almost every time — series feels like "two springs, so
 * stiffer" — so the two rigs are driven off ONE release and left to drift
 * apart. By the third swing the parallel mass is visibly ahead, and no amount
 * of algebra makes that argument as well. */
RENDERERS["springs-combo"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const k1 = clamp(posOr(p.k1_sp, 40), 0.001, 1e8);
  const k2 = clamp(posOr(p.k2_sp, 60), 0.001, 1e8);
  const mass = clamp(posOr(p.mass_sp, 2), 1e-4, 1e6);
  const kSer = (k1 * k2) / (k1 + k2);
  const kPar = k1 + k2;
  const Tser = 2 * Math.PI * Math.sqrt(mass / kSer);
  const Tpar = 2 * Math.PI * Math.sqrt(mass / kPar);
  const arrangement = numOr(p.arrangement_sp, 0);

  // Both rigs run on ONE clock, so the drift the reader watches is the real
  // ratio rather than a consequence of the playback rate. The slower rig
  // normally sets the pace at 2.6 s a cycle — but series is always softer, so a
  // stiffness ratio in the hundreds puts the parallel rig at several cycles per
  // FRAME, where it aliases into a blur that shows nothing at all. Past that
  // point the faster rig sets the pace instead and the series one is left
  // visibly creeping, which is honest: that is what a 600:1 ratio looks like.
  const ratioSP = Tser / Tpar;                 // ≥ 1: series is always the longer
  const stretch = Math.max(1, (0.55 * ratioSP) / 2.6);   // ≥ 33 frames a cycle at 60fps
  const SCREEN_T = 2.6 * stretch;
  const xs = Math.cos((2 * Math.PI * t) / SCREEN_T);
  const xp = Math.cos((2 * Math.PI * t * ratioSP) / SCREEN_T);

  const ceilY = h * 0.15;
  const eqY = h * 0.60;
  const amp = clamp(Math.min(h * 0.12, (eqY - ceilY) * 0.34), 4, 46);
  const wide = w >= 470;
  const xSer = wide ? w * 0.21 : w * 0.27;
  const xPar = wide ? w * 0.49 : w * 0.73;
  const bw = clamp(Math.min(w, h) * 0.10, 12, 46);
  const bh = bw * 0.62;

  const mount = (cx) => {
    ctx.save();
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - bw, ceilY);
    ctx.lineTo(cx + bw, ceilY);
    ctx.stroke();
    for (let d = -bw + 3; d <= bw - 3; d += 8) {
      ctx.beginPath();
      ctx.moveTo(cx + d, ceilY);
      ctx.lineTo(cx + d - 6, ceilY + 8);
      ctx.stroke();
    }
    ctx.restore();
  };
  const block = (cx, cy, colour) => {
    ctx.save();
    ctx.fillStyle = PALETTE.panel;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    roundRectPath(ctx, cx - bw / 2, cy, bw, bh, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  // --- series --------------------------------------------------------------
  mount(xSer);
  const ySer = eqY + amp * xs;
  // The two springs in series carry the SAME force, so they share the total
  // extension in inverse proportion to their stiffnesses. Drawing the junction
  // at the halfway mark would quietly deny the very thing that makes the pair
  // softer than either spring alone.
  const share = kSer / k1;
  const jRest = ceilY + (eqY - ceilY) * 0.5;
  const yJunc = jRest + amp * xs * share;
  drawSpringCoil(ctx, xSer, ceilY, xSer, yJunc, 5, PALETTE.navy);
  ctx.save();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(xSer - bw * 0.35, yJunc);
  ctx.lineTo(xSer + bw * 0.35, yJunc);
  ctx.stroke();
  ctx.restore();
  drawSpringCoil(ctx, xSer, yJunc, xSer, ySer, 5, PALETTE.forest);
  drawDashedLine(ctx, xSer - bw, eqY, xSer + bw, eqY, PALETTE.rule, 1, [3, 4]);
  block(xSer, ySer, PALETTE.navy);
  drawLabel(ctx, xSer, ceilY - 14, "SERIES", PALETTE.navy, 11.5);
  drawLabel(ctx, xSer, eqY + amp + bh + 22, "k_eq = " + fmt(kSer, 2) + " N/m", PALETTE.navy, 10);
  drawLabel(ctx, xSer, eqY + amp + bh + 36, "T = " + fmt(Tser, 2) + " s", PALETTE.navy, 10);

  // --- parallel ------------------------------------------------------------
  mount(xPar);
  const yPar = eqY + amp * xp;
  const sep = Math.max(bw * 0.34, 13);
  drawSpringCoil(ctx, xPar - sep, ceilY, xPar - sep, yPar, 7, PALETTE.navy);
  drawSpringCoil(ctx, xPar + sep, ceilY, xPar + sep, yPar, 7, PALETTE.forest);
  drawDashedLine(ctx, xPar - bw, eqY, xPar + bw, eqY, PALETTE.rule, 1, [3, 4]);
  block(xPar, yPar, PALETTE.crimson);
  drawLabel(ctx, xPar, ceilY - 14, "PARALLEL", PALETTE.crimson, 11.5);
  drawLabel(ctx, xPar, eqY + amp + bh + 22, "k_eq = " + fmt(kPar, 2) + " N/m", PALETTE.crimson, 10);
  drawLabel(ctx, xPar, eqY + amp + bh + 36, "T = " + fmt(Tpar, 2) + " s", PALETTE.crimson, 10);

  // The rig the reader is actually solving, ringed so the two do not blur into
  // one another once they are out of step.
  if (arrangement === 1 || arrangement === 2) {
    const cx = arrangement === 1 ? xSer : xPar;
    ctx.save();
    ctx.strokeStyle = PALETTE.brass;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    roundRectPath(ctx, cx - bw * 1.45, ceilY - 26, bw * 2.9, (eqY + amp + bh + 46) - (ceilY - 26), 6);
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, cx, ceilY - 32, "your case", PALETTE.brass, 10);
  }

  if (wide) {
    const px0 = w * 0.66, px1 = w - 14;
    const barY = h * 0.44;
    const tMax = Math.max(Tser, Tpar, 1e-9);
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = PALETTE.navy;
    ctx.fillRect(px0, barY - 18, (px1 - px0) * (Tser / tMax), 11);
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(px0, barY, (px1 - px0) * (Tpar / tMax), 11);
    ctx.restore();
    drawLabel(ctx, px0, barY - 26, "period, to scale", PALETTE.inkSoft, 10, "left");
    drawLabel(ctx, px0, barY + 26, "series is the LONGER one", PALETTE.inkSoft, 10, "left");
    // Wrapped, because the raw lead grows without bound and a readout that ends
    // up at 412 cycles stops meaning anything.
    const lead = (((2 * Math.PI * t * (Tser / Tpar - 1)) / SCREEN_T) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    drawDataPlate(ctx, px0, h * 0.55, Math.max(px1 - px0, 20), [
      ["k1, k2", fmt(k1, 1) + ", " + fmt(k2, 1) + " N/m"],
      ["m", fmt(mass, 2) + " kg"],
      ["T_ser / T_par", fmt(Tser / Tpar, 3)],
      ["parallel leads by", fmt(lead / DEG_TO_RAD, 0) + "°"],
      ["series k_eq", "below either spring"],
    ]);
  }
  drawCaption(ctx, w / 2, h - 10, "Fig. — Same release, same mass, different k_eq", PALETTE.inkSoft, 11);
};

/* Physical pendulum: the stick and the simple pendulum of the SAME length d,
 * released together from the same angle. They separate almost immediately,
 * which is the whole answer to why T = 2π√(d/g) is not merely imprecise here
 * but wrong by about a third. */
RENDERERS["physical-pendulum"] = function (ctx, w, h, t, p) {
  if (!stageReady(ctx, w, h)) return;
  p = p || {};
  const g = GRAVITY;
  const L = clamp(posOr(p.L_stick_pp, 1.2), 0.01, 1e4);
  // A hole further from the centre than the stick's own half-length is not a
  // hole in the stick, and the drawing has to stay a drawing of a stick.
  const d = clamp(posOr(p.d_pp, 0.35 * L), 0.008 * L, 0.49 * L);
  const mass = posOr(p.m_pp, 1.5);
  const I = posOr(p.I_pp, mass * ((L * L) / 12 + d * d));
  const T = posOr(p.T_pp, 2 * Math.PI * Math.sqrt(I / (mass * g * d)));
  const Tsimple = 2 * Math.PI * Math.sqrt(d / g);
  const dMin = numOr(p.d_min_pp, L / Math.sqrt(12));

  // Both are played on one clock: the stick's period is put at 2.6 s and the
  // ghost is scaled by the same factor, so the drift on screen is the real one.
  // A hole close to the centre of mass sends the stick's period away to
  // infinity while the ghost's stays put, and past a ratio of about five the
  // ghost would alias; there the ghost sets the pace and the stick creeps.
  const ratioPP = T / Tsimple;          // ≥ 1: the stick's own I always slows it
  const SCREEN_T = 2.6 * Math.max(1, (0.55 * ratioPP) / 2.6);
  const th0 = 0.26;                     // small angle — the regime T = 2π√(I/mgd) assumes
  const thStick = th0 * Math.cos((2 * Math.PI * t) / SCREEN_T);
  const thGhost = th0 * Math.cos((2 * Math.PI * t * ratioPP) / SCREEN_T);

  const wide = w >= 470 && h >= 220;
  const stageW = wide ? w * 0.64 : w;

  const rBot = L / 2 + d, rTop = L / 2 - d;
  const world = newWorld(0, 0);
  [-th0, 0, th0].forEach((a) => {
    includePoint(world, rBot * Math.sin(a), -rBot * Math.cos(a), L * 0.06);
    includePoint(world, -rTop * Math.sin(a), rTop * Math.cos(a), L * 0.06);
  });
  const view = fitView("solver-physpend", stageW, h, world, { pad: 0.16 });
  const px = view.X(0), py = view.Y(0);

  // bracket
  ctx.save();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(px - 30, py);
  ctx.lineTo(px + 30, py);
  ctx.stroke();
  for (let dd = -26; dd <= 26; dd += 8) {
    ctx.beginPath();
    ctx.moveTo(px + dd, py);
    ctx.lineTo(px + dd - 6, py + 8);
    ctx.stroke();
  }
  ctx.restore();

  // --- the ghost, first, so the stick reads as the subject -----------------
  const ghostR = view.S(d);
  const ggx = px + ghostR * Math.sin(thGhost), ggy = py + ghostR * Math.cos(thGhost);
  ctx.save();
  ctx.globalAlpha = 0.55;
  drawDashedLine(ctx, px, py, ggx, ggy, PALETTE.crimson, 1.6, [5, 4]);
  ctx.strokeStyle = PALETTE.crimson;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(ggx, ggy, Math.max(view.S(L) * 0.05, 4), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, ggx + 12, ggy + 14, "simple, length d", PALETTE.crimson, 9.5, "left");

  // --- the stick -----------------------------------------------------------
  const stickW = Math.max(view.S(L) * 0.055, 4);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(thStick);
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  roundRectPath(ctx, -stickW / 2, -view.S(rTop), stickW, view.S(rTop) + view.S(rBot), Math.min(3, stickW / 2));
  ctx.fill();
  ctx.stroke();
  // the centre of mass, at d below the hole, drawn as the standard split disc
  const comY = view.S(d);
  const cr = Math.max(stickW * 0.62, 4);
  ctx.beginPath();
  ctx.arc(0, comY, cr, 0, Math.PI * 2);
  ctx.strokeStyle = PALETTE.brass;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.moveTo(0, comY); ctx.arc(0, comY, cr, 0, Math.PI / 2); ctx.closePath();
  ctx.moveTo(0, comY); ctx.arc(0, comY, cr, Math.PI, Math.PI * 1.5); ctx.closePath();
  ctx.fill();
  // the lever arm itself
  ctx.strokeStyle = PALETTE.brass;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(stickW * 0.8, 0);
  ctx.lineTo(stickW * 0.8, comY);
  ctx.stroke();
  ctx.restore();

  drawLabel(ctx, px + view.S(d) * Math.sin(thStick) * 0.5 + 26,
    py + view.S(d) * Math.cos(thStick) * 0.5, "d = " + fmt(d, 3) + " m", PALETTE.brass, 10, "left");

  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.arc(px, py, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawLabel(ctx, px - 12, py - 12, "pivot", PALETTE.ink, 10, "right");
  drawCaption(ctx, stageW / 2, h - 12, "Fig. — Stick vs. simple pendulum of the same d", PALETTE.inkSoft, 11);

  // --- T(d), and the minimum nobody expects --------------------------------
  if (wide) {
    const gx0 = stageW + 16, gx1 = w - 14;
    const gy0 = h * 0.20, gy1 = h * 0.55;
    const Tof = (dd) => 2 * Math.PI * Math.sqrt(((L * L) / 12 + dd * dd) / (g * dd));
    const dLo = 0.04 * L, dHi = 0.5 * L;
    let tHi = 0;
    for (let i = 0; i <= 60; i++) tHi = Math.max(tHi, Tof(dLo + ((dHi - dLo) * i) / 60));
    const GX = (dd) => gx0 + (gx1 - gx0) * clamp((dd - dLo) / (dHi - dLo), 0, 1);
    const GY = (TT) => gy1 - (gy1 - gy0) * clamp(TT / Math.max(tHi, 1e-9), 0, 1);
    ctx.save();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx0, gy0 - 4); ctx.lineTo(gx0, gy1); ctx.lineTo(gx1, gy1);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.navy;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 70; i++) {
      const dd = dLo + ((dHi - dLo) * i) / 70;
      const gx = GX(dd), gy = GY(Tof(dd));
      if (i === 0) ctx.moveTo(gx, gy); else ctx.lineTo(gx, gy);
    }
    ctx.stroke();
    ctx.restore();
    drawDashedLine(ctx, GX(dMin), gy0, GX(dMin), gy1, PALETTE.brass, 1.2, [3, 3]);
    drawLabel(ctx, GX(dMin), gy0 - 10, "d = L/√12", PALETTE.brass, 9.5);
    if (d >= dLo && d <= dHi) {
      ctx.save();
      ctx.fillStyle = PALETTE.crimson;
      ctx.beginPath();
      ctx.arc(GX(d), GY(Tof(d)), 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    drawLabel(ctx, (gx0 + gx1) / 2, gy1 + 14, "T against d", PALETTE.inkSoft, 10);
  }

  const err = Tsimple > 0 ? (Tsimple / T - 1) * 100 : 0;
  const plate = [
    ["L, d", fmt(L, 3) + ", " + fmt(d, 3) + " m"],
    ["I about the pivot", fmt(I, 4) + " kg·m²"],
    ["T (stick)", fmt(T, 3) + " s", PALETTE.forest],
    ["T = 2π√(d/g)", fmt(Tsimple, 3) + " s", PALETTE.crimson],
    ["simple formula", fmt(err, 1) + "% off", PALETTE.crimson],
    ["T is least at d", fmt(dMin, 3) + " m"],
  ];
  drawDataPlate(ctx, 10, Math.max(8, h - 16 - plate.length * 15), Math.min(196, Math.max(stageW - 20, 20)), plate);
};
