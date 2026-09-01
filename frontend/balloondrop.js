/* ============================================================================
   BalloonDrop — the water-balloon timing bench
   ----------------------------------------------------------------------------
   A student stands at the END of a bridge deck holding a water balloon over
   the rail. Dr. Jloane walks in along the ground and the student must decide
   WHEN to let go. Nothing here is a reaction-time test: the release moment is
   computed, typed in, and only then played back, so what the animation shows
   is the consequence of the student's arithmetic and nothing else.

   The whole game is one equation read in the awkward direction. A student who
   has done "how long does it take to fall h?" a hundred times still has to
   notice that the balloon must be released while Dr. Jloane is still SHORT of
   the drop point by exactly the distance they will cover during the fall.

     level 1  x_J(t) = v t                    t_fall = sqrt(2h/g)
     level 2  x_J(t) = v0 t + ½ a t²          (the quadratic, first arrival)
     level 3  h = v0y t + ½ g t²              (thrown down, or lobbed up)

   Three commitments the obvious implementation gets wrong:

   * The release time is NOT solved as "release = arrival − fall" with the fall
     distance computed from the walking speed at release. Under acceleration
     that is simply false — the distance covered during the fall depends on
     WHEN the fall starts. We solve for the ARRIVAL time (walked distance =
     start distance) and subtract the fall time from it, which is exact at
     every level and needs no special case.

   * Rounds are generated backwards. Pick the height, the gait and a
     comfortable release time first, derive the start distance from those, then
     SNAP every given to a number a human would be told and re-solve from the
     snapped values. The student and the grader therefore work from bit-identical
     inputs, and no round can be unsolvable, absurd, or off by a rounding.

   * The height given is measured to the top of Dr. Jloane's HEAD, not to the
     road surface, because that is the h in h = ½gt² if the balloon is to hit
     them. Quoting a bridge-to-ground height and then grading a head strike
     would be teaching a wrong free-body sketch. On a MISS the balloon keeps
     going the extra 1.75 m and bursts on the tarmac, which is why the burst is
     visibly later than the near-miss.

   Draws with animate.js's vocabulary (PALETTE, drawArrow, drawLabel,
   sphereShade, drawGround, ...) so it reads as the same textbook plate as
   every other figure in the app. Load AFTER animate.js.
   ========================================================================== */

