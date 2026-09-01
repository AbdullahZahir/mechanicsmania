/* ============================================================================
   Mini-games — the lab bench, where you commit to a number first
   ----------------------------------------------------------------------------
   Everything else in this app either walks a reader to an answer or lets them
   push sliders and watch. Neither asks the one question a laboratory asks:
   "before you touch it, what do you predict?" These two games do. The reader
   works the arithmetic on paper, types the number, and the apparatus is then
   released and behaves — level or tipping, still or drifting — according to
   the number they gave. Nothing is revealed until they have committed.

   Two consequences run through the whole file:

   1. Rounds are CONSTRUCTED, never sampled and hoped over. The generator
      fixes the window the answer must land in, then chooses the one given
      that steers it there, and rejects any round whose answer would be
      unreachable, absurdly small, or indistinguishable from a known wrong
      path. A student who gets 0.0003 m has been failed by the generator, not
      by their algebra.

   2. The post-submit animation is integrated from the reader's OWN number,
      not from the exact answer with an error bar drawn on. Στ/I for the rod,
      ΣF/m for the ring. If they were 12% out, the rod tips at the rate a rod
      12% out actually tips.

   Depends on animate.js for PALETTE and the drawing primitives, and on
   scenarios.js for the configured g. Load after both.
   ========================================================================== */

/* g travels from the backend through scenarios.js. It is read through a
   function rather than captured at load time because /api/config can land
   after this file has parsed — a round generated at 9.8 and graded at the
   configured value would mark a correct answer wrong. The try/catch guards
   the load-order hazard, not a missing value: `typeof` on a `let` that has
   not been evaluated yet THROWS rather than returning "undefined", so a
   script tag placed above scenarios.js would otherwise take this whole file
   down and leave MiniGames undefined. */
function mgGravity() {
  try {
    if (typeof GRAVITY === "number" && Number.isFinite(GRAVITY) && GRAVITY > 0) return GRAVITY;
  } catch (err) { /* scenarios.js has not run yet */ }
  return 9.8;
}

/* --- numeric odds and ends ----------------------------------------------- */

function mgRandInt(n) { return Math.floor(Math.random() * n); }
function mgPick(list) { return list[mgRandInt(list.length)]; }

// Rounds to `dp` decimals. Every given is passed through this before it is
// stored, so the number the reader is shown and the number the answer was
// computed from are the same number -- 0.1*3 = 0.30000000000000004 otherwise
// leaves the printed given and the graded answer quietly disagreeing.
function mgR(v, dp) { const f = Math.pow(10, dp); return Math.round(v * f) / f; }

function mgGrid(lo, hi, step) {
  const out = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) out.push(mgR(lo + i * step, 4));
  return out;
}

// Readers type into text fields, so an answer arrives as a string, and on a
// comma-decimal keyboard it arrives as "0,40". Anything that is not a finite
// number comes back NaN and is reported as a blank field, never graded.
function mgNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const s = v.trim().replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function mgWrapDeg(d) { return ((d % 360) + 360) % 360; }

