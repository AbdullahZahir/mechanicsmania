/* ============================================================================
   ramp games — three apparatus, one resolved force
   ----------------------------------------------------------------------------
   Atwood machine, friction board, banked curve. Different hardware, same
   demand: resolve the forces along the axis the motion actually uses, and
   commit to a number before anything is released.

   Three rules run through the whole file, and every awkward-looking decision
   below is one of them being obeyed.

   1. A round is BUILT BACKWARDS. The window the answer must land in is fixed
      first, and then one given — the drop height, the ramp length, the corner
      radius — is solved for and snapped to its display precision, after which
      the answer is recomputed from the SNAPPED number. Sampling givens and
      keeping whatever answer falls out is how a student ends up asked for a
      time of 0.07 s or a stopping distance of 14 m.

   2. The reveal is integrated from the READER'S number. The stopwatch is armed
      to the time they gave; the flag is planted at the distance they gave; the
      board takes the corner at the speed they gave. Nothing anywhere draws the
      true answer with an error bar on it.

   3. Every named misconception has to be PROVABLE. A wrong route is only
      reported if the number it lands on is more than three tolerances from the
      correct one — otherwise "you made this mistake" is a guess, and a guess
      is worse than saying nothing.

   Depends on animate.js for PALETTE and a handful of primitives, and on
   scenarios.js for the configured g. Load after both.
   ========================================================================== */