const BalloonDrop = (function () {
  "use strict";

  /* ---------------------------- host glue ----------------------------

     Everything below is borrowed from animate.js. It is aliased through
     `borrow()` rather than referenced directly because a top-level `const` in
     a classic script lives in the global LEXICAL scope, not on `window`: if
     this file were ever moved above animate.js in index.html, a bare mention
     of PALETTE would throw a temporal-dead-zone ReferenceError at load and
     take the whole page down with it. A try/catch turns that into a fallback.
     The fallbacks are deliberately minimal — they exist so the module can be
     unit-driven in isolation, not so it can look good without animate.js. */

  function borrow(get, fallback) {
    try {
      const v = get();
      return v === undefined || v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // Aliased by REFERENCE, not copied: refreshPalette() mutates the same object
  // in place on a theme switch, so this alias stays current for free.
  const PAL = borrow(() => PALETTE, {
    ink: "#e8e6e1", inkSoft: "#a4a8ad", paper: "#10151a", panel: "#1b2026",
    rule: "#3d4751", crimson: "#d2504a", navy: "#5b9dd9", brass: "#c9a227",
    forest: "#6aa87a", shadow: "#2c343d",
  });
  const FONT = borrow(() => FONT_LABEL, '"IBM Plex Mono", Consolas, monospace');

  const cl = borrow(() => clamp, (v, lo, hi) => Math.max(lo, Math.min(hi, v)));
  const mix = borrow(() => lerp, (a, b, f) => a + (b - a) * f);
  const eOut = borrow(() => easeOut, (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3));
  const num = borrow(() => fmt, (n, d = 2) => (n === undefined || n === null || isNaN(n) ? "—" : n.toFixed(d)));

  const arrow = borrow(() => drawArrow, (ctx, x1, y1, x2, y2, c, wd = 2) => {
    ctx.strokeStyle = c; ctx.lineWidth = wd;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });
  const dashed = borrow(() => drawDashedLine, (ctx, x1, y1, x2, y2, c, wd = 1, d = [4, 4]) => {
    ctx.save(); ctx.setLineDash(d); ctx.strokeStyle = c; ctx.lineWidth = wd;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  });
  const label = borrow(() => drawLabel, (ctx, x, y, text, c, size = 12, align = "center") => {
    ctx.fillStyle = c; ctx.font = `500 ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(text, x, y);
  });
  const caption = borrow(() => drawCaption, (ctx, x, y, text, c, size = 11) => {
    ctx.fillStyle = c; ctx.font = `400 ${size}px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y);
  });
  const shadow = borrow(() => drawShadow, (ctx, x, y, wd, alpha = 0.5) => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = PAL.shadow || PAL.rule;
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(wd / 2, 2), Math.max(wd / 7, 1.5), 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  });
  const sphere = borrow(() => sphereShade, (ctx, x, y, r, sc, fc) => {
    ctx.beginPath(); ctx.arc(x, y, Math.max(r, 0.1), 0, Math.PI * 2);
    ctx.fillStyle = fc || PAL.panel; ctx.fill();
    ctx.strokeStyle = sc || PAL.ink; ctx.lineWidth = 2; ctx.stroke();
  });
  const ground = borrow(() => drawGround, (ctx, w, h, y) => {
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(w * 0.05, y); ctx.lineTo(w * 0.95, y); ctx.stroke();
  });
  const plate = borrow(() => drawDataPlate, (ctx, x, y, wd, lines) => {
    ctx.fillStyle = PAL.panel; ctx.fillRect(x, y, wd, 12 + lines.length * 15);
    ctx.strokeStyle = PAL.rule; ctx.strokeRect(x, y, wd, 12 + lines.length * 15);
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = `400 11px ${FONT}`;
    lines.forEach((ln, i) => { ctx.fillStyle = PAL.ink; ctx.fillText(ln, x + 8, y + 10 + i * 15); });
    return 12 + lines.length * 15;
  });
  const rrect = borrow(() => roundRect, (ctx, x, y, wd, ht, r) => {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + wd, y, x + wd, y + ht, r); ctx.arcTo(x + wd, y + ht, x, y + ht, r);
    ctx.arcTo(x, y + ht, x, y, r); ctx.arcTo(x, y, x + wd, y, r); ctx.closePath();
  });

  // g belongs to the backend (see scenarios.js). Read it at CALL time, never
  // at load time: this file may be evaluated before /api/config has landed,
  // and a captured 9.8 would quietly outlive the real value.
  function gravity() {
    const g = borrow(() => GRAVITY, 9.8);
    return typeof g === "number" && Number.isFinite(g) && g > 0 ? g : 9.8;
  }

  // Canvas throws IndexSizeError on a negative radius, and a 1x1 canvas makes
  // every derived radius negative. One choke point beats forty guards.
  function R(v) { return Number.isFinite(v) && v > 0.05 ? v : 0.05; }

  /* ---------------------------- constants ---------------------------- */

  const TARGET_HEIGHT = 1.75;   // Dr. Jloane, heel to crown, in metres
  const TOLERANCE = 0.25;       // a head is ~0.2 m across; ±0.25 m is a graze
  const MAX_DT = 1 / 120;       // sub-step ceiling, see tick()

  const LEVELS = [
    { id: 1, name: "Constant velocity", blurb: "Dr. Jloane walks at a steady pace." },
    { id: 2, name: "Constant acceleration", blurb: "Dr. Jloane speeds up or slows down at a stated rate." },
    { id: 3, name: "Thrown balloon", blurb: "The balloon leaves your hand already moving." },
  ];

  /* ---------------------------- kinematics ----------------------------

     Two functions carry the entire physics of the game. Everything else --
     grading, round generation, the animation clock -- is phrased in terms of
     them, so there is exactly one place where the mechanics could be wrong. */

  // Time for the balloon to fall `h` metres given an initial DOWNWARD speed
  // v0y (negative = lobbed upwards):  h = v0y t + ½ g t².
  // The negative root is the time the balloon would have left the ground
  // travelling upwards to arrive here — real algebra, imaginary balloon.
  function fallTime(h, v0y, g) {
    const disc = v0y * v0y + 2 * g * h;
    if (!(disc >= 0)) return NaN;
    return (-v0y + Math.sqrt(disc)) / g;
  }

  // Distance Dr. Jloane has covered by time t. Negative t extrapolates
  // backwards, which is legitimate — they were walking before the clock
  // started — but the deceleration stop is only clamped FORWARDS: someone who
  // will coast to a halt at t=9 s was not stationary at t=−2 s.
  function walkDist(r, t) {
    const v = r.walkSpeed, a = r.accel || 0;
    if (!Number.isFinite(t)) return NaN;
    if (a === 0) return v * t;
    const tStop = a < 0 ? -v / a : Infinity;
    const tc = t > tStop ? tStop : t;
    return v * tc + 0.5 * a * tc * tc;
  }

  // Instantaneous walking speed, with the same forward-only stop.
  function walkSpeedAt(r, t) {
    const v = r.walkSpeed, a = r.accel || 0;
    if (a === 0) return v;
    const tStop = a < 0 ? -v / a : Infinity;
    return t > tStop ? 0 : v + a * t;
  }

  // Solve walkDist(t) = d for t. With a ≠ 0 this is the quadratic the level-2
  // student has to solve, and picking the root is the part they get wrong:
  //
  //   a > 0 : one root is positive and one negative — take the positive.
  //   a < 0 : BOTH roots are positive. The larger one is the walker turning
  //           round and coming back past the same point, which is not what
  //           anybody does on a bridge approach. The FIRST arrival is the
  //           smaller root, and it is the only one before the coast-to-a-halt.
  //
  // `signed` allows the negative root through, which grading needs: a student
  // who releases before the clock starts still deserves a measured miss rather
  // than a NaN.
  function arrivalTime(r, d, signed) {
    const v = r.walkSpeed, a = r.accel || 0;
    if (!Number.isFinite(d)) return NaN;
    if (a === 0) return v > 0 ? d / v : NaN;
    const disc = v * v + 2 * a * d;
    if (!(disc >= 0)) return NaN;
    const root = Math.sqrt(disc);
    const t1 = (-v + root) / a;
    const t2 = (-v - root) / a;
    const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
    if (signed) {
      // Nearest-to-zero-from-the-correct-side: for a target behind the walker
      // the answer is genuinely negative, for one ahead it is positive.
      if (d >= 0) return lo >= -1e-9 ? lo : hi;
      return hi <= 1e-9 ? hi : lo;
    }
    if (lo >= -1e-9) return lo;
    if (hi >= -1e-9) return hi;
    return NaN;
  }

  /* ---------------------------- round generation ----------------------------

     Backwards, always. Choosing a start distance first and hoping the release
     time lands somewhere sane produces rounds demanding a 0.04 s reaction
     roughly one time in six. Choosing the release time first cannot. */

  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
  function snap(v, step) { return Math.round(v / step) * step; }
  function snapped(v, step) {
    // Binary floats make 0.1-steps like 12.300000000000001; the student is
    // shown a rounded string but the GRADER must use the same value they
    // typed arithmetic against, so normalise it here once.
    return Number(snap(v, step).toFixed(6));
  }
  function coin() { return Math.random() < 0.5 ? -1 : 1; }

  function attempt(level, g) {
    const h = snapped(rnd(8, 40), 0.5);              // fall to the crown of the head

    let throwSpeed = 0;
    if (level === 3) {
      // Positive = hurled downwards, negative = lobbed up first. The lob is
      // the interesting case: the balloon leaves upwards and STILL takes
      // longer than a drop, which is the whole point of the level.
      const mag = snapped(rnd(1, 8), 0.5);
      throwSpeed = Math.random() < 0.6 ? mag : -mag;
    }
    const tFall = fallTime(h, throwSpeed, g);
    if (!(tFall > 0.5 && tFall < 4.5)) return null;

    let walkSpeed, accel = 0;
    if (level === 2) {
      // Leave headroom at both ends so the speed stays inside walking range
      // for the whole approach rather than only at t = 0.
      walkSpeed = snapped(rnd(0.9, 2.1), 0.1);
      accel = snapped(rnd(0.05, 0.3), 0.05) * coin();
    } else {
      walkSpeed = snapped(rnd(0.8, 2.5), 0.1);
    }
    if (!(walkSpeed >= 0.8 && walkSpeed <= 2.5)) return null;

    const wantRelease = rnd(1.6, 5.5);               // comfortable thinking time
    const r0 = { walkSpeed, accel };
    let startDistance = snapped(walkDist(r0, wantRelease + tFall), 0.1);
    if (!(startDistance >= 3 && startDistance <= 42)) return null;

    // Re-solve from the SNAPPED givens. Everything from here on is derived
    // from exactly the numbers the student will be shown.
    const r = { walkSpeed, accel, startDistance, bridgeHeight: h, throwSpeed };
    const arriveT = arrivalTime(r, startDistance, false);
    if (!Number.isFinite(arriveT) || arriveT <= 0) return null;

    const exactTime = arriveT - tFall;
    if (!(exactTime >= 1.2 && exactTime <= 8)) return null;

    // The approach must stay a WALK from the first step to the last. This also
    // guarantees a decelerating Dr. Jloane never coasts to a halt short of the
    // drop point, which would make the round unsolvable.
    const vEnd = walkSpeed + accel * arriveT;
    if (!(vEnd >= 0.6 && vEnd <= 3.2)) return null;

    const exactDistance = startDistance - walkDist(r, exactTime);
    if (!(exactDistance >= 0.8 && exactDistance < startDistance)) return null;

    r.gravity = g;
    r.level = level;
    r.fallTime = tFall;
    r.arrivalTime = arriveT;
    r.exactTime = exactTime;
    r.exactDistance = exactDistance;
    r.targetHeight = TARGET_HEIGHT;
    r.tolerance = TOLERANCE;
    // Total drop if nobody is standing there: the extra 1.75 m to the tarmac.
    r.groundFallTime = fallTime(h + TARGET_HEIGHT, throwSpeed, g);
    return r;
  }

  function makeRound(level, g) {
    for (let i = 0; i < 500; i++) {
      const r = attempt(level, g);
      if (r) return r;
    }
    // Unreachable in practice (measured: level 2 is the fussiest and still
    // succeeds inside ~4 draws), but a minigame that can return null is a
    // minigame that will one day return null in front of a class.
    const safe = { 1: { h: 20, v: 1.4, a: 0, tv: 0 }, 2: { h: 20, v: 1.4, a: 0.1, tv: 0 }, 3: { h: 20, v: 1.4, a: 0, tv: 3 } }[level] || { h: 20, v: 1.4, a: 0, tv: 0 };
    const tFall = fallTime(safe.h, safe.tv, g);
    const r = {
      level, walkSpeed: safe.v, accel: safe.a, bridgeHeight: safe.h, throwSpeed: safe.tv,
      startDistance: snapped(walkDist({ walkSpeed: safe.v, accel: safe.a }, 3 + tFall), 0.1),
      gravity: g, fallTime: tFall, targetHeight: TARGET_HEIGHT, tolerance: TOLERANCE,
    };
    r.arrivalTime = arrivalTime(r, r.startDistance, false);
    r.exactTime = r.arrivalTime - tFall;
    r.exactDistance = r.startDistance - walkDist(r, r.exactTime);
    r.groundFallTime = fallTime(safe.h + TARGET_HEIGHT, safe.tv, g);
    return r;
  }

  /* ---------------------------- wording ---------------------------- */

  function describeThrow(v) {
    if (v > 0) return `thrown straight down at ${num(Math.abs(v), 1)} m/s`;
    if (v < 0) return `lobbed straight up at ${num(Math.abs(v), 1)} m/s`;
    return "released from rest";
  }

  function buildPrompt(r) {
    const lines = [];
    lines.push(
      `You are at the end of the bridge deck with a water balloon over the rail, ` +
      `${num(r.bridgeHeight, 1)} m above the top of Dr. Jloane's head.`
    );
    if (r.level === 2) {
      lines.push(
        `Dr. Jloane is ${num(r.startDistance, 1)} m from the point directly below you, ` +
        `walking toward it at ${num(r.walkSpeed, 1)} m/s and ` +
        `${r.accel >= 0 ? "speeding up" : "slowing down"} at ${num(Math.abs(r.accel), 2)} m/s².`
      );
    } else {
      lines.push(
        `Dr. Jloane is ${num(r.startDistance, 1)} m from the point directly below you, ` +
        `walking toward it at a steady ${num(r.walkSpeed, 1)} m/s.`
      );
    }
    if (r.level === 3) {
      lines.push(`The balloon will not be dropped — it is ${describeThrow(r.throwSpeed)}.`);
    }
    lines.push(
      `Take g = ${num(r.gravity, 2)} m/s² and ignore air resistance. ` +
      `When do you let go? Give the release time in seconds from now, or ` +
      `Dr. Jloane's distance from the target at the instant you release.`
    );
    return lines.join(" ");
  }

  function buildGivens(r) {
    const rows = [
      ["Drop height to head, h", `${num(r.bridgeHeight, 1)} m`],
      ["Dr. Jloane's start distance, d₀", `${num(r.startDistance, 1)} m`],
      ["Walking speed, v₀", `${num(r.walkSpeed, 1)} m/s`],
    ];
    if (r.level === 2) rows.push(["Walking acceleration, a", `${num(r.accel, 2)} m/s²`]);
    // Magnitude plus a direction word. Printing the signed value AND the word
    // ("−7.5 m/s up") reads as two contradictory claims about the same arrow.
    if (r.level === 3) rows.push(["Balloon launch speed, v₀ᵧ", `${num(Math.abs(r.throwSpeed), 1)} m/s ${r.throwSpeed >= 0 ? "down" : "up"}`]);
    rows.push(["Gravity, g", `${num(r.gravity, 2)} m/s²`]);
    rows.push(["Dr. Jloane's height", `${num(r.targetHeight, 2)} m`]);
    return rows;
  }

  // The givens, and only the givens. Handing the host the object that also
  // carries `exactTime` would put the answer one console.log away.
  function publicRound(r) {
    if (!r) return null;
    return {
      level: r.level,
      bridgeHeight: r.bridgeHeight,
      walkSpeed: r.walkSpeed,
      startDistance: r.startDistance,
      accel: r.accel,
      throwSpeed: r.throwSpeed,
      gravity: r.gravity,
      targetHeight: r.targetHeight,
      tolerance: r.tolerance,
      prompt: r.prompt,
      givens: r.givens.map((row) => row.slice()),
      levelName: (LEVELS[r.level - 1] || LEVELS[0]).name,
    };
  }

  /* ---------------------------- state ---------------------------- */

  const S = {
    round: null,
    result: null,
    anim: null,
  };

  /* ---------------------------- grading ---------------------------- */

  function grade(value, mode) {
    const r = S.round;
    if (!r) {
      return {
        correct: false, exactTime: NaN, exactDistance: NaN, missBy: NaN,
        tolerance: TOLERANCE, feedback: "No round in play — call BalloonDrop.newRound(level) first.",
        error: "no-round",
      };
    }
    mode = mode === "distance" || mode === "dist" ? "distance" : "time";
    const v = typeof value === "string" ? Number(value.trim()) : Number(value);

    const base = {
      mode, submitted: v,
      exactTime: r.exactTime,
      exactDistance: r.exactDistance,
      fallTime: r.fallTime,
      arrivalTime: r.arrivalTime,
      tolerance: r.tolerance,
    };

    if (!Number.isFinite(v)) {
      return Object.assign({}, base, {
        correct: false, missBy: NaN, releaseTime: NaN,
        feedback: "That is not a number. Enter the release time in seconds, or the distance in metres.",
        error: "not-a-number",
      });
    }

    // Distance mode is the same answer wearing different units: "release when
    // Dr. Jloane is d from the target" means they have walked (d₀ − d).
    let releaseTime;
    let unreachable = false;
    if (mode === "distance") {
      releaseTime = arrivalTime(r, r.startDistance - v, true);
      if (!Number.isFinite(releaseTime)) {
        // Only possible for an accelerating walker asked about a point further
        // back than they ever were. Fall back to the vertex — the earliest
        // moment on that parabola — and say so rather than returning NaN.
        releaseTime = r.accel ? -r.walkSpeed / r.accel : 0;
        unreachable = true;
      }
    } else {
      releaseTime = v;
    }

    const landingTime = releaseTime + r.fallTime;
    // The signed gap that decides everything. Positive: Dr. Jloane is still
    // short of the drop point when the balloon arrives, so it lands in front
    // of them — released too early. Negative: they have already walked past.
    const missBy = r.startDistance - walkDist(r, landingTime);
    const timeError = r.exactTime - releaseTime;   // + = released early
    const correct = Number.isFinite(missBy) && Math.abs(missBy) <= r.tolerance;
    const speedAtLanding = walkSpeedAt(r, landingTime);

    const distAtRelease = r.startDistance - walkDist(r, releaseTime);
    const direction = correct ? "hit" : missBy > 0 ? "early" : "late";

    // A balloon lobbed upwards does not "fall for 3.2 s" — it is in the air
    // for 3.2 s, part of it going the other way. Level 3 gets the honest noun.
    const flightNoun = r.throwSpeed ? "flight" : "fall";

    let feedback;
    if (correct) {
      feedback =
        `Direct hit. Released at t = ${num(releaseTime, 2)} s with Dr. Jloane ` +
        `${num(distAtRelease, 2)} m short of the target; the balloon was in the air for ` +
        `${num(r.fallTime, 2)} s and they walked the last ${num(r.startDistance - walkDist(r, releaseTime) - missBy, 2)} m straight into it.`;
    } else {
      const early = missBy > 0;
      feedback =
        `Missed by ${num(Math.abs(missBy), 2)} m — the balloon came down ` +
        `${early ? "in front of" : "behind"} Dr. Jloane. You were ` +
        `${num(Math.abs(timeError), 2)} s too ${early ? "early" : "late"}. ` +
        `The ${flightNoun} takes ${num(r.fallTime, 2)} s, so release when Dr. Jloane is ` +
        `${num(r.exactDistance, 2)} m out — that is t = ${num(r.exactTime, 2)} s.`;
      if (unreachable) feedback = "Dr. Jloane is never that far from the target on this approach. " + feedback;
    }

    const result = Object.assign({}, base, {
      correct, missBy, releaseTime, landingTime, timeError,
      // "early" and "late" are the words the apparatus itself speaks in, so
      // the boxed verdict uses them rather than a generic over/under.
      verdict: correct
        ? { kind: "hit", text: "Direct hit" }
        : { kind: missBy > 0 ? "under" : "over",
            text: "Too " + (missBy > 0 ? "early" : "late") + " by "
              + num(Math.abs(timeError), 2) + " s" },
      distanceAtRelease: distAtRelease,
      speedAtLanding, direction, feedback,
      // The timing precision the ±0.25 m window actually corresponds to —
      // worth showing, because it is usually a comfortable tenth of a second.
      toleranceTime: speedAtLanding > 1e-6 ? r.tolerance / speedAtLanding : NaN,
    });
    if (unreachable) result.unreachable = true;
    S.result = result;
    return result;
  }

  /* ---------------------------- animation ----------------------------

     One simulation clock, `A.t`, in scenario seconds. Every position in the
     scene is a closed form of A.t, so the drawing cannot drift from the physics
     no matter how ragged the frame timing gets. The single exception is the
     gait phase, which is genuinely integrated (see tick) because stride length
     depends on the instantaneous speed. */

  function makeDroplets(count, spread, speedLo, speedHi) {
    const out = [];
    for (let i = 0; i < count; i++) {
      // Fan across the upper half, biased outwards: a burst throws sideways
      // far more than it throws straight up.
      const a = spread.lo + (spread.hi - spread.lo) * ((i + Math.random() * 0.7) / count);
      const sp = rnd(speedLo, speedHi);
      out.push({
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,            // world frame: +y is up
        r: rnd(0.02, 0.065),             // metres
        life: rnd(0.65, 1.35),
        spin: rnd(-6, 6),
      });
    }
    return out;
  }

  function startAnim(releaseTime, result) {
    const r = S.round;
    if (!r) return false;

    const hit = !!(result && result.correct);
    const landingTime = releaseTime + r.fallTime;        // crown-of-head crossing
    const burstTime = hit ? landingTime : releaseTime + r.groundFallTime;

    // Join the action shortly before the release. The clamp matters for a
    // student who typed 40 s: without it the scene is a minute of walking.
    let t0 = Math.min(0, releaseTime) - 0.6;
    if (releaseTime - t0 > 7) t0 = releaseTime - 7;

    S.anim = {
      t: t0,
      t0,
      releaseTime,
      landingTime,
      burstTime,
      endT: burstTime + 3.2,
      hit,
      missBy: result ? result.missBy : 0,
      // Dr. Jloane stops DEAD at the head-height crossing, startled. Easing
      // them to a halt over even a fifth of a second would move them a
      // quarter of a metre — the entire grading tolerance — and the gap drawn
      // on the ground would no longer be the gap that was graded.
      freezeAt: landingTime,
      gait: 0,
      droplets: hit
        ? makeDroplets(20, { lo: -0.15, hi: Math.PI + 0.15 }, 1.4, 4.6)
        : makeDroplets(24, { lo: 0.12, hi: Math.PI - 0.12 }, 1.8, 5.4),
      running: true,
      done: false,
    };
    return true;
  }

  // Dr. Jloane's distance from the drop point at scene time t, honouring the
  // freeze. Positive = still approaching, negative = walked past.
  function jloaneGap(t) {
    const r = S.round, A = S.anim;
    if (!r) return 0;
    const tt = A && t > A.freezeAt ? A.freezeAt : t;
    return r.startDistance - walkDist(r, tt);
  }

  // Balloon height above the ground, or null before release / after burst.
  function balloonY(t) {
    const r = S.round, A = S.anim;
    if (!r || !A) return null;
    if (t < A.releaseTime) return r.targetHeight + r.bridgeHeight;
    if (t > A.burstTime) return null;
    const tau = t - A.releaseTime;
    const drop = r.throwSpeed * tau + 0.5 * r.gravity * tau * tau;
    return r.targetHeight + r.bridgeHeight - drop;
  }

  // Stride length grows with pace — people lengthen their steps before they
  // quicken them — so a fast walk is not just the same loop played faster.
  function strideLength(speed) {
    return cl(0.95 + 0.42 * speed, 1.0, 1.95);
  }

  function tick(dt) {
    const A = S.anim, r = S.round;
    if (!A || !r || !A.running) return false;
    if (!Number.isFinite(dt) || dt <= 0) return true;

    // Sub-stepped so a 900 ms hitch (tab restore, a slow layout) integrates
    // the gait correctly instead of teleporting the feet. Frame COUNT never
    // enters into it: two 8 ms frames and one 16 ms frame give the same state.
    //
    // The gait phase is the ONE quantity here that is integrated rather than
    // evaluated -- stride length depends on the instantaneous pace, so the
    // phase is the integral of v/S(v) and has no useful closed form once v is
    // changing. Sampling the speed at the MIDPOINT of each sub-step makes the
    // walked-distance factor exact under constant acceleration (trapezoid on a
    // straight line), leaving only the second-order variation of S(v).
    let remaining = Math.min(dt, 1.0);
    while (remaining > 1e-9) {
      const step = Math.min(remaining, MAX_DT);
      remaining -= step;
      if (A.t < A.freezeAt) {
        const sp = Math.abs(walkSpeedAt(r, A.t + step / 2));
        A.gait += (2 * Math.PI * sp * step) / strideLength(sp);
      }
      A.t += step;
    }

    if (A.t >= A.endT) {
      A.t = A.endT;
      A.running = false;
      A.done = true;
      return false;
    }
    return true;
  }

  /* ---------------------------- the walking figure ----------------------------

     A gait, not a slide. Three things make it read as walking:

     * The hip is placed by the LEGS, not the other way round. Both ankles are
       solved from the hip angles, then the hip is dropped until the lower
       ankle sits on the road. The vertical bob then falls out for free, at
       twice the stride frequency and with the right phase (highest at
       mid-stance), because that is physically where it comes from.

     * The knee flexes hardest at mid-swing (cos φ peaking) and stays nearly
       straight through stance, which is what stops the legs looking like
       scissors.

     * The arms run a half-cycle out of phase with the legs on the same side.
       Get that backwards and the walk reads as a shuffle even though every
       limb is moving. */

  function drawWalker(ctx, footX, footY, H, o) {
    o = o || {};
    const face = o.facing || -1;
    const phase = o.phase || 0;
    const swing = o.swing === undefined ? 1 : cl(o.swing, 0, 1);
    const inkC = o.ink || PAL.ink;
    const coat = o.coat || PAL.panel;

    const Lt = 0.245 * H, Ls = 0.265 * H, Lf = 0.10 * H;
    const torso = 0.30 * H, Lu = 0.155 * H, La = 0.150 * H;
    const headR = 0.068 * H;

    const A = 0.34 * swing;          // hip swing amplitude
    const K = 0.85 * swing;          // peak knee flexion

    function legGeom(ph) {
      const th = A * Math.sin(ph);
      const kn = 0.05 + K * Math.pow(Math.max(0, Math.cos(ph)), 1.4);
      const kx = Lt * Math.sin(th), ky = Lt * Math.cos(th);
      const sa = th - kn;
      return { th, kn, kx, ky, ax: kx + Ls * Math.sin(sa), ay: ky + Ls * Math.cos(sa) };
    }

    const near = legGeom(phase);
    const far = legGeom(phase + Math.PI);
    // Whichever ankle is lowest is the one on the ground.
    const hipDrop = Math.max(near.ay, far.ay);

    ctx.save();
    ctx.translate(footX, footY - hipDrop);
    ctx.scale(face, 1);
    // Recoil pivots about the feet, so a startled lean does not slide the
    // figure sideways and corrupt the miss measurement drawn beneath them.
    if (o.lean) {
      ctx.translate(0, hipDrop);
      ctx.rotate(-o.lean);
      ctx.translate(0, -hipDrop);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const limbW = Math.max(1.2, H * 0.035);

    function drawLeg(L, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = inkC;
      ctx.lineWidth = limbW;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(L.kx, L.ky);
      ctx.lineTo(L.ax, L.ay);
      ctx.stroke();
      // Toe hangs while the foot is clear of the road and flattens on contact.
      const clearance = cl((hipDrop - L.ay) / Math.max(0.12 * H, 0.5), 0, 1);
      const fa = clearance * 0.6;
      ctx.lineWidth = limbW * 0.85;
      ctx.beginPath();
      ctx.moveTo(L.ax, L.ay);
      ctx.lineTo(L.ax + Lf * Math.cos(fa), L.ay + Lf * Math.sin(fa));
      ctx.stroke();
      ctx.restore();
    }

    function drawArm(ph, alpha) {
      const th = -0.30 * swing * Math.sin(ph);
      const bend = 0.28 + 0.34 * Math.max(0, Math.sin(ph));
      const sx = 0.045 * H, sy = -torso;
      const ex = sx + Lu * Math.sin(th), ey = sy + Lu * Math.cos(th);
      const hx = ex + La * Math.sin(th + bend), hy = ey + La * Math.cos(th + bend);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = inkC;
      ctx.lineWidth = limbW * 0.9;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = inkC;
      ctx.beginPath();
      ctx.arc(hx, hy, R(limbW * 0.55), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return { x: hx, y: hy };
    }

    // Far side first, dimmed, so the figure has depth in a flat ink style.
    drawLeg(far, 0.5);
    drawArm(phase + Math.PI, 0.5);

    // Lab coat: shoulders to just below the hip, flared, with a hem that
    // trails the stride. It is the fastest way to read "Dr." at 30 px tall.
    const shoulderW = 0.115 * H;
    const hemY = 0.11 * H;
    const hemSwing = 0.035 * H * Math.sin(phase) * swing;
    ctx.fillStyle = coat;
    ctx.strokeStyle = inkC;
    ctx.lineWidth = Math.max(1.1, H * 0.024);
    ctx.beginPath();
    ctx.moveTo(-shoulderW * 0.82, -torso);
    ctx.quadraticCurveTo(-shoulderW * 1.15, -torso * 0.45, -shoulderW * 1.28 + hemSwing, hemY);
    ctx.lineTo(shoulderW * 1.20 + hemSwing, hemY);
    ctx.quadraticCurveTo(shoulderW * 1.10, -torso * 0.45, shoulderW * 0.82, -torso);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Engraved shading on the shadow side, same trick as drawCart().
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = inkC;
    ctx.lineWidth = 1;
    for (let d = -H; d < H; d += Math.max(4, H * 0.075)) {
      ctx.beginPath();
      ctx.moveTo(d, hemY);
      ctx.lineTo(d + torso, -torso);
      ctx.stroke();
    }
    ctx.restore();

    // Lapel + collar.
    ctx.strokeStyle = inkC;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1, H * 0.018);
    ctx.beginPath();
    ctx.moveTo(0.01 * H, -torso * 0.95);
    ctx.lineTo(-0.02 * H, hemY * 0.4);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Neck + head. sphereShade gives the same engraved ball as every other
    // mass in the app, which is what keeps this figure inside the house style.
    const headY = -torso - 0.055 * H - headR;
    ctx.strokeStyle = inkC;
    ctx.lineWidth = limbW * 0.8;
    ctx.beginPath();
    ctx.moveTo(0.012 * H, -torso);
    ctx.lineTo(0.02 * H, headY + headR * 0.8);
    ctx.stroke();
    sphere(ctx, 0.02 * H, headY, R(headR), inkC, coat);

    if (headR > 4) {
      // Glasses and a nose, facing forward. Small enough to vanish gracefully
      // when the scale clamp shrinks the figure.
      ctx.strokeStyle = inkC;
      ctx.lineWidth = Math.max(0.8, headR * 0.14);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(0.02 * H + headR * 0.42, headY - headR * 0.08, R(headR * 0.30), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0.02 * H + headR * 0.12, headY - headR * 0.1);
      ctx.lineTo(0.02 * H - headR * 0.35, headY - headR * 0.18);
      ctx.stroke();
      // Hair, swept back off the forehead.
      ctx.beginPath();
      ctx.arc(0.02 * H, headY, R(headR * 0.98), Math.PI * 1.05, Math.PI * 1.85);
      ctx.lineWidth = Math.max(1, headR * 0.3);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const hand = drawArm(phase, 1);
    drawLeg(near, 1);

    // Water damage, applied last so it sits over the coat and the face.
    if (o.wet > 0) {
      const wet = cl(o.wet, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.5 * wet;
      ctx.fillStyle = PAL.navy;
      ctx.beginPath();
      ctx.ellipse(0.02 * H, headY - headR * 0.35, R(headR * 1.15), R(headR * 0.7), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.34 * wet;
      ctx.beginPath();
      ctx.ellipse(0, -torso * 0.55, R(shoulderW * 1.0), R(torso * 0.42), 0, 0, Math.PI * 2);
      ctx.fill();
      // Drips lengthen with time rather than appearing all at once.
      ctx.strokeStyle = PAL.navy;
      ctx.lineWidth = Math.max(1, H * 0.016);
      ctx.globalAlpha = 0.55 * wet;
      const drip = (o.dripT || 0);
      for (let i = 0; i < 4; i++) {
        const dx = (-0.6 + i * 0.4) * shoulderW;
        const len = cl(drip * (0.5 + i * 0.22), 0, 1) * torso * 0.8;
        ctx.beginPath();
        ctx.moveTo(dx, headY + headR * 0.6);
        ctx.lineTo(dx, headY + headR * 0.6 + len);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
    return { handX: footX + face * hand.x, handY: footY - hipDrop + hand.y };
  }

  /* ---------------------------- the thrower ---------------------------- */

  // The student. Feet are derived FROM the hand position so the balloon leaves
  // exactly the release point regardless of the figure's drawn size, which the
  // scale clamp is free to change.
  function drawThrower(ctx, handX, handY, H, armAngle, lean) {
    const torso = 0.30 * H, reach = 0.295 * H;
    const shoulderX = handX - reach * Math.cos(armAngle);
    const shoulderY = handY - reach * Math.sin(armAngle);
    const footX = shoulderX - 0.045 * H;
    const footY = shoulderY + torso + 0.51 * H;

    const inkC = PAL.ink;
    const limbW = Math.max(1.2, H * 0.035);

    ctx.save();
    ctx.translate(footX, footY);
    ctx.scale(1, 1);
    if (lean) { ctx.rotate(lean); }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const hipY = -0.51 * H;
    // Braced stance: one foot back, weight forward over the rail.
    ctx.strokeStyle = inkC;
    ctx.lineWidth = limbW;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-0.10 * H, hipY + 0.26 * H);
    ctx.lineTo(-0.16 * H, 0);
    ctx.lineTo(-0.25 * H, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(0.05 * H, hipY + 0.26 * H);
    ctx.lineTo(0.03 * H, 0);
    ctx.lineTo(0.12 * H, 0);
    ctx.stroke();

    // Trunk.
    const shX = 0.045 * H, shY = hipY - torso;
    ctx.fillStyle = PAL.panel;
    ctx.strokeStyle = inkC;
    ctx.lineWidth = Math.max(1.1, H * 0.024);
    ctx.beginPath();
    rrect(ctx, shX - 0.10 * H, shY, R(0.20 * H), R(torso + 0.05 * H), R(0.05 * H));
    ctx.fill();
    ctx.stroke();

    // Rear arm gripping the rail.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = inkC;
    ctx.lineWidth = limbW * 0.9;
    ctx.beginPath();
    ctx.moveTo(shX, shY + 0.03 * H);
    ctx.lineTo(shX + 0.10 * H, shY + 0.20 * H);
    ctx.lineTo(shX + 0.22 * H, shY + 0.26 * H);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Head.
    const headR = 0.068 * H;
    const headY = shY - 0.055 * H - headR;
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(shX + 0.01 * H, headY + headR * 0.8);
    ctx.lineWidth = limbW * 0.8;
    ctx.stroke();
    sphere(ctx, shX + 0.015 * H, headY, R(headR), inkC, PAL.panel);

    // Throwing arm, reaching out past the end post.
    const hx = handX - footX, hy = handY - footY;
    const ex = shX + (hx - shX) * 0.52 - 0.02 * H;
    const ey = shY + (hy - shY) * 0.52 + 0.05 * H;
    ctx.strokeStyle = inkC;
    ctx.lineWidth = limbW * 0.95;
    ctx.beginPath();
    ctx.moveTo(shX, shY + 0.02 * H);
    ctx.lineTo(ex, ey);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.fillStyle = inkC;
    ctx.beginPath();
    ctx.arc(hx, hy, R(limbW * 0.55), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    return { footY };
  }

  /* ---------------------------- the balloon ---------------------------- */

  // A water balloon is a bag, not a ball: it stretches along its velocity as it
  // picks up speed and wobbles about that axis. Both are drawn by putting
  // sphereShade inside a non-uniform transform, so the engraved hatching
  // stretches with the skin instead of sitting on top of it.
  function drawBalloon(ctx, x, y, rPx, speed, tSince) {
    const stretch = 1 + cl(speed / 22, 0, 1) * 0.42;
    const wobble = Math.sin(tSince * 13.5) * 0.16 * Math.exp(-tSince * 0.55);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wobble);
    ctx.scale(1 / Math.sqrt(stretch), stretch);
    sphere(ctx, 0, 0, R(rPx), PAL.ink, PAL.navy);
    ctx.restore();
    // Knot at the top, drawn outside the squash so it stays a knot.
    ctx.fillStyle = PAL.ink;
    ctx.beginPath();
    ctx.arc(x - Math.sin(wobble) * rPx * stretch, y - Math.cos(wobble) * rPx * stretch * 1.05, R(rPx * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------------------------- the scene ---------------------------- */

  // World -> screen. Uniform scale in both axes, like RENDERERS.projectile,
  // so a 40 m bridge visibly towers over a 9 m one instead of every round
  // being stretched to fill the canvas.
  function layout(w, h) {
    const r = S.round;
    const A = S.anim;
    const groundY = h * 0.855;
    const topPad = h * 0.13;

    // Right edge: far enough to hold the start position, and any overshoot a
    // late release produced.
    let right = r.startDistance;
    if (A) right = Math.max(right, jloaneGap(A.t0));
    right = Math.max(right, 3) + 1.5;
    // Left: enough deck to read as a bridge rather than a diving board.
    const deck = Math.max(6, right * 0.42);
    const spanW = right + deck;
    const spanH = r.bridgeHeight + r.targetHeight + 1.2;

    const usableW = Math.max(w * 0.9, 1);
    const usableH = Math.max(groundY - topPad, 1);
    const scale = Math.max(Math.min(usableW / spanW, usableH / spanH), 1e-4);

    const originX = w * 0.05 + deck * scale;
    // Figures get a legibility floor. A 40 m bridge in a 300 px pane puts a
    // real 1.75 m person at eleven pixels, which teaches nothing; the caption
    // says so when it happens rather than letting the reader scale off them.
    const wanted = r.targetHeight * scale;
    const figH = cl(wanted, 22, Math.min(110, Math.max(h * 0.17, 22)));

    return {
      groundY, scale, originX, deck, right, figH,
      toScale: Math.abs(figH - wanted) < 0.75,
      X: (x) => originX + x * scale,
      Y: (y) => groundY - y * scale,
    };
  }

  function drawBridge(ctx, w, h, L) {
    const r = S.round;
    const edgeX = L.X(0);
    // The deck top is placed so the thrower's hand lands on the release point;
    // it is a DRAWING quantity, not a physical one, which is why it is derived
    // in pixels rather than metres.
    const releaseScreenY = L.Y(r.targetHeight + r.bridgeHeight);
    const deckTopY = releaseScreenY + L.figH * 0.80;
    const deckH = Math.max(5, L.scale * 0.9);
    const leftX = Math.max(w * 0.01, L.X(-L.deck));

    // Abutment and the pier, set back from the edge so the balloon falls clear
    // of the structure — the drop point is the deck's overhanging END, which
    // is the whole geometric point of the round.
    const pierX = edgeX - Math.max(14, L.deck * 0.28 * L.scale);
    const pierW = Math.max(8, L.scale * 1.6);

    ctx.fillStyle = PAL.panel;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.rect(pierX - pierW / 2, deckTopY + deckH, pierW, Math.max(L.groundY - deckTopY - deckH, 0.1));
    ctx.fill();
    ctx.stroke();

    // Stone courses on the pier.
    ctx.save();
    ctx.beginPath();
    ctx.rect(pierX - pierW / 2, deckTopY + deckH, pierW, Math.max(L.groundY - deckTopY - deckH, 0.1));
    ctx.clip();
    ctx.strokeStyle = PAL.rule;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;
    for (let y = deckTopY + deckH; y < L.groundY; y += Math.max(7, pierW * 0.55)) {
      ctx.beginPath();
      ctx.moveTo(pierX - pierW / 2, y);
      ctx.lineTo(pierX + pierW / 2, y);
      ctx.stroke();
    }
    ctx.restore();

    // Deck.
    ctx.fillStyle = PAL.panel;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(leftX, deckTopY, Math.max(edgeX - leftX, 0.1), deckH);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(leftX, deckTopY, Math.max(edgeX - leftX, 0.1), deckH);
    ctx.clip();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 1;
    for (let d = leftX - deckH; d < edgeX; d += 8) {
      ctx.beginPath();
      ctx.moveTo(d, deckTopY + deckH);
      ctx.lineTo(d + deckH, deckTopY);
      ctx.stroke();
    }
    ctx.restore();

    // Railing: posts plus a top rail, ending flush with the deck.
    const railH = L.figH * 0.6;
    const postGap = Math.max(11, L.scale * 1.5);
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 1.4;
    for (let x = edgeX; x > leftX; x -= postGap) {
      ctx.beginPath();
      ctx.moveTo(x, deckTopY);
      ctx.lineTo(x, deckTopY - railH);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftX, deckTopY - railH);
    ctx.lineTo(edgeX, deckTopY - railH);
    ctx.moveTo(leftX, deckTopY - railH * 0.5);
    ctx.lineTo(edgeX, deckTopY - railH * 0.5);
    ctx.stroke();

    return { deckTopY, edgeX, railH, releaseScreenY };
  }

  function drawScale(ctx, w, h, L) {
    if (w < 200) return;
    const r = S.round;
    // One tick every "nice" number of metres, six to twelve across the road.
    const targetTicks = 8;
    const raw = (L.right + L.deck) / targetTicks;
    const steps = [1, 2, 5, 10, 20, 50];
    let step = steps[steps.length - 1];
    for (const s of steps) { if (s >= raw) { step = s; break; } }

    ctx.save();
    ctx.strokeStyle = PAL.rule;
    ctx.lineWidth = 1;
    for (let m = 0; m <= L.right + step; m += step) {
      const x = L.X(m);
      if (x > w * 0.985) break;
      const major = Math.round(m / step) % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(x, L.groundY + 10);
      ctx.lineTo(x, L.groundY + (major ? 17 : 14));
      ctx.stroke();
      if (major && L.scale * step > 26) {
        caption(ctx, x, L.groundY + 26, m === 0 ? "0" : `${m}`, PAL.inkSoft, 9.5);
      }
    }
    ctx.restore();
    if (L.scale * step > 26) caption(ctx, L.X(L.right * 0.5), L.groundY + 37, "distance from target (m)", PAL.inkSoft, 9.5);
    // The drop point itself, marked on the road.
    ctx.strokeStyle = PAL.brass;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(L.X(0) - 6, L.groundY);
    ctx.lineTo(L.X(0) + 6, L.groundY);
    ctx.stroke();
    void r;
  }

  function drawHeightAnnotation(ctx, L, bridge) {
    const r = S.round;
    const x = L.X(0);
    const yTop = L.Y(r.targetHeight + r.bridgeHeight);
    const yHead = L.Y(r.targetHeight);
    // Plumb line from the hand to the head-height plane: the h in h = ½gt².
    dashed(ctx, x, yTop, x, L.groundY, PAL.rule, 1, [3, 5]);
    if (yHead - yTop > 26) {
      const ax = x - Math.max(16, L.scale * 0.9);
      dashed(ctx, ax - 6, yTop, x, yTop, PAL.rule, 1, [2, 4]);
      dashed(ctx, ax - 6, yHead, x, yHead, PAL.rule, 1, [2, 4]);
      arrow(ctx, ax, yTop, ax, yHead, PAL.navy, 1.6);
      arrow(ctx, ax, yHead, ax, yTop, PAL.navy, 1.6);
      ctx.save();
      ctx.translate(ax - 9, (yTop + yHead) / 2);
      ctx.rotate(-Math.PI / 2);
      label(ctx, 0, 0, `h = ${num(r.bridgeHeight, 1)} m`, PAL.navy, 11.5, "center");
      ctx.restore();
    }
    void bridge;
  }

  function drawSplash(ctx, L, A, originX, originY, age) {
    const r = S.round;
    const g = r.gravity;
    ctx.save();
    for (let i = 0; i < A.droplets.length; i++) {
      const d = A.droplets[i];
      if (age > d.life) continue;
      const t = age;
      const wx = d.vx * t;
      let wy = d.vy * t - 0.5 * g * t * t;
      const floorY = -(originY);        // world y of the road relative to origin
      if (wy < floorY) wy = floorY;     // droplets pool rather than tunnel
      const px = originX + wx * L.scale;
      const py = L.groundY - (originY + wy) * L.scale;
      const fade = 1 - t / d.life;
      ctx.globalAlpha = cl(fade, 0, 1) * 0.85;
      ctx.fillStyle = PAL.navy;
      ctx.beginPath();
      ctx.ellipse(px, py, R(d.r * L.scale * (1 + t * 0.2)), R(d.r * L.scale * 1.5), d.spin * t * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawWetPatch(ctx, L, x, age) {
    if (age <= 0) return;
    // Spreads fast then stops, and dims but never disappears. The dimension
    // line drawn beneath a miss measures FROM this patch; letting it fade to
    // nothing would leave the arrow pointing at bare road.
    const rx = (0.35 + 1.25 * (1 - Math.exp(-age * 3.4))) * L.scale;
    const fade = cl(1 - (age - 2.4) / 0.8, 0.55, 1);
    ctx.save();
    ctx.globalAlpha = 0.4 * fade;
    ctx.fillStyle = PAL.navy;
    ctx.beginPath();
    ctx.ellipse(x, L.groundY + 1, R(rx), R(rx * 0.26), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7 * fade;
    ctx.strokeStyle = PAL.navy;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(x, L.groundY + 1, R(rx), R(rx * 0.26), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBurstRubber(ctx, L, x, age) {
    // What is left of the balloon: a limp scrap of skin. Stays put, like the
    // wet patch, so the splash point is still visible under the dimension line.
    const fade = cl(1 - (age - 2.6) / 0.6, 0.8, 1);
    const s = Math.max(2.5, L.scale * 0.16);
    ctx.save();
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = PAL.navy;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - s * 1.6, L.groundY);
    ctx.quadraticCurveTo(x - s * 0.4, L.groundY - s * 1.3, x + s * 0.9, L.groundY - s * 0.2);
    ctx.quadraticCurveTo(x + s * 1.7, L.groundY + s * 0.2, x - s * 1.6, L.groundY);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // The near-miss is the lesson, so it gets a proper dimension line: witness
  // marks at both ends, arrowheads facing outwards, and the number in metres
  // with the direction spelled out in words.
  function drawMissGap(ctx, w, h, L, missBy, fade) {
    const r = S.round;
    const x0 = L.X(0);
    const x1 = L.X(missBy);
    // Below the walker's feet, but never off the bottom: the caption sits a
    // further 28 px down and a tall figure would otherwise push it past the
    // edge, which is exactly where the number the student needs would go.
    const y = cl(L.groundY + Math.max(30, L.figH * 0.5), L.groundY + 12, h - 34);
    if (Math.abs(x1 - x0) < 1.5) return;

    ctx.save();
    ctx.globalAlpha = cl(fade, 0, 1);
    ctx.strokeStyle = PAL.crimson;
    ctx.lineWidth = 1.2;
    for (const x of [x0, x1]) {
      ctx.beginPath();
      ctx.moveTo(x, L.groundY - 2);
      ctx.lineTo(x, y + 6);
      ctx.stroke();
    }
    const wide = Math.abs(x1 - x0) > 34;
    if (wide) {
      arrow(ctx, (x0 + x1) / 2, y, x0, y, PAL.crimson, 1.5);
      arrow(ctx, (x0 + x1) / 2, y, x1, y, PAL.crimson, 1.5);
    } else {
      arrow(ctx, x0 - 22, y, x0, y, PAL.crimson, 1.5);
      arrow(ctx, x1 + 22, y, x1, y, PAL.crimson, 1.5);
    }
    const early = missBy > 0;
    const text = early ? "landed IN FRONT — released too early" : "landed BEHIND — released too late";

    // Centre the two lines on the gap, but keep them ON the canvas. A short
    // gap near the left margin puts the wide caption half off the plate
    // otherwise, and the measured width is the only honest way to know.
    ctx.font = `400 10.5px ${FONT}`;
    const half = Math.max(ctx.measureText(text).width, 44) / 2 + 4;
    const cx = w > half * 2 ? cl((x0 + x1) / 2, half, w - half) : w / 2;

    label(ctx, cl((x0 + x1) / 2, 24, Math.max(w - 24, 24)), y + (wide ? -11 : 15),
      `${num(Math.abs(missBy), 2)} m`, PAL.crimson, 13);
    caption(ctx, cx, y + (wide ? -24 : 28), text, PAL.crimson, 10.5);
    ctx.restore();
    void r;
  }

  function readout(ctx, w, h, L) {
    if (w < 300 || h < 170) return;
    const r = S.round, A = S.anim;
    const t = A ? A.t : 0;
    const by = A ? balloonY(t) : r.targetHeight + r.bridgeHeight;
    const lines = [
      `BALLOON DROP · LEVEL ${r.level}`,
      `h        = ${num(r.bridgeHeight, 2)} m`,
      // The release time is the arrival time minus this, so printing it
      // removes every step of the problem.
      `t_fall   = ${S.result ? num(r.fallTime, 3) + " s" : "— work it out"}`,
      `t        = ${num(t, 2)} s`,
      `d_Jloane = ${num(jloaneGap(t), 2)} m`,
      `v_Jloane = ${num(A && t > A.freezeAt ? 0 : walkSpeedAt(r, t), 2)} m/s`,
      `y_balloon= ${by === null ? "—" : num(by, 2)} m`,
    ];
    plate(ctx, w - 168 - w * 0.02, h * 0.05, 168, lines);
  }

  function draw(ctx, w, h) {
    if (!ctx) return;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return;
    const r = S.round;
    if (!r) {
      ctx.save();
      ctx.fillStyle = PAL.paper;
      ctx.fillRect(0, 0, w, h);
      caption(ctx, w / 2, h / 2, "No round loaded.", PAL.inkSoft, 12);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.fillStyle = PAL.paper;
    ctx.fillRect(0, 0, w, h);

    const L = layout(w, h);
    const A = S.anim;
    const t = A ? A.t : 0;

    ground(ctx, w, h, L.groundY);
    drawScale(ctx, w, h, L);
    const bridge = drawBridge(ctx, w, h, L);
    drawHeightAnnotation(ctx, L, bridge);

    // ---- Dr. Jloane -------------------------------------------------------
    const gap = A ? jloaneGap(t) : r.startDistance;
    const jx = L.X(gap);
    const phase = A ? A.gait : 0;
    const swing = A && t > A.freezeAt ? 0.12 : 1;

    let lean = 0, wet = 0, dripT = 0;
    if (A && t > A.landingTime) {
      const tau = t - A.landingTime;
      if (A.hit) {
        // Snap back, then a long slow recovery. The asymmetry is what makes it
        // read as being hit rather than as a sine wave.
        lean = 0.30 * (1 - Math.exp(-tau * 16)) * Math.exp(-tau * 0.85);
        wet = cl(tau * 3.2, 0, 1);
        dripT = tau;
      } else {
        // Flinch away from whichever side the balloon went past.
        const side = A.missBy > 0 ? 1 : -1;
        lean = side * 0.17 * (1 - Math.exp(-tau * 18)) * Math.exp(-tau * 1.7);
      }
    }
    shadow(ctx, jx, L.groundY + 2, L.figH * 0.45, 0.35);
    drawWalker(ctx, jx, L.groundY, L.figH, {
      facing: -1, phase, swing, lean, wet, dripT,
      coat: PAL.panel, ink: PAL.ink,
    });
    if (L.figH > 30) {
      label(ctx, jx, L.groundY - L.figH - 12, "Dr. Jloane", PAL.inkSoft, 10.5);
    }

    // ---- the student ------------------------------------------------------
    const relY = bridge.releaseScreenY;
    let armAngle = 0.34, throwerLean = 0;
    if (A && t > A.releaseTime) {
      const tau = t - A.releaseTime;
      // Hand opens upward on release, then the whole figure leans out to watch.
      armAngle = 0.34 - 0.42 * eOut(cl(tau / 0.35, 0, 1)) + 0.30 * eOut(cl((tau - 1.0) / 1.4, 0, 1));
      throwerLean = 0.05 * eOut(cl(tau / 0.8, 0, 1));
    }
    drawThrower(ctx, L.X(0), relY, L.figH, armAngle, throwerLean);

    // ---- the balloon ------------------------------------------------------
    const rPx = Math.max(2.2, L.scale * 0.16);
    if (!A) {
      drawBalloon(ctx, L.X(0), relY, rPx, 0, 0);
    } else {
      const by = balloonY(t);
      if (by !== null) {
        const tau = Math.max(0, t - A.releaseTime);
        const speed = t < A.releaseTime ? 0 : Math.abs(r.throwSpeed + r.gravity * tau);
        drawBalloon(ctx, L.X(0), L.Y(by), rPx, speed, tau);
        if (t > A.releaseTime) {
          // Faint plumb trace of the path already fallen.
          dashed(ctx, L.X(0), relY, L.X(0), L.Y(by), PAL.navy, 1, [2, 5]);
        }
      }
    }

    // ---- impact -----------------------------------------------------------
    if (A && t >= A.burstTime) {
      const age = t - A.burstTime;
      if (A.hit) {
        const headY = L.Y(r.targetHeight);
        drawSplash(ctx, L, A, jx, r.targetHeight, age);
        drawWetPatch(ctx, L, jx, age);
        void headY;
      } else {
        drawSplash(ctx, L, A, L.X(0), 0, age);
        drawWetPatch(ctx, L, L.X(0), age);
        drawBurstRubber(ctx, L, L.X(0), age);
        drawMissGap(ctx, w, h, L, A.missBy, cl((age - 0.3) / 0.5, 0, 1));
      }
      if (age > 0.25) {
        const msg = A.hit
          ? "DIRECT HIT"
          : `${num(Math.abs(A.missBy), 2)} m ${A.missBy > 0 ? "TOO EARLY" : "TOO LATE"}`;
        label(ctx, w / 2, h * 0.075, msg, A.hit ? PAL.forest : PAL.crimson, 15);
      }
    }

    readout(ctx, w, h, L);
    if (!L.toScale && w > 260) {
      caption(ctx, w / 2, h - 8, "Figures enlarged for legibility; the road scale is true.", PAL.inkSoft, 9.5);
    }
    ctx.restore();
  }

  /* ---------------------------- public API ---------------------------- */

  function newRound(level) {
    const lv = cl(Math.round(Number(level) || 1), 1, 3);
    const r = makeRound(lv, gravity());
    r.prompt = buildPrompt(r);
    r.givens = buildGivens(r);
    S.round = r;
    S.result = null;
    S.anim = null;
    return publicRound(r);
  }

  function round() { return publicRound(S.round); }

  function submit(value, mode) { return grade(value, mode); }

  // The host asked for the answer to be graded and the animation to be started
  // separately, so a wrong answer can be explained in prose before it is
  // played back. With no submission on file this plays the exact release,
  // which is what a "show me" button wants.
  function play() {
    if (!S.round) return false;
    const res = S.result;
    const rt = res && Number.isFinite(res.releaseTime) ? res.releaseTime : S.round.exactTime;
    return startAnim(rt, res || { correct: true, missBy: 0 });
  }

  function reset() {
    S.round = null;
    S.result = null;
    S.anim = null;
  }

  function state() {
    const A = S.anim;
    return {
      hasRound: !!S.round,
      hasResult: !!S.result,
      animating: !!(A && A.running),
      t: A ? A.t : 0,
      phase: !A ? "idle"
        : A.t < A.releaseTime ? "approach"
        : A.t < A.burstTime ? "falling"
        : A.running ? "impact" : "done",
      hit: A ? A.hit : null,
      gap: A ? jloaneGap(A.t) : (S.round ? S.round.startDistance : NaN),
      balloonY: A ? balloonY(A.t) : null,
      gait: A ? A.gait : 0,
    };
  }

  const api = {
    newRound, round, submit, play, tick, draw, reset, state,
    LEVELS,
    TOLERANCE,
    TARGET_HEIGHT,
  };

  // A top-level `const` in a classic script is a global LEXICAL binding, not a
  // property of window. Hosts that feature-detect with `window.BalloonDrop`
  // would see nothing, so publish both names for the one object.
  try { if (typeof window !== "undefined") window.BalloonDrop = api; } catch (e) { /* non-browser */ }

  return api;
})();