// Signed separation in (-180, 180]. Angles are graded on this, not on raw
// subtraction: 359° and 1° are two degrees apart, not three hundred.
function mgDegDelta(a, b) {
  let d = mgWrapDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

const MG_RAD = Math.PI / 180;
function mgCos(deg) { return Math.cos(deg * MG_RAD); }
function mgSin(deg) { return Math.sin(deg * MG_RAD); }

function mgSign(v) { return v < 0 ? -1 : 1; }
function mgSideWord(s) { return s < 0 ? "left" : "right"; }
const MG_SUB = ["", "₁", "₂", "₃", "₄"];

// Signed value with an explicit + on the positives. Component tables are
// unreadable without it -- a column of bare numbers hides where the sum went.
function mgSigned(v, dp) {
  const s = mgR(v, dp).toFixed(dp);
  return (v >= 0 ? "+" : "") + (s === "-0." + "0".repeat(dp) ? "0." + "0".repeat(dp) : s);
}

/* ============================================================================
   GAME 1 — Balance the rod
   ----------------------------------------------------------------------------
   Positions along the rod are carried as `s`, the SIGNED distance from the
   pivot with rightwards positive. That one choice removes every sign case
   from the physics: a weight at signed offset s exerts torque -m·g·s about
   the pivot (anticlockwise positive), so the whole balance condition is

        Q = Σ mᵢ sᵢ  +  M (L/2 − pivot)  =  0

   in kg·m, with g dividing straight out. The rod's own term is the second
   one, and it vanishes only when the pivot sits at L/2. That is the entire
   difficulty of the harder rounds: it is a term you cannot see hanging on
   the apparatus, and forgetting it produces a specific wrong number rather
   than a vague one.
   ========================================================================== */

const MG_ROD_LENGTHS = [1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0];
const MG_TIP_LIMIT = 1.15;          // rad; the knife-edge stand's own stop

function mgTier(difficulty) {
  if (typeof difficulty === "number") return Math.max(0, Math.min(2, Math.round(difficulty) - 1));
  const key = String(difficulty || "medium").toLowerCase();
  if (key === "easy" || key === "1") return 0;
  if (key === "hard" || key === "3") return 2;
  return 1;
}
const MG_TIER_NAME = ["easy", "medium", "hard"];

function mgTorqueTolerance(kind, answer) {
  // 2% of the quantity, floored at what the apparatus can actually resolve:
  // 5 mm is about where a hanger's index line stops being readable against a
  // metre rule, and 5 g is the smallest slotted mass in the set. A pure
  // percentage tolerance would demand sub-millimetre placement on the short
  // arms, which is not physics, it is eyesight.
  return Math.max(0.02 * Math.abs(answer), kind === "distance" ? 0.005 : 0.005);
}

// Fully worked by hand and checked; used only if the constructor somehow
// exhausts its attempts, so that start() can never return null.
function mgTorqueFallback() {
  const g = mgGravity();
  return mgTorqueFinish({
    game: "torque", difficulty: "medium", tier: 1, g,
    L: 1.2, pivot: 0.45, rodMass: 0.8,
    loads: [{ mass: 1.2, s: -0.3 }],
    unknown: { kind: "distance", side: 1, mass: 0.6 },
  });
}

function mgTorqueMake(difficulty) {
  const tier = mgTier(difficulty);
  const g = mgGravity();

  for (let attempt = 0; attempt < 600; attempt++) {
    const L = mgPick(MG_ROD_LENGTHS);

    // Tier 0 pivots at the centre so the rod's weight genuinely does not
    // enter. Above that the offset is at least 0.15 m: any less and the rod's
    // term is smaller than the tolerance, so "forgot the rod" and "got it
    // right" would be the same answer and the round would teach nothing.
    let pivot;
    if (tier === 0) {
      pivot = mgR(L / 2, 3);
    } else {
      const off = mgPick(mgGrid(0.15, 0.35, 0.05)) * (Math.random() < 0.5 ? -1 : 1);
      pivot = mgR(L / 2 + off, 3);
      if (pivot < 0.3 || L - pivot < 0.3) continue;
    }

    const rodMass = tier === 0
      ? mgPick(mgGrid(0.3, 1.5, 0.1))
      : mgPick(mgGrid(0.4, 2.0, 0.1));

    // Every given load goes on one side and the unknown on the other. Mixed
    // sides are algebraically identical and only invite a sign slip that the
    // grader would score as a physics error when it was bookkeeping.
    const givenSide = Math.random() < 0.5 ? -1 : 1;
    const armGiven = givenSide > 0 ? L - pivot : pivot;
    const nGiven = tier === 2 ? 2 : 1;
    const slots = mgGrid(0.15, mgR(armGiven - 0.05, 2), 0.05);
    if (slots.length < nGiven + 1) continue;

    const loads = [];
    const used = [];
    for (let i = 0; i < nGiven; i++) {
      let d = mgPick(slots);
      let guard = 0;
      while (used.some((u) => Math.abs(u - d) < 0.1) && guard++ < 20) d = mgPick(slots);
      if (used.some((u) => Math.abs(u - d) < 0.1)) break;
      used.push(d);
      loads.push({ mass: mgPick(mgGrid(0.2, 2.0, 0.1)), s: mgR(givenSide * d, 3) });
    }
    if (loads.length !== nGiven) continue;

    const qLoads = mgR(loads.reduce((a, l) => a + l.mass * l.s, 0), 6);
    const qRod = mgR(rodMass * (L / 2 - pivot), 6);
    const q = mgR(qLoads + qRod, 6);

    if (Math.abs(q) < 0.06) continue;                  // already near balance
    if (tier > 0 && Math.abs(qRod) < 0.05) continue;   // rod term must matter

    const side = -mgSign(q);
    const armU = side > 0 ? L - pivot : pivot;
    const dLo = 0.15, dHi = mgR(armU - 0.05, 2);
    if (dHi < dLo + 0.05) continue;

    const kind = Math.random() < 0.5 ? "distance" : "mass";
    const unknown = { kind, side };

    // The rod-ignored answer has to be separated from the true one by several
    // tolerances, or the misconception is unprovable and a student who forgot
    // the rod is marked correct anyway. It only applies where the rod HAS a
    // term: with the pivot at the centre the two routes coincide by physics,
    // and demanding a separation there rejects every tier-0 candidate in turn
    // until the constructor gives up and hands back the fallback round.
    const rodMatters = Math.abs(qRod) > 1e-9;

    if (kind === "distance") {
      // The answer window is fixed FIRST; the hanging mass is then chosen to
      // land the answer inside it. Picking the mass at random and taking
      // whatever distance fell out is what produces answers of 3 mm or of
      // 1.4 m on a rod with 0.6 m of arm left.
      const feasible = mgGrid(0.1, 3.0, 0.1).filter((m) => {
        const d = Math.abs(q) / m;
        if (d < dLo + 0.02 || d > dHi - 0.02) return false;
        if (!rodMatters) return true;
        return Math.abs(Math.abs(qLoads) / m - d) > 3 * mgTorqueTolerance("distance", d);
      });
      if (!feasible.length) continue;
      unknown.mass = mgPick(feasible);
    } else {
      const feasible = mgGrid(dLo, dHi, 0.05).filter((d) => {
        const m = Math.abs(q) / d;
        if (m < 0.2 || m > 3.0) return false;
        if (!rodMatters) return true;
        return Math.abs(Math.abs(qLoads) / d - m) > 3 * mgTorqueTolerance("mass", m);
      });
      if (!feasible.length) continue;
      unknown.s = mgR(side * mgPick(feasible), 3);
    }

    return mgTorqueFinish({
      game: "torque", difficulty: MG_TIER_NAME[tier], tier, g,
      L, pivot, rodMass, loads, unknown,
    });
  }
  return mgTorqueFallback();
}

// Derives everything the round needs from its givens: the moment sums, the
// exact answer, the inertia the release animation will integrate with, and
// the wrong numbers the known mistaken routes lead to.
function mgTorqueFinish(R) {
  R.qLoads = mgR(R.loads.reduce((a, l) => a + l.mass * l.s, 0), 9);
  R.qRod = mgR(R.rodMass * (R.L / 2 - R.pivot), 9);
  R.qGiven = mgR(R.qLoads + R.qRod, 9);

  const u = R.unknown;
  if (u.kind === "distance") {
    u.s = mgR(-R.qGiven / u.mass, 9);
    u.side = mgSign(u.s);
    R.answer = Math.abs(u.s);
    R.answerKey = "d";
    // What the same working gives if the rod is treated as weightless.
    R.wrongNoRod = Math.abs(R.qLoads) / u.mass;
  } else {
    u.mass = mgR(-R.qGiven / u.s, 9);
    u.side = mgSign(u.s);
    R.answer = Math.abs(u.mass);
    R.answerKey = "m";
    R.wrongNoRod = Math.abs(R.qLoads) / Math.abs(u.s);
  }
  R.tolerance = mgTorqueTolerance(u.kind, R.answer);

  // Moment of inertia about the PIVOT, not the centre: the rod through the
  // parallel-axis theorem plus each hanging mass as a point at its own offset.
  // Using the centre-of-rod value would make an off-centre rod swing faster
  // than it can, which is exactly the quantity the reader is being shown.
  R.inertia = (R.rodMass * R.L * R.L) / 12 + R.rodMass * Math.pow(R.L / 2 - R.pivot, 2)
    + R.loads.reduce((a, l) => a + l.mass * l.s * l.s, 0)
    + u.mass * u.s * u.s;
  return R;
}

function mgTorqueLabel(i) { return "Load " + String.fromCharCode(65 + i); }

function mgTorqueView(R) {
  const u = R.unknown;
  const givens = [
    { label: "Rod length", value: R.L, unit: "m" },
    { label: "Rod mass (uniform)", value: R.rodMass, unit: "kg" },
    { label: "Pivot, from the left end", value: R.pivot, unit: "m" },
  ];
  R.loads.forEach((l, i) => {
    givens.push({ label: mgTorqueLabel(i) + " mass", value: mgR(l.mass, 3), unit: "kg" });
    givens.push({
      label: mgTorqueLabel(i) + ", " + mgSideWord(l.s) + " of the pivot",
      value: mgR(Math.abs(l.s), 3), unit: "m",
    });
  });
  if (u.kind === "distance") {
    givens.push({ label: "Hanger to place (" + mgSideWord(u.side) + " side)", value: mgR(u.mass, 3), unit: "kg" });
  } else {
    givens.push({ label: "Free hanger, " + mgSideWord(u.side) + " of the pivot", value: mgR(Math.abs(u.s), 3), unit: "m" });
  }
  givens.push({ label: "g", value: mgR(R.g, 3), unit: "m/s²" });

  const loadText = R.loads.map((l, i) =>
    fmt(l.mass, 2) + " kg at " + fmt(Math.abs(l.s), 2) + " m " + mgSideWord(l.s) + " of the pivot"
  ).join(", and ");

  const ask = u.kind === "distance"
    ? "How far from the pivot, on the " + mgSideWord(u.side) + ", must the " + fmt(u.mass, 2)
      + " kg hanger be placed for the rod to balance?"
    : "What mass must hang at " + fmt(Math.abs(u.s), 2) + " m to the " + mgSideWord(u.side)
      + " of the pivot for the rod to balance?";

  const prompt = "A uniform rod " + fmt(R.L, 2) + " m long and " + fmt(R.rodMass, 2)
    + " kg in mass rests on a knife edge " + fmt(R.pivot, 2) + " m from its left end. "
    + "Hanging from it: " + loadText + ". "
    + (Math.abs(R.qRod) > 1e-9
      ? "The rod is uniform, so its own weight acts at its midpoint — which is not over the pivot. "
      : "The pivot is at the rod's midpoint. ")
    + ask;

  const inputs = u.kind === "distance"
    ? [{ key: "d", label: "Distance from the pivot", unit: "m", step: 0.001, min: 0 }]
    : [{ key: "m", label: "Mass to hang", unit: "kg", step: 0.001, min: 0 }];

  return {
    id: "torque-balance", game: "torque", difficulty: R.difficulty,
    prompt, givens, inputs,
    note: "Take moments about the knife edge. Distances are measured from the pivot, not from the end of the rod.",
  };
}

function mgTorqueSolution(R) {
  const u = R.unknown;
  const lines = [
    "Take moments about the pivot. Measure r to the right of the pivot as positive;",
    "a weight at offset r contributes torque −m·g·r, so g divides out and the",
    "balance condition is simply  Σ m·r = 0.",
    "",
  ];
  lines.push("Rod: " + fmt(R.rodMass, 2) + " kg, centre of mass at r = "
    + mgSigned(R.L / 2 - R.pivot, 3) + " m"
    + (Math.abs(R.qRod) < 1e-9 ? " (over the pivot)" : "")
    + "  →  " + mgSigned(R.qRod, 4) + " kg·m");
  R.loads.forEach((l, i) => {
    lines.push(mgTorqueLabel(i) + ": " + fmt(l.mass, 2) + " kg at r = " + mgSigned(l.s, 3)
      + " m  →  " + mgSigned(l.mass * l.s, 4) + " kg·m");
  });
  lines.push("");
  lines.push("Everything given:  Σ m·r = " + mgSigned(R.qGiven, 4) + " kg·m"
    + "   (× g = " + mgSigned(R.qGiven * R.g, 3) + " N·m)");
  lines.push("The unknown must supply " + mgSigned(-R.qGiven, 4) + " kg·m, i.e. it goes on the "
    + mgSideWord(u.side) + ".");
  if (u.kind === "distance") {
    lines.push("m·d = " + fmt(Math.abs(R.qGiven), 4) + "  →  d = "
      + fmt(Math.abs(R.qGiven), 4) + " / " + fmt(u.mass, 2) + " = " + fmt(R.answer, 3) + " m");
  } else {
    lines.push("m·d = " + fmt(Math.abs(R.qGiven), 4) + "  →  m = "
      + fmt(Math.abs(R.qGiven), 4) + " / " + fmt(Math.abs(u.s), 2) + " = " + fmt(R.answer, 3) + " kg");
  }
  if (Math.abs(R.qRod) > 1e-9) {
    lines.push("");
    lines.push("Drop the rod's own term and you get " + fmt(R.wrongNoRod, 3)
      + (u.kind === "distance" ? " m" : " kg") + " instead — the rod's weight is worth "
      + fmt(Math.abs(R.qRod * R.g), 3) + " N·m here.");
  }
  return lines;
}

/* --- torque grading ------------------------------------------------------- */

// Each entry is a route a student can walk that terminates in a specific
// number. Reporting "wrong, the answer is 0.400" teaches nothing the reader
// could not read off the solution; reporting WHICH plausible route they took
// is the part a marker adds. Order matters -- the first match wins, so the
// diagnostic mistakes come before the arithmetic ones.
function mgTorqueMisconception(R, given) {
  const u = R.unknown;
  const tol = R.tolerance;
  const near = (v) => Number.isFinite(v) && Math.abs(given - v) <= Math.max(tol, 0.01 * Math.abs(v));
  const unit = u.kind === "distance" ? " m" : " kg";

  if (Math.abs(R.qRod) > 1e-9 && near(R.wrongNoRod)) {
    return {
      id: "ignored-rod-weight",
      label: "The rod's own weight was left out",
      value: mgR(R.wrongNoRod, 4),
      detail: "The pivot is " + fmt(Math.abs(R.L / 2 - R.pivot), 2) + " m from the rod's midpoint, so the rod's "
        + fmt(R.rodMass, 2) + " kg weight has a lever arm of its own and contributes "
        + fmt(Math.abs(R.qRod * R.g), 3) + " N·m " + (R.qRod > 0 ? "clockwise" : "anticlockwise")
        + ". Balance the hanging loads alone and you get " + fmt(R.wrongNoRod, 3) + unit + ", which is what you gave.",
    };
  }

  if (u.kind === "distance") {
    const fromLeftEnd = R.pivot + u.side * R.answer;
    const fromRightEnd = (R.L - R.pivot) - u.side * R.answer;
    if (near(fromLeftEnd) || near(fromRightEnd)) {
      return {
        id: "measured-from-the-end",
        label: "Measured from the end of the rod, not from the pivot",
        value: mgR(near(fromLeftEnd) ? fromLeftEnd : fromRightEnd, 4),
        detail: "Your number is the hanger's position along the rod. Moments are taken about the pivot, "
          + "so the lever arm runs from the KNIFE EDGE to the hanger: " + fmt(R.answer, 3) + " m.",
      };
    }
    if (R.loads.length === 1) {
      const inverted = (u.mass * Math.abs(R.loads[0].s)) / R.loads[0].mass;
      if (near(inverted)) {
        return {
          id: "inverted-ratio",
          label: "The mass ratio was applied upside down",
          value: mgR(inverted, 4),
          detail: "Balance sets m₁d₁ = m₂d₂, so the HEAVIER mass sits CLOSER in. "
            + "You divided the other way round; the correct distance is " + fmt(R.answer, 3) + " m.",
        };
      }
      if (near(Math.abs(R.loads[0].s))) {
        return {
          id: "matched-distance",
          label: "Distances matched instead of moments",
          value: mgR(Math.abs(R.loads[0].s), 4),
          detail: "Equal distances balance only equal masses. Here the two masses differ, so the arms must differ too: "
            + fmt(R.answer, 3) + " m.",
        };
      }
    }
  } else {
    const product = Math.abs(R.qGiven) * Math.abs(u.s);
    if (near(product)) {
      return {
        id: "multiplied-not-divided",
        label: "Multiplied by the lever arm instead of dividing",
        value: mgR(product, 4),
        detail: "The unknown must supply " + fmt(Math.abs(R.qGiven), 4) + " kg·m at an arm of "
          + fmt(Math.abs(u.s), 2) + " m, so m = moment ÷ arm = " + fmt(R.answer, 3) + " kg.",
      };
    }
    const massSum = R.loads.reduce((a, l) => a + l.mass, 0);
    if (near(massSum)) {
      return {
        id: "matched-mass",
        label: "Masses matched instead of moments",
        value: mgR(massSum, 4),
        detail: "Equal masses balance only at equal arms. The arms here are different, so the masses must be too: "
          + fmt(R.answer, 3) + " kg.",
      };
    }
  }

  if (near(R.answer * R.g) || near(R.answer / R.g)) {
    return {
      id: "weight-for-mass",
      label: "g was carried into one side of the equation only",
      value: mgR(near(R.answer * R.g) ? R.answer * R.g : R.answer / R.g, 4),
      detail: "Your number is the answer multiplied or divided by g = " + fmt(R.g, 2) + " m/s². "
        + "Every term in Στ = 0 carries the same g, so it cancels completely — balance in kg·m "
        + "and the answer is " + fmt(R.answer, 3) + unit + ".",
    };
  }
  return null;
}

function mgTorqueGrade(R, answers) {
  const key = R.answerKey;
  const raw = answers && (answers[key] !== undefined ? answers[key]
    : (Array.isArray(answers) ? answers[0] : answers.value));
  const given = mgNum(raw);
  const unit = R.unknown.kind === "distance" ? "m" : "kg";
  const tol = R.tolerance;

  if (!Number.isFinite(given)) {
    return {
      correct: false, blank: true,
      verdict: { kind: "miss", text: "Nothing entered" },
      exact: { [key]: mgR(R.answer, 4) },
      tolerance: { [key]: mgR(tol, 4) },
      feedback: "Enter a number before releasing the rod.",
      misconception: null,
      solution: mgTorqueSolution(R),
      results: [],
    };
  }

  const delta = given - R.answer;
  const correct = Math.abs(delta) <= tol;
  const misconception = correct ? null : mgTorqueMisconception(R, given);

  const feedback = correct
    ? "Balanced. Στ = 0 about the knife edge — the rod holds level. Exact answer "
      + fmt(R.answer, 3) + " " + unit + "; you gave " + fmt(given, 3) + " " + unit
      + " (tolerance ±" + fmt(tol, 3) + " " + unit + ")."
    : "The rod tips. Exact answer " + fmt(R.answer, 3) + " " + unit + "; you gave " + fmt(given, 3)
      + " " + unit + ", out by " + fmt(Math.abs(delta), 3) + " " + unit
      + " against a tolerance of ±" + fmt(tol, 3) + " " + unit + ".";

  return {
    correct,
    // Which way it tips is the sign of the error, so the verdict says which
    // rather than just "wrong".
    verdict: correct
      ? { kind: "hit", text: "Balanced" }
      : { kind: delta > 0 ? "over" : "under",
          text: "Tipped " + (delta > 0 ? "left" : "right") },
    exact: { [key]: mgR(R.answer, 4) },
    tolerance: { [key]: mgR(tol, 4) },
    feedback,
    misconception,
    solution: mgTorqueSolution(R),
    results: [{
      key, label: R.unknown.kind === "distance" ? "Distance from the pivot" : "Mass to hang",
      unit, given: mgR(given, 4), exact: mgR(R.answer, 4),
      tolerance: mgR(tol, 4), delta: mgR(delta, 4), ok: correct,
    }],
  };
}

/* ============================================================================
   GAME 2 — Force table
   ----------------------------------------------------------------------------
   Angles are standard position throughout: degrees counter-clockwise from the
   +x axis, which is the 0° graduation on the table. That is stated to the
   reader in the prompt and again on the apparatus, because the single most
   common way to lose this exercise is to work in compass bearings and hand in
   an angle that is (90 − θ) -- an error the grader names rather than marks.
   ========================================================================== */

const MG_RING_MASS = 0.35;   // kg, ring plus the string ends it drags
// The table is not frictionless and the ring is not a point: a residual of a
// few newtons would otherwise cross the whole table between two frames. This
// drag is what actually happens -- the ring scrapes, and the pulleys re-aim as
// it moves -- and it gives the drift a terminal speed proportional to the
// residual, which is precisely the reading the animation is meant to convey.
const MG_RING_DRAG = 1.1;    // N per m/s
const MG_TABLE_R = 0.12;     // m, physical radius the drift is measured against

function mgForceTolerance(mag) {
  // Magnitude gets a percentage with a floor at the resolution of a slotted
  // mass set. The ANGLE gets an absolute tolerance and must: 2% of 350° is
  // seven degrees, which would pass a wrong quadrant, while 2% of 5° is a
  // tenth of a degree, which no protractor on a force table can resolve.
  return { mag: Math.max(0.02 * mag, 0.05), deg: 2.0 };
}

function mgForceFallback() {
  return mgForceFinish({
    game: "forcetable", difficulty: "easy", tier: 0,
    forces: [{ mag: 4.0, deg: 30 }, { mag: 3.0, deg: 150 }],
  });
}

function mgForceMake(difficulty) {
  const tier = mgTier(difficulty);
  const n = tier === 0 ? 2 : 3;
  const angleStep = tier === 2 ? 5 : 15;
  const minSep = tier === 2 ? 25 : 35;

  for (let attempt = 0; attempt < 800; attempt++) {
    // The ANSWER is chosen first. Everything below is the work backwards to a
    // set of pulls that produces it, so the equilibrant can never come out at
    // 0.03 N or at 40 N no matter what the random draw does.
    const targetMag = mgPick(mgGrid(2.0, 7.0, 0.5));
    const targetDeg = mgPick(mgGrid(0, 355, 5));
    // The givens' resultant is the equilibrant reversed.
    let rx = -targetMag * mgCos(targetDeg);
    let ry = -targetMag * mgSin(targetDeg);

    const angles = [];
    for (let i = 0; i < n; i++) {
      let a = null;
      for (let guard = 0; guard < 40 && a === null; guard++) {
        const cand = mgPick(mgGrid(0, 360 - angleStep, angleStep));
        if (angles.every((b) => Math.abs(mgDegDelta(cand, b)) >= minSep)) a = cand;
      }
      if (a === null) break;
      angles.push(a);
    }
    if (angles.length !== n) continue;

    // With three pulls the system is underdetermined, so the third magnitude
    // is a free choice on the nice grid and the remaining two are solved for.
    const forces = [];
    if (n === 3) {
      const m3 = mgPick(mgGrid(1.0, 5.0, 0.5));
      rx -= m3 * mgCos(angles[2]);
      ry -= m3 * mgSin(angles[2]);
      forces[2] = { mag: m3, deg: angles[2] };
    }

    // Solve  F₁cosθ₁ + F₂cosθ₂ = rx,  F₁sinθ₁ + F₂sinθ₂ = ry.
    const det = mgCos(angles[0]) * mgSin(angles[1]) - mgSin(angles[0]) * mgCos(angles[1]);
    if (Math.abs(det) < 0.4) continue;   // nearly parallel: wild magnitudes
    let f1 = (rx * mgSin(angles[1]) - ry * mgCos(angles[1])) / det;
    let f2 = (ry * mgCos(angles[0]) - rx * mgSin(angles[0])) / det;

    // A string over a pulley can only PULL, so a negative solution is the same
    // pull aimed the other way. Reversing it keeps the angle on the grid.
    let d1 = angles[0], d2 = angles[1];
    if (f1 < 0) { f1 = -f1; d1 = mgWrapDeg(d1 + 180); }
    if (f2 < 0) { f2 = -f2; d2 = mgWrapDeg(d2 + 180); }

    // Round the solved magnitudes onto the grid the reader will be shown, and
    // then recompute the answer FROM THE ROUNDED GIVENS. The rounding moves
    // the resultant by at most 0.07 N, so the answer stays in the window that
    // was chosen first, and the printed givens are exactly the numbers the
    // exact answer came from -- no residual for the reader to trip over.
    forces[0] = { mag: mgR(Math.round(f1 * 20) / 20, 2), deg: d1 };
    forces[1] = { mag: mgR(Math.round(f2 * 20) / 20, 2), deg: d2 };
    if (forces.some((f) => f.mag < 0.8 || f.mag > 9.0)) continue;

    // The reversal above can drop two pulls on top of each other.
    let clash = false;
    for (let i = 0; i < forces.length && !clash; i++) {
      for (let j = i + 1; j < forces.length; j++) {
        if (Math.abs(mgDegDelta(forces[i].deg, forces[j].deg)) < 20) { clash = true; break; }
      }
    }
    if (clash) continue;

    const R = mgForceFinish({ game: "forcetable", difficulty: MG_TIER_NAME[tier], tier, forces });
    if (R.answer.mag < 1.0 || R.answer.mag > 9.0) continue;
    // A magnitude that happens to equal the naive scalar sum would make the
    // most common wrong route indistinguishable from the right one.
    if (Math.abs(R.answer.mag - R.sumOfMagnitudes) < 3 * R.tolerance.mag) continue;
    // At 135° and at 315° the compass-bearing angle (90 − θ) lands exactly
    // 180° from the true one, so "you gave the resultant" and "you worked in
    // bearings" are the same number and the feedback would have to guess
    // which mistake was made. Steer the answer away from both.
    if (Math.abs(mgDegDelta(R.answer.deg, 135)) < 6 || Math.abs(mgDegDelta(R.answer.deg, 315)) < 6) continue;
    return R;
  }
  return mgForceFallback();
}

function mgForceFinish(R) {
  R.forces = R.forces.map((f) => ({ mag: mgR(f.mag, 2), deg: mgR(mgWrapDeg(f.deg), 1) }));
  R.comps = R.forces.map((f) => ({ x: f.mag * mgCos(f.deg), y: f.mag * mgSin(f.deg) }));
  R.sumX = R.comps.reduce((a, c) => a + c.x, 0);
  R.sumY = R.comps.reduce((a, c) => a + c.y, 0);
  R.resultant = {
    mag: Math.hypot(R.sumX, R.sumY),
    deg: mgWrapDeg(Math.atan2(R.sumY, R.sumX) / MG_RAD),
  };
  // Equal and opposite to the resultant, by definition of an equilibrant.
  R.answer = {
    mag: R.resultant.mag,
    deg: mgWrapDeg(Math.atan2(-R.sumY, -R.sumX) / MG_RAD),
  };
  R.sumOfMagnitudes = R.forces.reduce((a, f) => a + f.mag, 0);
  R.tolerance = mgForceTolerance(R.answer.mag);
  return R;
}

function mgForceView(R) {
  const givens = [];
  R.forces.forEach((f, i) => {
    givens.push({ label: "F" + MG_SUB[i + 1] + " magnitude", value: mgR(f.mag, 2), unit: "N" });
    givens.push({ label: "F" + MG_SUB[i + 1] + " direction", value: mgR(f.deg, 1), unit: "°" });
  });
  const list = R.forces.map((f, i) => "F" + MG_SUB[i + 1] + " = " + fmt(f.mag, 2)
    + " N at " + fmt(f.deg, 0) + "°").join(", ");

  return {
    id: "force-table", game: "forcetable", difficulty: R.difficulty,
    prompt: R.forces.length + " strings run over pulleys at the rim and pull on the central ring: "
      + list + ". All angles are in standard position — measured counter-clockwise from the +x axis, "
      + "which is the 0° graduation on the table. Find the EQUILIBRANT: the one further pull that "
      + "holds the ring at the centre when the pin is withdrawn. Give its magnitude and its direction.",
    givens,
    inputs: [
      { key: "mag", label: "Equilibrant magnitude", unit: "N", step: 0.01, min: 0 },
      { key: "deg", label: "Equilibrant direction", unit: "°", step: 0.1, min: 0, max: 360 },
    ],
    note: "Angles are standard position: counter-clockwise from +x, 0–360°. "
      + "The equilibrant is equal and opposite to the resultant, not equal to it.",
  };
}

function mgForceSolution(R) {
  const lines = [
    "Resolve every pull onto the axes:  x = F·cosθ,  y = F·sinθ",
    "",
  ];
  R.forces.forEach((f, i) => {
    lines.push("F" + MG_SUB[i + 1] + " = " + fmt(f.mag, 2) + " N at " + fmt(f.deg, 0)
      + "° → x = " + mgSigned(R.comps[i].x, 3)
      + " N, y = " + mgSigned(R.comps[i].y, 3) + " N");
  });
  lines.push("");
  lines.push("ΣFx = " + mgSigned(R.sumX, 3) + " N  ΣFy = " + mgSigned(R.sumY, 3) + " N");
  lines.push("Resultant |R| = √(ΣFx² + ΣFy²) = " + fmt(R.resultant.mag, 3)
    + " N at atan2(ΣFy, ΣFx) = " + fmt(R.resultant.deg, 1) + "°");
  lines.push("");
  lines.push("The equilibrant is equal in size and opposite in direction:");
  lines.push("E = " + fmt(R.answer.mag, 3) + " N at " + fmt(R.answer.deg, 1) + "°"
    + " (" + fmt(R.resultant.deg, 1) + "° + 180°)");
  lines.push("");
  const cx = R.sumX + R.answer.mag * mgCos(R.answer.deg);
  const cy = R.sumY + R.answer.mag * mgSin(R.answer.deg);
  lines.push("Check ΣFx + E·cos" + fmt(R.answer.deg, 1) + "° = " + cx.toExponential(1)
    + " N, ΣFy + E·sin" + fmt(R.answer.deg, 1) + "° = " + cy.toExponential(1) + " N");
  return lines;
}

/* --- force-table grading -------------------------------------------------- */

function mgForceMisconception(R, mag, deg) {
  const tol = R.tolerance;
  const magNear = (v) => Number.isFinite(v) && Math.abs(mag - v) <= Math.max(tol.mag, 0.02 * Math.abs(v));
  const degNear = (v) => Number.isFinite(v) && Math.abs(mgDegDelta(deg, v)) <= Math.max(tol.deg, 3);
  const g = mgGravity();

  // Checked before anything else, because a radian value is a small number and
  // small numbers collide with everything near 0°. An answer of 90° entered as
  // 1.572 sits within three degrees of the 0° a bearing mistake would give, and
  // 185° entered as 3.229 sits within three degrees of that round's resultant —
  // both then get reported as the wrong mistake. Nobody arrives at 1.572 by any
  // route except the conversion, so this diagnosis wins the tie.
  const radians = R.answer.deg * MG_RAD;
  if (Math.abs(deg) < 6.3 && Math.abs(deg - radians) < 0.06) {
    return {
      id: "radians-for-degrees",
      label: "Direction given in radians",
      value: { mag: mgR(mag, 3), deg: mgR(radians, 3) },
      detail: fmt(radians, 3) + " rad is the right direction in the wrong unit. The field wants degrees: "
        + fmt(R.answer.deg, 1) + "°.",
    };
  }

  // The magnitude is right and the direction is reversed: the resultant was
  // handed in where the equilibrant was asked for. The single most common
  // outcome of this experiment, and worth naming every time.
  if (magNear(R.answer.mag) && degNear(R.resultant.deg)) {
    return {
      id: "resultant-not-equilibrant",
      label: "That is the resultant, not the equilibrant",
      value: { mag: mgR(R.resultant.mag, 3), deg: mgR(R.resultant.deg, 1) },
      detail: "The size is right. The resultant is the pull the three strings already exert, "
        + fmt(R.resultant.deg, 1) + "°; the equilibrant is what CANCELS it, so it points 180° the other way, at "
        + fmt(R.answer.deg, 1) + "°. Add your vector to the strings and the ring is pulled twice as hard.",
    };
  }

  // Components taken as x = F sinθ, y = F cosθ -- angle measured clockwise
  // from +y, i.e. a compass bearing. The magnitude survives; the angle
  // reflects about 45°.
  const bearing = mgWrapDeg(90 - R.answer.deg);
  if (magNear(R.answer.mag) && degNear(bearing)) {
    return {
      id: "bearing-not-standard-position",
      label: "Angle measured clockwise from the +y axis",
      value: { mag: mgR(R.answer.mag, 3), deg: mgR(bearing, 1) },
      detail: "Your angle is 90° − the correct one, which is what comes out of x = F·sinθ, "
        + "y = F·cosθ — a compass bearing. This table reads standard position: counter-clockwise "
        + "from +x. The direction is " + fmt(R.answer.deg, 1) + "°.",
    };
  }

  if (magNear(R.sumOfMagnitudes)) {
    return {
      id: "added-magnitudes",
      label: "Magnitudes added as if they were numbers",
      value: { mag: mgR(R.sumOfMagnitudes, 3), deg: mgR(deg, 1) },
      detail: fmt(R.forces[0].mag, 2) + " + " + R.forces.slice(1).map((f) => fmt(f.mag, 2)).join(" + ")
        + " = " + fmt(R.sumOfMagnitudes, 2) + " N is the arithmetic sum. Forces add head to tail, so the "
        + "pulls partly cancel and the equilibrant is only " + fmt(R.answer.mag, 3) + " N.",
    };
  }

  if (magNear(R.answer.mag / g)) {
    return {
      id: "mass-not-force",
      label: "That is the hanging mass, not the force",
      value: { mag: mgR(R.answer.mag / g, 3), deg: mgR(deg, 1) },
      detail: "You gave " + fmt(R.answer.mag / g, 3) + ", which is the answer divided by g = " + fmt(g, 2)
        + " m/s² — the kilograms you would hang on the pan. The question asks for the force: "
        + fmt(R.answer.mag, 3) + " N.",
    };
  }

  const meanDeg = mgWrapDeg(R.forces.reduce((a, f) => a + f.deg, 0) / R.forces.length);
  if (degNear(meanDeg) || degNear(mgWrapDeg(meanDeg + 180))) {
    return {
      id: "averaged-the-angles",
      label: "The given angles were averaged",
      value: { mag: mgR(mag, 3), deg: mgR(deg, 1) },
      detail: "The mean of the given directions is " + fmt(meanDeg, 1) + "°, but direction is not an "
        + "average — a strong pull swings the resultant toward itself. Resolve into components first; "
        + "the equilibrant lies at " + fmt(R.answer.deg, 1) + "°.",
    };
  }
  return null;
}

function mgForceGrade(R, answers) {
  const src = answers || {};
  const magIn = mgNum(src.mag !== undefined ? src.mag : (Array.isArray(src) ? src[0] : src.magnitude));
  const degIn = mgNum(src.deg !== undefined ? src.deg : (Array.isArray(src) ? src[1] : src.angle));
  const tol = R.tolerance;
  const exact = { mag: mgR(R.answer.mag, 3), deg: mgR(R.answer.deg, 2) };
  const tolOut = { mag: mgR(tol.mag, 3), deg: tol.deg };

  if (!Number.isFinite(magIn) || !Number.isFinite(degIn)) {
    return {
      correct: false, blank: true, exact, tolerance: tolOut,
      verdict: { kind: "miss", text: "Nothing entered" },
      feedback: "Both a magnitude and a direction are needed before the pin can be withdrawn.",
      misconception: null, solution: mgForceSolution(R), results: [],
    };
  }

  const dMag = magIn - R.answer.mag;
  const dDeg = mgDegDelta(degIn, R.answer.deg);
  const magOk = Math.abs(dMag) <= tol.mag;
  const degOk = Math.abs(dDeg) <= tol.deg;
  const correct = magOk && degOk;
  const misconception = correct ? null : mgForceMisconception(R, magIn, mgWrapDeg(degIn));

  let feedback;
  if (correct) {
    feedback = "The ring holds. ΣF = 0 with your equilibrant added. Exact answer "
      + fmt(R.answer.mag, 3) + " N at " + fmt(R.answer.deg, 1) + "°; you gave " + fmt(magIn, 3)
      + " N at " + fmt(mgWrapDeg(degIn), 1) + "° (tolerance ±" + fmt(tol.mag, 3)
      + " N and ±" + fmt(tol.deg, 1) + "°).";
  } else {
    const parts = [];
    if (!magOk) parts.push("the magnitude is out by " + fmt(Math.abs(dMag), 3) + " N (±" + fmt(tol.mag, 3) + " N allowed)");
    if (!degOk) parts.push("the direction is out by " + fmt(Math.abs(dDeg), 1) + "° (±" + fmt(tol.deg, 1) + "° allowed)");
    feedback = "The ring drifts — " + parts.join(", and ") + ". Exact answer "
      + fmt(R.answer.mag, 3) + " N at " + fmt(R.answer.deg, 1) + "°.";
  }

  return {
    correct, exact, tolerance: tolOut, feedback, misconception,
    // Two quantities can be wrong here, so name the one that failed rather
    // than reporting a direction that only describes half the answer.
    verdict: correct
      ? { kind: "hit", text: "The ring holds" }
      : { kind: "miss",
          text: !magOk && !degOk ? "Ring pulled off — magnitude and direction"
            : !magOk ? "Ring pulled off — magnitude out by " + fmt(Math.abs(dMag), 2) + " N"
              : "Ring pulled off — direction out by " + fmt(Math.abs(dDeg), 1) + "\u00b0" },
    solution: mgForceSolution(R),
    results: [
      { key: "mag", label: "Equilibrant magnitude", unit: "N", given: mgR(magIn, 3), exact: exact.mag, tolerance: tolOut.mag, delta: mgR(dMag, 3), ok: magOk },
      { key: "deg", label: "Equilibrant direction", unit: "°", given: mgR(mgWrapDeg(degIn), 2), exact: exact.deg, tolerance: tolOut.deg, delta: mgR(dDeg, 2), ok: degOk },
    ],
  };
}

/* ============================================================================
   Post-submit animation
   ----------------------------------------------------------------------------
   Both animations are integrated forward from the reader's own number. The one
   deliberate exception: an answer INSIDE the tolerance is animated with the
   residual set to exactly zero. A 2% error on a 5 N resultant is a tenth of a
   newton, enough to walk the ring off the table in a couple of seconds, and
   telling a reader "correct" while the apparatus visibly fails is a worse lie
   than idealising the last two percent away. The data plate says so on screen.
   ========================================================================== */

const MG_SUB_STEP = 1 / 240;
const MG_MAX_DT = 0.05;      // a backgrounded tab hands back multi-second dt

function mgStartTorqueAnim(R, grade, answers) {
  const key = R.answerKey;
  const raw = answers && answers[key] !== undefined ? answers[key] : (Array.isArray(answers) ? answers[0] : undefined);
  let given = mgNum(raw);
  if (!Number.isFinite(given)) given = R.answer;

  const u = R.unknown;
  let sUser, mUser;
  if (u.kind === "distance") {
    sUser = u.side * Math.abs(given);
    // A distance longer than the arm would put the hanger off the end of the
    // rod; clamp so the drawing stays on the apparatus while the physics keeps
    // the reader's actual lever arm.
    mUser = u.mass;
  } else {
    sUser = u.s;
    mUser = Math.abs(given);
  }

  const q = grade.correct ? 0 : mgR(R.qGiven + mUser * sUser, 9);
  const inertia = (R.rodMass * R.L * R.L) / 12 + R.rodMass * Math.pow(R.L / 2 - R.pivot, 2)
    + R.loads.reduce((a, l) => a + l.mass * l.s * l.s, 0)
    + mUser * sUser * sUser;

  return {
    kind: "torque", phase: "release", t: 0, phaseT: 0,
    theta: 0, omega: 0, alpha: 0,
    q, inertia: Math.max(inertia, 1e-4),
    idealised: grade.correct && Math.abs(mgR(R.qGiven + mUser * sUser, 9)) > 1e-9,
    userMass: mUser, userS: sUser, correct: grade.correct, tipped: false,
  };
}

function mgStepTorque(A, R, dt) {
  A.t += dt;
  A.phaseT += dt;
  if (A.phase === "release") {
    // The support clamps are drawn retracting through this window. Releasing
    // the rod on the same frame the answer is submitted reads as a glitch.
    if (A.phaseT >= 0.45) { A.phase = A.correct ? "hold" : "swing"; A.phaseT = 0; }
    return true;
  }
  if (A.phase === "hold") {
    if (A.phaseT >= (A.correct ? 2.4 : 1.2)) { A.phase = "done"; return false; }
    return true;
  }
  if (A.phase !== "swing") return false;

  const g = R.g;
  // A light drag at the knife edge, scaled to the round's own restoring
  // torque so the same fraction of critical damping applies whether the rod
  // is 0.02 kg·m out or 0.6 -- without it a badly unbalanced rod skips its
  // stop between two frames and the tip is never seen.
  const c = 0.25 * Math.sqrt(A.inertia * g * Math.abs(A.q) + 1e-9);

  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(MG_SUB_STEP, left);
    // I·α = Στ = −g·cos θ·Σm·r, the horizontal lever arms shortening as the
    // rod turns. Semi-implicit Euler: velocity first, then position, which
    // does not pump energy into an oscillation the way explicit Euler does.
    A.alpha = (-g * Math.cos(A.theta) * A.q - c * A.omega) / A.inertia;
    A.omega += A.alpha * h;
    A.theta += A.omega * h;
    left -= h;
    if (Math.abs(A.theta) >= MG_TIP_LIMIT) {
      A.theta = Math.sign(A.theta) * MG_TIP_LIMIT;
      A.omega = 0;
      A.tipped = true;
      A.phase = "hold";
      A.phaseT = 0;
      return true;
    }
  }
  if (A.t > 6) { A.phase = "done"; return false; }
  return true;
}

