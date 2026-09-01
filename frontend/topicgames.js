/* ============================================================================
   Topic mini-games — seven benches, one committed number each
   ----------------------------------------------------------------------------
   Same bargain as the rod and the force table: the reader works the algebra on
   paper, commits to a number, and only then is the experiment released. What is
   released is built from THEIR number, not from the truth with an error bar
   painted on it. A period 4% short does not get a caption saying "4% short" —
   it gets a metronome that has run three beats ahead by cycle twenty.

   Three rules run through the whole file.

   1. Rounds are built BACKWARDS. The window the answer must land in is fixed
      first, then one given is solved for to steer it there, then that given is
      rounded to the precision it is PRINTED at and the answer is recomputed
      from the printed value. The number on the card and the number being
      graded are therefore the same number.

   2. A named misconception must be separable from being right. Every detector
      here runs through `detect`, which drops any candidate whose value sits
      within `gap` of the true answer — the sin45 = cos45 trap that once had
      the conical pendulum accusing correct readers of a mistake — and stands
      down entirely when two different routes land on one number.

   3. `misconception` is null whenever `correct` is true, structurally: every
      result is assembled by `makeResult`, which nulls it.

   Depends on animate.js for PALETTE (read at call time, never at load) and on
   scenarios.js for the configured g. Neither is required for the module to
   evaluate; both are required before anything is drawn.
   ========================================================================== */

