/* ============================================================================
   demo games — five lecture demonstrations, each with a number attached
   ----------------------------------------------------------------------------
   These are the five demonstrations a mechanics course actually performs in
   front of a room, chosen because in every one of them the honest prediction
   and the intuitive one disagree:

     the spool and the thread   pull the thread flat and it rolls TOWARD you
     the tablecloth pull        a slower pull moves the dish FURTHER
     the ball at your nose      it comes back to exactly where it left, and no
                                further, unless somebody pushes it
     Newton's cradle            momentum alone permits two out at half speed;
                                energy is what forbids it
     the rotating station       a BIGGER ring spins SLOWER

   The same three rules run through the whole file as through the rest of the
   family, and every awkward-looking decision below is one of them being obeyed.

   1. A round is BUILT BACKWARDS. The window the answer must land in is fixed
      first; then one given — the tension, the circle radius, the push speed —
      is solved for, snapped to the precision it will be PRINTED at, and the
      answer recomputed from the snapped number. The table and the grader are
      then reading the same digits.

   2. The reveal is integrated from the READER'S number. The spool rolls at
      the acceleration they gave, the thread hangs at the angle they gave, the
      pendulum stops at the height they gave, the station spins at their rate.
      Nothing anywhere draws the truth with an error bar on it.

   3. A named misconception has to be PROVABLE. A wrong route is reported only
      when the number it lands on is more than three tolerances from the right
      one; inside that it could equally well be a careless rounding, and
      naming a mistake the reader did not make is worse than naming none.

   Depends on animate.js for PALETTE and a few primitives, and on scenarios.js
   for the configured g. Load after both.
   ========================================================================== */