function mgStartForceAnim(R, grade, answers) {
  const src = answers || {};
  let mag = mgNum(src.mag !== undefined ? src.mag : (Array.isArray(src) ? src[0] : src.magnitude));
  let deg = mgNum(src.deg !== undefined ? src.deg : (Array.isArray(src) ? src[1] : src.angle));
  if (!Number.isFinite(mag)) mag = R.answer.mag;
  if (!Number.isFinite(deg)) deg = R.answer.deg;
  deg = mgWrapDeg(deg);

  const fx = grade.correct ? 0 : mgR(R.sumX + mag * mgCos(deg), 9);
  const fy = grade.correct ? 0 : mgR(R.sumY + mag * mgSin(deg), 9);

  return {
    kind: "forcetable", phase: "pin", t: 0, phaseT: 0,
    x: 0, y: 0, vx: 0, vy: 0,
    fx, fy, residual: Math.hypot(fx, fy),
    idealised: grade.correct && Math.hypot(R.sumX + mag * mgCos(deg), R.sumY + mag * mgSin(deg)) > 1e-9,
    userMag: mag, userDeg: deg, correct: grade.correct, escaped: false,
  };
}

function mgStepForce(A, R, dt) {
  A.t += dt;
  A.phaseT += dt;
  if (A.phase === "pin") {
    if (A.phaseT >= 0.5) { A.phase = A.correct ? "hold" : "slide"; A.phaseT = 0; }
    return true;
  }
  if (A.phase === "hold") {
    if (A.phaseT >= (A.correct ? 2.4 : 1.2)) { A.phase = "done"; return false; }
    return true;
  }
  if (A.phase !== "slide") return false;

  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(MG_SUB_STEP, left);
    const ax = (A.fx - MG_RING_DRAG * A.vx) / MG_RING_MASS;
    const ay = (A.fy - MG_RING_DRAG * A.vy) / MG_RING_MASS;
    A.vx += ax * h; A.vy += ay * h;
    A.x += A.vx * h; A.y += A.vy * h;
    left -= h;
    const r = Math.hypot(A.x, A.y);
    if (r >= MG_TABLE_R * 0.88) {
      const k = (MG_TABLE_R * 0.88) / (r || 1);
      A.x *= k; A.y *= k;
      A.vx = 0; A.vy = 0;
      A.escaped = true;
      A.phase = "hold";
      A.phaseT = 0;
      return true;
    }
  }
  if (A.t > 6) { A.phase = "done"; return false; }
  return true;
}