const TopicGames = (function () {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const TAU = Math.PI * 2;
  const MONO = '"IBM Plex Mono", Consolas, monospace';

  /* g travels from the backend through scenarios.js and can land after this
     file has parsed, so it is read per call rather than captured. `typeof` on
     a `let` that has not been evaluated yet THROWS instead of returning
     "undefined", so the guard has to be a try/catch: a script tag placed above
     scenarios.js would otherwise take the whole module down. */
  function g() {
    try {
      if (typeof GRAVITY === "number" && Number.isFinite(GRAVITY) && GRAVITY > 0) return GRAVITY;
    } catch (err) { /* scenarios.js has not run yet */ }
    return 9.8;
  }

  function pal() {
    try {
      if (typeof PALETTE !== "undefined" && PALETTE && PALETTE.ink) return PALETTE;
    } catch (err) { /* animate.js has not run yet */ }
    return null;
  }

  /* --- numbers -------------------------------------------------------------- */

  function rr(v, dp) { const f = Math.pow(10, dp); return Math.round(v * f) / f; }

  // Significant figures, for quantities whose magnitude swings over decades —
  // a drag coefficient rounded to a fixed 4 dp is 0.0490 for one round and
  // 2.4000 for the next, and the first has thrown away three of its digits.
  function sig(v, n) {
    if (!Number.isFinite(v) || v === 0) return v;
    const m = Math.pow(10, n - 1 - Math.floor(Math.log10(Math.abs(v))));
    return Math.round(v * m) / m;
  }

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function uni(lo, hi) { return lo + Math.random() * (hi - lo); }
  function cl(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function fx(v, d) { return Number.isFinite(v) ? v.toFixed(d) : "—"; }

  function grid(lo, hi, step) {
    const out = [];
    const n = Math.round((hi - lo) / step);
    for (let i = 0; i <= n; i++) out.push(rr(lo + i * step, 6));
    return out;
  }

  // ln(cosh u), which is the quadratic-drag drop distance and nothing else.
  // cosh overflows to Infinity a little past u = 710 and every ratio taken
  // afterwards comes back NaN, which is a blank stage rather than a wrong
  // number; this form is exact for every u and costs one exp.
  function lncosh(u) {
    const a = Math.abs(u);
    return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
  }

  // Answers arrive as strings from form fields, and on a comma-decimal
  // keyboard they arrive as "0,40". Anything unparseable comes back NaN and is
  // reported as a blank field, never graded as wrong.
  function num(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    if (typeof v !== "string") return NaN;
    const s = v.trim().replace(",", ".");
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function wrapDeg(d) { return ((d % 360) + 360) % 360; }

  // Signed separation in (-180, 180]. Angles are graded on this: 359° and 1°
  // are two degrees apart, not three hundred and fifty-eight.
  function degDelta(a, b) {
    let d = wrapDeg(a - b);
    if (d > 180) d -= 360;
    return d;
  }
  function degGap(a, b) { return Math.abs(degDelta(a, b)); }

  /* --- the detector gate ---------------------------------------------------
     A candidate wrong route is named only when the number typed lands on it
     AND that number is far enough from the truth that "on the candidate" and
     "correct" cannot be the same answer. Two live candidates matching one
     typed number means the module cannot tell which mistake was made, so it
     names neither. Silence beats a wrong accusation. */
  function detect(guess, truth, cands, opts) {
    const o = opts || {};
    const metric = o.metric || function (a, b) { return Math.abs(a - b); };
    const near = o.near;
    const gap = o.gap;
    if (!Number.isFinite(guess)) return null;
    const hit = [];
    let veto = false;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c || !Number.isFinite(c.value)) continue;
      const onIt = metric(c.value, guess) <= near;
      // Too close to the truth to be worth naming -- but a route that cannot be
      // told from being right is still a route the reader may have walked, so a
      // number sitting ON it VETOES the naming instead of quietly dropping out.
      // Without the veto the loaded beam told a reader who had inverted the mass
      // ratio that the beam tips at its far end: inverting the ratio happened to
      // land near the truth that round, so it was suppressed, and the end of the
      // beam was then the only candidate left standing near their number.
      if (metric(c.value, truth) <= gap) { if (onIt) veto = true; continue; }
      if (onIt) hit.push(c);
    }
    if (veto || !hit.length) return null;
    for (let i = 1; i < hit.length; i++) if (hit[i].id !== hit[0].id) return null;
    return { id: hit[0].id, label: hit[0].label, detail: hit[0].detail };
  }

  /* --- results -------------------------------------------------------------- */

  function verdict(kind, text) { return { kind: kind, text: text }; }

  function blankResult() {
    return {
      correct: false,
      blank: true,
      verdict: verdict("miss", "Nothing entered"),
      feedback: "Every box needs a number before the experiment is released. The round is still yours.",
      misconception: null,
      solution: [],
      exact: {},
      tolerance: {},
    };
  }

  // The single place a graded result is built, so the rule that a correct
  // reader is never told which mistake they made cannot be forgotten in one
  // of seven grading functions.
  function makeResult(o) {
    return {
      correct: !!o.correct,
      blank: false,
      verdict: o.verdict,
      feedback: o.feedback,
      misconception: o.correct ? null : (o.misconception || null),
      solution: o.solution || [],
      exact: o.exact || {},
      tolerance: o.tolerance || {},
    };
  }

  // Reads every field the round declared. Returns null — a blank — if any one
  // of them is empty or unparseable, or if a choice arrives as something the
  // round never offered.
  function readFields(specs, answers) {
    const src = answers || {};
    const out = {};
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const raw = src[s.key];
      if (s.choices) {
        const v = String(raw == null ? "" : raw).trim();
        let ok = false;
        for (let j = 0; j < s.choices.length; j++) if (s.choices[j].value === v) ok = true;
        if (!ok) return null;
        out[s.key] = v;
      } else {
        const n = num(raw);
        if (!Number.isFinite(n)) return null;
        out[s.key] = n;
      }
    }
    return out;
  }

  /* --- drawing primitives ---------------------------------------------------
     Local rather than borrowed from animate.js: these seven scenes are drawn
     at sizes from 320x200 upward and need their own head sizes and alignment,
     and a module that draws with its own primitives cannot be broken by a
     signature change in a file it does not own. PALETTE is still the shared
     one — the theme must not fork. */

  function lab(ctx, x, y, text, colour, size, align, weight) {
    ctx.save();
    ctx.font = (weight || 500) + " " + (size || 11) + "px " + MONO;
    ctx.fillStyle = colour;
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text), x, y);
    ctx.restore();
  }

  function arrow(ctx, x1, y1, x2, y2, colour, width) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (!(len > 1)) return;
    const ux = dx / len, uy = dy / len;
    const head = Math.min(9, len * 0.42);
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = width || 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - ux * head * 0.7, y2 - uy * head * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * head - uy * head * 0.45, y2 - uy * head + ux * head * 0.45);
    ctx.lineTo(x2 - ux * head + uy * head * 0.45, y2 - uy * head - ux * head * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function dash(ctx, x1, y1, x2, y2, colour, width, pattern) {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width || 1;
    ctx.setLineDash(pattern || [4, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // Label left, value right, so a column of readings lines up on its decimal
  // point instead of ragging out behind labels of different lengths.
  function plate(ctx, x, y, w, rows, P) {
    const lineH = 15;
    const h = 16 + rows.length * lineH;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = P.panel;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.font = "400 11px " + MONO;
    ctx.textBaseline = "middle";
    for (let i = 0; i < rows.length; i++) {
      const yy = y + 8 + i * lineH + lineH / 2;
      ctx.textAlign = "left";
      ctx.fillStyle = P.inkSoft;
      ctx.fillText(String(rows[i][0]), x + 8, yy);
      ctx.textAlign = "right";
      ctx.fillStyle = rows[i][2] || P.ink;
      ctx.fillText(String(rows[i][1]), x + w - 8, yy);
    }
    ctx.restore();
    return h;
  }

  function tag(ctx, x, y, kind, name, colour, P) {
    ctx.save();
    const text = kind + ": " + name;
    ctx.font = "500 11px " + MONO;
    const w = ctx.measureText(text).width + 18;
    const h = 22;
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = P.panel;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = colour;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 9, y + h / 2 + 0.5);
    ctx.restore();
  }

  /* The host paints its own verdict in a translucent plate at bottom CENTRE,
     about fourteen pixels up, over whatever the scene left there. The bench
     nameplate is the least load-bearing thing on the stage, so it takes the
     bottom-left corner on a wide stage and is dropped entirely on a narrow one,
     where a long verdict reaches far enough left to sit on top of it. */
  function bench(ctx, w, h, name, P) {
    // 820 rather than a rounder number: the host centres its plate, so the gap
    // between the plate's left edge and this one closes as the stage narrows,
    // and the longest verdict this file can emit reaches x = 195 at about 790.
    if (!(w >= 820 && h > 200)) return;
    // animate.js's plate when it is there, so the seven benches here look like
    // the twelve elsewhere; the local one only covers the case where this file
    // is loaded on its own.
    if (typeof sideNameplate === "function") {
      sideNameplate(ctx, 12, h - 40, "Experiment", name, P.crimson);
      return;
    }
    tag(ctx, 12, h - 40, "Experiment", name, P.crimson, P);
  }

  function disc(ctx, x, y, r, stroke, fill, width) {
    if (!(r > 0.4)) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width || 1.4;
    ctx.stroke();
    ctx.restore();
  }

  function ease(t) { t = cl(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* Below this the scene is a diagram, not a bench: plates and tags eat the
     whole stage and the reader is better served by the bodies alone. */
  function compact(w, h) { return w < 430 || h < 250; }

  /* ============================================================================
     THE METRONOME
     ----------------------------------------------------------------------------
     Both oscillator games end the same way, because there is only one honest
     way to show a 3% period error: set a metronome to the period the reader
     PREDICTED and let it run against the real oscillator for twenty cycles. Nothing
     is annotated. The two of them simply go out of step, and the direction they
     drift is the sign of the error — a metronome running ahead of the mass
     means the reader predicted too short a period, which is exactly what
     adding two series spring constants does to you.
     ========================================================================== */

  function drawMetronome(ctx, cx, baseY, hgt, cycles, P, colour) {
    const bodyW = hgt * 0.46;
    const needleL = hgt * 0.78;
    const pivotY = baseY - hgt * 0.10;
    // A metronome's needle is at an extreme on the beat, and the oscillator is
    // released from ITS extreme, so both start on a tick and every later
    // separation is drift rather than a phase offset chosen at t = 0.
    const swing = 0.40 * Math.cos(TAU * cycles);
    const beatPhase = (cycles * 2) % 1;
    const ticking = beatPhase < 0.10 || beatPhase > 0.90;

    ctx.save();
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - bodyW / 2, baseY);
    ctx.lineTo(cx - bodyW * 0.16, baseY - hgt * 0.86);
    ctx.lineTo(cx + bodyW * 0.16, baseY - hgt * 0.86);
    ctx.lineTo(cx + bodyW / 2, baseY);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    const nx = cx + Math.sin(swing) * needleL;
    const ny = pivotY - Math.cos(swing) * needleL;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, pivotY);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.restore();

    // the sliding weight, at a fixed station on the needle
    const wx = cx + Math.sin(swing) * needleL * 0.55;
    const wy = pivotY - Math.cos(swing) * needleL * 0.55;
    ctx.save();
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(wx - hgt * 0.055, wy - hgt * 0.035, hgt * 0.11, hgt * 0.07);
    ctx.restore();

    disc(ctx, cx, pivotY, Math.max(hgt * 0.03, 1.5), P.rule, P.paper, 1.2);
    if (ticking && hgt > 40) {
      disc(ctx, nx, ny, Math.max(hgt * 0.05, 2), colour, colour, 1);
    }
    return { x: nx, y: ny };
  }

  /* ============================================================================
     CATALOGUE
     ========================================================================== */

  const CATALOGUE = [
    {
      id: "spring-combo",
      name: "Springs in combination",
      group: "Oscillations",
      blurb: "Two springs and a block. Decide what the pair is worth, predict the period, then "
        + "run a metronome at your number against the real oscillator for twenty cycles.",
    },
    {
      id: "physical-pendulum-game",
      name: "The drilled stick",
      group: "Oscillations",
      blurb: "A stick with holes every 5 cm, hung on a nail. It is not a simple pendulum, and the "
        + "difference shows up inside two swings.",
    },
    {
      id: "terminal-velocity",
      name: "Terminal velocity",
      group: "Kinematics",
      blurb: "Drop a body into still air and predict where its speed levels off — or how long it "
        + "takes to get most of the way there. It never quite arrives.",
    },
    {
      id: "river-crossing",
      name: "River crossing",
      group: "Kinematics",
      blurb: "A boat, a current, and a marker straight across. Set the heading, then watch where "
        + "the boat you aimed actually lands.",
    },
    {
      id: "beam-balance",
      name: "Static equilibrium",
      group: "Forces & Newton's laws",
      blurb: "A uniform beam on two supports with a load on it. Στ = 0 and ΣF = 0, and the beam's "
        + "own weight is a term with nothing on the diagram to hang it on.",
    },
    {
      id: "collision-2d-game",
      name: "Two-dimensional collision",
      group: "Momentum",
      blurb: "Two pucks meet and stick. Momentum is a vector and speed is not, and the difference "
        + "is drawn as the angle between where you said they would go and where they go.",
    },
    {
      id: "angular-impulse",
      name: "Angular impulse",
      group: "Rotation",
      blurb: "A torque applied to a body at rest for a stated time. Predict the spin, then watch "
        + "your ghost rotor drift away from the real one.",
    },
  ];

  const LADDERS = {
    "spring-combo": ["k given", "k from the static stretch", "Series or parallel"],
    "physical-pendulum-game": ["I given", "Parallel axis", "Find the fastest hole"],
    "terminal-velocity": ["Terminal speed", "Time to 95%", "Quadratic drag"],
    "river-crossing": ["Land straight across", "Crossing time too", "Fastest crossing"],
    "beam-balance": ["One unknown support", "Both supports", "Where does the load go"],
    "collision-2d-game": ["Right angles", "Any angles", "Energy lost too"],
    "angular-impulse": ["Perpendicular force", "Force at an angle", "Work and power too"],
  };

  function tierOf(id, difficulty) {
    const ladder = LADDERS[id] || [];
    if (typeof difficulty === "number" && Number.isFinite(difficulty)) {
      return cl(Math.round(difficulty) - 1, 0, 2);
    }
    const key = String(difficulty == null ? "" : difficulty).trim();
    const exact = ladder.indexOf(key);
    if (exact >= 0) return exact;
    const low = key.toLowerCase();
    for (let i = 0; i < ladder.length; i++) if (ladder[i].toLowerCase() === low) return i;
    if (low === "easy" || low === "1") return 0;
    if (low === "hard" || low === "3") return 2;
    return 1;
  }

  /* ============================================================================
     MODULE STATE
     ========================================================================== */

  const state = { id: null, round: null, result: null, anim: null, marks: {} };

  // Every drawer records where it actually put its bodies. Nothing in the app
  // reads this; the verification harness does, because the preview pane cannot
  // composite frames and a teleport is otherwise invisible — the only way to
  // catch one is to tick the clock by hand and check that no single frame moved
  // a body more than a few percent of the stage.
  function mark(name, x, y) { state.marks[name] = { x: x, y: y }; }

  const MAX_DT = 0.05;

  /* ============================================================================
     GAME 1 — spring-combo, "Springs in combination"
     ----------------------------------------------------------------------------
     Parallel springs share the load, so their constants ADD and the pair is
     stiffer than either: k_eq = k1 + k2, and T = 2*pi*sqrt(m/k_eq) is SHORTER.
     Series springs pass the whole load through both, so their compliances add:
     1/k_eq = 1/k1 + 1/k2, the pair is softer than either, and the period is
     LONGER. Almost every reader predicts that backwards, so every round here is
     generated with the two rules at least a factor of two apart in period — the
     ratio T_series/T_parallel = (k1+k2)/sqrt(k1*k2) is never below 2 — and the
     metronome is then set to whichever number they typed.

     The middle tier hands over the static stretch instead of the constant.
     k = mg/x0 collapses the whole problem to T = 2*pi*sqrt(x_eq/g): the mass
     divides straight out, and g enters ONLY through the stretch. The reader is
     told the mass anyway, because noticing that it cancels is the lesson.
     ========================================================================== */

  const SPRING_K = grid(15, 90, 5);
  const SPRING_X = grid(0.03, 0.22, 0.005);
  const SPRING_M = grid(0.20, 3.00, 0.05);

  // A lab spring: stiff enough to hold the block, soft enough to watch.
  function springSane(k) { return k >= 8 && k <= 320; }

  function springArrangementText(kind) {
    return kind === "series"
      ? "The block hangs from the lower end of spring B; spring B hangs from the lower end of "
        + "spring A; spring A hangs from the ceiling. The whole load passes through both."
      : "Both springs hang from the ceiling side by side, and the block is fixed to the lower end "
        + "of both at once. They stretch by the same amount.";
  }

  function springCombine(kind, k1, k2) {
    return kind === "parallel" ? k1 + k2 : (k1 * k2) / (k1 + k2);
  }

  function springMake(tier) {
    const G = g();
    const kind = Math.random() < 0.5 ? "series" : "parallel";
    let k1 = 0, k2 = 0, m = 0, x1 = 0, x2 = 0;

    for (let attempt = 0; attempt < 900; attempt++) {
      if (tier === 1) {
        // Built on the stretches, because those are what is printed. x_eq adds
        // in series and combines reciprocally in parallel — the mirror image of
        // the constants, which is the whole point of the tier.
        x1 = pick(SPRING_X);
        x2 = pick(SPRING_X);
        const xeq = kind === "series" ? x1 + x2 : (x1 * x2) / (x1 + x2);
        const T0 = TAU * Math.sqrt(xeq / G);
        if (T0 < 0.48 || T0 > 1.05) continue;
        m = pick(SPRING_M);
        k1 = (m * G) / x1;
        k2 = (m * G) / x2;
        if (!springSane(k1) || !springSane(k2)) continue;
      } else {
        k1 = pick(SPRING_K);
        k2 = pick(SPRING_K);
        const keq0 = springCombine(kind, k1, k2);
        // Solve for the mass that lands the period in the window, then round it
        // to the two decimals it is printed at and recompute — otherwise the
        // card says 0.42 kg while the grader is holding 0.4183.
        const want = uni(0.52, 1.00);
        m = rr((keq0 * want * want) / (TAU * TAU), 2);
        if (m < 0.10 || m > 6) continue;
        const T0 = TAU * Math.sqrt(m / keq0);
        if (T0 < 0.48 || T0 > 1.05) continue;
        x1 = (m * G) / k1;
        x2 = (m * G) / k2;
      }

      const keq = springCombine(kind, k1, k2);
      const kOther = springCombine(kind === "series" ? "parallel" : "series", k1, k2);
      const T = TAU * Math.sqrt(m / keq);
      const Tother = TAU * Math.sqrt(m / kOther);
      // Assert rather than assume: if the two rules ever landed within tolerance
      // of one another, a reader who chose the wrong physics would be graded
      // correct and the tier would be decoration.
      if (Math.abs(Tother - T) < 0.30 * T) continue;

      const tol = Math.max(0.015 * T, 0.008);
      const xeqStatic = (m * G) / keq;

      const givens = [];
      if (tier === 1) {
        givens.push({ label: "Stretch under the block, spring A alone, x1", value: fx(x1, 3), unit: "m" });
        givens.push({ label: "Stretch under the block, spring B alone, x2", value: fx(x2, 3), unit: "m" });
        givens.push({ label: "Block mass, m", value: fx(m, 2), unit: "kg" });
      } else {
        givens.push({ label: "Spring A, k1", value: fx(k1, 1), unit: "N/m" });
        givens.push({ label: "Spring B, k2", value: fx(k2, 1), unit: "N/m" });
        givens.push({ label: "Block mass, m", value: fx(m, 2), unit: "kg" });
      }
      givens.push({ label: "g", value: fx(G, 2), unit: "m/s^2" });

      const inputs = [];
      if (tier === 2) {
        inputs.push({
          key: "arrangement", label: "The pair is joined",
          choices: [
            { value: "series", label: "in series (one below the other)" },
            { value: "parallel", label: "in parallel (side by side)" },
          ],
        });
      }
      inputs.push({ key: "period", label: "Period of one oscillation", unit: "s", step: "0.001" });

      const prompt = tier === 2
        ? "Read the arrangement off the description below, decide which combination rule it obeys, "
          + "and predict the period of the block on the pair."
        : tier === 1
          ? "Hung from spring A on its own the block stretches it by x1; hung from spring B on its "
            + "own it stretches it by x2. The two springs are then joined " + kind
            + " and the block is set oscillating. Predict the period."
          : "The two springs below are joined " + kind + " and the block is set oscillating on the "
            + "pair. Predict the period of one oscillation.";

      const note = tier === 2
        ? springArrangementText(kind) + "  Springs in series are SOFTER than either one alone."
        : tier === 1
          ? "The block's mass is on the label. Go through k = mg/x0 if you like, but check whether "
            + "m is still there at the end."
          : "Parallel springs share the load; series springs each carry all of it.";

      return {
        game: "spring-combo", tier: tier, kind: kind, g: G,
        k1: k1, k2: k2, m: m, x1: x1, x2: x2, keq: keq, kOther: kOther,
        T: T, Tother: Tother, tol: tol, xeqStatic: xeqStatic,
        givens: givens, inputs: inputs, prompt: prompt, note: note,
      };
    }
    return null;
  }

  function springSolution(R) {
    const s = [];
    if (R.tier === 1) {
      s.push("k = mg/x0 for each spring on its own:");
      s.push("  k1 = mg/x1 = " + fx(R.m * R.g, 3) + "/" + fx(R.x1, 3) + " = " + fx(R.k1, 2) + " N/m");
      s.push("  k2 = mg/x2 = " + fx(R.m * R.g, 3) + "/" + fx(R.x2, 3) + " = " + fx(R.k2, 2) + " N/m");
    }
    if (R.kind === "series") {
      s.push("Series    1/k_eq = 1/k1 + 1/k2 = " + fx(1 / R.k1, 5) + " + " + fx(1 / R.k2, 5)
        + "   ->   k_eq = " + fx(R.keq, 3) + " N/m   (softer than either)");
    } else {
      s.push("Parallel  k_eq = k1 + k2 = " + fx(R.k1, 2) + " + " + fx(R.k2, 2) + " = "
        + fx(R.keq, 3) + " N/m   (stiffer than either)");
    }
    s.push("Period    T = 2*pi*sqrt(m/k_eq) = 2*pi*sqrt(" + fx(R.m, 3) + "/" + fx(R.keq, 3)
      + ") = " + fx(R.T, 4) + " s");
    if (R.tier === 1) {
      const xeq = R.kind === "series" ? R.x1 + R.x2 : (R.x1 * R.x2) / (R.x1 + R.x2);
      s.push("Shortcut  m cancels: T = 2*pi*sqrt(x_eq/g) with x_eq = " + fx(xeq, 4) + " m gives the "
        + "same " + fx(TAU * Math.sqrt(xeq / R.g), 4) + " s. The mass never mattered.");
    }
    s.push("The other rule would have given " + fx(R.Tother, 4) + " s — a factor of "
      + fx(Math.max(R.T, R.Tother) / Math.min(R.T, R.Tother), 2) + " away, not a rounding error.");
    return s;
  }

  function springGrade(R, f) {
    const guess = f.period;
    const chose = R.tier === 2 ? f.arrangement : R.kind;
    const arrangementOk = chose === R.kind;
    const dT = guess - R.T;
    const periodOk = Math.abs(dT) <= R.tol;
    const correct = periodOk && arrangementOk;

    const wrongRuleId = R.kind === "series" ? "series-added" : "parallel-reciprocal";
    const wrongRuleLabel = R.kind === "series"
      ? "Series springs are SOFTER, not stiffer"
      : "Parallel springs are STIFFER, not softer";
    const wrongRuleDetail = R.kind === "series"
      ? " You added the two constants. In series the load passes through both springs, so the"
        + " COMPLIANCES add: 1/k_eq = 1/k1 + 1/k2. The pair is softer than either spring alone and"
        + " the period is longer, not shorter. Adding them gives " + fx(R.Tother, 3)
        + " s against a true " + fx(R.T, 3) + " s."
      : " You combined the constants reciprocally. In parallel each spring carries part of the load"
        + " and both stretch by the same amount, so the constants simply add: k_eq = k1 + k2. The"
        + " pair is stiffer than either alone and the period is shorter.";

    const cands = [
      { id: wrongRuleId, label: wrongRuleLabel, detail: wrongRuleDetail, value: R.Tother },
      {
        id: "no-reciprocal",
        label: "The reciprocal was never inverted",
        detail: " 1/k1 + 1/k2 is 1/k_eq, not k_eq. You stopped one step early, so the number used"
          + " as a spring constant was about " + fx(1 / R.k1 + 1 / R.k2, 4) + " N/m.",
        value: TAU * Math.sqrt(R.m / (1 / R.k1 + 1 / R.k2)),
      },
      {
        id: "period-inverted",
        label: "m and k are the wrong way up",
        detail: " T = 2*pi*sqrt(m/k). A heavier block oscillates more SLOWLY, so m belongs on top;"
          + " sqrt(k/m) is the angular frequency, not the period.",
        value: TAU * Math.sqrt(R.keq / R.m),
      },
      {
        id: "no-two-pi",
        label: "The 2*pi is missing",
        detail: " sqrt(m/k) is 1/omega, in seconds per radian. A full cycle is 2*pi radians, so the"
          + " period is 2*pi times that.",
        value: Math.sqrt(R.m / R.keq),
      },
      {
        id: "averaged-k",
        label: "The constants were averaged",
        detail: " Springs do not average. Side by side they add; end to end their compliances add."
          + " Neither operation is (k1+k2)/2.",
        value: TAU * Math.sqrt(R.m / ((R.k1 + R.k2) / 2)),
      },
    ];

    let mis = null;
    if (!correct) {
      if (!arrangementOk) {
        mis = {
          id: "arrangement-misread",
          label: "That is the other arrangement",
          detail: " " + springArrangementText(R.kind) + " That is a " + R.kind + " pair, and a "
            + R.kind + " pair is " + (R.kind === "series" ? "SOFTER" : "STIFFER")
            + " than either spring on its own.",
        };
      } else {
        mis = detect(guess, R.T, cands, {
          near: Math.max(R.tol * 1.5, R.T * 0.025),
          gap: Math.max(R.tol * 3, R.T * 0.06),
        });
      }
    }

    // Twenty cycles of the real oscillator is the yardstick the reveal counts
    // in, so the feedback is quoted in the same units.
    const driftCycles = Number.isFinite(guess) && guess > 0 ? 20 * (R.T / guess - 1) : 0;

    let v;
    if (correct) v = verdict("hit", "In step after 20 cycles");
    else if (!arrangementOk) v = verdict("miss", "Read the arrangement backwards");
    else if (dT > 0) v = verdict("over", "Too slow by " + fx(Math.abs(dT), 3) + " s");
    else v = verdict("under", "Too fast by " + fx(Math.abs(dT), 3) + " s");

    const parts = [];
    if (correct) {
      parts.push("Twenty cycles later the metronome and the block are still striking together");
    } else if (!arrangementOk) {
      parts.push("The description is a " + R.kind + " pair, so the combination rule is the other one");
    } else {
      parts.push(dT > 0
        ? "Your metronome runs slow: over twenty cycles the block completes "
          + fx(Math.abs(driftCycles), 1) + " more than it ticks"
        : "Your metronome runs fast: over twenty cycles it ticks "
          + fx(Math.abs(driftCycles), 1) + " more than the block completes");
    }
    parts.push("Exact period " + fx(R.T, 4) + " s");
    if (!periodOk) parts.push("you were out by " + fx(Math.abs(dT), 4) + " s");

    const out = makeResult({
      correct: correct,
      verdict: v,
      feedback: parts.join(". ") + ".",
      misconception: mis,
      solution: springSolution(R),
      exact: { period: rr(R.T, 5), arrangement: R.kind, k_eq: rr(R.keq, 4) },
      tolerance: { period: rr(R.tol, 5) },
    });
    out.guess = guess;
    out.driftCycles = driftCycles;
    out.arrangementOk = arrangementOk;
    return out;
  }

  /* --- spring reveal -------------------------------------------------------- */

  function springPlay(R, RES) {
    const guess = Number.isFinite(RES.guess) && RES.guess > 0.05 ? RES.guess : R.T;
    // Twenty cycles at a period near a second is twenty seconds of staring, so
    // the clock is geared. One constant factor, never changed mid-run: a rate
    // that shifts partway through is a velocity discontinuity, and a reader
    // would read it as physics.
    const rate = cl((20 * R.T) / 13, 0.85, 2.2);
    return {
      kind: "spring",
      t: 0, sim: 0, dur: (20 * R.T) / rate, rate: rate, done: false,
      amp: Math.min(0.25 * R.xeqStatic, 0.05),
      x: 1, v: 0,                       // in units of the amplitude, released from rest
      cycles: 0, guess: guess,
      omega: TAU / R.T,
    };
  }

  function springStep(A, dt) {
    const n = Math.max(1, Math.ceil((dt * A.rate) / (1 / 480)));
    const hh = (dt * A.rate) / n;
    const w2 = A.omega * A.omega;
    for (let i = 0; i < n; i++) {
      // RK4 on x'' = -omega^2 x. Twenty cycles at 480 Hz accumulates about
      // 3e-8 rad of phase error, six orders below the drift being read off it.
      const vPrev = A.v;
      const k1x = A.v, k1v = -w2 * A.x;
      const k2x = A.v + (hh / 2) * k1v, k2v = -w2 * (A.x + (hh / 2) * k1x);
      const k3x = A.v + (hh / 2) * k2v, k3v = -w2 * (A.x + (hh / 2) * k2x);
      const k4x = A.v + hh * k3v, k4v = -w2 * (A.x + hh * k3x);
      A.x += (hh / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      A.v += (hh / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
      A.sim += hh;
      // A cycle closes when the velocity turns from positive back to negative
      // on the release side of the equilibrium.
      if (vPrev > 0 && A.v <= 0 && A.x > 0) A.cycles++;
    }
  }

  function springDraw(ctx, w, h, P, R, RES, A) {
    const small = compact(w, h);
    const cx = w * (small ? 0.32 : 0.26);
    const ceilY = h * 0.14;
    const ampPx = Math.min(h * 0.055, 26);
    const restLen = h * 0.30;
    const u = A ? A.x : 1;                       // displacement, in units of the amplitude
    const blockW = Math.min(w * 0.16, 68);
    const blockH = Math.max(Math.min(h * 0.09, 34), 6);
    const blockY = ceilY + restLen + u * ampPx;

    ctx.save();
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - blockW, ceilY);
    ctx.lineTo(cx + blockW, ceilY);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      const hx = cx + i * (blockW / 3.2);
      ctx.beginPath();
      ctx.moveTo(hx, ceilY);
      ctx.lineTo(hx - 7, ceilY - 8);
      ctx.stroke();
    }
    ctx.restore();

    const coil = function (x1, y1, x2, y2, coils, colour) {
      if (typeof drawSpringCoil === "function" && Math.hypot(x2 - x1, y2 - y1) > 8) {
        ctx.save();
        drawSpringCoil(ctx, x1, y1, x2, y2, coils, colour);
        ctx.restore();
      } else {
        dash(ctx, x1, y1, x2, y2, colour, 2, [3, 3]);
      }
    };

    if (R.kind === "parallel") {
      coil(cx - blockW * 0.42, ceilY, cx - blockW * 0.42, blockY, 8, P.forest);
      coil(cx + blockW * 0.42, ceilY, cx + blockW * 0.42, blockY, 8, P.navy);
      if (!small) {
        lab(ctx, cx - blockW * 0.42, ceilY - 12, "A", P.forest, 11);
        lab(ctx, cx + blockW * 0.42, ceilY - 12, "B", P.navy, 11);
      }
    } else {
      // The junction gives way by k_eq/k1 of the block's displacement, because
      // the same force runs through both springs and each yields by F/k. A link
      // pinned at the midpoint would misstate how the extension divides.
      const share = R.keq / R.k1;
      const jRest = ceilY + restLen * 0.46;
      const jy = jRest + u * ampPx * share;
      coil(cx, ceilY, cx, jy, 6, P.forest);
      coil(cx, jy, cx, blockY, 6, P.navy);
      ctx.save();
      ctx.fillStyle = P.rule;
      ctx.fillRect(cx - 9, jy - 2.5, 18, 5);
      ctx.restore();
      if (!small) {
        lab(ctx, cx + 22, (ceilY + jy) / 2, "A", P.forest, 11, "left");
        lab(ctx, cx + 22, (jy + blockY) / 2, "B", P.navy, 11, "left");
      }
    }

    dash(ctx, cx - blockW, ceilY + restLen + blockH / 2, cx + blockW,
      ceilY + restLen + blockH / 2, P.rule, 1, [2, 4]);

    if (typeof drawShadow === "function") {
      ctx.save();
      drawShadow(ctx, cx, blockY + blockH + 5, blockW * 0.9, 0.22);
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.6;
    ctx.fillRect(cx - blockW / 2, blockY, blockW, blockH);
    ctx.strokeRect(cx - blockW / 2, blockY, blockW, blockH);
    ctx.restore();
    if (!small) lab(ctx, cx, blockY + blockH / 2, fx(R.m, 2) + " kg", P.ink, 10);
    mark("block", cx, blockY);

    if (A && !small) {
      const mx = w * 0.66;
      const mh = Math.min(h * 0.44, 148);
      const tip = drawMetronome(ctx, mx, h * 0.80, mh, A.sim / A.guess, P, P.brass);
      mark("needle", tip.x, tip.y);
      lab(ctx, mx, h * 0.87, "metronome at " + fx(A.guess, 3) + " s", P.brass, 10);
    }

    if (!small) {
      // The arrangement IS the answer on the hard tier and the combined
      // constant is the last step before it on all three, so neither is on the
      // stage until a number has been committed.
      const rows = RES
        ? [["arrangement", R.kind], ["k_eq", fx(R.keq, 1) + " N/m"]]
        : [["block", fx(R.m, 2) + " kg"], ["k_eq", "— work it out"]];
      if (RES) {
        rows.push(["you predicted", fx(RES.guess, 3) + " s"]);
        rows.push(["true period", fx(R.T, 3) + " s"]);
        if (A) {
          rows.push(["block cycles", String(A.cycles)]);
          rows.push(["metronome beats", String(Math.floor(A.sim / A.guess))]);
          const dr = A.sim / R.T - A.sim / A.guess;
          rows.push(["drift", (dr >= 0 ? "+" : "") + fx(dr, 2) + " cyc",
            Math.abs(dr) < 0.25 ? P.forest : P.crimson]);
        }
      }
      const pw = Math.min(w * 0.32, 200);
      plate(ctx, w - pw - 10, 10, pw, rows, P);
      bench(ctx, w, h, "Spring pair", P);
    }
  }

  /* ============================================================================
     GAME 2 — physical-pendulum-game, "The drilled stick"
     ----------------------------------------------------------------------------
     T = 2*pi*sqrt(I_pivot/(m*g*d)) with I_pivot = m(L^2/12 + d^2) by the
     parallel axis theorem, so

         T = 2*pi*sqrt((L^2/12 + d^2)/(g*d))

     and the mass divides straight out. It is printed anyway, on every tier,
     because a reader who carries it all the way through and watches it cancel
     has learned something a reader who was never offered it has not.

     Two things about this bench are traps, and both are built into the round
     rather than described in a footnote.

     Hanging a metre stick 30 cm from its centre and calling it a simple
     pendulum gives 1.10 s where the truth is 1.53 s. That is 39% and the
     metronome is visibly wrong inside two swings.

     The period is FLAT near its minimum: for a metre stick the best hole
     (28.9 cm) and the hole 4 cm inside it differ by half a percent, which no
     tolerance on a period could ever separate. So the hard tier grades the
     POSITION, to a couple of centimetres, and the reveal draws the T(d) curve
     rather than pretending a stopwatch could tell the difference.
     ========================================================================== */

  const PP_LENGTHS = [0.90, 1.00, 1.20, 1.50];
  const PP_SPACING = 0.05;
  const PP_MASS = grid(0.12, 0.60, 0.02);

  function ppHoles(L) {
    const out = [];
    for (let d = PP_SPACING; d <= L / 2 - PP_SPACING + 1e-9; d += PP_SPACING) out.push(rr(d, 4));
    return out;
  }

  /* The exact minimum sits at L/sqrt(12), which is not generally one of the
     drilled positions. Naming the nearest hole keeps the lab framing honest
     without pretending the optimum lands on it. */
  function ppNearestHole(R) {
    if (!R.holes || !R.holes.length) return R.dMin;
    return R.holes.reduce((best, h) =>
      Math.abs(h - R.dMin) < Math.abs(best - R.dMin) ? h : best, R.holes[0]);
  }

  function ppPeriod(L, d, G) {
    if (!(d > 0)) return Infinity;
    return TAU * Math.sqrt((L * L / 12 + d * d) / (G * d));
  }

  function ppMake(tier) {
    const G = g();
    for (let attempt = 0; attempt < 600; attempt++) {
      const L = pick(PP_LENGTHS);
      const m = pick(PP_MASS);
      const holes = ppHoles(L);
      if (!holes.length) continue;

      if (tier === 2) {
        const dMin = L / Math.sqrt(12);
        const Tmin = ppPeriod(L, dMin, G);
        // A couple of centimetres on a metre: loose enough that the nearest
        // drilled hole always passes, tight enough that the hole one step
        // further in does not. Below that the tier would be ungradeable; above
        // it, it would grade nothing.
        const tol = Math.max(0.025 * L, 0.02);
        const nearest = holes.reduce(function (a, b) {
          return Math.abs(b - dMin) < Math.abs(a - dMin) ? b : a;
        }, holes[0]);
        if (Math.abs(nearest - dMin) > tol * 0.92) continue;   // the bench must have a winning hole
        return {
          game: "physical-pendulum-game", tier: 2, g: G, L: L, m: m, holes: holes,
          dMin: dMin, Tmin: Tmin, tol: tol, nearest: nearest,
          givens: [
            { label: "Stick length, L", value: fx(L, 2), unit: "m" },
            { label: "Stick mass, m", value: fx(m, 2), unit: "kg" },
            { label: "Holes drilled every", value: fx(PP_SPACING, 2), unit: "m" },
            { label: "g", value: fx(G, 2), unit: "m/s^2" },
          ],
          inputs: [{ key: "dmin", label: "Distance from the stick's centre to the best hole", unit: "m", step: "0.001" }],
          prompt: "The stick is uniform and drilled with holes every 5 cm along its length. Hung on "
            + "a nail through one of them it swings as a physical pendulum. WHERE along the stick "
            + "is the swing fastest? Give the distance from the centre — the exact minimum, "
            + "which need not land on a drilled hole.",
          note: "Answer a distance, not a period. The exact minimum sits at L/√12, which need not "
            + "land on a drilled hole — give that distance, and the tolerance covers the nearest "
            + "hole either side. Near the minimum the period barely changes, and that flatness is "
            + "why the position is what gets graded rather than the period.",
        };
      }

      const d = pick(holes);
      const Iexact = m * (L * L / 12 + d * d);
      // Tier 0 is graded against the inertia as PRINTED, four decimals of it,
      // so the card and the grader hold the same number.
      const Idisp = rr(Iexact, 4);
      const T = tier === 0
        ? TAU * Math.sqrt(Idisp / (m * G * d))
        : ppPeriod(L, d, G);
      if (T < 1.30 || T > 2.75) continue;

      const tol = Math.max(0.015 * T, 0.01);
      const simple = TAU * Math.sqrt(d / G);
      // The classic wrong route has to be a different number from the right
      // one or the round teaches nothing; it never is here, but the generator
      // says so out loud rather than trusting the algebra.
      if (Math.abs(simple - T) < 4 * tol) continue;

      const givens = [];
      if (tier === 0) {
        givens.push({ label: "Rotational inertia about the nail, I", value: fx(Idisp, 4), unit: "kg m^2" });
      } else {
        givens.push({ label: "Stick length, L", value: fx(L, 2), unit: "m" });
      }
      givens.push({ label: "Stick mass, m", value: fx(m, 2), unit: "kg" });
      givens.push({ label: "Nail to centre of mass, d", value: fx(d, 2), unit: "m" });
      givens.push({ label: "g", value: fx(G, 2), unit: "m/s^2" });

      return {
        game: "physical-pendulum-game", tier: tier, g: G, L: L, m: m, d: d,
        holes: holes, I: tier === 0 ? Idisp : Iexact, Iexact: Iexact, T: T, tol: tol,
        simple: simple,
        givens: givens,
        inputs: [{ key: "period", label: "Period of one full swing", unit: "s", step: "0.001" }],
        prompt: tier === 0
          ? "The drilled stick hangs on a nail and is set swinging through a small angle. Its "
            + "rotational inertia about the nail is given. Predict the period of one full swing."
          : "The uniform stick hangs on a nail driven through a hole " + fx(d, 2) + " m from its "
            + "centre, and is set swinging through a small angle. Work out its rotational inertia "
            + "about the NAIL, then predict the period.",
        note: tier === 0
          ? "This is not a simple pendulum: the mass is spread along the stick, not gathered at "
            + "the end."
          : "The mass is printed. Carry it through and see whether it is still there at the end.",
      };
    }
    return null;
  }

  function ppSolutionSwing(R) {
    const s = [];
    if (R.tier === 0) {
      s.push("Given     I about the nail = " + fx(R.I, 4) + " kg m^2");
    } else {
      s.push("About the centre   I_cm = m L^2/12 = " + fx(R.m, 2) + " * " + fx(R.L, 2) + "^2/12 = "
        + fx(R.m * R.L * R.L / 12, 5) + " kg m^2");
      s.push("Parallel axis      I = I_cm + m d^2 = " + fx(R.m * R.L * R.L / 12, 5) + " + "
        + fx(R.m * R.d * R.d, 5) + " = " + fx(R.Iexact, 5) + " kg m^2");
    }
    s.push("Period    T = 2*pi*sqrt(I/(m g d)) = 2*pi*sqrt(" + fx(R.I, 5) + "/("
      + fx(R.m, 2) + "*" + fx(R.g, 2) + "*" + fx(R.d, 2) + ")) = " + fx(R.T, 4) + " s");
    if (R.tier === 1) {
      s.push("The mass cancels: T = 2*pi*sqrt((L^2/12 + d^2)/(g d)) — no m anywhere.");
    }
    s.push("A simple pendulum of length d would give 2*pi*sqrt(d/g) = " + fx(R.simple, 4) + " s, out "
      + "by " + fx(Math.abs(R.simple - R.T) / R.T * 100, 0) + "%. The stick's mass is spread along "
      + "it, not gathered at the nail's distance.");
    return s;
  }

  function ppSolutionHole(R) {
    return [
      "T(d) = 2*pi*sqrt((L^2/12 + d^2)/(g d)) = 2*pi*sqrt((L^2/(12d) + d)/g)",
      "Minimise the bracket: d/dd [L^2/(12d) + d] = -L^2/(12 d^2) + 1 = 0",
      "So d^2 = L^2/12 and d = L/sqrt(12) = 0.2887 L = " + fx(R.dMin, 4) + " m from the centre",
      "The nearest drilled hole is at " + fx(R.nearest, 2) + " m, giving T = "
        + fx(ppPeriod(R.L, R.nearest, R.g), 4) + " s against the ideal " + fx(R.Tmin, 4) + " s",
      "Note how flat it is: the hole 5 cm further in gives "
        + fx(ppPeriod(R.L, Math.max(R.nearest - PP_SPACING, PP_SPACING), R.g), 4)
        + " s, under 1% slower. The period cannot tell you where the minimum is — only the "
        + "derivative can.",
    ];
  }

  function ppGrade(R, f) {
    if (R.tier === 2) {
      const guess = f.dmin;
      const dd = guess - R.dMin;
      const correct = Math.abs(dd) <= R.tol;
      const maxHole = R.holes[R.holes.length - 1];
      const cands = [
        {
          id: "farther-is-faster",
          label: "Farther out is not faster",
          detail: " Moving the nail out increases the restoring torque (m g d) but increases the"
            + " rotational inertia faster once d passes L/sqrt(12). Past that point the stick"
            + " slows down again: on a metre stick the end hole (d = 0.500 m) has exactly the"
            + " period of the hole at d = 0.167 m, its conjugate point L/6.",
          value: R.L / 2,
        },
        {
          id: "farther-is-faster",
          label: "Farther out is not faster",
          detail: " The outermost hole is past the minimum. Beyond d = L/sqrt(12) the inertia grows"
            + " faster than the restoring torque and the swing gets slower again.",
          value: maxHole,
        },
        {
          id: "centre-is-fastest",
          label: "Nearer the centre is slower, not faster",
          detail: " As the nail approaches the centre of mass the restoring torque m g d goes to"
            + " zero while the inertia does not, so the period runs away to infinity. A stick"
            + " balanced exactly on its centre does not swing at all.",
          value: R.holes[0],
        },
      ];
      const mis = correct ? null : detect(guess, R.dMin, cands, {
        near: Math.max(R.tol * 1.5, 0.03),
        gap: R.tol * 3,
      });
      const v = correct
        ? verdict("hit", "On the fastest hole")
        : dd > 0
          ? verdict("over", fx(Math.abs(dd) * 100, 1) + " cm too far out")
          : verdict("under", fx(Math.abs(dd) * 100, 1) + " cm too near the centre");
      const Tguess = guess > 0 && guess < R.L / 2 ? ppPeriod(R.L, guess, R.g) : NaN;
      const parts = [];
      if (correct) {
        parts.push("That is the fastest point on the stick"
          + (R.holes && R.holes.length
            ? "; the nearest drilled hole is at " + fx(ppNearestHole(R), 2) + " m"
            : ""));
      } else if (!(guess > 0)) {
        parts.push("A nail through the centre of mass gives no restoring torque at all, so the "
          + "stick never swings");
      } else if (guess >= R.L / 2) {
        parts.push("There is no hole that far out — the stick only reaches " + fx(R.L / 2, 2)
          + " m from its centre");
      } else {
        parts.push("Your hole swings in " + fx(Tguess, 4) + " s against the best possible "
          + fx(R.Tmin, 4) + " s — only " + fx((Tguess / R.Tmin - 1) * 100, 2)
          + "% slower, which is exactly why the period cannot be used to find the position");
      }
      parts.push("The minimum sits at d = L/sqrt(12) = " + fx(R.dMin, 4) + " m");
      const out = makeResult({
        correct: correct, verdict: v, feedback: parts.join(". ") + ".",
        misconception: mis, solution: ppSolutionHole(R),
        exact: { dmin: rr(R.dMin, 5), Tmin: rr(R.Tmin, 5) },
        tolerance: { dmin: rr(R.tol, 4) },
      });
      out.guess = guess;
      return out;
    }

    const guess = f.period;
    const dT = guess - R.T;
    const correct = Math.abs(dT) <= R.tol;
    const cands = [
      {
        id: "simple-pendulum",
        label: "That is the SIMPLE pendulum formula",
        detail: " T = 2*pi*sqrt(d/g) is for a point mass on a massless string. The stick's mass is"
          + " spread along its whole length, so its inertia about the nail is m(L^2/12 + d^2), not"
          + " m d^2 — and the extra L^2/12 is what makes the real period "
          + fx(R.T, 3) + " s instead of " + fx(R.simple, 3) + " s.",
        value: R.simple,
      },
      {
        id: "com-inertia",
        label: "That inertia is about the wrong axis",
        detail: " m L^2/12 is the inertia about the stick's CENTRE. The stick is not turning about"
          + " its centre, it is turning about the nail, so the parallel axis theorem adds m d^2.",
        value: TAU * Math.sqrt((R.L * R.L / 12) / (R.g * R.d)),
      },
      {
        id: "end-inertia",
        label: "That is the inertia about the END",
        detail: " m L^2/3 is the standard result for a stick pivoted at its end, which is the"
          + " special case d = L/2. This nail is at d = " + fx(R.d, 2) + " m, so the inertia is"
          + " m(L^2/12 + d^2).",
        value: TAU * Math.sqrt((R.L * R.L / 3) / (R.g * R.d)),
      },
      {
        id: "mass-dropped",
        label: "The mass fell out of the denominator",
        detail: " I is in kg m^2 and the restoring torque is m g d, so the m in the denominator is"
          + " not optional when I is handed to you as a number. It only cancels once you write I"
          + " out as m(L^2/12 + d^2).",
        value: TAU * Math.sqrt(R.I / (R.g * R.d)),
      },
      {
        id: "no-two-pi",
        label: "The 2*pi is missing",
        detail: " sqrt(I/(m g d)) is 1/omega. A full swing is 2*pi radians of phase.",
        value: Math.sqrt(R.I / (R.m * R.g * R.d)),
      },
    ];
    const mis = correct ? null : detect(guess, R.T, cands, {
      near: Math.max(R.tol * 1.5, R.T * 0.025),
      gap: Math.max(R.tol * 3, R.T * 0.05),
    });
    const drift = Number.isFinite(guess) && guess > 0 ? 20 * (R.T / guess - 1) : 0;
    const v = correct
      ? verdict("hit", "In step after 20 swings")
      : dT > 0
        ? verdict("over", "Too slow by " + fx(Math.abs(dT), 3) + " s")
        : verdict("under", "Too fast by " + fx(Math.abs(dT), 3) + " s");
    const parts = [];
    parts.push(correct
      ? "Twenty swings later the stick and the metronome are still together"
      : (dT > 0
        ? "Your metronome runs slow: the stick completes " + fx(Math.abs(drift), 1)
          + " more swings than it ticks over twenty"
        : "Your metronome runs fast: it ticks " + fx(Math.abs(drift), 1)
          + " beats more than the stick swings over twenty"));
    parts.push("Exact period " + fx(R.T, 4) + " s");
    if (!correct) parts.push("you were out by " + fx(Math.abs(dT), 4) + " s");
    const out = makeResult({
      correct: correct, verdict: v, feedback: parts.join(". ") + ".",
      misconception: mis, solution: ppSolutionSwing(R),
      exact: { period: rr(R.T, 5), I: rr(R.I, 6) },
      tolerance: { period: rr(R.tol, 5) },
    });
    out.guess = guess;
    out.driftCycles = drift;
    return out;
  }

  /* --- pendulum reveal ------------------------------------------------------ */

  function ppPlay(R, RES) {
    const G = R.g;
    if (R.tier === 2) {
      const dg = RES.guess;
      const valid = Number.isFinite(dg) && dg > 0.005 && dg < R.L / 2 - 1e-9;
      const Tg = valid ? ppPeriod(R.L, dg, G) : Infinity;
      const rate = cl((20 * R.Tmin) / 12, 0.85, 2.8);
      return {
        kind: "pp-hole", t: 0, sim: 0, dur: (20 * R.Tmin) / rate, rate: rate, done: false,
        dStudent: valid ? dg : NaN, valid: valid,
        // Two nonlinear pendulums released together from the same small angle:
        // the reader's hole and the best one. Over twenty swings they barely
        // separate, and that is the finding.
        a: { th: 0.10, w: 0, k: valid ? (G * dg) / (R.L * R.L / 12 + dg * dg) : 0, cycles: 0 },
        b: { th: 0.10, w: 0, k: (G * R.dMin) / (R.L * R.L / 12 + R.dMin * R.dMin), cycles: 0 },
        Tg: Tg,
      };
    }
    const guess = Number.isFinite(RES.guess) && RES.guess > 0.05 ? RES.guess : R.T;
    const rate = cl((20 * R.T) / 12, 0.85, 2.8);
    return {
      kind: "pp-swing", t: 0, sim: 0, dur: (20 * R.T) / rate, rate: rate, done: false,
      guess: guess,
      a: { th: 0.10, w: 0, k: (R.m * R.g * R.d) / R.I, cycles: 0 },
    };
  }

  // theta'' = -(m g d / I) sin(theta), integrated rather than replayed. At the
  // 0.10 rad release the exact period runs 0.06% above the small-angle formula
  // the reader was asked for, which is two orders below the tolerance — so the
  // drift the metronome shows is the reader's error, not the integrator's.
  function ppSwingStep(o, hh) {
    const acc = function (th) { return -o.k * Math.sin(th); };
    const wPrev = o.w;
    const k1t = o.w, k1w = acc(o.th);
    const k2t = o.w + (hh / 2) * k1w, k2w = acc(o.th + (hh / 2) * k1t);
    const k3t = o.w + (hh / 2) * k2w, k3w = acc(o.th + (hh / 2) * k2t);
    const k4t = o.w + hh * k3w, k4w = acc(o.th + hh * k3t);
    o.th += (hh / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
    o.w += (hh / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    if (wPrev > 0 && o.w <= 0 && o.th > 0) o.cycles++;
  }

  function ppStep(A, dt) {
    const n = Math.max(1, Math.ceil((dt * A.rate) / (1 / 480)));
    const hh = (dt * A.rate) / n;
    for (let i = 0; i < n; i++) {
      if (A.a.k > 0) ppSwingStep(A.a, hh);
      if (A.b && A.b.k > 0) ppSwingStep(A.b, hh);
      A.sim += hh;
    }
  }

  function ppDrawStick(ctx, px, py, L, d, theta, scale, P, colour, alpha, holes, highlight) {
    // The stick hangs from the nail: the pivot sits d above the centre of mass,
    // so the drawn body runs from -(L/2 - d) above the nail to +(L/2 + d) below.
    const up = (L / 2 - d) * scale;
    const down = (L / 2 + d) * scale;
    const ux = Math.sin(theta), uy = Math.cos(theta);
    const halfW = Math.max(scale * 0.022, 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(theta);
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    ctx.fillRect(-halfW, -up, halfW * 2, up + down);
    ctx.strokeRect(-halfW, -up, halfW * 2, up + down);
    if (holes && scale > 60) {
      ctx.fillStyle = P.paper;
      ctx.strokeStyle = P.rule;
      ctx.lineWidth = 0.8;
      for (let s = -L / 2 + PP_SPACING; s <= L / 2 - PP_SPACING + 1e-9; s += PP_SPACING) {
        const yy = (s + d) * scale;      // s measured from the centre of mass, downward positive
        ctx.beginPath();
        ctx.arc(0, yy, Math.max(halfW * 0.45, 1.2), 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    }
    // centre of mass
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(0, d * scale, Math.max(halfW * 0.6, 1.6), 0, TAU);
    ctx.fill();
    ctx.restore();
    if (highlight) {
      disc(ctx, px, py, Math.max(halfW * 1.5, 4), P.crimson, null, 1.6);
    }
    return { x: px + ux * d * scale, y: py + uy * d * scale };
  }

  function ppDraw(ctx, w, h, P, R, RES, A) {
    const small = compact(w, h);
    const pivotY = h * 0.20;

    if (R.tier === 2) {
      const scale = Math.min((h * 0.60) / Math.max(R.L, 0.2), w * 0.30);

      /* Nothing to compare against until a number is committed -- and a stick
         labelled "best hole" standing beside one labelled "your hole" would be
         the answer, drawn, directly above the box asking for it. Posed, the
         bench is one stick on a middle hole and the row of holes it could be
         moved to. */
      if (!RES) {
        const xs = w * 0.50;
        ctx.save();
        ctx.strokeStyle = P.rule;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xs - Math.min(w * 0.18, 80), pivotY);
        ctx.lineTo(xs + Math.min(w * 0.18, 80), pivotY);
        ctx.stroke();
        ctx.restore();
        const dPose = R.holes[Math.floor(R.holes.length / 2)];
        const pc = ppDrawStick(ctx, xs, pivotY, R.L, dPose, 0.10, scale, P, P.crimson, 1, true, true);
        mark("yours", pc.x, pc.y);
        mark("best", pc.x, pc.y);
        if (!small) {
          lab(ctx, xs, pivotY - 14, "which hole?", P.inkSoft, 11);
          const rows = [["L", fx(R.L, 2) + " m"], ["holes every", fx(PP_SPACING, 2) + " m"],
            ["holes to choose from", String(R.holes.length)]];
          const pw = Math.min(w * 0.34, 230);
          plate(ctx, w - pw - 10, 10, pw, rows, P);
          bench(ctx, w, h, "Drilled stick", P);
        }
        return;
      }

      const xa = w * (small ? 0.30 : 0.22);
      const xb = w * (small ? 0.66 : 0.45);
      const tha = A && A.valid ? A.a.th : 0;
      const thb = A ? A.b.th : 0;

      ctx.save();
      ctx.strokeStyle = P.rule;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.06, pivotY);
      ctx.lineTo(Math.min(w * 0.62, xb + w * 0.12), pivotY);
      ctx.stroke();
      ctx.restore();

      const gc = ppDrawStick(ctx, xb, pivotY, R.L, R.dMin, thb, scale, P, P.forest, 0.45, true, false);
      mark("best", gc.x, gc.y);
      if (A && A.valid) {
        const sc = ppDrawStick(ctx, xa, pivotY, R.L, A.dStudent, tha, scale, P, P.crimson, 1, true, true);
        mark("yours", sc.x, sc.y);
      } else {
        const dShow = cl(Number.isFinite(RES && RES.guess) ? RES.guess : R.dMin, 0.01, R.L / 2 - 0.01);
        const sc = ppDrawStick(ctx, xa, pivotY, R.L, dShow, 0, scale, P, P.crimson, 0.5, true, true);
        mark("yours", sc.x, sc.y);
        if (!small) lab(ctx, xa, pivotY + h * 0.40, "no hole there", P.crimson, 10);
      }
      if (!small) {
        lab(ctx, xa, pivotY - 14, "your hole", P.crimson, 10);
        lab(ctx, xb, pivotY - 14, "best hole", P.forest, 10);
      }

      // The T(d) curve, because the flatness is the finding and a number cannot
      // show it. The axis is clipped at 1.6 T_min: below d = 0.1 L the period
      // runs away and would flatten everything else into a line.
      if (!small && w > 560) {
        const gx = w * 0.63, gy = h * 0.16, gw = w * 0.32, gh = h * 0.52;
        const dLo = 0.05 * R.L, dHi = 0.5 * R.L;
        const tLo = R.Tmin * 0.96, tHi = R.Tmin * 1.6;
        const X = function (d) { return gx + ((d - dLo) / (dHi - dLo)) * gw; };
        const Y = function (t) { return gy + gh - ((cl(t, tLo, tHi) - tLo) / (tHi - tLo)) * gh; };
        ctx.save();
        ctx.strokeStyle = P.rule;
        ctx.lineWidth = 1;
        ctx.strokeRect(gx, gy, gw, gh);
        ctx.strokeStyle = P.navy;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i <= 120; i++) {
          const d = dLo + ((dHi - dLo) * i) / 120;
          const t = ppPeriod(R.L, d, R.g);
          if (i === 0) ctx.moveTo(X(d), Y(t)); else ctx.lineTo(X(d), Y(t));
        }
        ctx.stroke();
        ctx.restore();
        dash(ctx, X(R.dMin), gy, X(R.dMin), gy + gh, P.forest, 1.2, [3, 3]);
        if (A && A.valid) dash(ctx, X(A.dStudent), gy, X(A.dStudent), gy + gh, P.crimson, 1.2, [3, 3]);
        lab(ctx, gx + gw / 2, gy + gh + 12, "d from centre (m)", P.inkSoft, 10);
        lab(ctx, gx + 4, gy + 10, "T(d)", P.navy, 10, "left");
        lab(ctx, X(R.dMin), gy - 8, fx(R.dMin, 3), P.forest, 10);
      }

      if (!small) {
        const rows = [["L", fx(R.L, 2) + " m"], ["best d", fx(R.dMin, 4) + " m"],
          ["T at best d", fx(R.Tmin, 3) + " s"]];
        if (RES) {
          rows.push(["your d", fx(RES.guess, 3) + " m"]);
          if (A && A.valid) {
            rows.push(["your T", fx(A.Tg, 3) + " s"]);
            rows.push(["slower by", fx((A.Tg / R.Tmin - 1) * 100, 2) + " %",
              A.Tg / R.Tmin - 1 < 0.005 ? P.forest : P.brass]);
            rows.push(["swings", A.a.cycles + " vs " + A.b.cycles]);
          }
        }
        const pw = Math.min(w * 0.30, 190);
        plate(ctx, w - pw - 10, h - (rows.length * 15 + 16) - 10, pw, rows, P);
        bench(ctx, w, h, "Drilled stick", P);
      }
      return;
    }

    const scale = Math.min((h * 0.62) / Math.max(R.L, 0.2), w * 0.34);
    const px = w * (small ? 0.34 : 0.27);
    const th = A ? A.a.th : 0.10;
    ctx.save();
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - Math.min(w * 0.16, 70), pivotY);
    ctx.lineTo(px + Math.min(w * 0.16, 70), pivotY);
    ctx.stroke();
    ctx.restore();
    const com = ppDrawStick(ctx, px, pivotY, R.L, R.d, th, scale, P, P.crimson, 1, true, true);
    mark("com", com.x, com.y);
    if (!small) {
      dash(ctx, px, pivotY, px, pivotY + (R.L / 2 + R.d) * scale * 0.98, P.rule, 1, [3, 4]);
      lab(ctx, px, pivotY - 13, "nail", P.inkSoft, 10);
    }

    if (A && !small) {
      const mx = w * 0.68;
      const mh = Math.min(h * 0.44, 148);
      const tip = drawMetronome(ctx, mx, h * 0.80, mh, A.sim / A.guess, P, P.brass);
      mark("needle", tip.x, tip.y);
      lab(ctx, mx, h * 0.87, "metronome at " + fx(A.guess, 3) + " s", P.brass, 10);
    }

    if (!small) {
      // On the middle tier the inertia about the nail is the parallel axis
      // step being tested. It is a given on the easy one and a spoiler on the
      // other, so it appears only when it was handed over or already graded.
      const rows = [["d", fx(R.d, 2) + " m"],
        ["I about nail", (R.tier === 0 || RES) ? fx(R.I, 4) : "— work it out"]];
      if (RES) {
        rows.push(["you predicted", fx(RES.guess, 3) + " s"]);
        rows.push(["true period", fx(R.T, 3) + " s"]);
        if (A) {
          rows.push(["stick swings", String(A.a.cycles)]);
          rows.push(["metronome beats", String(Math.floor(A.sim / A.guess))]);
          const dr = A.sim / R.T - A.sim / A.guess;
          rows.push(["drift", (dr >= 0 ? "+" : "") + fx(dr, 2) + " cyc",
            Math.abs(dr) < 0.25 ? P.forest : P.crimson]);
        }
      }
      const pw = Math.min(w * 0.32, 200);
      plate(ctx, w - pw - 10, 10, pw, rows, P);
      bench(ctx, w, h, "Drilled stick", P);
    }
  }

  /* ============================================================================
     GAME 3 — terminal-velocity, "Terminal velocity"
     ----------------------------------------------------------------------------
     Linear drag (F = -bv):  v_term = mg/b, tau = m/b = v_term/g,
     v(t) = v_term(1 - e^(-t/tau)), and the 95% mark is at t = tau*ln20.
     Quadratic drag (F = -cv^2):  v_term = sqrt(mg/c), v(t) = v_term*tanh(gt/v_term).

     The body never reaches terminal speed. Not "reaches it after a while" —
     never, at any finite time, under either law. That is the whole hard tier,
     and it is why the reveal draws the reader's number as a horizontal DASHED
     LINE and then lets the trace run at it: a line the trace levels off below,
     or a line the trace sails straight through, says which way they were wrong
     without a word of commentary.

     The motion is integrated, not replayed. The closed forms above are used as
     a parity check on the integrator and to place the tick marks, never as the
     motion itself.
     ========================================================================== */

  const TV_B = grid(0.20, 4.00, 0.05);
  const TV_M = grid(0.05, 5.00, 0.05);
  const TV_V = grid(3.0, 30.0, 0.5);
  const TV_FRACTIONS = [0.90, 0.95, 0.95, 0.95, 0.99];

  function tvMake(tier) {
    const G = g();
    for (let attempt = 0; attempt < 800; attempt++) {
      if (tier === 2) {
        const vWant = pick(TV_V.filter(function (v) { return v <= 26; }));
        const m = pick(TV_M);
        // c is printed to three significant figures because it swings from
        // 0.002 to 2 across the round space; a fixed four decimals would throw
        // away three digits at the small end.
        const c = sig((m * G) / (vWant * vWant), 3);
        if (!(c > 0.0005 && c < 8)) continue;
        const vTerm = Math.sqrt((m * G) / c);
        if (vTerm < 3 || vTerm > 27) continue;
        const frac = 0.95;
        const tF = (vTerm / G) * Math.atanh(frac);
        if (tF < 0.4 || tF > 40) continue;
        // The linear route on the same card must be a different answer, or the
        // tier is the middle tier wearing a hat.
        const linearV = (m * G) / c;
        const linearT = (m / c) * Math.log(1 / (1 - frac));
        const tolV = Math.max(0.02 * vTerm, 0.05);
        const tolT = Math.max(0.02 * tF, 0.02);
        if (Math.abs(linearV - vTerm) <= 3 * tolV) continue;
        if (Math.abs(linearT - tF) <= 3 * tolT) continue;
        return {
          game: "terminal-velocity", tier: 2, law: "quadratic", g: G,
          m: m, c: c, vTerm: vTerm, frac: frac, tF: tF, tolV: tolV, tolT: tolT,
          linearV: linearV, linearT: linearT,
          givens: [
            { label: "Mass, m", value: fx(m, 2), unit: "kg" },
            { label: "Drag coefficient, c   (F = c v^2)", value: String(c), unit: "kg/m" },
            { label: "g", value: fx(G, 2), unit: "m/s^2" },
          ],
          inputs: [
            { key: "vterm", label: "Terminal speed", unit: "m/s", step: "0.01" },
            { key: "time", label: "Time to reach 95% of it", unit: "s", step: "0.01" },
          ],
          prompt: "The body is released from rest into still air. The drag on it goes as the SQUARE "
            + "of the speed. Predict the terminal speed, and the time it takes to reach 95% of it.",
          note: "F_drag = c v^2 upward, weight mg downward. Terminal speed is where those two "
            + "balance — but the balance is only ever approached.",
        };
      }

      const b = pick(TV_B);
      const vWant = pick(TV_V);
      // Solve for the mass that puts the terminal speed where it is wanted,
      // round it to the two decimals it is printed at, then recompute.
      const m = rr((b * vWant) / G, 2);
      if (m < 0.10 || m > 12) continue;
      const vTerm = (m * G) / b;
      if (vTerm < 3 || vTerm > 32) continue;
      const tau = m / b;
      const tolV = Math.max(0.02 * vTerm, 0.05);

      if (tier === 0) {
        return {
          game: "terminal-velocity", tier: 0, law: "linear", g: G,
          m: m, b: b, vTerm: vTerm, tau: tau, tolV: tolV,
          givens: [
            { label: "Mass, m", value: fx(m, 2), unit: "kg" },
            { label: "Drag coefficient, b   (F = b v)", value: fx(b, 2), unit: "kg/s" },
            { label: "g", value: fx(G, 2), unit: "m/s^2" },
          ],
          inputs: [{ key: "vterm", label: "Terminal speed", unit: "m/s", step: "0.01" }],
          prompt: "The body is released from rest into still air. The drag on it is proportional to "
            + "its speed. Predict the terminal speed it settles toward.",
          note: "At terminal speed nothing is accelerating, so the drag exactly balances the weight.",
        };
      }

      const frac = pick(TV_FRACTIONS);
      const tF = tau * Math.log(1 / (1 - frac));
      if (tF < 0.4 || tF > 40) continue;
      const tolT = Math.max(0.02 * tF, 0.02);
      // tau and t_f must be tellable apart, or "one time constant" and "the
      // right answer" would be the same number and the detector below would
      // have to stand down on every round.
      if (Math.abs(tau - tF) <= 3 * tolT) continue;
      return {
        game: "terminal-velocity", tier: 1, law: "linear", g: G,
        m: m, b: b, vTerm: vTerm, tau: tau, frac: frac, tF: tF, tolV: tolV, tolT: tolT,
        givens: [
          { label: "Mass, m", value: fx(m, 2), unit: "kg" },
          { label: "Drag coefficient, b   (F = b v)", value: fx(b, 2), unit: "kg/s" },
          { label: "g", value: fx(G, 2), unit: "m/s^2" },
        ],
        inputs: [{ key: "time", label: "Time to reach " + Math.round(frac * 100) + "% of terminal speed", unit: "s", step: "0.01" }],
        prompt: "The body is released from rest into still air with drag proportional to its speed. "
          + "How long does it take to reach " + Math.round(frac * 100)
          + "% of its terminal speed?",
        note: "v(t) = v_term(1 - e^(-t/tau)). It never actually reaches v_term, so the question has "
          + "to name a fraction.",
      };
    }
    return null;
  }

  function tvSolution(R) {
    const s = [];
    if (R.law === "quadratic") {
      s.push("Balance   mg = c v_term^2   ->   v_term = sqrt(mg/c) = sqrt(" + fx(R.m * R.g, 3)
        + "/" + R.c + ") = " + fx(R.vTerm, 4) + " m/s");
      s.push("Motion    v(t) = v_term * tanh(g t / v_term)");
      s.push("95%       tanh(x) = 0.95 at x = artanh(0.95) = " + fx(Math.atanh(0.95), 4));
      s.push("          t = (v_term/g) * artanh(0.95) = " + fx(R.vTerm / R.g, 4) + " * "
        + fx(Math.atanh(0.95), 4) + " = " + fx(R.tF, 4) + " s");
      s.push("Watch the square root: mg/c = " + fx(R.linearV, 3) + " is v_term SQUARED, in m^2/s^2.");
      s.push("tanh reaches 1 only as t -> infinity. 99% at " + fx((R.vTerm / R.g) * Math.atanh(0.99), 3)
        + " s, 99.9% at " + fx((R.vTerm / R.g) * Math.atanh(0.999), 3) + " s, and 100% at no finite time at all.");
    } else {
      s.push("Balance   mg = b v_term   ->   v_term = mg/b = " + fx(R.m * R.g, 3) + "/" + fx(R.b, 2)
        + " = " + fx(R.vTerm, 4) + " m/s");
      s.push("Time constant  tau = m/b = " + fx(R.m, 2) + "/" + fx(R.b, 2) + " = " + fx(R.tau, 4)
        + " s   (= v_term/g, the same number)");
      if (R.tier === 1) {
        const pct = Math.round(R.frac * 100);
        s.push("Motion    v(t) = v_term(1 - e^(-t/tau))");
        s.push("Set v = " + R.frac + " v_term:  e^(-t/tau) = " + fx(1 - R.frac, 2)
          + "   ->   t = tau * ln(" + fx(1 / (1 - R.frac), 0) + ") = " + fx(R.tau, 4) + " * "
          + fx(Math.log(1 / (1 - R.frac)), 4) + " = " + fx(R.tF, 4) + " s");
        s.push("At t = tau the body is only at 63% of terminal speed, not " + pct + "%.");
      }
      s.push("The exponential never reaches zero, so v never reaches v_term at any finite time. "
        + "99% at " + fx(R.tau * Math.log(100), 3) + " s, 99.9% at " + fx(R.tau * Math.log(1000), 3) + " s.");
    }
    return s;
  }

  function tvGrade(R, f) {
    const G = R.g;
    const vGuess = R.tier === 1 ? NaN : f.vterm;
    const tGuess = R.tier === 0 ? NaN : f.time;
    const vOk = R.tier === 1 ? true : Math.abs(vGuess - R.vTerm) <= R.tolV;
    const tOk = R.tier === 0 ? true : Math.abs(tGuess - R.tF) <= R.tolT;
    const correct = vOk && tOk;

    let mis = null;
    if (!correct) {
      if (!vOk && R.tier !== 1) {
        const vc = [
          {
            id: "quad-no-sqrt",
            label: "mg/c is v_term SQUARED",
            detail: " With F = c v^2 the balance is mg = c v_term^2, so v_term = sqrt(mg/c)."
              + " The number you gave, " + fx(R.law === "quadratic" ? R.linearV : NaN, 2)
              + " m^2/s^2, has the units of a speed squared.",
            value: R.law === "quadratic" ? R.linearV : NaN,
          },
          {
            id: "vterm-inverted",
            label: "The drag coefficient is upside down",
            detail: " mg = b v_term rearranges to v_term = mg/b. A LARGER b is more drag and a"
              + " SLOWER fall, which is what dividing by b does.",
            value: R.law === "linear" ? R.b / (R.m * G) : NaN,
          },
          {
            id: "forgot-weight",
            label: "The weight lost its g",
            detail: " The force being balanced is the WEIGHT mg, not the mass. m/b has units of"
              + " time — it is the time constant, not a speed.",
            value: R.law === "linear" ? R.m / R.b : NaN,
          },
        ];
        mis = detect(vGuess, R.vTerm, vc, {
          near: Math.max(R.tolV * 1.5, R.vTerm * 0.025),
          gap: Math.max(R.tolV * 3, R.vTerm * 0.05),
        });
      }
      if (!mis && !tOk && R.tier !== 0) {
        const tc = [];
        if (R.law === "linear") {
          tc.push({
            id: "one-time-constant",
            label: "One time constant is 63%, not " + Math.round(R.frac * 100) + "%",
            detail: " tau = m/b is where v(t) has closed 1 - 1/e = 63% of the gap. It is also"
              + " exactly v_term/g, the time a body with NO drag would take to reach v_term — which"
              + " is the other way readers land on this number. Neither is the answer: with drag"
              + " the approach is exponential, so the fraction you want costs tau*ln(1/(1-f)).",
            value: R.tau,
          });
          tc.push({
            id: "tau-inverted",
            label: "The time constant is m/b",
            detail: " b/m has units of 1/time. tau = m/b: heavier falls take LONGER to level off,"
              + " and more drag levels them off sooner.",
            value: (R.b / R.m) * Math.log(1 / (1 - R.frac)),
          });
          if (R.frac !== 0.95) {
            tc.push({
              id: "wrong-fraction",
              label: "That is the 95% time",
              detail: " ln20 = 3.00 is the 95% multiplier. This round asked for "
                + Math.round(R.frac * 100) + "%, which is ln(" + fx(1 / (1 - R.frac), 0) + ") = "
                + fx(Math.log(1 / (1 - R.frac)), 3) + " time constants.",
              value: R.tau * Math.log(20),
            });
          }
        } else {
          tc.push({
            id: "finite-time-to-terminal",
            label: "Terminal speed is never actually reached",
            detail: " v_term/g is how long a body with no drag at all would take to reach that"
              + " speed. With drag the acceleration fades as the speed climbs, so the last few"
              + " percent cost more than the first ninety: 95% needs artanh(0.95) = 1.83 of those,"
              + " 99% needs 2.65, and 100% needs infinitely many.",
            value: R.vTerm / G,
          });
          tc.push({
            id: "used-linear-time-law",
            label: "That is the LINEAR drag time law",
            detail: " 1 - e^(-t/tau) belongs to F = -bv. For F = -cv^2 the solution is a tanh, and"
              + " 95% of terminal speed arrives at (v_term/g)*artanh(0.95), not at three time"
              + " constants.",
            value: (R.vTerm / G) * Math.log(20),
          });
          tc.push({
            id: "linear-drag-formulas",
            label: "c was used as if it were b",
            detail: " c has units kg/m, not kg/s, so m/c is not a time. The whole quadratic problem"
              + " runs on v_term = sqrt(mg/c) and t = (v_term/g)*artanh(f).",
            value: R.linearT,
          });
        }
        mis = detect(tGuess, R.tF, tc, {
          near: Math.max(R.tolT * 1.5, R.tF * 0.025),
          gap: Math.max(R.tolT * 3, R.tF * 0.05),
        });
      }
    }

    let v;
    if (correct) {
      v = verdict("hit", "The trace levels off on your line");
    } else if (R.tier === 1 || (vOk && !tOk)) {
      const dt = tGuess - R.tF;
      v = dt > 0 ? verdict("over", "Too late by " + fx(Math.abs(dt), 2) + " s")
        : verdict("under", "Too early by " + fx(Math.abs(dt), 2) + " s");
    } else {
      const dv = vGuess - R.vTerm;
      v = dv > 0 ? verdict("over", "Trace levels off " + fx(Math.abs(dv), 2) + " m/s below your line")
        : verdict("under", "Trace sails " + fx(Math.abs(dv), 2) + " m/s past your line");
    }

    const parts = [];
    if (correct) parts.push("The speed settles onto the line you drew and stays under it for ever");
    else if (!vOk) {
      parts.push(vGuess > R.vTerm
        ? "The trace flattens out well below your line — the drag balances the weight sooner than you allowed"
        : "The trace goes straight through your line and keeps climbing");
    } else {
      parts.push(tGuess > R.tF ? "The mark is passed before your time" : "The mark has not been reached by your time");
    }
    if (R.tier !== 1) parts.push("Exact terminal speed " + fx(R.vTerm, 4) + " m/s");
    if (R.tier !== 0) parts.push("exact time " + fx(R.tF, 4) + " s");

    const out = makeResult({
      correct: correct, verdict: v, feedback: parts.join(". ") + ".",
      misconception: mis, solution: tvSolution(R),
      exact: { vterm: rr(R.vTerm, 5), time: R.tier === 0 ? null : rr(R.tF, 5) },
      tolerance: { vterm: rr(R.tolV, 5), time: R.tier === 0 ? null : rr(R.tolT, 5) },
    });
    out.vGuess = vGuess;
    out.tGuess = tGuess;
    return out;
  }

  /* --- drop reveal ----------------------------------------------------------
     The shaft is as deep as the motion says it is, and not one metre deeper.
     Both laws share one clock: tau = v_term/g, which for linear drag IS m/b and
     for quadratic drag is the tau in v = v_term*tanh(t/tau). The run lasts
     TV_TAUS of it and the floor goes wherever the body has fallen to by then.
     Those fractions are law-dependent: for the exponential approach one tau
     is 63% of terminal, three is 95% and 4.6 is 99%; for tanh the same
     multiples give 76.2%, 99.5% and 99.98%. tvTime95 carries the split.

     Picking a drop HEIGHT instead is what makes this scene worthless, and it is
     worth spelling out why: over most of the parameter space a plausible-looking
     height puts the body on the ground somewhere between a tenth of a percent
     and thirteen percent of terminal speed, so the reader watches uniform
     acceleration and then a stop -- the exact opposite of the lesson the bench
     exists to teach. Taking the depth from tau instead puts 95% of terminal at
     57% of the way down under the linear law and 59% under the quadratic one, on
     EVERY round, because once the depth is measured in v_term*tau both fractions
     are pure numbers with no parameter left in them. The last two fifths of every
     shaft are covered at a speed that has visibly stopped changing. */

  const TV_TAUS = 4.6;

  // One expression, both laws. Linear: tau = m/b, and m/b = v_term/g exactly.
  // Quadratic: v = v_term*tanh(g t/v_term), so v_term/g is the time constant
  // there too. Writing it twice is how the two drift apart.
  function tvClock(R) { return R.vTerm / R.g; }

  // Distance fallen by t, closed form. Used ONLY to place the floor and as a
  // parity check on the integrator, never as the motion itself.
  /* The time at which the body first has 95% of terminal speed. It is NOT the
     same multiple of tau for the two laws: an exponential approach reaches 95%
     at tau*ln20 = 2.996 tau, but tanh gets there at artanh(0.95) = 1.832 tau
     and is already at 99.5% by 3 tau. Painting the linear mark on a quadratic
     shaft put the line at twice the right depth, on the one rung whose whole
     lesson is that the last few per cent cost more than the first ninety. */
  function tvTime95(R) {
    const tau = tvClock(R);
    return tau * (R.law === "linear" ? Math.log(20) : Math.atanh(0.95));
  }

  function tvFallen(R, t) {
    const tau = tvClock(R);
    if (!(tau > 0) || !(t > 0)) return 0;
    return R.law === "linear"
      ? R.vTerm * (t - tau * (1 - Math.exp(-t / tau)))
      : R.vTerm * tau * lncosh(t / tau);
  }

  function tvPlay(R, RES) {
    const tau = tvClock(R);
    const tEnd = TV_TAUS * tau;
    // Sim seconds per wall second, one constant factor for the whole run.
    const rate = cl(tEnd / 10, 0.25, 8);
    return {
      kind: "tv", t: 0, sim: 0, dur: tEnd / rate, rate: rate, done: false,
      v: 0, x: 0, tau: tau, tEnd: tEnd,
      drop: tvFallen(R, tEnd),
      // Where the body is when it first has 95% of terminal speed. Painted on
      // the shaft wall, and it is always well clear of the floor.
      mark95: tvFallen(R, tvTime95(R)),
      parity: 0,
      trace: [{ t: 0, v: 0 }],
      vGuess: Number.isFinite(RES.vGuess) ? RES.vGuess : R.vTerm,
      // Tier 0 never asked for a time, so there is no number to draw and NaN
      // says so. R.tF does not exist on that tier and reaching for it would put
      // an undefined on the animation bag.
      tGuess: Number.isFinite(RES.tGuess) ? RES.tGuess : NaN,
      streak: 0,
    };
  }

  function tvAccel(R, v) {
    return R.law === "linear"
      ? R.g - (R.b / R.m) * v
      : R.g - (R.c / R.m) * v * v;
  }

  function tvStep(R, A, dt) {
    const n = Math.max(1, Math.ceil((dt * A.rate) / (A.tEnd / 2000)));
    const hh = (dt * A.rate) / n;
    for (let i = 0; i < n; i++) {
      const k1 = tvAccel(R, A.v);
      const k2 = tvAccel(R, A.v + (hh / 2) * k1);
      const k3 = tvAccel(R, A.v + (hh / 2) * k2);
      const k4 = tvAccel(R, A.v + hh * k3);
      const dv = (hh / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      A.x += (A.v + dv / 2) * hh;
      A.v += dv;
      A.sim += hh;
      A.streak += A.v * hh;
    }
    // The closed form as a check ON the integrator, never as the motion: if the
    // two ever part company the depth on the plate is lying about where the body
    // is and nothing on the stage would show it.
    A.parity = Math.abs(A.x - tvFallen(R, A.sim));
    // One point per frame is plenty for a line; the integrator runs far finer.
    if (A.trace.length < 900) A.trace.push({ t: A.sim, v: A.v });
  }

  function tvDraw(ctx, w, h, P, R, RES, A) {
    const small = compact(w, h);
    const G = R.g;
    const vTrue = R.vTerm;
    const vG = A ? A.vGuess : vTrue;
    // The axis has to hold both the truth and the reader's line, but a wild
    // guess must not crush the trace into the floor, so the axis stops at 3.2x
    // the truth and says so.
    const vAxis = Math.min(Math.max(vTrue, RES ? vG : vTrue) * 1.18, vTrue * 3.2);
    const tau = A ? A.tau : tvClock(R);
    const tEnd = A ? A.tEnd : TV_TAUS * tau;
    const drop = A ? A.drop : tvFallen(R, tEnd);
    const mark95 = A ? A.mark95 : tvFallen(R, tvTime95(R));

    const colW = small ? w * 0.30 : w * 0.26;
    const gx = colW + (small ? 10 : 24);
    const gy = h * 0.16;
    const gw = Math.max(w - gx - (small ? 12 : 20), 20);
    const gh = Math.max(h * 0.60, 20);
    const X = function (t) { return gx + (cl(t, 0, tEnd) / tEnd) * gw; };
    const Y = function (v) { return gy + gh - (cl(v, 0, vAxis) / vAxis) * gh; };

    // --- the shaft. The body really descends it, and the floor is at the depth
    // the motion reaches in TV_TAUS, so the levelling off always happens on
    // screen and always well above the floor.
    const bx = colW * 0.52;
    const yTop = h * 0.13;
    const yFloor = h * 0.74;
    const bodyR = Math.max(Math.min(colW * 0.16, 15), 3);
    const depth = drop > 0 ? cl((A ? A.x : 0) / drop, 0, 1) : 0;
    const by = yTop + depth * (yFloor - yTop);
    if (colW > 40) {
      const wallL = bx - colW * 0.34, wallR = bx + colW * 0.34;
      ctx.save();
      ctx.strokeStyle = P.rule;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(wallL, yTop); ctx.lineTo(wallL, yFloor);
      ctx.moveTo(wallR, yTop); ctx.lineTo(wallR, yFloor);
      ctx.moveTo(wallL - 5, yFloor); ctx.lineTo(wallR + 5, yFloor);
      ctx.stroke();
      // hatching below the floor, so it reads as ground rather than as one more
      // rule ruled across the scene
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      for (let hx = wallL - 4; hx < wallR + 6; hx += 7) {
        ctx.beginPath();
        ctx.moveTo(hx, yFloor + 8);
        ctx.lineTo(hx + 7, yFloor);
        ctx.stroke();
      }
      ctx.restore();

      // the air, marching past at a rate set by the body's own speed
      ctx.save();
      ctx.strokeStyle = P.inkSoft;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      const spacing = Math.max((yFloor - yTop) / 7, 8);
      const off = A ? ((A.streak * 6) % spacing) : 0;
      const len = Math.min(colW * 0.18, 15) * (A ? cl(A.v / Math.max(vTrue, 0.1), 0.12, 1) : 0.18);
      for (let i = -1; i < 9; i++) {
        const yy = yTop + i * spacing + off;
        if (yy < yTop + 2 || yy > yFloor - 2) continue;
        ctx.beginPath();
        ctx.moveTo(wallL + 6, yy); ctx.lineTo(wallL + 6, yy - len);
        ctx.moveTo(wallR - 6, yy + spacing * 0.4); ctx.lineTo(wallR - 6, yy + spacing * 0.4 - len);
        ctx.stroke();
      }
      ctx.restore();

      // Where the body first has 95% of terminal speed. It lands at 57% of the
      // shaft under the linear law and 59% under the quadratic one whatever the
      // numbers on the card, so the mark is never near the floor.
      if (drop > 0 && !small) {
        const y95 = yTop + cl(mark95 / drop, 0, 1) * (yFloor - yTop);
        dash(ctx, wallL, y95, wallR, y95, P.forest, 1.2, [4, 3]);
        lab(ctx, wallR + 4, y95, "95%", P.forest, 9, "left");
      }

      if (typeof sphereShade === "function") {
        ctx.save();
        sphereShade(ctx, bx, by, bodyR, P.ink, P.panel);
        ctx.restore();
      } else {
        disc(ctx, bx, by, bodyR, P.ink, P.panel, 1.6);
      }
      mark("body", bx, by);

      // weight down, drag up, drawn to scale against mg so the reader watches
      // the two arrows close on each other rather than being told they do.
      const fs = Math.min(h * 0.12, 40) / Math.max(R.m * G, 1e-6);
      const drag = A ? (R.law === "linear" ? R.b * A.v : R.c * A.v * A.v) : 0;
      arrow(ctx, bx, by + bodyR, bx, by + bodyR + R.m * G * fs, P.navy, 1.8);
      if (drag * fs > 2) arrow(ctx, bx, by - bodyR, bx, by - bodyR - drag * fs, P.crimson, 1.8);
      if (!small) {
        const mgY = by + bodyR + R.m * G * fs * 0.6;
        // the host's verdict plate owns the bottom strip; a label under it is a
        // label nobody reads
        if (mgY < h - 56) lab(ctx, bx + 11, mgY, "mg", P.navy, 10, "left");
        if (drag * fs > 12) lab(ctx, bx + 11, by - bodyR - drag * fs * 0.6, "drag", P.crimson, 10, "left");
      }
    }

    // --- the v-t plot
    ctx.save();
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy + gh);
    ctx.lineTo(gx + gw, gy + gh);
    ctx.stroke();
    ctx.restore();

    // the reader's line, and it is theirs alone: nothing here is drawn at the
    // true terminal speed, because the trace itself is that statement.
    if (RES) {
      if (vG <= vAxis) {
        dash(ctx, gx, Y(vG), gx + gw, Y(vG), P.brass, 1.6, [6, 4]);
        if (!small) lab(ctx, gx + gw - 6, Y(vG) - 9, "your v_term " + fx(vG, 2), P.brass, 10, "right");
      } else if (!small) {
        lab(ctx, gx + gw - 6, gy + 10, "your v_term " + fx(vG, 2) + " is off the top", P.brass, 10, "right");
      }
      if (R.tier !== 0 && Number.isFinite(RES.tGuess) && RES.tGuess > 0 && RES.tGuess < tEnd) {
        dash(ctx, X(RES.tGuess), gy, X(RES.tGuess), gy + gh, P.brass, 1.2, [3, 4]);
        if (!small) lab(ctx, X(RES.tGuess), gy + gh + 12, "your t", P.brass, 10);
      }
    }

    if (A && A.trace.length > 1) {
      ctx.save();
      ctx.strokeStyle = P.navy;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < A.trace.length; i++) {
        const pt = A.trace[i];
        if (i === 0) ctx.moveTo(X(pt.t), Y(pt.v)); else ctx.lineTo(X(pt.t), Y(pt.v));
      }
      ctx.stroke();
      ctx.restore();
      const hx = X(A.sim), hy = Y(A.v);
      disc(ctx, hx, hy, 3, P.navy, P.navy, 1);
      mark("head", hx, hy);
    }

    if (!small) {
      // Both of these are the answer in disguise: the speed axis is 1.18x the
      // terminal speed, and the time axis is 4.6 tau. Dividing either by its
      // constant graded correct without doing any physics at all.
      lab(ctx, gx + gw / 2, gy + gh + 22,
        RES ? "time (s)  0 to " + fx(tEnd, 1) : "time →", P.inkSoft, 10);
      lab(ctx, gx + 4, gy - 8,
        RES ? "speed (m/s), full scale " + fx(vAxis, 1) : "speed ↑", P.inkSoft, 10, "left");
      const rows = [
        [R.law === "linear" ? "b" : "c", R.law === "linear" ? fx(R.b, 2) : String(R.c)],
        ["m", fx(R.m, 2) + " kg"],
      ];
      if (A) {
        rows.push(["t", fx(A.sim, 2) + " s = " + fx(A.sim / Math.max(tau, 1e-9), 2) + " tau"]);
        rows.push(["v", fx(A.v, 2) + " m/s"]);
        rows.push(["% of v_term", fx((A.v / vTrue) * 100, 2) + " %"]);
        rows.push(["fallen", fx(A.x, 1) + " of " + fx(drop, 1) + " m"]);
        // The integrator against the closed form. Silent while they agree --
        // they agree to about seven figures over the whole run -- and loud if
        // they ever stop, because a trace that is not the motion it claims to
        // be has no business being read off a stage without saying so.
        if (A.parity > 0.005 * Math.max(drop, 1)) {
          rows.push(["INTEGRATOR DRIFT", fx(A.parity, 3) + " m", P.crimson]);
        }
      }
      const pw = Math.min(w * 0.24, 172);
      plate(ctx, gx + gw - pw - 4, gy + gh - (rows.length * 15 + 16) - 6, pw, rows, P);
      bench(ctx, w, h, "Drop shaft", P);
    }
  }

  /* ============================================================================
     GAME 4 — river-crossing, "River crossing"
     ----------------------------------------------------------------------------
     x runs downstream, y runs across. A heading theta is measured from the
     straight-across direction, positive UPSTREAM, so through the water the boat
     makes (-v_b sin th, v_b cos th) and over the ground

         vx = v_c - v_b sin(th)        vy = v_b cos(th)

     Landing straight across needs vx = 0, so sin(th) = v_c/v_b — which has no
     solution at all once the current is faster than the boat. The first two
     tiers are constructed so that never happens; the third allows it and asks
     the reader to say so.

     The counter-intuitive part lives on the hard tier. Aiming upstream is the
     only way to land ON the marker, and it is the SLOWEST way across, because
     it spends part of the boat's speed fighting the current instead of crossing
     with it. Pointing straight at the far bank crosses in w/v_b, which no
     heading can beat, and lands you v_c*w/v_b downstream of where you wanted.

     The reveal sails the heading the reader chose, next to a ghost on the
     right one. Where the two boats touch the far bank is the error, in metres.
     ========================================================================== */

  const RC_VB = grid(2.0, 6.0, 0.1);

  function rcVel(R, thRad) {
    return { x: R.vc - R.vb * Math.sin(thRad), y: R.vb * Math.cos(thRad) };
  }

  // Infinity rather than a number when the heading cannot reach the far bank:
  // fail closed, and let the caller say "never" out loud.
  function rcCrossTime(R, thRad) {
    const vy = R.vb * Math.cos(thRad);
    return vy > 1e-6 ? R.w / vy : Infinity;
  }

  function rcMake(tier) {
    for (let attempt = 0; attempt < 900; attempt++) {
      const vb = pick(RC_VB);
      let ratio;
      if (tier === 2) {
        // One round in five has a current the boat cannot beat, because "it
        // cannot be done" is a real answer and a reader who has never been
        // offered it will never give it.
        ratio = Math.random() < 0.2 ? uni(1.05, 1.60) : uni(0.40, 0.92);
      } else {
        // Kept above 0.55 so that asin and atan of the same ratio are several
        // degrees apart: below that the classic tan-for-sin slip is inside the
        // grading tolerance and cannot honestly be named.
        ratio = uni(0.55, 0.85);
      }
      const vc = rr(vb * ratio, 2);
      if (vc < 0.4) continue;
      const r = vc / vb;
      const possible = r < 1;
      const thUp = possible ? Math.asin(r) : NaN;
      const cosUp = possible ? Math.cos(thUp) : NaN;

      const tolA = 1.0;
      let w;
      if (tier === 2) {
        w = Math.round(uni(12, 55) * vb);
      } else {
        w = Math.round(uni(14, 55) * vb * cosUp);
      }
      if (w < 30 || w > 320) continue;

      const R = { vb: vb, vc: vc, w: w };
      const tUpstream = possible ? w / Math.sqrt(vb * vb - vc * vc) : Infinity;
      const tFast = w / vb;
      const drift = vc * tFast;

      if (tier === 2) {
        const tolT = Math.max(0.02 * tFast, 0.2);
        const tolD = Math.max(0.02 * drift, 0.5);
        // The fastest crossing and the straight-across crossing must be
        // different answers by more than the tolerance, or the tier grades the
        // same as the one below it.
        if (possible && Math.abs(tUpstream - tFast) <= 3 * tolT) continue;
        return {
          game: "river-crossing", tier: 2, vb: vb, vc: vc, w: w, ratio: r, possible: possible,
          thUp: thUp, tUpstream: tUpstream, tFast: tFast, drift: drift,
          tolT: tolT, tolD: tolD, tolA: tolA,
          givens: [
            { label: "River width, w", value: String(w), unit: "m" },
            { label: "Boat speed through the water, v_boat", value: fx(vb, 2), unit: "m/s" },
            { label: "Current speed, v_current", value: fx(vc, 2), unit: "m/s" },
          ],
          inputs: [
            {
              key: "heading", label: "To be on the far bank soonest, point the boat",
              choices: [
                { value: "across", label: "straight at the far bank" },
                { value: "upstream", label: "upstream at the angle that lands you on the marker" },
                { value: "part", label: "half that angle upstream" },
              ],
            },
            { key: "time", label: "Shortest possible crossing time", unit: "s", step: "0.01" },
            { key: "drift", label: "How far downstream you land doing that", unit: "m", step: "0.1" },
          ],
          prompt: "This time you do not care where you land — you want to be on the far bank as "
            + "soon as possible. Choose the heading, then give the crossing time it achieves and "
            + "how far downstream of the marker it puts you.",
          note: "The component of the boat's velocity ACROSS the river is the only thing that "
            + "shortens the crossing. The current is perpendicular to it and cannot help or hinder it.",
        };
      }

      const tCross = w / (vb * cosUp);
      const tolT = Math.max(0.02 * tCross, 0.2);
      const thDeg = thUp * DEG;
      const givens = [
        { label: "River width, w", value: String(w), unit: "m" },
        { label: "Boat speed through the water, v_boat", value: fx(vb, 2), unit: "m/s" },
        { label: "Current speed, v_current", value: fx(vc, 2), unit: "m/s" },
      ];
      const inputs = [{ key: "heading", label: "Heading, measured upstream from straight across", unit: "degrees", step: "0.1" }];
      if (tier === 1) inputs.push({ key: "time", label: "Time to cross", unit: "s", step: "0.01" });
      return {
        game: "river-crossing", tier: tier, vb: vb, vc: vc, w: w, ratio: r, possible: true,
        thUp: thUp, thDeg: thDeg, tCross: tCross, tUpstream: tUpstream, tFast: tFast, drift: drift,
        tolA: tolA, tolT: tolT,
        givens: givens, inputs: inputs,
        prompt: tier === 1
          ? "A marker sits on the far bank directly opposite the launch point. Find the heading that "
            + "lands the boat on it, and how long that crossing takes."
          : "A marker sits on the far bank directly opposite the launch point. What heading lands "
            + "the boat on it?",
        note: "Measure the heading from the straight-across direction, positive upstream. The boat's "
          + "speed through the WATER is what you steer; the ground velocity is that plus the current.",
      };
    }
    return null;
  }

  function rcSolution(R) {
    const s = [];
    if (R.tier === 2) {
      s.push("Across-river speed = v_boat * cos(theta), largest at theta = 0.");
      s.push("Fastest crossing   t = w/v_boat = " + R.w + "/" + fx(R.vb, 2) + " = " + fx(R.tFast, 4) + " s");
      s.push("Drift while crossing  = v_current * t = " + fx(R.vc, 2) + " * " + fx(R.tFast, 4)
        + " = " + fx(R.drift, 3) + " m downstream");
      if (R.possible) {
        s.push("Aiming upstream to land on the marker needs sin(theta) = v_c/v_b = " + fx(R.ratio, 4)
          + ", theta = " + fx(R.thUp * DEG, 2) + " degrees, and takes w/sqrt(v_b^2 - v_c^2) = "
          + fx(R.tUpstream, 4) + " s — " + fx((R.tUpstream / R.tFast - 1) * 100, 1) + "% LONGER.");
      } else {
        s.push("There is no heading that lands this boat straight across at all: sin(theta) would "
          + "have to be v_c/v_b = " + fx(R.ratio, 3) + ", and no angle has a sine above 1. With a "
          + "current faster than the boat, every crossing ends downstream.");
      }
      s.push("The current is perpendicular to the crossing direction, so it never changes how long "
        + "the crossing takes — only where it ends.");
      return s;
    }
    s.push("Straight across means the DOWNSTREAM component of the ground velocity is zero:");
    s.push("   v_current - v_boat sin(theta) = 0   ->   sin(theta) = v_c/v_b = " + fx(R.vc, 2)
      + "/" + fx(R.vb, 2) + " = " + fx(R.ratio, 4));
    s.push("   theta = " + fx(R.thDeg, 3) + " degrees upstream of straight across");
    s.push("Ground speed  v_ground = v_boat cos(theta) = sqrt(v_b^2 - v_c^2) = "
      + fx(Math.sqrt(R.vb * R.vb - R.vc * R.vc), 4) + " m/s");
    if (R.tier === 1) {
      s.push("Crossing time t = w/v_ground = " + R.w + "/"
        + fx(Math.sqrt(R.vb * R.vb - R.vc * R.vc), 4) + " = " + fx(R.tCross, 4) + " s");
      s.push("Not w/v_boat = " + fx(R.tFast, 3) + " s: part of the boat's speed is spent holding "
        + "station against the current and never crosses anything.");
    }
    s.push("sin, not tan: the boat's speed v_b is the HYPOTENUSE of the velocity triangle — it is "
      + "the whole thing being steered, not one leg of it.");
    return s;
  }

  function rcGrade(R, f) {
    if (R.tier === 2) {
      const okChoice = f.heading === "across";
      const dT = f.time - R.tFast;
      const dD = f.drift - R.drift;
      const okT = Math.abs(dT) <= R.tolT;
      const okD = Math.abs(dD) <= R.tolD;
      const correct = okChoice && okT && okD;

      let mis = null;
      if (!correct) {
        if (!okChoice) {
          mis = {
            id: "upstream-is-faster",
            label: "Aiming upstream is the SLOWEST way across",
            detail: " Only the across-river component v_boat*cos(theta) shortens the crossing, and"
              + " cos is largest at theta = 0. Angling upstream spends part of the boat's speed"
              + " cancelling the current, which moves you along the river, not across it."
              + (R.possible
                ? " Here it costs " + fx(R.tUpstream - R.tFast, 1) + " s."
                : " And with the current faster than the boat, no upstream angle lands you on the"
                  + " marker at all."),
          };
        } else if (!okT) {
          mis = detect(f.time, R.tFast, [
            {
              id: "upstream-is-faster",
              label: "That is the upstream crossing time",
              detail: " w/sqrt(v_b^2 - v_c^2) is how long it takes to land ON the marker. Pointing"
                + " straight across is quicker — w/v_boat — because the whole boat speed goes into"
                + " crossing.",
              value: R.tUpstream,
            },
            {
              id: "current-subtracted",
              label: "The current does not subtract from the crossing speed",
              detail: " v_boat - v_current would be right if the current ran against the boat. It"
                + " runs at right angles to the crossing, so it changes where you land and not how"
                + " long you take.",
              value: R.vb > R.vc ? R.w / (R.vb - R.vc) : NaN,
            },
            {
              id: "current-added",
              label: "The current does not add to the crossing speed",
              detail: " The current is perpendicular to the crossing. Adding it to v_boat treats a"
                + " sideways push as forward progress.",
              value: R.w / (R.vb + R.vc),
            },
          ], { near: Math.max(R.tolT * 1.5, R.tFast * 0.025), gap: Math.max(R.tolT * 3, R.tFast * 0.05) });
        } else if (!okD) {
          mis = detect(f.drift, R.drift, [
            {
              id: "no-drift",
              label: "Pointing straight across does not land you straight across",
              detail: " While the boat crosses, the current carries the whole boat downstream at"
                + " v_current for the entire " + fx(R.tFast, 2) + " s. Zero drift is what the"
                + " UPSTREAM heading buys, at the cost of a longer crossing.",
              value: 0,
            },
            {
              id: "drift-uses-slow-time",
              label: "That drift used the wrong crossing time",
              detail: " The drift is v_current times the time actually spent on the water, which for"
                + " the straight-across heading is w/v_boat.",
              value: R.possible ? R.vc * R.tUpstream : NaN,
            },
          ], { near: Math.max(R.tolD * 1.5, R.drift * 0.025), gap: Math.max(R.tolD * 3, R.drift * 0.05) });
        }
      }

      let v;
      if (correct) v = verdict("hit", "Fastest crossing, drift and all");
      else if (!okChoice) v = verdict("miss", "That heading is slower");
      else if (!okT) v = verdict(dT > 0 ? "over" : "under",
        (dT > 0 ? "Too slow by " : "Too quick by ") + fx(Math.abs(dT), 2) + " s");
      else v = verdict(dD > 0 ? "over" : "under",
        "Drift out by " + fx(Math.abs(dD), 1) + " m");

      const parts = [];
      parts.push(correct
        ? "Your boat touches the far bank first, and lands exactly as far downstream as you said"
        : !okChoice
          ? "The ghost boat pointed straight across reaches the bank first"
          : !okT ? "The crossing is over before your time" + (dT > 0 ? "" : " has come")
            : "The landing is not where you put it");
      parts.push("Fastest crossing " + fx(R.tFast, 3) + " s, landing " + fx(R.drift, 2) + " m downstream");
      if (R.possible) {
        parts.push("aiming upstream at " + fx(R.thUp * DEG, 1) + " degrees lands on the marker but takes "
          + fx(R.tUpstream, 3) + " s");
      } else {
        parts.push("no heading lands this boat straight across: v_current exceeds v_boat");
      }
      const out = makeResult({
        correct: correct, verdict: v, feedback: parts.join(". ") + ".",
        misconception: mis, solution: rcSolution(R),
        exact: { heading: "across", time: rr(R.tFast, 5), drift: rr(R.drift, 4) },
        tolerance: { time: rr(R.tolT, 4), drift: rr(R.tolD, 4) },
      });
      out.choice = f.heading;
      out.thGuess = f.heading === "across" ? 0
        : f.heading === "upstream" ? (R.possible ? R.thUp * DEG : 90)
          : (R.possible ? (R.thUp * DEG) / 2 : 45);
      return out;
    }

    const dA = f.heading - R.thDeg;
    const okA = Math.abs(dA) <= R.tolA;
    const dT = R.tier === 1 ? f.time - R.tCross : 0;
    const okT = R.tier === 1 ? Math.abs(dT) <= R.tolT : true;
    const correct = okA && okT;

    // Where the heading they typed actually puts the boat. Everything the
    // reader is told about their error is measured off this, not off the angle.
    const thRad = f.heading * RAD;
    const tSelf = rcCrossTime(R, thRad);
    const landing = Number.isFinite(tSelf) ? (R.vc - R.vb * Math.sin(thRad)) * tSelf : NaN;

    let mis = null;
    if (!correct) {
      if (!okA) {
        mis = detect(f.heading, R.thDeg, [
          {
            id: "tan-not-sin",
            label: "tan where sin belongs",
            detail: " v_boat is the HYPOTENUSE of the velocity triangle: it is the whole vector you"
              + " steer, and its upstream component is v_boat*sin(theta). Setting that equal to"
              + " v_current gives sin(theta) = v_c/v_b. Using tan treats v_boat as the across-river"
              + " leg, which is v_boat*cos(theta) instead.",
            value: Math.atan(R.ratio) * DEG,
          },
          {
            id: "cos-not-sin",
            label: "cos where sin belongs",
            detail: " cos(theta) = v_c/v_b would mean the ACROSS component cancels the current, but"
              + " the current runs along the river. It is the upstream component, v_boat*sin(theta),"
              + " that has to match it.",
            value: Math.acos(R.ratio) * DEG,
          },
          {
            id: "ratio-inverted",
            label: "The ratio is upside down",
            detail: " sin(theta) = v_current/v_boat. The current is the smaller speed here, so the"
              + " sine is less than one and the angle is under 90 degrees; the other way up there"
              + " is no angle at all.",
            value: 90 - Math.atan(R.ratio) * DEG,
          },
        ], { near: Math.max(R.tolA * 1.5, 1.5), gap: R.tolA * 3 });
      } else {
        mis = detect(f.time, R.tCross, [
          {
            id: "ignored-current-in-time",
            label: "The crossing is slower than w/v_boat",
            detail: " Only the across-river part of the boat's velocity crosses anything, and once"
              + " you are angled upstream that part is v_boat*cos(theta) = sqrt(v_b^2 - v_c^2),"
              + " which is less than v_boat. The rest is spent standing still against the current.",
            value: R.tFast,
          },
          {
            id: "current-subtracted",
            label: "Speeds do not subtract at right angles",
            detail: " v_boat - v_current is the arithmetic for a current running head-on. This one"
              + " runs across the boat's path, so the two combine by Pythagoras:"
              + " v_ground = sqrt(v_b^2 - v_c^2).",
            value: R.vb > R.vc ? R.w / (R.vb - R.vc) : NaN,
          },
          {
            id: "current-added",
            label: "The current is not helping you across",
            detail: " Adding the current to the boat's speed would need it to point at the far"
              + " bank. It points along the river.",
            value: R.w / (R.vb + R.vc),
          },
        ], { near: Math.max(R.tolT * 1.5, R.tCross * 0.025), gap: Math.max(R.tolT * 3, R.tCross * 0.05) });
      }
    }

    let v;
    if (correct) v = verdict("hit", "Landed on the marker");
    else if (!okA) {
      if (!Number.isFinite(tSelf)) v = verdict("over", "Never reached the far bank");
      else v = landing > 0
        ? verdict("under", "Landed " + fx(Math.abs(landing), 1) + " m downstream")
        : verdict("over", "Landed " + fx(Math.abs(landing), 1) + " m upstream");
    } else {
      v = dT > 0 ? verdict("over", "Too slow by " + fx(Math.abs(dT), 2) + " s")
        : verdict("under", "Too quick by " + fx(Math.abs(dT), 2) + " s");
    }

    const parts = [];
    if (correct) parts.push("The boat holds a straight line over the ground and touches the marker");
    else if (!okA) {
      parts.push(!Number.isFinite(tSelf)
        ? "At that heading the boat makes no progress across at all"
        : "Your heading is " + fx(Math.abs(dA), 2) + " degrees "
          + (dA > 0 ? "too far upstream" : "short") + ", so the boat lands "
          + fx(Math.abs(landing), 1) + " m " + (landing > 0 ? "downstream" : "upstream") + " of the marker");
    } else {
      parts.push("The heading is right and the boat lands on the marker, but not when you said");
    }
    parts.push("Exact heading " + fx(R.thDeg, 3) + " degrees");
    if (R.tier === 1) parts.push("exact crossing time " + fx(R.tCross, 3) + " s");

    const out = makeResult({
      correct: correct, verdict: v, feedback: parts.join(". ") + ".",
      misconception: mis, solution: rcSolution(R),
      exact: { heading: rr(R.thDeg, 4), time: R.tier === 1 ? rr(R.tCross, 5) : null },
      tolerance: { heading: R.tolA, time: R.tier === 1 ? rr(R.tolT, 4) : null },
    });
    out.thGuess = f.heading;
    out.landing = landing;
    return out;
  }

  /* --- crossing reveal ------------------------------------------------------ */

  function rcPlay(R, RES) {
    const thSelf = cl(RES.thGuess, -89.5, 89.5) * RAD;
    const thGhost = R.tier === 2 ? 0 : R.thUp;
    const tSelf = rcCrossTime(R, thSelf);
    const tGhost = rcCrossTime(R, thGhost);
    // A boat that never crosses still has to stop: the run is capped at three
    // times the correct crossing so the reveal ends rather than idling.
    const simEnd = Math.min(Math.max(Number.isFinite(tSelf) ? tSelf : Infinity, tGhost) * 1.05,
      tGhost * 3);
    const rate = cl(simEnd / 8, 0.4, 20);
    return {
      kind: "rc", t: 0, sim: 0, dur: simEnd / rate, rate: rate, done: false,
      simEnd: simEnd, thSelf: thSelf, thGhost: thGhost, tSelf: tSelf, tGhost: tGhost,
      self: { x: 0, y: 0, landed: false }, ghost: { x: 0, y: 0, landed: false },
      trail: [],
    };
  }

  function rcAdvanceBoat(R, boat, thRad, hh) {
    if (boat.landed) return;
    const v = rcVel(R, thRad);
    const yNext = boat.y + v.y * hh;
    if (yNext >= R.w) {
      // Land exactly on the bank rather than a step past it: the last frame of
      // a crossing is the one the reader measures the miss from.
      const frac = v.y > 1e-9 ? (R.w - boat.y) / (v.y * hh) : 1;
      boat.x += v.x * hh * frac;
      boat.y = R.w;
      boat.landed = true;
      return;
    }
    boat.x += v.x * hh;
    boat.y = yNext;
  }

  function rcStep(R, A, dt) {
    const n = Math.max(1, Math.ceil((dt * A.rate) / (A.simEnd / 1200)));
    const hh = (dt * A.rate) / n;
    for (let i = 0; i < n; i++) {
      rcAdvanceBoat(R, A.self, A.thSelf, hh);
      rcAdvanceBoat(R, A.ghost, A.thGhost, hh);
      A.sim += hh;
    }
    if (A.trail.length < 400) A.trail.push({ x: A.self.x, y: A.self.y });
  }

  function rcDraw(ctx, w, h, P, R, RES, A) {
    const small = compact(w, h);
    const self = A ? A.self : { x: 0, y: 0 };
    const ghost = A ? A.ghost : { x: 0, y: 0 };
    // The frame has to hold both landings and the marker, whatever the reader
    // aimed, so the half-width is taken from the widest thing on the water.
    const half = Math.max(Math.abs(self.x), Math.abs(ghost.x), Math.abs(R.drift), R.w * 0.30) * 1.25 + 4;
    const usableW = w * 0.80;
    const usableH = h * 0.60;
    const scale = Math.max(Math.min(usableW / (2 * half), usableH / R.w), 0.02);
    const cx = w * 0.50;
    const yNear = h * 0.80;
    const X = function (x) { return cx + x * scale; };
    const Y = function (y) { return yNear - y * scale; };
    const yFar = Y(R.w);

    ctx.save();
    ctx.fillStyle = P.panel;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, yFar, w, yNear - yFar);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, yNear); ctx.lineTo(w, yNear);
    ctx.moveTo(0, yFar); ctx.lineTo(w, yFar);
    ctx.stroke();
    ctx.restore();

    // the current, drawn as drifting streaks so the direction is never in doubt
    if (!small) {
      const spacing = Math.max((yNear - yFar) / 5, 10);
      const march = A ? (A.sim * R.vc * scale) % 46 : 0;
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (let yy = yFar + spacing * 0.5; yy < yNear - 2; yy += spacing) {
        for (let xx = -46 + march; xx < w; xx += 46) {
          arrow(ctx, xx, yy, xx + 22, yy, P.navy, 1.1);
        }
      }
      ctx.restore();
      lab(ctx, w - 12, yFar + 12, "current " + fx(R.vc, 2) + " m/s", P.navy, 10, "right");
    }

    // launch point and the marker straight across from it
    disc(ctx, X(0), yNear, 3.5, P.ink, P.ink, 1);
    dash(ctx, X(0), yNear, X(0), yFar, P.rule, 1, [3, 5]);
    ctx.save();
    ctx.strokeStyle = P.forest;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(0) - 7, yFar - 9); ctx.lineTo(X(0) + 7, yFar - 9);
    ctx.moveTo(X(0), yFar - 9); ctx.lineTo(X(0), yFar);
    ctx.stroke();
    ctx.restore();
    if (!small) lab(ctx, X(0), yFar - 18, "marker", P.forest, 10);

    const boatGlyph = function (px, py, thRad, colour, alpha) {
      const s = Math.max(Math.min(w, h) * 0.022, 4);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      // The hull points along the HEADING through the water, not along the
      // track over the ground. A boat that lands straight across is visibly
      // crabbing, and that is the whole picture.
      ctx.rotate(thRad);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.6);
      ctx.lineTo(s * 0.8, s);
      ctx.lineTo(0, s * 0.55);
      ctx.lineTo(-s * 0.8, s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    if (A && A.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = P.crimson;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < A.trail.length; i++) {
        const p = A.trail[i];
        if (i === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y));
      }
      ctx.stroke();
      ctx.restore();
    }

    if (A) {
      boatGlyph(X(ghost.x), Y(ghost.y), A.thGhost, P.forest, 0.45);
      mark("ghost", X(ghost.x), Y(ghost.y));
      boatGlyph(X(self.x), Y(self.y), A.thSelf, P.crimson, 1);
      mark("boat", X(self.x), Y(self.y));
      if (A.self.landed && !small) {
        dash(ctx, X(self.x), yFar, X(0), yFar, P.crimson, 1.4, [4, 3]);
        lab(ctx, (X(self.x) + X(0)) / 2, yFar - 30, fx(Math.abs(self.x), 1) + " m "
          + (self.x > 0 ? "downstream" : "upstream"), P.crimson, 10);
      }
    } else {
      boatGlyph(X(0), yNear, 0, P.crimson, 1);
      mark("boat", X(0), yNear);
    }

    if (!small) {
      const rows = [["w", R.w + " m"], ["v_boat", fx(R.vb, 2) + " m/s"], ["v_current", fx(R.vc, 2) + " m/s"]];
      if (A) {
        rows.push(["your heading", fx(A.thSelf * DEG, 1) + " deg"]);
        rows.push(["t", fx(A.sim, 1) + " s"]);
        rows.push(["your boat", A.self.landed ? "landed at " + fx(A.self.x, 1) + " m" : fx(A.self.y, 0) + " m across"]);
        rows.push([R.tier === 2 ? "straight-across boat" : "correct heading",
          A.ghost.landed ? "landed at " + fx(A.ghost.x, 1) + " m" : fx(A.ghost.y, 0) + " m across"]);
      }
      const pw = Math.min(w * 0.32, 216);
      plate(ctx, 10, 10, pw, rows, P);
      bench(ctx, w, h, "River ferry", P);
    }
  }

  /* ============================================================================
     GAME 5 — beam-balance, "Static equilibrium"
     ----------------------------------------------------------------------------
     Supports at a and b, uniform beam of mass M whose weight acts at L/2, load
     m at x. Torques about A kill F_A, torques about B kill F_B:

        F_B = [M g (L/2 - a) + m g (x - a)] / (b - a)
        F_A = [M g (b - L/2) + m g (b - x)] / (b - a)      and they sum to (M+m)g.

     The beam's own weight is the term with nothing on the diagram to hang it
     on, so dropping it is the mistake this bench exists to catch. It is also
     ONE-DIRECTIONAL — every support force comes out too small — which makes it
     diagnosable rather than merely wrong. Every generated round keeps that term
     several times the grading tolerance, or forgetting it and getting it right
     would be the same answer.

     The reveal releases the beam with the numbers the reader gave. On the first
     two tiers those are the support FORCES, so the beam is a free body under
     them and it rises or rotates by exactly the residual they left. On the hard
     tier the reader placed the LOAD, so the real supports act — and a support
     can only push, never pull, so once one of them would have to go negative
     the beam stops being supported there and pivots about the other one. Which
     end goes down is the sign of the error.
     ========================================================================== */

  const BB_L = [2.0, 2.4, 3.0, 3.6, 4.0];

  function bbForces(R, x) {
    const G = R.g;
    const span = R.b - R.a;
    const FA = (R.M * G * (R.b - R.L / 2) + R.m * G * (R.b - x)) / span;
    const FB = (R.M * G * (R.L / 2 - R.a) + R.m * G * (x - R.a)) / span;
    return { FA: FA, FB: FB };
  }

  function bbMake(tier) {
    const G = g();
    for (let attempt = 0; attempt < 900; attempt++) {
      const L = pick(BB_L);
      const M = rr(uni(4, 20), 1);

      if (tier === 2) {
        const a = rr(uni(0.10, 0.30) * L, 2);
        const b = rr(uni(0.62, 0.82) * L, 2);
        if (b - a < 0.35 * L) continue;
        const tol = Math.max(0.03, 0.015 * L);
        // The overhang past the support is the whole answer, so it is chosen
        // first and the load mass is solved for. Kept at four tolerances or
        // more, so "it tips the moment the load passes the support" — the
        // beam-weightless answer — is a different answer, not a near miss.
        const over = rr(uni(Math.max(0.30, 4 * tol), 0.95), 2);
        if (b + over > L - 0.05) continue;
        const m = rr((M * (b - L / 2)) / over, 1);
        if (m < 2 || m > 60) continue;
        const xTip = b + (M / m) * (b - L / 2);
        // All three named routes asserted more than three tolerances from the
        // truth rather than assumed to be: x = b is the weightless-beam answer,
        // x = L is "it tips when the load runs out of beam", and
        // b + (m/M)(b - L/2) is the ratio inverted -- and that last one walks
        // onto the truth whenever the load and the beam weigh about the same.
        if (xTip > L - 3 * tol || xTip < b + 3 * tol) continue;
        if (Math.abs((b + (m / M) * (b - L / 2)) - xTip) < 3 * tol) continue;
        const start = rr((a + b) / 2, 2);
        return {
          game: "beam-balance", tier: 2, g: G, L: L, M: M, m: m, a: a, b: b,
          xTip: xTip, tol: tol, start: start,
          givens: [
            { label: "Beam length, L", value: fx(L, 2), unit: "m" },
            { label: "Beam mass, M (uniform)", value: fx(M, 1), unit: "kg" },
            { label: "Left support at", value: fx(a, 2), unit: "m from the left end" },
            { label: "Right support at", value: fx(b, 2), unit: "m from the left end" },
            { label: "Load mass, m", value: fx(m, 1), unit: "kg" },
            { label: "g", value: fx(G, 2), unit: "m/s^2" },
          ],
          inputs: [{ key: "xload", label: "Load position at which the beam is about to tip", unit: "m from the left end", step: "0.01" }],
          prompt: "The load is slid to the right along the beam. At some point the LEFT support "
            + "stops carrying anything at all and the beam is on the point of tipping about the "
            + "right one. How far from the left end is the load then?",
          note: "A support can push but never pull. The tipping point is where F_left reaches zero "
            + "— take torques about the RIGHT support and F_left is the only unknown in sight.",
        };
      }

      const m = rr(uni(5, 40), 1);
      const a = tier === 0 ? 0 : rr(uni(0.10, 0.34) * L, 2);
      const b = tier === 0 ? L : rr(uni(0.66, 0.92) * L, 2);
      if (b - a < 0.35 * L) continue;
      if (tier === 1 && (Math.abs(L / 2 - a) < 0.12 * L || Math.abs(b - L / 2) < 0.12 * L)) continue;

      // The load position is solved for from the support force the round wants
      // to land on, then rounded to the two decimals it is printed at and the
      // forces recomputed — so the card and the grader agree.
      const total = (M + m) * G;
      const want = total * uni(0.28, 0.72);
      const x = rr(a + (want * (b - a) - M * G * (L / 2 - a)) / (m * G), 2);
      if (x < 0.05 || x > L - 0.05) continue;
      const F = bbForces({ g: G, L: L, M: M, m: m, a: a, b: b }, x);
      if (F.FA < 0.08 * total || F.FB < 0.08 * total) continue;

      const asked = tier === 0 ? (Math.random() < 0.5 ? "left" : "right") : "both";
      const tolA = Math.max(0.02 * F.FA, 0.5);
      const tolB = Math.max(0.02 * F.FB, 0.5);
      // The beam's own contribution to whichever force is being graded must
      // exceed three tolerances, or forgetting it is indistinguishable from
      // getting it right and the bench teaches nothing.
      const beamShareB = (M * G * (L / 2 - a)) / (b - a);
      const beamShareA = (M * G * (b - L / 2)) / (b - a);
      if (asked !== "right" && beamShareA <= 3 * tolA) continue;
      if (asked !== "left" && beamShareB <= 3 * tolB) continue;

      const inputs = [];
      if (asked !== "right") inputs.push({ key: "fleft", label: "Force from the LEFT support", unit: "N", step: "0.1" });
      if (asked !== "left") inputs.push({ key: "fright", label: "Force from the RIGHT support", unit: "N", step: "0.1" });

      return {
        game: "beam-balance", tier: tier, g: G, L: L, M: M, m: m, a: a, b: b, x: x,
        FA: F.FA, FB: F.FB, asked: asked, tolA: tolA, tolB: tolB,
        beamShareA: beamShareA, beamShareB: beamShareB,
        givens: [
          { label: "Beam length, L", value: fx(L, 2), unit: "m" },
          { label: "Beam mass, M (uniform)", value: fx(M, 1), unit: "kg" },
          { label: "Left support at", value: fx(a, 2), unit: "m from the left end" },
          { label: "Right support at", value: fx(b, 2), unit: "m from the left end" },
          { label: "Load mass, m", value: fx(m, 1), unit: "kg" },
          { label: "Load position, x", value: fx(x, 2), unit: "m from the left end" },
          { label: "g", value: fx(G, 2), unit: "m/s^2" },
        ],
        inputs: inputs,
        prompt: tier === 0
          ? "The beam rests on supports at its two ends with the load sitting on it. Find the force "
            + "the " + asked.toUpperCase() + " support pushes up with."
          : "The beam rests on two supports, neither of them at its ends, with the load sitting on "
            + "it. Find the force each support pushes up with.",
        note: "The beam is uniform, so its whole weight acts at its midpoint — a force on the "
          + "diagram that is not hanging anywhere. Take torques about one SUPPORT and the force "
          + "there drops out; take them about the beam's end and both unknowns survive and you "
          + "have two unknowns in one equation.",
      };
    }
    return null;
  }

  function bbSolution(R) {
    const G = R.g;
    const s = [];
    if (R.tier === 2) {
      s.push("Take torques about the RIGHT support, at b = " + fx(R.b, 2) + " m:");
      s.push("   F_left*(b - a)  -  M g (b - L/2)  -  m g (b - x)  =  0");
      s.push("Set F_left = 0 (the support is about to stop carrying anything):");
      s.push("   M g (b - L/2)  =  -m g (b - x)   ->   x = b + (M/m)(b - L/2)");
      s.push("   x = " + fx(R.b, 2) + " + (" + fx(R.M, 1) + "/" + fx(R.m, 1) + ")("
        + fx(R.b, 2) + " - " + fx(R.L / 2, 2) + ") = " + fx(R.xTip, 4) + " m from the left end");
      s.push("The beam's own weight is the whole reason the answer is not simply x = b: the load has "
        + "to swing " + fx(R.xTip - R.b, 3) + " m past the support before it can outweigh the beam "
        + "hanging back on the other side.");
      return s;
    }
    s.push("Weights   beam " + fx(R.M * G, 2) + " N at L/2 = " + fx(R.L / 2, 2) + " m, load "
      + fx(R.m * G, 2) + " N at " + fx(R.x, 2) + " m. Total " + fx((R.M + R.m) * G, 2) + " N.");
    s.push("Torques about the LEFT support (F_left has zero arm there):");
    s.push("   F_right*(b - a) = M g (L/2 - a) + m g (x - a)");
    s.push("   F_right = [" + fx(R.M * G, 2) + "*" + fx(R.L / 2 - R.a, 2) + " + " + fx(R.m * G, 2)
      + "*" + fx(R.x - R.a, 2) + "] / " + fx(R.b - R.a, 2) + " = " + fx(R.FB, 3) + " N");
    s.push("Then ΣF = 0:  F_left = (M+m)g - F_right = " + fx((R.M + R.m) * G, 2) + " - "
      + fx(R.FB, 3) + " = " + fx(R.FA, 3) + " N");
    s.push("Check by taking torques about the RIGHT support instead: F_left = [M g (b - L/2) + "
      + "m g (b - x)]/(b-a) = " + fx(R.FA, 3) + " N. Same number, and that is what makes the pivot "
      + "choice free.");
    s.push("Drop the beam's own weight and F_right comes out " + fx(R.FB - R.beamShareB, 2)
      + " N and F_left " + fx(R.FA - R.beamShareA, 2) + " N — both too small, always.");
    return s;
  }

  function bbGrade(R, f) {
    const G = R.g;
    if (R.tier === 2) {
      const x = f.xload;
      const dx = x - R.xTip;
      const correct = Math.abs(dx) <= R.tol;
      const cands = [
        {
          id: "forgot-beam-weight",
          label: "The beam's own weight is holding the far side down",
          detail: " x = b is where it would tip if the beam were weightless. It is not: "
            + fx(R.M * G, 1) + " N of beam acts at its midpoint, which is "
            + fx(R.b - R.L / 2, 2) + " m to the LEFT of the right support and resists the tip. The "
            + "load has to get " + fx(R.xTip - R.b, 3) + " m past the support to beat it.",
          value: R.b,
        },
        {
          id: "tip-at-the-end",
          label: "The beam tips before the load reaches the end",
          detail: " The end of the beam is where the load runs out of beam, not where the balance"
            + " turns over. Set F_left = 0 and solve — the tipping point is inside the beam here.",
          value: R.L,
        },
        {
          id: "mass-ratio-inverted",
          label: "The mass ratio is upside down",
          detail: " x = b + (M/m)(b - L/2). It is the BEAM's weight being outweighed, so the beam's"
            + " mass is on top: a heavy beam and a light load push the tipping point far out, and"
            + " a heavy load tips it almost as soon as it passes the support.",
          value: R.b + (R.m / R.M) * (R.b - R.L / 2),
        },
      ];
      const mis = correct ? null : detect(x, R.xTip, cands, {
        near: Math.max(R.tol * 1.5, 0.05), gap: R.tol * 3,
      });
      const tips = x > R.xTip;
      const v = correct ? verdict("hit", "Balanced")
        : tips ? verdict("over", "Tipped right")
          : verdict("under", "Held level — " + fx(Math.abs(dx), 2) + " m short");
      const F = bbForces(R, x);
      const parts = [];
      parts.push(correct
        ? "The left support comes off the beam and it holds, just, on the edge of turning"
        : tips
          ? "The load goes past the balance point and the beam swings down on the right"
          : "The left support is still carrying " + fx(F.FA, 1) + " N there, so the beam sits flat");
      parts.push("The tipping point is x = " + fx(R.xTip, 3) + " m");
      if (!correct) parts.push("you were out by " + fx(Math.abs(dx), 3) + " m");
      const out = makeResult({
        correct: correct, verdict: v, feedback: parts.join(". ") + ".",
        misconception: mis, solution: bbSolution(R),
        exact: { xload: rr(R.xTip, 5) }, tolerance: { xload: rr(R.tol, 4) },
      });
      out.xGuess = x;
      return out;
    }

    const wantA = R.asked !== "right";
    const wantB = R.asked !== "left";
    const gA = wantA ? f.fleft : R.FA;
    const gB = wantB ? f.fright : R.FB;
    const okA = !wantA || Math.abs(gA - R.FA) <= R.tolA;
    const okB = !wantB || Math.abs(gB - R.FB) <= R.tolB;
    const correct = okA && okB;

    // The residual the reader's numbers leave on the beam. Torque is taken
    // about the combined centre of mass, where the two weights contribute
    // nothing by construction, so only the claimed support forces turn it.
    const total = (R.M + R.m) * G;
    const xc = (R.M * (R.L / 2) + R.m * R.x) / (R.M + R.m);
    const Fnet = gA + gB - total;
    const tauNet = (R.a - xc) * gA + (R.b - xc) * gB;

    const which = wantA && !okA ? "left" : "right";
    const graded = which === "left" ? { g: gA, t: R.FA, tol: R.tolA } : { g: gB, t: R.FB, tol: R.tolB };
    const beamShare = which === "left" ? R.beamShareA : R.beamShareB;
    const armSlip = which === "left"
      ? (R.M * G * (R.L - R.L / 2) + R.m * G * (R.L - R.x)) / (R.b - R.a)
      : (R.M * G * (R.L / 2) + R.m * G * R.x) / (R.b - R.a);

    let mis = null;
    if (!correct) {
      mis = detect(graded.g, graded.t, [
        {
          id: "forgot-beam-weight",
          label: "The beam's own weight was left out",
          detail: " A uniform beam of " + fx(R.M, 1) + " kg puts " + fx(R.M * G, 1) + " N through its"
            + " midpoint, and nothing on the diagram shows it. It contributes " + fx(beamShare, 1)
            + " N to this support on its own. Leaving it out always makes the supports come out too"
            + " small, and by exactly the beam's share.",
          value: graded.t - beamShare,
        },
        {
          id: "split-evenly",
          label: "Two supports do not mean half each",
          detail: " (M+m)g/2 is only right when the load sits at the midpoint of a symmetric pair"
            + " of supports. Here the load is at " + fx(R.x, 2) + " m and the supports are at "
            + fx(R.a, 2) + " and " + fx(R.b, 2) + " m, so the shares are " + fx(R.FA, 1) + " N and "
            + fx(R.FB, 1) + " N.",
          value: total / 2,
        },
        {
          id: "whole-weight",
          label: "That is the entire weight",
          detail: " (M+m)g = " + fx(total, 1) + " N is what the two supports carry BETWEEN them."
            + " ΣF = 0 says F_left + F_right = that, not that either one equals it.",
          value: total,
        },
        {
          id: "arms-from-the-end",
          label: "The lever arms were measured from the wrong point",
          detail: " Arms are measured from the PIVOT you chose, which is the other support, not the"
            + " end of the beam. Taking torques about the left support makes the load's arm"
            + " (x - a) = " + fx(R.x - R.a, 2) + " m, not x.",
          value: armSlip,
        },
      ], {
        near: Math.max(graded.tol * 1.5, Math.abs(graded.t) * 0.025),
        gap: Math.max(graded.tol * 3, Math.abs(graded.t) * 0.05),
      });
    }

    const tipsLeft = tauNet > 0;      // right end lifts, left end drops
    const dF = graded.g - graded.t;
    const v = correct ? verdict("hit", "Balanced")
      : Math.abs(tauNet) < 1e-9
        ? verdict(dF > 0 ? "over" : "under", dF > 0 ? "Lifted off the supports" : "Sagged onto the supports")
        : verdict(dF > 0 ? "over" : "under", tipsLeft ? "Tipped left" : "Tipped right");

    const parts = [];
    if (correct) {
      parts.push("Released with your two numbers the beam does not move at all — ΣF and Στ are both zero");
    } else {
      parts.push("Released with your numbers the beam turns "
        + (tipsLeft ? "left end down" : "right end down")
        + ", because the forces you claimed leave " + fx(Math.abs(tauNet), 1)
        + " N m of unbalanced torque about its centre of mass");
    }
    if (wantA) parts.push("F_left = " + fx(R.FA, 3) + " N");
    if (wantB) parts.push("F_right = " + fx(R.FB, 3) + " N");
    if (Math.abs(Fnet) > 0.5) parts.push("and " + fx(Math.abs(Fnet), 1) + " N of unbalanced vertical force");

    const out = makeResult({
      correct: correct, verdict: v, feedback: parts.join(". ") + ".",
      misconception: mis, solution: bbSolution(R),
      exact: { fleft: rr(R.FA, 4), fright: rr(R.FB, 4) },
      tolerance: { fleft: rr(R.tolA, 3), fright: rr(R.tolB, 3) },
    });
    out.gA = gA; out.gB = gB; out.Fnet = Fnet; out.tauNet = tauNet; out.xc = xc;
    return out;
  }

  /* --- beam reveal ---------------------------------------------------------- */

  function bbPlay(R, RES) {
    if (R.tier === 2) {
      const x = cl(RES.xGuess, 0.02, R.L - 0.02);
      const F = bbForces(R, x);
      // Only a real support acts here, and a real support cannot pull. Once one
      // would have to go negative the beam is no longer held there, so it turns
      // about the OTHER support rather than about its centre of mass.
      let pivot = null;
      if (F.FA < 0) pivot = R.b;
      else if (F.FB < 0) pivot = R.a;
      const G = R.g;
      let tau = 0, inert = 1;
      if (pivot !== null) {
        tau = -G * (R.M * (R.L / 2 - pivot) + R.m * (x - pivot));
        inert = R.M * (R.L * R.L / 12 + Math.pow(R.L / 2 - pivot, 2)) + R.m * Math.pow(x - pivot, 2);
      }
      return {
        kind: "bb", t: 0, dur: 7, done: false, mode: "load",
        xTarget: x, xNow: R.start, phi: 0, omega: 0, yOff: 0, vy: 0,
        pivot: pivot, tau: tau, inert: Math.max(inert, 1e-6), clamp: 1,
      };
    }
    const xc = RES.xc;
    const inert = R.M * (R.L * R.L / 12 + Math.pow(R.L / 2 - xc, 2)) + R.m * Math.pow(R.x - xc, 2);
    return {
      kind: "bb", t: 0, dur: 7, done: false, mode: "forces",
      xTarget: R.x, xNow: R.x, phi: 0, omega: 0, yOff: 0, vy: 0,
      pivot: null, xc: xc, tau: RES.tauNet, inert: Math.max(inert, 1e-6),
      Fnet: RES.Fnet, mass: R.M + R.m, clamp: 1,
    };
  }

  function bbStep(R, A, dt) {
    if (A.mode === "load") {
      if (A.t < 1.2) {
        // The load is carried to the reader's mark rather than appearing there:
        // a cubic ease starts and ends at rest, so nothing jumps at either end.
        A.xNow = R.start + (A.xTarget - R.start) * ease(A.t / 1.2);
        A.clamp = 1;
        return;
      }
      A.xNow = A.xTarget;
      A.clamp = cl(1 - (A.t - 1.2) / 0.5, 0, 1);
      if (A.t < 1.7 || A.pivot === null) return;
      const alpha = A.tau / A.inert;
      A.omega += alpha * dt;
      A.phi += A.omega * dt;
      if (Math.abs(A.phi) > 0.55) { A.phi = A.phi > 0 ? 0.55 : -0.55; A.omega = 0; A.done = true; }
      return;
    }
    A.clamp = cl(1 - (A.t - 0.7) / 0.5, 0, 1);
    if (A.t < 1.2) return;
    const alpha = A.tau / A.inert;
    A.omega += alpha * dt;
    A.phi += A.omega * dt;
    A.vy += (A.Fnet / A.mass) * dt;
    A.yOff += A.vy * dt;
    if (Math.abs(A.phi) > 0.55) { A.phi = A.phi > 0 ? 0.55 : -0.55; A.omega = 0; A.done = true; }
    if (Math.abs(A.yOff) > R.L * 0.35) { A.done = true; }
  }

  function bbDraw(ctx, w, h, P, R, RES, A) {
    const small = compact(w, h);
    const G = R.g;
    const scale = Math.min((w * 0.76) / Math.max(R.L, 0.2), h * 0.30);
    const cxScreen = w * 0.5;
    const beamY = h * 0.46;
    const phi = A ? A.phi : 0;
    const yOff = A ? A.yOff : 0;
    const centre = A && A.mode === "load" && A.pivot !== null ? A.pivot
      : (A && A.mode === "forces" ? A.xc : R.L / 2);
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    // The beam turns about `centre`, and `centre` is wherever it is actually
    // held -- a support once the other one has let go, the centre of mass when
    // the reader's own forces are the ones acting. Pinning the SCREEN to that
    // point directly slid the whole beam sideways the moment a result existed,
    // because the point changed. Pinning it to where that point sits on an
    // undeflected beam gives the same picture at phi = 0 for every choice of
    // centre, so grading changes what the beam does and not where it is.
    const anchorX = cxScreen + (centre - R.L / 2) * scale;
    const X = function (s) { return anchorX + (s - centre) * cosP * scale; };
    const Y = function (s) { return beamY - (s - centre) * sinP * scale - yOff * scale; };

    const beamH = Math.max(Math.min(h * 0.045, 16), 3);
    ctx.save();
    ctx.translate(X(centre), Y(centre));
    ctx.rotate(-phi);
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.8;
    ctx.fillRect(-(centre) * scale, -beamH / 2, R.L * scale, beamH);
    ctx.strokeRect(-(centre) * scale, -beamH / 2, R.L * scale, beamH);
    ctx.restore();
    mark("beamLeft", X(0), Y(0));
    mark("beamRight", X(R.L), Y(R.L));

    // supports: a wedge under each, with a prop that retracts on release so the
    // reader can see the moment the beam is on its own
    const support = function (s, colour) {
      const px = X(s), py = Y(s);
      const ss = Math.max(Math.min(h * 0.06, 22), 4);
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, py + beamH / 2);
      ctx.lineTo(px - ss * 0.7, py + beamH / 2 + ss);
      ctx.lineTo(px + ss * 0.7, py + beamH / 2 + ss);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      return { x: px, y: py };
    };
    support(R.a, P.forest);
    support(R.b, P.forest);

    // ground line under the supports
    const groundY = Y(R.L / 2) + beamH / 2 + Math.max(Math.min(h * 0.06, 22), 4) + 2;
    ctx.save();
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(w * 0.06, groundY);
    ctx.lineTo(w * 0.94, groundY);
    ctx.stroke();
    ctx.restore();

    const xLoad = A ? A.xNow : (R.tier === 2 ? R.start : R.x);
    const loadW = Math.max(Math.min(w * 0.055, 34), 5);
    const loadH = Math.max(Math.min(h * 0.075, 26), 4);
    const lx = X(xLoad), ly = Y(xLoad);
    ctx.save();
    ctx.translate(lx, ly - beamH / 2);
    ctx.rotate(-phi);
    ctx.fillStyle = P.crimson;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(-loadW / 2, -loadH, loadW, loadH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.crimson;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-loadW / 2, -loadH, loadW, loadH);
    ctx.restore();
    mark("load", lx, ly);
    if (!small) lab(ctx, lx, ly - beamH / 2 - loadH - 9, fx(R.m, 1) + " kg", P.crimson, 10);

    // the weight nobody draws: the beam's own, at its midpoint
    const mx = X(R.L / 2), my = Y(R.L / 2);
    const fs = Math.max(Math.min(h * 0.16, 52), 8) / Math.max((R.M + R.m) * G, 1e-6);
    arrow(ctx, mx, my, mx, my + R.M * G * fs, P.navy, 1.8);
    if (!small) lab(ctx, mx + 10, my + R.M * G * fs * 0.55, "Mg", P.navy, 10, "left");
    arrow(ctx, lx, ly, lx, ly + R.m * G * fs, P.navy, 1.6);

    // support forces: the reader's claimed values on the first two tiers, the
    // real ones on the third
    // Worked from where the load IS on this frame, not from where it is going.
    // Reading the arrow off the final position made it stand at its end value
    // through the whole slide and then not move -- a drawn force with a step in
    // it, which is a thing the reader is entitled to believe happened.
    const liveF = R.tier === 2 ? bbForces(R, xLoad) : null;
    const shownA = liveF ? liveF.FA : (RES ? RES.gA : R.FA);
    const shownB = liveF ? liveF.FB : (RES ? RES.gB : R.FB);
    const arrowFor = function (s, F, colour) {
      if (!(F > 0.01)) return;
      const px = X(s), py = Y(s);
      arrow(ctx, px, py + beamH / 2, px, py + beamH / 2 - Math.min(F * fs, h * 0.30), colour, 2);
    };
    if (RES || R.tier === 2) {
      arrowFor(R.a, shownA, P.forest);
      arrowFor(R.b, shownB, P.forest);
      if (!small) {
        lab(ctx, X(R.a) - 8, Y(R.a) - 14, fx(shownA, 0) + " N", P.forest, 10, "right");
        lab(ctx, X(R.b) + 8, Y(R.b) - 14, fx(shownB, 0) + " N", P.forest, 10, "left");
        if (R.tier === 2 && shownA <= 0.01) {
          lab(ctx, X(R.a), Y(R.a) - 16, "0 N", P.crimson, 10);
        }
      }
    }

    if (!small) {
      const rows = [["L", fx(R.L, 2) + " m"], ["beam", fx(R.M, 1) + " kg at " + fx(R.L / 2, 2) + " m"],
        ["load", fx(R.m, 1) + " kg"]];
      if (R.tier === 2) {
        rows.push(["tipping point", RES ? fx(R.xTip, 3) + " m" : "—"]);
        if (A) {
          rows.push(["load at", fx(A.xNow, 2) + " m"]);
          rows.push(["F_left", fx(Math.max(shownA, 0), 1) + " N",
            shownA <= 0.01 ? P.crimson : P.ink]);
        }
      } else if (RES) {
        rows.push(["F_left true", fx(R.FA, 1) + " N"]);
        rows.push(["F_right true", fx(R.FB, 1) + " N"]);
        rows.push(["residual torque", fx(RES.tauNet, 1) + " N m",
          Math.abs(RES.tauNet) < 0.5 ? P.forest : P.crimson]);
      }
      const pw = Math.min(w * 0.30, 200);
      plate(ctx, w - pw - 10, 10, pw, rows, P);
      bench(ctx, w, h, "Loaded beam", P);
    }
  }

  /* ============================================================================
     GAME 6 — collision-2d-game, "Two-dimensional collision"
     ----------------------------------------------------------------------------
     Componentwise, and nothing else:

        px = m1 v1 cos(th1) + m2 v2 cos(th2)
        py = m1 v1 sin(th1) + m2 v2 sin(th2)
        vf = sqrt(px^2 + py^2)/(m1 + m2)        thf = atan2(py, px)

     Two mistakes own this bench, and both are ONE-DIRECTIONAL, which is what
     makes them diagnosable rather than merely wrong.

     Adding the two SPEEDS instead of the two momentum VECTORS gives
     (m1 v1 + m2 v2)/(m1 + m2), which by the triangle inequality is never below
     the truth and is equal to it only when the pucks were already travelling
     parallel. Every round keeps the two tracks at least 35 degrees apart, so
     that route always overshoots and is always separable.

     Carrying kinetic energy through a collision the pucks do not survive as two
     bodies gives sqrt(2 KE_i/(m1+m2)), which is never below the scalar sum, let
     alone the truth: the difference between the two is m1 m2 (v1-v2)^2 / M^2 in
     the squares, which is why rounds are also generated with the two SPEEDS at
     least 1 m/s apart. Three numbers, three tolerances between each pair, so the
     two errors can be told apart from each other as well as from being right.

     Rounds are built from the answer outward. The final speed and direction are
     chosen first; the two initial momenta are then the solution of a 2x2 linear
     system in m1v1 and m2v2, and both have to come out positive or the pucks
     were never on collision courses. The speeds are then rounded to the one
     decimal they are PRINTED at and everything is recomputed from the printed
     values, so the card and the grader hold the same numbers.

     The reveal is an air table with a cushion. The pucks are released so that
     they reach the centre together, stick, and the pair slides off along the
     line the reader predicted, with a ghost on the true line. The angle between
     the two tracks is the error. It is drawn, not described.
     ========================================================================== */

  const C2_M = grid(0.20, 2.00, 0.10);
  const C2_ANG = grid(-70, 70, 5);
  const C2_TABLE = 6;                 // metres of table radius the reveal runs on

  function c2Solve(m1, m2, v1, th1, v2, th2) {
    const t1 = th1 * RAD, t2 = th2 * RAD;
    const px = m1 * v1 * Math.cos(t1) + m2 * v2 * Math.cos(t2);
    const py = m1 * v1 * Math.sin(t1) + m2 * v2 * Math.sin(t2);
    const M = m1 + m2;
    const vf = Math.hypot(px, py) / M;
    const KEi = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
    const KEf = 0.5 * M * vf * vf;
    return {
      px: px, py: py, M: M, vf: vf, thf: Math.atan2(py, px) * DEG,
      KEi: KEi, KEf: KEf, loss: KEi - KEf,
    };
  }

  function c2Make(tier) {
    for (let attempt = 0; attempt < 2500; attempt++) {
      const m1 = pick(C2_M), m2 = pick(C2_M);
      // A mass ratio near one lands "the masses were left out" and "the masses
      // were swapped" both on the truth, and two dead detectors is a tier that
      // cannot name the mistake it exists to catch.
      const q = m1 / m2;
      if (q > 0.72 && q < 1.38) continue;

      let th1, th2;
      if (tier === 0) {
        th1 = 0;
        th2 = Math.random() < 0.5 ? 90 : -90;
      } else {
        th1 = pick(C2_ANG);
        th2 = pick(C2_ANG);
        // Neither puck may run along an axis, or the tier is the easy one with
        // a decimal point in it; and the two must be far from parallel, or the
        // problem stops being two-dimensional and the scalar sum comes out
        // right for the wrong reason.
        if (Math.abs(th1) < 10 || Math.abs(th2) < 10) continue;
        const sep = Math.abs(th1 - th2);
        if (sep < 35 || sep > 145) continue;
      }

      const t1 = th1 * RAD, t2 = th2 * RAD;
      const det = Math.sin(t2 - t1);
      if (Math.abs(det) < 0.30) continue;

      // Backwards: fix where the pair ends up, then solve the 2x2 system for
      // the two incoming momenta. A share near a half puts the answer on the
      // bisector, where "halfway between them" cannot be told from the truth.
      const share = Math.random() < 0.5 ? uni(0.15, 0.40) : uni(0.60, 0.85);
      const thfWant = th1 + share * (th2 - th1);
      const vfWant = uni(1.8, 5.2);
      const M0 = m1 + m2;
      const pxW = M0 * vfWant * Math.cos(thfWant * RAD);
      const pyW = M0 * vfWant * Math.sin(thfWant * RAD);
      const p1 = (pxW * Math.sin(t2) - pyW * Math.cos(t2)) / det;
      const p2 = (pyW * Math.cos(t1) - pxW * Math.sin(t1)) / det;
      if (!(p1 > 0) || !(p2 > 0)) continue;

      const v1 = rr(p1 / m1, 1);
      const v2 = rr(p2 / m2, 1);
      if (v1 < 1.0 || v1 > 9.5 || v2 < 1.0 || v2 > 9.5) continue;
      if (Math.abs(v1 - v2) < 1.2) continue;

      const S = c2Solve(m1, m2, v1, th1, v2, th2);
      if (S.vf < 1.2 || S.vf > 7.0) continue;

      const tolV = Math.max(0.02 * S.vf, 0.05);
      const tolA = 2.0;
      const tolK = Math.max(0.02 * S.loss, 0.03);

      const vScalar = (m1 * v1 + m2 * v2) / S.M;
      const vKE = Math.sqrt((2 * S.KEi) / S.M);
      const vSwap = c2Solve(m2, m1, v1, th1, v2, th2).vf;
      // Three assertions rather than three assumptions. Each of these is a
      // named route, and a named route that lands within tolerance of the
      // truth would have the module accusing a correct reader.
      if (!(vScalar - S.vf > 3 * tolV)) continue;
      if (!(vKE - S.vf > 3 * tolV)) continue;
      if (Math.abs(vKE - vScalar) < 3 * tolV) continue;
      if (Math.abs(vSwap - S.vf) < 3 * tolV) continue;

      const thBis = Math.atan2(Math.sin(t1) + Math.sin(t2), Math.cos(t1) + Math.cos(t2)) * DEG;
      const thNoMass = Math.atan2(v1 * Math.sin(t1) + v2 * Math.sin(t2),
        v1 * Math.cos(t1) + v2 * Math.cos(t2)) * DEG;
      const thSwapAx = Math.atan2(S.px, S.py) * DEG;
      if (degGap(thBis, S.thf) < 3 * tolA) continue;
      if (degGap(thNoMass, S.thf) < 3 * tolA) continue;
      if (degGap(thSwapAx, S.thf) < 3 * tolA) continue;

      // The hard tier's extra quantity has to be worth asking for: a collision
      // that loses two percent of its energy cannot separate "some was lost"
      // from "none was".
      if (tier === 2 && !(S.loss > 0.18 * S.KEi)) continue;

      const givens = [
        { label: "Puck A mass, m1", value: fx(m1, 2), unit: "kg" },
        { label: "Puck A speed, v1", value: fx(v1, 1), unit: "m/s" },
        { label: "Puck A direction, theta1", value: fx(th1, 0), unit: "degrees" },
        { label: "Puck B mass, m2", value: fx(m2, 2), unit: "kg" },
        { label: "Puck B speed, v2", value: fx(v2, 1), unit: "m/s" },
        { label: "Puck B direction, theta2", value: fx(th2, 0), unit: "degrees" },
      ];

      const inputs = [
        { key: "speed", label: "Speed of the pair after they stick", unit: "m/s", step: "0.01" },
        { key: "angle", label: "Direction the pair travels", unit: "degrees", step: "0.1" },
      ];
      if (tier === 2) {
        inputs.push({ key: "keloss", label: "Kinetic energy lost in the collision", unit: "J", step: "0.01" });
      }

      const prompt = tier === 0
        ? "Two pucks slide on a frictionless table at right angles to one another, meet, and stick "
          + "together. Predict the speed of the pair and the direction it travels."
        : tier === 1
          ? "Two pucks slide on a frictionless table along the headings below, meet, and stick "
            + "together. Predict the speed of the pair and the direction it travels."
          : "Two pucks slide on a frictionless table along the headings below, meet, and stick "
            + "together. Predict the speed of the pair, the direction it travels, and how much "
            + "kinetic energy the collision destroys.";

      const note = tier === 2
        ? "Directions are measured anticlockwise from the +x axis; -30 and 330 are the same heading "
          + "and either is accepted. Momentum survives the collision. Kinetic energy does not, and "
          + "the difference is the point of the tier."
        : "Directions are measured anticlockwise from the +x axis; -30 and 330 are the same heading "
          + "and either is accepted. Momentum is a vector: resolve it, add the components, and only "
          + "then take a magnitude.";

      return {
        game: "collision-2d-game", tier: tier,
        m1: m1, m2: m2, v1: v1, v2: v2, th1: th1, th2: th2,
        px: S.px, py: S.py, M: S.M, vf: S.vf, thf: S.thf,
        KEi: S.KEi, KEf: S.KEf, loss: S.loss,
        vScalar: vScalar, vKE: vKE, vSwap: vSwap,
        thBis: thBis, thNoMass: thNoMass, thSwapAx: thSwapAx,
        tolV: tolV, tolA: tolA, tolK: tolK,
        givens: givens, inputs: inputs, prompt: prompt, note: note,
      };
    }
    return null;
  }

  function c2Solution(R) {
    const s = [];
    const c1 = Math.cos(R.th1 * RAD), s1 = Math.sin(R.th1 * RAD);
    const c2 = Math.cos(R.th2 * RAD), s2 = Math.sin(R.th2 * RAD);
    s.push("Resolve   A: (" + fx(R.m1 * R.v1 * c1, 4) + ", " + fx(R.m1 * R.v1 * s1, 4)
      + ")   B: (" + fx(R.m2 * R.v2 * c2, 4) + ", " + fx(R.m2 * R.v2 * s2, 4) + ")  kg m/s");
    s.push("Add       px = " + fx(R.px, 4) + " kg m/s,  py = " + fx(R.py, 4) + " kg m/s");
    s.push("Magnitude |p| = sqrt(px^2 + py^2) = " + fx(Math.hypot(R.px, R.py), 4) + " kg m/s");
    s.push("Speed     vf = |p|/(m1+m2) = " + fx(Math.hypot(R.px, R.py), 4) + "/" + fx(R.M, 2)
      + " = " + fx(R.vf, 4) + " m/s");
    s.push("Direction thf = atan2(py, px) = " + fx(R.thf, 3) + " degrees");
    s.push("Adding the SPEEDS instead would give (m1 v1 + m2 v2)/(m1+m2) = " + fx(R.vScalar, 4)
      + " m/s. That is never below the truth and only equals it for two pucks already travelling "
      + "parallel — the triangle inequality, wearing a lab coat.");
    if (R.tier === 2) {
      s.push("Energy    KE_i = " + fx(R.KEi, 4) + " J,  KE_f = 0.5*" + fx(R.M, 2) + "*"
        + fx(R.vf, 4) + "^2 = " + fx(R.KEf, 4) + " J");
      s.push("          KE_lost = " + fx(R.KEi, 4) + " - " + fx(R.KEf, 4) + " = " + fx(R.loss, 4)
        + " J, which is " + fx((R.loss / R.KEi) * 100, 1) + "% of what went in.");
      s.push("Conserving it instead would have given vf = sqrt(2 KE_i/(m1+m2)) = " + fx(R.vKE, 4)
        + " m/s. Two bodies that leave as one cannot keep their kinetic energy: the deformation "
        + "that made them one had to be paid for.");
    } else {
      s.push("Kinetic energy is NOT conserved here: " + fx(R.KEi, 3) + " J goes in and "
        + fx(R.KEf, 3) + " J comes out. Conserving it would have given " + fx(R.vKE, 3) + " m/s.");
    }
    return s;
  }

  function c2Grade(R, f) {
    const gv = f.speed;
    const ga = f.angle;
    const gk = R.tier === 2 ? f.keloss : NaN;
    const dV = gv - R.vf;
    const dA = degDelta(ga, R.thf);
    const dK = R.tier === 2 ? gk - R.loss : 0;
    const okV = Math.abs(dV) <= R.tolV;
    const okA = Math.abs(dA) <= R.tolA;
    const okK = R.tier !== 2 || Math.abs(dK) <= R.tolK;
    const correct = okV && okA && okK;

    let mis = null;
    if (!correct) {
      if (!okV) {
        mis = detect(gv, R.vf, [
          {
            id: "speeds-not-momenta",
            label: "The speeds were added, not the momentum vectors",
            detail: " (m1 v1 + m2 v2)/(m1+m2) = " + fx(R.vScalar, 3) + " m/s adds the two momentum"
              + " MAGNITUDES, which is only the same as adding the vectors when both point the same"
              + " way. These two are " + fx(Math.abs(R.th1 - R.th2), 0) + " degrees apart, so part of"
              + " each momentum cancels the other and the pair leaves slower than the arithmetic"
              + " suggests. Resolve first, add components, take the magnitude last.",
            value: R.vScalar,
          },
          {
            id: "ke-conserved",
            label: "Kinetic energy does not survive a collision the pucks do not",
            detail: " sqrt(2 KE_i/(m1+m2)) = " + fx(R.vKE, 3) + " m/s is the speed the pair would"
              + " have if every joule that went in came out as motion. " + fx(R.loss, 3) + " J of it"
              + " went into deforming and heating the two pucks as they locked together. Momentum is"
              + " what survives a sticking collision; energy is what pays for it.",
            value: R.vKE,
          },
          {
            id: "mass-ratio-inverted",
            label: "The masses are on the wrong pucks",
            detail: " Each momentum is that puck's OWN mass times its own velocity. Swapping them"
              + " gives " + fx(R.vSwap, 3) + " m/s: puck A is " + fx(R.m1, 2) + " kg travelling at "
              + fx(R.v1, 1) + " m/s and puck B is " + fx(R.m2, 2) + " kg at " + fx(R.v2, 1) + " m/s.",
            value: R.vSwap,
          },
          {
            id: "momentum-not-speed",
            label: "That is the momentum, not the speed",
            detail: " |p| = " + fx(Math.hypot(R.px, R.py), 3) + " kg m/s is what the pair carries."
              + " The speed is that divided by the mass it is carried by, which after they stick is"
              + " m1 + m2 = " + fx(R.M, 2) + " kg.",
            value: Math.hypot(R.px, R.py),
          },
        ], {
          near: Math.max(R.tolV * 1.5, R.vf * 0.025),
          gap: Math.max(R.tolV * 3, R.vf * 0.05),
        });
      } else if (!okA) {
        mis = detect(ga, R.thf, [
          {
            id: "split-evenly",
            label: "The track is not halfway between them",
            detail: " Halfway between " + fx(R.th1, 0) + " and " + fx(R.th2, 0) + " degrees is "
              + fx(R.thBis, 1) + " degrees, and that would be the answer only if the two momenta"
              + " were equal in size. They are " + fx(R.m1 * R.v1, 2) + " and " + fx(R.m2 * R.v2, 2)
              + " kg m/s, so the bigger one pulls the track toward itself.",
            value: R.thBis,
          },
          {
            id: "mass-dropped",
            label: "The velocities were added without their masses",
            detail: " Adding v1 and v2 as vectors gives " + fx(R.thNoMass, 1) + " degrees. It is"
              + " momentum that is conserved, not velocity, so each vector has to be weighted by"
              + " its own mass before they are added — and here the masses differ by a factor of "
              + fx(Math.max(R.m1, R.m2) / Math.min(R.m1, R.m2), 2) + ".",
            value: R.thNoMass,
          },
          {
            id: "ratio-inverted",
            label: "The components are the wrong way up",
            detail: " atan2(py, px) — the y component on top. Taking atan(px/py) gives "
              + fx(R.thSwapAx, 1) + " degrees, which is the angle measured from the y axis instead"
              + " of the x axis. Sketch the two components and read the answer off the sketch.",
            value: R.thSwapAx,
          },
        ], { metric: degGap, near: Math.max(R.tolA * 1.5, 3), gap: R.tolA * 3 });
      } else {
        mis = detect(gk, R.loss, [
          {
            id: "ke-conserved",
            label: "Something has to be lost when two bodies leave as one",
            detail: " Zero loss would need the pair to leave at " + fx(R.vKE, 3) + " m/s, and"
              + " momentum will not allow it — it fixes the speed at " + fx(R.vf, 3) + " m/s. The"
              + " difference, " + fx(R.loss, 3) + " J, went into the deformation that locked them"
              + " together. A perfectly inelastic collision loses the most energy any collision can.",
            value: 0,
          },
          {
            id: "whole-weight",
            label: "That is the entire kinetic energy",
            detail: " " + fx(R.KEi, 3) + " J is what went in. The pair is still moving at "
              + fx(R.vf, 3) + " m/s afterwards and carries " + fx(R.KEf, 3) + " J away with it, so"
              + " only " + fx(R.loss, 3) + " J was destroyed. A sticking collision loses everything"
              + " only when the two momenta cancel exactly and the pair ends up at rest.",
            value: R.KEi,
          },
          {
            id: "energy-left-not-lost",
            label: "That is the energy that survived",
            detail: " 0.5(m1+m2)vf^2 = " + fx(R.KEf, 3) + " J is what the pair still has. The"
              + " question asks what it no longer has: KE_i - KE_f = " + fx(R.loss, 3) + " J.",
            value: R.KEf,
          },
        ], {
          near: Math.max(R.tolK * 1.5, R.loss * 0.025),
          gap: Math.max(R.tolK * 3, R.loss * 0.05),
        });
      }
    }

    let v;
    if (correct) v = verdict("hit", "Straight down your line");
    else if (!okV) {
      v = dV > 0 ? verdict("over", "Too fast by " + fx(Math.abs(dV), 2) + " m/s")
        : verdict("under", "Too slow by " + fx(Math.abs(dV), 2) + " m/s");
    } else if (!okA) {
      v = dA > 0
        ? verdict("over", fx(Math.abs(dA), 1) + " deg too far anticlockwise")
        : verdict("under", fx(Math.abs(dA), 1) + " deg too far clockwise");
    } else {
      v = dK > 0 ? verdict("over", "Lost " + fx(Math.abs(dK), 2) + " J too much")
        : verdict("under", "Lost " + fx(Math.abs(dK), 2) + " J too little");
    }

    const parts = [];
    if (correct) {
      parts.push("The pair leaves along the line you drew and reaches the cushion on it");
    } else if (!okA) {
      parts.push("The pair leaves " + fx(Math.abs(dA), 1) + " degrees "
        + (dA > 0 ? "clockwise of" : "anticlockwise of") + " the track you predicted, and the two "
        + "reach the cushion " + fx(Math.abs(dA), 0) + " degrees apart");
    } else if (!okV) {
      parts.push(dV > 0
        ? "Your puck is off the table before the real one is halfway there"
        : "The real pair is at the cushion while yours is still crossing");
    } else {
      parts.push("Speed and direction are right, so the momentum was handled; the energy was not");
    }
    parts.push("Exact speed " + fx(R.vf, 4) + " m/s at " + fx(R.thf, 3) + " degrees");
    if (R.tier === 2) parts.push("exact loss " + fx(R.loss, 4) + " J of the " + fx(R.KEi, 3) + " J that went in");

    const out = makeResult({
      correct: correct, verdict: v, feedback: parts.join(". ") + ".",
      misconception: mis, solution: c2Solution(R),
      exact: {
        speed: rr(R.vf, 5), angle: rr(R.thf, 4),
        keloss: R.tier === 2 ? rr(R.loss, 5) : null,
      },
      tolerance: {
        speed: rr(R.tolV, 5), angle: R.tolA,
        keloss: R.tier === 2 ? rr(R.tolK, 5) : null,
      },
    });
    out.vGuess = gv;
    out.aGuess = ga;
    out.kGuess = gk;
    out.angleGap = Math.abs(dA);
    return out;
  }

  /* --- collision reveal ----------------------------------------------------- */

  function c2Play(R, RES) {
    const RT = C2_TABLE;
    // A speed of zero or less is not a heading, it is a puck that stays where
    // it was hit; drawn as such rather than fudged into something plausible.
    const vSelf = Number.isFinite(RES.vGuess) && RES.vGuess > 0 ? RES.vGuess : 0;
    const aSelf = Number.isFinite(RES.aGuess) ? RES.aGuess : R.thf;
    const vIn = Math.max(R.v1, R.v2);
    const tHit = RT / vIn;
    const t1 = R.th1 * RAD, t2 = R.th2 * RAD;
    const tTrue = RT / R.vf;
    const tSelf = vSelf > 1e-6 ? RT / vSelf : Infinity;
    const simEnd = tHit + Math.min(Math.max(tTrue, Number.isFinite(tSelf) ? tSelf : 0), 3.2 * tTrue);
    const vMax = Math.max(R.v1, R.v2, R.vf, vSelf, 0.1);
    // Geared so no puck crosses more than about three percent of the table
    // between 60 Hz frames. A body that jumps a third of the stage between two
    // frames reads as a teleport however continuous the integrator under it is,
    // and the floor keeps a very slow prediction from running past the host's
    // reduced-motion budget.
    const smooth = (0.03 * RT * 60) / vMax;
    const lo = Math.min(simEnd / 12, 3.5);
    const rate = cl(Math.min(simEnd / 9, smooth), lo, 3.5);
    return {
      kind: "c2", t: 0, sim: 0, dur: simEnd / rate, rate: rate, done: false,
      simEnd: simEnd, tHit: tHit, merged: false, RT: RT,
      p1: { x: -Math.cos(t1) * R.v1 * tHit, y: -Math.sin(t1) * R.v1 * tHit },
      p2: { x: -Math.cos(t2) * R.v2 * tHit, y: -Math.sin(t2) * R.v2 * tHit },
      v1x: Math.cos(t1) * R.v1, v1y: Math.sin(t1) * R.v1,
      v2x: Math.cos(t2) * R.v2, v2y: Math.sin(t2) * R.v2,
      self: { x: 0, y: 0, vx: Math.cos(aSelf * RAD) * vSelf, vy: Math.sin(aSelf * RAD) * vSelf, stuck: false },
      ghost: { x: 0, y: 0, vx: Math.cos(R.thf * RAD) * R.vf, vy: Math.sin(R.thf * RAD) * R.vf, stuck: false },
      vSelf: vSelf, aSelf: aSelf, trail: [], gtrail: [],
    };
  }

  // Stops on the cushion, exactly on it. The last frame of a slide is the one
  // the reader measures the angle from, so it must not sit a step past the rail.
  function c2Advance(b, hh, RT) {
    if (b.stuck) return;
    const dx = b.vx * hh, dy = b.vy * hh;
    const nx = b.x + dx, ny = b.y + dy;
    if (Math.hypot(nx, ny) < RT) { b.x = nx; b.y = ny; return; }
    const aa = dx * dx + dy * dy;
    if (!(aa > 1e-18)) { b.stuck = true; return; }
    const bb = 2 * (b.x * dx + b.y * dy);
    const cc = b.x * b.x + b.y * b.y - RT * RT;
    const disc = bb * bb - 4 * aa * cc;
    const frac = disc > 0 ? cl((-bb + Math.sqrt(disc)) / (2 * aa), 0, 1) : 1;
    b.x += dx * frac;
    b.y += dy * frac;
    b.stuck = true;
  }

  function c2Step(R, A, dt) {
    const n = Math.max(1, Math.ceil((dt * A.rate) / (A.simEnd / 900)));
    const hh = (dt * A.rate) / n;
    for (let i = 0; i < n; i++) {
      if (!A.merged) {
        const s = Math.min(hh, Math.max(A.tHit - A.sim, 0));
        A.p1.x += A.v1x * s; A.p1.y += A.v1y * s;
        A.p2.x += A.v2x * s; A.p2.y += A.v2y * s;
        A.sim += s;
        if (A.sim >= A.tHit - 1e-12) {
          // They were launched to arrive together, so this is a rounding tidy
          // of a few parts in 10^15, not a nudge into place.
          A.p1.x = 0; A.p1.y = 0; A.p2.x = 0; A.p2.y = 0;
          A.merged = true;
        }
        const rest = hh - s;
        if (rest > 1e-15 && A.merged) {
          c2Advance(A.self, rest, A.RT);
          c2Advance(A.ghost, rest, A.RT);
          A.sim += rest;
        }
        continue;
      }
      c2Advance(A.self, hh, A.RT);
      c2Advance(A.ghost, hh, A.RT);
      A.sim += hh;
    }
    if (A.merged && A.trail.length < 400) {
      A.trail.push({ x: A.self.x, y: A.self.y });
      A.gtrail.push({ x: A.ghost.x, y: A.ghost.y });
    }
  }

  function c2Draw(ctx, w, h, P, R, RES, A) {
    const small = compact(w, h);
    const RT = A ? A.RT : C2_TABLE;
    const cx = w * (small ? 0.50 : 0.40);
    const cy = h * 0.52;
    const rad = Math.max(Math.min(w * (small ? 0.44 : 0.34), h * 0.40), 8);
    const S = rad / RT;
    const X = function (x) { return cx + x * S; };
    const Y = function (y) { return cy - y * S; };
    const pr = Math.max(Math.min(w, h) * 0.022, 2.5);

    // the table, and the axes the headings are quoted against
    disc(ctx, cx, cy, rad, P.rule, P.panel, 1.8);
    dash(ctx, cx - rad, cy, cx + rad, cy, P.rule, 1, [3, 5]);
    dash(ctx, cx, cy - rad, cx, cy + rad, P.rule, 1, [3, 5]);
    if (!small) lab(ctx, cx + rad - 12, cy - 10, "+x", P.inkSoft, 10);

    const merged = A ? A.merged : false;
    const vIn = Math.max(R.v1, R.v2);
    const p1 = A ? A.p1 : { x: -Math.cos(R.th1 * RAD) * (R.v1 / vIn) * RT, y: -Math.sin(R.th1 * RAD) * (R.v1 / vIn) * RT };
    const p2 = A ? A.p2 : { x: -Math.cos(R.th2 * RAD) * (R.v2 / vIn) * RT, y: -Math.sin(R.th2 * RAD) * (R.v2 / vIn) * RT };

    if (!merged) {
      const puck = function (p, th, v, m, colour, name) {
        const px = X(p.x), py = Y(p.y);
        disc(ctx, px, py, pr, colour, P.panel, 1.6);
        const alen = Math.min(rad * 0.30, 14 + v * 3);
        arrow(ctx, px, py, px + Math.cos(th * RAD) * alen, py - Math.sin(th * RAD) * alen, colour, 1.8);
        if (!small) {
          lab(ctx, px, py - pr - 10, name + "  " + fx(m, 2) + " kg, " + fx(v, 1) + " m/s",
            colour, 10);
        }
        return { x: px, y: py };
      };
      const a1 = puck(p1, R.th1, R.v1, R.m1, P.navy, "A");
      const a2 = puck(p2, R.th2, R.v2, R.m2, P.brass, "B");
      mark("puckA", a1.x, a1.y);
      mark("puckB", a2.x, a2.y);
      mark("pair", X(0), Y(0));
      mark("ghost", X(0), Y(0));
    } else {
      const trailOf = function (arr, colour, alpha) {
        if (!(arr.length > 1)) return;
        ctx.save();
        ctx.strokeStyle = colour;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
          if (i === 0) ctx.moveTo(X(arr[i].x), Y(arr[i].y));
          else ctx.lineTo(X(arr[i].x), Y(arr[i].y));
        }
        ctx.stroke();
        ctx.restore();
      };
      trailOf(A.gtrail, P.forest, 0.45);
      trailOf(A.trail, P.crimson, 0.6);

      // The two lines the answer picked out, drawn to the cushion so the gap
      // between them is the whole width of the table at its widest.
      const ray = function (thDeg, colour, alpha, wid) {
        ctx.save();
        ctx.globalAlpha = alpha;
        dash(ctx, cx, cy, cx + Math.cos(thDeg * RAD) * rad, cy - Math.sin(thDeg * RAD) * rad,
          colour, wid, [5, 4]);
        ctx.restore();
      };
      ray(R.thf, P.forest, 0.7, 1.4);
      if (A.vSelf > 0) ray(A.aSelf, P.crimson, 0.8, 1.4);

      const gp = { x: X(A.ghost.x), y: Y(A.ghost.y) };
      const sp = { x: X(A.self.x), y: Y(A.self.y) };
      ctx.save();
      ctx.globalAlpha = 0.45;
      disc(ctx, gp.x, gp.y, pr * 1.25, P.forest, P.forest, 1.4);
      ctx.restore();
      disc(ctx, sp.x, sp.y, pr * 1.25, P.crimson, P.panel, 1.8);
      mark("pair", sp.x, sp.y);
      mark("ghost", gp.x, gp.y);
      mark("puckA", X(0), Y(0));
      mark("puckB", X(0), Y(0));

      const gap = degDelta(A.aSelf, R.thf);
      if (!small && Math.abs(gap) > 0.4 && A.vSelf > 0) {
        const arcR = rad * 0.42;
        ctx.save();
        ctx.strokeStyle = P.crimson;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, -R.thf * RAD, -(R.thf + gap) * RAD, gap > 0);
        ctx.stroke();
        ctx.restore();
        const midDeg = R.thf + gap / 2;
        lab(ctx, cx + Math.cos(midDeg * RAD) * (arcR + 16), cy - Math.sin(midDeg * RAD) * (arcR + 16),
          fx(Math.abs(gap), 1) + " deg", P.crimson, 11);
      }
    }

    if (!small) {
      const rows = [
        ["A", fx(R.m1, 2) + " kg @ " + fx(R.th1, 0) + " deg"],
        ["B", fx(R.m2, 2) + " kg @ " + fx(R.th2, 0) + " deg"],
      ];
      if (RES) {
        rows.push(["you said", fx(RES.vGuess, 2) + " m/s, " + fx(RES.aGuess, 1) + " deg"]);
        rows.push(["truth", fx(R.vf, 2) + " m/s, " + fx(R.thf, 1) + " deg"]);
        rows.push(["track error", fx(RES.angleGap, 1) + " deg",
          RES.angleGap <= R.tolA ? P.forest : P.crimson]);
        if (R.tier === 2) {
          rows.push(["KE lost", fx(R.loss, 2) + " J of " + fx(R.KEi, 2) + " J"]);
        }
      }
      if (A) rows.push(["t", fx(A.sim, 2) + " s"]);
      const pw = Math.min(w * 0.32, 210);
      plate(ctx, w - pw - 10, 10, pw, rows, P);

      // The energy the hard tier is asked about, as two bars: what went in and
      // what is still moving. The gap between them is the answer.
      if (R.tier === 2 && RES && h > 300) {
        const bw = Math.min(w * 0.26, 170);
        const bx = w - bw - 10;
        // clear of the strip the host paints its verdict into
        const by = h - 96;
        const bh = 11;
        ctx.save();
        ctx.fillStyle = P.rule;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillRect(bx, by + bh + 6, bw, bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = P.navy;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = P.forest;
        ctx.fillRect(bx, by + bh + 6, bw * cl(R.KEf / Math.max(R.KEi, 1e-9), 0, 1), bh);
        ctx.restore();
        lab(ctx, bx, by - 8, "KE in " + fx(R.KEi, 2) + " J", P.navy, 10, "left");
        lab(ctx, bx, by + bh * 2 + 16, "KE out " + fx(R.KEf, 2) + " J", P.forest, 10, "left");
      }
      bench(ctx, w, h, "Air table", P);
    }
  }

  /* ============================================================================
     GAME 7 — angular-impulse, "Angular impulse"
     ----------------------------------------------------------------------------
     A uniform rod on a frictionless pivot through one END, lying on a table so
     that gravity plays no part at all. A steady force F is applied at r from the
     pivot, at theta to the rod, for dt seconds, and the rod starts at rest.

        tau = r F sin(theta)        dL = tau dt        L = I omega
        I  = M L^2/3  (rod about its END)
        omega = tau dt / I          dtheta = 0.5 omega dt   (from rest)
        W = tau dtheta              P = tau omega

     Two errors own this bench.

     Using the whole r*F when the force is not perpendicular multiplies the
     answer by 1/sin(theta), which is greater than one for every angle that is
     not a right angle. It ALWAYS overestimates, which is what makes it a
     diagnosis rather than a guess, and rounds are generated with sin(theta) at
     most 0.87 so the overestimate is never inside the tolerance.

     Writing omega = tau/I drops the seconds. At dt = 1 s that is the right
     answer, so the grid of durations has a hole in it around one second: a
     detector that cannot be told from being right must not be allowed to fire,
     and here the round is built so the question never arises.

     cos where sin belongs is the same slip the conical pendulum once tripped
     over at 45 degrees, where cos and sin coincide. The angle grid skips 45,
     and the detector gate would stand the candidate down anyway.

     The reveal spins the rod up under the real torque while a ghost rotor on the
     same pivot spins up to the reader's omega over the same dt. Both start at
     rest and both reach their claimed speed at the moment the force is removed,
     so everything after that is drift: the angle between the two rods grows at
     exactly (omega_true - omega_you) radians per second, and which way it opens
     is the sign of the error.
     ========================================================================== */

  const AI_L = [0.60, 0.80, 1.00, 1.20, 1.50];
  const AI_M = grid(0.40, 6.00, 0.20);
  const AI_TH = [25, 30, 35, 40, 50, 55, 60];
  const AI_DT = grid(0.20, 3.00, 0.10).filter(function (t) { return t < 0.85 || t > 1.15; });

  function aiMake(tier) {
    for (let attempt = 0; attempt < 1500; attempt++) {
      const L = pick(AI_L);
      const M = pick(AI_M);
      // A rod of exactly 1 kg makes "the mass fell out of the inertia" the right
      // answer, and 4 kg makes it the same answer as using the centre-of-mass
      // inertia. Both detectors have to stay separable from the truth and from
      // each other.
      if (Math.abs(M - 1) < 0.15 || Math.abs(M - 4) < 0.25) continue;

      const thDeg = tier === 0 ? 90 : pick(AI_TH);
      const sinT = Math.sin(thDeg * RAD);
      const r = rr(uni(0.35, 1.0) * L, 2);
      // A metre arm makes F/r and F*r the same number, so "the lever arm
      // divides" could not be told from the truth.
      if (r < 0.15 || r > L || Math.abs(r - 1) < 0.07) continue;
      const dtA = pick(AI_DT);
      if (tier === 2 && Math.abs(dtA - 2) < 0.15) continue;   // P and W collapse together at dt = 2

      const I = (M * L * L) / 3;
      // Backwards: fix the spin the round should land on, solve for the force,
      // then round it to the one decimal it is printed at and recompute.
      const wWant = uni(2.8, 9.0);
      const F = rr((wWant * I) / (r * sinT * dtA), 1);
      if (F < 1.5 || F > 400) continue;

      const tau = r * F * sinT;
      const omega = (tau * dtA) / I;
      if (omega < 2.8 || omega > 9.5) continue;
      if (tier === 2 && Math.abs(dtA - omega) < 0.4) continue;   // impulse and power collapse together

      const dth = 0.5 * omega * dtA;      // radians turned while the force acts, from rest
      const work = tau * dth;
      const power = tau * omega;
      const tolO = Math.max(0.02 * omega, 0.02);
      const tolWk = Math.max(0.02 * work, 0.02);
      const tolP = Math.max(0.02 * power, 0.02);

      const wFull = (r * F * dtA) / I;                       // sin(theta) ignored
      const wCos = (r * F * Math.cos(thDeg * RAD) * dtA) / I; // cos where sin belongs
      const wNoTime = tau / I;                               // the seconds dropped
      const wCom = (tau * dtA) / ((M * L * L) / 12);         // inertia about the centre
      const wNoMass = (tau * dtA) / ((L * L) / 3);           // inertia without its mass
      const wInvArm = (((F / r) * sinT) * dtA) / I;          // lever arm dividing

      // Every named route asserted apart from the truth rather than assumed so.
      if (tier > 0 && !(wFull - omega > 3 * tolO)) continue;
      if (tier > 0 && Math.abs(wCos - omega) <= 3 * tolO) continue;
      if (Math.abs(wNoTime - omega) <= 3 * tolO) continue;
      if (Math.abs(wNoMass - omega) <= 3 * tolO) continue;
      if (Math.abs(wInvArm - omega) <= 3 * tolO) continue;
      if (tier === 2) {
        if (Math.abs(tau * dtA - work) <= 3 * tolWk) continue;
        if (Math.abs(power - work) <= 3 * tolWk) continue;
        if (Math.abs(2 * work - work) <= 3 * tolWk) continue;
        if (Math.abs(work / dtA - power) <= 3 * tolP) continue;
        if (Math.abs(work - power) <= 3 * tolP) continue;
      }

      const givens = [
        { label: "Rod length, L", value: fx(L, 2), unit: "m" },
        { label: "Rod mass, M (uniform)", value: fx(M, 2), unit: "kg" },
        { label: "Force applied at r from the pivot", value: fx(r, 2), unit: "m" },
        { label: "Force, F", value: fx(F, 1), unit: "N" },
        {
          label: "Angle between the force and the rod, theta",
          value: fx(thDeg, 0),
          unit: tier === 0 ? "degrees (perpendicular)" : "degrees",
        },
        { label: "The force acts for", value: fx(dtA, 2), unit: "s" },
      ];

      const inputs = [{ key: "omega", label: "Angular speed when the force is removed", unit: "rad/s", step: "0.001" }];
      if (tier === 2) {
        inputs.push({ key: "work", label: "Work the torque does over that time", unit: "J", step: "0.01" });
        inputs.push({ key: "power", label: "Power it is delivering at the instant it is removed", unit: "W", step: "0.01" });
      }

      const prompt = tier === 0
        ? "The rod lies on a frictionless table, pivoted through one END, and starts at rest. The "
          + "force is applied at right angles to the rod and held steady. How fast is the rod "
          + "turning when it is removed?"
        : tier === 1
          ? "The rod lies on a frictionless table, pivoted through one END, and starts at rest. The "
            + "force is applied at " + fx(thDeg, 0) + " degrees to the rod and held steady. How fast "
            + "is the rod turning when it is removed?"
          : "The rod lies on a frictionless table, pivoted through one END, and starts at rest. The "
            + "force is applied at " + fx(thDeg, 0) + " degrees to the rod and held steady. Give the "
            + "angular speed when it is removed, the work the torque did, and the power it was "
            + "delivering at that last instant.";

      const note = tier === 0
        ? "The table is horizontal, so gravity does no turning at all. A rod turning about its END "
          + "has I = M L^2/3, not M L^2/12 — that one is about its centre."
        : tier === 1
          ? "Only the component of the force ACROSS the rod turns anything: tau = r F sin(theta). "
            + "The component along the rod pulls on the pivot and does nothing else."
          : "The rod starts at rest, so the angle it turns through while the force acts is "
            + "0.5*alpha*dt^2 — not alpha*dt^2, and not omega*dt. Power is torque times the angular "
            + "speed AT THAT MOMENT, which is not the same as the work divided by the time.";

      return {
        game: "angular-impulse", tier: tier,
        L: L, M: M, r: r, F: F, th: thDeg, dt: dtA,
        I: I, tau: tau, omega: omega, dth: dth, work: work, power: power,
        wFull: wFull, wCos: wCos, wNoTime: wNoTime, wCom: wCom, wNoMass: wNoMass, wInvArm: wInvArm,
        tolO: tolO, tolWk: tolWk, tolP: tolP,
        givens: givens, inputs: inputs, prompt: prompt, note: note,
      };
    }
    return null;
  }

  function aiSolution(R) {
    const s = [];
    s.push("Inertia   I = M L^2/3 (rod about its END) = " + fx(R.M, 2) + "*" + fx(R.L, 2)
      + "^2/3 = " + fx(R.I, 5) + " kg m^2");
    s.push("Torque    tau = r F sin(theta) = " + fx(R.r, 2) + "*" + fx(R.F, 1) + "*sin("
      + fx(R.th, 0) + ") = " + fx(R.r, 2) + "*" + fx(R.F, 1) + "*" + fx(Math.sin(R.th * RAD), 4)
      + " = " + fx(R.tau, 4) + " N m");
    s.push("Impulse   dL = tau dt = " + fx(R.tau, 4) + "*" + fx(R.dt, 2) + " = "
      + fx(R.tau * R.dt, 4) + " kg m^2/s");
    s.push("Spin      L = I omega from rest, so omega = dL/I = " + fx(R.tau * R.dt, 4) + "/"
      + fx(R.I, 5) + " = " + fx(R.omega, 4) + " rad/s   (" + fx(R.omega / TAU, 3) + " rev/s)");
    if (R.tier > 0) {
      s.push("The sin matters: ignoring it and using the whole r F gives " + fx(R.wFull, 4)
        + " rad/s, which is " + fx((R.wFull / R.omega - 1) * 100, 1) + "% too fast. The component of "
        + "F along the rod is carried entirely by the pivot and turns nothing.");
    }
    if (R.tier === 2) {
      s.push("Angle     alpha = tau/I = " + fx(R.tau / R.I, 4) + " rad/s^2, and from rest "
        + "dtheta = 0.5 alpha dt^2 = 0.5*omega*dt = " + fx(R.dth, 4) + " rad ("
        + fx(R.dth / TAU, 3) + " rev)");
      s.push("Work      W = tau dtheta = " + fx(R.tau, 4) + "*" + fx(R.dth, 4) + " = "
        + fx(R.work, 4) + " J");
      s.push("Check     0.5 I omega^2 = 0.5*" + fx(R.I, 5) + "*" + fx(R.omega, 4) + "^2 = "
        + fx(0.5 * R.I * R.omega * R.omega, 4) + " J. Same number: all of the work went into "
        + "rotational kinetic energy, because nothing else was there to take any.");
      s.push("Power     P = tau omega = " + fx(R.tau, 4) + "*" + fx(R.omega, 4) + " = "
        + fx(R.power, 4) + " W at the last instant. The AVERAGE over the burst was W/dt = "
        + fx(R.work / R.dt, 4) + " W — exactly half, because a constant torque on a body starting "
        + "from rest delivers power that climbs linearly from zero.");
    }
    return s;
  }

  function aiGrade(R, f) {
    const go = f.omega;
    const gw = R.tier === 2 ? f.work : NaN;
    const gp = R.tier === 2 ? f.power : NaN;
    const dO = go - R.omega;
    const dW = R.tier === 2 ? gw - R.work : 0;
    const dP = R.tier === 2 ? gp - R.power : 0;
    const okO = Math.abs(dO) <= R.tolO;
    const okW = R.tier !== 2 || Math.abs(dW) <= R.tolWk;
    const okP = R.tier !== 2 || Math.abs(dP) <= R.tolP;
    const correct = okO && okW && okP;

    let mis = null;
    if (!correct) {
      if (!okO) {
        mis = detect(go, R.omega, [
          {
            id: "full-lever-arm",
            label: "The whole r F is not the torque",
            detail: " Only the component of the force ACROSS the rod turns it, so tau = r F"
              + " sin(theta) = " + fx(R.tau, 3) + " N m, not r F = " + fx(R.r * R.F, 3) + " N m. The"
              + " other component points along the rod and is swallowed by the pivot. Using the"
              + " whole thing multiplies the answer by 1/sin(" + fx(R.th, 0) + ") = "
              + fx(1 / Math.sin(R.th * RAD), 3) + ", and always in the same direction: too fast.",
            value: R.wFull,
          },
          {
            id: "cos-not-sin",
            label: "cos where sin belongs",
            detail: " theta is measured between the force and the ROD, so the across-rod component"
              + " — the one with a lever arm — is F sin(theta). F cos(theta) is the part pointing"
              + " along the rod, straight at the pivot, which has no arm at all. Sketch the force at "
              + fx(R.th, 0) + " degrees and drop a perpendicular onto the rod.",
            value: R.wCos,
          },
          {
            id: "time-dropped",
            label: "The impulse is tau*dt, not tau",
            detail: " A torque does not set a speed, it changes one: dL = tau dt. The force was held"
              + " for " + fx(R.dt, 2) + " s, so the rod picked up " + fx(R.tau * R.dt, 4)
              + " kg m^2/s of angular momentum, not " + fx(R.tau, 4) + ". Dividing tau alone by I"
              + " leaves you with an angular ACCELERATION, in rad/s^2.",
            value: R.wNoTime,
          },
          {
            id: "com-inertia",
            label: "That inertia is about the wrong axis",
            detail: " M L^2/12 is a rod turning about its CENTRE. This one turns about its end, and"
              + " the parallel axis theorem adds M(L/2)^2 to give M L^2/12 + M L^2/4 = M L^2/3 ="
              + " " + fx(R.I, 5) + " kg m^2 — four times as much, so a quarter of the spin.",
            value: R.wCom,
          },
          {
            id: "mass-dropped",
            label: "The inertia carries the mass",
            detail: " I = M L^2/3 is in kg m^2. L^2/3 = " + fx((R.L * R.L) / 3, 4) + " is a length"
              + " squared and cannot be divided into a kg m^2/s. The rod's " + fx(R.M, 2)
              + " kg is exactly what makes it hard to spin up.",
            value: R.wNoMass,
          },
          {
            id: "tau-inverted",
            label: "The lever arm multiplies, it does not divide",
            detail: " tau = r F sin(theta). A force applied FARTHER from the pivot turns the rod"
              + " harder, which is why a long spanner is easier than a short one — so r belongs on"
              + " top. F/r would make the pivot itself the best place to push from.",
            value: R.wInvArm,
          },
          {
            id: "no-two-pi",
            label: "That is in revolutions, not radians",
            detail: " " + fx(R.omega / TAU, 4) + " rev/s is the same spin as " + fx(R.omega, 4)
              + " rad/s. L = I omega only works in radians per second, because I in kg m^2 was"
              + " derived with angle in radians. One turn is 2*pi of them.",
            value: R.omega / TAU,
          },
        ], {
          near: Math.max(R.tolO * 1.5, R.omega * 0.025),
          gap: Math.max(R.tolO * 3, R.omega * 0.05),
        });
      } else if (!okW) {
        mis = detect(gw, R.work, [
          {
            id: "impulse-not-work",
            label: "That is the angular impulse, not the work",
            detail: " tau*dt = " + fx(R.tau * R.dt, 4) + " is in N m s and is angular momentum."
              + " Work is torque times the ANGLE turned through, tau*dtheta, and it comes out in"
              + " joules. The two share a symbol on the page and nothing else.",
            value: R.tau * R.dt,
          },
          {
            id: "power-not-work",
            label: "That is the power, not the work",
            detail: " tau*omega = " + fx(R.power, 3) + " W is joules per second at the last instant."
              + " Over the whole burst the torque turned the rod through " + fx(R.dth, 4)
              + " rad and did tau*dtheta = " + fx(R.work, 3) + " J.",
            value: R.power,
          },
          {
            id: "no-half-angle",
            label: "The rod started at rest",
            detail: " alpha*dt^2 = " + fx((R.tau / R.I) * R.dt * R.dt, 4) + " rad is twice the angle"
              + " actually turned. From rest, dtheta = 0.5*alpha*dt^2 = " + fx(R.dth, 4)
              + " rad — the same one half that lives in s = 0.5 a t^2.",
            value: 2 * R.work,
          },
          {
            id: "degrees-not-radians",
            label: "Radians, not degrees",
            detail: " W = tau*dtheta needs dtheta in radians: " + fx(R.dth, 4) + " rad, not "
              + fx(R.dth * DEG, 1) + " degrees. Feeding degrees in inflates the answer by 180/pi.",
            value: R.tau * R.dth * DEG,
          },
        ], {
          near: Math.max(R.tolWk * 1.5, R.work * 0.025),
          gap: Math.max(R.tolWk * 3, R.work * 0.05),
        });
      } else {
        mis = detect(gp, R.power, [
          {
            id: "average-not-final-power",
            label: "That is the average power, not the final one",
            detail: " W/dt = " + fx(R.work / R.dt, 3) + " W is what the torque delivered on average."
              + " The rod started at rest, where P = tau*0 = 0, and the power climbed linearly to"
              + " tau*omega = " + fx(R.power, 3) + " W at the last instant. The average of a straight"
              + " climb from zero is exactly half the end value, which is why this is always P/2.",
            value: R.work / R.dt,
          },
          {
            id: "work-not-power",
            label: "That is the work, not the power",
            detail: " " + fx(R.work, 3) + " J is the whole job. Power is how fast it was being done,"
              + " tau*omega, in watts — and at the last instant the rod was turning at "
              + fx(R.omega, 3) + " rad/s.",
            value: R.work,
          },
        ], {
          near: Math.max(R.tolP * 1.5, R.power * 0.025),
          gap: Math.max(R.tolP * 3, R.power * 0.05),
        });
      }
    }

    let v;
    if (correct) v = verdict("hit", "Locked to the rotor");
    else if (!okO) {
      v = dO > 0 ? verdict("over", "Spinning " + fx(Math.abs(dO), 2) + " rad/s too fast")
        : verdict("under", "Spinning " + fx(Math.abs(dO), 2) + " rad/s too slow");
    } else if (!okW) {
      v = dW > 0 ? verdict("over", "Work over by " + fx(Math.abs(dW), 2) + " J")
        : verdict("under", "Work short by " + fx(Math.abs(dW), 2) + " J");
    } else {
      v = dP > 0 ? verdict("over", "Power over by " + fx(Math.abs(dP), 2) + " W")
        : verdict("under", "Power short by " + fx(Math.abs(dP), 2) + " W");
    }

    // How far apart the two rotors are by the end of the reveal, in whole turns:
    // the number the reader is about to watch accumulate.
    const coast = cl(2.0 * R.dt, 1.4, 3.2);
    const lead = ((R.omega - go) * coast) / TAU;

    const parts = [];
    if (correct) {
      parts.push("Your ghost rotor and the rod stay locked together for as long as the reveal runs");
    } else if (!okO) {
      parts.push(dO > 0
        ? "Your ghost rotor pulls ahead of the rod by " + fx(Math.abs(lead), 2)
          + " turns in the seconds after the force comes off"
        : "The rod pulls ahead of your ghost rotor by " + fx(Math.abs(lead), 2)
          + " turns in the seconds after the force comes off");
    } else {
      parts.push("The spin is right, so the impulse was handled; the energy bookkeeping was not");
    }
    parts.push("Exact spin " + fx(R.omega, 4) + " rad/s from tau = " + fx(R.tau, 4) + " N m");
    if (R.tier === 2) {
      parts.push("exact work " + fx(R.work, 4) + " J and final power " + fx(R.power, 4) + " W");
    }

    const out = makeResult({
      correct: correct, verdict: v, feedback: parts.join(". ") + ".",
      misconception: mis, solution: aiSolution(R),
      exact: {
        omega: rr(R.omega, 5),
        work: R.tier === 2 ? rr(R.work, 5) : null,
        power: R.tier === 2 ? rr(R.power, 5) : null,
      },
      tolerance: {
        omega: rr(R.tolO, 5),
        work: R.tier === 2 ? rr(R.tolWk, 5) : null,
        power: R.tier === 2 ? rr(R.tolP, 5) : null,
      },
    });
    out.oGuess = go;
    out.wGuess = gw;
    out.pGuess = gp;
    return out;
  }

  /* --- rotor reveal --------------------------------------------------------- */

  function aiPlay(R, RES) {
    const guess = Number.isFinite(RES.oGuess) ? RES.oGuess : R.omega;
    const drive = R.dt;
    const coast = cl(2.0 * drive, 1.4, 3.2);
    const simEnd = drive + coast;
    const wMax = Math.max(Math.abs(R.omega), Math.abs(guess), 0.5);
    // A tenth of a radian between 60 Hz frames at most. A rotor stepping forty
    // degrees a frame is a strobe, not a spin, however exact the integrator
    // under it is — and the floor stops a wild prediction from stretching the
    // run past the host's reduced-motion budget.
    const smooth = (0.10 * 60) / wMax;
    const lo = Math.min(simEnd / 12, 3);
    const rate = cl(Math.min(simEnd / 8, smooth), lo, 3);
    return {
      kind: "ai", t: 0, sim: 0, dur: simEnd / rate, rate: rate, done: false,
      simEnd: simEnd, drive: drive,
      alpha: R.tau / R.I,
      // The ghost is spun up over the same dt so that both rotors are at rest at
      // t = 0 and at their claimed speed at the moment the force comes off.
      // Anything after that is drift, not a phase offset chosen at the start.
      alphaG: guess / Math.max(drive, 1e-6),
      real: { phi: 0, w: 0 }, ghost: { phi: 0, w: 0 },
      work: 0, guess: guess,
    };
  }

  // Constant angular acceleration, so the midpoint form is exact to machine
  // precision. The separation on the stage is therefore the reader's error and
  // never the integrator's.
  function aiSpin(o, alpha, hh) {
    o.phi += (o.w + 0.5 * alpha * hh) * hh;
    o.w += alpha * hh;
  }

  function aiStep(R, A, dt) {
    const n = Math.max(1, Math.ceil((dt * A.rate) / (A.simEnd / 900)));
    const hh = (dt * A.rate) / n;
    for (let i = 0; i < n; i++) {
      const driving = A.sim < A.drive - 1e-12;
      const s = driving ? Math.min(hh, A.drive - A.sim) : hh;
      const before = A.real.phi;
      aiSpin(A.real, driving ? A.alpha : 0, s);
      aiSpin(A.ghost, driving ? A.alphaG : 0, s);
      // Work accumulated as the integral of tau dphi rather than read off a
      // formula, so the readout climbing on the plate is the same quantity the
      // reader was asked for.
      if (driving) A.work += R.tau * (A.real.phi - before);
      A.sim += s;
      const rest = hh - s;
      if (rest > 1e-15) {
        aiSpin(A.real, 0, rest);
        aiSpin(A.ghost, 0, rest);
        A.sim += rest;
      }
    }
  }

  function aiRod(ctx, cx, cy, phi, lenPx, colour, alpha, P, wide) {
    const halfW = Math.max(lenPx * 0.035, 1.6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(-phi);                       // screen y runs down, world angles run anticlockwise
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = colour;
    ctx.lineWidth = wide ? 1.8 : 1.2;
    ctx.fillRect(0, -halfW, lenPx, halfW * 2);
    ctx.strokeRect(0, -halfW, lenPx, halfW * 2);
    ctx.restore();
    return { x: cx + Math.cos(phi) * lenPx, y: cy - Math.sin(phi) * lenPx };
  }

  function aiDraw(ctx, w, h, P, R, RES, A) {
    const small = compact(w, h);
    const cx = w * (small ? 0.34 : 0.30);
    const cy = h * 0.52;
    const armPx = Math.max(Math.min(w * (small ? 0.44 : 0.32), h * 0.36), 8);
    const S = armPx / Math.max(R.L, 1e-6);
    const phiR = A ? A.real.phi : 0;
    const phiG = A ? A.ghost.phi : 0;
    const driving = A ? A.sim < A.drive : false;

    // the table under it, so the reader is never wondering where gravity went
    disc(ctx, cx, cy, armPx * 1.18, P.rule, P.panel, 1);

    if (A) {
      const gt = aiRod(ctx, cx, cy, phiG, armPx, P.forest, 0.42, P, false);
      mark("ghostTip", gt.x, gt.y);
    } else {
      mark("ghostTip", cx + armPx, cy);
    }
    const tip = aiRod(ctx, cx, cy, phiR, armPx, P.crimson, 1, P, true);
    mark("rodTip", tip.x, tip.y);
    disc(ctx, cx, cy, Math.max(armPx * 0.05, 2.5), P.ink, P.paper, 1.6);

    // The applied force, on the real rod, at r along it and theta to it. Its
    // opacity fades over the first fifth of a second after the burst rather
    // than blinking out, because a force that vanishes between two frames reads
    // as an event in the physics.
    const fadeAlpha = !A ? 1
      : (A.sim <= A.drive ? 1 : cl(1 - (A.sim - A.drive) / 0.20, 0, 1));
    if (fadeAlpha > 0.02) {
      const ax = cx + Math.cos(phiR) * R.r * S;
      const ay = cy - Math.sin(phiR) * R.r * S;
      const fDir = phiR + R.th * RAD;
      const fLen = Math.min(armPx * 0.55, 12 + R.F * 0.5);
      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      arrow(ctx, ax, ay, ax + Math.cos(fDir) * fLen, ay - Math.sin(fDir) * fLen, P.navy, 2.2);
      ctx.restore();
      disc(ctx, ax, ay, Math.max(armPx * 0.028, 1.6), P.navy, P.navy, 1);
      if (!small) {
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        lab(ctx, ax + Math.cos(fDir) * (fLen + 14), ay - Math.sin(fDir) * (fLen + 14),
          fx(R.F, 1) + " N", P.navy, 10);
        ctx.restore();
      }
      mark("forcePoint", ax, ay);
    } else {
      mark("forcePoint", cx + Math.cos(phiR) * R.r * S, cy - Math.sin(phiR) * R.r * S);
    }

    // the angle between the force and the rod, posed only: once the rod is
    // turning the arc chases it and reads as clutter
    if (!A && !small && armPx > 60) {
      const arcR = R.r * S * 0.45;
      ctx.save();
      ctx.strokeStyle = P.navy;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(phiR) * R.r * S, cy - Math.sin(phiR) * R.r * S, arcR,
        -phiR, -(phiR + R.th * RAD), true);
      ctx.stroke();
      ctx.restore();
      lab(ctx, cx + Math.cos(phiR) * R.r * S + arcR * 1.5,
        cy - Math.sin(phiR) * R.r * S - arcR * 0.9, fx(R.th, 0) + " deg", P.navy, 10, "left");
      dash(ctx, cx, cy + armPx * 0.22, cx + R.r * S, cy + armPx * 0.22, P.inkSoft, 1, [3, 3]);
      lab(ctx, cx + (R.r * S) / 2, cy + armPx * 0.30, "r = " + fx(R.r, 2) + " m", P.inkSoft, 10);
    }

    // The whole point of the reveal: the angle the two rotors have opened up.
    if (A && !small) {
      const gap = degDelta(phiR * DEG, phiG * DEG);
      if (Math.abs(gap) > 0.6) {
        const arcR = armPx * 0.62;
        ctx.save();
        ctx.strokeStyle = P.brass;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, -phiG, -(phiG + gap * RAD), gap > 0);
        ctx.stroke();
        ctx.restore();
        const mid = phiG + (gap * RAD) / 2;
        lab(ctx, cx + Math.cos(mid) * (arcR + 15), cy - Math.sin(mid) * (arcR + 15),
          fx(Math.abs(gap), 0) + " deg", P.brass, 11);
      }
      // held out of the bottom strip, which belongs to the host's verdict
      lab(ctx, cx, Math.min(cy + armPx * 1.34, h - 64), driving ? "force on" : "coasting",
        driving ? P.navy : P.inkSoft, 10);
    }

    if (!small) {
      // tau = r F sin(theta) IS the middle tier and I = M L^2/3 is the easy
      // one. Printing either while the box is still open would answer the
      // question the box is asking.
      const rows = RES
        ? [["I about the pivot", fx(R.I, 4)], ["tau", fx(R.tau, 3) + " N m"]]
        : [["I about the pivot", "— work it out"], ["tau", "— work it out"]];
      if (RES) {
        rows.push(["you predicted", fx(RES.oGuess, 3) + " rad/s"]);
        rows.push(["true omega", fx(R.omega, 3) + " rad/s"]);
        if (R.tier === 2) {
          rows.push(["work", fx(R.work, 2) + " J"]);
          rows.push(["final power", fx(R.power, 2) + " W"]);
        }
        if (A) {
          rows.push(["rod turns", fx(A.real.phi / TAU, 2)]);
          rows.push(["ghost turns", fx(A.ghost.phi / TAU, 2)]);
          const lead = (A.real.phi - A.ghost.phi) / TAU;
          rows.push(["drift", (lead >= 0 ? "+" : "") + fx(lead, 2) + " turn",
            Math.abs(lead) < 0.02 ? P.forest : P.crimson]);
          if (R.tier === 2) rows.push(["work so far", fx(A.work, 2) + " J"]);
        }
      }
      const pw = Math.min(w * 0.32, 210);
      plate(ctx, w - pw - 10, 10, pw, rows, P);
      bench(ctx, w, h, "Pivoted rod", P);
    }
  }

  /* ============================================================================
     THE MODULE CONTRACT
     ----------------------------------------------------------------------------
     One table, seven rows, and every entry the same shape. The five steppers
     underneath were written with three different signatures — some need the
     round, some do not — so each is wrapped here rather than edited in place:
     the adapter is one line and lives next to the six other lines that say what
     the game is, which is where a reader looks for it.

     Nothing below re-grades. `play` rebuilds the animation from the STORED
     result, because the host calls it once on submit and again on every Replay
     press, and a reader who could walk their number in until it landed would be
     doing the arithmetic on the stage instead of on paper.
     ========================================================================== */

  /* `live` names the numbers that MOVE, and only those. A blanket sweep of the
     animation bag for non-finite values would be shorter and wrong: three of
     these bags carry a deliberate Infinity -- a heading that never reaches the
     far bank, a period at a hole that does not exist -- which the drawers read
     as "never" and which is not a fault. */
  const GAMES = {
    "spring-combo": {
      make: springMake, grade: springGrade, play: springPlay, draw: springDraw,
      step: function (R, A, dt) { springStep(A, dt); },
      live: function (A) { return [A.x, A.v, A.sim]; },
    },
    "physical-pendulum-game": {
      make: ppMake, grade: ppGrade, play: ppPlay, draw: ppDraw,
      step: function (R, A, dt) { ppStep(A, dt); },
      live: function (A) {
        return [A.a.th, A.a.w, A.b ? A.b.th : 0, A.b ? A.b.w : 0, A.sim];
      },
    },
    "terminal-velocity": {
      make: tvMake, grade: tvGrade, play: tvPlay, draw: tvDraw,
      step: function (R, A, dt) { tvStep(R, A, dt); },
      live: function (A) { return [A.v, A.x, A.sim]; },
    },
    "river-crossing": {
      make: rcMake, grade: rcGrade, play: rcPlay, draw: rcDraw,
      step: function (R, A, dt) { rcStep(R, A, dt); },
      live: function (A) {
        return [A.self.x, A.self.y, A.ghost.x, A.ghost.y, A.sim];
      },
    },
    "beam-balance": {
      make: bbMake, grade: bbGrade, play: bbPlay, draw: bbDraw,
      step: function (R, A, dt) { bbStep(R, A, dt); },
      live: function (A) { return [A.phi, A.omega, A.yOff, A.vy, A.xNow]; },
    },
    "collision-2d-game": {
      make: c2Make, grade: c2Grade, play: c2Play, draw: c2Draw,
      step: function (R, A, dt) { c2Step(R, A, dt); },
      live: function (A) {
        return [A.p1.x, A.p1.y, A.p2.x, A.p2.y,
          A.self.x, A.self.y, A.ghost.x, A.ghost.y, A.sim];
      },
    },
    "angular-impulse": {
      make: aiMake, grade: aiGrade, play: aiPlay, draw: aiDraw,
      step: function (R, A, dt) { aiStep(R, A, dt); },
      live: function (A) {
        return [A.real.phi, A.real.w, A.ghost.phi, A.ghost.w, A.sim];
      },
    },
  };

  function entry(id) {
    for (let i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i];
    return null;
  }

  // Copied on the way out, not handed over. A host that sorts the givens or
  // annotates an input must not be able to reach back into the round that is
  // about to be graded.
  function view() {
    const R = state.round;
    if (!R) return null;
    return {
      id: R.game,
      prompt: R.prompt,
      note: R.note,
      givens: (R.givens || []).map(function (gv) {
        return { label: gv.label, value: gv.value, unit: gv.unit || "" };
      }),
      inputs: (R.inputs || []).map(function (i) {
        return i.choices
          ? {
            key: i.key, label: i.label,
            choices: i.choices.map(function (c) { return { value: c.value, label: c.label }; }),
          }
          : { key: i.key, label: i.label, unit: i.unit || "", step: i.step || "0.01" };
      }),
    };
  }

  function reset() {
    state.id = null;
    state.round = null;
    state.result = null;
    state.anim = null;
    state.marks = {};
  }

  function start(id, difficulty) {
    const meta = entry(id);
    if (!meta || !GAMES[id]) return null;
    reset();
    const tier = tierOf(id, difficulty);
    let made = null;
    // A generator that cannot find a round inside its attempt budget returns
    // null, and null is reported as null. Fail closed: a fabricated round with
    // the constraints relaxed would grade a reader against physics the card
    // never described.
    try { made = GAMES[id].make(tier); } catch (err) { made = null; }
    if (!made) return null;
    made.game = id;
    made.tier = tier;
    made.tierName = (LADDERS[id] || [])[tier] || "";
    state.id = id;
    state.round = made;
    return view();
  }

  function play() {
    const R = state.round, RES = state.result;
    if (!R || !RES || RES.blank) return false;
    const G = GAMES[R.game];
    if (!G) return false;
    // Marks are the harness's only window on where the bodies went, so they are
    // cleared with the animation rather than carried over from the last run.
    state.marks = {};
    try { state.anim = G.play(R, RES); } catch (err) { state.anim = null; }
    return !!state.anim;
  }

  function submit(answers) {
    const R = state.round;
    if (!R) return blankResult();
    // One empty or unreadable box makes the whole submission a blank, and a
    // blank is not a wrong answer: nothing is released and the round is still
    // the reader's.
    const f = readFields(R.inputs || [], answers);
    if (!f) { state.result = null; state.anim = null; return blankResult(); }
    const G = GAMES[R.game];
    let res = null;
    try { res = G ? G.grade(R, f) : null; } catch (err) { res = null; }
    if (!res) { state.result = null; state.anim = null; return blankResult(); }
    state.result = res;
    play();
    return res;
  }

  function tick(dt) {
    const R = state.round, A = state.anim;
    if (!R || !A || A.done) return false;
    const G = GAMES[R.game];
    if (!G) { state.anim = null; return false; }
    // A backgrounded tab hands back whole seconds; a step that long would put a
    // body through the far wall of every one of these scenes.
    const step = Math.min(Math.max(Number(dt) || 0, 0), MAX_DT);
    if (step > 0) {
      A.t += step;
      try { G.step(R, A, step); }
      catch (err) { A.done = true; return false; }
      // A NaN in one body's position paints nothing for ever and keeps the
      // frame loop alive doing it, so the run is stopped rather than left to
      // burn frames on a blank stage.
      let ok = Number.isFinite(A.t);
      if (ok && G.live) {
        const vals = G.live(A);
        for (let i = 0; i < vals.length; i++) {
          if (!Number.isFinite(vals[i])) { ok = false; break; }
        }
      }
      if (!ok) { A.done = true; return false; }
      if (A.t >= A.dur) A.done = true;
    }
    return !A.done;
  }

  function animating() { return !!state.anim && !state.anim.done; }

  function drawEmpty(ctx, w, h, P) {
    ctx.save();
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    ctx.restore();
    if (w > 300 && h > 160) lab(ctx, w / 2, h / 2, "Choose a bench.", P.inkSoft, 12);
  }

  function draw(ctx, w, h) {
    if (!ctx) return;
    const width = Number(w), height = Number(h);
    // 1x1 and 8x6 both happen, during layout and on a hidden tab. Neither is
    // worth painting and every helper below assumes room.
    if (!(width > 12 && height > 12)) return;
    const P = pal();
    if (!P) return;              // animate.js has not run yet; nothing to paint in
    ctx.save();
    try {
      const R = state.round;
      if (!R || !GAMES[R.game]) drawEmpty(ctx, width, height, P);
      else GAMES[R.game].draw(ctx, width, height, P, R, state.result, state.anim);
    } catch (err) {
      /* One bad frame must not take the loop, or the rest of the page, with it. */
    } finally {
      // A throw mid-path would otherwise leave a clip, an alpha or a transform
      // on the context for whatever paints next.
      ctx.restore();
    }
  }

  return {
    list: function () {
      return CATALOGUE.map(function (gm) {
        return { id: gm.id, name: gm.name, blurb: gm.blurb, group: gm.group };
      });
    },
    // The host passes the id, so the ladder is the one belonging to the bench
    // being asked about rather than a shared easy/medium/hard. It also rebuilds
    // its menu before the round exists, so an id it does not know falls back to
    // whatever was last started instead of emptying the menu.
    difficulties: function (id) {
      const key = LADDERS[id] ? id
        : (state.id && LADDERS[state.id] ? state.id : CATALOGUE[0].id);
      return LADDERS[key].slice();
    },
    start: start,
    round: view,
    submit: submit,
    play: play,
    tick: tick,
    animating: animating,
    draw: draw,
    reset: reset,

    // --- accessors, none of which leak an ungraded round --------------------
    phase: function () { return !state.round ? "idle" : state.result ? "graded" : "posed"; },
    result: function () { return state.result; },
    solution: function () { return state.result ? state.result.solution : null; },
    // Where each drawer last put its bodies. Nothing in the app reads this; the
    // verification harness does, because the preview pane cannot composite
    // frames and a teleport is invisible without it.
    marks: function () {
      const out = {};
      for (const k in state.marks) if (Object.prototype.hasOwnProperty.call(state.marks, k)) {
        out[k] = { x: state.marks[k].x, y: state.marks[k].y };
      }
      return out;
    },
  };
})();
