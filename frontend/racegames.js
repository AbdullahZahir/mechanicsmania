/* ============================================================================
   race games — four benches that answer back only after you have committed
   ----------------------------------------------------------------------------
   Each of these is a demonstration that a physics teacher does once a year and
   that a student remembers for the rest of their life, because the apparatus
   contradicts them in public. A hoop and a sphere released together do not
   arrive together. Two carts blown apart by one spring do not travel equal
   distances. A ball fired into a catcher does not carry its kinetic energy
   through the collision. A ball released from the top of the loop does not
   go round the loop.

   Every round is CONSTRUCTED backwards from the window its answer must land
   in, and every reveal is INTEGRATED FROM THE READER'S OWN NUMBER. Nothing in
   this file draws the truth and then paints an error bar on it: the stop goes
   where the reader said, the pointer sits where the reader said, the ball is
   released from the height the reader said, and the apparatus is then allowed
   to do the wrong thing by itself. A reader who is 20% low on the loop watches
   the ball peel off the rails 48 degrees before the top and fall through the
   middle. That picture is the whole product.

   Depends on animate.js for PALETTE and the drawing primitives, and on
   scenarios.js for the configured g. Load after both.
   ========================================================================== */

const RaceGames = (function () {
  "use strict";

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  // A backgrounded tab hands back whole seconds at once. Unclamped, the loop
  // ball would be through the departure point and back on the floor before the
  // first drawn frame, which is exactly the frame the game exists to show.
  const MAX_DT = 0.05;
  // Every integrator below advances in fixed slices of this, independent of the
  // frame rate, so a 20 fps machine and a 120 fps machine trace the same path.
  const SUB = 0.004;

  /* g travels from the backend through scenarios.js, which may parse AFTER this
     file. `typeof` on a `let` that has not been evaluated yet THROWS rather
     than returning "undefined", so the read is wrapped: a script-tag order
     change must not take the module down and leave RaceGames undefined. */
  function G() {
    try {
      if (typeof GRAVITY === "number" && Number.isFinite(GRAVITY) && GRAVITY > 0) return GRAVITY;
    } catch (err) { /* scenarios.js has not run yet */ }
    return 9.8;
  }

  function PAL() {
    try {
      if (typeof PALETTE !== "undefined" && PALETTE && PALETTE.ink) return PALETTE;
    } catch (err) { /* animate.js has not run yet */ }
    return null;
  }

  /* --- numeric odds and ends ------------------------------------------------
     Readers type into text fields, so every answer arrives as a string, and on
     a comma-decimal keyboard it arrives as "0,40". Anything that is not a
     finite number is reported as a blank field and never graded as wrong. */
  function rgNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    if (typeof v !== "string") return NaN;
    const s = v.trim().replace(",", ".");
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  // Every given is passed through this before it is stored, so the number the
  // reader is shown and the number the answer was computed from are the same
  // number -- otherwise 0.1*3 leaves the printed given and the grade quietly
  // disagreeing in the fourth decimal place.
  function rgR(v, dp) { const f = Math.pow(10, dp); return Math.round(v * f) / f; }
  function rgClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rgPick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function rgGrid(lo, hi, step) {
    const out = [];
    const n = Math.round((hi - lo) / step);
    for (let i = 0; i <= n; i++) out.push(rgR(lo + i * step, 6));
    return out;
  }
  function rgShuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = b[i]; b[i] = b[j]; b[j] = t;
    }
    return b;
  }
  function rgNear(a, b, tol) {
    return Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(tol) && Math.abs(a - b) <= tol;
  }
  function rgOrd(n) {
    return n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : n === 4 ? "fourth" : n + "th";
  }
  function rgCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function rgFin(v) { return typeof v === "number" && Number.isFinite(v); }

  /* --- the catalogue -------------------------------------------------------- */

  const CATALOGUE = [
    {
      id: "rolling-race",
      name: "Rolling race",
      group: "Rotation",
      blurb: "A hoop, a disc, a sphere and a frictionless slider are let go together at the top of a ramp.",
      tiers: ["Pick the winner", "Arrival time", "Finishing gap"],
    },
    {
      id: "explosion",
      name: "The explosion",
      group: "Momentum",
      blurb: "One compressed spring, two carts, a burnt thread. Place the second bumper so both clack at once.",
      tiers: ["Two to one", "Awkward ratio", "Time it too"],
    },
    {
      id: "ballistic-pendulum",
      name: "Ballistic pendulum",
      group: "Momentum",
      blurb: "A ball is fired into a hanging catcher and a ratchet pointer records how high it swings.",
      tiers: ["Find the speed", "Find the angle", "Energy lost too"],
    },
    {
      id: "loop-coaster-game",
      name: "Loop the loop",
      group: "Energy & circular motion",
      blurb: "Find the lowest release height from which the ball stays on the rails all the way round.",
      tiers: ["Sliding bead", "Rolling sphere", "With friction"],
    },
  ];

  let cur = null;      // the generated round, carrying its own exact answer
  let result = null;   // the last grading
  let anim = null;     // post-submit animation state, or null

  /* ==========================================================================
     GAME 1 — Rolling race
     --------------------------------------------------------------------------
     Everything about a body rolling down a ramp is carried by one dimensionless
     number, k = I/mR². The mass cancels, the radius cancels, and what is left is

          a = g sinθ / (1 + k)

     which is why the four bodies below are drawn with four different masses and
     four different radii that are never once used. They are on the plate because
     a real bench would have measured them, and because "the heavy one wins" is a
     belief that has to be held, tested and lost rather than merely denied.
     ======================================================================== */

  const RR_BODIES = {
    hoop:   { key: "hoop",   name: "hoop",              k: 1.0, inertia: "I = mR²",  col: "crimson" },
    disc:   { key: "disc",   name: "solid disc",        k: 0.5, inertia: "I = ½mR²", col: "brass"   },
    sphere: { key: "sphere", name: "solid sphere",      k: 0.4, inertia: "I = ⅖mR²", col: "forest"  },
    slider: { key: "slider", name: "frictionless slider", k: 0, inertia: "does not rotate", col: "navy" },
  };
  const RR_ORDER = ["hoop", "disc", "sphere", "slider"];   // slowest first, always

  function rrAccel(th, k) { return (G() * Math.sin(th)) / (1 + k); }
  function rrTime(L, th, k) { return Math.sqrt((2 * L) / rrAccel(th, k)); }
  function rrVfin(L, th, k) { return Math.sqrt((2 * G() * L * Math.sin(th)) / (1 + k)); }

  /* Line-ups are drawn from a fixed list rather than sampled, because a race
     needs at least three bodies to be a race and the winner must not always be
     the same object -- a reader who learns "the flat one always wins" has
     learned the answer instead of the reason. */
  const RR_LINEUPS = [
    ["hoop", "disc", "sphere", "slider"],
    ["hoop", "disc", "sphere", "slider"],
    ["hoop", "disc", "sphere"],
    ["hoop", "disc", "slider"],
    ["hoop", "sphere", "slider"],
    ["disc", "sphere", "slider"],
    ["hoop", "disc", "sphere"],
  ];

  /* Hands out the red herrings. The heaviest body and the widest body are both
     placed on losers, and on DIFFERENT losers, so that "the heaviest wins" and
     "the biggest wins" are two separately falsifiable guesses rather than one.
     If either landed on the winner the trap would reward itself. */
  function rrSpecs(lineup, winnerKey) {
    const losers = lineup.filter((key) => key !== winnerKey);
    const massGrid = rgShuffle(rgGrid(0.20, 1.20, 0.05)).slice(0, lineup.length).sort((a, b) => a - b);
    const radGrid = rgShuffle(rgGrid(0.030, 0.095, 0.005)).slice(0, lineup.length).sort((a, b) => a - b);
    const heavy = rgPick(losers);
    // A two-lane head-to-head has only one loser to hang both extremes on. That
    // tier has no "which one wins" choice, so the two traps have nothing to be
    // separable for and the pair may share a body.
    const others = losers.filter((key) => key !== heavy);
    const wide = others.length ? rgPick(others) : heavy;
    const rest = rgShuffle(lineup.filter((key) => key !== heavy));
    const restW = rgShuffle(lineup.filter((key) => key !== wide));

    const spec = {};
    lineup.forEach((key) => { spec[key] = { m: 0, r: 0 }; });
    spec[heavy].m = massGrid[massGrid.length - 1];
    rest.forEach((key, i) => { spec[key].m = massGrid[i]; });
    spec[wide].r = radGrid[radGrid.length - 1];
    restW.forEach((key, i) => { spec[key].r = radGrid[i]; });

    return { spec, heavy, wide };
  }

  function rrBodyGivens(lineup, spec) {
    return lineup.map((key) => ({
      label: rgCap(RR_BODIES[key].name),
      value: spec[key].m.toFixed(2) + " kg,  R = " + spec[key].r.toFixed(3) + " m",
      unit: "",
    }));
  }

  function rrMake(tier) {
    if (tier === 1) return rrMakeTime();
    if (tier === 2) return rrMakeGap();
    return rrMakePick();
  }

  /* --- tier 1: pick the winner --------------------------------------------- */
  function rrMakePick() {
    const lineup = rgPick(RR_LINEUPS).slice();
    // The winner is the smallest k in the line-up, always, and that is the only
    // fact in the whole game. It is computed rather than assumed so that adding
    // a line-up above cannot silently break the grading.
    const winner = lineup.reduce((best, key) =>
      RR_BODIES[key].k < RR_BODIES[best].k ? key : best, lineup[0]);
    const { spec, heavy, wide } = rrSpecs(lineup, winner);

    const thDeg = rgPick(rgGrid(12, 25, 1));
    const th = thDeg * RAD;
    const L = rgPick(rgGrid(1.0, 2.0, 0.05));

    const order = lineup.slice().sort((a, b) => RR_BODIES[a].k - RR_BODIES[b].k);
    const times = {};
    lineup.forEach((key) => { times[key] = rrTime(L, th, RR_BODIES[key].k); });

    return {
      kind: "pick", lineup, spec, heavy, wide, winner, order, times,
      thDeg, th, L,
      givens: [
        { label: "Ramp angle, θ", value: thDeg.toFixed(0) + "°", unit: "" },
        { label: "Ramp length, L", value: L.toFixed(2) + " m", unit: "" },
      ].concat(rrBodyGivens(lineup, spec))
       .concat([{ label: "g", value: G().toFixed(2) + " m/s²", unit: "" }]),
      inputs: [{
        key: "winner",
        label: "First to the bottom",
        choices: lineup.map((key) => ({ value: key, label: rgCap(RR_BODIES[key].name) })),
      }],
      prompt: "All " + (lineup.length === 4 ? "four" : "three")
        + " bodies are held at the top of the same ramp and released at the same instant. Each rolls without slipping"
        + (lineup.indexOf("slider") >= 0 ? "; the slider rides on an air cushion and does not rotate at all" : "")
        + ". Which one reaches the bottom first?",
      note: "They start from rest, they share the ramp, and nothing slips. Commit before you look.",
    };
  }

  /* --- tier 2: arrival time -------------------------------------------------
     Enumerated, not sampled. Every (θ, L) cell on the grid whose arrival time
     lands inside the window is collected and one is drawn from the list, so the
     round cannot be unsolvable and cannot land on 0.31 s or 4.8 s. */
  function rrMakeTime() {
    const bodyKey = rgPick(["hoop", "disc", "sphere"]);   // never the slider: see below
    const k = RR_BODIES[bodyKey].k;
    const cells = [];
    rgGrid(12, 25, 1).forEach((thDeg) => {
      rgGrid(1.0, 2.0, 0.05).forEach((L) => {
        const t = rrTime(L, thDeg * RAD, k);
        if (t >= 0.62 && t <= 1.38) cells.push([thDeg, L]);
      });
    });
    // Fail closed rather than hand back a round with no answer window.
    const cell = cells.length ? rgPick(cells) : [25, 1.2];
    const thDeg = cell[0], L = cell[1], th = thDeg * RAD;

    const lineup = RR_ORDER.slice();       // the slider races too, on purpose
    const { spec, heavy, wide } = rrSpecs(lineup, "slider");
    const times = {};
    lineup.forEach((key) => { times[key] = rrTime(L, th, RR_BODIES[key].k); });
    const t = times[bodyKey];

    return {
      kind: "time", lineup, spec, heavy, wide, winner: "slider",
      order: lineup.slice().sort((a, b) => RR_BODIES[a].k - RR_BODIES[b].k),
      times, bodyKey, k, thDeg, th, L, t,
      a: rrAccel(th, k), v: rrVfin(L, th, k),
      tol: Math.max(0.02, t * 0.02),
      givens: [
        { label: "Ramp angle, θ", value: thDeg.toFixed(0) + "°", unit: "" },
        { label: "Ramp length, L", value: L.toFixed(2) + " m", unit: "" },
      ].concat(rrBodyGivens(lineup, spec))
       .concat([{ label: "g", value: G().toFixed(2) + " m/s²", unit: "" }]),
      inputs: [{ key: "time", label: "Time for the " + RR_BODIES[bodyKey].name + " to reach the bottom", unit: "s", step: "0.001" }],
      prompt: "All four are released together from rest at the top. How long does the "
        + RR_BODIES[bodyKey].name + " take to reach the bottom of the ramp?",
      note: "The slider is in the race so that you have something to check yourself against: it carries no rotation at all.",
    };
  }

  /* --- tier 3: finishing gap ------------------------------------------------
     gap = L(1 − (1+k₁)/(1+k₂)). No g, no θ, no time -- which is why the ramp
     angle stays on the plate: it is the one given that provably cannot enter
     the answer, and noticing that is most of the insight. */
  function rrGap(L, k1, k2) { return L * (1 - (1 + k1) / (1 + k2)); }

  function rrMakeGap() {
    const pairs = [];
    for (let i = 0; i < RR_ORDER.length; i++) {
      for (let j = 0; j < RR_ORDER.length; j++) {
        const a = RR_ORDER[j], b = RR_ORDER[i];          // a = faster (smaller k)
        if (RR_BODIES[a].k >= RR_BODIES[b].k) continue;
        const cells = rgGrid(0.50, 2.00, 0.05).filter((L) => {
          const cm = rrGap(L, RR_BODIES[a].k, RR_BODIES[b].k) * 100;
          return cm >= 5 && cm <= 25;
        });
        if (cells.length >= 3) pairs.push({ first: a, second: b, cells });
      }
    }
    const pick = pairs.length ? rgPick(pairs) : { first: "sphere", second: "disc", cells: [1.5] };
    const L = rgPick(pick.cells);
    const k1 = RR_BODIES[pick.first].k, k2 = RR_BODIES[pick.second].k;
    const gapM = rrGap(L, k1, k2);
    const gapCm = gapM * 100;

    const thDeg = rgPick(rgGrid(12, 25, 1));
    const th = thDeg * RAD;
    const lineup = [pick.second, pick.first].sort((a, b) => RR_ORDER.indexOf(a) - RR_ORDER.indexOf(b));
    const { spec, heavy, wide } = rrSpecs(lineup, pick.first);
    const times = {};
    lineup.forEach((key) => { times[key] = rrTime(L, th, RR_BODIES[key].k); });

    return {
      kind: "gap", lineup, spec, heavy, wide, winner: pick.first,
      order: [pick.first, pick.second],
      times, first: pick.first, second: pick.second, k1, k2,
      thDeg, th, L, gapM, gapCm,
      tol: Math.max(0.25, gapCm * 0.025),
      givens: [
        { label: "Ramp angle, θ", value: thDeg.toFixed(0) + "°", unit: "" },
        { label: "Ramp length, L", value: L.toFixed(2) + " m", unit: "" },
      ].concat(rrBodyGivens(lineup, spec))
       .concat([{ label: "g", value: G().toFixed(2) + " m/s²", unit: "" }]),
      inputs: [{ key: "gap", label: "Distance the " + RR_BODIES[pick.second].name + " still has to run", unit: "cm", step: "0.1" }],
      prompt: "The " + RR_BODIES[pick.first].name + " and the " + RR_BODIES[pick.second].name
        + " are released together from the top. At the instant the " + RR_BODIES[pick.first].name
        + " crosses the finish line, how far short of the line is the " + RR_BODIES[pick.second].name + "?",
      note: "Both have run for the same length of time when the first one crosses. Answer in centimetres.",
    };
  }

  /* --- rolling race: grading ------------------------------------------------ */

  function rrSolutionHead(r) {
    return [
      "Rolling without slipping:  v = ωR, so KE = ½mv² + ½Iω² = ½mv²(1 + k)  with k = I/mR²",
      "Energy from the top:       mgL sinθ = ½mv²(1 + k)   →   the m divides straight out",
      "Acceleration:              a = g sinθ / (1 + k)     →   the R never appears at all",
      "So the masses and radii on the plate decide nothing. Only k does.",
    ];
  }

  function rrGrade(r, answers) {
    if (r.kind === "pick") return rrGradePick(r, answers);
    if (r.kind === "time") return rrGradeTime(r, answers);
    return rrGradeGap(r, answers);
  }

  function rrGradePick(r, answers) {
    const pickKey = String((answers && answers.winner) != null ? answers.winner : "").trim();
    if (!pickKey || r.lineup.indexOf(pickKey) < 0) return null;   // null => blank

    const correct = pickKey === r.winner;
    const place = r.order.indexOf(pickKey) + 1;
    const B = RR_BODIES;
    const lines = rrSolutionHead(r).concat([
      "Smallest k wins, every time, from every height, on every ramp:",
    ]).concat(r.order.map((key, i) =>
      "  " + rgOrd(i + 1) + ":  " + rgCap(B[key].name) + "   k = " + B[key].k.toFixed(1)
      + "   (" + B[key].inertia + ")   a = " + rrAccel(r.th, B[key].k).toFixed(3)
      + " m/s²   t = " + r.times[key].toFixed(3) + " s"));

    let mis = null;
    if (!correct) {
      if (pickKey === r.heavy) {
        mis = {
          id: "heaviest-wins",
          label: "You picked the heaviest one",
          detail: "The " + B[pickKey].name + " is the heaviest body on the plate at "
            + r.spec[pickKey].m.toFixed(2) + " kg, and that is the only reason to pick it. "
            + "Write mgL sinθ = ½mv²(1+k) and the m is on both sides: it divides out before you ever reach a number. "
            + "Doubling every mass on the ramp changes nothing about who arrives when.",
        };
      } else if (pickKey === r.wide) {
        mis = {
          id: "biggest-radius-wins",
          label: "You picked the widest one",
          detail: "The " + B[pickKey].name + " has the largest radius at " + r.spec[pickKey].r.toFixed(3)
            + " m. But I enters the energy only as I/mR², and for every one of these shapes that ratio is a pure "
            + "number — 1, ½, ⅖ — with the R already divided away. A bicycle wheel and a coin of the same shape tie.",
        };
      } else if (r.winner === "slider" && pickKey === "sphere") {
        mis = {
          id: "rolling-beats-sliding",
          label: "Rolling is not an advantage",
          detail: "The slider is not cheating and it is not being helped: it simply has nowhere to put energy except "
            + "into going forwards. Every rolling body has to spend some of the same mgL sinθ on spinning itself up, "
            + "and whatever it spends there it does not have as speed. k = 0 beats k = 0.4 for exactly that reason.",
        };
      }
    }

    const verdict = correct
      ? { kind: "hit", text: "Called it — the " + B[r.winner].name + " wins" }
      : { kind: "miss", text: "The " + B[pickKey].name + " came " + rgOrd(place)
            + " of " + r.lineup.length };

    const feedback = correct
      ? "The " + B[r.winner].name + " crosses first at " + r.times[r.winner].toFixed(3)
        + " s, ahead of the " + B[r.order[1]].name + " by "
        + (r.times[r.order[1]] - r.times[r.winner]).toFixed(3) + " s. Smallest k, largest a."
      : "The " + B[pickKey].name + " finished " + rgOrd(place) + " at " + r.times[pickKey].toFixed(3)
        + " s; the " + B[r.winner].name + " was already across at " + r.times[r.winner].toFixed(3)
        + " s. The winner is whichever body has the smallest k = I/mR².";

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : mis,
      solution: lines,
      exact: { winner: r.winner, times: r.times },
      tolerance: {},
      pickKey, place,
    };
  }

  function rrGradeTime(r, answers) {
    const g = rgNum(answers && answers.time);
    if (!rgFin(g)) return null;
    const d = g - r.t;
    const correct = Math.abs(d) <= r.tol;
    const B = RR_BODIES;

    // What the ramp actually does at the instant the reader's watch stops.
    const sAt = rgClamp(0.5 * r.a * Math.max(g, 0) * Math.max(g, 0), 0, r.L);
    const shortBy = r.L - sAt;

    const lines = rrSolutionHead(r).concat([
      "k for the " + B[r.bodyKey].name + " = " + r.k.toFixed(1) + "   (" + B[r.bodyKey].inertia + ")",
      "a = g sinθ/(1+k) = " + G().toFixed(2) + "·sin " + r.thDeg.toFixed(0) + "°/(1+" + r.k.toFixed(1)
        + ") = " + r.a.toFixed(4) + " m/s²",
      "L = ½at²  →  t = √(2L/a) = √(2·" + r.L.toFixed(2) + "/" + r.a.toFixed(4) + ") = " + r.t.toFixed(4) + " s",
      "v at the line = √(2gL sinθ/(1+k)) = " + r.v.toFixed(4) + " m/s",
      "The slider, on the same ramp, arrives at " + r.times.slider.toFixed(4) + " s — that is what "
        + "a = g sinθ on its own predicts, and it is a different body.",
    ]);

    let mis = null;
    if (!correct) {
      const tight = Math.max(0.012, r.t * 0.012);
      const tSlider = r.times.slider;
      if (Math.abs(tSlider - r.t) > r.tol && rgNear(g, tSlider, tight)) {
        mis = {
          id: "no-rotational-inertia",
          label: "You left the rotation out",
          detail: "That is √(2L/(g sinθ)) — the answer for a body with no moment of inertia at all. It is the "
            + "slider's time, " + tSlider.toFixed(3) + " s, and the slider is right there in the race arriving "
            + (r.t - tSlider).toFixed(3) + " s before your " + B[r.bodyKey].name + ". A rolling body has to "
            + "spend energy on ½Iω², so it reaches the line slower: divide a by (1+k).",
        };
      } else {
        RR_ORDER.forEach((key) => {
          if (mis || key === r.bodyKey || key === "slider") return;
          const cand = r.times[key];
          if (Math.abs(cand - r.t) <= r.tol) return;             // not separable; say nothing
          if (!rgNear(g, cand, tight)) return;
          if (r.bodyKey === "sphere" && key === "hoop") {
            mis = {
              id: "sphere-as-hoop",
              label: "You used I = mR² for a sphere",
              detail: "I = mR² is a hoop: all of the mass out at the rim. A solid sphere has its mass spread "
                + "through the whole volume, most of it close to the axis, so I = ⅖mR² and k = 0.4, not 1. "
                + "Your number, " + cand.toFixed(3) + " s, is the hoop's time.",
            };
          } else {
            mis = {
              id: "wrong-inertia-factor",
              label: "That is the " + B[key].name + "'s k, not the " + B[r.bodyKey].name + "'s",
              detail: "You used k = " + B[key].k.toFixed(1) + " (" + B[key].inertia + "). The "
                + B[r.bodyKey].name + " has " + B[r.bodyKey].inertia + ", so k = " + r.k.toFixed(1)
                + ". Everything else in your working is right; only the shape factor is off.",
            };
          }
        });
      }
    }

    const verdict = correct
      ? { kind: "hit", text: "Stopwatch matched" }
      : d > 0
        ? { kind: "over", text: "Late by " + Math.abs(d).toFixed(2) + " s — already across" }
        : { kind: "under", text: "Early by " + Math.abs(d).toFixed(2) + " s, still "
              + (shortBy * 100).toFixed(0) + " cm short" };

    const feedback = correct
      ? "The " + B[r.bodyKey].name + " crosses at " + r.t.toFixed(3) + " s and your watch stopped with it."
      : d > 0
        ? "At " + g.toFixed(3) + " s the " + B[r.bodyKey].name + " had already been across for "
          + Math.abs(d).toFixed(3) + " s. Exact time " + r.t.toFixed(3) + " s."
        : "At " + g.toFixed(3) + " s the " + B[r.bodyKey].name + " was still " + shortBy.toFixed(3)
          + " m up the ramp. Exact time " + r.t.toFixed(3) + " s.";

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : mis,
      solution: lines,
      exact: { time: r.t, a: r.a, v: r.v, sliderTime: r.times.slider },
      tolerance: { time: r.tol },
      guessT: g, ghostS: sAt,
    };
  }

  function rrGradeGap(r, answers) {
    const g = rgNum(answers && answers.gap);
    if (!rgFin(g)) return null;
    const d = g - r.gapCm;
    const correct = Math.abs(d) <= r.tol;
    const B = RR_BODIES;
    const ratio = (1 + r.k1) / (1 + r.k2);
    const tWin = r.times[r.first];

    const lines = rrSolutionHead(r).concat([
      "Both have run for the same time t₁ when the first one crosses, so compare DISTANCES, not times.",
      "t₁ = √(2L(1+k₁)/(g sinθ))   and   s₂ = ½a₂t₁² = L(1+k₁)/(1+k₂)",
      "gap = L − s₂ = L(1 − (1+k₁)/(1+k₂))",
      "     = " + r.L.toFixed(2) + "·(1 − (1+" + r.k1.toFixed(1) + ")/(1+" + r.k2.toFixed(1) + "))"
        + " = " + r.L.toFixed(2) + "·(1 − " + ratio.toFixed(4) + ") = " + r.gapM.toFixed(4)
        + " m = " + r.gapCm.toFixed(2) + " cm",
      "Notice what is not in that line: no g, no θ, no mass, no radius. Tilt the ramp steeper and both "
        + "bodies arrive sooner, but the gap between them at the line does not move.",
      "(For the record: t₁ = " + tWin.toFixed(3) + " s, t₂ = " + r.times[r.second].toFixed(3) + " s.)",
    ]);

    let mis = null;
    if (!correct) {
      const tight = Math.max(0.2, r.gapCm * 0.02);
      const asMetres = g * 100;                                // they typed 0.12 for 12 cm
      const timeRatio = r.L * (1 - Math.sqrt(ratio)) * 100;    // compared t₁/t₂ instead of distances
      if (g > 0.015 && g < 0.6 && rgNear(asMetres, r.gapCm, Math.max(0.3, r.gapCm * 0.02))) {
        mis = {
          id: "unit-slip",
          label: "That is the gap in metres",
          detail: "Your number is right; the box asks for centimetres. " + g.toFixed(4) + " m is "
            + (g * 100).toFixed(2) + " cm. Nothing wrong with the physics.",
        };
      } else if (Math.abs(g) <= 0.015) {
        mis = {
          id: "dead-heat",
          label: "They do not arrive together",
          detail: "A gap of zero is what a = g sinθ predicts for every body on the ramp, which is the answer "
            + "for a frictionless slider and nothing else. The " + B[r.first].name + " has k = " + r.k1.toFixed(1)
            + " and the " + B[r.second].name + " has k = " + r.k2.toFixed(1) + ", so their accelerations differ "
            + "by a factor of " + ((1 + r.k2) / (1 + r.k1)).toFixed(3) + " and they cannot tie.",
        };
      } else if (Math.abs(timeRatio - r.gapCm) > r.tol * 3 && rgNear(g, timeRatio, tight)) {
        mis = {
          id: "time-ratio-not-distance",
          label: "You compared the times, not the distances",
          detail: "L(1 − t₁/t₂) is what you have, and t₁/t₂ = √((1+k₁)/(1+k₂)) because time goes as the square "
            + "root. The gap is a distance at a fixed instant: both bodies have been accelerating for the same t₁, "
            + "so s₂/L = a₂/a₁ = (1+k₁)/(1+k₂), with no square root in it.",
        };
      }
    }

    const verdict = correct
      ? { kind: "hit", text: "Caliper agrees" }
      : d > 0
        ? { kind: "over", text: "Gap too wide by " + Math.abs(d).toFixed(1) + " cm" }
        : { kind: "under", text: "Gap too narrow by " + Math.abs(d).toFixed(1) + " cm" };

    const feedback = correct
      ? "The " + B[r.second].name + " is " + r.gapCm.toFixed(1) + " cm short when the "
        + B[r.first].name + " crosses, and your mark is on it."
      : "Your mark sits " + Math.abs(d).toFixed(1) + " cm "
        + (d > 0 ? "further back than" : "ahead of") + " the " + B[r.second].name
        + ", which is " + r.gapCm.toFixed(2) + " cm short of the line at that instant.";

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : mis,
      solution: lines,
      exact: { gapCm: r.gapCm, gapM: r.gapM, tFirst: tWin, tSecond: r.times[r.second] },
      tolerance: { gapCm: r.tol },
      guessGapCm: g,
    };
  }

  /* --- rolling race: animation and drawing ---------------------------------- */

  // Wall clock runs the race at this fraction of real time. A 1 s race across
  // two thirds of the stage moves a body a tenth of the picture in a single
  // 20 fps frame; slowed, nothing ever jumps far enough to read as a teleport,
  // and the stopwatch still shows honest seconds.
  const RR_RATE = 0.45;

  function rrAnim(r, res) {
    const last = r.lineup.reduce((mx, key) => Math.max(mx, r.times[key]), 0);
    const freeze = r.kind === "gap" ? r.times[r.first] : Infinity;
    return {
      game: "rolling-race", t: 0, done: false,
      last, freeze, hold: 0,
      // The race stops being a race once the last body is down; what follows is
      // the measurement, which is the part worth holding still for.
      span: (r.kind === "gap" ? freeze : last) + 0.001,
      ghostAt: r.kind === "time" && res && rgFin(res.guessT) ? Math.max(res.guessT, 0) : Infinity,
      ghostShown: false,
    };
  }

  function rrStep(a, r, dt) {
    if (a.t < a.span) {
      a.t = Math.min(a.span, a.t + dt * RR_RATE);
      if (a.t >= a.ghostAt) a.ghostShown = true;
      return true;
    }
    a.hold += dt;
    if (a.hold > 3.2) { a.done = true; return false; }
    return true;
  }

  function rrPos(r, key, t) {
    const k = RR_BODIES[key].k;
    const s = 0.5 * rrAccel(r.th, k) * t * t;
    return rgClamp(s, 0, r.L);
  }

  function rrDrawBody(ctx, x, y, rad, phi, key, col, P) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = col;
    if (key === "slider") {
      // A block on an air cushion: no wheels, no spoke, nothing that turns.
      ctx.fillStyle = P.panel;
      ctx.beginPath();
      ctx.rect(-rad * 1.25, -rad * 0.85, rad * 2.5, rad * 1.7);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(i * rad * 0.7, rad * 0.85 + 1.5);
        ctx.lineTo(i * rad * 0.7, rad * 0.85 + 4);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.rotate(phi);
    ctx.fillStyle = P.panel;
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2);
    if (key !== "hoop") ctx.fill();
    ctx.stroke();
    if (key === "hoop") {
      // Drawn as a rim with a visible thickness, because "all the mass at the
      // radius" is the whole reason it loses.
      ctx.lineWidth = Math.max(2.2, rad * 0.30);
      ctx.beginPath(); ctx.arc(0, 0, rad * 0.86, 0, Math.PI * 2); ctx.stroke();
    } else if (key === "sphere") {
      ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(-rad * 0.3, -rad * 0.3, rad * 0.26, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // One spoke, so the coupling φ = s/r is visible rather than asserted.
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(rad * 0.92, 0); ctx.stroke();
    ctx.restore();
  }

  function rrDraw(ctx, w, h, r, res, a, P) {
    const n = r.lineup.length;
    const th = r.th;
    const gap = n > 1 ? Math.min(26, (h * 0.28) / (n - 1)) : 0;
    const yTop = h * 0.15;
    const availV = Math.max(20, h * 0.80 - gap * (n - 1) - yTop);
    const availH = Math.max(30, w * 0.70);
    const Lpx = Math.max(30, Math.min(availH / Math.cos(th), availV / Math.max(Math.sin(th), 0.05)));
    const x0 = w * 0.13;
    const dx = Math.cos(th), dy = Math.sin(th);
    const px = Math.sin(th), py = -Math.cos(th);       // uphill-perpendicular
    const rad = rgClamp(gap * 0.40, 3.5, 13);
    const showText = w > 430 && h > 250;
    const t = a ? a.t : 0;
    const frozen = r.kind === "gap" && a && a.t >= a.freeze;

    for (let i = 0; i < n; i++) {
      const key = r.lineup[i];
      const oy = yTop + i * gap;
      const ax = x0, ay = oy;
      const bx = x0 + Lpx * dx, by = oy + Lpx * dy;
      ctx.save();
      ctx.strokeStyle = P.rule;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.restore();
      if (showText) {
        drawLabel(ctx, ax - 8, ay - 4, rgCap(RR_BODIES[key].name), P[RR_BODIES[key].col], 10.5, "right");
      }
    }

    // start gate and finish line, spanning every lane
    const fx0 = x0 + Lpx * dx, fy0 = yTop + Lpx * dy;
    if (typeof drawDashedLine === "function") {
      drawDashedLine(ctx, x0, yTop - 16, x0, yTop + gap * (n - 1) + 10, P.inkSoft, 1.2, [3, 4]);
      drawDashedLine(ctx, fx0, fy0 - 16, fx0, fy0 + gap * (n - 1) + 10, P.crimson, 1.6, [5, 4]);
    }
    if (showText) drawLabel(ctx, fx0, fy0 + gap * (n - 1) + 22, "finish", P.crimson, 10.5, "center");

    // the reader's mark, drawn before the bodies so a body can cover it
    if (r.kind === "gap" && res && rgFin(res.guessGapCm) && Lpx > 40) {
      const sMark = rgClamp(r.L - res.guessGapCm / 100, 0, r.L);
      const f = sMark / r.L;
      const mx = x0 + Lpx * f * dx;
      const laneY = yTop + Lpx * f * dy + gap * r.lineup.indexOf(r.second);
      if (typeof drawDashedLine === "function") {
        drawDashedLine(ctx, mx, laneY - 22, mx, laneY + 10, P.brass, 1.6, [3, 3]);
      }
      if (showText) drawLabel(ctx, mx, laneY - 29, "your mark", P.brass, 10);
    }

    for (let i = 0; i < n; i++) {
      const key = r.lineup[i];
      const oy = yTop + i * gap;
      const tt = frozen ? a.freeze : t;
      const s = rrPos(r, key, tt);
      const f = s / r.L;
      const cxp = x0 + Lpx * f * dx + px * rad;
      const cyp = oy + Lpx * f * dy + py * rad;
      const phi = (Lpx * f) / Math.max(rad, 1);
      rrDrawBody(ctx, cxp, cyp, rad, phi, key, P[RR_BODIES[key].col], P);
    }

    // the ghost: where the named body stood when the reader's watch stopped
    if (r.kind === "time" && res && rgFin(res.guessT) && a && a.ghostShown && Lpx > 40) {
      const f = rgClamp(res.ghostS / r.L, 0, 1);
      const gx = x0 + Lpx * f * dx + px * rad;
      const gy = yTop + Lpx * f * dy + gap * r.lineup.indexOf(r.bodyKey) + py * rad;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = P.brass;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(gx, gy, rad + 2.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      if (showText) drawLabel(ctx, gx, gy - rad - 12, "your " + res.guessT.toFixed(2) + " s", P.brass, 10);
    }

    // the caliper, at the instant the first body crosses
    if (frozen && res && showText) {
      const f = rgClamp(rrPos(r, r.second, a.freeze) / r.L, 0, 1);
      const sx = x0 + Lpx * f * dx;
      const sy = yTop + Lpx * f * dy + gap * r.lineup.indexOf(r.second);
      const ey = fy0 + gap * r.lineup.indexOf(r.second);
      if (Math.abs(fx0 - sx) > 6 && typeof drawArrow === "function") {
        drawArrow(ctx, sx, sy + 20, fx0, ey + 20, P.forest, 1.6);
        drawArrow(ctx, fx0, ey + 20, sx, sy + 20, P.forest, 1.6);
        drawLabel(ctx, (sx + fx0) / 2, sy + 34, r.gapCm.toFixed(1) + " cm", P.forest, 11);
      }
    }

    if (showText && typeof drawDataPlate === "function") {
      const rows = ["θ  " + r.thDeg.toFixed(0) + "°     L  " + r.L.toFixed(2) + " m"];
      if (r.kind === "time") {
        rows.push("clock  " + (frozen ? r.times[r.first] : t).toFixed(3) + " s");
        rows.push(RR_BODIES[r.bodyKey].name + "  " + (res ? r.t.toFixed(3) + " s" : "— work it out"));
        rows.push("slider  " + (res ? r.times.slider.toFixed(3) + " s" : "— work it out"));
      } else if (r.kind === "gap") {
        rows.push("clock  " + t.toFixed(3) + " s");
        rows.push("gap at t₁  " + (res ? r.gapCm.toFixed(2) + " cm" : "— work it out"));
      } else {
        rows.push("clock  " + t.toFixed(3) + " s");
        // The finishing ORDER is the answer on this rung, so the plate cannot
        // show it until the reader has committed to one.
        if (!res) rows.push("finishing order  " + "— work it out");
        else r.order.forEach((key, i) => {
          if (i < 3) rows.push(rgOrd(i + 1) + "  " + RR_BODIES[key].name + "  " + r.times[key].toFixed(3) + " s");
        });
      }
      drawDataPlate(ctx, w - 196, 10, 184, rows);
    }
    if (showText && typeof sideNameplate === "function") {
      sideNameplate(ctx, 12, h - 34, "Bench", "Rolling race", P.crimson);
    }
  }

  /* ==========================================================================
     GAME 2 — The explosion
     --------------------------------------------------------------------------
     Two carts, one spring, a burnt thread. The track pushes nothing sideways,
     so the total momentum was zero before the thread burnt and is zero after:

          m₁v₁ = m₂v₂        and therefore        d₂ = d₁ · m₁/m₂

     because both carts travel for the same length of time if they are to clack
     together. The spring's k and its compression are on the plate from the
     first round onwards and are needed by nobody until the third, where they
     become the only route to the clock time. That is the point of leaving them
     there: a given that is useless twice and load-bearing once teaches "check
     what the question needs" better than a paragraph about it.

     Cart 1 -- the one whose stop is already clamped -- is always the LIGHTER of
     the pair. That is a construction choice, not an accident: it makes the
     equal-energy mistake always place the second stop too far out, so the
     failure has one direction and one sound, every single time.
     ======================================================================== */

  // Momentum: p = √(2E·m₁m₂/(m₁+m₂)), so v₁ = p/m₁. Written once; every speed,
  // time and animation in this game reads it from here so they cannot disagree.
  function exSpeeds(E, m1, m2) {
    const p = Math.sqrt(Math.max(2 * E * m1 * m2 / (m1 + m2), 0));
    return { p, v1: p / m1, v2: p / m2 };
  }

  const EX_PAIRS_EASY = [
    { a: 1, b: 2, m1: 0.25, m2: 0.50 }, { a: 1, b: 2, m1: 0.30, m2: 0.60 },
    { a: 1, b: 3, m1: 0.20, m2: 0.60 }, { a: 1, b: 3, m1: 0.25, m2: 0.75 },
    { a: 2, b: 3, m1: 0.40, m2: 0.60 }, { a: 2, b: 3, m1: 0.30, m2: 0.45 },
    { a: 3, b: 4, m1: 0.45, m2: 0.60 }, { a: 1, b: 4, m1: 0.20, m2: 0.80 },
    { a: 2, b: 5, m1: 0.20, m2: 0.50 }, { a: 1, b: 2, m1: 0.35, m2: 0.70 },
  ];

  /* Given the masses and the two distances, choose a spring that makes the run
     last a watchable second or so. The compression is picked from a grid of
     values a lab bench could actually set, k is rounded to a whole newton per
     metre, and then E, v₁, v₂ and t are all recomputed FROM THE ROUNDED k --
     so the plate the reader works from is the plate the grader used. */
  function exSpring(m1, m2, d1) {
    const targets = rgShuffle(rgGrid(0.60, 1.50, 0.05));
    const xs = rgShuffle(rgGrid(0.020, 0.060, 0.005));
    for (let i = 0; i < targets.length; i++) {
      const v1 = d1 / targets[i];
      const E = (v1 * v1 * m1 * (m1 + m2)) / (2 * m2);
      for (let j = 0; j < xs.length; j++) {
        const x = xs[j];
        const kRaw = (2 * E) / (x * x);
        if (kRaw < 25 || kRaw > 900) continue;
        const k = Math.round(kRaw);
        const E2 = 0.5 * k * x * x;
        const sp = exSpeeds(E2, m1, m2);
        const t = d1 / sp.v1;
        if (t < 0.5 || t > 1.7) continue;
        return { k, x, E: E2, v1: sp.v1, v2: sp.v2, p: sp.p, t };
      }
    }
    // Fail closed with a hand-checked spring rather than return a round whose
    // clock time is nonsense.
    const k = 200, x = 0.040, E = 0.5 * k * x * x;
    const sp = exSpeeds(E, m1, m2);
    return { k, x, E, v1: sp.v1, v2: sp.v2, p: sp.p, t: d1 / sp.v1 };
  }

  function exMake(tier) {
    let m1, m2, d1, d2;
    if (tier === 0) {
      const pr = rgPick(EX_PAIRS_EASY);
      m1 = pr.m1; m2 = pr.m2;
      // Build backwards: only those d₁ whose partner lands exactly on the
      // centimetre grid, so an easy round never asks for 0.2666… m.
      const cells = rgGrid(0.30, 1.30, 0.05).filter((d) => {
        const dd = d * pr.a / pr.b;
        return dd >= 0.15 && Math.abs(dd * 100 - Math.round(dd * 100)) < 1e-9;
      });
      d1 = cells.length ? rgPick(cells) : 0.60;
      d2 = (d1 * m1) / m2;
    } else {
      // Awkward on purpose: a two-decimal mass pair with no tidy ratio, held
      // away from 1 so the equal-energy answer stays a clearly different number.
      let tries = 0;
      do {
        m1 = rgPick(rgGrid(0.18, 0.62, 0.01));
        m2 = rgPick(rgGrid(0.24, 0.95, 0.01));
        tries++;
      } while (tries < 300 && !(m1 < m2 && m1 / m2 >= 0.28 && m1 / m2 <= 0.82));
      if (!(m1 < m2)) { m1 = 0.34; m2 = 0.52; }
      const r = m1 / m2;
      const cells = rgGrid(0.45, 1.30, 0.05).filter((d) => {
        const dd = d * r;
        const wrong = d * Math.sqrt(r);
        return dd >= 0.18 && dd <= 1.10 && Math.abs(wrong - dd) > 0.06;
      });
      d1 = cells.length ? rgPick(cells) : 0.90;
      // Not rounded: d₂ is never printed, only graded against, so rounding it
      // would put a needless gap between the exact answer and the exact answer.
      d2 = d1 * r;
    }

    const sp = exSpring(m1, m2, d1);
    const tolD = Math.max(0.01, d2 * 0.015);
    const inputs = [{ key: "d2", label: "Distance from the start to the second stop", unit: "m", step: "0.001" }];
    if (tier === 2) inputs.push({ key: "t", label: "Time from the thread burning to the clack", unit: "s", step: "0.001" });

    const givens = [
      { label: "Cart 1 (its stop is already clamped)", value: m1.toFixed(2) + " kg", unit: "" },
      { label: "Cart 2", value: m2.toFixed(2) + " kg", unit: "" },
      { label: "Stop 1 distance, d₁", value: d1.toFixed(2) + " m", unit: "" },
      { label: "Spring constant, k", value: sp.k.toFixed(0) + " N/m", unit: "" },
      { label: "Spring compression, x", value: (sp.x * 100).toFixed(1) + " cm", unit: "" },
    ];

    return {
      kind: tier === 2 ? "timed" : "place",
      tier, m1, m2, d1, d2,
      k: sp.k, x: sp.x, E: sp.E, v1: sp.v1, v2: sp.v2, p: sp.p, t: sp.t,
      tolD, tolT: Math.max(0.02, sp.t * 0.02),
      givens, inputs,
      prompt: "The carts are held together against the compressed spring at the start line. Cart 1's bumper stop "
        + "is clamped " + d1.toFixed(2) + " m to its side of the line. Where must cart 2's stop be clamped so that "
        + "both carts hit their bumpers at the same instant"
        + (tier === 2 ? ", and when does that double clack happen?" : "?"),
      note: tier === 2
        ? "The track is level and frictionless. Now you need the spring: all of its stored energy goes into the two carts."
        : "The track is level and frictionless. The thread is burnt at t = 0 and neither cart is touched again.",
    };
  }

  /* --- explosion: grading --------------------------------------------------- */

  function exGrade(r, answers) {
    const gD = rgNum(answers && answers.d2);
    if (!rgFin(gD)) return null;
    let gT = null;
    if (r.kind === "timed") {
      gT = rgNum(answers && answers.t);
      if (!rgFin(gT)) return null;
    }

    const dD = gD - r.d2;
    const okD = Math.abs(dD) <= r.tolD;
    const okT = gT === null || Math.abs(gT - r.t) <= r.tolT;
    const correct = okD && okT;

    // What the bench does with the stop where the reader put it. Cart 1's clack
    // is fixed by the clamped stop; cart 2's is fixed by their number, and the
    // difference is a sound you can hear rather than an error bar.
    const t1 = r.t;
    const t2 = Math.max(gD, 0) / r.v2;
    const dt = t2 - t1;

    const ratio = r.m1 / r.m2;
    const solution = [
      "Before the thread burns nothing is moving, so the total momentum is zero, and the track has no",
      "horizontal force to change it. After:   m₁v₁ = m₂v₂   (opposite directions, equal magnitudes of p)",
      "Both carts must travel for the SAME time t, so d = vt for each:",
      "   d₂/d₁ = v₂/v₁ = m₁/m₂ = " + r.m1.toFixed(2) + "/" + r.m2.toFixed(2) + " = " + ratio.toFixed(4),
      "   d₂ = " + r.d1.toFixed(2) + " × " + ratio.toFixed(4) + " = " + r.d2.toFixed(4) + " m",
      "The heavier cart goes slower and therefore less far, in exactly the same proportion.",
    ];
    if (r.kind === "timed") {
      solution.push(
        "Now the spring, which the first two rounds did not need:",
        "   E = ½kx² = ½ × " + r.k.toFixed(0) + " × " + r.x.toFixed(3) + "² = " + r.E.toFixed(4) + " J",
        "   E = p²/(2m₁) + p²/(2m₂)  →  p = √(2E·m₁m₂/(m₁+m₂)) = " + r.p.toFixed(4) + " kg·m/s",
        "   v₁ = p/m₁ = √(2E·m₂/(m₁(m₁+m₂))) = " + r.v1.toFixed(4) + " m/s      v₂ = p/m₂ = " + r.v2.toFixed(4) + " m/s",
        "   t = d₁/v₁ = " + r.d1.toFixed(2) + "/" + r.v1.toFixed(4) + " = " + r.t.toFixed(4) + " s"
      );
    } else {
      solution.push(
        "The spring's k and x never entered any of that, and they could not: the ratio of the distances is",
        "fixed by the masses alone. A stiffer spring makes both clacks happen sooner, together.",
        "(For the record, this spring gives v₁ = " + r.v1.toFixed(3) + " m/s, v₂ = " + r.v2.toFixed(3)
        + " m/s, clack at " + r.t.toFixed(3) + " s.)"
      );
    }

    let mis = null;
    if (!correct) {
      const energySplit = r.d1 * Math.sqrt(ratio);        // ½E each, wrongly
      const inverted = r.d1 / ratio;                      // ratio upside down
      const tightD = Math.max(0.008, r.d2 * 0.04);
      if (!okD && Math.abs(energySplit - r.d2) > r.tolD * 2 && rgNear(gD, energySplit, tightD)) {
        mis = {
          id: "energy-split-equally",
          label: "You split the energy, not the momentum",
          detail: "Giving each cart ½E leads to v ∝ 1/√m and d₂ = d₁√(m₁/m₂) = " + energySplit.toFixed(3)
            + " m. But energy is a scalar and the spring does not have to hand out equal shares of it — momentum "
            + "is the vector that must cancel. In fact the LIGHT cart takes most of the energy: E₁/E₂ = m₂/m₁ = "
            + (r.m2 / r.m1).toFixed(2) + ". Because m₁ < m₂ here, √(m₁/m₂) is always larger than m₁/m₂, so this "
            + "route always clamps stop 2 too far out and cart 1 always clacks first.",
        };
      } else if (!okD && rgNear(gD, r.d1, tightD) && Math.abs(r.d1 - r.d2) > r.tolD * 2) {
        mis = {
          id: "equal-distances",
          label: "The distances are not equal",
          detail: "Equal distances would need equal speeds, and equal speeds would need equal momenta with unequal "
            + "masses, which is a contradiction. The " + (r.m2 > r.m1 ? "heavier" : "lighter") + " cart 2 leaves at "
            + r.v2.toFixed(3) + " m/s against cart 1's " + r.v1.toFixed(3) + " m/s, so in the same time it covers "
            + ratio.toFixed(3) + " of the distance.",
        };
      } else if (!okD && rgNear(gD, inverted, Math.max(0.01, inverted * 0.04))) {
        mis = {
          id: "ratio-inverted",
          label: "The ratio is upside down",
          detail: "You gave the heavier cart the longer run. Heavier means slower (m₁v₁ = m₂v₂ with a bigger m "
            + "means a smaller v), and slower in the same time means nearer. d₂ = d₁·m₁/m₂, not d₁·m₂/m₁.",
        };
      } else if (okD && gT !== null) {
        const halfE = r.d1 / Math.sqrt(r.E / r.m1);
        const allE = r.d1 / Math.sqrt(2 * r.E / r.m1);
        if (rgNear(gT, halfE, Math.max(0.02, halfE * 0.04))) {
          mis = {
            id: "energy-split-time",
            label: "You gave cart 1 half the energy",
            detail: "½E = ½m₁v₁² gives v₁ = " + Math.sqrt(r.E / r.m1).toFixed(3) + " m/s, but the shares are not "
              + "equal. Split the MOMENTUM: p is the same for both, so E = p²/2m₁ + p²/2m₂ and v₁ = "
              + r.v1.toFixed(3) + " m/s.",
          };
        } else if (rgNear(gT, allE, Math.max(0.02, allE * 0.04))) {
          mis = {
            id: "all-energy-one-cart",
            label: "Cart 2 gets some of it too",
            detail: "E = ½m₁v₁² would put the whole " + r.E.toFixed(4) + " J into cart 1 alone. Cart 2 carries "
              + (100 * r.m1 / (r.m1 + r.m2)).toFixed(1) + "% of it. Share by momentum first, then convert.",
          };
        }
      }
    }

    let verdict;
    if (correct) {
      verdict = { kind: "hit", text: "One clack, not two" };
    } else if (!okD) {
      verdict = dD > 0
        ? { kind: "over", text: "Stop too far out — cart 1 clacked " + Math.abs(dt).toFixed(2) + " s early" }
        : { kind: "under", text: "Stop too close in — cart 2 clacked " + Math.abs(dt).toFixed(2) + " s early" };
    } else {
      verdict = gT > r.t
        ? { kind: "over", text: "Both stops right, clock late by " + (gT - r.t).toFixed(2) + " s" }
        : { kind: "under", text: "Both stops right, clock early by " + (r.t - gT).toFixed(2) + " s" };
    }

    let feedback;
    if (correct) {
      feedback = "Both bumpers are struck at " + r.t.toFixed(3) + " s and the two clacks land on top of each other.";
    } else if (!okD) {
      feedback = "Cart 2 reaches your stop at " + t2.toFixed(3) + " s; cart 1 reaches its own at "
        + t1.toFixed(3) + " s. Two clacks, " + Math.abs(dt).toFixed(3) + " s apart. The stop belongs at "
        + r.d2.toFixed(3) + " m.";
    } else {
      feedback = "The stop is in the right place, so the clacks are simultaneous — but they happen at "
        + r.t.toFixed(3) + " s, not " + gT.toFixed(3) + " s.";
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : mis,
      solution,
      exact: { d2: r.d2, t: r.t, v1: r.v1, v2: r.v2, E: r.E, p: r.p },
      tolerance: r.kind === "timed" ? { d2: r.tolD, t: r.tolT } : { d2: r.tolD },
      guessD: gD, guessT: gT, t1, t2,
    };
  }

  /* --- explosion: animation and drawing ------------------------------------- */

  function exAnim(r, res) {
    const stop2 = res && rgFin(res.guessD) ? Math.max(res.guessD, 0) : r.d2;
    return {
      game: "explosion", t: 0, done: false, hold: 0,
      stop2,
      t1: r.d1 / r.v1,
      t2: stop2 / r.v2,
      clack1: 0, clack2: 0,          // ring-down of each bumper flash
      // A quarter second of held stillness before the thread burns, so the
      // reader sees the arrangement they built before it is destroyed.
      fuse: 0.45,
    };
  }

  function exStep(a, r, dt) {
    const before = a.t;
    a.t += dt;
    const s = Math.max(0, a.t - a.fuse), sb = Math.max(0, before - a.fuse);
    if (sb < a.t1 && s >= a.t1) a.clack1 = 1;
    if (sb < a.t2 && s >= a.t2) a.clack2 = 1;
    a.clack1 = Math.max(0, a.clack1 - dt * 2.2);
    a.clack2 = Math.max(0, a.clack2 - dt * 2.2);
    if (s > Math.max(a.t1, a.t2) + 2.6) { a.done = true; return false; }
    // A stop clamped absurdly far out means a cart still trundling half a minute
    // later. The verdict has already named both clack times; stop watching.
    if (s > 13) { a.done = true; return false; }
    return true;
  }

  function exDraw(ctx, w, h, r, res, a, P) {
    const stop2 = a ? a.stop2 : (res && rgFin(res.guessD) ? Math.max(res.guessD, 0) : r.d2);
    const span = Math.max(r.d1, stop2, r.d2, 0.2) * 2 * 1.18;
    const trackY = h * 0.60;
    const cx = w * 0.5;
    const scale = (w * 0.86) / span;
    const showText = w > 430 && h > 250;
    const s = a ? Math.max(0, a.t - a.fuse) : 0;
    const released = s > 0;

    const x1 = -Math.min(r.v1 * s, r.d1);          // cart 1 runs left
    const x2 = Math.min(r.v2 * s, stop2);          // cart 2 runs right

    // the rail
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.04, trackY + 2); ctx.lineTo(w * 0.96, trackY + 2); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    for (let x = w * 0.04; x < w * 0.96; x += 11) {
      ctx.beginPath(); ctx.moveTo(x, trackY + 4); ctx.lineTo(x - 5, trackY + 10); ctx.stroke();
    }
    ctx.restore();
    if (typeof drawDashedLine === "function") {
      drawDashedLine(ctx, cx, trackY - 74, cx, trackY + 14, P.inkSoft, 1.2, [3, 4]);
    }
    if (showText) drawLabel(ctx, cx, trackY + 26, "start", P.inkSoft, 10.5);

    const cw = rgClamp(Math.min(52, scale * 0.16), 16, 52);
    const ch = rgClamp(cw * 0.55, 9, 30);

    function stopPost(dm, sign, col, label, flash) {
      const sx = cx + sign * dm * scale;
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(sx, trackY); ctx.lineTo(sx, trackY - ch * 1.9); ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sx, trackY - ch * 0.3); ctx.lineTo(sx - sign * 6, trackY - ch * 0.3); ctx.stroke();
      if (flash > 0.01) {
        ctx.globalAlpha = rgClamp(flash, 0, 1);
        ctx.lineWidth = 2;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(sx - sign * 3, trackY - ch * 0.8, 7 + i * 7 * (1.25 - flash), -0.9, 0.9, sign < 0);
          ctx.stroke();
        }
      }
      ctx.restore();
      if (showText) drawLabel(ctx, sx, trackY - ch * 2.1 - 9, label, col, 10);
    }

    stopPost(r.d1, -1, P.navy, "stop 1  " + r.d1.toFixed(2) + " m", a ? a.clack1 : 0);
    stopPost(stop2, 1, P.crimson,
      res ? "your stop  " + stop2.toFixed(3) + " m" : "stop 2  — you place it",
      a ? a.clack2 : 0);

    // Where it actually belongs, drawn only once the reader has committed.
    if (res && Math.abs(stop2 - r.d2) > 1e-6 && typeof drawDashedLine === "function") {
      const tx = cx + r.d2 * scale;
      drawDashedLine(ctx, tx, trackY, tx, trackY - ch * 1.5, P.forest, 1.6, [4, 3]);
      if (showText) drawLabel(ctx, tx, trackY - ch * 1.5 - 9, "correct  " + r.d2.toFixed(3), P.forest, 10);
    }

    const cart1X = cx + x1 * scale - cw * 0.55;
    const cart2X = cx + x2 * scale + cw * 0.55;
    if (!released && typeof drawSpringCoil === "function") {
      drawSpringCoil(ctx, cart1X + cw * 0.5, trackY - ch * 1.1, cart2X - cw * 0.5, trackY - ch * 1.1, 6, P.brass);
    }
    if (typeof drawCart === "function") {
      // Wheel spin is the translation divided by the wheel radius; nothing here
      // is allowed to rotate on its own timetable.
      const wr = Math.max(ch * 0.22, 1);
      drawCart(ctx, cart1X, trackY, cw, ch, (x1 * scale) / wr, P.navy, P.panel);
      drawCart(ctx, cart2X, trackY, cw, ch, (x2 * scale) / wr, P.crimson, P.panel);
    }
    if (showText) {
      drawLabel(ctx, cart1X, trackY - ch * 2.4, "m₁ " + r.m1.toFixed(2) + " kg", P.navy, 10);
      drawLabel(ctx, cart2X, trackY - ch * 2.4, "m₂ " + r.m2.toFixed(2) + " kg", P.crimson, 10);
    }

    if (showText && typeof drawRuler === "function") drawRuler(ctx, w, h, trackY + 2, 0);

    if (showText && typeof drawDataPlate === "function") {
      const rows = ["clock  " + s.toFixed(3) + " s"];
      if (res) {
        rows.push("cart 1 clack  " + res.t1.toFixed(3) + " s");
        rows.push("cart 2 clack  " + (rgFin(res.t2) ? res.t2.toFixed(3) : "—") + " s");
        rows.push("apart by  " + (rgFin(res.t2) ? Math.abs(res.t2 - res.t1).toFixed(3) : "—") + " s");
      } else {
        // The speeds stay off the plate until the reader has committed: on the
        // third tier they ARE the answer, and the plate must not hand it over.
        rows.push("spring  " + r.k.toFixed(0) + " N/m at " + (r.x * 100).toFixed(1) + " cm");
      }
      drawDataPlate(ctx, w - 190, 10, 178, rows);
    }
    if (showText && typeof sideNameplate === "function") {
      sideNameplate(ctx, 12, h - 34, "Bench", "Air track", P.crimson);
    }
  }

  /* ==========================================================================
     GAME 3 — Ballistic pendulum
     --------------------------------------------------------------------------
     The apparatus that exists solely to make one point: a collision and a swing
     are two different conservation laws, and you must change horses between
     them.

        during the collision   momentum   m v = (m+M) v'        energy is LOST
        after the collision    energy     ½(m+M)v'² = (m+M)gh   momentum is not

     Run energy through the collision instead and you get v' = v√(m/(m+M)),
     which is bigger than mv/(m+M) by a factor of √((m+M)/m) — with a real
     catcher that is a factor of three, so the predicted RISE is off by a factor
     of ten and the pointer is asked to record an angle past the horizontal.
     Every tier-2 and tier-3 round in this file is constructed so that wrong
     angle is computable, because a number you can be shown is a better
     correction than a domain error.
     ======================================================================== */

  function bpRise(vp) { return (vp * vp) / (2 * G()); }
  function bpAngle(h, L) {
    const c = 1 - h / L;
    if (!(c >= -1 && c <= 1)) return NaN;      // over the top; fail closed
    return Math.acos(c) * DEG;
  }

  const BP_FALLBACK_1 = { m: 0.030, M: 0.270, L: 0.40, thDeg: 40 };
  const BP_FALLBACK_2 = { m: 0.030, M: 0.210, L: 0.40, thDeg: 35 };

  function bpMake(tier) {
    const g = G();
    let m, M, L, thDeg, v, R;

    if (tier === 0) {
      // θ is the given here, so it is chosen on a whole-degree grid and the
      // answer is computed FROM the printed value, not from a hidden one.
      let ok = false;
      for (let i = 0; i < 500 && !ok; i++) {
        m = rgPick(rgGrid(0.010, 0.070, 0.005));
        L = rgPick(rgGrid(0.25, 0.60, 0.01));
        const rTry = rgPick(rgGrid(5, 20, 0.5));
        M = rgR(m * (rTry - 1), 3);
        if (M < 0.05) continue;
        R = (m + M) / m;
        thDeg = rgPick(rgGrid(25, 70, 1));
        const vp = Math.sqrt(2 * g * L * (1 - Math.cos(thDeg * RAD)));
        v = vp * R;
        if (v >= 4 && v <= 45) ok = true;
      }
      if (!ok) { m = BP_FALLBACK_1.m; M = BP_FALLBACK_1.M; L = BP_FALLBACK_1.L; thDeg = BP_FALLBACK_1.thDeg; }
    } else {
      /* v is the given here, so it is rounded to a tenth for the plate and θ is
         then recomputed from the ROUNDED v. The mass ratio is capped against the
         angle so that R·h stays under 1.95L: that keeps the kinetic-energy
         mistake at an angle arccos can still return, which is the difference
         between naming the error and shrugging at it. */
      let ok = false;
      for (let i = 0; i < 600 && !ok; i++) {
        m = rgPick(rgGrid(0.010, 0.070, 0.005));
        const rTry = rgPick(rgGrid(3.5, 16, 0.5));
        M = rgR(m * (rTry - 1), 3);
        if (M < 0.04) continue;
        R = (m + M) / m;
        L = rgPick(rgGrid(0.25, 0.60, 0.01));
        const cap = Math.min(70, Math.acos(rgClamp(1 - 1.95 / R, -1, 1)) * DEG);
        if (cap < 26) continue;
        const target = 25 + Math.random() * (cap - 25);
        const vp = Math.sqrt(2 * g * L * (1 - Math.cos(target * RAD)));
        v = rgR(vp * R, 1);
        if (v < 4 || v > 45) continue;
        const hh = bpRise(v / R);
        thDeg = bpAngle(hh, L);
        if (!rgFin(thDeg) || thDeg < 25 || thDeg > 70) continue;
        if (R * hh > 1.95 * L) continue;
        ok = true;
      }
      if (!ok) {
        m = BP_FALLBACK_2.m; M = BP_FALLBACK_2.M; L = BP_FALLBACK_2.L;
        R = (m + M) / m;
        v = rgR(Math.sqrt(2 * g * L * (1 - Math.cos(BP_FALLBACK_2.thDeg * RAD))) * R, 1);
        thDeg = bpAngle(bpRise(v / R), L);
      }
    }

    R = (m + M) / m;
    const vp = tier === 0 ? Math.sqrt(2 * g * L * (1 - Math.cos(thDeg * RAD))) : v / R;
    const hRise = bpRise(vp);
    if (tier === 0) v = vp * R;
    const fracLost = M / (m + M);

    const givens = [
      { label: "Ball mass, m", value: m.toFixed(3) + " kg", unit: "" },
      { label: "Catcher bob mass, M", value: M.toFixed(3) + " kg", unit: "" },
      { label: "String length, L", value: L.toFixed(2) + " m", unit: "" },
    ];
    if (tier === 0) givens.push({ label: "Angle the ratchet recorded, θ", value: thDeg.toFixed(1) + "°", unit: "" });
    else givens.push({ label: "Ball speed at the muzzle, v", value: v.toFixed(1) + " m/s", unit: "" });
    givens.push({ label: "g", value: g.toFixed(2) + " m/s²", unit: "" });

    const inputs = tier === 0
      ? [{ key: "v", label: "Speed of the ball just before it strikes", unit: "m/s", step: "0.01" }]
      : [{ key: "theta", label: "Highest angle the ratchet will record", unit: "°", step: "0.1" }];
    if (tier === 2) {
      inputs.push({ key: "floss", label: "Fraction of the ball's kinetic energy lost (0 to 1)", unit: "", step: "0.001" });
    }

    return {
      kind: tier === 0 ? "speed" : "angle",
      tier, m, M, L, R, v, vp, hRise, thDeg, fracLost,
      tolV: Math.max(0.05, v * 0.02),
      tolTh: Math.max(1.0, thDeg * 0.01),
      tolF: Math.max(0.008, fracLost * 0.015),
      givens, inputs,
      prompt: tier === 0
        ? "The ball is fired horizontally into the catcher and stays buried in it. The ratchet pointer was left at "
          + thDeg.toFixed(1) + "°. How fast was the ball travelling just before it struck?"
        : tier === 2
          ? "The ball is fired horizontally into the catcher and stays buried in it. Set the pointer: what is the "
            + "highest angle the bob reaches — and what fraction of the ball's kinetic energy does the collision destroy?"
          : "The ball is fired horizontally into the catcher and stays buried in it. Set the pointer before you fire: "
            + "what is the highest angle the bob will reach?",
      note: "The ball embeds itself in the bob. The collision and the swing that follows are not governed by the "
        + "same conserved quantity — decide which is which before you write anything down.",
    };
  }

  /* --- ballistic pendulum: grading ------------------------------------------ */

  function bpSolution(r) {
    const g = G();
    const lines = [
      "Collision (fast, violent, momentum only):   m v = (m + M) v'",
      "   v' = m v/(m+M) = " + r.m.toFixed(3) + "×" + r.v.toFixed(2) + "/" + (r.m + r.M).toFixed(3)
        + " = " + r.vp.toFixed(4) + " m/s",
      "Swing (slow, smooth, energy only):          ½(m+M)v'² = (m+M) g h",
      "   h = v'²/2g = " + r.vp.toFixed(4) + "²/(2×" + g.toFixed(2) + ") = " + r.hRise.toFixed(4) + " m",
      "Geometry:                                    h = L(1 − cos θ)",
      "   cos θ = 1 − h/L = 1 − " + r.hRise.toFixed(4) + "/" + r.L.toFixed(2) + " = "
        + (1 - r.hRise / r.L).toFixed(4) + "   →   θ = " + r.thDeg.toFixed(2) + "°",
    ];
    if (r.kind === "speed") {
      lines.push("Read backwards, which is the direction the real lab runs:",
        "   v' = √(2gL(1−cos θ)) = " + r.vp.toFixed(4) + " m/s,   v = v'(m+M)/m = " + r.vp.toFixed(4)
        + " × " + r.R.toFixed(3) + " = " + r.v.toFixed(3) + " m/s");
    }
    lines.push(
      "Energy through the collision:  KE_after/KE_before = m/(m+M) = " + (r.m / (r.m + r.M)).toFixed(4),
      "   so the fraction LOST is M/(m+M) = " + r.fracLost.toFixed(4) + " — "
        + (r.fracLost * 100).toFixed(1) + "% of it, gone into heat and deformation.",
      "That is why you cannot run energy through the collision: almost all of it is not there afterwards."
    );
    return lines;
  }

  function bpGrade(r, answers) {
    const g = G();
    if (r.kind === "speed") {
      const gv = rgNum(answers && answers.v);
      if (!rgFin(gv)) return null;
      const d = gv - r.v;
      const correct = Math.abs(d) <= r.tolV;

      // The bench fires at THEIR speed. Everything downstream follows.
      const vpG = (r.m * Math.max(gv, 0)) / (r.m + r.M);
      const hG = bpRise(vpG);
      const thG = bpAngle(hG, r.L);

      let mis = null;
      if (!correct) {
        const keRoute = r.vp * Math.sqrt(r.R);
        const noBob = r.vp;
        if (rgNear(gv, keRoute, Math.max(0.05, keRoute * 0.03))) {
          mis = {
            id: "ke-conserved-in-collision",
            label: "You conserved kinetic energy through the collision",
            detail: "½mv² = ½(m+M)v'² gives v' = v√(m/(m+M)) and inverts to v = v'√((m+M)/m) = "
              + keRoute.toFixed(2) + " m/s. But the ball BURIES itself in the bob — that is the definition of a "
              + "perfectly inelastic collision, and " + (r.fracLost * 100).toFixed(0) + "% of the kinetic energy is "
              + "destroyed in it. Only momentum survives: v = v'(m+M)/m = " + r.v.toFixed(2) + " m/s, a factor of "
              + Math.sqrt(r.R).toFixed(2) + " larger than what you wrote.",
          };
        } else if (rgNear(gv, noBob, Math.max(0.05, noBob * 0.03))) {
          mis = {
            id: "forgot-the-bob",
            label: "That is v', not v",
            detail: "√(2gL(1−cosθ)) = " + noBob.toFixed(3) + " m/s is the speed of the ball AND bob together just "
              + "after impact. The ball arrived on its own and had to drag " + r.M.toFixed(3)
              + " kg of catcher into motion, so it was moving (m+M)/m = " + r.R.toFixed(2) + " times faster than that.",
          };
        }
      }

      const verdict = correct
        ? { kind: "hit", text: "Pointer lands on " + r.thDeg.toFixed(1) + "°" }
        : d > 0
          ? { kind: "over", text: rgFin(thG) ? "Bob swung to " + thG.toFixed(0) + "°, past the mark"
              : "Bob went over the top — the string went slack" }
          : { kind: "under", text: "Bob only reached " + (rgFin(thG) ? thG.toFixed(0) : "0") + "°" };

      const feedback = correct
        ? "Fired at " + gv.toFixed(2) + " m/s the bob rises " + r.hRise.toFixed(3)
          + " m and the ratchet stops exactly on the recorded " + r.thDeg.toFixed(1) + "°."
        : "At " + gv.toFixed(2) + " m/s the bob leaves the impact at " + vpG.toFixed(3) + " m/s and rises "
          + hG.toFixed(3) + " m" + (rgFin(thG) ? ", which is " + thG.toFixed(1) + "° — not the "
            + r.thDeg.toFixed(1) + "° the ratchet recorded." : " — further than the string is long, so it never "
            + "makes an angle at all.") + " The ball was travelling " + r.v.toFixed(2) + " m/s.";

      return {
        correct, blank: false, verdict, feedback,
        misconception: correct ? null : mis,
        solution: bpSolution(r),
        exact: { v: r.v, vp: r.vp, h: r.hRise, theta: r.thDeg, fracLost: r.fracLost },
        tolerance: { v: r.tolV },
        guessV: gv, vpG, hG, thG,
      };
    }

    /* --- tier 2 and 3: the reader sets the pointer, the bench fires --------- */
    const gt = rgNum(answers && answers.theta);
    if (!rgFin(gt)) return null;
    let gf = null;
    if (r.tier === 2) {
      gf = rgNum(answers && answers.floss);
      if (!rgFin(gf)) return null;
    }

    const dT = gt - r.thDeg;
    const okT = Math.abs(dT) <= r.tolTh;
    const okF = gf === null || Math.abs(gf - r.fracLost) <= r.tolF;
    const correct = okT && okF;

    let mis = null;
    if (!correct) {
      const hKe = r.R * r.hRise;                       // energy-through-collision
      const thKe = bpAngle(hKe, r.L);
      const hNoBob = bpRise(r.v);                       // bob mass ignored entirely
      const thNoBob = bpAngle(hNoBob, r.L);
      if (!okT && rgFin(thKe) && Math.abs(thKe - r.thDeg) > r.tolTh * 2 && rgNear(gt, thKe, 3.0)) {
        mis = {
          id: "ke-conserved-in-collision",
          label: "You conserved kinetic energy through the collision",
          detail: "v' = v√(m/(m+M)) gives a rise of " + hKe.toFixed(3) + " m against the true "
            + r.hRise.toFixed(3) + " m — a factor of (m+M)/m = " + r.R.toFixed(1) + " too big, because energy "
            + "goes as v² and you took the square root where the mass ratio belongs undivided. "
            + (thKe > 90 ? "It puts the pointer at " + thKe.toFixed(0) + "°, past the horizontal, on a string "
              + "that cannot push. " : "") + "The ball buries itself in the bob: "
            + (r.fracLost * 100).toFixed(0) + "% of the kinetic energy is destroyed in the impact. Use momentum "
            + "for the collision and energy only afterwards.",
        };
      } else if (!okT && rgFin(thNoBob) && Math.abs(thNoBob - r.thDeg) > r.tolTh * 2 && rgNear(gt, thNoBob, 3.0)) {
        mis = {
          id: "forgot-the-bob",
          label: "You left the bob's mass out",
          detail: "h = v²/2g treats the ball as if it kept its own speed and then climbed alone. It has to take "
            + r.M.toFixed(3) + " kg of catcher with it, so the speed after impact is m/(m+M) = "
            + (1 / r.R).toFixed(3) + " of what it was.",
        };
      } else if (!okT && gt >= 88) {
        // Both wrong routes usually overshoot arccos's domain. Naming the symptom
        // is honest; naming a specific mistake we cannot separate would not be.
        mis = {
          id: "past-horizontal",
          label: "That is past the horizontal",
          detail: "A rise of L or more means the bob swings above the level of the pivot, where a string can no "
            + "longer pull it round — it would go slack and the bob would fly. On this bench the true rise is "
            + r.hRise.toFixed(3) + " m out of a possible " + r.L.toFixed(2) + " m of string. An answer up here "
            + "almost always comes from carrying kinetic energy through the collision, which overstates the rise "
            + "by (m+M)/m = " + r.R.toFixed(1) + "×.",
        };
      } else if (okT && gf !== null) {
        const inverted = r.m / (r.m + r.M);
        if (rgNear(gf, inverted, Math.max(0.01, inverted * 0.05)) && Math.abs(inverted - r.fracLost) > r.tolF * 2) {
          mis = {
            id: "fraction-inverted",
            label: "That is the fraction KEPT",
            detail: "m/(m+M) = " + inverted.toFixed(4) + " is how much of the kinetic energy survives. The "
              + "question asks how much is lost, which is the rest of it: M/(m+M) = " + r.fracLost.toFixed(4) + ".",
          };
        } else if (rgNear(gf, r.fracLost * 100, Math.max(0.5, r.fracLost * 2))) {
          mis = {
            id: "unit-slip",
            label: "That is the percentage",
            detail: "Your value is right as a percentage; the box asks for a fraction between 0 and 1, so "
              + r.fracLost.toFixed(3) + " rather than " + (r.fracLost * 100).toFixed(1) + ".",
          };
        }
      }
    }

    let verdict;
    if (correct) {
      verdict = { kind: "hit", text: "Pointer knocked to exactly your mark" };
    } else if (!okT) {
      verdict = dT > 0
        ? { kind: "over", text: "Bob stopped " + Math.abs(dT).toFixed(0) + "° short of your pointer" }
        : { kind: "under", text: "Bob drove your pointer " + Math.abs(dT).toFixed(0) + "° further round" };
    } else {
      verdict = gf > r.fracLost
        ? { kind: "over", text: "Angle right; too much energy written off" }
        : { kind: "under", text: "Angle right; more energy is lost than that" };
    }

    const feedback = correct
      ? "The bob rises " + r.hRise.toFixed(3) + " m and the ratchet stops on " + r.thDeg.toFixed(1) + "°, where you left it."
      : !okT
        ? "The bob's real highest angle is " + r.thDeg.toFixed(1) + "° (a rise of " + r.hRise.toFixed(3)
          + " m). You set the pointer at " + gt.toFixed(1) + "°, so it "
          + (dT > 0 ? "was never reached." : "was knocked straight past.")
        : "The angle is right. The collision destroys M/(m+M) = " + r.fracLost.toFixed(3)
          + " of the ball's kinetic energy, not " + gf.toFixed(3) + ".";

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : mis,
      solution: bpSolution(r),
      exact: { theta: r.thDeg, h: r.hRise, vp: r.vp, fracLost: r.fracLost },
      tolerance: r.tier === 2 ? { theta: r.tolTh, floss: r.tolF } : { theta: r.tolTh },
      guessTh: gt, guessF: gf,
    };
  }

  /* --- ballistic pendulum: animation and drawing ---------------------------- */

  // The ball travels at 20 m/s; nothing about that is watchable, and nothing
  // about it is being tested either. The approach is scripted at a fixed screen
  // speed and the SWING -- the part carrying the physics -- is integrated.
  const BP_APPROACH = 0.95;
  // A bob leaving the impact at 5 m/s on a 40 cm string turns at 13 rad/s, which
  // at any honest playback rate crosses a third of the arc between two frames.
  // The clock is stretched in proportion to the angular speed instead, so every
  // round -- including the absurd ones a wrong answer produces -- draws a path
  // rather than a series of places the bob has been.
  // Strictly inverse in ω, with a ceiling but deliberately no floor: the step
  // per frame is then ω·rate·dt = 1.1·dt no matter how violent the answer was,
  // so even a bob whirling at thirteen turns a second draws a path. A slow
  // enough swing simply plays at the ceiling.
  function bpRate(om0) { return Math.min(0.75, 1.1 / Math.max(Math.abs(om0), 0.1)); }

  function bpAnim(r, res) {
    // Tier 1 fires the reader's own number. Tiers 2 and 3 fire the given speed
    // at a pointer the reader placed: either way one end of the comparison is
    // theirs and the apparatus supplies the other.
    const vp = r.kind === "speed" && res && rgFin(res.vpG) ? res.vpG : r.vp;
    return {
      game: "ballistic-pendulum", t: 0, done: false, hold: 0,
      phase: "approach", u: 0,
      phi: 0, om: vp / r.L, vp, rate: bpRate(vp / r.L),
      peak: 0, peaked: false, slack: false,
      fx: 0, fy: 0, fvx: 0, fvy: 0,       // projectile, in metres relative to pivot
      pointer: r.kind === "speed" ? r.thDeg : (res && rgFin(res.guessTh) ? res.guessTh : r.thDeg),
      pointerIsReader: r.kind !== "speed",
    };
  }

  function bpStep(a, r, dt) {
    const g = G();
    if (a.phase === "approach") {
      a.t += dt;
      a.u = rgClamp(a.t / BP_APPROACH, 0, 1);
      if (a.u >= 1) { a.phase = "swing"; a.t = 0; }
      return true;
    }
    if (a.phase === "swing") {
      let left = dt * a.rate;
      while (left > 1e-6) {
        const s = Math.min(SUB, left); left -= s;
        // The string can pull but never push. Once L·ω² + g·cos φ goes negative
        // the tension has gone through zero and the bob is a projectile — which
        // is precisely what an answer past the horizontal is asking for.
        if (a.phi > Math.PI / 2 && r.L * a.om * a.om + g * Math.cos(a.phi) < 0) {
          a.slack = true;
          a.fx = r.L * Math.sin(a.phi);
          a.fy = r.L * Math.cos(a.phi);
          a.fvx = r.L * Math.cos(a.phi) * a.om;
          a.fvy = -r.L * Math.sin(a.phi) * a.om;
          a.phase = "fly"; a.t = 0;
          return true;
        }
        a.om += -(g / r.L) * Math.sin(a.phi) * s;
        a.phi += a.om * s;
        if (!a.peaked && a.om <= 0) { a.peaked = true; a.peak = a.phi; }
        // Damping starts only after the recorded peak, so the number the
        // ratchet keeps is the undamped one the algebra predicts.
        if (a.peaked) a.om *= (1 - 0.30 * s);
        if (a.phi > a.peak) a.peak = a.phi;
      }
      a.t += dt;
      if (a.t > 6.5) { a.done = true; return false; }
      return true;
    }
    // projectile
    let left = dt * a.rate;
    while (left > 1e-6) {
      const s = Math.min(SUB, left); left -= s;
      a.fvy += g * s;                    // +y is downward from the pivot
      a.fx += a.fvx * s;
      a.fy += a.fvy * s;
    }
    a.t += dt;
    if (a.fy > r.L * 1.45 || a.t > 3.2) { a.done = true; return false; }
    return true;
  }

  function bpDraw(ctx, w, h, r, res, a, P) {
    const showText = w > 430 && h > 250;
    const pivotY = h * 0.16;
    const cx = w * 0.44;
    const Lpx = Math.min(h * 0.66, w * 0.34);
    const scale = Lpx / Math.max(r.L, 0.05);
    const bob = rgClamp(Lpx * 0.16, 7, 30);
    const phi = a && a.phase !== "approach" && !a.slack ? a.phi : 0;
    const flying = !!(a && a.phase === "fly");

    // the mount
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - 46, pivotY); ctx.lineTo(cx + 46, pivotY); ctx.stroke();
    ctx.restore();
    if (typeof drawDashedLine === "function") {
      drawDashedLine(ctx, cx, pivotY, cx, pivotY + Lpx + bob, P.rule, 1, [3, 5]);
      // the horizontal through the pivot: the line a string cannot cross
      drawDashedLine(ctx, cx - Lpx * 1.05, pivotY, cx + Lpx * 1.05, pivotY, P.inkSoft, 1, [2, 6]);
    }

    // the ratchet scale, and the pointer the reader (or the lab) left on it
    const arcR = Lpx * 0.80;
    if (arcR > 22) {
      ctx.save();
      ctx.strokeStyle = P.rule; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, pivotY, arcR, Math.PI / 2 - 100 * RAD, Math.PI / 2, true); ctx.stroke();
      ctx.lineWidth = 1;
      for (let d = 0; d <= 100; d += 10) {
        const ang = Math.PI / 2 - d * RAD;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * arcR, pivotY + Math.sin(ang) * arcR);
        ctx.lineTo(cx + Math.cos(ang) * (arcR + (d % 30 === 0 ? 8 : 4)),
                   pivotY + Math.sin(ang) * (arcR + (d % 30 === 0 ? 8 : 4)));
        ctx.stroke();
      }
      ctx.restore();
      const pAng = Math.PI / 2 - rgClamp(a ? a.pointer : r.thDeg, 0, 100) * RAD;
      const pCol = a && a.pointerIsReader ? P.brass : P.crimson;
      ctx.save();
      ctx.strokeStyle = pCol; ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(pAng) * (arcR - 12), pivotY + Math.sin(pAng) * (arcR - 12));
      ctx.lineTo(cx + Math.cos(pAng) * (arcR + 11), pivotY + Math.sin(pAng) * (arcR + 11));
      ctx.stroke();
      ctx.restore();
      if (showText) {
        drawLabel(ctx, cx + Math.cos(pAng) * (arcR + 30), pivotY + Math.sin(pAng) * (arcR + 30),
          a ? ((a.pointerIsReader ? "your " : "recorded ") + a.pointer.toFixed(1) + "°")
            : (r.tier === 0 ? "recorded " + r.thDeg.toFixed(1) + "°" : "pointer — set it"),
          pCol, 10.5);
      }
    }

    // the bob, either on its string or off it
    let bx, by;
    if (flying) {
      bx = cx + a.fx * scale;
      by = pivotY + a.fy * scale;
    } else {
      bx = cx + Lpx * Math.sin(phi);
      by = pivotY + Lpx * Math.cos(phi);
      ctx.save();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(cx, pivotY); ctx.lineTo(bx, by); ctx.stroke();
      ctx.restore();
    }
    if (flying && typeof drawDashedLine === "function") {
      drawDashedLine(ctx, cx, pivotY, bx, by, P.crimson, 1, [2, 4]);
      if (showText) drawLabel(ctx, (cx + bx) / 2, (pivotY + by) / 2 - 10, "slack", P.crimson, 10);
    }
    if (typeof drawHangingBlock === "function") drawHangingBlock(ctx, bx, by, bob * 1.7, P.navy);

    // the ball: in flight before impact, buried in the bob after
    if (a && a.phase === "approach") {
      const startX = Math.max(w * 0.04, cx - Lpx * 1.5);
      const gx = startX + (cx - bob * 0.85 - startX) * a.u;
      ctx.save();
      ctx.fillStyle = P.crimson; ctx.strokeStyle = P.crimson; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(gx, pivotY + Lpx, Math.max(3, bob * 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (typeof drawArrow === "function" && showText) {
        drawArrow(ctx, gx - 34, pivotY + Lpx, gx - 8, pivotY + Lpx, P.crimson, 1.8);
      }
    } else {
      ctx.save();
      ctx.fillStyle = P.crimson;
      ctx.beginPath(); ctx.arc(bx - Math.sin(phi) * bob * 0.35, by - Math.cos(phi) * bob * 0.35,
        Math.max(2.5, bob * 0.26), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // the angle actually reached, drawn as it is reached
    if (a && a.phase !== "approach" && arcR > 22 && typeof drawAngleArc === "function") {
      const reached = (a.slack ? a.peak : Math.max(a.peak, a.phi)) * DEG;
      drawAngleArc(ctx, cx, pivotY, arcR * 0.55, Math.PI / 2 - rgClamp(reached, 0, 179) * RAD, Math.PI / 2,
        P.forest, reached.toFixed(1) + "°");
    }

    if (showText && typeof drawDataPlate === "function") {
      const rows = ["m " + r.m.toFixed(3) + " kg   M " + r.M.toFixed(3) + " kg", "L " + r.L.toFixed(2) + " m"];
      if (res) {
        if (r.kind === "speed") {
          rows.push("you fired  " + (rgFin(res.guessV) ? res.guessV.toFixed(2) : "—") + " m/s");
          rows.push("bob rose  " + (rgFin(res.hG) ? res.hG.toFixed(3) : "—") + " m");
          rows.push("true v  " + r.v.toFixed(2) + " m/s");
        } else {
          rows.push("your pointer  " + (rgFin(res.guessTh) ? res.guessTh.toFixed(1) : "—") + "°");
          rows.push("bob reached  " + r.thDeg.toFixed(1) + "°");
          rows.push("KE lost  " + (r.fracLost * 100).toFixed(1) + "%");
        }
      } else if (r.kind !== "speed") {
        rows.push("muzzle  " + r.v.toFixed(1) + " m/s");
      }
      drawDataPlate(ctx, w - 194, 10, 182, rows);
    }
    if (showText && typeof sideNameplate === "function") {
      sideNameplate(ctx, 12, h - 34, "Bench", "Ballistic pendulum", P.crimson);
    }
  }

  /* ==========================================================================
     GAME 4 — Loop the loop
     --------------------------------------------------------------------------
     "It has to reach the top" is the most popular wrong answer in the whole
     course, and no amount of telling fixes it. Watching does.

     At an angle ψ round from the TOP, gravity's component along the radius is
     g cos ψ, and the track can only push inward:

          N = m v²/R − m g cos ψ  ≥ 0

     Everything follows from writing that with the energy equation and setting
     N = 0. With k = I/mR² for the body and u = E_loss/(mg) as a height the ramp
     steals:

          cos ψ = 2(h − R − u) / (R(3 + k))          departure point
          h_min = R(5 + k)/2 + u                     the ψ = 0 case

     which is 2.5R for a bead, 2.7R for a rolling sphere, plus the lost height.
     Both come out of the same line, so they cannot disagree with each other.

     h = 2R gives cos ψ = ⅔ and the ball peels off 48.2° before the top and
     falls through the middle of the loop. That is the picture this whole game
     exists to draw, and it is drawn from the reader's own number.
     ======================================================================== */

  function lpCosPsi(h, R, k, u) { return (2 * (h - R - u)) / (R * (3 + k)); }
  function lpHMin(R, k, u) { return (R * (5 + k)) / 2 + u; }
  function lpVTop2(h, R, k, u) { return (2 * G() * (h - 2 * R - u)) / (1 + k); }
  function lpNTop(m, h, R, k, u) { return m * (lpVTop2(h, R, k, u) / R - G()); }

  function lpMake(tier) {
    const g = G();
    // R stays at or above 0.18 m so that the "wrong body" candidate answer
    // (0.1R away) stays outside twice the grading tolerance and the detector
    // can fire without ever naming a mistake the reader may not have made.
    const R = rgPick(rgGrid(0.18, 0.40, 0.01));
    const m = rgPick(rgGrid(0.05, 0.40, 0.01));
    let k, rolling, eLoss = 0, u = 0;
    if (tier === 0) { k = 0; rolling = false; }
    else if (tier === 1) { k = 0.4; rolling = true; }
    else {
      rolling = Math.random() < 0.5;
      k = rolling ? 0.4 : 0;
      /* The friction tier has four candidate answers in play at once -- the
         truth, "it only has to reach the top", the other body's k, and "I forgot
         the friction" -- and for some values of E_loss two of them collide on
         the same number. A round where two named mistakes are indistinguishable
         cannot be graded honestly, so the loss is chosen from the values that
         keep all four apart rather than sampled and hoped over. */
      const kOther = rolling ? 0 : 0.4;
      const spread = (uu) => {
        const c = [lpHMin(R, k, uu), 2 * R + uu, lpHMin(R, kOther, uu), lpHMin(R, k, 0)];
        const tol = Math.max(0.008, c[0] * 0.012);
        let worst = Infinity;
        for (let i = 0; i < c.length; i++) {
          for (let j = i + 1; j < c.length; j++) worst = Math.min(worst, Math.abs(c[i] - c[j]));
        }
        return worst / tol;
      };
      let best = null, bestSpread = -1;
      rgShuffle(rgGrid(0.06, 0.30, 0.01)).forEach((uT) => {
        if (best !== null) return;
        const e = Math.max(0.005, rgR(uT * m * g, 3));
        const s = spread(e / (m * g));         // measured on the PRINTED joules
        if (s > 3) best = e;
        if (s > bestSpread) { bestSpread = s; if (best === null) eLoss = e; }
      });
      eLoss = best !== null ? best : eLoss;
      u = eLoss / (m * g);
    }

    const hMin = lpHMin(R, k, u);
    const body = rolling ? "solid sphere" : "bead";

    const givens = [
      { label: "Loop radius, R", value: R.toFixed(2) + " m", unit: "" },
      { label: "Mass, m", value: m.toFixed(2) + " kg", unit: "" },
    ];
    if (tier === 2) givens.push({ label: "Energy lost on the approach, E_loss", value: eLoss.toFixed(3) + " J", unit: "" });
    givens.push({ label: "g", value: g.toFixed(2) + " m/s²", unit: "" });

    const prompt = tier === 0
      ? "A bead threaded on a smooth wire is released from rest at height h and runs down into the vertical loop. "
        + "It slides — it does not rotate. What is the LOWEST release height from which it stays on the wire all "
        + "the way round?"
      : tier === 1
        ? "A solid sphere is released from rest at height h and rolls without slipping down into the vertical loop, "
          + "and round the inside of it. What is the LOWEST release height from which it stays on the track all "
          + "the way round?"
        : "A " + body + " is released from rest at height h. The approach ramp is rough and takes " + eLoss.toFixed(3)
          + " J out of it before it reaches the loop. The loop's own track grips well enough to keep "
          + "the body rolling but takes no further energy from it. "
          + (rolling ? "It rolls without slipping. " : "It slides without rotating. ")
          + "What is the LOWEST release height from which it stays on the track all the way round?";

    return {
      kind: "loop", tier, R, m, k, rolling, body, eLoss, u, hMin,
      tol: Math.max(0.008, hMin * 0.012),
      givens,
      inputs: [{ key: "h", label: "Minimum release height, h", unit: "m", step: "0.001" }],
      prompt,
      note: "The track can push inward but it cannot pull. Ask what the track is still doing at the worst point "
        + "of the loop, not merely whether the ball gets there.",
    };
  }

  /* --- loop the loop: grading ----------------------------------------------- */

  function lpGrade(r, answers) {
    const g = G();
    const gh = rgNum(answers && answers.h);
    if (!rgFin(gh)) return null;
    const d = gh - r.hMin;
    const correct = Math.abs(d) <= r.tol;

    // What the track does with the ball released from THEIR height.
    const hEff = gh - r.u;                       // the loop only ever sees this
    const cosPsi = lpCosPsi(gh, r.R, r.k, r.u);
    const makesIt = cosPsi >= 1;
    const reachesSide = hEff >= r.R;
    const psiDeg = reachesSide && !makesIt ? Math.acos(rgClamp(cosPsi, -1, 1)) * DEG : NaN;
    const nTop = makesIt ? lpNTop(r.m, gh, r.R, r.k, r.u) : NaN;
    const stallDeg = !reachesSide && hEff > 0
      ? Math.acos(rgClamp(1 - hEff / r.R, -1, 1)) * DEG                       // angle from the bottom
      : NaN;

    const kText = r.rolling ? "⅖ (solid sphere, k = 0.4)" : "0 (a sliding bead does not rotate)";
    const solution = [
      "At an angle ψ round from the TOP the track's push N is along the radius, inward, and gravity contributes",
      "g cos ψ along the same line:      N = m v²/R − m g cos ψ.   The track cannot pull, so N ≥ 0.",
      "The worst point is the top (ψ = 0), where the only thing available to bend the path is gravity itself:",
      "   minimum condition at the top:   m v_top²/R = m g   →   v_top² = gR   (not v_top = 0)",
      "Energy from release to the top, with k = I/mR² = " + kText + ":",
      "   m g h = m g(2R) + ½ m v_top²(1 + k)" + (r.u > 0 ? " + E_loss" : ""),
      "   h_min = 2R + (1+k)R/2" + (r.u > 0 ? " + E_loss/(mg)" : "") + " = R(5+k)/2"
        + (r.u > 0 ? " + E_loss/(mg)" : ""),
    ];
    if (r.u > 0) {
      solution.push(
        "   E_loss/(mg) = " + r.eLoss.toFixed(3) + "/(" + r.m.toFixed(2) + "×" + g.toFixed(2) + ") = "
          + r.u.toFixed(4) + " m  of extra height, bought back",
        "   h_min = " + ((5 + r.k) / 2).toFixed(1) + " × " + r.R.toFixed(2) + " + " + r.u.toFixed(4)
          + " = " + r.hMin.toFixed(4) + " m"
      );
    } else {
      solution.push("   h_min = " + ((5 + r.k) / 2).toFixed(1) + " × " + r.R.toFixed(2) + " = "
        + r.hMin.toFixed(4) + " m");
    }
    solution.push(
      "Release lower and N reaches zero BEFORE the top, at cos ψ = 2(h − R" + (r.u > 0 ? " − E_loss/mg" : "")
        + ")/(R(3+k)); the ball leaves the rails there and is a projectile from that instant.",
      "   h = 2R would give cos ψ = 2/3, ψ = 48.2°: it lets go well short of the top and falls through the middle.",
      "Release higher and it does go round, but N at the top climbs as 2mg(h − h_min)/(R(1+k)) — "
        + "and the question asked for the MINIMUM, not for a height that works."
    );

    let mis = null;
    if (!correct) {
      const justTop = 2 * r.R + r.u;                       // "it only has to reach the top"
      const otherK = r.k === 0 ? 0.4 : 0;
      const wrongBody = lpHMin(r.R, otherK, r.u);
      const noLoss = lpHMin(r.R, r.k, 0);
      const tight = Math.max(0.006, r.hMin * 0.02);
      if (Math.abs(justTop - r.hMin) > r.tol * 2 && rgNear(gh, justTop, tight)) {
        mis = {
          id: "just-reach-the-top",
          label: "Reaching the top is not staying on the track",
          detail: "h = 2R" + (r.u > 0 ? " + E_loss/mg" : "") + " is the height that gets the ball to the top with "
            + "v = 0. But a ball at the top of a loop moving slowly is not in circular motion at all — with no "
            + "speed there is nothing for the track to bend, N would have to be NEGATIVE to hold it on, and a "
            + "track cannot pull. It leaves the rails at ψ = " + (rgFin(psiDeg) ? psiDeg.toFixed(1) : "—")
            + "° before the top and falls through the middle of the loop. The top needs v_top² = gR, not zero.",
        };
      } else if (Math.abs(wrongBody - r.hMin) > r.tol * 2 && rgNear(gh, wrongBody, tight)) {
        mis = r.k === 0
          ? {
              id: "rotation-added-to-a-bead",
              label: "The bead does not rotate",
              detail: "2.7R is the rolling result: the 7/10 comes from a sphere having to spend ⅖·½mv² on spinning "
                + "as well as ½mv² on moving. A bead threaded on a wire slides, so all of the energy is "
                + "translational and the answer is 2.5R = " + r.hMin.toFixed(3) + " m.",
            }
          : {
              id: "rotation-left-out",
              label: "You used the bead's 2.5R",
              detail: "A rolling sphere carries ½Iω² as well as ½mv², and with I = ⅖mR² and v = ωR that is an "
                + "extra ⅕mv². So ½mv²(1+k) with k = 0.4, and h_min = R(5+0.4)/2 = 2.7R"
                + (r.u > 0 ? " + E_loss/(mg)" : "") + " = " + r.hMin.toFixed(3) + " m. Sliding gives 2.5R; "
                + "rolling always needs more height, because some of the energy never becomes speed.",
            };
      } else if (r.u > 0 && Math.abs(noLoss - r.hMin) > r.tol * 2 && rgNear(gh, noLoss, tight)) {
        mis = {
          id: "forgot-the-friction",
          label: "The ramp took its cut first",
          detail: "That is the frictionless answer, " + ((5 + r.k) / 2).toFixed(1) + "R = " + noLoss.toFixed(3)
            + " m. The approach removes " + r.eLoss.toFixed(3) + " J before the loop begins, which at mg = "
            + (r.m * g).toFixed(3) + " N is " + r.u.toFixed(3) + " m of height that has to be paid for at the "
            + "release point: h_min = " + ((5 + r.k) / 2).toFixed(1) + "R + E_loss/(mg).",
        };
      }
    }

    let verdict;
    if (correct) {
      verdict = { kind: "hit", text: "Round the loop with N = 0 at the top" };
    } else if (d < 0) {
      verdict = rgFin(psiDeg)
        ? { kind: "under", text: "It left the rails " + psiDeg.toFixed(0) + "° before the top" }
        : { kind: "under", text: "It never got past the side of the loop" };
    } else {
      verdict = rgFin(nTop)
        ? { kind: "over", text: "Needle reads " + nTop.toFixed(1) + " N at the top — not the minimum" }
        : { kind: "over", text: "Overshot the minimum by " + d.toFixed(3) + " m" };
    }

    const feedback = correct
      ? "Released from " + gh.toFixed(3) + " m the ball reaches the top with exactly v² = gR, the needle touches "
        + "zero, and it stays on the rails the whole way round."
      : d < 0
        ? (rgFin(psiDeg)
            ? "The normal force falls to zero " + psiDeg.toFixed(1) + "° short of the top and the ball leaves the "
              + "track there, crossing the inside of the loop as a projectile. It needed "
              + r.hMin.toFixed(3) + " m, which is " + Math.abs(d).toFixed(3) + " m more than you gave it."
            : "From " + gh.toFixed(3) + " m it only climbs "
              + (rgFin(stallDeg) ? stallDeg.toFixed(0) + "° round the loop" : "part-way up the first bend")
              + " and slides back down. The minimum is " + r.hMin.toFixed(3) + " m.")
        : "It goes round comfortably — too comfortably. At the top the track is still pressing with "
          + (rgFin(nTop) ? nTop.toFixed(2) : "—") + " N, so this is not the minimum. That is "
          + r.hMin.toFixed(3) + " m, " + Math.abs(d).toFixed(3) + " m lower than your answer.";

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : mis,
      solution,
      exact: { h: r.hMin, hMin: r.hMin, u: r.u, nTopAtMin: 0 },
      tolerance: { h: r.tol },
      guessH: gh, hEff, psiDeg, nTop, makesIt, reachesSide, stallDeg,
    };
  }

  /* --- loop the loop: animation and drawing ---------------------------------
     Nothing here is scripted. The ball is released from the reader's height and
     the same two equations that graded the answer decide, frame by frame,
     whether the track is still touching it. A reader who is 0.5R low does not
     see a caption saying so; they see the ball let go of the rails on the far
     side and cross the middle of the loop. */

  const LP_ALPHA = 34 * RAD;      // approach ramp; steep enough to be short
  const LP_RATE = 0.32;

  function lpGeom(r, hs) {
    const hh = Math.max(hs, 0.02);
    const rampLen = hh / Math.sin(LP_ALPHA);
    const flat = 0.10 + 0.35 * r.R;
    return { hh, rampLen, flat, S: rampLen + flat, run: hh / Math.tan(LP_ALPHA) };
  }

  /* The approach is integrated from the FORCE, not from the energy, for one
     reason: the ball is released from rest, and ds/dt = √(2g·drop/(1+k)) is
     exactly zero at the release point, so an energy-driven step would sit there
     for ever. The retarding force is E_loss spread evenly along the whole path,
     which is what makes the speed at the foot of the loop come out at precisely
     2g(h−u)/(1+k) with nothing left over for the loop to disagree about. */
  function lpApproachA(r, gm, s, vsign) {
    const f = r.eLoss / Math.max(gm.S, 1e-6);          // newtons, opposing motion
    // Gravity's pull along the path never reverses; only the friction does.
    const along = s < gm.rampLen ? G() * Math.sin(LP_ALPHA) : 0;
    return (along - (vsign * f) / Math.max(r.m, 1e-6)) / (1 + r.k);
  }
  function lpApproachY(gm, s) {
    return s < gm.rampLen ? gm.hh - s * Math.sin(LP_ALPHA) : 0;
  }

  function lpAnim(r, res) {
    const hs = res && rgFin(res.guessH) ? Math.max(res.guessH, 0.01) : r.hMin;
    return {
      game: "loop-coaster-game", t: 0, done: false, hold: 0,
      hs, gm: lpGeom(r, hs),
      hEff: hs - r.u,
      phase: "ramp", s: 0, v: 0, beta: 0, dir: 1, dist: 0,
      x: 0, y: 0, vx: 0, vy: 0,           // projectile / exit, world metres, y up
      // The track is pressing on the ball long before the loop starts; a needle
      // parked at zero and then leaping is a lie about a force.
      N: r.m * G() * Math.cos(LP_ALPHA), Nshown: r.m * G() * Math.cos(LP_ALPHA),
      nTop: NaN, psi: NaN, left: false, trail: [],
      // The reader has committed, so the target may be drawn; before that it is
      // a spoiler and is not.
      target: r.hMin,
    };
  }

  function lpLoopState(r, a, beta) {
    const g = G();
    const y = r.R * (1 - Math.cos(beta));
    const v2 = (2 * g * (a.hEff - y)) / (1 + r.k);
    const N = r.m * (Math.max(v2, 0) / r.R + g * Math.cos(beta));
    return { y, v2, N };
  }

  function lpStep(a, r, dt) {
    const g = G();
    let left = dt * LP_RATE;
    let guard = 0;
    while (left > 1e-6 && guard++ < 4000) {
      const s = Math.min(SUB, left); left -= s;

      if (a.phase === "ramp" || a.phase === "back") {
        /* The direction of travel is pinned per phase rather than read back off
           the velocity. Coulomb friction whose sign is taken from a velocity
           that is itself oscillating about zero chatters: the ball jitters in
           place for ever instead of stopping. Inbound it only ever moves
           forwards, outbound only ever backwards, and when v reaches zero on
           the flat there is nothing left to start it again. */
        const sc = rgClamp(a.s, 0, a.gm.S);
        const vs = a.phase === "back" ? -1 : 1;
        a.v += lpApproachA(r, a.gm, sc, vs) * s;
        a.s += a.v * s;
        a.dist += Math.abs(a.v) * s;
        // A release so low, or a ramp so lossy, that the ball never reaches the
        // loop is a legitimate outcome of a bad answer, not a bug to paper over.
        if (a.phase === "ramp" && a.v <= 0 && a.t > 0.05) { a.v = 0; a.phase = "backrest"; }
        if (a.phase === "ramp" && a.s >= a.gm.S) { a.s = a.gm.S; a.phase = "loop"; a.beta = 0; a.dir = 1; }
        if (a.phase === "back" && a.v >= 0) { a.v = 0; a.phase = "backrest"; }
        continue;
      }

      if (a.phase === "loop") {
        if (a.dir < 0 && a.beta <= 0) {
          a.beta = 0; a.phase = "back"; a.s = a.gm.S;
          a.v = -Math.sqrt(Math.max(lpLoopState(r, a, 0).v2, 0));
          continue;
        }
        const st = lpLoopState(r, a, a.beta);
        a.N = st.N;
        if (a.dir > 0 && a.beta > Math.PI / 2 && st.N <= 0) {
          // N has gone through zero: the track stops touching it here, and it
          // leaves tangentially at the speed it had. Nothing is teleported and
          // nothing is rounded off.
          const v = Math.sqrt(Math.max(st.v2, 0));
          a.left = true;
          a.psi = (Math.PI - a.beta) * DEG;
          a.x = r.R * Math.sin(a.beta);
          a.y = st.y;
          a.vx = v * Math.cos(a.beta);
          a.vy = v * Math.sin(a.beta);
          a.phase = "fly"; a.t = 0;
          continue;
        }
        if (st.v2 <= 0) {
          // Ran out of height on the lower half, where N never reaches zero and
          // the track is still holding it. It simply comes back down.
          a.dir = -1;
          a.beta = Math.max(0, a.beta - 0.003);
          continue;
        }
        const v = Math.sqrt(st.v2);
        a.beta += (a.dir * v * s) / r.R;
        a.dist += v * s;
        if (a.beta >= Math.PI && !rgFin(a.nTop)) a.nTop = lpLoopState(r, a, Math.PI).N;
        if (a.beta >= Math.PI * 2) {
          a.beta = Math.PI * 2;
          a.phase = "exit"; a.x = 0; a.y = 0; a.vy = 0;
          a.vx = Math.sqrt(Math.max(lpLoopState(r, a, 0).v2, 0));
        }
        continue;
      }

      if (a.phase === "fly") {
        a.vy -= g * s;
        a.x += a.vx * s;
        a.y += a.vy * s;
        if (a.y <= 0) { a.y = 0; a.phase = "settle"; }
        continue;
      }

      if (a.phase === "exit") {
        a.x += a.vx * s;
        a.dist += Math.abs(a.vx) * s;
        continue;
      }
      break;   // settle
    }

    /* The needle reads whatever the track is pushing with, phase by phase --
       mg cos α on the incline, mg on the flat, mv²/R − mg cos ψ round the loop,
       and nothing at all once the ball has let go. Entering the loop the
       curvature jumps from zero to 1/R and so does N, which is real physics and
       exactly why a built coaster uses a clothoid; the gauge is given the lag a
       real gauge has so the pointer sweeps rather than snaps. The plate still
       prints the undamped value. */
    if (a.phase === "loop") a.N = Math.max(lpLoopState(r, a, a.beta).N, 0);
    else if (a.phase === "fly") a.N = 0;
    else if (a.phase === "exit") a.N = r.m * g;
    else a.N = r.m * g * (a.s < a.gm.rampLen ? Math.cos(LP_ALPHA) : 1);
    a.Nshown += (a.N - a.Nshown) * (1 - Math.exp(-dt / 0.28));

    a.t += dt;
    if (a.phase === "settle" || a.phase === "backrest") { a.hold += dt; if (a.hold > 2.8) { a.done = true; return false; } }
    if (a.phase === "exit" && a.x > r.R * 3.2) { a.hold += dt; if (a.hold > 1.8) { a.done = true; return false; } }
    // A wildly high release makes a wildly long ramp. The reveal has said what
    // it has to say long before this, and the stage should not be held hostage.
    if (a.t > 15) { a.done = true; return false; }
    return true;
  }

  function lpDraw(ctx, w, h, r, res, a, P) {
    const showText = w > 430 && h > 250;
    const hs = a ? a.hs : r.hMin;
    const gm = a ? a.gm : lpGeom(r, hs);
    const groundY = h * 0.86;
    const vSpan = Math.max(hs, 2 * r.R, r.hMin, 0.05) * 1.10;
    const foot = gm.run + gm.flat + 2 * r.R;
    const scale = Math.max(4, Math.min((w * 0.80) / Math.max(foot, 0.05), (groundY - h * 0.12) / vSpan));
    const x0 = Math.max(w * 0.05, (w - foot * scale) / 2);
    const rampBotX = x0 + gm.run * scale;
    const loopX = rampBotX + gm.flat * scale;
    const Rpx = r.R * scale;
    const ballR = rgClamp(Rpx * 0.15, 3, 11);
    const W2S = (xm, ym) => [loopX + xm * scale, groundY - ym * scale];

    if (typeof drawGround === "function") drawGround(ctx, w, h, groundY);

    // the loop and the approach
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(loopX, groundY - Rpx, Rpx, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0, groundY - gm.hh * scale);
    ctx.lineTo(rampBotX, groundY);
    ctx.lineTo(loopX + Rpx * 2.6, groundY);
    ctx.stroke();
    ctx.restore();

    // the release height the reader chose, and where it belonged
    if (typeof drawDashedLine === "function") {
      const ry = groundY - gm.hh * scale;
      drawDashedLine(ctx, x0 - 10, ry, loopX + Rpx * 1.2, ry, P.brass, 1.2, [4, 4]);
      if (res && Math.abs(hs - r.hMin) > 1e-6) {
        const ty = groundY - r.hMin * scale;
        drawDashedLine(ctx, x0 - 10, ty, loopX + Rpx * 1.2, ty, P.forest, 1.4, [5, 3]);
        if (showText) drawLabel(ctx, loopX + Rpx * 1.3, ty, "h_min " + r.hMin.toFixed(3) + " m", P.forest, 10.5, "left");
      }
      if (showText) drawLabel(ctx, loopX + Rpx * 1.3, ry - 12,
        res ? "your h " + hs.toFixed(3) + " m" : "h — work it out", P.brass, 10.5, "left");
      // the top of the loop, the point the whole question is about
      drawDashedLine(ctx, loopX - Rpx * 1.25, groundY - 2 * Rpx, loopX + Rpx * 1.25, groundY - 2 * Rpx, P.inkSoft, 1, [2, 6]);
    }

    // where the ball is now
    let bx, by;
    if (!a || a.phase === "ramp" || a.phase === "back" || a.phase === "backrest") {
      const s = a ? rgClamp(a.s, 0, gm.S) : 0;
      if (s < gm.rampLen) {
        bx = x0 + s * Math.cos(LP_ALPHA) * scale;
        by = groundY - lpApproachY(gm, s) * scale;
      } else {
        bx = rampBotX + (s - gm.rampLen) * scale;
        by = groundY;
      }
      by -= ballR;
    } else if (a.phase === "loop") {
      // Riding the inside of the rail: pushed in toward the centre by its own
      // radius, which is also why the drawn ball never straddles the track.
      const yy = r.R * (1 - Math.cos(a.beta));
      bx = loopX + (r.R * Math.sin(a.beta)) * scale - Math.sin(a.beta) * ballR;
      by = groundY - yy * scale + Math.cos(a.beta) * ballR;
    } else if (a.phase === "exit") {
      bx = loopX + a.x * scale;
      by = groundY - ballR;
    } else {
      const pt = W2S(a.x, a.y);
      bx = pt[0]; by = pt[1] - ballR;
    }

    if (a && a.trail) {
      a.trail.push({ x: bx, y: by });
      if (a.trail.length > 46) a.trail.shift();
      if (typeof drawTrail === "function") drawTrail(ctx, a.trail, P.brass);
    }

    // the ball; its spin is its path length over its own radius, never a clock
    ctx.save();
    ctx.translate(bx, by);
    if (r.rolling && a) ctx.rotate((a.dist * scale) / Math.max(ballR, 1));
    ctx.fillStyle = P.panel; ctx.strokeStyle = P.crimson; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(0, 0, ballR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (r.rolling) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ballR * 0.9, 0); ctx.stroke(); }
    ctx.restore();

    // the departure point, marked where it happened
    if (a && a.left && rgFin(a.psi) && showText) {
      const bDep = Math.PI - a.psi * RAD;
      const dx = loopX + r.R * Math.sin(bDep) * scale;
      const dy = groundY - r.R * (1 - Math.cos(bDep)) * scale;
      ctx.save();
      ctx.strokeStyle = P.crimson; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(dx, dy, ballR + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      drawLabel(ctx, dx, dy - ballR - 15, "left the rails, ψ = " + a.psi.toFixed(0) + "°", P.crimson, 10.5);
    }

    lpNeedle(ctx, w, h, r, a, P, showText);

    if (showText && typeof drawDataPlate === "function") {
      const rows = ["R " + r.R.toFixed(2) + " m    m " + r.m.toFixed(2) + " kg",
                    r.rolling ? "solid sphere, k = 0.4" : "sliding bead, k = 0"];
      if (r.u > 0) rows.push("ramp loses " + r.eLoss.toFixed(3) + " J = " + r.u.toFixed(3) + " m");
      if (a) {
        rows.push("N now  " + (rgFin(a.N) ? a.N.toFixed(2) : "0.00") + " N");
        rows.push("N at top  " + (rgFin(a.nTop) ? a.nTop.toFixed(2) + " N" : a.left ? "never got there" : "—"));
      }
      drawDataPlate(ctx, w - 200, 10, 188, rows);
    }
    if (showText && typeof sideNameplate === "function") {
      sideNameplate(ctx, 12, h - 34, "Bench", "Loop the loop", P.crimson);
    }
  }

  /* The needle exists so that too HIGH fails as loudly as too low. A reader who
     answers 4R goes round the loop perfectly and would otherwise think they had
     won; instead the gauge slams against its stop and stays there. */
  function lpNeedle(ctx, w, h, r, a, P, showText) {
    if (!showText) return;
    const gx = 74, gy = 92, gr = 46;
    const full = Math.max(3 * r.m * G(), 1e-3);
    // Drawn from the lagged reading, so the pointer never jumps; the plate
    // beside it carries the instantaneous value.
    const N = a && rgFin(a.Nshown) ? a.Nshown : 0;
    const frac = rgClamp(N / full, 0, 1);
    const pegged = N >= full;

    ctx.save();
    ctx.fillStyle = P.panel; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(gx, gy, gr + 9, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(gx, gy, gr, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - gr - 9, gy); ctx.lineTo(gx + gr + 9, gy); ctx.stroke();
    for (let i = 0; i <= 6; i++) {
      const ang = Math.PI + (i / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(gx + Math.cos(ang) * (gr - 6), gy + Math.sin(ang) * (gr - 6));
      ctx.lineTo(gx + Math.cos(ang) * gr, gy + Math.sin(ang) * gr);
      ctx.stroke();
    }
    // the only reading that matters, marked in its own colour
    ctx.strokeStyle = P.forest; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(gx - gr - 4, gy); ctx.lineTo(gx - gr + 8, gy); ctx.stroke();
    ctx.strokeStyle = P.crimson; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(gx, gy, gr - 2, Math.PI * 1.86, Math.PI * 2); ctx.stroke();

    const nAng = Math.PI + frac * Math.PI;
    ctx.strokeStyle = pegged ? P.crimson : P.ink;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + Math.cos(nAng) * (gr - 7), gy + Math.sin(nAng) * (gr - 7));
    ctx.stroke();
    ctx.fillStyle = P.ink;
    ctx.beginPath(); ctx.arc(gx, gy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    drawLabel(ctx, gx, gy + 14, "N on the ball", P.inkSoft, 10);
    drawLabel(ctx, gx - gr, gy + 26, "0", P.forest, 10);
    drawLabel(ctx, gx + gr, gy + 26, pegged ? "PEGGED" : full.toFixed(1) + " N",
      pegged ? P.crimson : P.inkSoft, 10);
  }

  /* ==========================================================================
     the module contract
     ========================================================================== */

  const GAMES = {
    "rolling-race":       { make: rrMake, grade: rrGrade, anim: rrAnim, step: rrStep, draw: rrDraw },
    "explosion":          { make: exMake, grade: exGrade, anim: exAnim, step: exStep, draw: exDraw },
    "ballistic-pendulum": { make: bpMake, grade: bpGrade, anim: bpAnim, step: bpStep, draw: bpDraw },
    "loop-coaster-game":  { make: lpMake, grade: lpGrade, anim: lpAnim, step: lpStep, draw: lpDraw },
  };

  function entry(id) {
    for (let i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i];
    return null;
  }

  function view() {
    if (!cur) return null;
    return {
      id: cur.game,
      prompt: cur.prompt,
      note: cur.note,
      // Copied, not handed over: a host that sorts or annotates the array must
      // not be able to reach back into the round that is being graded.
      givens: cur.givens.map((g) => ({ label: g.label, value: g.value, unit: g.unit || "" })),
      inputs: cur.inputs.map((i) => (i.choices
        ? { key: i.key, label: i.label, choices: i.choices.map((c) => ({ value: c.value, label: c.label })) }
        : { key: i.key, label: i.label, unit: i.unit || "", step: i.step || "0.01" })),
    };
  }

  function blankResult(msg) {
    return {
      correct: false, blank: true,
      verdict: { kind: "miss", text: "Nothing entered" },
      feedback: msg || "Every box needs a number before you press Play. A blank field is not a wrong "
        + "answer — nothing has been let go, and the round is still yours.",
      misconception: null, solution: [], exact: {}, tolerance: {},
    };
  }

  function start(id, difficulty) {
    const g = entry(id);
    if (!g) return null;
    let tier = g.tiers.indexOf(difficulty);
    if (tier < 0 && typeof difficulty === "number") tier = Math.round(difficulty) - 1;
    if (!(tier >= 0 && tier <= 2)) tier = 0;
    reset();
    let made = null;
    try { made = GAMES[g.id].make(tier); } catch (err) { made = null; }
    if (!made) return null;
    made.game = g.id;
    made.tier = tier;
    made.tierName = g.tiers[tier];
    cur = made;
    return view();
  }

  function submit(answers) {
    if (!cur) return blankResult("No round in progress.");
    let res = null;
    // A grader returns null for "a box was empty or unreadable". It throws for
    // nothing else, but if it ever did, a lost round is a better failure than a
    // fabricated grade.
    try { res = GAMES[cur.game].grade(cur, answers || {}); } catch (err) { res = null; }
    if (!res) { result = null; anim = null; return blankResult(); }
    result = res;
    try { anim = GAMES[cur.game].anim(cur, res); } catch (err) { anim = null; }
    return result;
  }

  function play() {
    if (!cur || !result || result.blank) return false;
    try { anim = GAMES[cur.game].anim(cur, result); } catch (err) { anim = null; return false; }
    return true;
  }

  function tick(dt) {
    if (!anim || anim.done) return false;
    const step = Math.min(Math.max(Number(dt) || 0, 0), MAX_DT);
    if (step <= 0) return true;
    const g = GAMES[anim.game];
    if (!g || !cur) { anim = null; return false; }
    try { return g.step(anim, cur, step); }
    catch (err) { anim.done = true; return false; }
  }

  function animating() { return !!anim && !anim.done; }

  function drawEmpty(ctx, w, h, P) {
    ctx.strokeStyle = P.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    if (w > 300 && h > 160 && typeof drawLabel === "function") {
      drawLabel(ctx, w / 2, h / 2, "Choose a bench.", P.inkSoft, 12);
    }
  }

  function draw(ctx, w, h) {
    if (!ctx) return;
    const width = Number(w), height = Number(h);
    // 1×1 and 8×6 both happen: during layout, and on a hidden tab. Neither is
    // worth painting, and a helper that assumes room would throw in both.
    if (!(width > 12 && height > 12)) return;
    const P = PAL();
    if (!P) return;
    ctx.save();
    try {
      if (!cur || !GAMES[cur.game]) drawEmpty(ctx, width, height, P);
      else GAMES[cur.game].draw(ctx, width, height, cur, result, anim, P);
    } catch (err) {
      /* A renderer that fails must not take the frame loop with it. */
    } finally {
      // A throw mid-path would otherwise leave a clip, an alpha or a transform
      // on the context for whatever paints next.
      ctx.restore();
    }
  }

  function reset() { cur = null; result = null; anim = null; }

  return {
    list: () => CATALOGUE.map((g) => ({ id: g.id, name: g.name, blurb: g.blurb, group: g.group })),
    difficulties: (id) => {
      const g = entry(id);
      return (g ? g.tiers : CATALOGUE[0].tiers).slice();
    },
    start,
    round: view,
    submit,
    play,
    tick,
    animating,
    draw,
    reset,

    // --- accessors the host may want, none of which leak an unanswered round --
    phase: () => (!cur ? "idle" : result ? "graded" : "posed"),
    result: () => result,
    solution: () => (result ? result.solution : null),
  };
})();