/* ============================================================================
   Drawing
   ----------------------------------------------------------------------------
   Same plate conventions as animate.js: ink outlines, hatched shading, crimson
   for forces, navy for kinematic quantities, brass for the reader's own input.
   Every radius is floored before it reaches ctx.arc -- a canvas one pixel
   across is a real state during a layout pass, and a negative radius throws
   IndexSizeError rather than drawing nothing.
   ========================================================================== */

function mgClampR(r, lo) { return Math.max(r, lo === undefined ? 0.5 : lo); }

// Below this the diagram is a thumbnail: labels, rulers and the data plate are
// noise, so they are dropped rather than overprinted into an unreadable smear.
function mgCompact(w, h) { return w < 340 || h < 240; }

function mgDrawEmpty(ctx, w, h) {
  if (w < 40 || h < 24) return;
  drawCaption(ctx, w / 2, h / 2, "Choose an experiment to begin", PALETTE.inkSoft, 12);
}

// A slotted-mass hanger: the stack of discs on a stem, drawn to a size that
// tracks the mass without letting a 3 kg load swallow the rod.
function mgDrawHanger(ctx, x, y, mass, color, tag, compact) {
  const bw = clamp(10 + Math.cbrt(Math.max(mass, 0.02)) * 12, 6, 34);
  const bh = clamp(bw * 0.62, 4, 22);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = PALETTE.panel;
  ctx.lineWidth = 1.6;
  roundRect(ctx, x - bw / 2, y, bw, bh, Math.min(2.5, bh * 0.3));
  ctx.fill();
  ctx.stroke();
  ctx.save();
  roundRect(ctx, x - bw / 2, y, bw, bh, Math.min(2.5, bh * 0.3));
  ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let d = -bw; d < bw; d += 4) {
    ctx.beginPath();
    ctx.moveTo(x + d, y + bh);
    ctx.lineTo(x + d + bh, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  if (!compact && tag) drawCaption(ctx, x, y + bh + 10, tag, color, 10.5);
  return bh;
}

function mgDrawTorque(ctx, w, h, R, A, result) {
  const compact = mgCompact(w, h);
  const theta = A ? A.theta : 0;
  const u = R.unknown;

  const pivotY = h * 0.38;
  const baseY = h * 0.86;
  const scale = clamp((w * 0.82) / Math.max(R.L, 0.2), 1, 600);
  const cx = w / 2 - (R.L / 2 - R.pivot) * scale;
  const rodH = clamp(h * 0.042, 1.5, 15);
  const ct = Math.cos(theta), st = Math.sin(theta);
  // Rod-local offset s (m, +right) to canvas. Canvas y runs down, so a
  // positive (anticlockwise) tilt must LIFT the right-hand end.
  const px = (s) => cx + s * scale * ct;
  const py = (s) => pivotY - s * scale * st;

  /* --- stand ------------------------------------------------------------- */
  const standW = clamp(w * 0.09, 5, 54);
  ctx.save();
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx, pivotY + rodH * 0.4);
  ctx.lineTo(cx + standW / 2, baseY);
  ctx.lineTo(cx - standW / 2, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - standW * 0.9, baseY);
  ctx.lineTo(cx + standW * 0.9, baseY);
  ctx.stroke();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1;
  for (let x = cx - standW * 0.9; x <= cx + standW * 0.9; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x - 6, baseY + 7);
    ctx.stroke();
  }

  /* --- rod --------------------------------------------------------------- */
  const sL = -R.pivot, sRt = R.L - R.pivot;
  ctx.save();
  ctx.translate(cx, pivotY);
  ctx.rotate(-theta);   // canvas rotation is clockwise-positive
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  roundRect(ctx, sL * scale, -rodH / 2, (sRt - sL) * scale, rodH, Math.min(2.5, rodH * 0.3));
  ctx.fill();
  ctx.stroke();
  ctx.save();
  roundRect(ctx, sL * scale, -rodH / 2, (sRt - sL) * scale, rodH, Math.min(2.5, rodH * 0.3));
  ctx.clip();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1;
  for (let d = sL * scale; d < sRt * scale; d += 6) {
    ctx.beginPath();
    ctx.moveTo(d, rodH / 2);
    ctx.lineTo(d + rodH, -rodH / 2);
    ctx.stroke();
  }
  ctx.restore();
  // Graduations every 0.1 m along the rod itself, which is what a metre rule
  // on a knife edge actually looks like and what the distances are read off.
  if (!compact) {
    ctx.strokeStyle = PALETTE.rule;
    ctx.lineWidth = 1;
    for (let s = Math.ceil(sL * 10) / 10; s <= sRt + 1e-9; s = mgR(s + 0.1, 3)) {
      const major = Math.abs(mgR(s * 10, 3) % 5) < 1e-6;
      ctx.beginPath();
      ctx.moveTo(s * scale, -rodH / 2);
      ctx.lineTo(s * scale, -rodH / 2 - (major ? 6 : 3));
      ctx.stroke();
    }
  }
  ctx.restore();

  // Knife edge and its pivot dot, drawn after the rod so the rod does not
  // cover the fulcrum the whole exercise is about.
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.arc(cx, pivotY, mgClampR(Math.min(4, rodH * 0.4), 1), 0, Math.PI * 2);
  ctx.fill();
  if (!compact) drawCaption(ctx, cx, baseY + 20, "pivot · " + fmt(R.pivot, 2) + " m from left end", PALETTE.inkSoft, 10.5);

  /* --- rod's own weight --------------------------------------------------- */
  const sCom = R.L / 2 - R.pivot;
  const comX = px(sCom), comY = py(sCom);
  const arrow = clamp(h * 0.11, 6, 46);
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.arc(comX, comY, mgClampR(Math.min(3, rodH * 0.3), 0.8), 0, Math.PI * 2);
  ctx.fill();
  if (h > 90) {
    drawArrow(ctx, comX, comY, comX, comY + arrow, PALETTE.crimson, 1.8);
    if (!compact) {
      drawCaption(ctx, comX, comY + arrow + 10, "Mg = " + fmt(R.rodMass * R.g, 1) + " N", PALETTE.crimson, 10);
      if (Math.abs(sCom) > 1e-9) {
        drawDashedLine(ctx, cx, pivotY - rodH, comX, comY - rodH, PALETTE.brass, 1, [3, 3]);
      }
    }
  }

  /* --- hanging loads ------------------------------------------------------ */
  const hangLen = clamp(h * 0.22, 6, 108);
  const drawLoad = (s, mass, color, label) => {
    const ax = px(s), ay = py(s);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax, ay + hangLen);   // strings hang vertically whatever the rod does
    ctx.stroke();
    mgDrawHanger(ctx, ax, ay + hangLen, mass, color,
      label + " · " + fmt(mass, 2) + " kg", compact);
    if (!compact && h > 150) {
      drawCaption(ctx, ax, ay - 12, fmt(Math.abs(s), 2) + " m", PALETTE.inkSoft, 10);
    }
  };
  R.loads.forEach((l, i) => drawLoad(l.s, l.mass, PALETTE.crimson, mgTorqueLabel(i)));

  /* --- the reader's hanger ------------------------------------------------ */
  if (A) {
    drawLoad(A.userS, A.userMass, PALETTE.brass, "yours");
  } else {
    // Before submitting, the unknown is a ghost at a neutral position: enough
    // apparatus to see what is being asked, no hint about where it goes.
    const sGhost = u.kind === "distance"
      ? u.side * (u.side > 0 ? (R.L - R.pivot) : R.pivot) * 0.55
      : u.s;
    const gx = px(sGhost), gy = py(sGhost);
    drawDashedLine(ctx, gx, gy, gx, gy + hangLen, PALETTE.brass, 1.2, [3, 4]);
    ctx.save();
    ctx.setLineDash([3, 3]);
    const bw = clamp(18, 6, 30);
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(gx - bw / 2, gy + hangLen, bw, clamp(bw * 0.62, 4, 20));
    ctx.restore();
    if (!compact) {
      drawLabel(ctx, gx, gy + hangLen + clamp(bw * 0.62, 4, 20) / 2, "?", PALETTE.brass, 13);
      drawCaption(ctx, gx, gy + hangLen + 30,
        u.kind === "distance" ? fmt(u.mass, 2) + " kg · d = ?" : "? kg at " + fmt(Math.abs(u.s), 2) + " m",
        PALETTE.brass, 10.5);
    }
  }

  /* --- instrument plate ---------------------------------------------------- */
  if (compact) return;
  const lines = [];
  if (A) {
    const tau = -R.g * Math.cos(A.theta) * A.q;
    lines.push("Στ = " + fmt(tau, 3) + " N·m");
    lines.push("I  = " + fmt(A.inertia, 4) + " kg·m²");
    lines.push("α  = " + fmt(A.alpha, 3) + " rad/s²");
    lines.push("θ  = " + fmt(A.theta / MG_RAD, 1) + "°");
    if (A.tipped) lines.push("— rod against its stop");
    else if (A.correct && A.phase !== "release") lines.push("— level, released");
    if (A.idealised) lines.push("(within tolerance: Στ taken as 0)");
  } else {
    lines.push("L = " + fmt(R.L, 2) + " m   M = " + fmt(R.rodMass, 2) + " kg");
    lines.push("pivot at " + fmt(R.pivot, 2) + " m of " + fmt(R.L, 2) + " m");
    lines.push("g = " + fmt(R.g, 2) + " m/s²");
  }
  const plateW = clamp(w * 0.34, 120, 210);
  if (w > plateW + 24 && h > 120) drawDataPlate(ctx, 12, 12, plateW, lines);
  if (result && !result.blank) {
    drawLabel(ctx, w - 12, 22, result.correct ? "BALANCED" : "TIPPED",
      result.correct ? PALETTE.forest : PALETTE.crimson, 13, "right");
  }
}