const DemoGames = (function () {
  "use strict";

  /* --------------------------------------------------------------------------
     environment — read late, never captured
     ------------------------------------------------------------------------ */

  /* g belongs to the backend and arrives through /api/config, which can land
     after this file has parsed. `typeof` on a `let` that has not been evaluated
     yet THROWS rather than returning "undefined", so the try/catch guards
     script ORDER, not a missing value. */
  function dgG() {
    try {
      if (typeof GRAVITY === "number" && Number.isFinite(GRAVITY) && GRAVITY > 0) return GRAVITY;
    } catch (err) { /* scenarios.js has not run yet */ }
    return 9.8;
  }

  function dgFont() {
    try { if (typeof FONT_LABEL === "string" && FONT_LABEL) return FONT_LABEL; }
    catch (err) { /* animate.js has not run yet */ }
    return '"IBM Plex Mono", Consolas, monospace';
  }

  /* PALETTE exists from the moment animate.js parses but can still be EMPTY if
     a draw lands before refreshPalette(). Canvas silently ignores an undefined
     fillStyle, so the scene would come out invisible rather than throwing,
     which is far harder to diagnose than a missing scene. */
  const DG_DARK = {
    ink: "#e8e6e1", inkSoft: "#a4a8ad", paper: "#10151a", panel: "#1b2026",
    stage: "#10151a", rule: "#3d4751", crimson: "#d2504a", navy: "#5b9dd9",
    brass: "#c9a227", forest: "#6aa87a", shadow: "#2c343d",
  };
  function dgPal() {
    let P = null;
    try { if (typeof PALETTE !== "undefined" && PALETTE) P = PALETTE; }
    catch (err) { return null; }
    if (!P) return null;
    return P.ink ? P : DG_DARK;
  }

  /* --------------------------------------------------------------------------
     numeric odds and ends
     ------------------------------------------------------------------------ */

  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  function dgClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Every given passes through this before it is stored, so the number printed
  // in the table and the number the answer was derived from are one number.
  function dgR(v, dp) { const f = Math.pow(10, dp); return Math.round(v * f) / f; }

  function dgFmt(n, d) {
    if (n === undefined || n === null || !Number.isFinite(n)) return "—";
    return n.toFixed(d === undefined ? 2 : d);
  }

  function dgSigned(n, d) {
    if (!Number.isFinite(n)) return "—";
    return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d === undefined ? 2 : d);
  }

  function dgGrid(lo, hi, step) {
    const out = [];
    const n = Math.round((hi - lo) / step);
    for (let i = 0; i <= n; i++) out.push(dgR(lo + i * step, 6));
    return out;
  }

  function dgPick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function dgRand(lo, hi) { return lo + Math.random() * (hi - lo); }

  // Readers type into text fields, so an answer arrives as a string, and on a
  // comma-decimal keyboard it arrives as "1,25". Anything that is not a finite
  // number is reported as a blank field and never graded as wrong.
  function dgNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    if (typeof v !== "string") return NaN;
    const s = v.trim().replace(",", ".");
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function dgChoice(v) {
    if (typeof v !== "string") return "";
    return v.trim();
  }

  /* A named wrong route earns a report only if the number it lands on could not
     equally well be the correct answer rounded carelessly. Three tolerances is
     the floor. Unlike the ramp file's version this one accepts a NEGATIVE
     target, because two of these games ask for a signed answer and the sign is
     the whole lesson. */
  function dgRouteHit(guess, wrong, answer, tol) {
    if (!Number.isFinite(wrong) || !Number.isFinite(guess) || !Number.isFinite(tol)) return false;
    if (Math.abs(wrong - answer) <= 3 * tol) return false;
    return Math.abs(guess - wrong) <= Math.max(tol, Math.abs(wrong) * 0.015);
  }

  /* --------------------------------------------------------------------------
     catalogue and ladders
     ------------------------------------------------------------------------ */

  const DG_CATALOGUE = [
    {
      id: "spool-and-thread", name: "The spool and the thread", group: "Rotation",
      blurb: "A cable spool on a table, a thread off the bottom of its axle. Which way does it roll?",
    },
    {
      id: "tablecloth-pull", name: "The tablecloth pull", group: "Momentum",
      blurb: "Yank the cloth and leave the setting standing. Name the longest pull that still works.",
    },
    {
      id: "bowling-ball-nose", name: "The bowling ball at your nose", group: "Energy & circular motion",
      blurb: "Release it from your nose and stand still. Predict what it does on the way back.",
    },
    {
      id: "newtons-cradle", name: "Newton's cradle", group: "Momentum",
      blurb: "Lift some of the balls and let go. Momentum alone cannot tell you what happens next.",
    },
    {
      id: "rotating-space-station", name: "Rotating space station", group: "Gravitation",
      blurb: "Spin a ring for artificial gravity. Work out how fast — it is slower than you think.",
    },
  ];

  const DG_LADDERS = {
    "spool-and-thread": ["Which way?", "The critical angle", "How fast?"],
    "tablecloth-pull": ["Same cloth, same table", "Two surfaces", "Don't topple the glass"],
    "bowling-ball-nose": ["Trust the physics", "With losses", "Someone pushes it"],
    "newtons-cradle": ["How many?", "Unequal masses", "One ball is putty"],
    "rotating-space-station": ["Set the spin", "Comfortable rotation", "Head versus feet"],
  };

  const DG_IDS = DG_CATALOGUE.map((g) => g.id);

  // The host rebuilds its difficulty menu when the experiment changes, and the
  // change fires before the new round exists. Matching by NAME first and by
  // POSITION second means a menu still holding the previous game's labels
  // degrades to the right rung instead of silently resetting to the easiest.
  function dgTier(gameId, difficulty) {
    if (typeof difficulty === "number" && Number.isFinite(difficulty)) {
      return dgClamp(Math.round(difficulty), 0, 2);
    }
    const want = String(difficulty === undefined || difficulty === null ? "" : difficulty).trim();
    if (!want) return 0;
    const own = DG_LADDERS[gameId];
    if (own) {
      const i = own.indexOf(want);
      if (i >= 0) return i;
    }
    for (const id of DG_IDS) {
      const j = DG_LADDERS[id].indexOf(want);
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
  let lastGameId = DG_IDS[0];

  const DG_FIT_SPOOL = "demogames-spool";
  const DG_FIT_CLOTH = "demogames-cloth";

  function dgClearFits() {
    if (typeof resetViewFit === "function") {
      resetViewFit(DG_FIT_SPOOL);
      resetViewFit(DG_FIT_CLOTH);
    }
  }

  // A blank field is not a wrong answer: the round is not lost, nothing is
  // released, and the reader can fill it in. It still carries a verdict,
  // because the host prints one on every result it is handed.
  function dgBlank(solution) {
    return {
      correct: false, blank: true,
      verdict: { kind: "miss", text: "Nothing entered" },
      feedback: "Enter a number before you press Play.",
      misconception: null,
      solution: solution || [],
      exact: {}, tolerance: {},
    };
  }

  /* A pendulum step shared by the bowling ball and the cradle. The small-angle
     closed form is wrong by 7% at 60 degrees and both games release from well
     past that, so the equation is integrated rather than replayed:

         theta'' = -(g/L) sin(theta) - gamma theta'

     RK4 on the pair (theta, omega). gamma is a real velocity-proportional
     drag at the pivot; it is what the reveal tunes to land the swing exactly
     where the reader's number says it lands. */
  function dgPendDeriv(th, om, k, gamma) {
    return { dth: om, dom: -k * Math.sin(th) - gamma * om };
  }

  function dgPendStep(s, k, gamma, dt) {
    const a1 = dgPendDeriv(s.th, s.om, k, gamma);
    const a2 = dgPendDeriv(s.th + a1.dth * dt / 2, s.om + a1.dom * dt / 2, k, gamma);
    const a3 = dgPendDeriv(s.th + a2.dth * dt / 2, s.om + a2.dom * dt / 2, k, gamma);
    const a4 = dgPendDeriv(s.th + a3.dth * dt, s.om + a3.dom * dt, k, gamma);
    s.th += (dt / 6) * (a1.dth + 2 * a2.dth + 2 * a3.dth + a4.dth);
    s.om += (dt / 6) * (a1.dom + 2 * a2.dom + 2 * a3.dom + a4.dom);
    return s;
  }

  /* ==========================================================================
     GAME 1 — the spool and the thread
     --------------------------------------------------------------------------
     A cable spool of outer radius R and axle radius r sits on a table. The
     thread comes off the BOTTOM of the axle and is pulled at theta above the
     horizontal. Take torques about the CONTACT POINT P — that is the whole
     lesson, and it is the only pivot that makes the answer fall out in one
     line, because the friction and the normal force both act through it.

         I_P   = I_cm + mR^2 = mR^2 (beta + 1)          (parallel axis)
         tau_P = T (R cos(theta) - r)
         a_cm  = T (R cos(theta) - r) / (m R (beta + 1))

     The moment arm R cos(theta) - r is the perpendicular distance from P to
     the thread's line of action, signed. Pull flat along the floor and it is
     R - r, comfortably positive, and the spool rolls TOWARD the puller, which
     almost nobody predicts. Raise the thread and the arm shrinks; at
     cos(theta) = r/R the line of action passes exactly through P, the torque
     about it is zero, and the spool does not roll at all.

     Take torques about the CENTRE instead and the tension's arm is r on the
     other side, so the answer comes out backwards every time. That is not a
     small slip — it inverts the direction — and it is the detector this game
     exists to fire.
     ========================================================================== */

  // Axle-to-rim ratios chosen so that r prints exactly at four decimals for
  // every R on the grid below. A ratio that only ROUNDS to the printed r would
  // leave the reader's arccos and ours disagreeing in the last digit, which is
  // fatal on the rung where the answer IS that arccos.
  const DG_SPOOL_Q = [0.5, 0.6, 0.75, 0.8];
  const DG_SPOOL_R = dgGrid(0.14, 0.30, 0.02);
  const DG_SPOOL_BETA = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];

  // The largest tension the table can hold the spool against without the rim
  // skidding, from |f| = T(r + beta R cos)/ (R(beta+1)) <= mu_s (mg - T sin).
  function dgSpoolGripCap(R, r, beta, m, mu, th, g) {
    const need = (r + beta * R * Math.cos(th)) / (R * (beta + 1));
    const denom = need + mu * Math.sin(th);
    if (!(denom > 0)) return Infinity;
    return (mu * m * g) / denom;
  }

  function dgSpoolCore(R, r, beta, m, T, th) {
    const cs = Math.cos(th), sn = Math.sin(th);
    const arm = R * cs - r;                       // signed moment arm about P
    const a = (T * arm) / (m * R * (beta + 1));
    const fNeed = (T * (r + beta * R * cs)) / (R * (beta + 1));   // magnitude, always backwards
    return { cs, sn, arm, a, fNeed };
  }

  function dgSpoolMake(tier) {
    const g = dgG();

    for (let attempt = 0; attempt < 900; attempt++) {
      const R = dgPick(DG_SPOOL_R);
      const beta = dgPick(DG_SPOOL_BETA);
      const m = dgR(dgPick(dgGrid(1.2, 4.0, 0.1)), 1);
      const mu = dgR(dgPick(dgGrid(0.35, 0.75, 0.05)), 2);

      let r, q, thC, th, thDeg, wanted = null;

      if (tier === 1) {
        /* The critical angle IS the answer, so it is fixed first and r is the
           given solved for — then snapped to a tenth of a millimetre and the
           angle recomputed from the snapped r, so the table and the grader
           agree to the last digit. */
        const target = dgPick(dgGrid(30, 70, 0.5)) * DEG;
        r = dgR(R * Math.cos(target), 4);
        if (!(r >= 0.035 && r <= 0.86 * R)) continue;
        q = r / R;
        thC = Math.acos(q);
        th = null; thDeg = null;
      } else {
        q = dgPick(DG_SPOOL_Q);
        r = dgR(q * R, 4);
        if (!(r >= 0.035)) continue;
        // Recomputed from the SNAPPED r rather than from the ratio that
        // generated it, so every downstream number uses the printed axle.
        q = r / R;
        thC = Math.acos(q);

        if (tier === 0) {
          wanted = dgPick(["toward", "away", "neither"]);
          if (wanted === "neither") {
            /* The one case where the printed angle cannot simply be a whole
               number of degrees: it has to be the arccos exactly, or the
               "it does not roll" the reader is asked to recognise would not
               actually be zero. Printed to two decimals, which reproduces the
               moment arm to under a micrometre. */
            th = thC;
            thDeg = dgR(th / DEG, 2);
          } else {
            const grid = dgGrid(0, 80, 1).filter((d) => {
              const c = Math.cos(d * DEG);
              return wanted === "toward" ? c - q >= 0.10 : q - c >= 0.10;
            });
            if (!grid.length) continue;
            thDeg = dgPick(grid);
            th = thDeg * DEG;
          }
        } else {
          // tier 2: the angle must be far enough from critical that the answer
          // is not a difference of two nearly equal numbers.
          const grid = dgGrid(0, 78, 1).filter((d) => Math.abs(Math.cos(d * DEG) - q) >= 0.12);
          if (!grid.length) continue;
          thDeg = dgPick(grid);
          th = thDeg * DEG;
        }
      }

      let T;
      if (tier === 2) {
        /* Built backwards: the acceleration window is fixed, and the TENSION
           is the given solved for. Picking a tension and printing whatever
           acceleration fell out is how a round ends up asking for 0.03 m/s². */
        const core0 = dgSpoolCore(R, r, beta, m, 1, th);
        const want = dgPick(dgGrid(0.25, 2.20, 0.05));
        const raw = (want * m * R * (beta + 1)) / Math.abs(core0.arm);
        T = dgR(raw, 1);
        if (!(T >= 3 && T <= 80)) continue;
      } else {
        // No acceleration is asked for, so the tension only has to be one the
        // table can actually hold: chosen under the grip cap with a margin.
        // On the critical-angle rung the check is made AT that angle, which is
        // the one the reader is being asked to hold the thread at.
        const thUse = tier === 1 ? thC : th;
        const cap = dgSpoolGripCap(R, r, beta, m, mu, thUse, g);
        const lift = Math.sin(thUse) > 1e-6 ? (0.6 * m * g) / Math.sin(thUse) : Infinity;
        const hi = Math.min(cap * 0.7, lift, 40);
        if (!(hi >= 4)) continue;
        T = dgR(dgPick(dgGrid(3, Math.floor(hi * 2) / 2, 0.5)), 1);
        if (!(T >= 3)) continue;
      }

      const core = dgSpoolCore(R, r, beta, m, T, tier === 1 ? thC : th);
      const N = m * g - T * core.sn;
      if (!(N > 0.35 * m * g)) continue;
      // The no-slip assumption is what licenses a = alpha R, so a round that
      // would skid is refused rather than quietly graded as if it rolled.
      if (!(core.fNeed <= 0.85 * mu * N)) continue;

      if (tier === 2) {
        const a = core.a;
        if (!(Math.abs(a) >= 0.20 && Math.abs(a) <= 2.60)) continue;
        const tol = Math.max(0.02 * Math.abs(a), 0.01);
        // The sign is half the question; an answer within a few tolerances of
        // zero cannot carry one.
        if (!(Math.abs(a) > 5 * tol)) continue;
      }

      const R0 = {
        game: "spool", gameId: "spool-and-thread", tier, g,
        R, r, q, beta, m, mu, T, th, thDeg, thC, thCDeg: thC / DEG,
        cs: core.cs, sn: core.sn, arm: core.arm, a: core.a, fNeed: core.fNeed, N,
        I: beta * m * R * R, Ip: m * R * R * (beta + 1),
        wanted,
      };

      if (tier === 0) {
        R0.truthDir = dgSpoolDir(R0);
        if (wanted && R0.truthDir !== wanted) continue;
        R0.answerKey = "dir";
        R0.tol = 0;
      } else if (tier === 1) {
        R0.answer = thC / DEG;
        R0.tol = 0.5;
        R0.answerKey = "thetac";
        R0.wrong = {
          usedSine: Math.asin(q) / DEG,
          usedTangent: Math.atan(q) / DEG,
          fromVertical: 90 - thC / DEG,
          inRadians: thC,
        };
      } else {
        R0.answer = core.a;
        R0.tol = Math.max(0.02 * Math.abs(core.a), 0.01);
        R0.answerKey = "a";
        R0.wrong = {
          aboutCentre: -(T * r) / (beta * m * R),
          noParallel: (T * core.arm) / (m * R * beta),
          noRotation: (T * core.cs) / m,
          topOfAxle: (T * (R * core.cs + r)) / (m * R * (beta + 1)),
          forgotCos: (T * (R - r)) / (m * R * (beta + 1)),
          usedSin: (T * (R * core.sn - r)) / (m * R * (beta + 1)),
          flipped: -core.a,
          angular: core.a / R,
        };
        // This game exists to catch the pivot-at-the-centre error; refuse a
        // round where that route lands too close to the truth to be named.
        if (!(Math.abs(R0.wrong.aboutCentre - core.a) > 3 * R0.tol)) continue;
      }

      return R0;
    }

    return dgSpoolFallback(tier);
  }

  /* Worked by hand and checked. Reached only if the constructor exhausts its
     attempts, so start() can never hand back null. */
  function dgSpoolFallback(tier) {
    const g = dgG();
    const R = 0.24, beta = 0.50, m = 2.0, mu = 0.60;
    const r = 0.12;                       // q = 1/2, so the critical angle is 60 degrees
    const q = r / R;
    const thC = Math.acos(q);
    const thDeg = tier === 1 ? null : 15;
    const th = tier === 1 ? null : thDeg * DEG;
    const T = 8.0;
    const core = dgSpoolCore(R, r, beta, m, T, tier === 1 ? thC : th);
    const R0 = {
      game: "spool", gameId: "spool-and-thread", tier, g,
      R, r, q, beta, m, mu, T, th, thDeg, thC, thCDeg: thC / DEG,
      cs: core.cs, sn: core.sn, arm: core.arm, a: core.a, fNeed: core.fNeed,
      N: m * g - T * core.sn,
      I: beta * m * R * R, Ip: m * R * R * (beta + 1),
      wanted: null,
    };
    if (tier === 0) { R0.truthDir = dgSpoolDir(R0); R0.answerKey = "dir"; R0.tol = 0; }
    else if (tier === 1) {
      R0.answer = thC / DEG; R0.tol = 0.5; R0.answerKey = "thetac";
      R0.wrong = {
        usedSine: Math.asin(q) / DEG, usedTangent: Math.atan(q) / DEG,
        fromVertical: 90 - thC / DEG, inRadians: thC,
      };
    } else {
      R0.answer = core.a; R0.tol = Math.max(0.02 * Math.abs(core.a), 0.01); R0.answerKey = "a";
      R0.wrong = {
        aboutCentre: -(T * r) / (beta * m * R),
        noParallel: (T * core.arm) / (m * R * beta),
        noRotation: (T * core.cs) / m,
        topOfAxle: (T * (R * core.cs + r)) / (m * R * (beta + 1)),
        forgotCos: (T * (R - r)) / (m * R * (beta + 1)),
        usedSin: (T * (R * core.sn - r)) / (m * R * (beta + 1)),
        flipped: -core.a,
        angular: core.a / R,
      };
    }
    return R0;
  }

  /* The sign of the moment arm about P, and nothing else, decides the
     direction. The epsilon is relative to R so it scales with the spool: on a
     round built to sit exactly at the critical angle the arm comes out at
     1e-17 m, and on any other round it is at least 0.10 R. */
  function dgSpoolDir(R0) {
    const eps = 1e-9 * R0.R;
    if (R0.arm > eps) return "toward";
    if (R0.arm < -eps) return "away";
    return "neither";
  }

  const DG_SPOOL_DIRLABEL = {
    toward: "toward the puller",
    away: "away from the puller",
    neither: "neither — it does not roll",
  };

  function dgSpoolView(R0) {
    const givens = [
      { label: "Outer radius, R", value: dgFmt(R0.R, 3), unit: "m" },
      { label: "Axle radius, r", value: dgFmt(R0.r, 4), unit: "m" },
      { label: "Spool mass, m", value: dgFmt(R0.m, 1), unit: "kg" },
      { label: "Rotational inertia about the centre", value: "β m R², β = " + dgFmt(R0.beta, 2), unit: "" },
      { label: "Thread tension, T", value: dgFmt(R0.T, 1), unit: "N" },
    ];
    if (R0.tier !== 1) {
      givens.push({ label: "Thread angle above the horizontal, θ", value: dgFmt(R0.thDeg, 2), unit: "°" });
    }
    givens.push({ label: "Static friction, table to rim, μ_s", value: dgFmt(R0.mu, 2), unit: "" });
    givens.push({ label: "g", value: dgFmt(R0.g, 2), unit: "m/s²" });

    const prompt = R0.tier === 0
      ? "The thread comes off the BOTTOM of the inner axle and is pulled steadily at the angle below,"
        + " above the horizontal. The spool rolls on the table without slipping. Which way does it go?"
      : R0.tier === 1
        ? "The thread comes off the BOTTOM of the inner axle. Raise the pull slowly from flat along the"
          + " floor and there is one angle at which the spool refuses to roll at all — pull as hard as"
          + " you like and it will not turn. Find that angle."
        : "The thread comes off the BOTTOM of the inner axle and is pulled steadily at the angle below."
          + " Find the acceleration of the spool's centre. Give it POSITIVE if the spool rolls toward the"
          + " puller and NEGATIVE if it rolls away.";

    const note = "Take torques about the CONTACT POINT, not the centre. The contact point is"
      + " instantaneously at rest, and both the friction and the normal force act through it, so the"
      + " thread is the only thing with a torque about it. The parallel-axis theorem gives"
      + " I_P = I_cm + mR² = mR²(β + 1).";

    const inputs = R0.tier === 0
      ? [{
        key: "dir", label: "The spool rolls",
        choices: [
          { value: "toward", label: DG_SPOOL_DIRLABEL.toward },
          { value: "away", label: DG_SPOOL_DIRLABEL.away },
          { value: "neither", label: DG_SPOOL_DIRLABEL.neither },
        ],
      }]
      : R0.tier === 1
        ? [{ key: "thetac", label: "Critical angle above the horizontal", unit: "°", step: "0.01" }]
        : [{ key: "a", label: "Acceleration of the centre", unit: "m/s²", step: "0.001" }];

    return {
      id: "spool-and-thread", game: "spool", difficulty: DG_LADDERS["spool-and-thread"][R0.tier],
      prompt, note, givens, inputs,
    };
  }

  function dgSpoolSolution(R0) {
    const L = [];
    L.push("Pivot at the contact point P. Friction and the normal force both act THROUGH it, so");
    L.push("neither has a torque about it and the thread is left holding the whole equation.");
    L.push("");
    L.push("    I_P = I_cm + mR² = mR²(β + 1) = " + dgFmt(R0.m, 1) + " × " + dgFmt(R0.R, 3)
      + "² × " + dgFmt(R0.beta + 1, 2) + " = " + dgFmt(R0.Ip, 5) + " kg·m²");
    L.push("");
    L.push("The thread leaves the BOTTOM of the axle, so its line of action runs tangent to the axle");
    L.push("circle underneath the centre. The perpendicular distance from P to that line is");
    L.push("");
    L.push("    d = R cos θ − r");
    L.push("");
    L.push("positive when the line passes ABOVE P — and then the torque rolls the spool toward the");
    L.push("puller. Pull flat along the floor (θ = 0) and d = R − r, comfortably positive: it follows");
    L.push("you. Raise the thread and d shrinks.");
    L.push("");
    L.push("    Critical angle:  cos θ_c = r/R = " + dgFmt(R0.r, 4) + "/" + dgFmt(R0.R, 3)
      + " = " + dgFmt(R0.q, 5) + "   →   θ_c = " + dgFmt(R0.thCDeg, 3) + "°");
    L.push("");
    if (R0.tier === 1) {
      L.push("At θ_c the line of action passes exactly through P, the moment arm is zero, and no");
      L.push("tension whatever will turn the spool. Above θ_c it rolls away from you; below it, toward.");
      L.push("");
      L.push("The plausible-looking wrong angle: sin θ_c = r/R → "
        + dgFmt(R0.wrong.usedSine, 2) + "°. That is the angle the axle");
      L.push("tangent point subtends, not the angle of the thread — and note it is the same number");
      L.push("you get by measuring the right angle from the vertical instead of the floor, since");
      L.push("arcsin(q) and 90° − arccos(q) are identically equal.");
    } else {
      L.push("    θ = " + dgFmt(R0.thDeg, 2) + "°     cos θ = " + dgFmt(R0.cs, 5));
      L.push("    d = " + dgFmt(R0.R, 3) + " × " + dgFmt(R0.cs, 5) + " − " + dgFmt(R0.r, 4)
        + " = " + dgFmt(R0.arm, 6) + " m");
      L.push("");
      if (R0.tier === 0) {
        const dir = dgSpoolDir(R0);
        L.push(dir === "neither"
          ? "    d = 0 to the last digit: the line of action goes straight through the contact point."
          : dir === "toward"
            ? "    d > 0: the line passes " + dgFmt(Math.abs(R0.arm) * 100, 2)
              + " cm above P, so the spool rolls TOWARD the puller."
            : "    d < 0: the line passes " + dgFmt(Math.abs(R0.arm) * 100, 2)
              + " cm below P, so the spool rolls AWAY.");
        L.push("");
        L.push("Notice what does NOT appear: neither T nor β nor m is in the sign of d. How hard you");
        L.push("pull and how the mass is distributed change how FAST it goes, never which way.");
      } else {
        L.push("    τ_P = T·d = " + dgFmt(R0.T, 1) + " × " + dgFmt(R0.arm, 6)
          + " = " + dgFmt(R0.T * R0.arm, 5) + " N·m");
        L.push("    α   = τ_P / I_P,   and rolling gives a = αR, so");
        L.push("");
        L.push("    a = T (R cos θ − r) / (m R (β + 1))");
        L.push("      = " + dgFmt(R0.T, 1) + " × " + dgFmt(R0.arm, 6) + " / ("
          + dgFmt(R0.m, 1) + " × " + dgFmt(R0.R, 3) + " × " + dgFmt(R0.beta + 1, 2) + ")");
        L.push("      = " + dgFmt(R0.a, 4) + " m/s²   ("
          + (R0.a >= 0 ? "toward the puller)" : "away from the puller)"));
        L.push("");
        L.push("Take torques about the CENTRE instead and the thread's arm is r on the other side:");
        L.push("that route gives " + dgFmt(R0.wrong.aboutCentre, 4) + " m/s², pointing the wrong way.");
        L.push("The centre is accelerating, so it is not a legal pivot unless you carry the ma term;");
        L.push("the contact point is instantaneously at rest and needs no such correction.");
      }
    }
    L.push("");
    L.push("Grip check — this is what licenses a = αR in the first place:");
    L.push("    f = ma − T cos θ = −T(r + βR cos θ)/(R(β+1)) = " + dgFmt(-R0.fNeed, 3)
      + " N   (friction points BACK either way)");
    L.push("    N = mg − T sin θ = " + dgFmt(R0.N, 3) + " N,   μ_s N = "
      + dgFmt(R0.mu * R0.N, 3) + " N");
    L.push(R0.fNeed <= R0.mu * R0.N
      ? "    " + dgFmt(R0.fNeed, 3) + " ≤ " + dgFmt(R0.mu * R0.N, 3) + " — the rim grips and it rolls."
      : "    " + dgFmt(R0.fNeed, 3) + " > " + dgFmt(R0.mu * R0.N, 3)
        + " — the rim SKIDS, and a = αR no longer holds.");
    return L;
  }

  function dgSpoolMisconception(R0, given) {
    if (R0.tier === 0) {
      const truth = dgSpoolDir(R0);
      const gap = Math.abs(R0.arm) * 100;
      if (given === "toward" && truth !== "toward") {
        return {
          id: "pull-implies-follow",
          label: "The thread pulls it toward you, so surely it follows",
          detail: " It does follow you — but only while the line of action passes ABOVE the contact"
            + " point, which needs cos θ > r/R, i.e. θ below " + dgFmt(R0.thCDeg, 2) + "°. Here the"
            + " thread is at " + dgFmt(R0.thDeg, 2) + "°, so the line passes "
            + (truth === "neither" ? "straight through P" : dgFmt(gap, 2) + " cm below P")
            + " and the torque about P turns the spool the other way. The horizontal force on the"
            + " centre really is forward; the friction at the rim is larger, and it is backwards.",
        };
      }
      if (given === "away" && truth !== "away") {
        return {
          id: "torque-about-the-centre",
          label: "You pivoted at the centre",
          detail: " About the centre the thread's moment arm is r, and it always winds the spool"
            + " backwards — so that pivot predicts 'away' for every angle, including a thread pulled"
            + " flat along the floor, which is plainly wrong the moment you try it. The centre is"
            + " accelerating, so Στ = Iα there needs an extra term. The contact point is"
            + " instantaneously at rest and does not, and about it the arm is R cos θ − r = "
            + dgFmt(R0.arm, 5) + " m.",
        };
      }
      if (given === "neither" && truth !== "neither") {
        return {
          id: "line-misses-the-contact-point",
          label: "The line of action misses P here",
          detail: " Nothing rolls only when the thread's line goes exactly through the contact point,"
            + " which is cos θ = r/R = " + dgFmt(R0.q, 4) + ", i.e. θ_c = " + dgFmt(R0.thCDeg, 2)
            + "°. At " + dgFmt(R0.thDeg, 2) + "° the line clears P by " + dgFmt(gap, 2)
            + " cm, so there is a torque and it rolls " + (truth === "toward" ? "toward" : "away from")
            + " the puller. Check you have not swapped r and R: the ratio is the small radius over the"
            + " big one, never the other way up.",
        };
      }
      return null;
    }

    const hit = (wrong) => dgRouteHit(given, wrong, R0.answer, R0.tol);
    const W = R0.wrong;

    if (R0.tier === 1) {
      if (hit(W.usedSine)) {
        return {
          id: "sine-for-cosine",
          label: "sin θ_c = r/R is the wrong resolution",
          detail: " " + dgFmt(W.usedSine, 2) + "° is arcsin(r/R). The perpendicular distance from the"
            + " contact point to the thread's line is R cos θ − r, so the arm vanishes at"
            + " cos θ = r/R, not sin θ = r/R. Sketch it: with the thread flat (θ = 0) the arm must be"
            + " R − r, and only the cosine form gives that.",
        };
      }
      if (hit(W.fromVertical)) {
        return {
          id: "measured-from-the-vertical",
          label: "That angle is measured from the vertical",
          detail: " " + dgFmt(W.fromVertical, 2) + "° = 90° − " + dgFmt(R0.thCDeg, 2)
            + "°. The question measures θ up from the HORIZONTAL, which is how the thread is actually"
            + " held. Swapping the reference swaps sine and cosine and moves the critical angle to the"
            + " far side of 45°.",
        };
      }
      if (hit(W.usedTangent)) {
        return {
          id: "tangent-for-cosine",
          label: "tan θ_c = r/R is not the condition",
          detail: " " + dgFmt(W.usedTangent, 2) + "° is arctan(r/R). The condition is a perpendicular"
            + " DISTANCE from P to the line of action, R cos θ − r, set to zero — no opposite-over-"
            + "adjacent triangle enters it.",
        };
      }
      if (hit(W.inRadians)) {
        return {
          id: "answer-in-radians",
          label: "Right number, wrong unit",
          detail: " " + dgFmt(W.inRadians, 4) + " is arccos(r/R) in radians. The box asks for degrees:"
            + " × 180/π = " + dgFmt(R0.answer, 2) + "°.",
        };
      }
      return null;
    }

    if (hit(W.aboutCentre)) {
      return {
        id: "torque-about-the-centre",
        label: "You pivoted at the centre",
        detail: " Tr/(βmR) = " + dgFmt(Math.abs(W.aboutCentre), 4) + " m/s² is what you get from"
          + " Στ = I_cm α about the spool's centre, and it points the WRONG WAY: about the centre the"
          + " thread's arm is r on the far side, so that pivot predicts the spool runs away from a"
          + " thread pulled flat along the floor. The centre is accelerating and is not a free pivot."
          + " About the contact point the arm is R cos θ − r = " + dgFmt(R0.arm, 5) + " m and"
          + " a = " + dgFmt(R0.a, 4) + " m/s².",
      };
    }
    if (hit(W.flipped)) {
      return {
        id: "right-size-wrong-way",
        label: "Right size, wrong direction",
        detail: " The magnitude is correct, so the arithmetic held; the sign of R cos θ − r is what"
          + " went over. Here R cos θ = " + dgFmt(R0.R * R0.cs, 5) + " m and r = " + dgFmt(R0.r, 4)
          + " m, so the arm is " + dgFmt(R0.arm, 5) + " m and the spool rolls "
          + (R0.a >= 0 ? "TOWARD" : "AWAY FROM") + " the puller.",
      };
    }
    if (hit(W.noParallel)) {
      return {
        id: "forgot-the-parallel-axis",
        label: "I about the contact point, not about the centre",
        detail: " You divided by βmR² — the inertia about the CENTRE — while taking torques about the"
          + " contact point. Moving the axis costs mR²: I_P = mR²(β+1) = " + dgFmt(R0.Ip, 5)
          + " kg·m², a factor of " + dgFmt((R0.beta + 1) / R0.beta, 3) + " larger, and your answer is"
          + " too big by exactly that.",
      };
    }
    if (hit(W.noRotation)) {
      return {
        id: "ignored-the-rotation",
        label: "That is T cos θ / m, with the spool treated as a sliding block",
        detail: " " + dgFmt(W.noRotation, 4) + " m/s² leaves out the friction at the rim entirely."
          + " The spool has to be SPUN UP as well as moved, and the friction that does the spinning"
          + " is " + dgFmt(R0.fNeed, 3) + " N backwards — a large fraction of the pull. Ignore it and"
          + " you can never get the direction right either, because friction is what reverses it.",
      };
    }
    if (hit(W.topOfAxle)) {
      return {
        id: "thread-off-the-top",
        label: "That is the thread coming off the TOP of the axle",
        detail: " R cos θ + r is the moment arm when the thread unwinds over the top, and then the"
          + " spool always rolls toward the puller and there is no critical angle at all. This thread"
          + " comes off the bottom, so the two lengths subtract: R cos θ − r.",
      };
    }
    if (hit(W.forgotCos)) {
      return {
        id: "dropped-the-cosine",
        label: "The moment arm is R cos θ − r",
        detail: " " + dgFmt(W.forgotCos, 4) + " m/s² is the flat-pull answer, R − r. It is what the"
          + " spool would do with the thread along the floor; at " + dgFmt(R0.thDeg, 2)
          + "° only the projection R cos θ = " + dgFmt(R0.R * R0.cs, 5) + " m counts.",
      };
    }
    if (hit(W.usedSin)) {
      return {
        id: "sine-for-cosine",
        label: "The arm carries a cosine, not a sine",
        detail: " R sin θ − r gives " + dgFmt(W.usedSin, 4) + " m/s². Check it against the case you"
          + " can picture: a thread pulled flat along the floor has θ = 0, an arm of R − r, and the"
          + " spool follows you. R sin θ − r would make the arm −r there.",
      };
    }
    if (hit(W.angular)) {
      return {
        id: "answered-the-angular-acceleration",
        label: "That is α, not a",
        detail: " α = " + dgFmt(W.angular, 4) + " rad/s² is right, and it is the hard half. Rolling"
          + " without slipping ties it to the centre by a = αR = " + dgFmt(R0.a, 4) + " m/s².",
      };
    }
    return null;
  }

  function dgSpoolGrade(R0, answers) {
    const solution = dgSpoolSolution(R0);

    if (R0.tier === 0) {
      const given = dgChoice(answers ? answers.dir : "");
      if (!given || !DG_SPOOL_DIRLABEL[given]) return dgBlank(solution);
      const truth = dgSpoolDir(R0);
      const correct = given === truth;
      const gapCm = Math.abs(R0.arm) * 100;

      const verdict = correct
        ? {
          kind: "hit",
          text: truth === "neither" ? "Dead still, exactly as called" : "Rolled " + (truth === "toward" ? "toward you" : "away"),
        }
        : { kind: "miss", text: "It went " + (truth === "toward" ? "toward the puller" : truth === "away" ? "away from the puller" : "nowhere at all") };

      const feedback = (correct ? "Called it. " : "Not this time. ")
        + "The line of action "
        + (truth === "neither"
          ? "passes straight through the contact point, so the torque about P is zero and no tension can turn the spool."
          : "clears the contact point by " + dgFmt(gapCm, 2) + " cm on the "
            + (truth === "toward" ? "upper" : "lower") + " side, so the spool rolls "
            + (truth === "toward" ? "toward the puller" : "away from the puller") + ".")
        + " The critical angle is " + dgFmt(R0.thCDeg, 2) + "° and the thread is at "
        + dgFmt(R0.thDeg, 2) + "°.";

      return {
        correct, blank: false, verdict, feedback,
        misconception: correct ? null : dgSpoolMisconception(R0, given),
        solution,
        exact: { direction: truth, arm: dgR(R0.arm, 6), thetaCritical: dgR(R0.thCDeg, 4) },
        tolerance: {},
        given, truth, gapCm,
      };
    }

    const guess = dgNum(answers ? answers[R0.answerKey] : undefined);
    if (!Number.isFinite(guess)) return dgBlank(solution);

    const delta = guess - R0.answer;
    const correct = Math.abs(delta) <= R0.tol;

    let verdict, feedback;
    if (R0.tier === 1) {
      // Their angle is a real thread angle, so it has a real consequence: the
      // spool creeps at whatever acceleration that angle actually produces.
      const aTheirs = (R0.T * (R0.R * Math.cos(guess * DEG) - R0.r)) / (R0.m * R0.R * (R0.beta + 1));
      if (correct) {
        verdict = { kind: "hit", text: "The spool would not budge" };
        feedback = "Exactly right: θ_c = " + dgFmt(R0.answer, 2) + "°, and you gave "
          + dgFmt(guess, 2) + "°. At that angle the thread's line runs through the contact point,"
          + " the moment arm is zero, and pulling harder only presses the rim into the table.";
      } else {
        verdict = {
          kind: delta > 0 ? "over" : "under",
          text: "Still rolls " + (aTheirs >= 0 ? "toward you" : "away") + " at "
            + dgFmt(Math.abs(aTheirs), 2) + " m/s²",
        };
        feedback = "Hold the thread at " + dgFmt(guess, 2) + "° and the line of action misses the"
          + " contact point by " + dgFmt(Math.abs(R0.R * Math.cos(guess * DEG) - R0.r) * 100, 2)
          + " cm, so the spool creeps " + (aTheirs >= 0 ? "toward" : "away from") + " you at "
          + dgFmt(Math.abs(aTheirs), 3) + " m/s². The angle that kills it is "
          + dgFmt(R0.answer, 2) + "°, and you were "
          + (delta > 0 ? "above" : "below") + " it by " + dgFmt(Math.abs(delta), 2) + "°.";
      }
    } else {
      if (correct) {
        verdict = { kind: "hit", text: "Matched the roll" };
        feedback = "Exact " + dgFmt(R0.answer, 4) + " m/s²; you gave " + dgFmt(guess, 4)
          + " m/s², inside ±" + dgFmt(R0.tol, 4) + ". The spool "
          + (R0.a >= 0 ? "follows the thread" : "backs away from it")
          + ", and the moment arm about the contact point is " + dgFmt(R0.arm, 5) + " m.";
      } else if (Math.sign(guess) !== Math.sign(R0.answer) && Math.abs(guess) > R0.tol) {
        verdict = { kind: "miss", text: "Rolled the other way" };
        feedback = "The direction is the half that matters, and it went over. R cos θ = "
          + dgFmt(R0.R * R0.cs, 5) + " m against r = " + dgFmt(R0.r, 4) + " m, so the arm is "
          + dgFmt(R0.arm, 5) + " m and the spool rolls "
          + (R0.a >= 0 ? "toward" : "away from") + " the puller at " + dgFmt(Math.abs(R0.answer), 4)
          + " m/s². You gave " + dgSigned(guess, 4) + " m/s².";
      } else {
        verdict = {
          kind: Math.abs(guess) > Math.abs(R0.answer) ? "over" : "under",
          text: (Math.abs(guess) > Math.abs(R0.answer) ? "Too brisk by " : "Too sluggish by ")
            + dgFmt(Math.abs(Math.abs(guess) - Math.abs(R0.answer)), 3) + " m/s²",
        };
        feedback = "Right direction, wrong rate. Exact " + dgFmt(R0.answer, 4)
          + " m/s²; you gave " + dgFmt(guess, 4) + " m/s², out by "
          + dgFmt(Math.abs(delta), 4) + " against a tolerance of ±" + dgFmt(R0.tol, 4) + ".";
      }
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : dgSpoolMisconception(R0, guess),
      solution,
      exact: R0.tier === 1
        ? { thetaCritical: dgR(R0.answer, 4) }
        : { acceleration: dgR(R0.answer, 5), arm: dgR(R0.arm, 6) },
      tolerance: R0.tier === 1 ? { thetaCritical: R0.tol } : { acceleration: dgR(R0.tol, 5) },
      guess,
    };
  }

  /* ==========================================================================
     GAME 2 — the tablecloth pull
     --------------------------------------------------------------------------
     Two phases and one number joins them. While the cloth is still under the
     dish, the cloth drags it forward at a1 = mu1 g. The instant the cloth is
     clear, the bare table takes over and stops it at a2 = mu2 g.

         v  = mu1 g t                       speed the dish has when the cloth goes
         d1 = 1/2 mu1 g t^2                 travel under the cloth
         d2 = v^2 / (2 mu2 g)               travel after it
         D  = (mu1 g t^2 / 2)(1 + mu1/mu2)

     Every one of those is quadratic in t, which is the entire trick: halve the
     pull time and the dish moves a QUARTER as far. Readers routinely believe
     the opposite — that a violent yank throws the setting off the table —
     because the yank looks violent. What the dish feels is mu1 g whatever you
     do; the only thing the speed of the pull changes is how LONG it feels it.

         t_max = sqrt( 2 D_max / (mu1 g (1 + mu1/mu2)) )

     The mass of the dish is given and cancels, as it must: both accelerations
     are coefficients times g.
     ========================================================================== */

  function dgClothTime(D, mu1, mu2, g) {
    const k = mu1 * g * (1 + mu1 / mu2);
    if (!(k > 0)) return NaN;
    return Math.sqrt((2 * D) / k);
  }

  function dgClothDist(t, mu1, mu2, g) {
    return ((mu1 * g * t * t) / 2) * (1 + mu1 / mu2);
  }

  function dgClothMake(tier) {
    const g = dgG();

    for (let attempt = 0; attempt < 900; attempt++) {
      const mu1 = dgR(dgPick(dgGrid(0.10, 0.34, 0.01)), 2);
      const mu2 = tier === 0 ? mu1 : dgR(dgPick(dgGrid(0.10, 0.40, 0.01)), 2);
      if (tier >= 1) {
        // With the two coefficients close together the round is a slower copy
        // of the easy rung: the same-surface formula lands inside tolerance and
        // the reader learns nothing about the second surface.
        const ratio = mu1 / mu2;
        if (ratio > 0.78 && ratio < 1.27) continue;
      }

      /* Built backwards: the pull time is what is being asked for, so the
         window it must land in is fixed first and the CIRCLE is the given
         solved for — then snapped to the half-centimetre it is printed at and
         the time recomputed from the snapped circle. */
      const want = dgRand(0.10, 0.30);
      const Dmax = dgR(dgClothDist(want, mu1, mu2, g), 3);
      if (!(Dmax >= 0.020 && Dmax <= 0.300)) continue;
      const tSlide = dgClothTime(Dmax, mu1, mu2, g);
      if (!(tSlide >= 0.08 && tSlide <= 0.36)) continue;

      const v = mu1 * g * tSlide;
      const d1 = 0.5 * mu1 * g * tSlide * tSlide;
      const d2 = (v * v) / (2 * mu2 * g);

      /* "Cleared in time t" fixes the pull: the cloth has to gain L on the dish
         in that time, so A = mu1 g + 2L/t^2 and the cloth leaves at
         v = mu1 g t + 2L/t. That has to be a speed an arm can actually reach,
         or the round is asking about a stunt nobody can perform. */
      const L = dgR(dgPick(dgGrid(0.25, 0.60, 0.05)), 2);
      const vCloth = mu1 * g * tSlide + (2 * L) / tSlide;
      if (!(vCloth <= 7.0)) continue;

      const mass = dgR(dgPick(dgGrid(0.20, 0.90, 0.05)), 2);

      let w = 0, hG = 0, aTip = 0, tips = false, glassMass = 0;
      if (tier === 2) {
        w = dgR(dgPick(dgGrid(0.055, 0.090, 0.005)), 3);
        hG = dgR(dgPick(dgGrid(0.100, 0.170, 0.005)), 3);
        aTip = (w / (2 * hG)) * g;
        const muWorst = Math.max(mu1, mu2);
        // A comparison that turns on the third decimal is a coin toss, not a
        // question. The two sides have to be separated by more than any
        // plausible rounding of either.
        if (!(Math.abs(muWorst - w / (2 * hG)) >= 0.035)) continue;
        tips = muWorst * g > aTip;
        glassMass = dgR(dgPick(dgGrid(0.10, 0.35, 0.05)), 2);
      }

      const answer = tier === 2 && tips ? 0 : tSlide;
      const tol = Math.max(0.02 * answer, 0.005);

      const R0 = {
        game: "cloth", gameId: "tablecloth-pull", tier, g,
        mu1, mu2, Dmax, L, mass, tSlide, v, d1, d2,
        w, hG, aTip, tips, glassMass,
        answer, tol,
        tolTip: tier === 2 ? Math.max(0.02 * aTip, 0.01) : 0,
        answerKey: "tmax",
      };

      R0.wrong = {
        swapped: dgClothTime(Dmax, mu2, mu1, g),
        onlyDrag: Math.sqrt((2 * Dmax) / (mu1 * g)),
        onlySlide: Math.sqrt((2 * Dmax * mu2) / (mu1 * mu1 * g)),
        noHalf: Math.sqrt(Dmax / (mu1 * g * (1 + mu1 / mu2))),
        sameMu: Math.sqrt(Dmax / (mu1 * g)),
        answeredDistance: Dmax,
        answeredSpeed: v,
        slideAnyway: tSlide,
      };
      R0.wrongTip = {
        inverted: (hG / (2 * w)) * g,
        noHalf: (w / hG) * g,
        halfWidth: (w / (4 * hG)) * g,
      };

      // The two-surface rung exists to catch the same-surface formula; refuse a
      // round where that route cannot be told from the right answer.
      if (tier >= 1 && !(Math.abs(R0.wrong.sameMu - answer) > 3 * tol)) continue;
      if (tier >= 1 && !(Math.abs(R0.wrong.swapped - answer) > 3 * tol)) continue;

      return R0;
    }

    return dgClothFallback(tier);
  }

  function dgClothFallback(tier) {
    const g = dgG();
    const mu1 = 0.20;
    const mu2 = tier === 0 ? 0.20 : 0.32;
    const Dmax = tier === 0 ? 0.080 : 0.070;
    const tSlide = dgClothTime(Dmax, mu1, mu2, g);
    const v = mu1 * g * tSlide;
    const R0 = {
      game: "cloth", gameId: "tablecloth-pull", tier, g,
      mu1, mu2, Dmax, L: 0.45, mass: 0.40, tSlide, v,
      d1: 0.5 * mu1 * g * tSlide * tSlide,
      d2: (v * v) / (2 * mu2 * g),
      w: tier === 2 ? 0.070 : 0, hG: tier === 2 ? 0.140 : 0,
      aTip: tier === 2 ? (0.070 / 0.280) * g : 0,
      tips: false, glassMass: tier === 2 ? 0.20 : 0,
      answerKey: "tmax",
    };
    R0.answer = tSlide;
    R0.tol = Math.max(0.02 * tSlide, 0.005);
    R0.tolTip = tier === 2 ? Math.max(0.02 * R0.aTip, 0.01) : 0;
    R0.wrong = {
      swapped: dgClothTime(Dmax, mu2, mu1, g),
      onlyDrag: Math.sqrt((2 * Dmax) / (mu1 * g)),
      onlySlide: Math.sqrt((2 * Dmax * mu2) / (mu1 * mu1 * g)),
      noHalf: Math.sqrt(Dmax / (mu1 * g * (1 + mu1 / mu2))),
      sameMu: Math.sqrt(Dmax / (mu1 * g)),
      answeredDistance: Dmax,
      answeredSpeed: v,
      slideAnyway: tSlide,
    };
    R0.wrongTip = {
      inverted: tier === 2 ? (0.140 / 0.140) * g : NaN,
      noHalf: tier === 2 ? (0.070 / 0.140) * g : NaN,
      halfWidth: tier === 2 ? (0.070 / 0.560) * g : NaN,
    };
    return R0;
  }

  function dgClothView(R0) {
    const givens = [
      { label: "Dish mass, m", value: dgFmt(R0.mass, 2), unit: "kg" },
    ];
    if (R0.tier === 0) {
      givens.push({ label: "μ_k, dish on cloth AND dish on table", value: dgFmt(R0.mu1, 2), unit: "" });
    } else {
      givens.push({ label: "μ_k, dish on cloth, μ₁", value: dgFmt(R0.mu1, 2), unit: "" });
      givens.push({ label: "μ_k, dish on bare table, μ₂", value: dgFmt(R0.mu2, 2), unit: "" });
    }
    givens.push({ label: "Circle the dish must stay inside, D_max", value: dgFmt(R0.Dmax * 100, 1), unit: "cm" });
    givens.push({ label: "Cloth still under the setting, L", value: dgFmt(R0.L, 2), unit: "m" });
    if (R0.tier === 2) {
      givens.push({ label: "Glass width (base), w", value: dgFmt(R0.w * 100, 1), unit: "cm" });
      givens.push({ label: "Glass height to its centre of mass, h", value: dgFmt(R0.hG * 100, 1), unit: "cm" });
      givens.push({ label: "Glass mass", value: dgFmt(R0.glassMass, 2), unit: "kg" });
    }
    givens.push({ label: "g", value: dgFmt(R0.g, 2), unit: "m/s²" });

    const prompt = R0.tier === 0
      ? "The dish sits on the cloth. Yank the cloth clear and the dish is dragged forward for as long"
        + " as the cloth is underneath it, then slides to rest on the bare table. Cloth and table are"
        + " the same material here, so one coefficient does for both. What is the LONGEST pull time"
        + " that still leaves the dish inside the circle?"
      : R0.tier === 1
        ? "The dish sits on the cloth. Yank the cloth clear and the dish is dragged forward while the"
          + " cloth is underneath it, then slides to rest on the bare table — a different surface,"
          + " with its own coefficient. What is the LONGEST pull time that still leaves the dish"
          + " inside the circle?"
        : "The dish sits on the cloth with a tall glass standing on it. Two things can go wrong: the"
          + " dish can slide out of the circle, and the glass can topple. Work out the largest"
          + " acceleration the glass will stand, then give the longest pull time that keeps"
          + " EVERYTHING intact — and if the glass cannot survive any pull at all, that time is zero.";

    const note = R0.tier === 2
      ? "The glass tips when the acceleration under it exceeds (w/2h)·g — at that point the floor"
        + " can only still push up through the leading edge, so there is nothing left to right it."
        + " (The weight itself never leaves the base on a level table; it is the normal force that"
        + " runs out of room.) Both phases of the trick have an"
        + " acceleration: μ₁g while the cloth drags, μ₂g while the table brakes."
      : "Every distance here goes as t², so halving the pull time quarters the travel. The dish feels"
        + " μ₁g the whole time the cloth is under it whatever speed you pull at — what a fast pull"
        + " changes is how LONG it feels it.";

    const inputs = [];
    if (R0.tier === 2) {
      inputs.push({ key: "atip", label: "Largest acceleration the glass will stand", unit: "m/s²", step: "0.001" });
    }
    inputs.push({ key: "tmax", label: "Longest safe pull time", unit: "s", step: "0.001" });

    return {
      id: "tablecloth-pull", game: "cloth", difficulty: DG_LADDERS["tablecloth-pull"][R0.tier],
      prompt, note, givens, inputs,
    };
  }

  function dgClothSolution(R0) {
    const L = [];
    L.push("Two phases, joined by the speed the dish has when the cloth leaves.");
    L.push("");
    L.push("  Under the cloth:   a₁ = μ₁g = " + dgFmt(R0.mu1, 2) + " × " + dgFmt(R0.g, 2)
      + " = " + dgFmt(R0.mu1 * R0.g, 3) + " m/s²      v = μ₁g·t     d₁ = ½μ₁g·t²");
    L.push("  On the bare table: a₂ = μ₂g = " + dgFmt(R0.mu2, 2) + " × " + dgFmt(R0.g, 2)
      + " = " + dgFmt(R0.mu2 * R0.g, 3) + " m/s²      d₂ = v²/(2μ₂g)");
    L.push("");
    L.push("    D = ½μ₁g·t² + (μ₁g·t)²/(2μ₂g) = (μ₁g·t²/2)(1 + μ₁/μ₂)");
    L.push("");
    L.push("The dish mass is in every term and divides straight out — the " + dgFmt(R0.mass, 2)
      + " kg is never used.");
    L.push("");
    L.push("    1 + μ₁/μ₂ = 1 + " + dgFmt(R0.mu1, 2) + "/" + dgFmt(R0.mu2, 2) + " = "
      + dgFmt(1 + R0.mu1 / R0.mu2, 4));
    L.push("    t = √( 2D / (μ₁g(1 + μ₁/μ₂)) ) = √( 2 × " + dgFmt(R0.Dmax, 3) + " / ("
      + dgFmt(R0.mu1 * R0.g, 3) + " × " + dgFmt(1 + R0.mu1 / R0.mu2, 4) + ") ) = "
      + dgFmt(R0.tSlide, 4) + " s");
    L.push("");
    L.push("At that pull the dish leaves the cloth at v = " + dgFmt(R0.v, 4) + " m/s, having moved "
      + dgFmt(R0.d1 * 100, 2) + " cm, and slides a further " + dgFmt(R0.d2 * 100, 2)
      + " cm — " + dgFmt((R0.d1 + R0.d2) * 100, 2) + " cm in all.");
    L.push("");
    L.push("What that pull costs the arm: the cloth has to GAIN L on the dish in time t, so");
    L.push("½(A − μ₁g)t² = L and A = μ₁g + 2L/t² = " + dgFmt(R0.mu1 * R0.g + (2 * R0.L) / (R0.tSlide * R0.tSlide), 1)
      + " m/s², leaving the hand at " + dgFmt(R0.mu1 * R0.g * R0.tSlide + (2 * R0.L) / R0.tSlide, 2)
      + " m/s.");
    L.push("A gentler pull is a LONGER pull, and a longer pull is what pushes the dish out.");
    if (R0.tier === 2) {
      L.push("");
      L.push("The glass. Take torques about the LEADING bottom edge, in the frame of the accelerating");
      L.push("dish. The toppling term m·a·h beats the righting term m·g·(w/2) when:");
      L.push("");
      L.push("    a_tip = (w / 2h)·g = (" + dgFmt(R0.w, 3) + " / (2 × " + dgFmt(R0.hG, 3) + ")) × "
        + dgFmt(R0.g, 2) + " = " + dgFmt(R0.aTip, 4) + " m/s²");
      L.push("");
      L.push("    drag phase  μ₁g = " + dgFmt(R0.mu1 * R0.g, 3) + " m/s²   "
        + (R0.mu1 * R0.g > R0.aTip ? "OVER — the glass goes over" : "under — safe"));
      L.push("    brake phase μ₂g = " + dgFmt(R0.mu2 * R0.g, 3) + " m/s²   "
        + (R0.mu2 * R0.g > R0.aTip ? "OVER — the glass goes over" : "under — safe"));
      L.push("");
      if (R0.tips) {
        L.push("So the glass is the binding limit, and it binds before any question of distance: neither");
        L.push("acceleration depends on how long you pull, so no pull time is safe. t_max = 0. The trick");
        L.push("cannot be done with this glass on these surfaces — you need a squatter glass (larger");
        L.push("w/2h) or a slipperier cloth.");
        L.push("");
        L.push("The circle would have allowed " + dgFmt(R0.tSlide, 4) + " s, which is the answer to a");
        L.push("question nobody asked here.");
      } else {
        L.push("Both accelerations are under a_tip, so the glass rides it out and the circle is the");
        L.push("binding limit: t_max = " + dgFmt(R0.tSlide, 4) + " s.");
        L.push("");
        L.push("Worth noticing: neither acceleration depends on t. Had either been over a_tip, no pull");
        L.push("time whatever would have saved the glass.");
      }
    } else {
      L.push("");
      L.push("The direction of the relationship is the part worth keeping. D goes as t², so a pull");
      L.push("twice as quick leaves the dish a QUARTER as far out. A fast yank is not violent to the");
      L.push("dish — the dish feels μ₁g either way. It is brief.");
      if (R0.tier === 1) {
        L.push("");
        L.push("Treating both surfaces as one gives √(D/(μ₁g)) = " + dgFmt(R0.wrong.sameMu, 4)
          + " s, out by " + dgFmt(Math.abs(R0.wrong.sameMu - R0.tSlide) * 1000, 1) + " ms.");
      }
    }
    return L;
  }

  function dgClothMisconception(R0, guess, guessTip) {
    if (R0.tier === 2 && Number.isFinite(guessTip)) {
      const hitTip = (wrong) => dgRouteHit(guessTip, wrong, R0.aTip, R0.tolTip);
      if (hitTip(R0.wrongTip.inverted)) {
        return {
          id: "tip-ratio-inverted",
          label: "The tipping ratio is w over 2h, not the other way up",
          detail: " (h/2w)g = " + dgFmt(R0.wrongTip.inverted, 3) + " m/s² says a TALL glass is the"
            + " stable one, which is backwards. The righting torque is mg·(w/2) and the toppling one"
            + " is ma·h, so a_tip = (w/2h)g: wide and low is hard to tip, tall and narrow is easy.",
        };
      }
      if (hitTip(R0.wrongTip.noHalf)) {
        return {
          id: "tip-forgot-the-half-width",
          label: "The weight's arm is half the width",
          detail: " (w/h)g = " + dgFmt(R0.wrongTip.noHalf, 3) + " m/s² uses the whole base as the"
            + " lever arm. The glass tips about its leading EDGE, and the centre of mass sits w/2 in"
            + " from that edge, so the righting torque is mg·(w/2).",
        };
      }
    }

    const hit = (wrong) => dgRouteHit(guess, wrong, R0.answer, R0.tol);
    const W = R0.wrong;

    /* No route-matching needed on a round the glass cannot survive: the answer
       is zero, so ANY positive pull time is proof the glass gate was not
       applied. The tip-ratio detectors above run first, because a reader who
       got a_tip wrong made their mistake one step earlier than this. */
    if (R0.tier === 2 && R0.tips && guess > 3 * R0.tol) {
      return {
        id: "ignored-the-glass",
        label: "The circle was not the binding limit",
        detail: " " + dgFmt(W.slideAnyway, 3) + " s is the pull the CIRCLE would allow, and you would"
          + " be right if the glass were not there. But the glass tips at " + dgFmt(R0.aTip, 3)
          + " m/s² and the "
          + (R0.mu1 * R0.g > R0.aTip ? "drag phase alone puts " + dgFmt(R0.mu1 * R0.g, 3)
            : "braking phase puts " + dgFmt(R0.mu2 * R0.g, 3))
          + " m/s² under it. That acceleration does not depend on how long you pull, so shortening"
          + " the pull cannot save the glass: the answer is zero.",
      };
    }
    if (R0.tier === 2 && !R0.tips && Math.abs(guess) <= R0.tol) {
      return {
        id: "condemned-a-glass-that-survives",
        label: "This glass does stand up to it",
        detail: " Zero is the right answer when neither acceleration fits under a_tip, and here both"
          + " do: μ₁g = " + dgFmt(R0.mu1 * R0.g, 3) + " m/s² and μ₂g = " + dgFmt(R0.mu2 * R0.g, 3)
          + " m/s² against a_tip = " + dgFmt(R0.aTip, 3) + " m/s². With the glass safe the circle is"
          + " what binds, at " + dgFmt(R0.tSlide, 3) + " s.",
      };
    }
    if (R0.tier >= 1 && hit(W.sameMu)) {
      return {
        id: "one-coefficient-for-both",
        label: "The two surfaces are not the same",
        detail: " √(D/(μ₁g)) = " + dgFmt(W.sameMu, 3) + " s is the answer when cloth and table share"
          + " a coefficient, and here they do not: μ₁ = " + dgFmt(R0.mu1, 2) + " on the cloth,"
          + " μ₂ = " + dgFmt(R0.mu2, 2) + " on the table. The braking surface sets how far the dish"
          + " coasts after the cloth is gone, and that leg is "
          + dgFmt((R0.d2 / (R0.d1 + R0.d2)) * 100, 0) + "% of the whole travel.",
      };
    }
    if (hit(W.swapped)) {
      return {
        id: "coefficients-swapped",
        label: "μ₁ and μ₂ have changed places",
        detail: " " + dgFmt(W.swapped, 3) + " s uses the TABLE's coefficient to drag the dish and the"
          + " CLOTH's to stop it. While the cloth is underneath, the only surface the dish touches is"
          + " the cloth; the table is not in contact with it until the cloth has gone.",
      };
    }
    if (hit(W.onlyDrag)) {
      return {
        id: "forgot-the-coast",
        label: "The dish keeps going after the cloth is gone",
        detail: " √(2D/(μ₁g)) = " + dgFmt(W.onlyDrag, 3) + " s counts only the "
          + dgFmt(R0.d1 * 100, 2) + " cm the dish covers while it is being dragged. It leaves the"
          + " cloth at " + dgFmt(R0.v, 3) + " m/s and coasts another " + dgFmt(R0.d2 * 100, 2)
          + " cm before the table stops it — that second leg is usually the bigger one.",
      };
    }
    if (hit(W.onlySlide)) {
      return {
        id: "forgot-the-drag",
        label: "The dish moves while the cloth is still under it",
        detail: " You counted only the coast after the cloth left. The dish is already "
          + dgFmt(R0.d1 * 100, 2) + " cm along by then — the drag phase is where it picks up all of"
          + " its speed, and its own displacement counts against the circle too.",
      };
    }
    if (hit(W.noHalf)) {
      return {
        id: "lost-the-factor-of-two",
        label: "d = ½at², so t = √(2d/a)",
        detail: " " + dgFmt(W.noHalf, 3) + " s is your number with the ½ left behind when the equation"
          + " was inverted — always a factor of √2 = 1.414 out.",
      };
    }
    if (hit(W.answeredDistance)) {
      return {
        id: "answered-the-distance",
        label: "That is the circle, not a time",
        detail: " " + dgFmt(W.answeredDistance, 3) + " is D_max in metres. The box asks for the pull"
          + " time in seconds: " + dgFmt(R0.answer, 3) + " s.",
      };
    }
    if (hit(W.answeredSpeed)) {
      return {
        id: "answered-the-speed",
        label: "That is the speed the dish leaves at",
        detail: " v = μ₁g·t = " + dgFmt(W.answeredSpeed, 3) + " m/s is a real quantity in this"
          + " problem, and it is the one the two phases are joined by — but the question asks for t.",
      };
    }
    return null;
  }

  function dgClothGrade(R0, answers) {
    const solution = dgClothSolution(R0);

    let guessTip = NaN;
    if (R0.tier === 2) {
      guessTip = dgNum(answers ? answers.atip : undefined);
      if (!Number.isFinite(guessTip)) return dgBlank(solution);
    }
    const guess = dgNum(answers ? answers.tmax : undefined);
    if (!Number.isFinite(guess)) return dgBlank(solution);

    const okTip = R0.tier !== 2 || Math.abs(guessTip - R0.aTip) <= R0.tolTip;
    const delta = guess - R0.answer;
    const okTime = Math.abs(delta) <= R0.tol;
    const correct = okTime && okTip;

    // What the reader's number actually produces on the table, worked from
    // their number and not from the truth. Capped only for the drawing; the
    // reported overshoot uses the uncapped travel.
    const tHere = Math.max(guess, 0);
    const travel = dgClothDist(tHere, R0.mu1, R0.mu2, R0.g);
    const over = travel - R0.Dmax;

    let verdict, feedback;
    if (correct) {
      verdict = { kind: "hit", text: R0.tier === 2 && R0.tips ? "The glass was always going over" : "Stopped on the line" };
      feedback = R0.tier === 2 && R0.tips
        ? "Right, and for the right reason: the glass tips at " + dgFmt(R0.aTip, 3)
          + " m/s² and the drag alone is " + dgFmt(R0.mu1 * R0.g, 3)
          + " m/s². No pull time saves it, so the answer is zero — the circle's "
          + dgFmt(R0.tSlide, 3) + " s never gets a chance to bind."
        : "Exact " + dgFmt(R0.answer, 4) + " s; you gave " + dgFmt(guess, 4)
          + " s, inside ±" + dgFmt(R0.tol, 4) + ". The dish finishes " + dgFmt(travel * 100, 2)
          + " cm out, on the line.";
    } else if (!okTip && okTime) {
      verdict = { kind: "miss", text: "The glass's limit is wrong" };
      feedback = "The pull time is right. The tipping acceleration is not: a_tip = (w/2h)g = "
        + dgFmt(R0.aTip, 4) + " m/s², and you gave " + dgFmt(guessTip, 4) + " m/s².";
    } else if (R0.tier === 2 && R0.tips && guess > R0.tol) {
      verdict = { kind: "over", text: "Any pull topples the glass" };
      feedback = "The dish behaves itself — at " + dgFmt(guess, 3) + " s it stops "
        + dgFmt(travel * 100, 2) + " cm out, "
        + (over > 0 ? "which is already " + dgFmt(over * 100, 2) + " cm outside the circle"
          : "comfortably inside the circle")
        + ". The glass does not: it needs the acceleration under it to stay below "
        + dgFmt(R0.aTip, 3) + " m/s² and the "
        + (R0.mu1 * R0.g > R0.aTip ? "drag phase delivers " + dgFmt(R0.mu1 * R0.g, 3)
          : "braking phase delivers " + dgFmt(R0.mu2 * R0.g, 3))
        + " m/s² no matter how briskly you pull. The safe pull time is zero.";
    } else if (delta > 0) {
      verdict = {
        kind: "over",
        text: over > 0 ? "Overshot the circle by " + dgFmt(over * 100, 1) + " cm" : "Pulled too slowly",
      };
      feedback = "Too long under the cloth. At " + dgFmt(guess, 3) + " s the dish picks up "
        + dgFmt(R0.mu1 * R0.g * guess, 3) + " m/s and ends up " + dgFmt(travel * 100, 2) + " cm out"
        + ", against a circle at " + dgFmt(R0.Dmax * 100, 1) + " cm. The longest pull that works is "
        + dgFmt(R0.answer, 4) + " s. Remember the travel goes as t²: your pull is only "
        + dgFmt(guess / Math.max(R0.answer, 1e-9), 2) + "× too long and the distance is "
        + dgFmt(travel / Math.max(R0.Dmax, 1e-9), 2) + "× too far.";
    } else {
      verdict = {
        kind: "under",
        text: "Safe, with " + dgFmt((R0.Dmax - travel) * 100, 1) + " cm to spare",
      };
      feedback = "The dish survives — it stops " + dgFmt(travel * 100, 2) + " cm out with "
        + dgFmt((R0.Dmax - travel) * 100, 2) + " cm of circle unused — but the question asked for the"
        + " LONGEST pull that works, and that is " + dgFmt(R0.answer, 4) + " s. You were "
        + dgFmt(Math.abs(delta) * 1000, 1) + " ms short.";
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : dgClothMisconception(R0, guess, guessTip),
      solution,
      exact: R0.tier === 2
        ? { tmax: dgR(R0.answer, 5), atip: dgR(R0.aTip, 5), slideLimit: dgR(R0.tSlide, 5) }
        : { tmax: dgR(R0.answer, 5) },
      tolerance: R0.tier === 2
        ? { tmax: dgR(R0.tol, 5), atip: dgR(R0.tolTip, 5) }
        : { tmax: dgR(R0.tol, 5) },
      guess, guessTip, travel, over,
    };
  }

  /* ==========================================================================
     GAME 3 — the bowling ball at your nose
     --------------------------------------------------------------------------
     A bowling ball on a long wire, drawn back until it touches the lecturer's
     nose, and released from rest. The demonstration works because the physics
     is trustworthy and the consequence of it not being is a broken face, and
     the reader is asked for the number that decides which.

         h0    = L (1 - cos theta0)        the release height, above the lowest point
         ideal:  h_ret = h0               it returns to exactly where it left. No higher.
         losses: h_ret = h0 (1 - k)       clearance = h0 - h_ret
         a push: h_ret = (h0 + v0^2/2g)(1 - k)

     Release it from rest and it cannot come back higher than it started —
     there is nowhere for the extra energy to come from. Give it the gentlest
     shove on the way out and there is: v0^2/(2g) of height that the swing
     never gives back, and the clearance goes negative.

     The mass is given throughout and cancels throughout. A heavier ball does
     not come back lower; it comes back to the same place, harder.
     ========================================================================== */

  function dgBallHeights(L, th0, k, v0, g) {
    const h0 = L * (1 - Math.cos(th0));
    const hRet = (h0 + (v0 * v0) / (2 * g)) * (1 - k);
    return { h0, hRet, clearance: h0 - hRet };
  }

  function dgBallMake(tier) {
    const g = dgG();

    for (let attempt = 0; attempt < 900; attempt++) {
      const L = dgR(dgPick(dgGrid(1.60, 3.00, 0.05)), 2);
      const mass = dgR(dgPick(dgGrid(4.0, 7.3, 0.1)), 1);

      let th0Deg, th0, k = 0, v0 = 0;

      if (tier === 0) {
        /* Built backwards: the release height is the answer, so its window is
           fixed and the ANGLE is solved for, snapped to the half-degree a
           protractor on the wall actually reads, and the height recomputed
           from the snapped angle. */
        const want = dgRand(0.25, 0.80);
        const cs = 1 - want / L;
        if (!(cs > -0.05 && cs < 0.95)) continue;
        th0Deg = dgR(Math.acos(dgClamp(cs, -1, 1)) / DEG * 2, 0) / 2;
        if (!(th0Deg >= 24 && th0Deg <= 72)) continue;
        th0 = th0Deg * DEG;
      } else if (tier === 1) {
        // The clearance is the answer here, so it is fixed first and the
        // release height solved for through the given loss fraction.
        k = dgR(dgPick(dgGrid(0.02, 0.14, 0.01)), 2);
        const wantClear = dgRand(0.025, 0.110);
        const h0Want = wantClear / k;
        if (!(h0Want >= 0.25 && h0Want <= 0.90)) continue;
        const cs = 1 - h0Want / L;
        if (!(cs > -0.05 && cs < 0.95)) continue;
        th0Deg = dgR(Math.acos(dgClamp(cs, -1, 1)) / DEG * 2, 0) / 2;
        if (!(th0Deg >= 24 && th0Deg <= 72)) continue;
        th0 = th0Deg * DEG;
      } else {
        k = dgR(dgPick(dgGrid(0.02, 0.10, 0.01)), 2);
        th0Deg = dgR(dgPick(dgGrid(26, 68, 0.5)), 1);
        th0 = th0Deg * DEG;
        const h0 = L * (1 - Math.cos(th0));
        if (!(h0 >= 0.22 && h0 <= 0.95)) continue;
        // The push is the given solved for: fix how far past the nose it must
        // arrive, then find the shove that puts it there, snapped to 5 cm/s.
        const wantClear = -dgRand(0.045, 0.220);
        const rise = (k * h0 - wantClear) / (1 - k);
        if (!(rise > 0)) continue;
        v0 = dgR(Math.sqrt(2 * g * rise), 2);
        if (!(v0 >= 0.35 && v0 <= 2.60)) continue;
      }

      const H = dgBallHeights(L, th0, k, v0, g);
      if (!(H.h0 >= 0.20 && H.h0 <= 0.95)) continue;

      const answerM = tier === 0 ? H.h0 : H.clearance;
      const answer = answerM * 100;                       // the boxes are in centimetres
      if (tier === 1 && !(answer >= 1.8 && answer <= 13.5)) continue;
      if (tier === 2 && !(answer <= -2.5 && answer >= -28)) continue;

      const tol = tier === 0
        ? Math.max(0.5, 0.01 * Math.abs(answer))
        : Math.max(0.35, 0.02 * Math.abs(answer));

      const R0 = {
        game: "ball", gameId: "bowling-ball-nose", tier, g,
        L, th0, th0Deg, mass, k, v0,
        h0: H.h0, hRet: H.hRet, clearance: H.clearance,
        vBottom: Math.sqrt(2 * g * H.h0 + v0 * v0),
        rise: (v0 * v0) / (2 * g),
        answer, tol, answerKey: tier === 0 ? "height" : "clearance",
      };

      R0.wrong = tier === 0
        ? {
          usedCos: 100 * L * Math.cos(th0),
          usedSin: 100 * L * Math.sin(th0),
          fullLength: 100 * L,
          inMetres: H.h0,
          doubled: 200 * H.h0,
        }
        : tier === 1
          ? {
            returnHeight: 100 * H.hRet,
            releaseHeight: 100 * H.h0,
            lossOfLength: 100 * k * L,
            inMetres: H.clearance,
            zero: 0,
          }
          : {
            ignoredPush: 100 * k * H.h0,
            ignoredLoss: -100 * (v0 * v0) / (2 * g),
            signFlip: -answer,
            forgotTwo: 100 * (k * H.h0 - ((v0 * v0) / g) * (1 - k)),
            lossOnReleaseOnly: 100 * (k * H.h0 - (v0 * v0) / (2 * g)),
            returnHeight: 100 * H.hRet,
          };

      // The push rung exists to prove that a shove never comes back out. If the
      // loss-only answer cannot be told from the truth, it has not proved it.
      if (tier === 2 && !(Math.abs(R0.wrong.ignoredPush - answer) > 3 * tol)) continue;
      if (tier === 1 && !(Math.abs(R0.wrong.returnHeight - answer) > 3 * tol)) continue;

      return R0;
    }

    return dgBallFallback(tier);
  }

  function dgBallFallback(tier) {
    const g = dgG();
    const L = 2.40, th0Deg = 40, th0 = 40 * DEG;
    const k = tier === 0 ? 0 : 0.06;
    const v0 = tier === 2 ? 1.20 : 0;
    const H = dgBallHeights(L, th0, k, v0, g);
    const answer = (tier === 0 ? H.h0 : H.clearance) * 100;
    const tol = tier === 0 ? Math.max(0.5, 0.01 * Math.abs(answer)) : Math.max(0.35, 0.02 * Math.abs(answer));
    const R0 = {
      game: "ball", gameId: "bowling-ball-nose", tier, g,
      L, th0, th0Deg, mass: 5.4, k, v0,
      h0: H.h0, hRet: H.hRet, clearance: H.clearance,
      vBottom: Math.sqrt(2 * g * H.h0 + v0 * v0),
      rise: (v0 * v0) / (2 * g),
      answer, tol, answerKey: tier === 0 ? "height" : "clearance",
    };
    R0.wrong = tier === 0
      ? { usedCos: 100 * L * Math.cos(th0), usedSin: 100 * L * Math.sin(th0), fullLength: 100 * L, inMetres: H.h0, doubled: 200 * H.h0 }
      : tier === 1
        ? { returnHeight: 100 * H.hRet, releaseHeight: 100 * H.h0, lossOfLength: 100 * k * L, inMetres: H.clearance, zero: 0 }
        : {
          ignoredPush: 100 * k * H.h0,
          ignoredLoss: -100 * (v0 * v0) / (2 * g),
          signFlip: -answer,
          forgotTwo: 100 * (k * H.h0 - ((v0 * v0) / g) * (1 - k)),
          lossOnReleaseOnly: 100 * (k * H.h0 - (v0 * v0) / (2 * g)),
          returnHeight: 100 * H.hRet,
        };
    return R0;
  }

  function dgBallView(R0) {
    const givens = [
      { label: "Wire length, L", value: dgFmt(R0.L, 2), unit: "m" },
      { label: "Release angle from the vertical, θ₀", value: dgFmt(R0.th0Deg, 1), unit: "°" },
      { label: "Ball mass, m", value: dgFmt(R0.mass, 1), unit: "kg" },
    ];
    if (R0.tier === 0) {
      givens.push({ label: "Pivot", value: "take it as frictionless", unit: "" });
    } else {
      givens.push({ label: "Energy lost per round trip, k", value: dgFmt(R0.k * 100, 0), unit: "%" });
    }
    if (R0.tier === 2) {
      givens.push({ label: "Speed of the shove at release, v₀", value: dgFmt(R0.v0, 2), unit: "m/s" });
    }
    givens.push({ label: "g", value: dgFmt(R0.g, 2), unit: "m/s²" });

    const prompt = R0.tier === 0
      ? "The ball is drawn back until it just touches your nose and released FROM REST. It swings"
        + " away, comes back, and you do not move. How high above the lowest point of the swing does"
        + " it arrive on the way back?"
      : R0.tier === 1
        ? "The same swing, but the pivot is real and a fraction of the energy is lost each round"
          + " trip. The ball is released from rest at your nose. By how much does it fall SHORT of   your nose in HEIGHT — the drop below your release point — when it comes back"
          + " when it comes back? Give a positive number for a gap."
        : "The ball is released at your nose — and this time somebody gives it a shove on the way"
          + " out, at the speed below. The pivot still loses its fraction each round trip. What is"
          + " the clearance now? Positive if it stops short of your nose, negative if it arrives"
          + " past it.";

    const note = R0.tier === 2
      ? "Energy from a push is added at the start and is never given back. Compare it with the energy"
        + " the pivot takes out and see which is larger — that comparison is the whole question."
      : "The height it reaches is set by energy alone: mgh at the top, ½mv² at the bottom, and the m"
        + " divides out of both. Nothing about the swing can put back more than went in.";

    const inputs = R0.tier === 0
      ? [{ key: "height", label: "Return height above the lowest point", unit: "cm", step: "0.1" }]
      : [{ key: "clearance", label: "Height it falls short by", unit: "cm", step: "0.1" }];

    return {
      id: "bowling-ball-nose", game: "ball", difficulty: DG_LADDERS["bowling-ball-nose"][R0.tier],
      prompt, note, givens, inputs,
    };
  }

  function dgBallSolution(R0) {
    const L = [];
    L.push("Height first, from the geometry of the wire:");
    L.push("");
    L.push("    h₀ = L(1 − cos θ₀) = " + dgFmt(R0.L, 2) + " × (1 − cos " + dgFmt(R0.th0Deg, 1)
      + "°) = " + dgFmt(R0.L, 2) + " × " + dgFmt(1 - Math.cos(R0.th0), 5) + " = "
      + dgFmt(R0.h0, 4) + " m = " + dgFmt(R0.h0 * 100, 2) + " cm");
    L.push("");
    L.push("The " + dgFmt(R0.mass, 1) + " kg is in every term of every energy equation below and");
    L.push("divides out of all of them. A heavier ball does not come back lower.");
    L.push("");
    if (R0.tier === 0) {
      L.push("Released from REST with a frictionless pivot, the energy at the top of the swing back");
      L.push("must equal the energy at the top of the swing out:");
      L.push("");
      L.push("    m g h_ret = m g h₀    →    h_ret = h₀ = " + dgFmt(R0.h0 * 100, 2) + " cm");
      L.push("");
      L.push("It arrives at exactly the height it left, with exactly zero speed — it kisses the nose");
      L.push("and stops. Not a millimetre higher, because there is nowhere for the extra energy to");
      L.push("come from. At the bottom it is doing v = √(2gh₀) = " + dgFmt(R0.vBottom, 3) + " m/s,");
      L.push("which is what makes standing still feel like a bad idea and is exactly why it is safe.");
    } else {
      L.push("At the bottom of the swing:  ½mv² = mg h₀"
        + (R0.v0 > 0 ? " + ½mv₀²" : "") + "   →   v = " + dgFmt(R0.vBottom, 3) + " m/s");
      L.push("");
      if (R0.tier === 2) {
        L.push("The shove adds height that the swing never gives back:");
        L.push("");
        L.push("    v₀²/(2g) = " + dgFmt(R0.v0, 2) + "² / (2 × " + dgFmt(R0.g, 2) + ") = "
          + dgFmt(R0.rise, 4) + " m = " + dgFmt(R0.rise * 100, 2) + " cm");
        L.push("");
        L.push("    h_ret = (h₀ + v₀²/2g)(1 − k) = (" + dgFmt(R0.h0, 4) + " + " + dgFmt(R0.rise, 4)
          + ") × " + dgFmt(1 - R0.k, 2) + " = " + dgFmt(R0.hRet, 4) + " m");
      } else {
        L.push("    h_ret = h₀(1 − k) = " + dgFmt(R0.h0, 4) + " × " + dgFmt(1 - R0.k, 2)
          + " = " + dgFmt(R0.hRet, 4) + " m");
      }
      L.push("");
      L.push("    clearance = h₀ − h_ret = " + dgFmt(R0.h0, 4) + " − " + dgFmt(R0.hRet, 4)
        + " = " + dgFmt(R0.clearance, 4) + " m = " + dgFmt(R0.answer, 2) + " cm");
      L.push("");
      if (R0.tier === 2) {
        L.push("Negative, and that is the answer: it arrives " + dgFmt(Math.abs(R0.answer), 2)
          + " cm PAST where your nose is, still moving,");
        L.push("at " + dgFmt(Math.sqrt(Math.max(2 * R0.g * (R0.hRet - R0.h0), 0)), 3)
          + " m/s. The pivot took " + dgFmt(R0.k * 100, 0) + "% out; the shove put "
          + dgFmt(R0.rise * 100, 2) + " cm in.");
        L.push("Losses alone would have cleared you by " + dgFmt(R0.wrong.ignoredPush, 2)
          + " cm — the shove is " + dgFmt(Math.abs(R0.answer) / Math.max(R0.wrong.ignoredPush, 1e-9), 1)
          + "× larger than the margin the pivot was giving you.");
        L.push("");
        L.push("This is the only way the demonstration ever goes wrong, and it is why the lecturer");
        L.push("releases it and does not throw it.");
      } else {
        L.push("A gap of " + dgFmt(R0.answer, 2) + " cm — small, and on the right side of your face.");
        L.push("Note what k is a fraction OF: the energy, and therefore the height, not the length of");
        L.push("the wire. " + dgFmt(R0.k * 100, 0) + "% of L would be " + dgFmt(R0.wrong.lossOfLength, 1)
          + " cm, which is a different number about a different thing.");
      }
    }
    return L;
  }

  function dgBallMisconception(R0, guess) {
    const hit = (wrong) => dgRouteHit(guess, wrong, R0.answer, R0.tol);
    const W = R0.wrong;

    if (R0.tier === 0) {
      if (hit(W.usedCos)) {
        return {
          id: "height-is-l-minus-lcos",
          label: "L cos θ₀ is the distance DOWN from the pivot",
          detail: " " + dgFmt(W.usedCos, 1) + " cm is how far the ball hangs below the pivot at"
            + " release. The height that matters is measured up from the LOWEST point of the swing,"
            + " where the ball hangs L below the pivot: h₀ = L − L cos θ₀ = "
            + dgFmt(R0.h0 * 100, 2) + " cm.",
        };
      }
      if (hit(W.usedSin)) {
        return {
          id: "used-the-horizontal-offset",
          label: "L sin θ₀ is sideways, not up",
          detail: " " + dgFmt(W.usedSin, 1) + " cm is how far the ball is drawn back horizontally."
            + " Gravity only cares about the vertical rise, which is L(1 − cos θ₀) = "
            + dgFmt(R0.h0 * 100, 2) + " cm.",
        };
      }
      if (hit(W.doubled)) {
        return {
          id: "comes-back-higher",
          label: "It cannot come back higher than it started",
          detail: " Released from REST there is no energy in the system beyond mgh₀, and the swing"
            + " has no way to manufacture more. It returns to exactly h₀ = " + dgFmt(R0.h0 * 100, 2)
            + " cm — the speed it builds on the way down is the same energy in a different form, and"
            + " it is all spent again climbing back up.",
        };
      }
      if (hit(W.fullLength)) {
        return {
          id: "answered-the-wire-length",
          label: "That is the wire, not the rise",
          detail: " " + dgFmt(W.fullLength, 0) + " cm is L. The ball only rises L(1 − cos θ₀) = "
            + dgFmt(R0.h0 * 100, 2) + " cm above the bottom of its swing.",
        };
      }
      if (hit(W.inMetres)) {
        return {
          id: "answered-in-metres",
          label: "Right number, wrong unit",
          detail: " " + dgFmt(W.inMetres, 4) + " m is the height; the box asks for centimetres: "
            + dgFmt(R0.answer, 2) + " cm.",
        };
      }
      return null;
    }

    if (R0.tier === 1) {
      if (hit(W.returnHeight)) {
        return {
          id: "answered-the-return-height",
          label: "That is where it gets to, not how far it misses by",
          detail: " h_ret = h₀(1 − k) = " + dgFmt(W.returnHeight, 2) + " cm is the height it reaches."
            + " Your nose is at h₀ = " + dgFmt(R0.h0 * 100, 2) + " cm, so the clearance is the"
            + " DIFFERENCE: h₀ − h_ret = k·h₀ = " + dgFmt(R0.answer, 2) + " cm.",
        };
      }
      if (hit(W.releaseHeight)) {
        return {
          id: "answered-the-release-height",
          label: "That is h₀",
          detail: " " + dgFmt(W.releaseHeight, 2) + " cm is where it started. The question asks how"
            + " much of that it fails to get back: k·h₀ = " + dgFmt(R0.answer, 2) + " cm.",
        };
      }
      if (hit(W.lossOfLength)) {
        return {
          id: "loss-taken-off-the-wire",
          label: "k is a fraction of the ENERGY",
          detail: " " + dgFmt(W.lossOfLength, 2) + " cm is " + dgFmt(R0.k * 100, 0)
            + "% of the wire length. The loss is a fraction of the energy, and the energy is mgh, so"
            + " it is a fraction of the HEIGHT above the lowest point: k·h₀ = "
            + dgFmt(R0.answer, 2) + " cm.",
        };
      }
      if (hit(W.zero)) {
        return {
          id: "ignored-the-loss",
          label: "Zero is the frictionless answer",
          detail: " With a perfect pivot it returns to exactly the nose and the clearance is zero —"
            + " that is the version of this demonstration people stand still for. Here the pivot"
            + " takes " + dgFmt(R0.k * 100, 0) + "% of the energy each round trip, so it comes back"
            + " k·h₀ = " + dgFmt(R0.answer, 2) + " cm low.",
        };
      }
      if (hit(W.inMetres)) {
        return {
          id: "answered-in-metres",
          label: "Right number, wrong unit",
          detail: " " + dgFmt(W.inMetres, 4) + " m is the clearance; the box asks for centimetres: "
            + dgFmt(R0.answer, 2) + " cm.",
        };
      }
      return null;
    }

    if (hit(W.ignoredPush)) {
      return {
        id: "the-push-never-comes-back-out",
        label: "The shove is still in there",
        detail: " k·h₀ = " + dgFmt(W.ignoredPush, 2) + " cm is the clearance you would get from the"
          + " losses alone, and it is the answer to the previous rung. The shove added"
          + " v₀²/2g = " + dgFmt(R0.rise * 100, 2) + " cm of height at the start, and a swing has no"
          + " way to give that back — it is " + dgFmt(R0.rise / Math.max(R0.k * R0.h0, 1e-9), 1)
          + "× the margin the pivot was providing, so the clearance goes negative and it reaches you.",
      };
    }
    if (hit(W.ignoredLoss)) {
      return {
        id: "ignored-the-loss",
        label: "The pivot is still taking its cut",
        detail: " −v₀²/2g = " + dgFmt(W.ignoredLoss, 2) + " cm is the push with a perfect pivot."
          + " This one loses " + dgFmt(R0.k * 100, 0) + "% of the energy per round trip, which claws"
          + " back some of it: h_ret = (h₀ + v₀²/2g)(1 − k), so the clearance is "
          + dgFmt(R0.answer, 2) + " cm rather than " + dgFmt(W.ignoredLoss, 2) + " cm.",
      };
    }
    if (hit(W.signFlip)) {
      return {
        id: "sign-inverted",
        label: "Right size, wrong side of your face",
        detail: " The magnitude is right, so the energy accounting held. The sign says which side of"
          + " your nose it arrives on: h_ret = " + dgFmt(R0.hRet * 100, 2) + " cm against a nose at "
          + dgFmt(R0.h0 * 100, 2) + " cm, so it arrives ABOVE the release point and the clearance is"
          + " negative — " + dgFmt(R0.answer, 2) + " cm.",
      };
    }
    if (hit(W.forgotTwo)) {
      return {
        id: "lost-the-two",
        label: "½mv₀² = mg·h, so h = v₀²/(2g)",
        detail: " Your number uses v₀²/g and is a factor of two heavy on the push. The kinetic energy"
          + " carries a ½, and it survives into the height: v₀²/2g = " + dgFmt(R0.rise * 100, 2)
          + " cm, not " + dgFmt((R0.v0 * R0.v0 / R0.g) * 100, 2) + " cm.",
      };
    }
    if (hit(W.lossOnReleaseOnly)) {
      return {
        id: "loss-applied-to-part-of-the-energy",
        label: "The pivot cannot tell which energy is which",
        detail: " You took k off the release height and left the push untouched. Friction acts on"
          + " whatever energy is going past it, so the fraction comes off the TOTAL:"
          + " h_ret = (h₀ + v₀²/2g)(1 − k), giving " + dgFmt(R0.answer, 2) + " cm.",
      };
    }
    if (hit(W.returnHeight)) {
      return {
        id: "answered-the-return-height",
        label: "That is where it gets to, not the clearance",
        detail: " h_ret = " + dgFmt(W.returnHeight, 2) + " cm is the height it reaches, measured from"
          + " the bottom of the swing. The clearance is h₀ − h_ret = " + dgFmt(R0.answer, 2) + " cm.",
      };
    }
    return null;
  }

  function dgBallGrade(R0, answers) {
    const solution = dgBallSolution(R0);
    const guess = dgNum(answers ? answers[R0.answerKey] : undefined);
    if (!Number.isFinite(guess)) return dgBlank(solution);

    const delta = guess - R0.answer;
    const correct = Math.abs(delta) <= R0.tol;

    // The height their number puts the ball at when it comes back, in metres.
    // Everything the reveal does is worked from this and nothing else.
    const hTheirs = R0.tier === 0 ? guess / 100 : R0.h0 - guess / 100;
    const strikes = hTheirs > R0.h0 + 1e-6;

    let verdict, feedback;
    if (correct) {
      verdict = {
        kind: "hit",
        text: R0.tier === 0 ? "Back to the nose, exactly"
          : R0.clearance >= 0 ? "Cleared by " + dgFmt(R0.answer, 1) + " cm"
            : "It reaches you, as called",
      };
      feedback = R0.tier === 0
        ? "Exactly right: h_ret = h₀ = " + dgFmt(R0.answer, 2) + " cm. It comes back to your nose"
          + " with no speed left, and stops there."
        : R0.clearance >= 0
          ? "Exact " + dgFmt(R0.answer, 2) + " cm; you gave " + dgFmt(guess, 2) + " cm. The pivot's "
            + dgFmt(R0.k * 100, 0) + "% is the whole of your margin, and it is enough."
          : "Exact " + dgFmt(R0.answer, 2) + " cm; you gave " + dgFmt(guess, 2)
            + " cm. It arrives " + dgFmt(Math.abs(R0.answer), 2)
            + " cm past your nose and still moving. Called correctly — which is the only reason to"
            + " be standing anywhere else.";
    } else if (strikes && R0.clearance >= 0) {
      // Their number says it comes back higher than it left, which on these two
      // rungs is the one outcome energy forbids outright — worth naming as a
      // consequence rather than as a size of error.
      verdict = { kind: delta > 0 ? "over" : "under", text: "Your number puts it in your face" };
      feedback = "You have it arriving " + dgFmt((hTheirs - R0.h0) * 100, 2)
        + " cm above where it was released. Nothing in the swing can do that: it starts at rest, so"
        + " mgh₀ is all the energy there is, and the pivot only ever takes some away. The true "
        + (R0.tier === 0 ? "return height is " + dgFmt(R0.answer, 2) + " cm — exactly h₀."
          : "clearance is " + dgFmt(R0.answer, 2) + " cm, on the safe side of your face.");
    } else if (delta > 0) {
      verdict = {
        kind: "over",
        text: "Stopped " + dgFmt(Math.abs(delta), 1) + " cm "
          + (R0.tier === 0 ? "too high" : "short of where it does"),
      };
      feedback = (R0.tier === 0
        ? "Too high by " + dgFmt(delta, 2) + " cm. "
        : "You allowed yourself " + dgFmt(delta, 2) + " cm more clearance than there is. ")
        + "Exact " + (R0.tier === 0 ? "return height " : "clearance ") + dgFmt(R0.answer, 2)
        + " cm; you gave " + dgFmt(guess, 2) + " cm, against a tolerance of ±"
        + dgFmt(R0.tol, 2) + " cm."
        + (R0.tier !== 0 && R0.clearance < 0 && guess > 0
          ? " Worse than a number: you have it stopping short when it actually arrives past you."
          : "");
    } else {
      verdict = {
        kind: "under",
        text: "Came back " + dgFmt(Math.abs(delta), 1) + " cm "
          + (R0.tier === 0 ? "higher than you said" : "further than you said"),
      };
      feedback = (R0.tier === 0
        ? "Too low by " + dgFmt(-delta, 2) + " cm. "
        : "You expected it to fall " + dgFmt(-delta, 2) + " cm shorter than it does. ")
        + "Exact " + (R0.tier === 0 ? "return height " : "clearance ") + dgFmt(R0.answer, 2)
        + " cm; you gave " + dgFmt(guess, 2) + " cm, against a tolerance of ±"
        + dgFmt(R0.tol, 2) + " cm.";
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : dgBallMisconception(R0, guess),
      solution,
      exact: {
        releaseHeight: dgR(R0.h0 * 100, 3),
        returnHeight: dgR(R0.hRet * 100, 3),
        clearance: dgR(R0.clearance * 100, 3),
      },
      tolerance: { [R0.answerKey]: dgR(R0.tol, 3) },
      guess, hTheirs, strikes,
    };
  }

  /* ==========================================================================
     GAME 4 — Newton's cradle
     --------------------------------------------------------------------------
     Lift k of the n balls, let them go, and k come out the far side. The
     interesting part is not the answer, it is that MOMENTUM ALONE CANNOT GIVE
     IT. One ball in at v and two out at v/2 conserves momentum perfectly:

         p:  m v            ->  2 · m (v/2)      = m v          balances
         KE: 1/2 m v^2      ->  2 · 1/2 m (v/2)^2 = 1/4 m v^2    HALF of it, gone

     and there is nowhere for half the kinetic energy of a set of hardened
     steel balls to go. Energy is what picks the real outcome out of the family
     momentum permits, and that arithmetic is the entire lesson of the toy.

     Unequal masses, head-on and elastic:

         v1' = ((m1 - m2)/(m1 + m2)) v1        v2' = (2 m1/(m1 + m2)) v1

     and if m1 < m2 the first ball comes BACK. Perfectly inelastic instead:
     v = m1 v1/(m1 + m2), and the kinetic energy lost is 1/2 mu v1^2 with
     mu = m1 m2/(m1 + m2), which is the largest loss momentum allows.
     ========================================================================== */

  function dgCradleMake(tier) {
    const g = dgG();

    for (let attempt = 0; attempt < 900; attempt++) {
      const L = dgR(dgPick(dgGrid(0.30, 0.55, 0.01)), 2);
      const D = dgR(dgPick(dgGrid(0.030, 0.045, 0.005)), 3);    // ball diameter, for the drawing

      if (tier === 0) {
        const n = dgPick([5, 5, 6, 7]);
        const k = dgPick([1, 1, 2, 2, 3].filter((x) => x <= n - 2));
        if (!k) continue;
        const thDeg = dgR(dgPick(dgGrid(15, 45, 1)), 0);
        const th = thDeg * DEG;
        const m = dgR(dgPick(dgGrid(0.04, 0.12, 0.01)), 2);
        const v = Math.sqrt(2 * g * L * (1 - Math.cos(th)));
        if (!(v >= 0.30 && v <= 1.80)) continue;
        return {
          game: "cradle", gameId: "newtons-cradle", tier, g,
          n, k, m, L, D, th, thDeg, v,
          p: k * m * v, KE: 0.5 * k * m * v * v,
          answer: k, tol: 0, answerKey: "count",
        };
      }

      const m1 = dgR(dgPick(dgGrid(0.04, 0.30, 0.01)), 2);
      const m2 = dgR(dgPick(dgGrid(0.04, 0.30, 0.01)), 2);
      const S = m1 + m2;
      // Near-equal masses make the first ball stop dead, which is the case the
      // easy rung already showed. The point of this rung is the case it cannot.
      if (!(Math.abs(m1 - m2) / S >= 0.15)) continue;

      /* Built backwards from the struck ball's speed: that window is fixed
         first and v1 — the number the photogate at the bottom prints — is
         solved for, snapped to a centimetre per second, and everything
         recomputed from the snapped value. */
      let v1;
      if (tier === 1) {
        const want = dgRand(0.80, 3.00);
        v1 = dgR((want * S) / (2 * m1), 2);
      } else {
        const want = dgRand(0.40, 2.20);
        v1 = dgR((want * S) / m1, 2);
      }
      if (!(v1 >= 0.35 && v1 <= 2.80)) continue;
      // The incoming ball is lifted, not thrown, so its speed has to be one a
      // swing of this cradle can actually deliver.
      const csLift = 1 - (v1 * v1) / (2 * g * L);
      if (!(csLift > 0.24)) continue;
      const thDeg = dgR(Math.acos(dgClamp(csLift, -1, 1)) / DEG, 1);
      const th = thDeg * DEG;

      const v1f = ((m1 - m2) / S) * v1;
      const v2f = ((2 * m1) / S) * v1;
      const vc = (m1 * v1) / S;
      const keI = 0.5 * m1 * v1 * v1;
      const keLost = 0.5 * ((m1 * m2) / S) * v1 * v1;

      if (tier === 1) {
        const tol2 = Math.max(0.02 * v2f, 0.005);
        const tol1 = Math.max(0.02 * Math.abs(v1f), 0.005);
        if (!(v2f >= 0.60 && v2f <= 3.60)) continue;
        if (!(Math.abs(Math.abs(v1f) - v2f) > 3 * Math.max(tol1, tol2))) continue;
        // "It just transfers" and "they move off together" both have to be
        // provably different from the truth or the rung proves nothing.
        if (!(Math.abs(v2f - v1) > 3 * tol2)) continue;
        if (!(Math.abs(v2f - vc) > 3 * tol2)) continue;
        const R0 = {
          game: "cradle", gameId: "newtons-cradle", tier, g,
          m1, m2, S, L, D, v1, th, thDeg, v1f, v2f, vc, keI, keLost,
          tol1, tol2, answerKey: "v2f",
        };
        R0.wrong = {
          transfers: v1,
          together: vc,
          swapped: ((2 * m2) / S) * v1,
          v1fZero: 0,
          v1fFlipped: -v1f,
          v1fTogether: vc,
        };
        return R0;
      }

      const tolV = Math.max(0.02 * vc, 0.005);
      const tolE = Math.max(0.02 * keLost, 0.0005);
      if (!(vc >= 0.30 && vc <= 2.30)) continue;
      if (!(keLost >= 0.005)) continue;
      // The elastic answer is exactly twice the common velocity, so it can only
      // fail to be separable if the speed itself is inside a tolerance of zero.
      if (!(Math.abs(v2f - vc) > 3 * tolV)) continue;
      const R0 = {
        game: "cradle", gameId: "newtons-cradle", tier, g,
        m1, m2, S, L, D, v1, th, thDeg, v1f, v2f, vc, keI, keLost,
        tolV, tolE, answerKey: "vc",
      };
      R0.wrong = {
        elastic: v2f,
        unchanged: v1,
        swapped: (m2 * v1) / S,
        keAll: keI,
        keSurvives: 0.5 * S * vc * vc,
        keNoHalf: ((m1 * m2) / S) * v1 * v1,
        keDiffOfSpeeds: 0.5 * m1 * (v1 - vc) * (v1 - vc),
      };
      return R0;
    }

    return dgCradleFallback(tier);
  }

  function dgCradleFallback(tier) {
    const g = dgG();
    const L = 0.40, D = 0.035;
    if (tier === 0) {
      const th = 30 * DEG;
      const v = Math.sqrt(2 * g * L * (1 - Math.cos(th)));
      return {
        game: "cradle", gameId: "newtons-cradle", tier, g,
        n: 5, k: 2, m: 0.08, L, D, th, thDeg: 30, v,
        p: 2 * 0.08 * v, KE: 0.5 * 2 * 0.08 * v * v,
        answer: 2, tol: 0, answerKey: "count",
      };
    }
    const m1 = 0.20, m2 = 0.10, S = 0.30, v1 = 1.20;
    const th = Math.acos(dgClamp(1 - (v1 * v1) / (2 * g * L), -1, 1));
    const v1f = ((m1 - m2) / S) * v1;
    const v2f = ((2 * m1) / S) * v1;
    const vc = (m1 * v1) / S;
    const keI = 0.5 * m1 * v1 * v1;
    const keLost = 0.5 * ((m1 * m2) / S) * v1 * v1;
    const R0 = {
      game: "cradle", gameId: "newtons-cradle", tier, g,
      m1, m2, S, L, D, v1, th, thDeg: dgR(th / DEG, 1), v1f, v2f, vc, keI, keLost,
    };
    if (tier === 1) {
      R0.tol1 = Math.max(0.02 * Math.abs(v1f), 0.005);
      R0.tol2 = Math.max(0.02 * v2f, 0.005);
      R0.answerKey = "v2f";
      R0.wrong = { transfers: v1, together: vc, swapped: ((2 * m2) / S) * v1, v1fZero: 0, v1fFlipped: -v1f, v1fTogether: vc };
    } else {
      R0.tolV = Math.max(0.02 * vc, 0.005);
      R0.tolE = Math.max(0.02 * keLost, 0.0005);
      R0.answerKey = "vc";
      R0.wrong = {
        elastic: v2f, unchanged: v1, swapped: (m2 * v1) / S,
        keAll: keI, keSurvives: 0.5 * S * vc * vc,
        keNoHalf: ((m1 * m2) / S) * v1 * v1,
        keDiffOfSpeeds: 0.5 * m1 * (v1 - vc) * (v1 - vc),
      };
    }
    return R0;
  }

  function dgCradleView(R0) {
    if (R0.tier === 0) {
      const choices = [];
      for (let i = 1; i <= R0.n; i++) {
        choices.push({
          value: String(i),
          label: i === R0.n ? "all " + R0.n + " of them"
            : i === 1 ? "one ball" : i + " balls",
        });
      }
      return {
        id: "newtons-cradle", game: "cradle", difficulty: DG_LADDERS["newtons-cradle"][0],
        prompt: "All " + R0.n + " balls are identical and hang touching in a line. "
          + (R0.k === 1 ? "One ball is" : R0.k + " balls are") + " lifted from the left-hand end to"
          + " the angle below and released together. How many balls swing out on the right?",
        note: "Both momentum and kinetic energy are conserved — the balls are hardened steel and the"
          + " collision is very nearly elastic. Momentum on its own permits several answers here."
          + " Only one of them also balances the energy.",
        givens: [
          { label: "Balls in the line, n", value: String(R0.n), unit: "" },
          { label: "Balls lifted and released", value: String(R0.k), unit: "" },
          { label: "Mass of each ball", value: dgFmt(R0.m, 2), unit: "kg" },
          { label: "String length", value: dgFmt(R0.L, 2), unit: "m" },
          { label: "Lift angle from the vertical", value: dgFmt(R0.thDeg, 0), unit: "°" },
          { label: "g", value: dgFmt(R0.g, 2), unit: "m/s²" },
        ],
        inputs: [{ key: "count", label: "Balls that swing out on the right", choices }],
      };
    }

    const givens = [
      { label: "Moving ball, m₁", value: dgFmt(R0.m1, 2), unit: "kg" },
      { label: "Struck ball, m₂", value: dgFmt(R0.m2, 2), unit: "kg" },
      { label: "Speed of m₁ at the bottom, v₁", value: dgFmt(R0.v1, 2), unit: "m/s" },
      { label: "m₂ before the hit", value: "at rest", unit: "" },
      { label: "String length", value: dgFmt(R0.L, 2), unit: "m" },
      { label: "g", value: dgFmt(R0.g, 2), unit: "m/s²" },
    ];

    if (R0.tier === 1) {
      return {
        id: "newtons-cradle", game: "cradle", difficulty: DG_LADDERS["newtons-cradle"][1],
        prompt: "The cradle is rebuilt with two balls of different mass. m₁ is lifted and released,"
          + " and the photogate at the bottom reads the speed below just before it strikes m₂, which"
          + " hangs at rest. The steel-on-steel collision is elastic and head-on. Give both speeds"
          + " immediately afterwards — m₁'s SIGNED, negative if it comes back the way it came.",
        note: "Two conservation laws, two unknowns. Solve them together rather than assuming what m₁"
          + " does: the incoming ball only stops dead when the masses are equal.",
        givens,
        inputs: [
          { key: "v1f", label: "m₁ afterwards (signed)", unit: "m/s", step: "0.001" },
          { key: "v2f", label: "m₂ afterwards", unit: "m/s", step: "0.001" },
        ],
      };
    }

    return {
      id: "newtons-cradle", game: "cradle", difficulty: DG_LADDERS["newtons-cradle"][2],
      prompt: "m₂ has been coated in putty, so the two balls stick together on contact and swing on"
        + " as one. m₁ arrives at the speed below. Give the speed they leave with, and how much"
        + " kinetic energy the putty swallowed.",
      note: "Momentum still balances — the putty exerts equal and opposite forces like anything else."
        + " Kinetic energy does not, and the difference is what the cradle is quiet about.",
      givens,
      inputs: [
        { key: "vc", label: "Speed of the pair afterwards", unit: "m/s", step: "0.001" },
        { key: "keLost", label: "Kinetic energy lost", unit: "J", step: "0.0001" },
      ],
    };
  }

  function dgCradleSolution(R0) {
    const L = [];
    if (R0.tier === 0) {
      const v = R0.v;
      const j = Math.min(R0.k * 2, R0.n);
      const uAlt = (R0.k * v) / j;
      L.push("Speed at the bottom, from the drop:");
      L.push("");
      L.push("    v = √(2gL(1 − cos θ)) = √(2 × " + dgFmt(R0.g, 2) + " × " + dgFmt(R0.L, 2)
        + " × " + dgFmt(1 - Math.cos(R0.th), 4) + ") = " + dgFmt(v, 4) + " m/s");
      L.push("");
      L.push("Now the collision. " + R0.k + " ball" + (R0.k === 1 ? "" : "s") + " arrive"
        + (R0.k === 1 ? "s" : "") + " at v, carrying");
      L.push("");
      L.push("    p  = " + R0.k + "mv       = " + dgFmt(R0.p, 4) + " kg·m/s");
      L.push("    KE = ½·" + R0.k + "mv²    = " + dgFmt(R0.KE, 5) + " J");
      L.push("");
      L.push("Suppose j balls come out, all at the same speed u. Momentum alone gives j·m·u = k·m·v,");
      L.push("so u = kv/j — and that has a solution for EVERY j. Momentum cannot pick one. Put that u");
      L.push("into the energy:");
      L.push("");
      L.push("    KE_out = ½·j·m·(kv/j)² = ½·m·v²·k²/j");
      L.push("    KE_in  = ½·m·v²·k");
      L.push("");
      L.push("These are equal only when k²/j = k, that is when j = k. Any other j is a real momentum");
      L.push("solution that fails the energy books.");
      L.push("");
      L.push("    j = " + j + ":  u = " + dgFmt(uAlt, 4) + " m/s,  p = " + dgFmt(j * R0.m * uAlt, 4)
        + " kg·m/s (balances), KE = " + dgFmt(0.5 * j * R0.m * uAlt * uAlt, 5) + " J");
      L.push("           against " + dgFmt(R0.KE, 5) + " J in — "
        + dgFmt((1 - (0.5 * j * R0.m * uAlt * uAlt) / R0.KE) * 100, 0)
        + "% of the energy would have to vanish into hardened steel that barely warms up.");
      L.push("");
      L.push("    j = " + R0.k + ":  u = " + dgFmt(v, 4) + " m/s,  p = " + dgFmt(R0.p, 4)
        + " kg·m/s, KE = " + dgFmt(R0.KE, 5) + " J — both books balance.");
      L.push("");
      L.push("So " + R0.k + " out at the speed " + R0.k + " came in with. The answer is always the");
      L.push("number you lifted, and it is energy, not momentum, that says so.");
      return L;
    }

    L.push("Head-on, one dimension, with m₂ starting at rest.");
    L.push("");
    L.push("    m₁ + m₂ = " + dgFmt(R0.S, 2) + " kg     v₁ = " + dgFmt(R0.v1, 2) + " m/s");
    L.push("");
    if (R0.tier === 1) {
      L.push("Conserve both, solve the pair, and the standard result falls out:");
      L.push("");
      L.push("    v₁' = ((m₁ − m₂)/(m₁ + m₂))·v₁ = ((" + dgFmt(R0.m1, 2) + " − " + dgFmt(R0.m2, 2)
        + ")/" + dgFmt(R0.S, 2) + ") × " + dgFmt(R0.v1, 2) + " = " + dgFmt(R0.v1f, 4) + " m/s");
      L.push("    v₂' = (2m₁/(m₁ + m₂))·v₁      = (2 × " + dgFmt(R0.m1, 2) + "/" + dgFmt(R0.S, 2)
        + ") × " + dgFmt(R0.v1, 2) + " = " + dgFmt(R0.v2f, 4) + " m/s");
      L.push("");
      L.push(R0.v1f < 0
        ? "v₁' is NEGATIVE: m₁ is the lighter ball, so it bounces back off m₂ at "
          + dgFmt(Math.abs(R0.v1f), 3) + " m/s. Only equal masses make the incoming ball stop dead."
        : "v₁' is positive: m₁ is the heavier ball, so it carries on forwards at "
          + dgFmt(R0.v1f, 3) + " m/s behind m₂ — it cannot pass it, but it does not stop either.");
      L.push("");
      L.push("Check both books:");
      L.push("    p:  " + dgFmt(R0.m1 * R0.v1, 5) + "  →  " + dgFmt(R0.m1 * R0.v1f, 5) + " + "
        + dgFmt(R0.m2 * R0.v2f, 5) + " = " + dgFmt(R0.m1 * R0.v1f + R0.m2 * R0.v2f, 5) + " kg·m/s");
      L.push("    KE: " + dgFmt(R0.keI, 5) + "  →  "
        + dgFmt(0.5 * R0.m1 * R0.v1f * R0.v1f, 5) + " + " + dgFmt(0.5 * R0.m2 * R0.v2f * R0.v2f, 5)
        + " = " + dgFmt(0.5 * R0.m1 * R0.v1f * R0.v1f + 0.5 * R0.m2 * R0.v2f * R0.v2f, 5) + " J");
      L.push("");
      L.push("Note that v₂' > v₁ whenever m₁ > m₂ — the struck ball can leave FASTER than the one");
      L.push("that hit it, up to a limit of 2v₁ for a very heavy m₁ against a very light m₂. What it");
      L.push("cannot do is carry more energy than arrived.");
      return L;
    }

    L.push("Perfectly inelastic: they leave as one body, so there is only one unknown and momentum");
    L.push("alone is enough for it.");
    L.push("");
    L.push("    v = m₁v₁/(m₁ + m₂) = " + dgFmt(R0.m1, 2) + " × " + dgFmt(R0.v1, 2) + " / "
      + dgFmt(R0.S, 2) + " = " + dgFmt(R0.vc, 4) + " m/s");
    L.push("");
    L.push("    KE before = ½m₁v₁²      = " + dgFmt(R0.keI, 5) + " J");
    L.push("    KE after  = ½(m₁+m₂)v²  = " + dgFmt(0.5 * R0.S * R0.vc * R0.vc, 5) + " J");
    L.push("    lost      = " + dgFmt(R0.keLost, 5) + " J   ("
      + dgFmt((R0.keLost / R0.keI) * 100, 1) + "% of it)");
    L.push("");
    L.push("There is a tidier form of that difference worth knowing:");
    L.push("");
    L.push("    KE_lost = ½·(m₁m₂/(m₁+m₂))·v₁² = ½ × " + dgFmt((R0.m1 * R0.m2) / R0.S, 4)
      + " × " + dgFmt(R0.v1, 2) + "² = " + dgFmt(R0.keLost, 5) + " J");
    L.push("");
    L.push("m₁m₂/(m₁+m₂) is the reduced mass, and sticking together loses the most kinetic energy");
    L.push("that momentum conservation permits — no collision can lose more and still leave the");
    L.push("momentum where it was. Compare with the elastic case on the previous rung, which would");
    L.push("have sent m₂ off at " + dgFmt(R0.v2f, 4) + " m/s, exactly twice this, and lost nothing.");
    return L;
  }

  function dgCradleMisconception(R0, given, given2) {
    if (R0.tier === 0) {
      const j = Number(given);
      if (!Number.isFinite(j) || j === R0.k) return null;
      const u = (R0.k * R0.v) / j;
      const keOut = 0.5 * j * R0.m * u * u;
      if (j > R0.k) {
        return {
          id: j === R0.n ? "all-of-them-move" : "momentum-alone",
          label: j === R0.n ? "All n would need the energy to have shrunk"
            : "Momentum permits it; energy does not",
          detail: " " + j + " out is a perfectly good MOMENTUM solution: they would leave at"
            + " u = kv/j = " + dgFmt(u, 3) + " m/s, and " + j + " × " + dgFmt(R0.m, 2) + " × "
            + dgFmt(u, 3) + " = " + dgFmt(j * R0.m * u, 4) + " kg·m/s, which is exactly what came in."
            + " The energy is where it fails: ½·" + j + "·m·u² = " + dgFmt(keOut, 5) + " J against "
            + dgFmt(R0.KE, 5) + " J arriving, so " + dgFmt((1 - keOut / R0.KE) * 100, 0)
            + "% of it would have to disappear into steel that comes out of the collision cold."
            + " Spreading the same momentum over more balls always costs energy, which is why the"
            + " cradle never does it.",
        };
      }
      return {
        id: "fewer-out-than-in",
        label: "That outcome would have to CREATE energy",
        detail: " " + j + " out carrying all of the momentum means u = kv/j = " + dgFmt(u, 3)
          + " m/s, faster than anything arrived. The energy then comes to " + dgFmt(keOut, 5)
          + " J against " + dgFmt(R0.KE, 5) + " J in — more out than went in, from a collision"
          + " between passive steel balls. Concentrating momentum onto fewer bodies always raises"
          + " the energy, exactly as spreading it lowers it, and only j = k leaves it alone.",
      };
    }

    if (R0.tier === 1) {
      const hit2 = (wrong) => dgRouteHit(given2, wrong, R0.v2f, R0.tol2);
      const hit1 = (wrong) => dgRouteHit(given, wrong, R0.v1f, R0.tol1);
      const W = R0.wrong;
      if (hit2(W.together)) {
        return {
          id: "used-momentum-alone",
          label: "That is the answer for two balls that STICK",
          detail: " m₁v₁/(m₁+m₂) = " + dgFmt(W.together, 3) + " m/s is what momentum alone gives"
            + " when you also assume the two end up at the same speed — which is a perfectly"
            + " inelastic collision, not steel on steel. With energy conserved as well, the struck"
            + " ball leaves at 2m₁v₁/(m₁+m₂) = " + dgFmt(R0.v2f, 3) + " m/s, exactly twice as fast.",
        };
      }
      if (hit2(W.transfers)) {
        return {
          id: "speed-just-transfers",
          label: "The speed transfers whole only for EQUAL masses",
          detail: " m₂ leaving at v₁ = " + dgFmt(W.transfers, 3) + " m/s is what the classroom"
            + " cradle does, and it works because its balls are identical. Here m₁ = "
            + dgFmt(R0.m1, 2) + " kg meets m₂ = " + dgFmt(R0.m2, 2) + " kg, so"
            + " v₂' = 2m₁v₁/(m₁+m₂) = " + dgFmt(R0.v2f, 3) + " m/s — "
            + (R0.m1 > R0.m2 ? "faster" : "slower") + " than the ball that hit it.",
        };
      }
      if (hit2(W.swapped)) {
        return {
          id: "masses-swapped",
          label: "The numerator carries the INCOMING mass",
          detail: " 2m₂v₁/(m₁+m₂) = " + dgFmt(W.swapped, 3) + " m/s has m₂ in the top. Check it"
            + " against a limit you know: a very heavy ball striking a very light one should send"
            + " the light one off at nearly 2v₁, and only 2m₁/(m₁+m₂) does that.",
        };
      }
      if (hit1(W.v1fZero)) {
        return {
          id: "incoming-ball-always-stops",
          label: "The incoming ball only stops dead for equal masses",
          detail: " v₁' = 0 needs m₁ = m₂. Here the ratio is " + dgFmt(R0.m1 / R0.m2, 2)
            + ", so v₁' = ((m₁−m₂)/(m₁+m₂))v₁ = " + dgFmt(R0.v1f, 3) + " m/s: m₁ "
            + (R0.v1f < 0 ? "bounces back" : "carries on forwards behind m₂") + ".",
        };
      }
      if (hit1(W.v1fFlipped)) {
        return {
          id: "v1-sign-inverted",
          label: "The sign of v₁' is the wrong way round",
          detail: " (m₁ − m₂) is " + (R0.m1 > R0.m2 ? "positive" : "negative") + " here — m₁ is the "
            + (R0.m1 > R0.m2 ? "heavier" : "lighter") + " ball — so v₁' = " + dgFmt(R0.v1f, 3)
            + " m/s and it "
            + (R0.v1f < 0 ? "rebounds" : "continues forward") + ". A light ball striking a heavy one"
            + " always comes back; a heavy one striking a light one never does.",
        };
      }
      return null;
    }

    const hitV = (wrong) => dgRouteHit(given, wrong, R0.vc, R0.tolV);
    const hitE = (wrong) => dgRouteHit(given2, wrong, R0.keLost, R0.tolE);
    const W = R0.wrong;
    if (hitV(W.elastic)) {
      return {
        id: "used-the-elastic-formula",
        label: "That is the ELASTIC result",
        detail: " 2m₁v₁/(m₁+m₂) = " + dgFmt(W.elastic, 3) + " m/s assumes the kinetic energy"
          + " survives, and putty is exactly the thing that guarantees it does not. Sticking leaves"
          + " one unknown and needs only momentum: v = m₁v₁/(m₁+m₂) = " + dgFmt(R0.vc, 3)
          + " m/s, half of what you gave.",
      };
    }
    if (hitV(W.unchanged)) {
      return {
        id: "forgot-the-second-mass",
        label: "m₂ is along for the ride now",
        detail: " After they stick, the momentum m₁v₁ = " + dgFmt(R0.m1 * R0.v1, 4)
          + " kg·m/s has to move " + dgFmt(R0.S, 2) + " kg, not " + dgFmt(R0.m1, 2)
          + " kg: v = " + dgFmt(R0.vc, 3) + " m/s.",
      };
    }
    if (hitV(W.swapped)) {
      return {
        id: "masses-swapped",
        label: "The momentum came in on m₁",
        detail: " m₂v₁/(m₁+m₂) = " + dgFmt(W.swapped, 3) + " m/s uses the mass that was standing"
          + " still. The momentum to be shared is m₁v₁, carried in by the ball that was moving.",
      };
    }
    if (hitE(W.keAll)) {
      return {
        id: "all-the-energy-lost",
        label: "They are still moving afterwards",
        detail: " ½m₁v₁² = " + dgFmt(W.keAll, 4) + " J is ALL the kinetic energy there was. The pair"
          + " leaves at " + dgFmt(R0.vc, 3) + " m/s and keeps ½(m₁+m₂)v² = "
          + dgFmt(0.5 * R0.S * R0.vc * R0.vc, 5) + " J of it — momentum forbids them stopping. The"
          + " putty took the difference, " + dgFmt(R0.keLost, 5) + " J.",
      };
    }
    if (hitE(W.keSurvives)) {
      return {
        id: "answered-the-surviving-energy",
        label: "That is the energy that survived",
        detail: " ½(m₁+m₂)v² = " + dgFmt(W.keSurvives, 5) + " J is what the pair carries away. The"
          + " question asks for what was lost: " + dgFmt(R0.keI, 5) + " − " + dgFmt(W.keSurvives, 5)
          + " = " + dgFmt(R0.keLost, 5) + " J.",
      };
    }
    if (hitE(W.keNoHalf)) {
      return {
        id: "lost-the-half",
        label: "Kinetic energy carries a ½",
        detail: " Your number is μv₁² with μ = m₁m₂/(m₁+m₂), twice the loss. The reduced-mass form"
          + " is ½μv₁² = " + dgFmt(R0.keLost, 5) + " J.",
      };
    }
    if (hitE(W.keDiffOfSpeeds)) {
      return {
        id: "energy-from-the-speed-change",
        label: "Energy is not the ½m of a speed DIFFERENCE",
        detail: " ½m₁(v₁ − v)² = " + dgFmt(W.keDiffOfSpeeds, 5) + " J treats the change in speed as"
          + " if it were a speed. Take the two energies and subtract them instead: "
          + dgFmt(R0.keI, 5) + " − " + dgFmt(0.5 * R0.S * R0.vc * R0.vc, 5) + " = "
          + dgFmt(R0.keLost, 5) + " J.",
      };
    }
    return null;
  }

  function dgCradleGrade(R0, answers) {
    const solution = dgCradleSolution(R0);

    if (R0.tier === 0) {
      const raw = dgChoice(answers ? answers.count : "");
      const given = Number(raw);
      if (!raw || !Number.isFinite(given) || given < 1 || given > R0.n) return dgBlank(solution);
      const correct = given === R0.k;
      const u = (R0.k * R0.v) / given;
      const keOut = 0.5 * given * R0.m * u * u;

      const verdict = correct
        ? { kind: "hit", text: R0.k === 1 ? "One in, one out" : R0.k + " in, " + R0.k + " out" }
        : {
          kind: "miss",
          text: given > R0.k
            ? dgFmt((1 - keOut / R0.KE) * 100, 0) + "% of the energy would vanish"
            : dgFmt((keOut / R0.KE - 1) * 100, 0) + "% more energy than went in",
        };

      const feedback = (correct
        ? "Right, and the reason is the interesting part. "
        : "The cradle sends out " + R0.k + ". ")
        + "Momentum alone would allow any number: " + given + " out at " + dgFmt(u, 3)
        + " m/s carries " + dgFmt(given * R0.m * u, 4) + " kg·m/s, the same as went in. It is the"
        + " energy that decides — " + dgFmt(keOut, 5) + " J against " + dgFmt(R0.KE, 5) + " J"
        + (correct ? ", which is why this is the outcome." : ", which is why it is not.");

      return {
        correct, blank: false, verdict, feedback,
        misconception: correct ? null : dgCradleMisconception(R0, raw),
        solution,
        exact: { count: R0.k, speed: dgR(R0.v, 5), momentum: dgR(R0.p, 5), energy: dgR(R0.KE, 6) },
        tolerance: {},
        given, predicted: given, uPredicted: u, kePredicted: keOut,
      };
    }

    if (R0.tier === 1) {
      const g1 = dgNum(answers ? answers.v1f : undefined);
      const g2 = dgNum(answers ? answers.v2f : undefined);
      if (!Number.isFinite(g1) || !Number.isFinite(g2)) return dgBlank(solution);
      const ok1 = Math.abs(g1 - R0.v1f) <= R0.tol1;
      const ok2 = Math.abs(g2 - R0.v2f) <= R0.tol2;
      const correct = ok1 && ok2;
      const d2 = g2 - R0.v2f;

      let verdict, feedback;
      if (correct) {
        verdict = { kind: "hit", text: "Both books balance" };
        feedback = "Exact v₁' = " + dgFmt(R0.v1f, 4) + " m/s and v₂' = " + dgFmt(R0.v2f, 4)
          + " m/s. The momentum and the energy both come out where they started, which is the pair"
          + " of conditions that fixed the answer.";
      } else if (ok2 && !ok1) {
        verdict = { kind: "miss", text: "m₂ right, m₁ wrong" };
        feedback = "The struck ball is right. m₁ is not: v₁' = ((m₁−m₂)/(m₁+m₂))v₁ = "
          + dgFmt(R0.v1f, 4) + " m/s, so it "
          + (R0.v1f < 0 ? "rebounds at " + dgFmt(Math.abs(R0.v1f), 3) + " m/s"
            : "carries on at " + dgFmt(R0.v1f, 3) + " m/s") + ", and you gave "
          + dgSigned(g1, 3) + " m/s.";
      } else {
        verdict = {
          kind: d2 > 0 ? "over" : "under",
          text: "m₂ leaves " + dgFmt(Math.abs(d2), 2) + " m/s "
            + (d2 > 0 ? "slower than you said" : "faster than you said"),
        };
        feedback = "v₂' = 2m₁v₁/(m₁+m₂) = " + dgFmt(R0.v2f, 4) + " m/s; you gave "
          + dgFmt(g2, 4) + " m/s. v₁' = " + dgFmt(R0.v1f, 4) + " m/s"
          + (ok1 ? ", which you had right." : "; you gave " + dgSigned(g1, 3) + " m/s.");
      }

      return {
        correct, blank: false, verdict, feedback,
        misconception: correct ? null : dgCradleMisconception(R0, g1, g2),
        solution,
        exact: { v1f: dgR(R0.v1f, 5), v2f: dgR(R0.v2f, 5) },
        tolerance: { v1f: dgR(R0.tol1, 5), v2f: dgR(R0.tol2, 5) },
        guess: g2, guessV1: g1,
      };
    }

    const gv = dgNum(answers ? answers.vc : undefined);
    const ge = dgNum(answers ? answers.keLost : undefined);
    if (!Number.isFinite(gv) || !Number.isFinite(ge)) return dgBlank(solution);
    const okV = Math.abs(gv - R0.vc) <= R0.tolV;
    const okE = Math.abs(ge - R0.keLost) <= R0.tolE;
    const correct = okV && okE;
    const dv = gv - R0.vc;

    let verdict, feedback;
    if (correct) {
      verdict = { kind: "hit", text: "Stuck, and the books close" };
      feedback = "Exact v = " + dgFmt(R0.vc, 4) + " m/s and " + dgFmt(R0.keLost, 5)
        + " J lost — " + dgFmt((R0.keLost / R0.keI) * 100, 1) + "% of what arrived. Momentum is"
        + " untouched; the energy is not, and the putty has it.";
    } else if (okV && !okE) {
      verdict = { kind: ge > R0.keLost ? "over" : "under", text: "Speed right, energy out by " + dgFmt(Math.abs(ge - R0.keLost), 4) + " J" };
      feedback = "The common speed is right. The loss is ½m₁v₁² − ½(m₁+m₂)v² = " + dgFmt(R0.keI, 5)
        + " − " + dgFmt(0.5 * R0.S * R0.vc * R0.vc, 5) + " = " + dgFmt(R0.keLost, 5)
        + " J; you gave " + dgFmt(ge, 5) + " J.";
    } else {
      verdict = {
        kind: dv > 0 ? "over" : "under",
        text: "The pair leaves at " + dgFmt(R0.vc, 2) + " m/s, not " + dgFmt(gv, 2),
      };
      feedback = "v = m₁v₁/(m₁+m₂) = " + dgFmt(R0.vc, 4) + " m/s; you gave " + dgFmt(gv, 4)
        + " m/s." + (okE ? " The energy lost you had right." : " Energy lost is "
          + dgFmt(R0.keLost, 5) + " J; you gave " + dgFmt(ge, 5) + " J.");
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : dgCradleMisconception(R0, gv, ge),
      solution,
      exact: { vc: dgR(R0.vc, 5), keLost: dgR(R0.keLost, 6) },
      tolerance: { vc: dgR(R0.tolV, 5), keLost: dgR(R0.tolE, 6) },
      guess: gv, guessKE: ge,
    };
  }

  /* ==========================================================================
     GAME 5 — the rotating space station
     --------------------------------------------------------------------------
     Spin a ring and the floor pushes the inhabitants toward the centre hard
     enough to stand on. One equation:

         a = omega^2 r        omega = sqrt(a/r)        T = 2 pi sqrt(r/a)

     omega goes as 1/sqrt(r), so a BIGGER ring needs a SLOWER spin — which is
     the opposite of what almost everyone says out loud first, and is the
     entire reason a realistic station is enormous rather than merely large.

     The design constraint that sets the size is not the gravity at all. Above
     roughly two revolutions per minute, turning your head sweeps it through a
     different rotation rate and the inner ear objects; the sickness limit, not
     the physics, is what forces a kilometre-scale ring.

     And the gravity is not uniform: standing up moves your head h closer to
     the axis, so a_head/a_feet = (r - h)/r and the difference is h/r. On a
     small ring your head weighs visibly less than your feet.
     ========================================================================== */

  const DG_STATION_TARGETS = [
    { f: 1.00, label: "Earth normal, 1.00 g" },
    { f: 0.75, label: "three quarters of Earth, 0.75 g" },
    { f: 0.50, label: "half of Earth, 0.50 g" },
    { f: 0.38, label: "Mars normal, 0.38 g" },
  ];

  function dgStationMake(tier) {
    const g = dgG();

    for (let attempt = 0; attempt < 900; attempt++) {
      const tgt = dgPick(DG_STATION_TARGETS);
      const aT = tgt.f * g;

      if (tier === 0) {
        const variant = Math.random() < 0.5 ? "period" : "omega";
        /* Built backwards: the rotation period's window is fixed first and the
           RING RADIUS is solved for, snapped to the metre it is quoted at, and
           the period recomputed from the snapped radius. */
        const want = dgRand(18, 90);
        const r = dgR((aT * want * want) / (4 * Math.PI * Math.PI), 0);
        if (!(r >= 40 && r <= 900)) continue;
        const T = 2 * Math.PI * Math.sqrt(r / aT);
        const om = TAU / T;
        if (!(T >= 15 && T <= 95)) continue;
        const answer = variant === "period" ? T : om;
        const tol = variant === "period"
          ? Math.max(0.02 * T, 0.05)
          : Math.max(0.02 * om, 0.0005);
        const R0 = {
          game: "station", gameId: "rotating-space-station", tier, g,
          variant, r, aT, tgt, T, om, rpm: (60 / T),
          answer, tol, answerKey: variant === "period" ? "period" : "omega",
          h: 0, pctLimit: 0,
        };
        R0.wrong = variant === "period"
          ? {
            noSqrt: (TAU * r) / aT,
            inverted: TAU * Math.sqrt(aT / r),
            noTwoPi: Math.sqrt(r / aT),
            asRpm: 60 / T,
            asFrequency: 1 / T,
            usedDiameter: TAU * Math.sqrt((2 * r) / aT),
            asOmega: om,
          }
          : {
            noSqrt: aT / r,
            inverted: Math.sqrt(r / aT),
            timesR: Math.sqrt(aT * r),
            asPeriod: T,
            asRpm: 60 / T,
            usedDiameter: Math.sqrt(aT / (2 * r)),
          };
        // The headline error of the whole game is "bigger must spin faster".
        // If that route lands on the truth the round cannot teach it.
        if (!(Math.abs(R0.wrong.inverted - answer) > 3 * tol)) continue;
        return R0;
      }

      if (tier === 1) {
        const rpm = dgR(dgPick(dgGrid(1.0, 3.0, 0.1)), 1);
        const om = (TAU * rpm) / 60;
        const r = aT / (om * om);
        if (!(r >= 50 && r <= 900)) continue;
        const T = TAU / om;
        const tol = Math.max(0.01 * r, 0.5);
        const R0 = {
          game: "station", gameId: "rotating-space-station", tier, g,
          variant: "radius", r, aT, tgt, T, om, rpm,
          answer: r, tol, answerKey: "radius", h: 0, pctLimit: 0,
        };
        R0.wrong = {
          rpmAsOmega: aT / (rpm * rpm),
          noSixty: aT / (TAU * rpm * TAU * rpm),
          noTwoPi: aT / ((rpm / 60) * (rpm / 60)),
          noSquare: aT / om,
          diameter: 2 * r,
          halved: r / 2,
        };
        if (!(Math.abs(R0.wrong.rpmAsOmega - r) > 3 * tol)) continue;
        return R0;
      }

      const variant = Math.random() < 0.5 ? "pct" : "rmin";
      const h = dgR(dgPick(dgGrid(1.50, 2.00, 0.01)), 2);

      if (variant === "pct") {
        // The percentage is the answer, so the RADIUS is the given solved for
        // and snapped to the metre, and the percentage recomputed from it.
        const want = dgRand(1.4, 12.0);
        const r = dgR((100 * h) / want, 0);
        if (!(r >= 14 && r <= 170)) continue;
        const pct = (100 * h) / r;
        if (!(pct >= 1.0 && pct <= 13.0)) continue;
        const om = Math.sqrt(aT / r);
        const tol = Math.max(0.02 * pct, 0.05);
        const R0 = {
          game: "station", gameId: "rotating-space-station", tier, g,
          variant, r, h, aT, tgt, om, T: TAU / om, rpm: (60 * om) / TAU,
          aHead: om * om * (r - h), aFeet: aT,
          pct, answer: pct, tol, answerKey: "pct", pctLimit: 0,
        };
        R0.wrong = {
          ratioPct: (100 * (r - h)) / r,
          ratio: (r - h) / r,
          overRminusH: (100 * h) / (r - h),
          inverted: (100 * r) / h,
          asFraction: h / r,
        };
        if (!(Math.abs(R0.wrong.ratioPct - pct) > 3 * tol)) continue;
        return R0;
      }

      const pctLimit = dgR(dgPick(dgGrid(2.0, 12.0, 0.5)), 1);
      const r = (100 * h) / pctLimit;
      if (!(r >= 14 && r <= 170)) continue;
      const om = Math.sqrt(aT / r);
      const tol = Math.max(0.01 * r, 0.3);
      const R0 = {
        game: "station", gameId: "rotating-space-station", tier, g,
        variant, r, h, aT, tgt, om, T: TAU / om, rpm: (60 * om) / TAU,
        aHead: om * om * (r - h), aFeet: aT,
        pct: pctLimit, pctLimit, answer: r, tol, answerKey: "rmin",
      };
      R0.wrong = {
        noHundred: h / pctLimit,
        multiplied: h * pctLimit,
        inverted: (100 * pctLimit) / h,
        offByH: (100 * h) / pctLimit + h,
        halved: r / 2,
      };
      if (!(Math.abs(R0.wrong.noHundred - r) > 3 * tol)) continue;
      return R0;
    }

    return dgStationFallback(tier);
  }

  function dgStationFallback(tier) {
    const g = dgG();
    const tgt = DG_STATION_TARGETS[0];
    const aT = tgt.f * g;
    if (tier === 0) {
      const r = 224;
      const T = 2 * Math.PI * Math.sqrt(r / aT);
      const om = TAU / T;
      const R0 = {
        game: "station", gameId: "rotating-space-station", tier, g,
        variant: "period", r, aT, tgt, T, om, rpm: 60 / T,
        answer: T, tol: Math.max(0.02 * T, 0.05), answerKey: "period", h: 0, pctLimit: 0,
      };
      R0.wrong = {
        noSqrt: (TAU * r) / aT, inverted: TAU * Math.sqrt(aT / r), noTwoPi: Math.sqrt(r / aT),
        asRpm: 60 / T, asFrequency: 1 / T, usedDiameter: TAU * Math.sqrt((2 * r) / aT), asOmega: om,
      };
      return R0;
    }
    if (tier === 1) {
      const rpm = 2.0;
      const om = (TAU * rpm) / 60;
      const r = aT / (om * om);
      const R0 = {
        game: "station", gameId: "rotating-space-station", tier, g,
        variant: "radius", r, aT, tgt, T: TAU / om, om, rpm,
        answer: r, tol: Math.max(0.01 * r, 0.5), answerKey: "radius", h: 0, pctLimit: 0,
      };
      R0.wrong = {
        rpmAsOmega: aT / (rpm * rpm), noSixty: aT / (TAU * rpm * TAU * rpm),
        noTwoPi: aT / ((rpm / 60) * (rpm / 60)), noSquare: aT / om, diameter: 2 * r, halved: r / 2,
      };
      return R0;
    }
    const h = 1.75, r = 50;
    const om = Math.sqrt(aT / r);
    const pct = (100 * h) / r;
    const R0 = {
      game: "station", gameId: "rotating-space-station", tier, g,
      variant: "pct", r, h, aT, tgt, om, T: TAU / om, rpm: (60 * om) / TAU,
      aHead: om * om * (r - h), aFeet: aT,
      pct, answer: pct, tol: Math.max(0.02 * pct, 0.05), answerKey: "pct", pctLimit: 0,
    };
    R0.wrong = {
      ratioPct: (100 * (r - h)) / r, ratio: (r - h) / r,
      overRminusH: (100 * h) / (r - h), inverted: (100 * r) / h, asFraction: h / r,
    };
    return R0;
  }

  function dgStationView(R0) {
    const givens = [];
    /* The radius is a given on every rung EXCEPT the two that ask for it. The
       comfort rung asks for the smallest workable r and the head-versus-feet
       rung's second variant asks for the smallest acceptable r; printing it in
       the table there would hand over the answer. */
    if (R0.variant !== "rmin" && R0.variant !== "radius") {
      givens.push({ label: "Ring radius, r", value: dgFmt(R0.r, 0), unit: "m" });
    }
    givens.push({ label: "Gravity wanted at the rim", value: R0.tgt.label, unit: "" });
    givens.push({ label: "…which is", value: dgFmt(R0.aT, 3), unit: "m/s²" });
    if (R0.tier === 1) {
      givens.push({ label: "Comfort limit on the spin", value: dgFmt(R0.rpm, 1), unit: "rev/min" });
    }
    if (R0.tier === 2) {
      givens.push({ label: "Height of a standing person, h", value: dgFmt(R0.h, 2), unit: "m" });
      if (R0.variant === "rmin") {
        givens.push({ label: "Head-to-feet difference allowed", value: dgFmt(R0.pctLimit, 1), unit: "%" });
      }
    }
    givens.push({ label: "g on Earth", value: dgFmt(R0.g, 2), unit: "m/s²" });

    let prompt, inputs;
    if (R0.tier === 0) {
      prompt = "The ring is built and the engines are ready to spin it up. Find the "
        + (R0.variant === "period"
          ? "rotation PERIOD that gives the rim the gravity below."
          : "angular speed ω that gives the rim the gravity below.")
        + " Then look at the radius and ask yourself whether a bigger ring would need more of it or"
        + " less.";
      inputs = R0.variant === "period"
        ? [{ key: "period", label: "One rotation takes", unit: "s", step: "0.01" }]
        : [{ key: "omega", label: "Angular speed, ω", unit: "rad/s", step: "0.0001" }];
    } else if (R0.tier === 1) {
      prompt = "Spin a ring much faster than a couple of revolutions per minute and turning your head"
        + " sweeps it through a different rotation rate; the inner ear reads that as motion sickness,"
        + " and it — not the gravity — is what sets how big a station has to be. Given the comfort"
        + " limit below, what is the SMALLEST ring radius that still delivers the gravity wanted?";
      inputs = [{ key: "radius", label: "Smallest workable ring radius", unit: "m", step: "0.1" }];
    } else if (R0.variant === "pct") {
      prompt = "Standing on the rim, your head is h nearer the axis than your feet are, and the"
        + " artificial gravity falls off with radius. By what percentage is the acceleration at your"
        + " head lower than at your feet?";
      inputs = [{ key: "pct", label: "Head lighter than feet by", unit: "%", step: "0.01" }];
    } else {
      prompt = "Standing on the rim, your head is h nearer the axis than your feet are, and the"
        + " artificial gravity falls off with radius. Nobody wants their head noticeably lighter than"
        + " their feet. What is the smallest ring radius that keeps the difference within the budget"
        + " below?";
      inputs = [{ key: "rmin", label: "Smallest acceptable ring radius", unit: "m", step: "0.1" }];
    }

    const note = R0.tier === 2
      ? "a = ω²r at every radius, and ω is the same everywhere on a rigid ring. So the ratio of two"
        + " accelerations is just the ratio of the two radii: a_head/a_feet = (r − h)/r."
      : "a = ω²r. Rearranged, ω = √(a/r) — and note where r sits. The mass of the station, and of the"
        + " people in it, never enters.";

    return {
      id: "rotating-space-station", game: "station",
      difficulty: DG_LADDERS["rotating-space-station"][R0.tier],
      prompt, note, givens, inputs,
    };
  }

  function dgStationSolution(R0) {
    const L = [];
    L.push("Standing on the inside of the rim, the floor is the only thing touching you, and the");
    L.push("whole of its push is what turns you in a circle:");
    L.push("");
    L.push("    a = ω²r        ω = √(a/r)        T = 2π/ω = 2π√(r/a)");
    L.push("");
    if (R0.tier === 0) {
      L.push("    a = " + dgFmt(R0.tgt.f, 2) + " × " + dgFmt(R0.g, 2) + " = " + dgFmt(R0.aT, 4)
        + " m/s²     r = " + dgFmt(R0.r, 0) + " m");
      L.push("");
      L.push("    ω = √(" + dgFmt(R0.aT, 4) + " / " + dgFmt(R0.r, 0) + ") = " + dgFmt(R0.om, 5)
        + " rad/s");
      L.push("    T = 2π/ω = " + dgFmt(R0.T, 4) + " s = " + dgFmt(R0.rpm, 3) + " rev/min");
      L.push("");
      L.push("Now the thing worth carrying away. ω = √(a/r) means ω ∝ 1/√r: to hold the same gravity,");
      L.push("a ring four times as big spins HALF as fast. Double this station's radius to "
        + dgFmt(2 * R0.r, 0) + " m");
      L.push("and the period rises to " + dgFmt(R0.T * Math.SQRT2, 2) + " s — slower, not faster.");
      L.push("Most people say the opposite before they write anything down, because 'bigger circle,");
      L.push("further to go' is a statement about the rim SPEED v = ωr = " + dgFmt(R0.om * R0.r, 2)
        + " m/s, which does rise with r. The rate of TURN is what has to fall.");
      L.push("");
      L.push("Cross-check by another road: v = √(ar) = " + dgFmt(Math.sqrt(R0.aT * R0.r), 4)
        + " m/s, and T = 2πr/v = " + dgFmt((TAU * R0.r) / Math.sqrt(R0.aT * R0.r), 4)
        + " s. Same number.");
    } else if (R0.tier === 1) {
      L.push("The comfort limit is a rate of turn, so put it into the same units first:");
      L.push("");
      L.push("    ω_max = 2π × " + dgFmt(R0.rpm, 1) + " / 60 = " + dgFmt(R0.om, 5) + " rad/s"
        + "     (a revolution is 2π radians, and a minute is 60 seconds)");
      L.push("");
      L.push("    r = a / ω² = " + dgFmt(R0.aT, 4) + " / " + dgFmt(R0.om, 5) + "² = "
        + dgFmt(R0.r, 2) + " m");
      L.push("");
      L.push("A ring " + dgFmt(2 * R0.r, 0) + " m across, to deliver a gravity you could get from a"
        + " centrifuge you can hold in one hand. That is the whole difficulty of the idea: the"
        + " gravity is easy and the COMFORT is not. Spin something small fast enough for 1 g and the"
        + " gradient across your body and the head-turn sickness both become intolerable long before"
        + " the physics does.");
      L.push("");
      L.push("Sanity: at that radius the rim moves at v = ωr = " + dgFmt(R0.om * R0.r, 2)
        + " m/s, and one rotation takes " + dgFmt(R0.T, 1) + " s.");
    } else {
      L.push("ω is a property of the whole rigid ring — every part of it turns at the same rate. So");
      L.push("the only thing that differs between head and feet is the radius:");
      L.push("");
      L.push("    a_feet = ω²r        a_head = ω²(r − h)        a_head/a_feet = (r − h)/r");
      L.push("");
      L.push("    difference = 1 − (r − h)/r = h/r");
      L.push("");
      if (R0.variant === "pct") {
        L.push("    h/r = " + dgFmt(R0.h, 2) + " / " + dgFmt(R0.r, 0) + " = "
          + dgFmt(R0.h / R0.r, 5) + " = " + dgFmt(R0.pct, 3) + "%");
        L.push("");
        L.push("    a_feet = " + dgFmt(R0.aFeet, 4) + " m/s²     a_head = " + dgFmt(R0.aHead, 4)
          + " m/s²");
        L.push("");
        L.push("Notice how simple that came out: the ω² cancels, so the answer does not depend on how");
        L.push("fast the ring turns or on what gravity it is set for — only on how tall you are");
        L.push("compared with the ring. Which is exactly why the fix is a bigger ring and nothing else.");
      } else {
        L.push("    h/r ≤ " + dgFmt(R0.pctLimit, 1) + "% = " + dgFmt(R0.pctLimit / 100, 4));
        L.push("    r ≥ h / " + dgFmt(R0.pctLimit / 100, 4) + " = " + dgFmt(R0.h, 2) + " × 100 / "
          + dgFmt(R0.pctLimit, 1) + " = " + dgFmt(R0.r, 2) + " m");
        L.push("");
        L.push("    at that radius: a_feet = " + dgFmt(R0.aFeet, 4) + " m/s², a_head = "
          + dgFmt(R0.aHead, 4) + " m/s², ω = " + dgFmt(R0.om, 5) + " rad/s = "
          + dgFmt(R0.rpm, 2) + " rev/min");
        L.push("");
        L.push("The ω² cancels out of the ratio, so this radius is the same whatever gravity the ring");
        L.push("is set for. The gradient is a question about your height against the ring's, and");
        L.push("nothing else.");
        L.push("");
        L.push("Worth noticing: at " + dgFmt(R0.rpm, 2) + " rev/min this ring satisfies the GRADIENT budget");
        L.push("and still breaks the spin limit from the previous rung. The gradient is the gentler of");
        L.push("the two constraints, which is why real designs are sized by the spin limit and come out");
        L.push("a hundred times larger than this.");
      }
      L.push("");
      L.push("It is a real effect at these sizes: stand up quickly on a small ring and the blood in");
      L.push("your head is a measurably different weight from the blood in your feet.");
    }
    return L;
  }

  function dgStationMisconception(R0, guess) {
    const hit = (wrong) => dgRouteHit(guess, wrong, R0.answer, R0.tol);
    const W = R0.wrong;

    if (R0.tier === 0 && R0.variant === "period") {
      if (hit(W.inverted)) {
        return {
          id: "bigger-must-spin-faster",
          label: "This is the one everyone gets backwards",
          detail: " 2π√(a/r) = " + dgFmt(W.inverted, 3) + " s has r underneath where it should be on"
            + " top — it makes a bigger ring need a FASTER spin. From a = ω²r, holding a fixed means"
            + " ω ∝ 1/√r: the bigger the ring, the slower it turns. What does grow with r is the rim"
            + " SPEED, v = √(ar) = " + dgFmt(Math.sqrt(R0.aT * R0.r), 1)
            + " m/s, and that is probably the quantity your intuition was reaching for.",
        };
      }
      if (hit(W.noSqrt)) {
        return {
          id: "forgot-the-square",
          label: "a = ω²r, not ωr",
          detail: " 2πr/a = " + dgFmt(W.noSqrt, 2) + " s comes from treating the acceleration as ωr."
            + " The centripetal acceleration is ω²r, so ω = √(a/r) and the square root has to survive"
            + " into the period: T = 2π√(r/a) = " + dgFmt(R0.T, 2) + " s.",
        };
      }
      if (hit(W.noTwoPi)) {
        return {
          id: "forgot-the-two-pi",
          label: "√(r/a) is a time, but it is not the period",
          detail: " " + dgFmt(W.noTwoPi, 3) + " s is T/2π. One rotation is 2π radians, so"
            + " T = 2π/ω = 2π√(r/a) = " + dgFmt(R0.T, 2) + " s.",
        };
      }
      if (hit(W.asRpm)) {
        return {
          id: "answered-in-rpm",
          label: "That is revolutions per minute",
          detail: " " + dgFmt(W.asRpm, 3) + " rev/min is the same spin expressed the other way up and"
            + " in minutes. The box asks how many SECONDS one rotation takes: 60/"
            + dgFmt(W.asRpm, 3) + " = " + dgFmt(R0.T, 2) + " s.",
        };
      }
      if (hit(W.asOmega)) {
        return {
          id: "answered-omega",
          label: "That is ω, in rad/s",
          detail: " " + dgFmt(W.asOmega, 5) + " rad/s is right, and it is the hard half. The period"
            + " is 2π/ω = " + dgFmt(R0.T, 2) + " s.",
        };
      }
      if (hit(W.usedDiameter)) {
        return {
          id: "used-the-diameter",
          label: "r is the radius",
          detail: " Using " + dgFmt(2 * R0.r, 0) + " m gives " + dgFmt(W.usedDiameter, 2)
            + " s. The a = ω²r relation takes the distance from the AXIS, which is the radius, "
            + dgFmt(R0.r, 0) + " m.",
        };
      }
      return null;
    }

    if (R0.tier === 0) {
      if (hit(W.inverted) || hit(W.timesR)) {
        const used = hit(W.inverted) ? W.inverted : W.timesR;
        return {
          id: "bigger-must-spin-faster",
          label: "This is the one everyone gets backwards",
          detail: " " + dgFmt(used, 5) + " rad/s has the radius on the wrong side. a = ω²r rearranges"
            + " to ω = √(a/r), so ω falls as the ring grows: quadruple the radius and the spin halves."
            + " The quantity that rises with r is the rim speed v = ωr = "
            + dgFmt(R0.om * R0.r, 1) + " m/s.",
        };
      }
      if (hit(W.noSqrt)) {
        return {
          id: "forgot-the-square",
          label: "a = ω²r, not ωr",
          detail: " a/r = " + dgFmt(W.noSqrt, 5) + " would be ω only if the acceleration were ωr."
            + " Take the square root: ω = √(a/r) = " + dgFmt(R0.om, 5) + " rad/s.",
        };
      }
      if (hit(W.asPeriod)) {
        return {
          id: "answered-the-period",
          label: "That is the period, in seconds",
          detail: " " + dgFmt(W.asPeriod, 2) + " s is how long one rotation takes. ω = 2π/T = "
            + dgFmt(R0.om, 5) + " rad/s.",
        };
      }
      if (hit(W.asRpm)) {
        return {
          id: "answered-in-rpm",
          label: "Wrong units for ω",
          detail: " " + dgFmt(W.asRpm, 3) + " is revolutions per minute. Radians per second: × 2π,"
            + " ÷ 60 → " + dgFmt(R0.om, 5) + " rad/s.",
        };
      }
      return null;
    }

    if (R0.tier === 1) {
      if (hit(W.rpmAsOmega)) {
        return {
          id: "rpm-used-as-omega",
          label: "rev/min is not rad/s",
          detail: " a/(" + dgFmt(R0.rpm, 1) + ")² = " + dgFmt(W.rpmAsOmega, 2) + " m treats the"
            + " comfort limit as though it were already in radians per second. One revolution is 2π"
            + " radians and one minute is 60 seconds, so ω = 2π × " + dgFmt(R0.rpm, 1) + "/60 = "
            + dgFmt(R0.om, 5) + " rad/s — about " + dgFmt(R0.om / R0.rpm, 3)
            + " times the raw number, and it is squared, so the radius comes out "
            + dgFmt(R0.r / W.rpmAsOmega, 0) + " times different.",
        };
      }
      if (hit(W.noSixty)) {
        return {
          id: "forgot-the-minutes",
          label: "The 60 is missing",
          detail: " (2π × " + dgFmt(R0.rpm, 1) + ")² in the denominator gives "
            + dgFmt(W.noSixty, 3) + " m — that is the radius for "
            + dgFmt(R0.rpm, 1) + " revolutions per SECOND. Divide the rate by 60 first.",
        };
      }
      if (hit(W.noTwoPi)) {
        return {
          id: "forgot-the-two-pi",
          label: "The 2π is missing",
          detail: " Using rpm/60 = " + dgFmt(R0.rpm / 60, 5) + " as ω gives " + dgFmt(W.noTwoPi, 1)
            + " m. That is revolutions per second, not radians per second — one revolution is 2π"
            + " radians, so ω = " + dgFmt(R0.om, 5) + " rad/s.",
        };
      }
      if (hit(W.noSquare)) {
        return {
          id: "forgot-the-square",
          label: "a = ω²r, not ωr",
          detail: " a/ω = " + dgFmt(W.noSquare, 2) + " m. The centripetal acceleration goes as the"
            + " SQUARE of the rate of turn, so r = a/ω² = " + dgFmt(R0.r, 1) + " m.",
        };
      }
      if (hit(W.diameter)) {
        return {
          id: "answered-the-diameter",
          label: "That is the diameter",
          detail: " " + dgFmt(W.diameter, 0) + " m is across the ring. a = ω²r takes the distance"
            + " from the axis: " + dgFmt(R0.r, 1) + " m.",
        };
      }
      return null;
    }

    if (R0.variant === "pct") {
      if (hit(W.ratioPct)) {
        return {
          id: "answered-the-ratio",
          label: "That is what is LEFT, not what is missing",
          detail: " (r − h)/r = " + dgFmt(W.ratioPct, 2) + "% is the fraction of the feet's"
            + " acceleration that the head still has. The question asks by how much it is LOWER:"
            + " 100 − " + dgFmt(W.ratioPct, 2) + " = " + dgFmt(R0.pct, 2) + "%, which is just h/r.",
        };
      }
      if (hit(W.ratio) || hit(W.asFraction)) {
        const used = hit(W.ratio) ? W.ratio : W.asFraction;
        return {
          id: "answered-a-fraction",
          label: "The box asks for a percentage",
          detail: " " + dgFmt(used, 5) + " is the bare ratio. × 100 → "
            + (hit(W.ratio) ? dgFmt(W.ratioPct, 2) + "%, which is the part that REMAINS; what is"
              + " missing is " + dgFmt(R0.pct, 2) + "%."
              : dgFmt(R0.pct, 2) + "%."),
        };
      }
      if (hit(W.overRminusH)) {
        return {
          id: "divided-by-the-head-radius",
          label: "The comparison is against the FEET",
          detail: " 100h/(r − h) = " + dgFmt(W.overRminusH, 3) + "% measures the shortfall against"
            + " the head's own acceleration. 'Lower than at your feet' means divided by the feet's:"
            + " (a_feet − a_head)/a_feet = h/r = " + dgFmt(R0.pct, 2) + "%.",
        };
      }
      return null;
    }

    if (hit(W.noHundred)) {
      return {
        id: "percent-not-converted",
        label: "A percentage is a hundredth",
        detail: " h/" + dgFmt(R0.pctLimit, 1) + " = " + dgFmt(W.noHundred, 3) + " m divides by the"
          + " percentage as though it were the fraction itself. " + dgFmt(R0.pctLimit, 1)
          + "% is " + dgFmt(R0.pctLimit / 100, 4) + ", so r = h/" + dgFmt(R0.pctLimit / 100, 4)
          + " = " + dgFmt(R0.r, 1) + " m — a hundred times bigger, which is a difference between a"
          + " ring you could walk around and one you could not stand up in.",
      };
    }
    if (hit(W.multiplied)) {
      return {
        id: "multiplied-instead",
        label: "A tighter budget needs a BIGGER ring",
        detail: " h × " + dgFmt(R0.pctLimit, 1) + " = " + dgFmt(W.multiplied, 2)
          + " m moves the wrong way: halve the allowed difference and the radius has to DOUBLE,"
          + " because the difference is h/r. r = 100h/p = " + dgFmt(R0.r, 1) + " m.",
      };
    }
    if (hit(W.inverted)) {
      return {
        id: "ratio-inverted",
        label: "h and the budget are the wrong way up",
        detail: " r = 100h/p, with the height on top: " + dgFmt(R0.r, 1) + " m. Check the units by"
          + " eye — the answer has to be a length, and only h can supply one.",
      };
    }
    if (hit(W.offByH)) {
      return {
        id: "added-the-height",
        label: "r already reaches the feet",
        detail: " The condition h/r ≤ p is written with r as the radius to the FLOOR, where the feet"
          + " are. Nothing else has to be added on: r = " + dgFmt(R0.r, 1) + " m.",
      };
    }
    return null;
  }

  function dgStationGrade(R0, answers) {
    const solution = dgStationSolution(R0);
    const guess = dgNum(answers ? answers[R0.answerKey] : undefined);
    if (!Number.isFinite(guess)) return dgBlank(solution);

    const delta = guess - R0.answer;
    const correct = Math.abs(delta) <= R0.tol;

    /* Everything the reveal shows is worked from their number: the spin they
       asked for, or the ring they asked for spun at the stated limit. */
    let omTheirs, rTheirs, aTheirs;
    if (R0.tier === 0) {
      rTheirs = R0.r;
      omTheirs = R0.variant === "period" ? TAU / Math.max(Math.abs(guess), 1e-6) : Math.abs(guess);
    } else if (R0.tier === 1) {
      rTheirs = dgClamp(Math.abs(guess), 0.5, 1e6);
      omTheirs = R0.om;
    } else if (R0.variant === "rmin") {
      rTheirs = dgClamp(Math.abs(guess), 0.5, 1e6);
      omTheirs = Math.sqrt(R0.aT / rTheirs);
    } else {
      rTheirs = R0.r;
      omTheirs = R0.om;
    }
    aTheirs = omTheirs * omTheirs * rTheirs;
    const scaleG = aTheirs / R0.aT;              // what the bathroom scale reads, as a fraction

    let verdict, feedback;
    if (correct) {
      if (R0.tier === 2) {
        verdict = { kind: "hit", text: R0.variant === "pct" ? "Gradient called exactly" : "Ring sized right" };
        feedback = R0.variant === "pct"
          ? "Exact " + dgFmt(R0.pct, 3) + "%; you gave " + dgFmt(guess, 3) + "%. Feet at "
            + dgFmt(R0.aFeet, 3) + " m/s², head at " + dgFmt(R0.aHead, 3)
            + " m/s². The ω² cancels — the gradient is your height against the ring's radius and"
            + " nothing else."
          : "Exact " + dgFmt(R0.r, 2) + " m; you gave " + dgFmt(guess, 2)
            + " m. At that radius the head-to-feet difference is exactly the "
            + dgFmt(R0.pctLimit, 1) + "% allowed, and the ring turns at " + dgFmt(R0.rpm, 2)
            + " rev/min.";
      } else {
        verdict = { kind: "hit", text: "Scale reads " + dgFmt(scaleG, 2) + " × target" };
        feedback = "Exact " + dgFmt(R0.answer, R0.answerKey === "omega" ? 5 : 2) + " "
          + (R0.answerKey === "omega" ? "rad/s" : R0.answerKey === "period" ? "s" : "m")
          + "; you gave " + dgFmt(guess, R0.answerKey === "omega" ? 5 : 2)
          + ". The scale on the rim reads " + dgFmt(aTheirs, 3) + " m/s², which is the "
          + R0.tgt.label + " asked for. One rotation takes " + dgFmt(TAU / omTheirs, 2)
          + " s, or " + dgFmt((60 * omTheirs) / TAU, 2) + " rev/min.";
      }
    } else if (R0.tier === 2 && R0.variant === "pct") {
      verdict = {
        kind: delta > 0 ? "over" : "under",
        text: "Head is " + dgFmt(R0.pct, 2) + "% lighter, not " + dgFmt(guess, 2) + "%",
      };
      feedback = "a_head/a_feet = (r − h)/r = " + dgFmt((R0.r - R0.h) / R0.r, 5) + ", so the head is"
        + " lower by h/r = " + dgFmt(R0.pct, 3) + "%. You gave " + dgFmt(guess, 3)
        + "%. In numbers: " + dgFmt(R0.aFeet, 3) + " m/s² at the feet against "
        + dgFmt(R0.aHead, 3) + " m/s² at the head.";
    } else if (R0.tier === 2) {
      const pctTheirs = (100 * R0.h) / Math.max(rTheirs, 1e-6);
      verdict = {
        kind: delta > 0 ? "over" : "under",
        text: delta < 0
          ? "Your ring leaves a " + dgFmt(pctTheirs, 2) + "% gradient"
          : "Bigger than it needs to be by " + dgFmt(delta, 0) + " m",
      };
      feedback = delta < 0
        ? "At " + dgFmt(rTheirs, 1) + " m the head-to-feet difference is h/r = "
          + dgFmt(pctTheirs, 2) + "%, over the " + dgFmt(R0.pctLimit, 1)
          + "% budget. The smallest ring that fits is r = 100h/p = " + dgFmt(R0.r, 2) + " m."
        : "That ring works — at " + dgFmt(rTheirs, 1) + " m the difference is only "
          + dgFmt(pctTheirs, 2) + "% — but the question asked for the SMALLEST that does, and that"
          + " is r = 100h/p = " + dgFmt(R0.r, 2) + " m.";
    } else {
      const light = scaleG < 1;
      verdict = {
        kind: R0.answerKey === "period" ? (delta > 0 ? "over" : "under") : (delta > 0 ? "over" : "under"),
        text: light
          ? "Scale reads " + dgFmt(scaleG, 2) + " × target — too light"
          : "Scale reads " + dgFmt(scaleG, 2) + " × target — too heavy",
      };
      feedback = "Spun the way your number says, the rim delivers " + dgFmt(aTheirs, 3)
        + " m/s² against the " + dgFmt(R0.aT, 3) + " m/s² wanted — "
        + dgFmt(Math.abs(scaleG - 1) * 100, 0) + "% "
        + (light ? "light" : "heavy") + ". Exact "
        + (R0.answerKey === "period" ? "period " + dgFmt(R0.T, 3) + " s"
          : R0.answerKey === "omega" ? "ω " + dgFmt(R0.om, 5) + " rad/s"
            : "radius " + dgFmt(R0.r, 2) + " m")
        + "; you gave " + dgFmt(guess, R0.answerKey === "omega" ? 5 : 2) + ".";
    }

    return {
      correct, blank: false, verdict, feedback,
      misconception: correct ? null : dgStationMisconception(R0, guess),
      solution,
      exact: R0.tier === 2
        ? (R0.variant === "pct"
          ? { pct: dgR(R0.pct, 4), aHead: dgR(R0.aHead, 5), aFeet: dgR(R0.aFeet, 5) }
          : { rmin: dgR(R0.r, 4) })
        : { period: dgR(R0.T, 5), omega: dgR(R0.om, 6), radius: dgR(R0.r, 4) },
      tolerance: { [R0.answerKey]: dgR(R0.tol, 6) },
      guess, omTheirs, rTheirs, aTheirs, scaleG,
    };
  }

  /* ==========================================================================
     drawing helpers, local
     --------------------------------------------------------------------------
     Deliberately not animate.js's: drawDataPlate takes flat strings in one
     place in that file and label/value pairs in another, and this file is not
     the one to settle that argument.
     ========================================================================== */

  function dgText(ctx, x, y, text, colour, size, align, weight) {
    ctx.save();
    ctx.fillStyle = colour;
    ctx.font = (weight || 500) + " " + Math.max(size, 1) + "px " + dgFont();
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text), x, y);
    ctx.restore();
  }

  function dgArrow(ctx, x1, y1, x2, y2, colour, width) {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
    if (typeof drawArrow === "function") {
      ctx.save();
      drawArrow(ctx, x1, y1, x2, y2, colour, width || 2);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.strokeStyle = colour; ctx.lineWidth = width || 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function dgDash(ctx, x1, y1, x2, y2, colour, width, dash) {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
    ctx.save();
    ctx.setLineDash(dash || [4, 4]);
    ctx.strokeStyle = colour; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function dgRoundRect(ctx, x, y, w, h, r) {
    if (typeof roundRectPath === "function") { roundRectPath(ctx, x, y, w, h, r); return; }
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // A ruled instrument card: label left, value right, as the rest of the app
  // sets its readouts.
  function dgPlate(ctx, P, x, y, w, rows) {
    if (!rows || !rows.length || w < 60) return 0;
    const lineH = 15, pad = 7;
    const h = pad * 2 + rows.length * lineH;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = P.panel;
    dgRoundRect(ctx, x, y, w, h, 3); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
    dgRoundRect(ctx, x, y, w, h, 3); ctx.stroke();
    ctx.restore();
    rows.forEach((r, i) => {
      const ty = y + pad + lineH * i + lineH / 2 - 1;
      dgText(ctx, x + 8, ty, r[0], P.inkSoft, 10, "left", 400);
      dgText(ctx, x + w - 8, ty, r[1], r[2] || P.ink, 10.5, "right", 600);
    });
    return h;
  }

  // Bounded by the canvas rather than by a fixed span: an unbounded loop here
  // costs five hundred stroked paths a frame on a phone-sized pane.
  function dgHatch(ctx, colour, alpha, step, w, h) {
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

  function dgTag(ctx, P, x, y, name) {
    if (typeof sideNameplate === "function") {
      sideNameplate(ctx, x, y, "Experiment", name, P.crimson);
      return;
    }
    dgText(ctx, x, y + 12, "Experiment: " + name, P.crimson, 11, "left");
  }

  /* The host paints its verdict in a translucent plate at bottom CENTRE, about
     fourteen pixels up, over whatever the scene left there. The nameplate is
     the least load-bearing thing on any of these stages, so it takes the
     bottom-left corner on a wide one and is dropped entirely on a narrow one,
     where a long verdict reaches far enough left to sit on top of it. The
     threshold is the same 820 the topic benches use, for the same reason: the
     longest verdict this file emits is about 195 px of text either side of
     centre, and the gap closes below that width. */
  function dgBench(ctx, P, w, h, name) {
    if (!(w >= 820 && h > 200)) return;
    dgTag(ctx, P, 12, h - 40, name);
  }

  function dgSphere(ctx, P, x, y, r, stroke, fill) {
    if (!(r > 0.6) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (typeof sphereShade === "function" && r > 4) {
      sphereShade(ctx, x, y, r, stroke || P.ink, fill || P.panel);
      return;
    }
    ctx.save();
    ctx.fillStyle = fill || P.panel;
    ctx.strokeStyle = stroke || P.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // A floor line with tick hatching under it, used by three of the five scenes.
  function dgFloor(ctx, P, x1, x2, y) {
    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
    ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1; ctx.globalAlpha = 0.65;
    for (let px = x1; px < x2; px += 12) {
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px - 7, y + 8); ctx.stroke();
    }
    ctx.restore();
  }

  function dgDrawEmpty(ctx, w, h, P) {
    dgText(ctx, w / 2, h / 2, "Choose an experiment", P.inkSoft, Math.min(13, w / 18));
  }

  /* ==========================================================================
     reveal — the spool
     --------------------------------------------------------------------------
     The SOLID spool does what the reader's answer says, and a translucent
     ghost does the truth beside it. The thread is drawn at the reader's angle
     on the critical-angle rung, so an answer that is nearly right is watched
     creeping rather than read off a table; the line of action is extended as a
     dashed line past the contact point, and the perpendicular from the contact
     point to that line is drawn and measured. When the two coincide the reason
     nothing happens is visible rather than asserted.
     ========================================================================== */

  function dgSpoolPlay(R0, res) {
    let thShown, aS, aG, thGhost = null;

    if (R0.tier === 0) {
      thShown = R0.th;
      aG = R0.a;
      const truth = res.truth;
      // A round built to sit exactly at the critical angle has no speed of its
      // own to lend the wrong answer, so the ghost-free case borrows the one
      // number the mistake itself implies: the acceleration of a block being
      // dragged with no torque at all.
      const mag = truth === "neither" ? (R0.T * R0.cs) / R0.m : Math.abs(R0.a);
      aS = res.given === "neither" ? 0 : (res.given === "toward" ? mag : -mag);
    } else if (R0.tier === 1) {
      thShown = dgClamp(res.guess * DEG, 0, 88 * DEG);
      aS = (R0.T * (R0.R * Math.cos(thShown) - R0.r)) / (R0.m * R0.R * (R0.beta + 1));
      aG = 0;
      thGhost = R0.thC;
    } else {
      thShown = R0.th;
      // A wild answer would otherwise put the spool three streets away and
      // shrink the experiment to a speck; the reported error still uses their
      // uncapped number.
      aS = dgClamp(res.guess, -12, 12);
      aG = R0.a;
    }

    const peak = Math.max(Math.abs(aS), Math.abs(aG), 0.02);
    const tRun = dgClamp(Math.sqrt((2 * 6 * R0.R) / peak), 0.8, 2.8);

    return {
      kind: "spool", t: 0, tRun, hold: 0, done: false,
      thShown, thGhost, aS, aG, sS: 0, sG: 0,
    };
  }

  function dgSpoolStep(A, R0, dt) {
    if (A.t < A.tRun) {
      A.t = Math.min(A.t + dt, A.tRun);
      A.sS = 0.5 * A.aS * A.t * A.t;
      A.sG = 0.5 * A.aG * A.t * A.t;
      return true;
    }
    A.hold += dt;
    if (A.hold >= 2.8) { A.done = true; return false; }
    return true;
  }

  /* One spool, at a world x, rotated by the angle its own travel demands.
     phi = s/R and nothing else — a spool that span at any other rate would be
     skidding, which is the assumption the whole answer rests on. */
  function dgSpoolBody(ctx, P, V, R0, x, alpha, tint) {
    const cx = V.X(x), cy = V.Y(R0.R);
    const rad = V.S(R0.R), hub = V.S(R0.r);
    if (!(rad > 1.5)) return;
    const phi = x / R0.R;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(phi);

    // rim
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU);
    ctx.fillStyle = P.panel; ctx.globalAlpha = alpha * 0.55; ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = tint || P.ink; ctx.lineWidth = Math.max(1, rad * 0.06);
    ctx.stroke();

    // the wound axle, which is what the thread actually leaves
    if (hub > 1) {
      ctx.beginPath(); ctx.arc(0, 0, hub, 0, TAU);
      ctx.fillStyle = P.paper; ctx.globalAlpha = alpha * 0.8; ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = tint || P.ink; ctx.lineWidth = 1.1; ctx.stroke();
    }
    // the winding on it, so the rotation is legible even at small sizes
    if (hub > 3) {
      ctx.strokeStyle = P.brass; ctx.globalAlpha = alpha * 0.7; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * TAU;
        ctx.beginPath(); ctx.arc(0, 0, hub * 0.72, a0, a0 + 0.5); ctx.stroke();
      }
      ctx.globalAlpha = alpha;
    }
    // spokes
    if (rad > 8) {
      ctx.strokeStyle = tint || P.inkSoft; ctx.lineWidth = 1.2; ctx.globalAlpha = alpha * 0.8;
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a0) * hub, Math.sin(a0) * hub);
        ctx.lineTo(Math.cos(a0) * rad * 0.94, Math.sin(a0) * rad * 0.94);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function dgSpoolDraw(ctx, w, h, P, R0, res, A) {
    const posed = !res;
    const thShown = A ? A.thShown
      : posed ? (R0.tier === 1 ? 30 * DEG : R0.th)
        : (R0.tier === 1 ? dgClamp(res.guess * DEG, 0, 88 * DEG) : R0.th);
    const sS = A ? A.sS : 0;
    const sG = A ? A.sG : 0;

    const cs = Math.cos(thShown), sn = Math.sin(thShown);
    const threadLen = Math.max(R0.R * 4.5, 0.6);

    // world extent: both spools, the ground under them, and the puller's hand
    const lo = Math.min(0, sS, sG) - R0.R * 1.3;
    const hi = Math.max(0, sS, sG) + R0.R * 1.3 + threadLen * cs;
    let V;
    if (typeof newWorld === "function" && typeof fitView === "function" && typeof includePoint === "function") {
      const world = newWorld(lo, 0);
      includePoint(world, hi, 0, 0);
      includePoint(world, lo, -R0.R * 0.35, 0);
      includePoint(world, hi, R0.R * 2.4 + threadLen * sn, 0);
      V = fitView(DG_FIT_SPOOL, w, h * 0.92, world, { pad: 0.10 });
    } else {
      const sc = Math.min(w / Math.max(hi - lo, 0.1), h / Math.max(R0.R * 4, 0.1));
      V = {
        scale: sc, X: (x) => w * 0.15 + (x - lo) * sc, Y: (y) => h * 0.78 - y * sc,
        S: (l) => l * sc, zoomedOut: false, zoomFactor: 1,
      };
    }
    const X = V.X, Y = V.Y, S = V.S;
    const groundY = Y(0);

    dgFloor(ctx, P, Math.max(X(lo) - 40, 0), Math.min(X(hi) + 40, w), groundY);

    // the ghost, doing the truth
    const showGhost = !!(res && !res.blank && A);
    if (showGhost && Math.abs(sG - sS) > 1e-9) dgSpoolBody(ctx, P, V, R0, sG, 0.30, P.inkSoft);

    // the spool the reader's answer implies
    dgSpoolBody(ctx, P, V, R0, sS, 1, P.ink);

    // the thread, tangent to the axle underneath the centre, and its line of
    // action extended both ways so its distance from the contact point is a
    // thing you can look at rather than a thing you are told
    const cxw = sS, cyw = R0.R;
    const ax = cxw + R0.r * sn, ay = cyw - R0.r * cs;      // tangency point
    const hx = ax + threadLen * cs, hy = ay + threadLen * sn;
    const back = R0.R * 2.2;

    dgDash(ctx, X(ax - back * cs), Y(ay - back * sn), X(hx), Y(hy), P.brass, 1.1, [5, 5]);

    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(hx), Y(hy)); ctx.stroke();
    ctx.restore();

    // the contact point, and the perpendicular from it to the line of action
    const px = cxw, py = 0;
    const dot = (px - ax) * cs + (py - ay) * sn;
    const fx = ax + dot * cs, fy = ay + dot * sn;
    const armM = R0.R * cs - R0.r;

    ctx.save();
    ctx.strokeStyle = P.crimson; ctx.lineWidth = 1.6;
    const cr = dgClamp(S(R0.R) * 0.16, 2.5, 7);
    ctx.beginPath();
    ctx.moveTo(X(px) - cr, groundY - cr); ctx.lineTo(X(px) + cr, groundY + cr);
    ctx.moveTo(X(px) + cr, groundY - cr); ctx.lineTo(X(px) - cr, groundY + cr);
    ctx.stroke();
    ctx.restore();
    if (S(R0.R) > 18) dgText(ctx, X(px), groundY + 20, "P", P.crimson, 10.5);

    if (Math.hypot(X(fx) - X(px), Y(fy) - groundY) > 4) {
      dgDash(ctx, X(px), groundY, X(fx), Y(fy), P.crimson, 1.3, [3, 3]);
      // The arm is drawn before grading because it is the geometry of the
      // experiment, but its LENGTH is not printed: its sign is the answer on
      // the direction rung and its size is most of the answer on the last one.
      if (S(R0.R) > 22 && !posed) {
        dgText(ctx, (X(px) + X(fx)) / 2 + 16, (groundY + Y(fy)) / 2,
          dgFmt(Math.abs(armM) * 100, 1) + " cm", P.crimson, 10, "left");
      }
    } else if (S(R0.R) > 22 && !posed) {
      dgText(ctx, X(px) + 10, groundY - 16, "line through P", P.crimson, 10, "left");
    }

    // the pull itself
    const fs = dgClamp(S(R0.R) * 1.3 / Math.max(R0.T, 1), 0.5, 40);
    dgArrow(ctx, X(ax), Y(ay), X(ax) + cs * R0.T * fs, Y(ay) - sn * R0.T * fs, P.forest, 2);
    if (S(R0.R) > 20) {
      dgText(ctx, X(ax) + cs * R0.T * fs + 12, Y(ay) - sn * R0.T * fs - 10,
        "T = " + dgFmt(R0.T, 1) + " N", P.forest, 10, "left");
    }

    // the angle, measured from the horizontal at the tangency point
    if (S(R0.R) > 26) {
      ctx.save();
      ctx.strokeStyle = P.brass; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(X(ax), Y(ay), 26, -thShown, 0); ctx.stroke();
      ctx.restore();
      dgText(ctx, X(ax) + 36, Y(ay) - 11,
        (posed && R0.tier === 1 ? "θ = ?" : dgFmt(thShown / DEG, 1) + "°"), P.brass, 10.5, "left");
      if (R0.tier === 1 && A && A.thGhost !== null) {
        dgDash(ctx, X(ax), Y(ay), X(ax) + Math.cos(A.thGhost) * S(R0.R * 1.6),
          Y(ay) - Math.sin(A.thGhost) * S(R0.R * 1.6), P.inkSoft, 1.1, [2, 4]);
        dgText(ctx, X(ax) + Math.cos(A.thGhost) * S(R0.R * 1.6) + 8,
          Y(ay) - Math.sin(A.thGhost) * S(R0.R * 1.6) - 8,
          "θ_c " + dgFmt(R0.thCDeg, 1) + "°", P.inkSoft, 9.5, "left");
      }
    }

    // where the two ended up
    if (showGhost && A.t >= A.tRun - 1e-9 && Math.abs(sS - sG) > R0.R * 0.12) {
      const x1 = X(Math.min(sS, sG)), x2 = X(Math.max(sS, sG));
      const ay2 = groundY + 30;
      if (x2 - x1 > 8) {
        dgArrow(ctx, x1, ay2, x2, ay2, P.crimson, 1.5);
        dgArrow(ctx, x2, ay2, x1, ay2, P.crimson, 1.5);
        dgText(ctx, (x1 + x2) / 2, ay2 - 11, dgFmt(Math.abs(sS - sG) * 100, 0) + " cm apart",
          P.crimson, 10);
      }
    }

    if (V.zoomedOut && typeof drawZoomBar === "function") drawZoomBar(ctx, w, h, V, "m");

    /* Both derived rows are withheld until the answer is in. theta_c IS the
       answer on the middle rung, and the moment arm's sign is the answer on the
       first — a table that prints either of them has done the reader's work.
       R and r stay: they are printed in the givens anyway. */
    const rows = [
      ["R / r", dgFmt(R0.R, 3) + " / " + dgFmt(R0.r, 4) + " m"],
      ["θ_c = arccos(r/R)", posed ? "—" : dgFmt(R0.thCDeg, 2) + "°"],
      ["moment arm about P", posed ? "—" : dgFmt(armM * 100, 2) + " cm"],
    ];
    if (res && !res.blank) {
      if (R0.tier === 0) {
        rows.push(["you said", DG_SPOOL_DIRLABEL[res.given] || "—"]);
        rows.push(["it does", DG_SPOOL_DIRLABEL[res.truth] || "—", res.correct ? P.forest : P.crimson]);
      } else if (R0.tier === 1) {
        rows.push(["your angle", dgFmt(res.guess, 2) + "°"]);
        rows.push(["it creeps at", dgFmt(A ? A.aS : 0, 3) + " m/s²", res.correct ? P.forest : P.crimson]);
      } else {
        rows.push(["your a", dgSigned(res.guess, 3) + " m/s²"]);
        rows.push(["true a", dgSigned(R0.a, 3) + " m/s²", res.correct ? P.forest : P.crimson]);
      }
    }
    const pw = Math.min(210, w - 24);
    if (pw >= 60) dgPlate(ctx, P, w - pw - 12, 12, pw, rows);
    dgBench(ctx, P, w, h, "Spool and thread");
  }

  /* ==========================================================================
     reveal — the tablecloth
     --------------------------------------------------------------------------
     Integrated, not replayed. The cloth is given the acceleration the reader's
     pull time demands — A = mu1 g + 2L/t^2, from the requirement that it GAIN
     L on the dish in exactly t — and the dish is integrated under mu1 g while
     the cloth is over it and mu2 g afterwards. The closed form D(t) is used
     only as a check on where it comes to rest.

     The glass is a rigid body tipping about whichever bottom edge the
     acceleration is trying to lift, with the arms recomputed as it goes:

         alpha = 3 (a y_cg - g x_cg) / (w^2 + 4h^2)
         x_cg  = (w/2) cos(phi) - h sin(phi)      y_cg = (w/2) sin(phi) + h cos(phi)

     so it rocks and settles when the acceleration is under the limit and goes
     over, accelerating as its own weight takes over, when it is not.
     ========================================================================== */

  const DG_DISH_W = 0.17;         // metres, side elevation of the dish

  function dgGlassRate(phi, a, g, w, h) {
    const s = phi >= 0 ? 1 : -1;
    const u = Math.abs(phi);
    const xc = (w / 2) * Math.cos(u) - h * Math.sin(u);
    const yc = (w / 2) * Math.sin(u) + h * Math.cos(u);
    const denom = w * w + 4 * h * h;
    if (!(denom > 0)) return 0;
    // The pseudo-force in the dish's frame lifts the edge the acceleration
    // points away from, so the sign of a picks which edge is the pivot.
    return (3 * (a * s * yc - g * xc)) / denom * s;
  }

  function dgClothPlay(R0, res) {
    /* A correct zero cannot be animated as a zero-length pull — nothing would
       happen at all, which is true and useless. It runs at the pull the CIRCLE
       would have allowed instead, and says so: the point being made is that no
       pull time saves the glass, so any of them will do to show it. */
    const substitute = !(res.guess > 0.004);
    const tWant = substitute ? R0.tSlide : res.guess;
    // Capped for the drawing only; the verdict already quoted their real number.
    const tPull = Math.min(tWant, R0.tSlide * 3.5);

    const A = R0.mu1 * R0.g + (2 * R0.L) / (tPull * tPull);
    const vEnd = R0.mu1 * R0.g * tPull;
    const tStop = tPull + vEnd / (R0.mu2 * R0.g);
    const track = tStop + 0.02;
    // Real time is far too quick to watch (the whole event is a fifth of a
    // second), and a wild answer is far too slow. The factor is adaptive and
    // is printed on the stage rather than hidden.
    const wall = dgClamp(track * 8, 1.4, 6.0);

    return {
      kind: "cloth", t: 0, tPull, tStop, A, speed: track / wall, track, wall,
      substitute, hold: 0, done: false,
      xC: -R0.L, xD: 0, v: 0, phi: 0, om: 0, fell: false, ripple: 0,
    };
  }

  function dgClothStep(A, R0, dt) {
    if (A.t >= A.tStop) {
      A.hold += dt;
      if (A.hold >= 2.6) { A.done = true; return false; }
      return true;
    }
    // dt arrives in wall-clock seconds; the scene runs on its own clock.
    let left = Math.min(dt * A.speed, A.tStop - A.t);
    while (left > 1e-9) {
      const step = Math.min(left, 0.003);
      left -= step;
      const drag = A.t < A.tPull;
      const aDish = drag ? R0.mu1 * R0.g : (A.v > 0 ? -R0.mu2 * R0.g : 0);

      // dish
      const vNew = Math.max(A.v + aDish * step, 0);
      A.xD += ((A.v + vNew) / 2) * step;
      A.v = vNew;
      // cloth, still accelerating out from under it
      if (drag) A.xC = -R0.L + 0.5 * A.A * (A.t + step) * (A.t + step);
      else A.xC += Math.max(A.A * (A.t + step), 0) * step;

      // glass
      if (R0.tier === 2) {
        if (!A.fell) {
          const al = dgGlassRate(A.phi, aDish, R0.g, R0.w, R0.hG);
          A.om += al * step;
          A.phi += A.om * step;
          // The base cannot sink into the dish: a glass that rocks back down
          // settles rather than passing through.
          if (A.phi > 0 && A.om < 0 && A.phi < 1e-3) { A.phi = 0; A.om = 0; }
          if (A.phi < 0 && A.om > 0 && A.phi > -1e-3) { A.phi = 0; A.om = 0; }
          const uFall = Math.atan2(R0.w / 2, R0.hG);
          if (Math.abs(A.phi) > uFall + 1.2) { A.phi = Math.sign(A.phi) * (uFall + 1.2); A.om = 0; A.fell = true; }
        }
      }
      A.ripple += step * Math.abs(A.A) * 0.02;
      A.t += step;
    }
    return true;
  }

  function dgClothDraw(ctx, w, h, P, R0, res, A) {
    const tableY = h * 0.62;
    const startX = w * 0.26;
    // The tape shown before grading does NOT depend on the answer; afterwards
    // it stretches to include wherever the dish actually stopped.
    const reach = res && !res.blank
      ? Math.max(R0.Dmax * 1.6, Math.min(res.travel, R0.Dmax * 12) * 1.15)
      : R0.Dmax * 1.6;
    const pxPerM = dgClamp((w * 0.62) / Math.max(reach, 0.01), 1, 4000);
    const Xw = (m) => startX + m * pxPerM;

    // the table, and the tape along it
    dgFloor(ctx, P, 0, w, tableY);
    const stepCm = pxPerM * 0.01 > 6 ? 0.01 : (pxPerM * 0.05 > 6 ? 0.05 : 0.10);
    const nTick = Math.min(Math.floor(reach / stepCm) + 1, 300);
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
    for (let i = 0; i <= nTick; i++) {
      const m = i * stepCm;
      const major = Math.abs(m / 0.05 - Math.round(m / 0.05)) < 1e-6;
      const x = Xw(m);
      if (x > w) break;
      ctx.beginPath();
      ctx.moveTo(x, tableY + 13);
      ctx.lineTo(x, tableY + (major ? 23 : 18));
      ctx.stroke();
      if (major && pxPerM * 0.05 > 28) {
        dgText(ctx, x, tableY + 32, dgFmt(m * 100, 0), P.inkSoft, 9);
      }
    }
    ctx.restore();
    if (pxPerM * 0.05 > 28) dgText(ctx, Xw(0) - 4, tableY + 44, "cm from the start", P.inkSoft, 9, "left");

    // the circle it must stay inside, marked on the table
    dgDash(ctx, Xw(R0.Dmax), tableY - h * 0.30, Xw(R0.Dmax), tableY + 12, P.brass, 1.4, [5, 4]);
    dgText(ctx, Xw(R0.Dmax), tableY - h * 0.30 - 9,
      "circle  " + dgFmt(R0.Dmax * 100, 1) + " cm", P.brass, 10);
    dgDash(ctx, Xw(0), tableY - h * 0.16, Xw(0), tableY + 8, P.inkSoft, 1, [3, 4]);

    const xC = A ? A.xC : -R0.L;
    const xD = A ? A.xD : 0;

    // the cloth, with a trailing edge that ripples as it is whipped out
    const clothTop = tableY - 3;
    const clothLeft = Xw(xC);
    if (clothLeft < w) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(clothLeft, clothTop);
      const amp = A ? dgClamp(A.v * 2 + (A.t < A.tPull ? 3 : 0), 0, 5) : 0;
      for (let x = clothLeft; x <= w; x += 8) {
        ctx.lineTo(x, clothTop - Math.sin((x - clothLeft) * 0.09 + (A ? A.ripple : 0)) * amp);
      }
      ctx.lineTo(w, tableY);
      ctx.lineTo(clothLeft, tableY);
      ctx.closePath();
      ctx.fillStyle = P.navy; ctx.globalAlpha = 0.30; ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = P.navy; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.restore();
      if (pxPerM * R0.L > 60 && clothLeft > 4) {
        dgText(ctx, Math.min(clothLeft + 26, w - 6), clothTop - 14, "cloth", P.navy, 10, "left");
      }
    }

    // the dish, in side elevation
    const dw = Math.max(pxPerM * DG_DISH_W, 14);
    const dh = Math.max(dw * 0.17, 4);
    const dx = Xw(xD);
    // The dish really does drop by the thickness of the cloth as the trailing
    // edge passes under it; eased over a few pixels of travel so it settles
    // rather than jumping.
    const dy = clothTop + (tableY - clothTop) * dgClamp((clothLeft - dx) / 9, 0, 1);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx - dw / 2, dy);
    ctx.lineTo(dx + dw / 2, dy);
    ctx.lineTo(dx + dw * 0.34, dy - dh);
    ctx.lineTo(dx - dw * 0.34, dy - dh);
    ctx.closePath();
    ctx.fillStyle = P.panel; ctx.globalAlpha = 0.9; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.restore();

    // the glass on it
    if (R0.tier === 2 && pxPerM * R0.w > 3) {
      const gw = pxPerM * R0.w, gh = pxPerM * R0.hG * 2;
      const phi = A ? A.phi : 0;
      const s = phi >= 0 ? 1 : -1;
      // pivot at the bottom edge the tilt is turning about
      const pivX = dx + s * (-gw / 2), pivY = dy - dh;
      ctx.save();
      ctx.translate(pivX, pivY);
      ctx.rotate(-s * Math.abs(phi));
      ctx.beginPath();
      ctx.rect(s > 0 ? 0 : -gw, -gh, gw, gh);
      ctx.fillStyle = P.paper; ctx.globalAlpha = 0.75; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = A && A.fell ? P.crimson : P.forest; ctx.lineWidth = 1.4; ctx.stroke();
      // a line of liquid in it, so a tilt reads as a tilt
      if (gh > 12) {
        ctx.strokeStyle = A && A.fell ? P.crimson : P.navy; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(s > 0 ? 1 : -gw + 1, -gh * 0.42);
        ctx.lineTo(s > 0 ? gw - 1 : -1, -gh * 0.42);
        ctx.stroke();
      }
      ctx.restore();
      if (A && A.fell && gh > 10) {
        dgText(ctx, dx, dy - dh - gh - 12, "over it goes", P.crimson, 10);
      }
    }

    /* The gap is measured against where the dish ACTUALLY came to rest in this
       run, which is not always res.travel: on a round the glass cannot survive
       the reveal is run at the circle's limit instead of at their zero. */
    const shown = A ? A.xD : (res && !res.blank ? res.travel : 0);
    if (res && !res.blank && A && A.t >= A.tStop - 1e-9) {
      const x1 = Math.min(Xw(shown), Xw(R0.Dmax)), x2 = Math.max(Xw(shown), Xw(R0.Dmax));
      if (x2 - x1 > 6 && x2 < w) {
        const ay = tableY - h * 0.10;
        dgArrow(ctx, x1, ay, x2, ay, P.crimson, 1.5);
        dgArrow(ctx, x2, ay, x1, ay, P.crimson, 1.5);
        dgText(ctx, (x1 + x2) / 2, ay - 11,
          dgFmt(Math.abs(shown - R0.Dmax) * 100, 1) + " cm "
          + (shown > R0.Dmax ? "outside" : "to spare"), P.crimson, 10);
      }
    }

    if (A && A.substitute) {
      dgText(ctx, w / 2, 18,
        "no pull time saves the glass — shown at the circle's limit, " + dgFmt(R0.tSlide, 3) + " s",
        P.brass, 10.5);
    }
    if (A && w > 200) {
      const f = A.speed > 0 ? 1 / A.speed : 1;
      dgText(ctx, 14, tableY - h * 0.34,
        f >= 1.05 ? "slow motion ×" + dgFmt(f, 1) : "time ×" + dgFmt(1 / f, 1),
        P.inkSoft, 9.5, "left");
    }

    /* Both of these are answers to the rung being played — the pull time on all
       three, the tipping acceleration on the last — so they are blanked until
       the reader has committed. The coefficients and the circle are givens and
       stay. */
    const graded = !!(res && !res.blank);
    const rows = [
      ["μ₁ cloth / μ₂ table", dgFmt(R0.mu1, 2) + " / " + dgFmt(R0.mu2, 2)],
      ["circle", dgFmt(R0.Dmax * 100, 1) + " cm"],
      ["longest safe pull", graded ? dgFmt(R0.answer, 3) + " s" : "—"],
    ];
    if (R0.tier === 2) {
      rows.push(["a_tip = (w/2h)g", graded ? dgFmt(R0.aTip, 2) + " m/s²" : "—"]);
      rows.push(["μ₁g / μ₂g", dgFmt(R0.mu1 * R0.g, 2) + " / " + dgFmt(R0.mu2 * R0.g, 2)]);
    }
    if (res && !res.blank) {
      rows.push(["your pull", dgFmt(res.guess, 3) + " s"]);
      rows.push([A ? "dish at" : "dish stops at", dgFmt(shown * 100, 1) + " cm",
        shown <= R0.Dmax ? P.forest : P.crimson]);
    }
    const pw = Math.min(214, w - 24);
    if (pw >= 60) dgPlate(ctx, P, w - pw - 12, 12, pw, rows);
    dgBench(ctx, P, w, h, "Tablecloth pull");
  }

  /* ==========================================================================
     reveal — the bowling ball
     --------------------------------------------------------------------------
     The swing is integrated, not eased: theta'' = -(g/L) sin(theta) - gamma
     theta', RK4, at the real amplitude. The small-angle period is 7% wrong at
     60 degrees and these releases are well past that.

     Landing the ball exactly where the READER'S number says it lands is done
     by solving for one of two physical quantities, never by scaling the
     motion. If their return height is above what this pivot can deliver from
     rest, the difference is a SHOVE and the shove speed is bisected for. If it
     is below, the pivot is simply draggier and gamma is bisected for instead.
     Both are real, both are drawn, and the ball always obeys the equation.
     ========================================================================== */

  function dgBallHeightAt(R0, th) { return R0.L * (1 - Math.cos(th)); }

  // Angle at the far end of the round trip: out, back, and up the near side to
  // where it stops. Returns a capped angle rather than looping for ever if a
  // trial speed is large enough to carry the ball over the top.
  function dgBallSimTurn(R0, vStart, gamma) {
    const kp = R0.g / R0.L;
    const s = { th: R0.th0, om: -vStart / R0.L };
    const dt = 0.006;
    let phase = 0;
    for (let i = 0; i < 2600; i++) {
      const prev = s.om;
      dgPendStep(s, kp, gamma, dt);
      if (!Number.isFinite(s.th) || !Number.isFinite(s.om)) return R0.th0;
      if (Math.abs(s.th) > 2.6) return 2.6;
      if (phase === 0) { if (prev <= 0 && s.om > 0) phase = 1; }
      else if (prev >= 0 && s.om < 0) return s.th;
    }
    return Math.abs(s.th);
  }

  function dgBallGammaFor(R0, vStart, hTarget) {
    let lo = 0, hi = 0.02;
    for (let i = 0; i < 24; i++) {
      if (dgBallHeightAt(R0, dgBallSimTurn(R0, vStart, hi)) <= hTarget) break;
      hi *= 1.8;
      if (hi > 400) break;
    }
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (dgBallHeightAt(R0, dgBallSimTurn(R0, vStart, mid)) > hTarget) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function dgBallSpeedFor(R0, gamma, hTarget) {
    let lo = 0, hi = 0.4;
    for (let i = 0; i < 24; i++) {
      if (dgBallHeightAt(R0, dgBallSimTurn(R0, hi, gamma)) >= hTarget) break;
      hi *= 1.7;
      if (hi > 60) break;
    }
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (dgBallHeightAt(R0, dgBallSimTurn(R0, mid, gamma)) < hTarget) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Two bisections, once per grading. Cached on the result so pressing Replay
  // does not pay for them again — and so a replay is bit-for-bit the same run.
  function dgBallTune(R0, res) {
    if (res._tune) return res._tune;
    const hMax = R0.L * (1 - Math.cos(1.35));
    const hTrue = dgClamp(R0.hRet, 0.002, hMax);
    const gTrue = dgBallGammaFor(R0, R0.v0, hTrue);
    const hFloor = dgBallHeightAt(R0, dgBallSimTurn(R0, 0, gTrue));
    const hR = dgClamp(res.hTheirs, 0.002, hMax);
    let vR, gR;
    if (hR >= hFloor) { gR = gTrue; vR = dgBallSpeedFor(R0, gTrue, hR); }
    else { vR = 0; gR = dgBallGammaFor(R0, 0, hR); }
    res._tune = { gTrue, vTrue: R0.v0, gR, vR, hR, hTrue, shoved: vR > 0.02 };
    return res._tune;
  }

  function dgBallRunner(R0, vStart, gamma) {
    return {
      th: R0.th0, om: -vStart / R0.L, phase: 0,
      stopped: false, struck: false, gamma, kp: R0.g / R0.L,
    };
  }

  function dgBallAdvance(B, R0, dt, stopAtNose) {
    if (B.stopped) return;
    const prevOm = B.om, prevTh = B.th;
    dgPendStep(B, B.kp, B.gamma, dt);
    if (!Number.isFinite(B.th) || !Number.isFinite(B.om)) {
      B.th = prevTh; B.om = 0; B.stopped = true; return;
    }
    if (B.phase === 0) { if (prevOm <= 0 && B.om > 0) B.phase = 1; return; }
    if (stopAtNose && B.th >= R0.th0) { B.th = R0.th0; B.om = 0; B.stopped = true; B.struck = true; return; }
    if (prevOm >= 0 && B.om < 0) { B.om = 0; B.stopped = true; }
  }

  function dgBallPlay(R0, res) {
    const tune = dgBallTune(R0, res);
    return {
      kind: "ball", t: 0, hold: 0, done: false, tune,
      you: dgBallRunner(R0, tune.vR, tune.gR),
      ghost: dgBallRunner(R0, tune.vTrue, tune.gTrue),
    };
  }

  function dgBallStep(A, R0, dt) {
    if (A.you.stopped && A.ghost.stopped) {
      A.hold += dt;
      if (A.hold >= 2.8) { A.done = true; return false; }
      return true;
    }
    let left = dt;
    while (left > 1e-9) {
      const step = Math.min(left, 0.004);
      left -= step;
      dgBallAdvance(A.you, R0, step, true);
      dgBallAdvance(A.ghost, R0, step, false);
      A.t += step;
    }
    if (A.t > 16) { A.you.stopped = true; A.ghost.stopped = true; }
    return true;
  }

  /* A head in profile, facing the swing. Drawn rather than described because
     the number the reader gave is about a distance from a face, and a marker
     line does not carry that. */
  function dgBallFace(ctx, P, x, y, s, hit) {
    if (!(s > 6)) return;
    ctx.save();
    ctx.strokeStyle = hit ? P.crimson : P.inkSoft;
    ctx.fillStyle = P.panel;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    // back of the skull round to the brow, then the nose, lips and chin
    ctx.moveTo(x + s * 0.30, y - s * 0.95);
    ctx.bezierCurveTo(x + s * 1.25, y - s * 1.05, x + s * 1.30, y + s * 0.55, x + s * 0.55, y + s * 0.95);
    ctx.lineTo(x + s * 0.34, y + s * 0.62);
    ctx.lineTo(x + s * 0.16, y + s * 0.30);
    ctx.lineTo(x, y);                                  // the nose tip, at the release point
    ctx.lineTo(x + s * 0.30, y - s * 0.22);
    ctx.bezierCurveTo(x + s * 0.20, y - s * 0.62, x + s * 0.14, y - s * 0.86, x + s * 0.30, y - s * 0.95);
    ctx.closePath();
    ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + s * 0.44, y - s * 0.30, Math.max(s * 0.07, 1), 0, TAU);
    ctx.fillStyle = hit ? P.crimson : P.inkSoft; ctx.fill();
    ctx.restore();
  }

  function dgBallDraw(ctx, w, h, P, R0, res, A) {
    const graded = !!(res && !res.blank);
    const pivY = Math.max(h * 0.11, 16);
    const cx = w * 0.46;
    const sn0 = Math.max(Math.sin(R0.th0), 0.15);
    const scale = Math.min((h * 0.70) / R0.L, (w * 0.30) / (R0.L * sn0));
    const bob = dgClamp(scale * 0.055, 4, 20);
    const lowY = pivY + R0.L * scale;

    const thYou = A ? A.you.th : R0.th0;
    const thGh = A ? A.ghost.th : R0.th0;

    // the ceiling mount
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(cx - 46, pivY); ctx.lineTo(cx + 46, pivY); ctx.stroke();
    ctx.restore();
    if (typeof drawDashedLine === "function") {
      drawDashedLine(ctx, cx, pivY, cx, lowY + 10, P.rule, 1, [3, 5]);
    } else {
      dgDash(ctx, cx, pivY, cx, lowY + 10, P.rule, 1, [3, 5]);
    }

    // the arc the ball travels
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 6]);
    const spanTh = Math.min(R0.th0 * 1.25 + 0.12, 1.45);
    ctx.beginPath();
    ctx.arc(cx, pivY, R0.L * scale, Math.PI / 2 - spanTh, Math.PI / 2 + spanTh);
    ctx.stroke();
    ctx.restore();

    // the release line, and the face at it
    const noseX = cx + R0.L * scale * Math.sin(R0.th0);
    const noseY = pivY + R0.L * scale * Math.cos(R0.th0);
    dgDash(ctx, cx - R0.L * scale * 1.05, noseY, noseX + bob * 2.4, noseY, P.inkSoft, 1, [3, 4]);
    dgBallFace(ctx, P, noseX + bob * 1.05, noseY, bob * 1.55, !!(A && A.you.struck));

    // the ghost: what the swing actually does
    if (res && !res.blank && A && Math.abs(thGh - thYou) > 1e-4) {
      const gx = cx + R0.L * scale * Math.sin(thGh), gy = pivY + R0.L * scale * Math.cos(thGh);
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, pivY); ctx.lineTo(gx, gy); ctx.stroke();
      ctx.beginPath(); ctx.arc(gx, gy, bob, 0, TAU);
      ctx.fillStyle = P.inkSoft; ctx.fill();
      ctx.restore();
    }

    // the ball the reader's number puts there
    const bx = cx + R0.L * scale * Math.sin(thYou), by = pivY + R0.L * scale * Math.cos(thYou);
    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(cx, pivY); ctx.lineTo(bx, by); ctx.stroke();
    ctx.restore();
    if (typeof drawShadow === "function" && lowY + 14 < h) {
      drawShadow(ctx, bx, lowY + 12, bob * 1.8, 0.28);
    }
    dgSphere(ctx, P, bx, by, bob, P.ink, P.navy);
    if (bob > 9) {
      // three finger holes, turning with the ball so it is plainly a bowling ball
      ctx.save();
      ctx.fillStyle = P.paper; ctx.globalAlpha = 0.75;
      for (let i = 0; i < 3; i++) {
        const a0 = thYou + (i - 1) * 0.45 - 0.9;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(a0) * bob * 0.42, by + Math.sin(a0) * bob * 0.42,
          Math.max(bob * 0.13, 1), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // the shove, if their number needs one
    if (A && A.tune.shoved && A.t < 0.5 && bob > 5) {
      const k = 1 - A.t / 0.5;
      dgArrow(ctx, noseX + bob * 3.2, noseY - bob * 0.2, noseX + bob * 1.5, noseY - bob * 0.2,
        P.crimson, 1.4 + k);
      dgText(ctx, noseX + bob * 3.6, noseY - bob * 1.3,
        "shove " + dgFmt(A.tune.vR, 2) + " m/s", P.crimson, 10, "left");
    }

    // the impact
    if (A && A.you.struck) {
      ctx.save();
      ctx.strokeStyle = P.crimson; ctx.lineWidth = 1.8;
      for (let i = 0; i < 7; i++) {
        const a0 = (i / 7) * TAU;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a0) * bob * 1.25, by + Math.sin(a0) * bob * 1.25);
        ctx.lineTo(bx + Math.cos(a0) * bob * 1.95, by + Math.sin(a0) * bob * 1.95);
        ctx.stroke();
      }
      ctx.restore();
    }

    // the height ruler on the left: the nose, and where the ball got to
    const rulX = Math.max(cx - R0.L * scale * 1.02 - 26, 16);
    if (rulX > 12 && lowY - pivY > 40) {
      ctx.save();
      ctx.strokeStyle = P.rule; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(rulX, lowY); ctx.lineTo(rulX, pivY + R0.L * scale * Math.cos(spanTh)); ctx.stroke();
      ctx.restore();
      const yOf = (hh) => lowY - hh * scale;
      ctx.save();
      ctx.strokeStyle = P.brass; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(rulX - 6, yOf(R0.h0)); ctx.lineTo(rulX + 8, yOf(R0.h0)); ctx.stroke();
      ctx.restore();
      /* The release height IS the answer on the first rung, and one multiply
         from it on the second, so the tick is drawn and the number is not until
         the reader has committed. */
      dgText(ctx, rulX + 12, yOf(R0.h0) - 8,
        graded ? "nose  " + dgFmt(R0.h0 * 100, 1) + " cm" : "nose", P.brass, 9.5, "left");

      if (res && !res.blank) {
        const hy = dgBallHeightAt(R0, Math.abs(thYou));
        const stopped = A ? A.you.stopped : true;
        const hMark = stopped ? dgBallHeightAt(R0, A ? Math.abs(A.you.th) : R0.th0) : hy;
        ctx.save();
        ctx.strokeStyle = res.correct ? P.forest : P.crimson; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(rulX - 6, yOf(hMark)); ctx.lineTo(rulX + 8, yOf(hMark)); ctx.stroke();
        ctx.restore();
        if (Math.abs(yOf(hMark) - yOf(R0.h0)) > 9) {
          dgArrow(ctx, rulX + 2, yOf(R0.h0), rulX + 2, yOf(hMark), res.correct ? P.forest : P.crimson, 1.4);
          dgText(ctx, rulX + 12, (yOf(hMark) + yOf(R0.h0)) / 2 + 8,
            dgFmt((R0.h0 - hMark) * 100, 1) + " cm", res.correct ? P.forest : P.crimson, 9.5, "left");
        }
      }
    }

    const rows = [
      ["L / θ₀", dgFmt(R0.L, 2) + " m / " + dgFmt(R0.th0Deg, 1) + "°"],
      ["release height h₀", graded ? dgFmt(R0.h0 * 100, 1) + " cm" : "—"],
      ["mass (cancels)", dgFmt(R0.mass, 1) + " kg"],
    ];
    if (R0.tier > 0) rows.push(["loss per round trip", dgFmt(R0.k * 100, 0) + "%"]);
    if (R0.tier === 2) rows.push(["shove v₀", dgFmt(R0.v0, 2) + " m/s"]);
    if (graded) {
      rows.push(["your answer", dgFmt(res.guess, 2) + " cm"]);
      rows.push([R0.tier === 0 ? "true return" : "true clearance",
        dgFmt(R0.answer, 2) + " cm", res.correct ? P.forest : P.crimson]);
    }
    const pw = Math.min(206, w - 24);
    if (pw >= 60) dgPlate(ctx, P, w - pw - 12, 12, pw, rows);
    dgBench(ctx, P, w, h, "Ball at your nose");
  }


  /* ==========================================================================
     Newton's cradle — animation
     --------------------------------------------------------------------------
     The balls swing as real pendulums rather than sliding sideways: the arc is
     the reason a cradle keeps time, and a horizontal slide would make the
     collision look like a queue shuffling rather than a swing arriving.
     ========================================================================== */

  // Swing amplitude a ball reaches from a speed at the bottom. Clamped because
  // a wild answer would otherwise ask for an angle past the horizontal, which
  // a string cannot deliver -- it would go slack first.
  function dgCradleAmp(v, g, L) {
    return Math.acos(dgClamp(1 - (v * v) / (2 * g * L), -1, 1));
  }

  // A bob released at the BOTTOM with a signed speed. Sign carries the
  // direction, which on tier 1 is the whole question -- m1 comes back when it
  // is the lighter ball.
  function dgCradleBob(v, g, L) {
    return { th: 0, om: v / L, amp: dgCradleAmp(Math.abs(v), g, L), sign: v < 0 ? -1 : 1 };
  }

  function dgCradlePlay(R0, res) {
    const k = R0.g / R0.L;

    if (R0.tier === 0) {
      const guess = res && Number.isFinite(res.guess) ? Math.round(res.guess) : null;
      return {
        kind: "cradle", tier: 0, t: 0, hold: 0, done: false, k,
        // The struck side is what the reader predicted; the real cradle is
        // drawn doing what it does, and their count is marked on top of it, so
        // a wrong prediction sits over balls that never move.
        youK: guess, trueK: R0.k,
        s: { th: R0.th, om: 0 }, side: -1, cycles: 0,
      };
    }

    // Tiers 1 and 2 run on the READER'S numbers, with the truth as a ghost, so
    // a wrong answer is a visibly wrong swing height rather than a wrong label.
    const stick = R0.tier === 2;
    const yourV2 = res && Number.isFinite(res.guess) ? res.guess : 0;
    const yourV1 = stick ? yourV2 : (res && Number.isFinite(res.guessV1) ? res.guessV1 : 0);
    const trueV1 = stick ? R0.vc : R0.v1f;
    const trueV2 = stick ? R0.vc : R0.v2f;

    return {
      kind: "cradle", tier: R0.tier, t: 0, hold: 0, done: false, k, stick,
      phase: "in",
      // the approach: m1 falls from its lift angle to the bottom
      inS: { th: R0.th, om: 0 },
      you1: null, you2: null, gh1: null, gh2: null,
      yourV1, yourV2, trueV1, trueV2,
    };
  }

  function dgCradleStep(A, R0, dt) {
    if (A.done) return false;
    const sub = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / sub;

    if (A.tier === 0) {
      for (let i = 0; i < sub; i++) {
        dgPendStep(A.s, A.k, 0.02, h);
        // A swing that carries through the bottom hands the motion to the far
        // side, which is what the balls in between actually do.
        if (A.side < 0 && A.s.th <= 0) { A.side = 1; A.s.th = -A.s.th; A.s.om = -A.s.om; A.cycles++; }
        else if (A.side > 0 && A.s.th <= 0) { A.side = -1; A.s.th = -A.s.th; A.s.om = -A.s.om; A.cycles++; }
      }
      A.t += dt;
      if (A.cycles >= 6 || A.t > 12) { A.hold += dt; if (A.hold > 1.2) { A.done = true; return false; } }
      return true;
    }

    if (A.phase === "in") {
      for (let i = 0; i < sub; i++) {
        dgPendStep(A.inS, A.k, 0, h);
        if (A.inS.th <= 0) {
          // contact: hand each ball the speed the reader's answer gives it
          A.phase = "out";
          A.you1 = dgCradleBob(A.yourV1, R0.g, R0.L);
          A.you2 = dgCradleBob(A.yourV2, R0.g, R0.L);
          A.gh1 = dgCradleBob(A.trueV1, R0.g, R0.L);
          A.gh2 = dgCradleBob(A.trueV2, R0.g, R0.L);
          A.inS.th = 0; A.inS.om = 0;
          break;
        }
      }
      A.t += dt;
      return true;
    }

    for (let i = 0; i < sub; i++) {
      [A.you1, A.you2, A.gh1, A.gh2].forEach((b) => { if (b) dgPendStep(b, A.k, 0.05, h); });
    }
    A.t += dt;
    if (A.t > 7.5) { A.hold += dt; if (A.hold > 1.4) { A.done = true; return false; } }
    return true;
  }

  function dgCradleDraw(ctx, w, h, P, R0, res, A) {
    const posed = !res;
    const n = R0.tier === 0 ? R0.n : 2;
    const frameY = h * 0.16;
    const gap = Math.min(w / (n + 3.2), h * 0.13);
    const rad = Math.max(gap * 0.46, 2.4);
    const Lpx = Math.min(h * 0.52, h - frameY - rad - 26);
    const cx = w / 2;
    const x0 = cx - ((n - 1) / 2) * gap;

    // the frame the strings hang from
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x0 - gap * 1.1, frameY); ctx.lineTo(x0 + (n - 1) * gap + gap * 1.1, frameY);
    ctx.stroke();
    ctx.restore();

    // Angle carried by each ball this frame. A ball not swinging hangs plumb,
    // and hanging plumb means TOUCHING its neighbours -- a cradle with gaps in
    // it is a cradle that cannot transmit anything.
    const angles = new Array(n).fill(0);
    if (R0.tier === 0) {
      const th = A ? A.s.th : (posed ? R0.th : R0.th);
      const side = A ? A.side : -1;
      const kk = R0.k;
      for (let i = 0; i < n; i++) {
        if (side < 0 && i < kk) angles[i] = -Math.abs(th);
        else if (side > 0 && i >= n - kk) angles[i] = Math.abs(th);
      }
    } else if (A && A.phase === "out") {
      angles[0] = A.you1.sign * Math.abs(A.you1.th);
      angles[1] = A.you2.sign * Math.abs(A.you2.th);
    } else {
      angles[0] = -(A ? Math.abs(A.inS.th) : R0.th);
    }

    const bob = (i, ang) => ({
      px: x0 + i * gap + Lpx * Math.sin(ang),
      py: frameY + Lpx * Math.cos(ang),
    });

    // the truth, drawn faintly behind, on the tiers where a number was given
    if (A && A.phase === "out" && R0.tier > 0) {
      ctx.save(); ctx.globalAlpha = 0.28;
      [[0, A.gh1], [1, A.gh2]].forEach(([i, b]) => {
        const q = bob(i, b.sign * Math.abs(b.th));
        ctx.strokeStyle = P.inkSoft; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0 + i * gap, frameY); ctx.lineTo(q.px, q.py); ctx.stroke();
        ctx.beginPath(); ctx.arc(q.px, q.py, rad, 0, TAU); ctx.stroke();
      });
      ctx.restore();
    }

    for (let i = 0; i < n; i++) {
      const q = bob(i, angles[i]);
      ctx.save();
      ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0 + i * gap, frameY); ctx.lineTo(q.px, q.py); ctx.stroke();
      ctx.restore();
      const heavy = R0.tier > 0 && ((i === 0 && R0.m1 > R0.m2) || (i === 1 && R0.m2 > R0.m1));
      dgSphere(ctx, P, q.px, q.py, rad * (heavy ? 1.16 : 1), P.ink, R0.tier === 2 && i === 1 ? P.brass : P.panel);
      if (R0.tier > 0 && rad > 7) {
        dgText(ctx, q.px, q.py, i === 0 ? "1" : "2", P.paper, Math.min(rad, 10), "center", 700);
      }
    }

    // What the reader said would happen, marked on the balls they named.
    if (R0.tier === 0 && res && Number.isFinite(res.guess) && rad > 3) {
      const kk = dgClamp(Math.round(res.guess), 0, n);
      ctx.save();
      ctx.strokeStyle = res.correct ? P.forest : P.crimson; ctx.lineWidth = 1.6;
      for (let i = n - kk; i < n; i++) {
        const bx = x0 + i * gap;
        ctx.beginPath();
        ctx.moveTo(bx - rad * 0.6, frameY + Lpx + rad * 1.9);
        ctx.lineTo(bx, frameY + Lpx + rad * 1.35);
        ctx.lineTo(bx + rad * 0.6, frameY + Lpx + rad * 1.9);
        ctx.stroke();
      }
      ctx.restore();
      dgText(ctx, cx, frameY + Lpx + rad * 2.9, "you said " + kk,
             res.correct ? P.forest : P.crimson, Math.min(11, gap * 0.42), "center", 600);
    }

    // the ledger -- momentum alone permits several answers, energy picks one
    const rows = [];
    if (R0.tier === 0) {
      rows.push(["balls lifted", String(R0.k)]);
      rows.push(["momentum in", dgFmt(R0.p, 3) + " kg m/s"]);
      rows.push(["energy in", dgFmt(R0.KE, 4) + " J"]);
      if (res) rows.push(["balls out", String(R0.k), res.correct ? P.forest : P.crimson]);
    } else {
      rows.push(["m\u2081 / m\u2082", dgFmt(R0.m1, 2) + " / " + dgFmt(R0.m2, 2) + " kg"]);
      rows.push(["v\u2081 in", dgFmt(R0.v1, 2) + " m/s"]);
      if (res) {
        if (R0.tier === 1) {
          rows.push(["your v\u2081'", dgFmt(res.guessV1, 3) + " m/s"]);
          rows.push(["your v\u2082'", dgFmt(res.guess, 3) + " m/s"]);
          rows.push(["true", dgFmt(R0.v1f, 3) + " / " + dgFmt(R0.v2f, 3), P.forest]);
        } else {
          rows.push(["your v", dgFmt(res.guess, 3) + " m/s"]);
          rows.push(["true v", dgFmt(R0.vc, 3) + " m/s", P.forest]);
          rows.push(["KE lost", dgFmt(R0.keLost, 4) + " J", P.brass]);
        }
      }
    }
    const pw = Math.min(w * 0.32, 196);
    if (pw >= 60) dgPlate(ctx, P, w - pw - 12, 12, pw, rows);
    if (w >= 820 && h > 140) dgTag(ctx, P, 12, h - 34, "Newton's cradle");
  }

  /* ==========================================================================
     Rotating space station — animation
     --------------------------------------------------------------------------
     The ring turns at the rate the READER'S answer implies. Real stations turn
     once a minute or slower, so the display is scaled to put the CORRECT rate
     at one turn every five seconds; a reader whose answer is twice the truth
     therefore sees a ring going round twice as fast, which is the comparison
     that matters rather than the absolute rate.
     ========================================================================== */

  function dgStationPlay(R0, res) {
    const omTrue = R0.om || Math.sqrt(R0.aT / Math.max(R0.r, 1));
    const omYours = res && Number.isFinite(res.omTheirs) && res.omTheirs > 0
      ? res.omTheirs : omTrue;
    const disp = (TAU / 5) / Math.max(omTrue, 1e-9);
    return {
      kind: "station", t: 0, hold: 0, done: false,
      phi: 0, phiTrue: 0,
      omYours, omTrue,
      // Cap the drawn rate: an answer a thousand times too fast would otherwise
      // alias into a ring that appears to stand still, which reads as correct.
      rateYours: dgClamp(omYours * disp, -TAU * 1.6, TAU * 1.6),
      rateTrue: omTrue * disp,
      scaleG: res && Number.isFinite(res.scaleG) ? res.scaleG : 1,
      drop: null,
    };
  }

  function dgStationStep(A, R0, dt) {
    if (A.done) return false;
    A.t += dt;
    A.phi += A.rateYours * dt;
    A.phiTrue += A.rateTrue * dt;
    // Let go of a ball once the ring is turning, so its curve in the rotating
    // frame has something to be measured against.
    if (!A.drop && A.t > 1.4) A.drop = { t0: A.t };
    if (A.drop && A.t - A.drop.t0 > 3.4) A.drop = null;
    if (A.t > 11) { A.hold += dt; if (A.hold > 1.0) { A.done = true; return false; } }
    return true;
  }

  function dgStationDraw(ctx, w, h, P, R0, res, A) {
    const cx = w * 0.40, cy = h * 0.53;
    const Rpx = Math.min(w * 0.32, h * 0.40);
    if (!(Rpx > 8)) return;
    const phi = A ? A.phi : 0;
    const scaleG = A ? A.scaleG : 1;

    // the ring: hull outside, deck inside
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = Math.max(Rpx * 0.16, 3);
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(cx, cy, Rpx, 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, Rpx, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, Rpx * 0.86, 0, TAU); ctx.stroke();
    ctx.restore();

    // spokes, so the rotation is legible at all
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
      const a = phi + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Rpx * 0.86 * Math.cos(a), cy + Rpx * 0.86 * Math.sin(a));
      ctx.stroke();
    }
    ctx.restore();

    // the inhabitant, feet on the inside of the rim, head toward the centre
    const fx = cx + Rpx * 0.86 * Math.cos(phi);
    const fy = cy + Rpx * 0.86 * Math.sin(phi);
    // A floor that pushes too weakly does not hold anyone down: the gap is the
    // reader's error, drawn, rather than reported.
    const lift = dgClamp((1 - scaleG) * Rpx * 0.30, -Rpx * 0.05, Rpx * 0.26);
    const inx = -Math.cos(phi), iny = -Math.sin(phi);
    const px = fx + inx * lift, py = fy + iny * lift;
    const bodyLen = Rpx * 0.20;
    ctx.save();
    ctx.strokeStyle = scaleG > 0.85 && scaleG < 1.15 ? P.forest : P.crimson;
    ctx.lineWidth = Math.max(bodyLen * 0.16, 1.4);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + inx * bodyLen, py + iny * bodyLen);
    ctx.stroke();
    ctx.restore();
    dgSphere(ctx, P, px + inx * bodyLen * 1.28, py + iny * bodyLen * 1.28,
             Math.max(bodyLen * 0.26, 1.6), P.ink, P.panel);

    /* The ball let go from the rim, traced in the frame the inhabitant lives in.
       Two things this has to get right and both are easy to get wrong:

       The curve CO-ROTATES. Its points are found in the ring's frame, so they
       must then be carried round by the ring's CURRENT orientation. Pinning
       them to the orientation at release freezes the curve on a stage where
       the ring is visibly turning, and the ball appears to drift off the floor
       it was resting on.

       And it stops at the hull. In the inertial frame the ball travels a
       straight line, so it meets the outer wall after rotating through only
       arccos(r0/R_hull)-ish -- well under one turn. Drawing the whole 3.4 s
       of flight sends it several ring radii into open space, which is not
       where anybody let go of anything. */
    if (A && A.drop) {
      const tt = A.t - A.drop.t0;
      const om = A.rateYours || 1e-9;
      const r0 = Rpx * 0.86;
      const rHull = Rpx;
      ctx.save();
      ctx.strokeStyle = P.brass; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      let started = false;
      for (let s = 0; s <= tt; s += 0.03) {
        // straight line in the inertial frame: it keeps the speed it had
        const ix = r0, iy = om * r0 * s;
        if (Math.hypot(ix, iy) > rHull) break;      // reached the outer wall
        // into the ring's frame, then round with the ring as it is NOW
        const a = phi - om * s;
        const X = cx + ix * Math.cos(a) - iy * Math.sin(a);
        const Y = cy + ix * Math.sin(a) + iy * Math.cos(a);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      if (started) ctx.stroke();
      ctx.restore();
    }

    // the scale under their feet, which is the instrument being predicted
    const gaugeX = Math.min(w - 96, cx + Rpx + 30);
    const gaugeY = cy - 34;
    if (gaugeX + 84 < w && h > 150) {
      ctx.save();
      ctx.strokeStyle = P.rule; ctx.lineWidth = 1;
      dgRoundRect(ctx, gaugeX, gaugeY, 84, 46, 3); ctx.stroke();
      ctx.restore();
      const reads = dgClamp(scaleG, 0, 9.99);
      dgText(ctx, gaugeX + 42, gaugeY + 15, "scale reads", P.inkSoft, 9, "center", 400);
      dgText(ctx, gaugeX + 42, gaugeY + 31, dgFmt(reads, 2) + " g",
             reads > 0.85 && reads < 1.15 ? P.forest : P.crimson, 15, "center", 700);
    }

    // On the rungs that ASK for the radius ("Comfortable rotation", and the
    // rmin variant of the hard rung) the ring's radius is the answer, so the
    // plate cannot state it until the reader has committed to one.
    const radiusIsTheAnswer = R0.answerKey === "radius" || R0.answerKey === "rmin";
    const rows = [
      ["ring radius", radiusIsTheAnswer && !res ? "— work it out" : dgFmt(R0.r, 0) + " m"],
      ["wanted", dgFmt(R0.tgt ? R0.tgt.f : 1, 2) + " g"],
    ];
    if (res) {
      rows.push(["your \u03c9", dgFmt(res.omTheirs, 4) + " rad/s"]);
      rows.push(["true \u03c9", dgFmt(R0.om, 4) + " rad/s", P.forest]);
      rows.push(["rim delivers", dgFmt(res.scaleG, 2) + " g",
                 res.correct ? P.forest : P.crimson]);
    }
    const pw = Math.min(w * 0.30, 190);
    if (pw >= 60) dgPlate(ctx, P, 12, 12, pw, rows);
    if (w >= 820 && h > 140) dgTag(ctx, P, 12, h - 34, "Rotating space station");
  }

  /* ==========================================================================
     module contract
     ========================================================================== */

  // round/view/result/anim are already declared at the top of the module; only
  // the reader's own answers need somewhere to live, so Replay can rebuild the
  // reveal from what THEY said rather than from the correct value.
  let lastAnswers = null;

  const DG_MAKE = {
    "spool-and-thread": [dgSpoolMake, dgSpoolView, dgSpoolGrade, dgSpoolPlay, dgSpoolStep, dgSpoolDraw],
    "tablecloth-pull": [dgClothMake, dgClothView, dgClothGrade, dgClothPlay, dgClothStep, dgClothDraw],
    "bowling-ball-nose": [dgBallMake, dgBallView, dgBallGrade, dgBallPlay, dgBallStep, dgBallDraw],
    "newtons-cradle": [dgCradleMake, dgCradleView, dgCradleGrade, dgCradlePlay, dgCradleStep, dgCradleDraw],
    "rotating-space-station": [dgStationMake, dgStationView, dgStationGrade, dgStationPlay, dgStationStep, dgStationDraw],
  };

  function reset() {
    round = null; view = null; result = null; anim = null; lastAnswers = null;
    dgClearFits();
  }

  function start(id, difficulty) {
    const set = DG_MAKE[id];
    if (!set) return null;
    reset();
    round = set[0](dgTier(id, difficulty));
    view = set[1](round);
    return view;
  }

  function submit(answers) {
    if (!round) {
      return {
        correct: false, blank: true,
        verdict: { kind: "miss", text: "No round in progress" },
        feedback: "Start a round first.", misconception: null,
        solution: [], exact: {}, tolerance: {},
      };
    }
    lastAnswers = answers;
    result = DG_MAKE[round.gameId][2](round, answers);
    // A blank field is not a wrong answer: nothing is released and the reader
    // keeps the round.
    anim = result.blank ? null : DG_MAKE[round.gameId][3](round, result);
    return result;
  }

  // Idempotent: the host calls this again on every Replay press, and a replay
  // must show what the READER said, not a fresh correct run.
  function play() {
    if (!round || !result || result.blank) return false;
    anim = DG_MAKE[round.gameId][3](round, result);
    return true;
  }

  function tick(dt) {
    if (!anim || anim.done || !round) return false;
    const step = dgClamp(Number(dt) || 0, 0, 0.05);
    if (step <= 0) return true;
    return DG_MAKE[round.gameId][4](anim, round, step);
  }

  function animating() { return !!anim && !anim.done; }

  function draw(ctx, w, h) {
    if (!ctx) return;
    const width = Math.max(Number(w) || 0, 1);
    const height = Math.max(Number(h) || 0, 1);
    const P = dgPal();
    if (!P) return;
    if (!(width > 12 && height > 12)) return;
    ctx.save();
    try {
      if (!round) dgDrawEmpty(ctx, width, height, P);
      else DG_MAKE[round.gameId][5](ctx, width, height, P, round, result && !result.blank ? result : null, anim);
    } finally {
      // A renderer that threw mid-path would otherwise leave a clip or a
      // transform behind for whatever draws next.
      ctx.restore();
    }
  }

  return {
    list: () => DG_CATALOGUE.map((g) => ({ id: g.id, name: g.name, blurb: g.blurb, group: g.group })),
    difficulties: (gameId) => (DG_LADDERS[gameId] || DG_LADDERS["spool-and-thread"]).slice(),
    start,
    round: () => view,
    submit,
    play,
    tick,
    animating,
    draw,
    reset,
    phase: () => (!round ? "idle" : result && !result.blank ? "graded" : "posed"),
    result: () => result,
  };

})();