const RampGames = (function () {
  "use strict";

  /* --------------------------------------------------------------------------
     environment — read late, never captured
     ------------------------------------------------------------------------ */

  /* g belongs to the backend and arrives through /api/config, which can land
     after this file has parsed. `typeof` on a `let` that has not been evaluated
     yet THROWS rather than returning "undefined", so the try/catch here guards
     script ORDER, not a missing value: without it a tag placed above
     scenarios.js would take the whole module down. */
  function rgG() {
    try {
      if (typeof GRAVITY === "number" && Number.isFinite(GRAVITY) && GRAVITY > 0) return GRAVITY;
    } catch (err) { /* scenarios.js has not run yet */ }
    return 9.8;
  }

  function rgFont() {
    try { if (typeof FONT_LABEL === "string" && FONT_LABEL) return FONT_LABEL; }
    catch (err) { /* animate.js has not run yet */ }
    return '"IBM Plex Mono", Consolas, monospace';
  }

  /* animate.js fills PALETTE from resolved CSS custom properties. The object
     exists from the moment that file parses but can still be EMPTY if a draw
     lands before refreshPalette(); canvas silently ignores an undefined
     fillStyle, so the scene would come out invisible rather than throwing,
     which is far harder to diagnose than a missing scene. */
  const RG_DARK = {
    ink: "#e8e6e1", inkSoft: "#a4a8ad", paper: "#10151a", panel: "#1b2026",
    stage: "#10151a", rule: "#3d4751", crimson: "#d2504a", navy: "#5b9dd9",
    brass: "#c9a227", forest: "#6aa87a", shadow: "#2c343d",
  };
  function rgPal() {
    let P = null;
    try { if (typeof PALETTE !== "undefined" && PALETTE) P = PALETTE; }
    catch (err) { return null; }
    if (!P) return null;
    return P.ink ? P : RG_DARK;
  }

  /* --------------------------------------------------------------------------
     numeric odds and ends
     ------------------------------------------------------------------------ */

  const DEG = Math.PI / 180;

  function rgClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Every given goes through this before it is stored, so the number printed in
  // the table and the number the answer was derived from are the same number.
  // 0.1*3 = 0.30000000000000004 otherwise leaves the two quietly disagreeing.
  function rgR(v, dp) { const f = Math.pow(10, dp); return Math.round(v * f) / f; }

  function rgFmt(n, d) {
    if (n === undefined || n === null || !Number.isFinite(n)) return "—";
    return n.toFixed(d === undefined ? 2 : d);
  }

  function rgGrid(lo, hi, step) {
    const out = [];
    const n = Math.round((hi - lo) / step);
    for (let i = 0; i <= n; i++) out.push(rgR(lo + i * step, 6));
    return out;
  }

  function rgPick(list) { return list[Math.floor(Math.random() * list.length)]; }

  // The larger of two draws. Used where the whole range is legitimate but the
  // upper half of it is where the round teaches something; see the bank angle.
  function rgPickHigh(list) {
    const a = rgPick(list), b = rgPick(list);
    return a > b ? a : b;
  }

  // Readers type into text fields, so an answer arrives as a string, and on a
  // comma-decimal keyboard it arrives as "1,25". Anything that is not a finite
  // number is reported as a blank field and never graded as wrong.
  function rgNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    if (typeof v !== "string") return NaN;
    const s = v.trim().replace(",", ".");
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /* A named wrong route only earns a report if the number it lands on could not
     equally well be the correct answer rounded carelessly. Three tolerances is
     the floor; inside that, naming a mistake the reader may not have made is
     worse than naming none — and a detector that fires on a nearly-right answer
     masks every detector below it. */
  function rgRouteHit(guess, wrong, answer, tol) {
    if (!Number.isFinite(wrong) || !Number.isFinite(guess)) return false;
    if (!(wrong > 0)) return false;
    if (Math.abs(wrong - answer) <= 3 * tol) return false;
    return Math.abs(guess - wrong) <= Math.max(tol, Math.abs(wrong) * 0.015);
  }

  /* --------------------------------------------------------------------------
     catalogue and ladders
     ------------------------------------------------------------------------ */

  const RG_CATALOGUE = [
    {
      id: "atwood-game", name: "Atwood machine", group: "Rotation",
      blurb: "Two slotted masses over a pulley, a photogate at the bottom. Predict what the clock reads.",
    },
    {
      id: "friction-board", name: "The friction board", group: "Forces & Newton's laws",
      blurb: "A block runs off a hardwood ramp onto a hardwood floor. Plant the flag where it stops.",
    },
    {
      id: "banked-curve-game", name: "Banked curve", group: "Energy & circular motion",
      blurb: "Mr. J's skateboard takes a banked corner. Name the speed the bank was built for.",
    },
  ];

  const RG_LADDERS = {
    "atwood-game": ["Light pulley", "Massive pulley", "Find I yourself"],
    "friction-board": ["Frictionless ramp", "Same surface throughout", "Two surfaces"],
    "banked-curve-game": ["Angle given", "From the geometry", "With friction"],
  };

  const RG_IDS = RG_CATALOGUE.map((g) => g.id);

  // The host rebuilds its difficulty menu when the apparatus changes, and the
  // change fires before the new round exists. Matching by NAME first and by
  // POSITION second means a menu still holding the previous game's labels
  // degrades to the right rung instead of silently resetting to the easiest.
  function rgTier(gameId, difficulty) {
    if (typeof difficulty === "number" && Number.isFinite(difficulty)) {
      return rgClamp(Math.round(difficulty), 0, 2);
    }
    const want = String(difficulty === undefined || difficulty === null ? "" : difficulty).trim();
    if (!want) return 0;
    const own = RG_LADDERS[gameId];
    if (own) {
      const i = own.indexOf(want);
      if (i >= 0) return i;
    }
    for (const id of RG_IDS) {
      const j = RG_LADDERS[id].indexOf(want);
      if (j >= 0) return j;
    }
    const key = want.toLowerCase();
    if (key === "easy" || key === "1") return 0;
    if (key === "hard" || key === "3") return 2;
    if (key === "medium" || key === "2") return 1;
    return 0;
  }

  /* --------------------------------------------------------------------------
     module state
     ------------------------------------------------------------------------ */

  let round = null;       // the constructed round, carrying its exact answer
  let view = null;        // the display-safe projection handed to the host
  let result = null;      // the last grading
  let anim = null;        // reveal state, or null
  let lastGameId = RG_IDS[0];

  const RG_FIT_BOARD = "rampgames-board";
  const RG_FIT_BANK = "rampgames-bank";

  function rgClearFits() {
    if (typeof resetViewFit === "function") {
      resetViewFit(RG_FIT_BOARD);
      resetViewFit(RG_FIT_BANK);
    }
  }

  /* ==========================================================================
     GAME 1 — Atwood machine
     --------------------------------------------------------------------------
     The question is the TIME, not the acceleration, because time is what the
     photogate actually reports and because a wrong time is legible: the clock
     stops and the mass is visibly not where it should be. A wrong number in
     m/s^2 is only ever a wrong number.

         a = (m1 - m2) g / (m1 + m2 + I/R^2)          t = sqrt(2h/a)

     I/R^2 has units of kilograms and sits in the denominator beside the two
     masses, which is the whole reason the harder rungs exist: dropping it is a
     ONE-DIRECTIONAL error. It can only ever make the fall come out too fast,
     so an answer short by exactly that factor is diagnostic rather than merely
     wrong. For a uniform disc I = MR^2/2, so I/R^2 = M/2 and the radius
     cancels out of the answer entirely.
     ========================================================================== */

  const RG_ATWOOD_R = [0.025, 0.030, 0.035, 0.040, 0.045, 0.050];

  function rgAtwoodMake(tier) {
    const g = rgG();

    for (let attempt = 0; attempt < 600; attempt++) {
      const m1 = rgR(rgPick(rgGrid(0.20, 0.60, 0.01)), 2);
      const frac = rgPick(rgGrid(0.05, 0.40, 0.01));
      const m2 = rgR(m1 * (1 - frac), 3);
      // Everything below is computed from the ROUNDED masses, never from the
      // fraction that generated them.
      const S = m1 + m2;
      const D = m1 - m2;
      if (!(m2 >= 0.10)) continue;
      if (!(D >= 0.010)) continue;          // below the smallest slotted mass in the set
      // Checked on the ROUNDED masses, not on the fraction that generated them:
      // snapping m2 to a gram can carry it just outside the band it was drawn
      // from, and the band is a claim about the printed numbers.
      const gap = D / m1;
      if (!(gap >= 0.05 && gap <= 0.40)) continue;

      let I = 0, Rp = 0, Mp = 0, J = 0;
      if (tier >= 1) {
        Rp = rgPick(RG_ATWOOD_R);
        if (tier === 1) {
          I = rgR(rgPick(rgGrid(1.0, 6.0, 0.1)) * 1e-4, 9);
        } else {
          Mp = rgR(rgPick(rgGrid(0.10, 0.80, 0.05)), 2);
          I = 0.5 * Mp * Rp * Rp;
        }
        J = I / (Rp * Rp);
        // The pulley has to MATTER: below this the "forgot the pulley" answer
        // and the correct one are the same number to within tolerance, and the
        // round teaches nothing it could not have taught on the easy rung.
        if (!(J >= 0.15 * S)) continue;
        // ... and it must not swamp the masses, or the fall is a slow crawl and
        // the two hanging masses stop feeling like the driving term.
        if (!(J <= 1.6 * S)) continue;
      }

      const a = (D * g) / (S + J);
      if (!(a > 0.15 && a < 4.0)) continue;

      /* The answer window is fixed BEFORE the drop height is chosen. h is the
         given that steers the time; picking h at random and reporting whatever
         time fell out is how a round ends up asking for 0.31 s. */
      const tLo = Math.max(0.68, Math.sqrt((2 * 0.60) / a));
      const tHi = Math.min(2.40, Math.sqrt((2 * 1.20) / a));
      if (!(tHi > tLo + 0.08)) continue;
      const tWant = tLo + Math.random() * (tHi - tLo);
      const h = rgR(0.5 * a * tWant * tWant, 2);
      if (!(h >= 0.60 && h <= 1.20)) continue;

      // Recomputed from the SNAPPED height, so the printed given and the graded
      // answer agree to the last digit.
      const t = Math.sqrt((2 * h) / a);
      if (!(t >= 0.60 && t <= 2.50)) continue;

      const tol = Math.max(0.02 * t, 0.01);
      // If a happens to equal t numerically, a reader who worked out the
      // acceleration and forgot that the question asked for a time is marked
      // correct. Rare, but free to refuse.
      if (Math.abs(a - t) <= 3 * tol) continue;

      const R = {
        game: "atwood", gameId: "atwood-game", tier, g,
        m1, m2, S, D, h, I, Rp, Mp, J, a, t, tol,
        answerKey: "time",
      };

      // The wrong routes, evaluated once so the grader, the solution and the
      // separability guards all read the same numbers.
      R.wrong = {
        freefall: Math.sqrt((2 * h) / g),
        heavyOnly: Math.sqrt((2 * h) / ((D * g) / m1)),
        noInertia: tier >= 1 ? Math.sqrt((2 * h) / ((D * g) / S)) : NaN,
        wholeDisc: tier === 2 ? Math.sqrt((2 * h) / ((D * g) / (S + 2 * J))) : NaN,
        droppedTwo: Math.sqrt(h / a),
        sumOverDiff: Math.sqrt((2 * h) / ((S * g) / Math.max(D, 1e-9))),
      };

      // The pulley rung exists to catch exactly this, so refuse a round where
      // it could not be proved.
      if (tier >= 1 && !(Math.abs(R.wrong.noInertia - t) > 3 * tol)) continue;

      return R;
    }

    return rgAtwoodFallback(tier);
  }

  /* Worked by hand and checked, and reached only if the constructor somehow
     exhausts its attempts, so that start() can never hand back null. */
  function rgAtwoodFallback(tier) {
    const g = rgG();
    const m1 = 0.50, m2 = 0.375;
    const S = m1 + m2, D = m1 - m2;
    const Rp = 0.040;
    const I = tier >= 1 ? rgR(4.0e-4, 9) : 0;
    const Mp = tier === 2 ? 0.50 : 0;
    const J = tier === 0 ? 0 : (tier === 1 ? I / (Rp * Rp) : Mp / 2);
    const a = (D * g) / (S + J);
    const h = 1.00;
    const t = Math.sqrt((2 * h) / a);
    const tol = Math.max(0.02 * t, 0.01);
    const R = {
      game: "atwood", gameId: "atwood-game", tier, g,
      m1, m2, S, D, h,
      I: tier === 2 ? 0.5 * Mp * Rp * Rp : I,
      Rp: tier >= 1 ? Rp : 0, Mp, J, a, t, tol, answerKey: "time",
    };
    R.wrong = {
      freefall: Math.sqrt((2 * h) / g),
      heavyOnly: Math.sqrt((2 * h) / ((D * g) / m1)),
      noInertia: tier >= 1 ? Math.sqrt((2 * h) / ((D * g) / S)) : NaN,
      wholeDisc: tier === 2 ? Math.sqrt((2 * h) / ((D * g) / (S + 2 * J))) : NaN,
      droppedTwo: Math.sqrt(h / a),
      sumOverDiff: Math.sqrt((2 * h) / ((S * g) / D)),
    };
    return R;
  }

  function rgAtwoodView(R) {
    const givens = [
      { label: "Heavier mass, m₁ (falls)", value: rgFmt(R.m1, 3), unit: "kg" },
      { label: "Lighter mass, m₂ (rises)", value: rgFmt(R.m2, 3), unit: "kg" },
      { label: "Drop to the floor pad, h", value: rgFmt(R.h, 2), unit: "m" },
    ];
    if (R.tier === 0) {
      givens.push({ label: "Pulley", value: "light — take I as negligible", unit: "" });
    } else if (R.tier === 1) {
      givens.push({ label: "Pulley rotational inertia, I", value: rgFmt(R.I * 1e4, 1) + " × 10⁻⁴", unit: "kg·m²" });
      givens.push({ label: "Pulley rim radius, R", value: rgFmt(R.Rp, 3), unit: "m" });
    } else {
      givens.push({ label: "Pulley", value: "uniform disc", unit: "" });
      givens.push({ label: "Pulley mass, M", value: rgFmt(R.Mp, 2), unit: "kg" });
      givens.push({ label: "Pulley rim radius, R", value: rgFmt(R.Rp, 3), unit: "m" });
    }
    givens.push({ label: "g", value: rgFmt(R.g, 2), unit: "m/s²" });

    const prompt = R.tier === 0
      ? "The two slotted masses hang from a light string over a light pulley. The heavier one is released from rest and falls to the floor pad, tripping the photogate as it lands. How long does the photogate say the fall took?"
      : R.tier === 1
        ? "The two slotted masses hang from a string over a pulley that is NOT light — its rotational inertia is quoted below. The heavier one is released from rest and falls to the floor pad. How long does the photogate say the fall took?"
        : "The two slotted masses hang from a string over a pulley that is a uniform disc of the mass and radius below. The heavier one is released from rest and falls to the floor pad. How long does the photogate say the fall took?";

    const note = R.tier === 0
      ? "The string does not stretch, so both masses share one acceleration. The light side is being lifted — it is part of what the heavy side has to accelerate."
      : "The string does not slip on the rim, so a = αR. The pulley has to be spun up as well as the two masses moved, and its share of the inertia is I/R², in kilograms, sitting alongside m₁ + m₂.";

    return {
      id: "atwood-game", game: "atwood", difficulty: RG_LADDERS["atwood-game"][R.tier],
      prompt, note, givens,
      inputs: [{ key: "time", label: "Photogate reading", unit: "s", step: "0.001" }],
    };
  }

  function rgAtwoodSolution(R) {
    const lines = [];
    lines.push("One string, one acceleration. Write ΣF = ma for each mass and Στ = Iα for the pulley,");
    lines.push("then add them so the two tensions cancel:");
    lines.push("");
    lines.push("    a = (m₁ − m₂)·g / (m₁ + m₂ + I/R²)");
    lines.push("");
    if (R.tier === 0) {
      lines.push("I is negligible, so the pulley term is zero.");
    } else if (R.tier === 1) {
      lines.push("I/R² = " + (R.I * 1e4).toFixed(1) + "e-4 / (" + rgFmt(R.Rp, 3) + ")² = "
        + rgFmt(R.J, 4) + " kg");
    } else {
      lines.push("Uniform disc:  I = ½MR² = ½ · " + rgFmt(R.Mp, 2) + " · (" + rgFmt(R.Rp, 3) + ")² = "
        + (R.I * 1e4).toFixed(2) + "e-4 kg·m²");
      lines.push("so  I/R² = ½M = " + rgFmt(R.J, 4) + " kg  —  the radius cancels out completely.");
    }
    lines.push("");
    lines.push("    m₁ − m₂ = " + rgFmt(R.D, 3) + " kg      m₁ + m₂ + I/R² = " + rgFmt(R.S + R.J, 4) + " kg");
    lines.push("    a = " + rgFmt(R.D, 3) + " × " + rgFmt(R.g, 2) + " / " + rgFmt(R.S + R.J, 4)
      + " = " + rgFmt(R.a, 4) + " m/s²");
    lines.push("");
    lines.push("From rest through h with constant a:   h = ½at²   →   t = √(2h/a)");
    lines.push("    t = √(2 × " + rgFmt(R.h, 2) + " / " + rgFmt(R.a, 4) + ") = " + rgFmt(R.t, 4) + " s");
    lines.push("");
    lines.push("Also worth having: the fall lands at v = at = " + rgFmt(R.a * R.t, 3) + " m/s.");
    if (R.tier >= 1) {
      lines.push("");
      lines.push("Leave I/R² out and you get a = " + rgFmt((R.D * R.g) / R.S, 4) + " m/s² and t = "
        + rgFmt(R.wrong.noInertia, 4) + " s — always TOO FAST, never too slow, because the pulley");
      lines.push("can only ever add to the inertia being accelerated.");
    }
    return lines;
  }

  function rgAtwoodMisconception(R, guess) {
    const hit = (wrong) => rgRouteHit(guess, wrong, R.t, R.tol);
    const W = R.wrong;

    if (R.tier >= 1 && hit(W.noInertia)) {
      return {
        id: "ignored-pulley-inertia",
        label: "The pulley was left out of the inertia",
        detail: " Your time is √(2h/a) with a = (m₁−m₂)g/(m₁+m₂) — the pulley's I/R² = "
          + rgFmt(R.J, 4) + " kg is missing from the denominator. The string has to spin the pulley up as"
          + " well as move the masses, so leaving it out can only ever make the fall come out too fast."
          + " That is why this mistake is diagnosable: it is one-directional. With it, "
          + rgFmt(R.t, 3) + " s; without it, " + rgFmt(W.noInertia, 3) + " s.",
      };
    }
    if (R.tier === 2 && hit(W.wholeDisc)) {
      return {
        id: "disc-inertia-without-the-half",
        label: "A disc is ½MR², not MR²",
        detail: " You used I = MR², which is a hoop or a rim — all of its mass out at the radius."
          + " A uniform disc has its mass spread from the axle outwards, so I = ½MR² and I/R² = M/2 = "
          + rgFmt(R.J, 4) + " kg. Doubling the pulley's share makes the fall too slow: you gave "
          + rgFmt(guess, 3) + " s against " + rgFmt(R.t, 3) + " s.",
      };
    }
    if (hit(W.freefall)) {
      return {
        id: "acceleration-equals-g",
        label: "That is a free fall, and this is not one",
        detail: " √(2h/g) = " + rgFmt(W.freefall, 3) + " s is the time for a mass dropped with nothing"
          + " attached to it. Here the falling mass is dragging m₂ = " + rgFmt(R.m2, 3) + " kg UPWARDS"
          + " through the string, so only the difference in the two weights is left over to accelerate"
          + " everything. a = " + rgFmt(R.a, 3) + " m/s², not " + rgFmt(R.g, 2) + ".",
      };
    }
    if (hit(W.heavyOnly)) {
      return {
        id: "divided-by-the-falling-mass",
        label: "Divided by the wrong mass",
        detail: " (m₁−m₂)g/m₁ uses the net force on the system but only the falling mass's inertia."
          + " Everything on the string accelerates together, so the denominator is the WHOLE moving"
          + " inertia: m₁ + m₂" + (R.tier >= 1 ? " + I/R²" : "") + " = " + rgFmt(R.S + R.J, 4) + " kg.",
      };
    }
    if (hit(W.sumOverDiff)) {
      return {
        id: "ratio-inverted",
        label: "The mass ratio is upside down",
        detail: " You have (m₁+m₂) on top and (m₁−m₂) underneath, which gives a = "
          + rgFmt((R.S * R.g) / R.D, 1) + " m/s² — several times g, from two masses that are only"
          + " gently unbalanced. The DIFFERENCE in the weights is the net driving force; the SUM is"
          + " the inertia being driven. Any answer above g should stop you dead.",
      };
    }
    if (hit(W.droppedTwo)) {
      return {
        id: "lost-the-factor-of-two",
        label: "h = ½at², so t = √(2h/a)",
        detail: " Your number is √(h/a) — the ½ never made it across when you inverted the equation."
          + " That is always a factor of √2 = 1.414 too quick: " + rgFmt(W.droppedTwo, 3) + " s instead of "
          + rgFmt(R.t, 3) + " s.",
      };
    }
    // The acceleration and the time are both smallish numbers and can collide,
    // so this one only speaks when the two are far enough apart to be sure.
    if (rgRouteHit(guess, R.a, R.t, R.tol)) {
      return {
        id: "answered-the-acceleration",
        label: "That is the acceleration, not the time",
        detail: " a = " + rgFmt(R.a, 3) + " m/s² is right, and it is the hard half of the problem."
          + " The photogate reads a TIME: t = √(2h/a) = " + rgFmt(R.t, 3) + " s.",
      };
    }
    return null;
  }

  function rgAtwoodGrade(R, answers) {
    const raw = answers ? answers[R.answerKey] : undefined;
    const guess = rgNum(raw);
    if (!Number.isFinite(guess)) return rgBlank(R, rgAtwoodSolution(R));

    const delta = guess - R.t;
    const correct = Math.abs(delta) <= R.tol;

    // What the apparatus does is fixed by its own physics; what the READER'S
    // number changes is where the watch stops. Both consequences are computed
    // from their number, never from the truth.
    const fallenAtStop = Math.min(0.5 * R.a * guess * guess, R.h);
    const gapM = R.h - fallenAtStop;                  // still to fall when the watch clicks
    const overshootM = 0.5 * R.a * guess * guess - R.h; // extra drop their time would need
    const sat = Math.max(guess - R.t, 0);             // seconds the mass sat on the pad

    let verdict, feedback;
    if (correct) {
      verdict = { kind: "hit", text: "Stopped on the thump" };
      feedback = "The watch clicks on the landing. Exact " + rgFmt(R.t, 3) + " s; you gave "
        + rgFmt(guess, 3) + " s, inside the ±" + rgFmt(R.tol, 3) + " s the photogate can resolve.";
    } else if (delta < 0) {
      verdict = { kind: "under", text: "Watch stopped " + rgFmt(gapM * 100, 1) + " cm early" };
      feedback = "Too early. At " + rgFmt(guess, 3) + " s the mass is still "
        + rgFmt(gapM * 100, 1) + " cm above the pad — you overestimated the acceleration by "
        + rgFmt(((2 * R.h) / (guess * guess) / R.a - 1) * 100, 1) + "%. Exact time "
        + rgFmt(R.t, 3) + " s.";
    } else {
      verdict = { kind: "over", text: "Landed " + rgFmt(sat, 2) + " s before the watch" };
      feedback = "Too late. The mass thumps down at " + rgFmt(R.t, 3) + " s and sits there for "
        + rgFmt(sat, 2) + " s before your watch stops; your time would need "
        + rgFmt(overshootM * 100, 0) + " cm more drop than the stand has.";
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : rgAtwoodMisconception(R, guess),
      solution: rgAtwoodSolution(R),
      exact: { time: rgR(R.t, 4), acceleration: rgR(R.a, 4) },
      tolerance: { time: rgR(R.tol, 4) },
      guess, gapM, overshootM, sat,
    };
  }

  /* ==========================================================================
     GAME 2 — The friction board
     --------------------------------------------------------------------------
     Energy in one line, which is what makes the trap so clean:

         m g L sinθ  =  μ_ramp · m g cosθ · L  +  μ_floor · m g · d
         d = L(sinθ − μ_ramp·cosθ) / μ_floor

     The mass divides straight out, and it is given anyway — deliberately. The
     single most reliably missed line in the whole unit is the normal force on
     an incline: N = mg·cosθ, not mg. Using mg over-brakes the block on the
     ramp, so that mistake always UNDERSHOOTS, by a computable amount. Ignoring
     ramp friction always OVERSHOOTS. Every wrong route here is signed.
     ========================================================================== */

  function rgBoardMake(tier) {
    const g = rgG();

    for (let attempt = 0; attempt < 900; attempt++) {
      const thDeg = rgPick(rgGrid(20, 35, 1));
      const th = thDeg * DEG;
      const sn = Math.sin(th), cs = Math.cos(th), tn = sn / cs;

      let muR, muF, muS = null;
      if (tier === 0) {
        muR = 0;
        muF = rgR(rgPick(rgGrid(0.25, 0.45, 0.01)), 2);
      } else if (tier === 1) {
        muR = muF = rgR(rgPick(rgGrid(0.25, 0.45, 0.01)), 2);
      } else {
        muR = rgR(rgPick(rgGrid(0.25, 0.45, 0.01)), 2);
        muF = rgR(rgPick(rgGrid(0.25, 0.45, 0.01)), 2);
        muS = rgR(muF + rgPick(rgGrid(0.06, 0.15, 0.01)), 2);
        if (muS > 0.60) continue;
      }

      // Without this the block never leaves the release mark and the round is
      // unanswerable rather than hard.
      if (!(tn > muR + 0.04)) continue;
      const drive = sn - muR * cs;                 // net down-ramp acceleration, in units of g
      if (!(drive >= 0.06)) continue;              // ... and it has to move briskly enough to watch

      /* d = L·k with k fixed by the angle and the two coefficients, so L is the
         given that steers the answer into its window. Choosing L first and
         printing whatever distance fell out gives stopping distances of 12 cm
         or of 3 m on a floor with a two-metre tape on it. */
      const k = drive / muF;
      const LLo = Math.max(0.60, 0.45 / k);
      const LHi = Math.min(1.20, 1.45 / k);
      if (!(LHi > LLo + 0.02)) continue;
      const L = rgR(LLo + Math.random() * (LHi - LLo), 2);
      if (!(L >= 0.60 && L <= 1.20)) continue;

      const d = L * k;                              // recomputed from the snapped L
      if (!(d >= 0.40 && d <= 1.50)) continue;

      const tol = Math.max(0.02 * d, 0.01);

      // The mass is a red herring and is meant to be one, but a 2 kg block on a
      // 0.6 m board looks absurd, so keep it plausible for the apparatus.
      const mass = rgR(rgPick(rgGrid(0.20, 1.50, 0.05)), 2);

      const R = {
        game: "board", gameId: "friction-board", tier, g,
        thDeg, th, sn, cs, tn, muR, muF, muS, L, d, mass, tol,
        aRamp: g * drive,
        aFloor: g * muF,
        vCorner: Math.sqrt(2 * g * drive * L),
        answerKey: "d",
      };

      R.wrong = {
        noRampFriction: (L * sn) / muF,
        normalIsMg: tier >= 1 ? (L * (sn - muR)) / muF : NaN,
        staticFloor: muS ? (L * drive) / muS : NaN,
        noDivide: L * drive,
        timesMu: L * drive * muF,
        cosForSin: (L * (cs - muR * sn)) / muF,
        addedFriction: (L * (sn + muR * cs)) / muF,
        fromRelease: d + L * cs,
        tanForSin: (L * (tn - muR)) / muF,
      };

      // The normal-force error is the reason this game exists; refuse a round
      // where it lands too close to the right answer to be nameable. It is the
      // only detector given a construction-time veto.
      if (tier >= 1) {
        const sep = Math.abs(R.wrong.normalIsMg - d);
        if (!(R.wrong.normalIsMg > 0.05)) continue;
        if (!(sep > Math.max(3 * tol, 0.04))) continue;
      }
      if (tier === 2 && !(Math.abs(R.wrong.staticFloor - d) > 3 * tol)) continue;

      return R;
    }

    return rgBoardFallback(tier);
  }

  function rgBoardFallback(tier) {
    const g = rgG();
    const thDeg = 30, th = 30 * DEG;
    const sn = Math.sin(th), cs = Math.cos(th), tn = sn / cs;
    const muR = tier === 0 ? 0 : 0.30;
    const muF = 0.30;
    const muS = tier === 2 ? 0.42 : null;
    const L = tier === 0 ? 0.60 : 1.00;
    const drive = sn - muR * cs;
    const d = (L * drive) / muF;
    const tol = Math.max(0.02 * d, 0.01);
    const R = {
      game: "board", gameId: "friction-board", tier, g,
      thDeg, th, sn, cs, tn, muR, muF, muS, L, d, mass: 0.50, tol,
      aRamp: g * drive, aFloor: g * muF, vCorner: Math.sqrt(2 * g * drive * L),
      answerKey: "d",
    };
    R.wrong = {
      noRampFriction: (L * sn) / muF,
      normalIsMg: tier >= 1 ? (L * (sn - muR)) / muF : NaN,
      staticFloor: muS ? (L * drive) / muS : NaN,
      noDivide: L * drive,
      timesMu: L * drive * muF,
      cosForSin: (L * (cs - muR * sn)) / muF,
      addedFriction: (L * (sn + muR * cs)) / muF,
      fromRelease: d + L * cs,
      tanForSin: (L * (tn - muR)) / muF,
    };
    return R;
  }

  function rgBoardView(R) {
    const givens = [
      { label: "Ramp angle, θ", value: rgFmt(R.thDeg, 0), unit: "°" },
      { label: "Release mark, measured up the ramp, L", value: rgFmt(R.L, 2), unit: "m" },
      { label: "Block mass, m", value: rgFmt(R.mass, 2), unit: "kg" },
    ];
    if (R.tier === 0) {
      givens.push({ label: "Ramp surface", value: "polished — take μ as zero", unit: "" });
      givens.push({ label: "Floor, coefficient of kinetic friction", value: rgFmt(R.muF, 2), unit: "" });
    } else if (R.tier === 1) {
      givens.push({ label: "Both surfaces are the same hardwood, μ_k", value: rgFmt(R.muF, 2), unit: "" });
    } else {
      givens.push({ label: "Ramp, coefficient of kinetic friction", value: rgFmt(R.muR, 2), unit: "" });
      givens.push({ label: "Floor, coefficient of kinetic friction", value: rgFmt(R.muF, 2), unit: "" });
      givens.push({ label: "Floor, coefficient of static friction", value: rgFmt(R.muS, 2), unit: "" });
    }
    givens.push({ label: "g", value: rgFmt(R.g, 2), unit: "m/s²" });

    const prompt = "The block is released from rest at the mark " + rgFmt(R.L, 2)
      + " m up the ramp. It runs down, crosses onto the level floor at the foot, and slides to a stop."
      + (R.tier === 0
        ? " The ramp is polished smooth; the floor is not."
        : R.tier === 1
          ? " Ramp and floor are the same hardwood, so the same coefficient applies to both."
          : " The ramp and the floor are different materials, and the floor's table quotes both of its coefficients.")
      + " Measuring along the tape from the foot of the ramp, how far out does it stop?";

    const note = "Energy in, energy out: the drop m·g·L·sinθ is spent against friction on the ramp and"
      + " then against friction on the floor. Watch the normal force — it is not the same on the two"
      + " surfaces.";

    return {
      id: "friction-board", game: "board", difficulty: RG_LADDERS["friction-board"][R.tier],
      prompt, note, givens,
      inputs: [{ key: "d", label: "Stopping distance from the foot of the ramp", unit: "m", step: "0.001" }],
    };
  }

  function rgBoardSolution(R) {
    const lines = [];
    lines.push("Take the whole run at once. The block starts at rest and ends at rest, so all of the");
    lines.push("height it loses is spent against friction — first on the ramp, then on the floor.");
    lines.push("");
    lines.push("    m·g·L·sinθ  =  μ_ramp·(m·g·cosθ)·L  +  μ_floor·(m·g)·d");
    lines.push("");
    lines.push("Every term carries m·g, so it divides out and the " + rgFmt(R.mass, 2)
      + " kg is never used. Rearranged:");
    lines.push("");
    lines.push("    d = L(sinθ − μ_ramp·cosθ) / μ_floor");
    lines.push("");
    lines.push("    sin " + R.thDeg + "° = " + rgFmt(R.sn, 4) + "     cos " + R.thDeg + "° = " + rgFmt(R.cs, 4));
    if (R.tier === 0) {
      lines.push("    μ_ramp = 0, so the bracket is just sinθ.");
      lines.push("    d = " + rgFmt(R.L, 2) + " × " + rgFmt(R.sn, 4) + " / " + rgFmt(R.muF, 2)
        + " = " + rgFmt(R.d, 4) + " m");
    } else {
      lines.push("    sinθ − μ_ramp·cosθ = " + rgFmt(R.sn, 4) + " − " + rgFmt(R.muR, 2) + " × "
        + rgFmt(R.cs, 4) + " = " + rgFmt(R.sn - R.muR * R.cs, 4));
      lines.push("    d = " + rgFmt(R.L, 2) + " × " + rgFmt(R.sn - R.muR * R.cs, 4) + " / "
        + rgFmt(R.muF, 2) + " = " + rgFmt(R.d, 4) + " m");
    }
    lines.push("");
    lines.push("Cross-check with forces: down the ramp a = g(sinθ − μ_ramp·cosθ) = "
      + rgFmt(R.aRamp, 3) + " m/s², so it reaches the foot at");
    lines.push("v = √(2aL) = " + rgFmt(R.vCorner, 3) + " m/s; on the floor it decelerates at μ_floor·g = "
      + rgFmt(R.aFloor, 3) + " m/s²,");
    lines.push("and v²/(2a) = " + rgFmt(R.d, 4) + " m. Same number.");
    if (R.tier >= 1) {
      lines.push("");
      lines.push("The two traps, both signed:");
      lines.push("  · leave ramp friction out entirely → " + rgFmt(R.wrong.noRampFriction, 3)
        + " m, over by " + rgFmt(R.wrong.noRampFriction - R.d, 3) + " m"
        + (R.tier === 1 ? "  (= L·cosθ exactly, when the two surfaces match)" : ""));
      lines.push("  · use N = mg on the incline instead of mg·cosθ → " + rgFmt(R.wrong.normalIsMg, 3)
        + " m, under by " + rgFmt(R.d - R.wrong.normalIsMg, 3) + " m");
    }
    if (R.tier === 2) {
      lines.push("  · use the static coefficient on the floor → " + rgFmt(R.wrong.staticFloor, 3)
        + " m. The block is already sliding when it gets there, so μ_k governs the whole slide;");
      lines.push("    μ_s only decides whether it stays put once it has stopped.");
    }
    return lines;
  }

  function rgBoardMisconception(R, guess) {
    const hit = (wrong) => rgRouteHit(guess, wrong, R.d, R.tol);
    const W = R.wrong;

    // Ordered so the physics mistakes speak before the arithmetic ones, and the
    // normal force speaks before anything.
    if (R.tier >= 1 && hit(W.normalIsMg)) {
      return {
        id: "normal-force-is-mg-on-the-incline",
        label: "On the incline the normal force is mg·cosθ, not mg",
        detail: " Only the component of the weight PERPENDICULAR to the ramp is pressed into the"
          + " surface; the rest of it is what drives the block down. Using N = mg makes friction on"
          + " the ramp " + rgFmt(1 / R.cs, 3) + "× too strong, so the block reaches the foot too slow"
          + " and always stops SHORT: " + rgFmt(W.normalIsMg, 3) + " m instead of " + rgFmt(R.d, 3)
          + " m. On the level floor N really is mg — that is the difference the round is about.",
      };
    }
    if (R.tier >= 1 && hit(W.noRampFriction)) {
      const over = W.noRampFriction - R.d;
      return {
        id: "ignored-ramp-friction",
        label: "Friction on the ramp was never subtracted",
        detail: " " + rgFmt(W.noRampFriction, 3) + " m is L·sinθ/μ_floor — the whole drop delivered to"
          + " the floor with nothing lost on the way down. The ramp takes μ_ramp·mg·cosθ over its"
          + " length " + rgFmt(R.L, 2) + " m first, so you overshoot by exactly "
          + rgFmt(over, 3) + " m"
          + (R.tier === 1 ? ", which is L·cosθ — the horizontal reach of the ramp itself." : ".")
          + " This error is always over, never under.",
      };
    }
    if (R.tier === 2 && hit(W.staticFloor)) {
      return {
        id: "static-coefficient-for-kinetic",
        label: "μ_s was used where μ_k belonged",
        detail: " The block arrives at the foot already moving, so it is kinetic friction that slows"
          + " it the whole way: μ_k = " + rgFmt(R.muF, 2) + ". The static coefficient μ_s = "
          + rgFmt(R.muS, 2) + " only says how hard you would have to push to get it going again once"
          + " it has stopped. μ_s is the larger number, so using it always undershoots — "
          + rgFmt(W.staticFloor, 3) + " m instead of " + rgFmt(R.d, 3) + " m.",
      };
    }
    if (hit(W.addedFriction)) {
      return {
        id: "ramp-friction-added-not-subtracted",
        label: "The sign on the ramp friction is flipped",
        detail: " Friction on the way down opposes the motion, so it comes OFF the energy the block"
          + " arrives with: (sinθ − μ_ramp·cosθ), not (sinθ + μ_ramp·cosθ). Added instead of"
          + " subtracted it hands the floor more energy than the block ever had.",
      };
    }
    if (hit(W.cosForSin)) {
      return {
        id: "sine-and-cosine-swapped",
        label: "The height dropped is L·sinθ",
        detail: " sinθ is the vertical fall over a ramp length L; cosθ is the horizontal reach. Only"
          + " the fall does work against gravity, so the driving term is L·sinθ = "
          + rgFmt(R.L * R.sn, 3) + " m of drop. Swapped, you get " + rgFmt(W.cosForSin, 3) + " m.",
      };
    }
    if (hit(W.tanForSin)) {
      return {
        id: "divided-the-bracket-by-cos",
        label: "tanθ where sinθ belongs",
        detail: " Dividing the whole bracket by cosθ turns L·sinθ into L·tanθ. The energy delivered"
          + " is m·g·(L·sinθ) — the actual height lost — with no extra cosine anywhere.",
      };
    }
    if (hit(W.noDivide)) {
      return {
        id: "never-divided-by-mu-floor",
        label: "The floor's μ never made it into the division",
        detail: " " + rgFmt(W.noDivide, 3) + " m is the height the block dropped, in metres, not the"
          + " distance it slides. μ_floor·m·g·d must equal that energy, so d = "
          + rgFmt(R.L * (R.sn - R.muR * R.cs), 4) + " / " + rgFmt(R.muF, 2) + " = " + rgFmt(R.d, 3)
          + " m. A slippery floor gives a LONGER slide, so μ belongs underneath.",
      };
    }
    if (hit(W.timesMu)) {
      return {
        id: "multiplied-by-mu-floor",
        label: "Multiplied by μ_floor instead of dividing",
        detail: " μ_floor = " + rgFmt(R.muF, 2) + " is less than one, so multiplying makes the slide"
          + " shorter when a low coefficient should make it longer. Sanity check the direction before"
          + " the arithmetic: an icy floor sends the block further, not less far.",
      };
    }
    // At the same-surface rung "measured from the release point" and "ignored
    // ramp friction" land on the identical number (both are d + L·cosθ), so
    // this one may only speak where the two can be told apart.
    if (Math.abs(W.fromRelease - W.noRampFriction) > 3 * R.tol && hit(W.fromRelease)) {
      return {
        id: "measured-from-the-release-point",
        label: "Measured from the wrong end of the tape",
        detail: " Your number is the horizontal distance from where the block STARTED, up on the ramp."
          + " The tape is zeroed at the foot of the ramp, so the answer is the "
          + rgFmt(R.d, 3) + " m of floor alone; the ramp's own horizontal reach is L·cosθ = "
          + rgFmt(R.L * R.cs, 3) + " m.",
      };
    }
    return null;
  }

  function rgBoardGrade(R, answers) {
    const guess = rgNum(answers ? answers[R.answerKey] : undefined);
    if (!Number.isFinite(guess)) return rgBlank(R, rgBoardSolution(R));

    const delta = guess - R.d;
    const correct = Math.abs(delta) <= R.tol;
    const missCm = Math.abs(delta) * 100;

    let verdict, feedback;
    if (correct) {
      verdict = { kind: "hit", text: "Stopped at the flag" };
      feedback = "The block comes to rest beside the flag. Exact " + rgFmt(R.d, 3)
        + " m from the foot of the ramp; you gave " + rgFmt(guess, 3) + " m, inside ±"
        + rgFmt(R.tol, 3) + " m.";
    } else if (delta < 0) {
      verdict = { kind: "under", text: "Slid " + rgFmt(missCm, 0) + " cm past the flag" };
      feedback = "The block runs straight past your flag and stops " + rgFmt(missCm, 1)
        + " cm further out. Exact " + rgFmt(R.d, 3) + " m; you gave " + rgFmt(guess, 3) + " m.";
    } else {
      verdict = { kind: "over", text: "Stopped " + rgFmt(missCm, 0) + " cm short of the flag" };
      feedback = "The block gives up " + rgFmt(missCm, 1) + " cm short of your flag. Exact "
        + rgFmt(R.d, 3) + " m; you gave " + rgFmt(guess, 3) + " m.";
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : rgBoardMisconception(R, guess),
      solution: rgBoardSolution(R),
      exact: { d: rgR(R.d, 4), v_corner: rgR(R.vCorner, 4) },
      tolerance: { d: rgR(R.tol, 4) },
      guess,
    };
  }

  /* ==========================================================================
     GAME 3 — Banked curve
     --------------------------------------------------------------------------
     Drawn as a cross-section with a small top-down inset, because a perspective
     track on a 2D canvas reads as neither one thing nor the other, and the
     quantity the reader has to watch — how far UP the bank the rider is — is
     exactly what a cross-section shows to scale.

     Frictionless:  v = √(gR·tanθ).  With friction the corner holds a BAND of
     speeds, so the hard rung asks for the top of the band and says so:
         v_max = √(gR(tanθ+μ)/(1−μ·tanθ))

     The reveal integrates the drift along the bank. Writing the Lagrangian for
     a body on a cone in terms of the slope coordinate u and the azimuth φ, the
     azimuthal momentum m·r²·φ̇ is conserved (nothing here has a component round
     the axis: the surface normal lies in the r–z plane, gravity is vertical,
     and the lateral friction acts across the track, not along it). So

         r = R + u·cosθ        v_t = v₀·R/r        ü = (v_t²/r)·cosθ − g·sinθ + f/m

     which is the brief's a_bank with the radius allowed to change as the rider
     rides up. At u = 0 and f = 0 it is exactly (v²/R)cosθ − g·sinθ, zero when
     v² = gR·tanθ, and that is asserted in the numeric checks.
     ========================================================================== */

  const RG_BANK_UP = 6.0;      // metres of banking above the painted line, to the wall
  const RG_BANK_DOWN = 4.0;    // metres of banking below it, to the infield apron
  const RG_BANK_SPEEDUP = 2.0; // track seconds per wall-clock second, and it is labelled

  function rgBankMake(tier) {
    const g = rgG();

    for (let attempt = 0; attempt < 900; attempt++) {
      let thDeg, th, tn, rise = 0, run = 0, lap = 0;

      if (tier === 1) {
        // The angle is not given: it has to come out of a rise over a run, and
        // the radius out of a lap length. Both are snapped first and the truth
        // is then taken from the snapped pair, so the reader's arithmetic and
        // the grader's agree exactly.
        run = rgPick([4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 8.0]);
        const thWant = rgPickHigh(rgGrid(13, 31, 1)) * DEG;
        rise = rgR(run * Math.tan(thWant), 1);
        if (!(rise > 0.5)) continue;
        tn = rise / run;
        th = Math.atan(tn);
        thDeg = th / DEG;
        if (!(thDeg >= 12 && thDeg <= 32)) continue;
      } else {
        /* Weighted toward the steeper end of the range on the frictionless
           rungs. sinθ and tanθ converge as the bank flattens, so on a shallow
           corner the headline mistake — resolving along the slope — lands
           within a few per cent of the right answer and cannot honestly be
           named. Steep corners are also the ones that actually get banked. */
        thDeg = tier === 2 ? rgPick(rgGrid(12, 32, 1)) : rgPickHigh(rgGrid(12, 32, 1));
        th = thDeg * DEG;
        tn = Math.tan(th);
      }
      const sn = Math.sin(th), cs = Math.cos(th);

      const mu = tier === 2 ? rgR(rgPick(rgGrid(0.20, 0.60, 0.05)), 2) : 0;
      // The band only exists while the denominator stays healthily positive; at
      // these angles and coefficients it always does, but a round that squeaked
      // through with 1 − μtanθ near zero would report a v_max of 40 m/s.
      const denom = 1 - mu * tn;
      if (!(denom > 0.45)) continue;
      const factor = tier === 2 ? (tn + mu) / denom : tn;

      /* R is the given that steers the answer. Fix the speed window first, work
         back to the radius it needs, snap it to something a tape could give,
         and recompute. */
      const vLo = Math.max(7.0, Math.sqrt(g * 15 * factor));
      const vHi = Math.min(17.0, Math.sqrt(g * 60 * factor));
      if (!(vHi > vLo + 0.6)) continue;
      const vWant = vLo + Math.random() * (vHi - vLo);

      let Rr = (vWant * vWant) / (g * factor);
      if (tier === 1) {
        // At this rung the radius is only ever seen through the lap length, so
        // the lap length is what gets snapped.
        lap = Math.round(2 * Math.PI * Rr);
        Rr = lap / (2 * Math.PI);
      } else {
        Rr = rgR(Math.round(Rr), 0);
      }
      if (!(Rr >= 15 && Rr <= 60)) continue;

      const v = Math.sqrt(g * Rr * factor);
      if (!(v >= 7.0 && v <= 17.0)) continue;

      const vDesign = Math.sqrt(g * Rr * tn);                       // frictionless, all tiers
      const vMin = tier === 2 && tn > mu
        ? Math.sqrt((g * Rr * (tn - mu)) / (1 + mu * tn)) : 0;

      // 1.5% rather than 2%: a speed quoted to three figures deserves it, and
      // the looser figure swallows the sinθ-for-tanθ error over a wider band of
      // angles than this apparatus should be built at. See the veto below.
      const tol = Math.max(0.015 * v, 0.05);
      const mass = rgR(rgPick(rgGrid(55, 95, 5)), 0);               // rider + board, a red herring

      const R = {
        game: "bank", gameId: "banked-curve-game", tier, g,
        thDeg, th, sn, cs, tn, mu, Rr, lap, rise, run,
        v, vDesign, vMin, mass, tol, answerKey: "v",
      };

      const tanRad = Math.tan(thDeg);                               // θ typed into a calculator in radians
      R.wrong = {
        sinForTan: Math.sqrt(g * Rr * sn),
        sinCos: Math.sqrt(g * Rr * sn * cs),
        cotangent: tn > 1e-6 ? Math.sqrt((g * Rr) / tn) : NaN,
        squared: v * v,
        radians: tanRad > 0.02 ? Math.sqrt(g * Rr * tanRad) : NaN,
        frictionless: tier === 2 ? vDesign : NaN,
        vMin: tier === 2 && vMin > 0 ? vMin : NaN,
        noDenominator: tier === 2 ? Math.sqrt(g * Rr * (tn + mu)) : NaN,
        riseOverSlant: tier === 1 && rise < run
          ? Math.sqrt(g * Rr * Math.tan(Math.asin(rise / run))) : NaN,
        radiusFromPi: tier === 1 ? Math.sqrt(g * (lap / Math.PI) * tn) : NaN,
      };

      /* v_sin/v_tan = √cosθ, so on a shallow bank the sinθ-for-tanθ error is
         worth about one per cent and no honest tolerance can call it wrong.
         The bar here is only that it be GRADED wrong — the separate 3-tolerance
         rule in rgRouteHit decides whether it can also be NAMED. Demanding
         three tolerances at construction instead drove every frictionless
         round above 28°, which is not a range of banked corners, it is one
         corner. The floor this leaves is θ ≳ 14.5°. */
      if (!(Math.abs(R.wrong.sinForTan - v) > 1.2 * tol)) continue;
      if (tier === 2 && !(Math.abs(R.wrong.frictionless - v) > 3 * tol)) continue;

      return R;
    }

    return rgBankFallback(tier);
  }

  function rgBankFallback(tier) {
    const g = rgG();
    const thDeg = 24, th = 24 * DEG;
    const sn = Math.sin(th), cs = Math.cos(th), tn = sn / cs;
    const mu = tier === 2 ? 0.35 : 0;
    const Rr = tier === 1 ? 220 / (2 * Math.PI) : 32;
    const lap = tier === 1 ? 220 : 0;
    const rise = tier === 1 ? 2.2 : 0, run = tier === 1 ? 5.0 : 0;
    const factor = tier === 2 ? (tn + mu) / (1 - mu * tn) : tn;
    const v = Math.sqrt(g * Rr * factor);
    const vDesign = Math.sqrt(g * Rr * tn);
    const vMin = tier === 2 ? Math.sqrt((g * Rr * (tn - mu)) / (1 + mu * tn)) : 0;
    const tol = Math.max(0.015 * v, 0.05);
    const R = {
      game: "bank", gameId: "banked-curve-game", tier, g,
      thDeg: tier === 1 ? Math.atan(rise / run) / DEG : thDeg,
      th: tier === 1 ? Math.atan(rise / run) : th,
      sn, cs, tn, mu, Rr, lap, rise, run,
      v, vDesign, vMin, mass: 75, tol, answerKey: "v",
    };
    R.wrong = {
      sinForTan: Math.sqrt(g * Rr * sn),
      sinCos: Math.sqrt(g * Rr * sn * cs),
      cotangent: Math.sqrt((g * Rr) / tn),
      squared: v * v,
      radians: NaN,
      frictionless: tier === 2 ? vDesign : NaN,
      vMin: tier === 2 ? vMin : NaN,
      noDenominator: tier === 2 ? Math.sqrt(g * Rr * (tn + mu)) : NaN,
      riseOverSlant: NaN,
      radiusFromPi: NaN,
    };
    return R;
  }

  function rgBankView(R) {
    const givens = [];
    if (R.tier === 1) {
      givens.push({ label: "The bank rises", value: rgFmt(R.rise, 1), unit: "m" });
      givens.push({ label: "... across a horizontal width of", value: rgFmt(R.run, 1), unit: "m" });
      givens.push({ label: "One lap of the painted line measures", value: rgFmt(R.lap, 0), unit: "m" });
    } else {
      givens.push({ label: "Radius of the painted line, R", value: rgFmt(R.Rr, 0), unit: "m" });
      givens.push({ label: "Bank angle, θ", value: rgFmt(R.thDeg, 0), unit: "°" });
    }
    if (R.tier === 2) {
      givens.push({ label: "Coefficient of friction, board on track, μ", value: rgFmt(R.mu, 2), unit: "" });
    } else {
      givens.push({ label: "Track surface", value: "wet — take it as frictionless", unit: "" });
    }
    givens.push({ label: "Rider and board, m", value: rgFmt(R.mass, 0), unit: "kg" });
    givens.push({ label: "g", value: rgFmt(R.g, 2), unit: "m/s²" });

    const prompt = R.tier === 0
      ? "Mr. J takes the banked corner on his skateboard, holding the painted line at constant height on the bank. The track is wet enough to treat as frictionless, so the bank alone has to turn him. What speed is this corner built for?"
      : R.tier === 1
        ? "Mr. J takes the banked corner on his skateboard. Nobody has written the angle or the radius on the drawing — only the rise across the bank's width and the length of one lap of the painted line. The track is wet enough to treat as frictionless. What speed is this corner built for?"
        : "The track has dried out and the board now grips. Mr. J can hold the painted line over a whole range of speeds, because friction takes up the difference — but only up to a point. What is the HIGHEST speed the corner will hold before the board starts climbing the bank?";

    const note = R.tier === 2
      ? "Two forces on the board: the normal force perpendicular to the banking, and the weight. Friction is a third, and it can act either way along the slope, up to μN. At the top of the band it is fully used up pointing down the slope."
      : "Two forces on the board: the normal force perpendicular to the banking, and the weight. Nothing pushes the rider outwards. Resolve horizontally and vertically — not along the slope — and the mass cancels.";

    return {
      id: "banked-curve-game", game: "bank", difficulty: RG_LADDERS["banked-curve-game"][R.tier],
      prompt, note, givens,
      inputs: [{
        key: "v",
        label: R.tier === 2 ? "Highest speed the corner holds" : "Design speed of the corner",
        unit: "m/s", step: "0.01",
      }],
    };
  }

  function rgBankSolution(R) {
    const lines = [];
    if (R.tier === 1) {
      lines.push("Geometry first.");
      lines.push("    tanθ = rise / horizontal width = " + rgFmt(R.rise, 1) + " / " + rgFmt(R.run, 1)
        + " = " + rgFmt(R.tn, 4) + "   →   θ = " + rgFmt(R.thDeg, 2) + "°");
      lines.push("    lap = 2πR   →   R = " + rgFmt(R.lap, 0) + " / 2π = " + rgFmt(R.Rr, 3) + " m");
      lines.push("");
      lines.push("(The width is the HORIZONTAL run, so it is a tangent. Had it been the slope length");
      lines.push(" across the banking it would have been a sine, and the angle would come out bigger.)");
      lines.push("");
    }
    lines.push("Free body: the normal force N perpendicular to the banking, and the weight mg.");
    lines.push("That is all. The centripetal force is not a third arrow — it is the NAME of what the");
    lines.push("horizontal part of N is doing.");
    lines.push("");
    lines.push("    vertical:     N·cosθ " + (R.tier === 2 ? "− f·sinθ " : "") + "= mg");
    lines.push("    horizontal:   N·sinθ " + (R.tier === 2 ? "+ f·cosθ " : "") + "= m·v²/R");
    lines.push("");
    if (R.tier === 2) {
      lines.push("At the top of the band the board is on the point of climbing, so friction is fully used");
      lines.push("and points DOWN the slope: f = μN. Divide the two equations:");
      lines.push("");
      lines.push("    v_max = √( gR(tanθ + μ) / (1 − μ·tanθ) )");
      lines.push("          = √( " + rgFmt(R.g, 2) + " × " + rgFmt(R.Rr, 0) + " × ("
        + rgFmt(R.tn, 4) + " + " + rgFmt(R.mu, 2) + ") / (1 − " + rgFmt(R.mu, 2) + " × "
        + rgFmt(R.tn, 4) + ") )");
      lines.push("          = " + rgFmt(R.v, 4) + " m/s");
      lines.push("");
      lines.push(R.vMin > 0
        ? "The corner holds anything between v_min = " + rgFmt(R.vMin, 3) + " m/s and that."
        : "There is no lower limit here: tanθ ≤ μ, so friction alone holds the board even at rest, "
          + "and v_min = √(gR(tanθ−μ)/(1+μ·tanθ)) would ask for the root of a negative number. "
          + "That is a change of regime, not a value.");
      lines.push("The frictionless design speed √(gR·tanθ) = " + rgFmt(R.vDesign, 3)
        + " m/s sits inside the band — it is the");
      lines.push("one speed that needs no friction at all, not the fastest the corner will take.");
    } else {
      lines.push("Divide the second by the first and everything but the geometry disappears:");
      lines.push("");
      lines.push("    tanθ = v² / (gR)      →      v = √(gR·tanθ)");
      lines.push("          = √(" + rgFmt(R.g, 2) + " × " + rgFmt(R.Rr, R.tier === 1 ? 3 : 0)
        + " × " + rgFmt(R.tn, 4) + ") = " + rgFmt(R.v, 4) + " m/s");
      lines.push("");
      lines.push("The " + rgFmt(R.mass, 0) + " kg cancelled — a heavier rider needs exactly the same speed.");
      lines.push("Resolve along the slope instead of horizontally and you get √(gR·sinθ) = "
        + rgFmt(R.wrong.sinForTan, 3) + " m/s,");
      lines.push("which is always too low, because sinθ < tanθ for every angle a track is ever built at.");
    }
    lines.push("");
    lines.push("Off the design speed the leftover acceleration along the banking is");
    lines.push("    a_bank = (v²/R)·cosθ − g·sinθ" + (R.tier === 2 ? " ∓ μN/m" : ""));
    lines.push("which is zero at v = √(gR·tanθ) and drives the rider up or down the bank otherwise.");
    return lines;
  }

  function rgBankMisconception(R, guess) {
    const hit = (wrong) => rgRouteHit(guess, wrong, R.v, R.tol);
    const W = R.wrong;

    if (R.tier === 2 && hit(W.frictionless)) {
      return {
        id: "ignored-the-friction",
        label: "That is the frictionless design speed, not the maximum",
        detail: " √(gR·tanθ) = " + rgFmt(R.vDesign, 3) + " m/s is the one speed at which the bank needs"
          + " NO friction at all. With μ = " + rgFmt(R.mu, 2) + " available, friction can point down the"
          + " slope and hold the rider on for a good deal more: up to " + rgFmt(R.v, 3)
          + " m/s. The question asked for the top of the band.",
      };
    }
    if (R.tier === 2 && hit(W.vMin)) {
      return {
        id: "answered-the-bottom-of-the-band",
        label: "That is v_min — the other end of the band",
        detail: " √(gR(tanθ−μ)/(1+μ·tanθ)) = " + rgFmt(R.vMin, 3) + " m/s is the SLOWEST the corner"
          + " holds, with friction straining up the slope to stop the rider sliding into the infield."
          + " The signs flip for the fastest: μ goes to +, the denominator to (1 − μ·tanθ), giving "
          + rgFmt(R.v, 3) + " m/s.",
      };
    }
    if (R.tier === 2 && hit(W.noDenominator)) {
      return {
        id: "lost-the-denominator",
        label: "The (1 − μ·tanθ) underneath went missing",
        detail: " Friction pointing down the slope has a vertical component too, so it eats into what"
          + " holds the rider up: N·cosθ − f·sinθ = mg. That is where the denominator comes from."
          + " Dropping it costs " + rgFmt(R.v - W.noDenominator, 2) + " m/s here.",
      };
    }
    if (hit(W.sinForTan)) {
      return {
        id: "sine-where-tangent-belongs",
        label: "Resolved along the slope instead of horizontally",
        detail: " √(gR·sinθ) comes from setting mg·sinθ = mv²/R — treating the centripetal force as if"
          + " it pointed along the banking. It does not: the acceleration is HORIZONTAL, aimed at the"
          + " centre of the corner, while the slope tilts up out of that plane. Resolve into"
          + " horizontal and vertical, divide, and the tangent appears. sinθ < tanθ always, so this"
          + " answer is always too slow and the rider always slides in.",
      };
    }
    if (Math.abs(W.sinCos - W.sinForTan) > 3 * R.tol && hit(W.sinCos)) {
      return {
        id: "normal-force-taken-as-mg-cos",
        label: "N is not mg·cosθ here",
        detail: " √(gR·sinθcosθ) comes from taking N = mg·cosθ, which is the static result for a block"
          + " resting on a slope. This rider is accelerating, and the acceleration has a component"
          + " into the surface, so N = mg/cosθ — larger than the weight, not smaller.",
      };
    }
    if (R.tier === 1 && hit(W.riseOverSlant)) {
      return {
        id: "rise-over-slope-length",
        label: "The width quoted is the horizontal run",
        detail: " Rise over horizontal run is a TANGENT: tanθ = " + rgFmt(R.rise, 1) + "/"
          + rgFmt(R.run, 1) + " = " + rgFmt(R.tn, 4) + " → " + rgFmt(R.thDeg, 2)
          + "°. Treating " + rgFmt(R.run, 1) + " m as the distance measured up the slope makes it a"
          + " sine and steepens the angle, which raises the speed.",
      };
    }
    if (R.tier === 1 && hit(W.radiusFromPi)) {
      return {
        id: "circumference-missing-the-two",
        label: "A lap is 2πR, not πR",
        detail: " πR is the length of a HALF lap. R = " + rgFmt(R.lap, 0) + "/2π = "
          + rgFmt(R.Rr, 2) + " m; you used " + rgFmt(R.lap / Math.PI, 2)
          + " m, which doubles the radius and multiplies the speed by √2.",
      };
    }
    if (hit(W.cotangent)) {
      return {
        id: "tangent-inverted",
        label: "The tangent is the wrong way up",
        detail: " tanθ = v²/(gR), so v² = gR·tanθ. You have gR/tanθ. A SHALLOWER bank must be taken"
          + " more slowly, not faster — that direction check catches this one in a second.",
      };
    }
    if (hit(W.squared)) {
      return {
        id: "answered-v-squared",
        label: "That is v², one square root short",
        detail: " gR·" + (R.tier === 2 ? "(tanθ+μ)/(1−μtanθ)" : "tanθ") + " = " + rgFmt(W.squared, 2)
          + " m²/s² is a speed SQUARED. Take the root: " + rgFmt(R.v, 3) + " m/s. The units are the"
          + " give-away — m²/s² is not a speed.",
      };
    }
    if (hit(W.radians)) {
      return {
        id: "calculator-left-in-radians",
        label: "The calculator was in radians",
        detail: " tan(" + rgFmt(R.thDeg, 0) + " rad) = " + rgFmt(Math.tan(R.thDeg), 3) + ", not tan("
          + rgFmt(R.thDeg, 0) + "°) = " + rgFmt(R.tn, 4) + ". Every angle in this unit is in degrees.",
      };
    }
    return null;
  }

  function rgBankGrade(R, answers) {
    const guess = rgNum(answers ? answers[R.answerKey] : undefined);
    if (!Number.isFinite(guess)) return rgBlank(R, rgBankSolution(R));

    const delta = guess - R.v;
    const correct = Math.abs(delta) <= R.tol;
    const vg = Math.max(guess, 0.01);

    // Grip demanded at the painted line, as a fraction of what is available.
    const need = Math.abs(R.g * R.sn - ((vg * vg) / R.Rr) * R.cs);
    const have = R.mu * (((vg * vg) / R.Rr) * R.sn + R.g * R.cs);
    const grip = R.mu > 0 && have > 0 ? need / have : Infinity;

    /* Where the reader's speed actually settles, worked from their number.
       Setting the drift acceleration to zero with v_t = v₀R/r gives
       r_eq = R·(v/v_ref)^(2/3) — and the SAME algebra with friction saturated
       gives the same form with v_ref = v_max. So the reference is whichever
       speed the surface is on the verge at: the design speed with no friction,
       and the near or far edge of the band with it. Between the two edges the
       board does not move at all, and r_eq is simply R. */
    let vRef = R.vDesign;
    if (R.mu > 0) {
      if (grip <= 1.0) vRef = vg;                    // inside the band: held at the line
      else vRef = vg > R.vDesign ? R.v : (R.vMin > 0 ? R.vMin : R.vDesign);
    }
    const k = Math.pow(vg / Math.max(vRef, 1e-6), 2);
    const rEq = R.Rr * Math.pow(k, 1 / 3);
    const uEq = (rEq - R.Rr) / R.cs;

    /* Where it actually FETCHES UP, which is not where it balances. Released at
       rest on the painted line, the board runs straight past the balance radius
       and only turns where the work done along the slope comes back to zero:

           ∫ [A/r³ − B] dr = 0  from R to r_turn,   A/B = r_eq³

       which reduces to 2x² − kx − k = 0 with x = r_turn/R and k = (v/v_ref)².
       The same algebra holds with friction saturated — only v_ref changes — and
       the turning point lands at roughly twice u_eq, so a verdict quoting the
       balance line would say "climbs 3.0 m" about a board that has just gone
       over a wall 6 m up. Checked against the integrator: they agree to 5 mm. */
    const xTurn = (k + Math.sqrt(k * k + 8 * k)) / 4;
    const uTurn = (R.Rr * xTurn - R.Rr) / R.cs;
    const offWall = uTurn > RG_BANK_UP;
    const offInfield = uTurn < -RG_BANK_DOWN;

    let verdict, feedback;
    if (correct) {
      verdict = { kind: "hit", text: "Tracks the painted line" };
      feedback = R.tier === 2
        ? "Held, and only just — friction is exactly used up at that speed, which is what makes it the maximum. Exact "
          + rgFmt(R.v, 3) + " m/s; you gave " + rgFmt(guess, 3) + " m/s."
        : "The board holds the painted line at constant height, all the way round. Exact "
          + rgFmt(R.v, 3) + " m/s; you gave " + rgFmt(guess, 3) + " m/s (±" + rgFmt(R.tol, 2) + ").";
    } else if (delta > 0) {
      verdict = {
        kind: "over",
        text: offWall ? "Over the outside wall"
          : "Climbs " + rgFmt(uTurn, 1) + " m up the bank",
      };
      feedback = "Too fast by " + rgFmt(delta, 2) + " m/s. The board rides up the banking looking for"
        + " the radius that speed does hold — " + rgFmt(rEq, 1) + " m instead of " + rgFmt(R.Rr, 1)
        + " m — and, having started at rest across the slope, overshoots it and fetches up "
        + rgFmt(uTurn, 2) + " m up"
        + (offWall ? ". The wall is only " + rgFmt(RG_BANK_UP, 1) + " m up: it goes over." : ".")
        + " Exact " + rgFmt(R.v, 3) + " m/s.";
    } else if (R.tier === 2 && grip <= 1.0) {
      // Below v_max but still inside the band: the corner holds it, so the
      // failure is not a slide, it is having stopped short of the maximum.
      verdict = { kind: "under", text: "Held — only " + rgFmt(grip * 100, 0) + "% of the grip used" };
      feedback = "The corner holds that speed comfortably: it only calls on "
        + rgFmt(grip * 100, 0) + "% of the friction available, so it is not the highest speed the bank"
        + " will take. The board can go " + rgFmt(-delta, 2) + " m/s faster before it starts to climb."
        + " Exact " + rgFmt(R.v, 3) + " m/s.";
    } else {
      verdict = {
        kind: "under",
        text: offInfield ? "Off the bank into the infield"
          : "Slides " + rgFmt(Math.abs(uTurn), 1) + " m down the bank",
      };
      feedback = "Too slow by " + rgFmt(-delta, 2) + " m/s. The bank cannot turn the board that gently,"
        + " so it slides down toward the infield: it would balance at a radius of " + rgFmt(rEq, 1)
        + " m, " + rgFmt(Math.abs(uEq), 2) + " m down the slope, and runs on past that to "
        + rgFmt(Math.abs(uTurn), 2) + " m"
        + (offInfield ? " — but the banking runs out " + rgFmt(RG_BANK_DOWN, 1) + " m down." : ".")
        + " Exact " + rgFmt(R.v, 3) + " m/s.";
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : rgBankMisconception(R, guess),
      solution: rgBankSolution(R),
      exact: { v: rgR(R.v, 4), v_design: rgR(R.vDesign, 4) },
      tolerance: { v: rgR(R.tol, 4) },
      guess, uEq, uTurn, rEq, grip,
    };
  }

  /* ==========================================================================
     shared grading scaffolding
     ========================================================================== */

  // A blank field is not a wrong answer: the round is not lost, nothing is
  // released, and the reader can fill it in. It still carries a verdict,
  // because the host prints one on every result it is handed.
  function rgBlank(R, solution) {
    return {
      correct: false, blank: true,
      verdict: { kind: "miss", text: "Nothing entered" },
      feedback: "Enter a number before you press Play.",
      misconception: null,
      solution: solution || [],
      exact: {}, tolerance: {},
    };
  }

  /* ==========================================================================
     drawing helpers, local
     --------------------------------------------------------------------------
     These are deliberately not animate.js's: drawDataPlate takes flat strings
     in one place in that file and label/value pairs in another, and this file
     is not the one to settle that argument.
     ========================================================================== */

  function rgText(ctx, x, y, text, colour, size, align, weight) {
    ctx.save();
    ctx.fillStyle = colour;
    ctx.font = (weight || 500) + " " + Math.max(size, 1) + "px " + rgFont();
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text), x, y);
    ctx.restore();
  }

  function rgArrow(ctx, x1, y1, x2, y2, colour, width) {
    if (typeof drawArrow === "function") { drawArrow(ctx, x1, y1, x2, y2, colour, width || 2); return; }
    ctx.save();
    ctx.strokeStyle = colour; ctx.lineWidth = width || 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function rgDash(ctx, x1, y1, x2, y2, colour, width, dash) {
    ctx.save();
    ctx.setLineDash(dash || [4, 4]);
    ctx.strokeStyle = colour; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function rgRoundRect(ctx, x, y, w, h, r) {
    if (typeof roundRectPath === "function") { roundRectPath(ctx, x, y, w, h, r); return; }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // A ruled instrument card: label left, value right, the way the readouts on
  // the rest of the app are set.
  function rgPlate(ctx, P, x, y, w, rows) {
    if (!rows.length || w < 60) return 0;
    const lineH = 15, pad = 7;
    const h = pad * 2 + rows.length * lineH;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = P.panel;
    rgRoundRect(ctx, x, y, w, h, 3); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
    rgRoundRect(ctx, x, y, w, h, 3); ctx.stroke();
    ctx.restore();
    rows.forEach((r, i) => {
      const ty = y + pad + lineH * i + lineH / 2 - 1;
      rgText(ctx, x + 8, ty, r[0], P.inkSoft, 10, "left", 400);
      rgText(ctx, x + w - 8, ty, r[1], r[2] || P.ink, 10.5, "right", 600);
    });
    return h;
  }

  // Bounded by the canvas rather than by a fixed span: an unbounded loop here
  // costs five hundred stroked paths a frame on a phone-sized pane.
  function rgHatch(ctx, colour, alpha, step, w, h) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    const s = Math.max(step || 8, 4);
    for (let d = -h; d < w + h; d += s) {
      ctx.beginPath();
      ctx.moveTo(d, h);
      ctx.lineTo(d + h, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  function rgTag(ctx, P, x, y, kind, name) {
    if (typeof sideNameplate === "function") { sideNameplate(ctx, x, y, kind, name, P.crimson); return; }
    rgText(ctx, x, y + 12, kind + ": " + name, P.crimson, 11, "left");
  }

  /* The board's own nameplate rather than animate.js's, which paints its
     backing with PALETTE.stage — a key refreshPalette() does not fill, so the
     plate comes out with whatever fill happened to be current. */
  function rgBoardTag(ctx, P, x, y, text) {
    ctx.save();
    ctx.font = "600 10px " + rgFont();
    const bw = ctx.measureText(text).width + 12;
    ctx.fillStyle = P.paper;
    ctx.globalAlpha = 0.9;
    rgRoundRect(ctx, x - bw / 2, y - 18, bw, 16, 3); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.crimson; ctx.lineWidth = 1;
    rgRoundRect(ctx, x - bw / 2, y - 18, bw, 16, 3); ctx.stroke();
    ctx.restore();
    rgText(ctx, x, y - 10, text, P.crimson, 10, "center", 600);
  }

  /* ==========================================================================
     reveal — Atwood
     ========================================================================== */

  function rgAtwoodPlay(R, res) {
    // The watch is armed to the reader's number. A wild answer would otherwise
    // leave the scene frozen for a minute of real time, so the RUN is capped —
    // the reported gap is still worked from their actual number, uncapped.
    const tStop = rgAtwoodStopAt(res, R);
    return {
      kind: "atwood",
      t: 0,
      tStop,
      clamped: res.guess > tStop + 1e-9,
      hold: 0,
      done: false,
    };
  }

  function rgAtwoodStep(A, R, dt) {
    if (A.t < A.tStop) {
      A.t = Math.min(A.t + dt, A.tStop);
      return true;
    }
    A.hold += dt;
    if (A.hold >= 2.6) { A.done = true; return false; }
    return true;
  }

  // The moment the watch clicks, from the reader's number. Kept as a function
  // so the drawing and the animation cannot disagree about it.
  function rgAtwoodStopAt(res, R) {
    return rgClamp(res.guess, 0.02, R.t * 3 + 3.0);
  }

  function rgAtwoodDraw(ctx, w, h, P, R, res, A) {
    const clock = A ? A.t : (res ? rgAtwoodStopAt(res, R) : 0);
    const tFall = Math.min(clock, R.t);
    const s = 0.5 * R.a * tFall * tFall;         // metres the heavy side has dropped
    const landed = clock >= R.t - 1e-9 && res !== null;

    const cx = w * 0.42;
    const pulleyR = rgClamp(Math.min(w, h) * 0.055, 5, 26);
    const pulleyY = Math.max(h * 0.15, pulleyR + 12);
    const startY = h * 0.34;
    const padY = h * 0.88;
    const travel = Math.max(padY - startY - 10, 12);
    const pxPerM = travel / Math.max(R.h, 0.1);
    const block = rgClamp(Math.min(w, h) * 0.07, 5, 26);
    const halfGap = Math.max(pulleyR, 6);

    // mounting bracket
    ctx.save();
    ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - pulleyR - 22, pulleyY - pulleyR - 7);
    ctx.lineTo(cx + pulleyR + 22, pulleyY - pulleyR - 7);
    ctx.stroke();
    for (let d = -pulleyR - 18; d <= pulleyR + 18; d += 8) {
      ctx.beginPath();
      ctx.moveTo(cx + d, pulleyY - pulleyR - 7);
      ctx.lineTo(cx + d - 6, pulleyY - pulleyR + 1);
      ctx.stroke();
    }
    ctx.restore();

    const leftX = cx - halfGap, rightX = cx + halfGap;
    const yL = startY + s * pxPerM;               // heavy side descends
    const yR = startY - s * pxPerM;               // light side rises by the same arc length

    // string, over the rim
    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(leftX, yL);
    ctx.lineTo(leftX, pulleyY);
    ctx.arc(cx, pulleyY, halfGap, Math.PI, 0, false);
    ctx.lineTo(rightX, yR);
    ctx.stroke();
    ctx.restore();

    // The rim turns with the string, phi = s/R -- never on its own clock.
    const spin = (s * pxPerM) / Math.max(pulleyR, 1);
    if (typeof drawWheel === "function") {
      drawWheel(ctx, cx, pulleyY, pulleyR, spin, R.tier === 0 ? P.inkSoft : P.brass);
    }
    if (R.tier >= 1 && pulleyR > 14) {
      rgText(ctx, cx, pulleyY - pulleyR - 16, R.tier === 2 ? "uniform disc" : "I quoted", P.brass, 9);
    }

    // floor pad, with a little squash on the thump
    const squash = landed ? Math.max(0, 1 - (clock - R.t) / 0.35) : 0;
    const padH = 7 + 3 * (1 - squash);
    ctx.save();
    ctx.fillStyle = P.rule; ctx.globalAlpha = 0.8;
    ctx.fillRect(leftX - block * 1.1, padY, block * 2.2, padH);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1;
    ctx.strokeRect(leftX - block * 1.1, padY, block * 2.2, padH);
    ctx.restore();

    if (typeof drawHangingBlock === "function") {
      drawHangingBlock(ctx, leftX, yL + block / 2, block, P.crimson);
      drawHangingBlock(ctx, rightX, yR + block / 2, block, P.navy);
    }
    if (block > 14) {
      rgText(ctx, leftX - block * 0.75, yL + block / 2, "m₁", P.crimson, 10, "right");
      rgText(ctx, rightX + block * 0.75, yR + block / 2, "m₂", P.navy, 10, "left");
    }

    // the tape: the full drop, and the part of it still to come
    const tapeX = leftX - block * 1.25 - 16;
    if (tapeX > 22) {
      rgDash(ctx, tapeX, startY, tapeX, padY, P.rule, 1, [3, 4]);
      ctx.save();
      ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
      [startY, padY].forEach((yy) => {
        ctx.beginPath(); ctx.moveTo(tapeX - 5, yy); ctx.lineTo(tapeX + 5, yy); ctx.stroke();
      });
      ctx.restore();
      rgText(ctx, tapeX - 8, (startY + padY) / 2, "h = " + rgFmt(R.h, 2) + " m", P.inkSoft, 10, "right");
    }

    if (res && !res.blank && A && A.t >= A.tStop - 1e-9) {
      const gapPx = (R.h - s) * pxPerM;
      if (gapPx > 2) {
        // the shortfall, drawn to the same scale as the drop it belongs to
        rgArrow(ctx, leftX + block * 0.9, yL + block / 2, leftX + block * 0.9, padY, P.brass, 1.6);
        rgText(ctx, leftX + block * 1.05, (yL + block / 2 + padY) / 2,
          rgFmt(res.gapM * 100, 1) + " cm", P.brass, 10, "left");
      } else {
        rgText(ctx, leftX, padY + 22, "landed " + rgFmt(res.sat, 2) + " s ago", P.brass, 10);
      }
    }

    rgAtwoodWatch(ctx, P, w, h, R, res, A, clock);

    // The acceleration is one step from the answer -- t = sqrt(2h/a), and h is
    // on the plate too -- so it cannot be shown until the reader has committed.
    const rows = [
      ["a", res && !res.blank ? rgFmt(R.a, 3) + " m/s²" : "— work it out"],
      ["m₁ + m₂" + (R.tier >= 1 ? " + I/R²" : ""), rgFmt(R.S + R.J, 3) + " kg"],
    ];
    if (res && !res.blank) {
      rows.push(["watch set to", rgFmt(res.guess, 3) + " s"]);
      rows.push(["true fall", rgFmt(R.t, 3) + " s", res.correct ? P.forest : P.crimson]);
    }
    rgPlate(ctx, P, 12, 12, Math.min(178, w - 24), rows);
    if (w > 220 && h > 130) rgTag(ctx, P, 12, h - 34, "Experiment", "Atwood machine");
  }

  function rgAtwoodWatch(ctx, P, w, h, R, res, A, clock) {
    const dial = rgClamp(Math.min(w, h) * 0.15, 14, 52);
    const wx = w - dial - 20, wy = dial + 26;
    if (wx - dial < 8 || wy + dial > h - 6) return;

    const stopped = !!(A && A.t >= A.tStop - 1e-9);
    const reading = A ? Math.min(A.t, A.tStop) : (res ? rgAtwoodStopAt(res, R) : 0);

    ctx.save();
    ctx.fillStyle = P.panel; ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.arc(wx, wy, dial, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = stopped ? P.crimson : P.rule;
    ctx.lineWidth = stopped ? 2.2 : 1.4;
    ctx.beginPath(); ctx.arc(wx, wy, dial, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2 - Math.PI / 2;
      const rIn = dial * (i % 5 === 0 ? 0.78 : 0.88);
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(ang) * rIn, wy + Math.sin(ang) * rIn);
      ctx.lineTo(wx + Math.cos(ang) * dial * 0.95, wy + Math.sin(ang) * dial * 0.95);
      ctx.stroke();
    }
    // One sweep of the hand is one second, so the hand angle is continuous in t
    // and the dial never jumps.
    const hand = (reading % 1) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = stopped ? P.crimson : P.brass;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(hand) * dial * 0.72, wy + Math.sin(hand) * dial * 0.72);
    ctx.stroke();
    ctx.restore();

    if (dial > 22) {
      rgText(ctx, wx, wy + dial * 0.45, rgFmt(reading, 2), P.ink, Math.min(13, dial * 0.32), "center", 700);
      rgText(ctx, wx, wy - dial - 10, stopped ? "STOPPED" : "running",
        stopped ? P.crimson : P.inkSoft, 9.5);
    }
  }

  /* ==========================================================================
     reveal — friction board
     ========================================================================== */

  function rgBoardPlay(R, res) {
    const tRamp = Math.sqrt((2 * R.L) / Math.max(R.aRamp, 1e-6));
    return {
      kind: "board",
      t: 0,
      tRamp,
      // Both legs are closed-form here and the two agree at the corner by
      // construction (v_corner is the same number in each), so the position is
      // continuous across the join without any blending.
      tStop: tRamp + R.vCorner / Math.max(R.aFloor, 1e-6),
      hold: 0,
      done: false,
      flag: Math.max(res.guess, 0),
      s: 0,
      v: 0,
    };
  }

  function rgBoardStep(A, R, dt) {
    const tRamp = A.tRamp;
    const tEnd = A.tStop;
    if (A.t < tEnd) {
      A.t = Math.min(A.t + dt, tEnd);
      if (A.t <= tRamp) {
        A.s = 0.5 * R.aRamp * A.t * A.t;
        A.v = R.aRamp * A.t;
      } else {
        const tf = A.t - tRamp;
        A.s = R.L + R.vCorner * tf - 0.5 * R.aFloor * tf * tf;
        A.v = Math.max(R.vCorner - R.aFloor * tf, 0);
      }
      return true;
    }
    A.s = R.L + R.d;
    A.v = 0;
    A.hold += dt;
    if (A.hold >= 2.8) { A.done = true; return false; }
    return true;
  }

  function rgBoardDraw(ctx, w, h, P, R, res, A) {
    const sn = R.sn, cs = R.cs;
    const apex = { x: -R.L * cs, y: R.L * sn };

    /* The floor shown before grading is a flat 2 m and does NOT depend on the
       answer: scaling the tape to the truth would hand it over. After grading
       the flag is included, but only out to a bounded distance — an answer of
       500 m would otherwise shrink the apparatus to a speck and put a hundred
       thousand ticks on the tape. */
    const flag = res && !res.blank ? Math.max(res.guess, 0) : 0;
    const flagDraw = Math.min(flag, R.d * 8 + 2);
    const reach = res && !res.blank ? Math.max(flagDraw, R.d) + 0.35 : 2.0;

    const world = typeof newWorld === "function" ? newWorld(apex.x, apex.y) : null;
    let V;
    if (world && typeof fitView === "function" && typeof includePoint === "function") {
      includePoint(world, apex.x, apex.y, 0.12);
      includePoint(world, 0, 0, 0.12);
      includePoint(world, reach, 0, 0.12);
      includePoint(world, 0, -0.45, 0);
      V = fitView(RG_FIT_BOARD, w, h * 0.92, world, { pad: 0.10 });
    } else {
      const sc = Math.min(w / 3.2, h / 1.6);
      V = { scale: sc, X: (x) => w * 0.2 + x * sc, Y: (y) => h * 0.62 - y * sc, S: (l) => l * sc,
            zoomedOut: false, zoomFactor: 1 };
    }
    const X = V.X, Y = V.Y, S = V.S;

    // the wedge, filled and hatched
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(apex.x), Y(apex.y));
    ctx.lineTo(X(0), Y(0));
    ctx.lineTo(X(apex.x), Y(0));
    ctx.closePath();
    ctx.fillStyle = P.panel; ctx.globalAlpha = 0.6; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.clip();
    rgHatch(ctx, P.rule, 0.35, 9, w, h);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(X(apex.x), Y(apex.y));
    ctx.lineTo(X(0), Y(0));
    ctx.lineTo(X(apex.x), Y(0));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // the floor, and the tape along it
    const floorEnd = Math.max(reach, 0.4);
    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(floorEnd), Y(0)); ctx.stroke();
    ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
    for (let px = X(0); px < X(floorEnd); px += 12) {
      ctx.beginPath(); ctx.moveTo(px, Y(0)); ctx.lineTo(px - 7, Y(0) + 8); ctx.stroke();
    }
    ctx.restore();

    const tickStep = S(0.1) > 5 ? 0.1 : (S(0.5) > 5 ? 0.5 : 1.0);
    const tickMax = Math.min(Math.floor(floorEnd / tickStep), 400);
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
    for (let i = 0; i <= tickMax; i++) {
      const m = rgR(i * tickStep, 4);
      const major = Math.abs(m / 0.5 - Math.round(m / 0.5)) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(X(m), Y(0) + 14);
      ctx.lineTo(X(m), Y(0) + (major ? 24 : 19));
      ctx.stroke();
      if (major && S(0.5) > 26) rgText(ctx, X(m), Y(0) + 32, rgFmt(m, 1), P.inkSoft, 9);
    }
    ctx.restore();

    // the angle, at the foot where it is measured
    const arcR = Math.min(S(0.28), 44);
    if (arcR > 12) {
      ctx.save();
      ctx.strokeStyle = P.brass; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(X(0), Y(0), arcR, Math.PI - R.th, Math.PI, false);
      ctx.stroke();
      ctx.restore();
      rgText(ctx, X(0) - arcR - 16, Y(0) - arcR * 0.30, R.thDeg + "°", P.brass, 11, "center");
    }

    // release mark, scribed across the ramp: the surface runs (cos, sin) in
    // canvas, so the mark runs (−sin, cos).
    const relPx = { x: X(apex.x), y: Y(apex.y) };
    ctx.save();
    ctx.strokeStyle = P.brass; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(relPx.x + sn * 9, relPx.y - cs * 9);
    ctx.lineTo(relPx.x - sn * 9, relPx.y + cs * 9);
    ctx.stroke();
    ctx.restore();
    if (S(0.2) > 16) rgText(ctx, relPx.x - 6, relPx.y - 16, "release", P.brass, 9, "right");

    // the flag, planted at the reader's number
    if (res && !res.blank) {
      const fx = X(flagDraw), fy = Y(0);
      const poleH = rgClamp(S(0.30), 14, 54);
      ctx.save();
      ctx.strokeStyle = P.forest; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - poleH); ctx.stroke();
      ctx.fillStyle = P.forest;
      ctx.beginPath();
      ctx.moveTo(fx, fy - poleH);
      ctx.lineTo(fx + poleH * 0.42, fy - poleH * 0.82);
      ctx.lineTo(fx, fy - poleH * 0.64);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      if (poleH > 26) rgText(ctx, fx, fy - poleH - 11, rgFmt(flag, 2) + " m", P.forest, 10);
    }

    // the block, on the path
    const sPos = A ? A.s : 0;
    const onRamp = sPos <= R.L;
    const pos = onRamp
      ? { x: apex.x + sPos * cs, y: apex.y - sPos * sn }
      : { x: sPos - R.L, y: 0 };
    // The tilt eases through the corner over 6 cm of path so the block turns
    // rather than snapping flat the instant it crosses.
    const turn = rgClamp((sPos - (R.L - 0.06)) / 0.12, 0, 1);
    const tilt = R.th * (1 - turn);
    const size = rgClamp(S(0.09), 5, 30);
    ctx.save();
    ctx.translate(X(pos.x), Y(pos.y));
    ctx.rotate(tilt);
    ctx.fillStyle = P.navy; ctx.globalAlpha = 0.85;
    ctx.fillRect(-size / 2, -size, size, size);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2;
    ctx.strokeRect(-size / 2, -size, size, size);
    ctx.restore();

    // a scuff at the contact point while it is still moving
    if (A && A.v > 0.05 && size > 8) {
      ctx.save();
      ctx.globalAlpha = rgClamp(A.v / Math.max(R.vCorner, 0.1), 0, 1) * 0.5;
      ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const back = i * size * 0.45;
        ctx.beginPath();
        ctx.moveTo(X(pos.x) - Math.cos(tilt) * back, Y(pos.y) - Math.sin(tilt) * back);
        ctx.lineTo(X(pos.x) - Math.cos(tilt) * (back + size * 0.28),
                   Y(pos.y) - Math.sin(tilt) * (back + size * 0.28));
        ctx.stroke();
      }
      ctx.restore();
    }

    // the miss, once it has stopped
    if (res && !res.blank && A && A.t >= A.tStop - 1e-9 && !res.correct) {
      const x1 = X(Math.min(flagDraw, R.d)), x2 = X(Math.max(flagDraw, R.d));
      if (x2 - x1 > 6) {
        rgArrow(ctx, x1, Y(0) - 6, x2, Y(0) - 6, P.crimson, 1.6);
        rgArrow(ctx, x2, Y(0) - 6, x1, Y(0) - 6, P.crimson, 1.6);
        rgText(ctx, (x1 + x2) / 2, Y(0) - 18,
          rgFmt(Math.abs(flag - R.d) * 100, 0) + " cm", P.crimson, 10.5);
      }
    }

    if (V.zoomedOut && typeof drawZoomBar === "function") drawZoomBar(ctx, w, h, V, "m");

    const rows = [
      ["θ", R.thDeg + "°"],
      ["L", rgFmt(R.L, 2) + " m"],
      ["μ ramp / floor", (R.tier === 0 ? "0" : rgFmt(R.muR, 2)) + " / " + rgFmt(R.muF, 2)],
      ["m (cancels)", rgFmt(R.mass, 2) + " kg"],
    ];
    if (res && !res.blank) {
      rows.push(["flag at", rgFmt(flag, 3) + " m"]);
      rows.push(["stops at", rgFmt(R.d, 3) + " m", res.correct ? P.forest : P.crimson]);
    }
    rgPlate(ctx, P, w - Math.min(196, w - 16) - 12, 12, Math.min(196, w - 24), rows);
    if (w > 220 && h > 130) rgTag(ctx, P, 12, h - 34, "Experiment", "Friction board");
  }

  /* ==========================================================================
     reveal — banked curve
     --------------------------------------------------------------------------
     Integrated, not replayed. u is the slope coordinate up the bank from the
     painted line; the closed forms for v_design, v_max and the equilibrium
     radius are used only as checks against what comes out of it.
     ========================================================================== */

  function rgBankPlay(R, res) {
    return {
      kind: "bank",
      t: 0,               // wall-clock seconds of animation
      track: 0,           // track seconds simulated
      v0: Math.max(res.guess, 0.05),
      u: 0, ud: 0, phi: 0,
      uPeak: 0, uLow: 0,
      // Seeded with the reading at the painted line rather than with zero. The
      // integrator would otherwise fill it in on the first tick and the meter
      // would snap from empty to full between frame zero and frame one — a
      // discontinuity in a drawn quantity, which is exactly what the reader is
      // being asked to watch.
      grip: Number.isFinite(res.grip) ? res.grip : 0,
      escaped: null,      // "wall" | "infield" | null
      escapeT: 0,
      trail: [],
      hold: 0,
      done: false,
    };
  }

  function rgBankStep(A, R, dt) {
    const g = R.g, cs = R.cs, sn = R.sn;
    const track = dt * RG_BANK_SPEEDUP;

    if (!A.escaped) {
      // Sub-stepped so the result does not depend on the reader's frame rate,
      // and so Coulomb stiction is resolved rather than chattering.
      const n = Math.max(1, Math.ceil(track / 0.004));
      const hstep = track / n;
      for (let i = 0; i < n; i++) {
        const r = Math.max(R.Rr + A.u * cs, 1.0);
        const vt = (A.v0 * R.Rr) / r;
        const aFree = ((vt * vt) / r) * cs - g * sn;
        const Nm = ((vt * vt) / r) * sn + g * cs;      // N/m, and it is always positive here
        const fmax = R.mu * Nm;
        A.grip = fmax > 0 ? Math.abs(aFree) / fmax : (Math.abs(aFree) < 1e-9 ? 0 : Infinity);

        let a;
        if (Math.abs(A.ud) > 1e-4) {
          a = aFree - Math.sign(A.ud) * fmax;
        } else if (Math.abs(aFree) <= fmax) {
          a = 0; A.ud = 0;
        } else {
          a = aFree - Math.sign(aFree) * fmax;
        }
        const udNext = A.ud + a * hstep;
        // Friction may not drive the drift backwards through zero; if it would,
        // the board has stuck.
        if (A.ud !== 0 && Math.sign(udNext) !== Math.sign(A.ud) && Math.abs(aFree) <= fmax) {
          A.ud = 0;
        } else {
          A.ud = udNext;
        }
        A.u += A.ud * hstep;
        A.phi += (vt / r) * hstep;

        if (A.u > A.uPeak) A.uPeak = A.u;
        if (A.u < A.uLow) A.uLow = A.u;
        if (A.u > RG_BANK_UP) { A.escaped = "wall"; A.escapeT = 0; break; }
        if (A.u < -RG_BANK_DOWN) { A.escaped = "infield"; A.escapeT = 0; break; }
      }
      A.track += track;
      A.trail.push({ r: Math.max(R.Rr + A.u * cs, 1.0), phi: A.phi });
      if (A.trail.length > 120) A.trail.shift();
    } else {
      // Past the wall or off the apron it leaves at the drift speed it had —
      // no teleport, no sudden stop — and is then simply carried on.
      A.escapeT += track;
      A.u += A.ud * track;
      A.ud += (A.escaped === "wall" ? -R.g * 0.35 : R.g * 0.15) * track;
      A.phi += (A.v0 / Math.max(R.Rr + A.u * R.cs, 1)) * track;
      // An absurd speed can hand the integrator a drift of 1e9 m/s in the step
      // that ejects it; the view would then be scaled to a body a light-second
      // away. The escape is already recorded, so cap what is DRAWN.
      A.u = rgClamp(A.u, -RG_BANK_DOWN - 28, RG_BANK_UP + 28);
    }

    A.t += dt;
    if (!Number.isFinite(A.u) || !Number.isFinite(A.ud)) { A.done = true; return false; }
    if (A.escaped && A.escapeT > 1.6) { A.done = true; return false; }
    if (A.t >= 11.0) { A.done = true; return false; }
    return true;
  }

  function rgBankDraw(ctx, w, h, P, R, res, A) {
    const cs = R.cs, sn = R.sn;
    const u = rgClamp(A && Number.isFinite(A.u) ? A.u : 0, -RG_BANK_DOWN - 30, RG_BANK_UP + 30);

    // Cross-section world: origin at the painted line, x outward, y up.
    const surf = (uu) => ({ x: uu * cs, y: uu * sn });
    const top = surf(RG_BANK_UP), bot = surf(-RG_BANK_DOWN);

    let V;
    if (typeof newWorld === "function" && typeof fitView === "function" && typeof includePoint === "function") {
      const world = newWorld(bot.x - 2.4, bot.y - 0.9);
      includePoint(world, top.x + 1.6, top.y + 1.8, 0);
      includePoint(world, surf(u).x, surf(u).y + 0.9, 0.6);
      V = fitView(RG_FIT_BANK, w, h, world, { pad: 0.11 });
    } else {
      const sc = Math.min(w / 16, h / 8);
      V = { scale: sc, X: (x) => w * 0.45 + x * sc, Y: (y) => h * 0.6 - y * sc, S: (l) => l * sc,
            zoomedOut: false, zoomFactor: 1 };
    }
    const X = V.X, Y = V.Y, S = V.S;

    // banking fill
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(bot.x - 2.4), Y(bot.y));
    ctx.lineTo(X(bot.x), Y(bot.y));
    ctx.lineTo(X(top.x), Y(top.y));
    ctx.lineTo(X(top.x), Y(bot.y - 0.9));
    ctx.lineTo(X(bot.x - 2.4), Y(bot.y - 0.9));
    ctx.closePath();
    ctx.fillStyle = P.panel; ctx.globalAlpha = 0.55; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.clip();
    rgHatch(ctx, P.rule, 0.3, 10, w, h);
    ctx.restore();

    // the running surface: infield apron, then the bank, then the wall
    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(bot.x - 2.4), Y(bot.y));
    ctx.lineTo(X(bot.x), Y(bot.y));
    ctx.lineTo(X(top.x), Y(top.y));
    ctx.lineTo(X(top.x), Y(top.y + 1.2));
    ctx.stroke();
    ctx.restore();
    if (S(1) > 8) {
      rgText(ctx, X(bot.x - 1.2), Y(bot.y) + 14, "infield", P.inkSoft, 9);
      rgText(ctx, X(top.x), Y(top.y + 1.2) - 10, "wall", P.inkSoft, 9);
    }

    // the metre scale up the slope, which is the quantity the reader watches
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
    for (let m = -RG_BANK_DOWN; m <= RG_BANK_UP + 1e-9; m += 1) {
      const p = surf(m);
      const nx = -sn, ny = cs;
      ctx.beginPath();
      ctx.moveTo(X(p.x) + nx * 4, Y(p.y) - ny * 4);
      ctx.lineTo(X(p.x) + nx * (m % 2 === 0 ? 12 : 8), Y(p.y) - ny * (m % 2 === 0 ? 12 : 8));
      ctx.stroke();
      if (m % 2 === 0 && S(1) > 15 && m !== 0) {
        rgText(ctx, X(p.x) + nx * 22, Y(p.y) - ny * 22, String(m), P.inkSoft, 8.5);
      }
    }
    ctx.restore();

    // the painted line the question is about
    const line = surf(0);
    ctx.save();
    ctx.strokeStyle = P.brass; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(X(line.x) - cs * S(0.35), Y(line.y) + sn * S(0.35));
    ctx.lineTo(X(line.x) + cs * S(0.35), Y(line.y) - sn * S(0.35));
    ctx.stroke();
    ctx.restore();
    if (S(1) > 14) {
      rgText(ctx, X(line.x) - S(1.2) * cs, Y(line.y) + S(1.2) * sn + 12,
        "R = " + rgFmt(R.Rr, R.tier === 1 ? 1 : 0) + " m", P.brass, 9.5);
    }

    /* Where the reader's speed balances. On the friction rung that line is the
       LOWEST the board can hold, not where it comes to rest — it overshoots and
       sticks above it — so the two rungs get different words for it. */
    if (res && !res.blank && Number.isFinite(res.uEq) && Math.abs(res.uEq) > 0.02) {
      const ue = rgClamp(res.uEq, -RG_BANK_DOWN - 1.5, RG_BANK_UP + 1.5);
      const p = surf(ue);
      const nx = -sn, ny = cs;
      const col = res.correct ? P.forest : P.crimson;
      rgDash(ctx, X(p.x) - nx * 4, Y(p.y) + ny * 4, X(p.x) + nx * 26, Y(p.y) - ny * 26, col, 1.4, [4, 4]);
      if (S(1) > 12) {
        rgText(ctx, X(p.x) + nx * 34, Y(p.y) - ny * 34,
          R.tier === 2 ? "lowest line your speed can hold" : "your speed balances here",
          col, 9, ue > 3 ? "right" : "left");
      }
    }

    // the rider
    const rp = surf(u);
    const board = rgClamp(S(1.5), 7, 44);
    if (typeof drawSkateboard === "function") {
      // Its own tag is suppressed and redrawn below, because animate.js paints
      // that plate with PALETTE.stage, which refreshPalette() never fills.
      drawSkateboard(ctx, X(rp.x), Y(rp.y), board, -R.th, { colour: P.crimson, tag: false });
    } else {
      ctx.save();
      ctx.fillStyle = P.crimson;
      ctx.fillRect(X(rp.x) - board / 2, Y(rp.y) - board * 0.2, board, board * 0.18);
      ctx.restore();
    }
    if (board > 28) rgBoardTag(ctx, P, X(rp.x), Y(rp.y) - board * 0.52, "Mr. J's Skateboard");

    /* The free body on the rider: the normal force and the weight, and nothing
       else. N = mg/cosθ is LONGER than the weight, drawn to scale, because the
       arrow a student is tempted to add — an outward one — would have to be
       balanced by something, and there is nothing there to balance it. */
    if (board > 20) {
      const fs = rgClamp(S(0.22), 10, 30);
      const nx = -sn, ny = cs;
      const ox = X(rp.x), oy = Y(rp.y) - board * 0.30;
      const nLen = fs * 1.4 / Math.max(cs, 0.25);
      rgArrow(ctx, ox, oy, ox + nx * nLen, oy - ny * nLen, P.forest, 1.8);
      rgArrow(ctx, ox, oy, ox, oy + fs * 1.4, P.navy, 1.8);
      if (board > 30) {
        rgText(ctx, ox + nx * nLen - 10, oy - ny * nLen - 8, "N", P.forest, 10);
        rgText(ctx, ox + 13, oy + fs * 1.4 + 8, "mg", P.navy, 10);
      }
    }

    rgBankInset(ctx, P, w, h, R, A);
    if (R.tier === 2) rgBankGrip(ctx, P, w, h, R, res, A);
    if (V.zoomedOut && typeof drawZoomBar === "function") drawZoomBar(ctx, w, h, V, "m");

    const rows = [
      ["θ", rgFmt(R.thDeg, R.tier === 1 ? 1 : 0) + "°"],
      ["R", rgFmt(R.Rr, R.tier === 1 ? 1 : 0) + " m"],
    ];
    if (R.tier === 2) rows.push(["μ", rgFmt(R.mu, 2)]);
    if (res && !res.blank) {
      rows.push(["ridden at", rgFmt(res.guess, 2) + " m/s"]);
      rows.push(["up the bank", rgFmt(u, 2) + " m"]);
      rows.push(["height gained", rgFmt(u * sn, 2) + " m"]);
      if (Number.isFinite(res.uTurn) && Math.abs(res.uTurn) > 0.02) {
        rows.push(["turns at", rgFmt(res.uTurn, 2) + " m"]);
      }
      rows.push(["design speed", rgFmt(R.v, 2) + " m/s", res.correct ? P.forest : P.crimson]);
      if (A && A.escaped) {
        rows.push(["", A.escaped === "wall" ? "OVER THE WALL" : "INTO THE INFIELD", P.crimson]);
      }
    }
    if (A) rows.push(["clock", "×" + rgFmt(RG_BANK_SPEEDUP, 1)]);
    rgPlate(ctx, P, 12, 12, Math.min(190, w - 24), rows);
    if (w > 240 && h > 150) rgTag(ctx, P, 12, h - 34, "Rider", "Mr. J's Skateboard");
  }

  // Top-down: the design circle, the two edges of the banking, and the spiral
  // the rider is actually walking across them.
  function rgBankInset(ctx, P, w, h, R, A) {
    const box = rgClamp(Math.min(w, h) * 0.30, 40, 150);
    if (box < 46 || w < 240 || h < 170) return;
    const bx = w - box - 14, by = h - box - 14;
    const cxp = bx + box / 2, cyp = by + box / 2;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = P.panel;
    rgRoundRect(ctx, bx, by, box, box, 4); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
    rgRoundRect(ctx, bx, by, box, box, 4); ctx.stroke();
    ctx.clip();

    const rOut = R.Rr + RG_BANK_UP * R.cs;
    const k = (box * 0.40) / rOut;
    const ring = (rad, colour, width, dash) => {
      ctx.save();
      if (dash) ctx.setLineDash(dash);
      ctx.strokeStyle = colour; ctx.lineWidth = width;
      ctx.beginPath(); ctx.arc(cxp, cyp, Math.max(rad * k, 1), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    };
    ring(rOut, P.inkSoft, 1.4);
    ring(R.Rr - RG_BANK_DOWN * R.cs, P.inkSoft, 1.4);
    ring(R.Rr, P.brass, 1.6, [4, 4]);

    if (A && A.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = P.crimson; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.55;
      ctx.beginPath();
      A.trail.forEach((pt, i) => {
        const px = cxp + Math.cos(pt.phi) * pt.r * k;
        const py = cyp + Math.sin(pt.phi) * pt.r * k;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    const phi = A ? A.phi : -Math.PI / 2;
    const rr = A ? Math.max(R.Rr + A.u * R.cs, 1) : R.Rr;
    ctx.save();
    ctx.fillStyle = P.crimson;
    ctx.beginPath();
    ctx.arc(cxp + Math.cos(phi) * rr * k, cyp + Math.sin(phi) * rr * k, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();

    rgText(ctx, bx + 6, by + 10, "from above", P.inkSoft, 9, "left", 400);
    if (A) {
      rgText(ctx, bx + box - 6, by + 10,
        rgFmt(Math.abs(A.phi) / (Math.PI * 2), 2) + " lap", P.inkSoft, 9, "right", 400);
    }
  }

  // Only the friction rung has a band, and only there does a grip meter mean
  // anything: it reads 1.00 at BOTH ends of the band, which is the point.
  function rgBankGrip(ctx, P, w, h, R, res, A) {
    const bw = Math.min(w * 0.34, 190);
    if (bw < 90 || h < 170) return;
    const bx = 14, by = h - 66;
    const grip = A && Number.isFinite(A.grip) ? A.grip : (res && Number.isFinite(res.grip) ? res.grip : 0);
    const shown = rgClamp(grip, 0, 1.35);

    rgText(ctx, bx, by - 8, "friction demanded / available", P.inkSoft, 9, "left", 400);
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, 10);
    ctx.fillStyle = shown >= 0.999 ? P.crimson : P.forest;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(bx, by, (bw * shown) / 1.35, 10);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.brass; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + bw / 1.35, by - 3);
    ctx.lineTo(bx + bw / 1.35, by + 13);
    ctx.stroke();
    ctx.restore();
    rgText(ctx, bx + bw / 1.35, by + 21, "μN", P.brass, 9);
    rgText(ctx, bx + bw + 8, by + 5,
      Number.isFinite(grip) ? rgFmt(grip * 100, 0) + "%" : "—",
      shown >= 0.999 ? P.crimson : P.forest, 10.5, "left", 700);
  }

  /* ==========================================================================
     posed-state drawing (before anything is graded)
     ========================================================================== */

  function rgDrawEmpty(ctx, w, h, P) {
    rgText(ctx, w / 2, h / 2, "Choose an experiment", P.inkSoft, Math.min(13, w / 18));
  }

  /* ==========================================================================
     module surface
     ========================================================================== */

  function rgStart(gameId, difficulty) {
    const id = RG_IDS.indexOf(gameId) >= 0 ? gameId : null;
    if (!id) return null;
    rgReset();
    lastGameId = id;
    const tier = rgTier(id, difficulty);
    if (id === "atwood-game") { round = rgAtwoodMake(tier); view = rgAtwoodView(round); }
    else if (id === "friction-board") { round = rgBoardMake(tier); view = rgBoardView(round); }
    else { round = rgBankMake(tier); view = rgBankView(round); }
    return view;
  }

  function rgSubmit(answers) {
    if (!round) return rgBlank(null, []);
    const r = round.game === "atwood" ? rgAtwoodGrade(round, answers)
      : round.game === "board" ? rgBoardGrade(round, answers)
        : rgBankGrade(round, answers);
    result = r;
    // Grading and playing are separate: the host prints the verdict, then calls
    // play(). Nothing is released here, and a blank field releases nothing at
    // all, so the reader can fill it in without losing the round.
    anim = null;
    return r;
  }

  /* Called by the host on grading AND again on every Replay, so it rebuilds the
     reveal from the stored result rather than re-grading anything. */
  function rgPlay() {
    if (!round || !result || result.blank) return false;
    rgClearFits();
    anim = round.game === "atwood" ? rgAtwoodPlay(round, result)
      : round.game === "board" ? rgBoardPlay(round, result)
        : rgBankPlay(round, result);
    return true;
  }

  function rgTick(dt) {
    if (!anim || anim.done) return false;
    // A backgrounded tab hands back whole seconds; without this the reveal
    // would jump clean past the moment it exists to show.
    const step = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
    if (step <= 0) return true;
    if (anim.kind === "atwood") return rgAtwoodStep(anim, round, step);
    if (anim.kind === "board") return rgBoardStep(anim, round, step);
    return rgBankStep(anim, round, step);
  }

  function rgDraw(ctx, w, h) {
    if (!ctx) return;
    const width = Math.max(Number(w) || 0, 1);
    const height = Math.max(Number(h) || 0, 1);
    if (!(width > 12 && height > 12)) return;
    const P = rgPal();
    if (!P) return;

    ctx.save();
    try {
      if (!round) { rgDrawEmpty(ctx, width, height, P); return; }
      const res = result && !result.blank ? result : null;
      if (round.game === "atwood") rgAtwoodDraw(ctx, width, height, P, round, res, anim);
      else if (round.game === "board") rgBoardDraw(ctx, width, height, P, round, res, anim);
      else rgBankDraw(ctx, width, height, P, round, res, anim);
    } finally {
      // A renderer that threw mid-path would otherwise leave a clip or a
      // transform on the context for whatever paints next.
      ctx.restore();
    }
  }

  function rgReset() {
    round = null; view = null; result = null; anim = null;
    rgClearFits();
  }

  return {
    LADDERS: RG_LADDERS,

    list: () => RG_CATALOGUE.map((g) => ({ id: g.id, name: g.name, blurb: g.blurb, group: g.group })),

    // The host rebuilds its difficulty menu before the round exists, so an
    // omitted id falls back to whatever was last started rather than returning
    // nothing and leaving the menu empty.
    difficulties: (gameId) => {
      const id = RG_IDS.indexOf(gameId) >= 0 ? gameId : lastGameId;
      return RG_LADDERS[id].slice();
    },

    start: rgStart,
    round: () => view,
    submit: rgSubmit,
    play: rgPlay,
    tick: rgTick,
    draw: rgDraw,
    reset: rgReset,
    animating: () => !!anim && !anim.done,

    // --- accessors the host may want, none of which leak an ungraded answer --
    phase: () => (!round ? "idle" : result && !result.blank ? "graded" : "posed"),
    result: () => result,
    solution: () => (result ? result.solution : null),
  };
})();