function mgDrawForceTable(ctx, w, h, R, A, result) {
  const compact = mgCompact(w, h);
  const cx = w / 2, cy = h / 2;
  const Rpx = mgClampR(Math.min(w, h) * 0.34, 3);
  const pxPerM = Rpx / MG_TABLE_R;
  // Standard position on a canvas whose y runs downward: the sign flip here
  // is the only place the convention is applied, so nothing downstream has to
  // remember it.
  const X = (deg, r) => cx + r * mgCos(deg);
  const Y = (deg, r) => cy - r * mgSin(deg);

  /* --- table ------------------------------------------------------------- */
  ctx.save();
  ctx.fillStyle = PALETTE.panel;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, Rpx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (!compact) {
    ctx.strokeStyle = PALETTE.rule;
    for (let d = 0; d < 360; d += 10) {
      const major = d % 30 === 0;
      ctx.lineWidth = major ? 1.3 : 0.8;
      ctx.beginPath();
      ctx.moveTo(X(d, Rpx), Y(d, Rpx));
      ctx.lineTo(X(d, Rpx - (major ? 10 : 5)), Y(d, Rpx - (major ? 10 : 5)));
      ctx.stroke();
    }
    for (let d = 0; d < 360; d += 30) {
      drawCaption(ctx, X(d, Rpx - 21), Y(d, Rpx - 21), String(d), PALETTE.inkSoft, 9.5);
    }
    // The +x axis is the datum the whole exercise is quoted against; drawing
    // it removes any doubt about which way 0° points on this apparatus.
    drawDashedLine(ctx, cx, cy, X(0, Rpx + 14), Y(0, Rpx + 14), PALETTE.brass, 1, [4, 4]);
    drawCaption(ctx, X(0, Rpx + 30), Y(0, Rpx + 30), "0° / +x", PALETTE.brass, 10);
  }

  /* --- pulleys, strings, pans ---------------------------------------------- */
  const ringX = cx + (A ? A.x * pxPerM : 0);
  const ringY = cy - (A ? A.y * pxPerM : 0);
  const maxMag = Math.max(R.sumOfMagnitudes / R.forces.length, ...R.forces.map((f) => f.mag),
    A ? A.userMag : R.answer.mag, 0.5);
  const arrowFor = (mag) => clamp((mag / maxMag) * Rpx * 0.72, 2, Rpx * 0.95);

  const drawPull = (deg, mag, color, tag, dashed) => {
    const wheelR = mgClampR(Math.min(7, Rpx * 0.09), 1);
    const pxx = X(deg, Rpx), pyy = Y(deg, Rpx);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    if (dashed) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(ringX, ringY);
    ctx.lineTo(pxx, pyy);
    ctx.stroke();
    ctx.restore();
    drawWheel(ctx, pxx, pyy, wheelR, deg * MG_RAD, color);
    if (!compact) {
      // Over the pulley and down: the hanging pan is what sets the tension,
      // and without it the diagram is a vector plot rather than an apparatus.
      const hx = X(deg, Rpx + wheelR + 4), hy = Y(deg, Rpx + wheelR + 4);
      const drop = clamp(h * 0.07, 6, 30);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx, hy + drop);
      ctx.stroke();
      mgDrawHanger(ctx, hx, hy + drop, mag / mgGravity(), color, tag, compact);
    }
    drawArrow(ctx, ringX, ringY, ringX + arrowFor(mag) * mgCos(deg),
      ringY - arrowFor(mag) * mgSin(deg), color, dashed ? 1.8 : 2.4);
  };

  R.forces.forEach((f, i) => {
    drawPull(f.deg, f.mag, PALETTE.crimson,
      "F" + MG_SUB[i + 1] + " " + fmt(f.mag, 2) + " N · " + fmt(f.deg, 0) + "°", false);
  });
  if (A) {
    drawPull(A.userDeg, A.userMag, PALETTE.brass,
      "E " + fmt(A.userMag, 2) + " N · " + fmt(A.userDeg, 0) + "°", false);
  } else if (!compact) {
    drawCaption(ctx, cx, cy + Rpx * 0.55, "equilibrant: ? N at ?°", PALETTE.brass, 11);
  }

  /* --- residual and ring --------------------------------------------------- */
  if (A && A.residual > 1e-9) {
    const deg = Math.atan2(A.fy, A.fx) / MG_RAD;
    const len = clamp((A.residual / maxMag) * Rpx * 0.72, 8, Rpx * 0.9);
    drawArrow(ctx, ringX, ringY, ringX + len * mgCos(deg), ringY - len * mgSin(deg), PALETTE.navy, 3);
    if (!compact) {
      drawCaption(ctx, ringX + (len + 22) * mgCos(deg), ringY - (len + 22) * mgSin(deg),
        "ΣF = " + fmt(A.residual, 2) + " N", PALETTE.navy, 10.5);
    }
  }

  const ringR = mgClampR(Math.min(13, Rpx * 0.17), 1.5);
  ctx.save();
  ctx.strokeStyle = A && A.escaped ? PALETTE.crimson : PALETTE.ink;
  ctx.lineWidth = mgClampR(ringR * 0.32, 0.8);
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // The centre pin is what the ring is being tested against; it is withdrawn
  // during the first phase of the animation and gone thereafter.
  const pinOut = A ? clamp(A.phase === "pin" ? A.phaseT / 0.5 : 1, 0, 1) : 0;
  if (pinOut < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - pinOut;
    ctx.fillStyle = PALETTE.brass;
    ctx.beginPath();
    ctx.arc(cx, cy, mgClampR(ringR * 0.34, 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (A && pinOut >= 1) {
    drawDashedLine(ctx, cx - ringR, cy, cx + ringR, cy, PALETTE.rule, 1, [2, 3]);
    drawDashedLine(ctx, cx, cy - ringR, cx, cy + ringR, PALETTE.rule, 1, [2, 3]);
  }

  /* --- instrument plate ---------------------------------------------------- */
  if (compact) return;
  const lines = [];
  if (A) {
    lines.push("ΣFx = " + mgSigned(A.fx, 3) + " N");
    lines.push("ΣFy = " + mgSigned(A.fy, 3) + " N");
    lines.push("|ΣF| = " + fmt(A.residual, 3) + " N");
    lines.push("drift = " + fmt(Math.hypot(A.x, A.y) * 100, 1) + " cm");
    if (A.escaped) lines.push("— ring off the centre");
    else if (A.correct && A.phase !== "pin") lines.push("— ring holds, pin out");
    if (A.idealised) lines.push("(within tolerance: ΣF taken as 0)");
  } else {
    // The equilibrant is minus this resultant: printing the components hands
    // over both the magnitude (hypot) and the bearing (atan2) with no physics.
    lines.push("ΣFx, ΣFy — resolve them yourself");
    lines.push("angles: standard position");
  }
  const plateW = clamp(w * 0.34, 120, 210);
  if (w > plateW + 24 && h > 120) drawDataPlate(ctx, 12, 12, plateW, lines);
  if (result && !result.blank) {
    drawLabel(ctx, w - 12, 22, result.correct ? "IN EQUILIBRIUM" : "RING DRIFTS",
      result.correct ? PALETTE.forest : PALETTE.crimson, 13, "right");
  }
}

/* ============================================================================
   Public surface
   ========================================================================== */

const MiniGames = (function () {
  const CATALOGUE = [
    {
      id: "torque-balance",
      group: "Rotation",
      name: "Balance the rod",
      blurb: "A metre rule on a knife edge that is not always at its centre. Work out where the "
        + "hanger goes — or what it must weigh — then release the rod and watch whether it holds.",
    },
    {
      id: "force-table",
      group: "Forces & Newton's laws",
      name: "Force table",
      blurb: "Strings over pulleys pull a ring from two or three directions. Compute the equilibrant, "
        + "magnitude and bearing, then pull the pin and see whether the ring stays put.",
    },
  ];

  // Kept so Replay can rebuild the animation from the reader's OWN numbers.
  // Re-deriving it from the exact answer would replay a apparatus that works,
  // which is precisely the apparatus they did not describe.
  let lastAnswers = null;
  let round = null;      // the generated round, with its exact answer
  let view = null;       // the display-safe projection handed to the caller
  let result = null;     // the last grading
  let anim = null;       // post-submit animation state, or null

  function start(id, difficulty) {
    reset();
    if (id === "force-table" || id === "forcetable") {
      round = mgForceMake(difficulty);
      view = mgForceView(round);
    } else if (id === "torque-balance" || id === "torque") {
      round = mgTorqueMake(difficulty);
      view = mgTorqueView(round);
    } else {
      return null;
    }
    return view;
  }

  function submit(answers) {
    if (!round) return { correct: false, blank: true, verdict: { kind: "miss", text: "No round in progress" }, exact: {}, tolerance: {}, feedback: "No round in progress.", misconception: null, solution: [], results: [] };
    lastAnswers = answers;
    result = round.game === "torque" ? mgTorqueGrade(round, answers) : mgForceGrade(round, answers);
    // A blank field is not a wrong answer; nothing is released and the reader
    // can fill it in without losing the round.
    anim = result.blank ? null
      : (round.game === "torque" ? mgStartTorqueAnim(round, result, answers) : mgStartForceAnim(round, result, answers));
    return result;
  }

  function tick(dt) {
    if (!anim || anim.phase === "done") return false;
    const step = clamp(Number(dt) || 0, 0, MG_MAX_DT);
    if (step <= 0) return true;
    return anim.kind === "torque" ? mgStepTorque(anim, round, step) : mgStepForce(anim, round, step);
  }

  function draw(ctx, w, h) {
    if (!ctx) return;
    const width = Math.max(Number(w) || 0, 1);
    const height = Math.max(Number(h) || 0, 1);
    ctx.save();
    try {
      if (!round) mgDrawEmpty(ctx, width, height);
      else if (round.game === "torque") mgDrawTorque(ctx, width, height, round, anim, result);
      else mgDrawForceTable(ctx, width, height, round, anim, result);
    } finally {
      // A renderer that throws mid-path would otherwise leave a clip or a
      // transform on the context for whatever paints next.
      ctx.restore();
    }
  }

  function reset() {
    round = null;
    view = null;
    result = null;
    anim = null;
  }

  function play() {
    if (!round || !result || result.blank) return false;
    anim = round.game === "torque"
      ? mgStartTorqueAnim(round, result, lastAnswers)
      : mgStartForceAnim(round, result, lastAnswers);
    return true;
  }

  return {
    list: () => CATALOGUE.map((g) => ({ id: g.id, name: g.name, blurb: g.blurb, group: g.group })),
    start,
    play,
    round: () => view,
    submit,
    draw,
    tick,
    reset,

    // --- accessors the host UI needs, none of which leak the answer --------
    phase: () => (!round ? "idle" : result && !result.blank ? "graded" : "posed"),
    animating: () => !!anim && anim.phase !== "done",
    result: () => result,
    solution: () => (result ? result.solution : null),
    difficulties: () => ["easy", "medium", "hard"],
  };
})();
