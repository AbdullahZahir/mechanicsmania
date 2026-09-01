/* ============================================================================
   flying pig — the conical pendulum lab, as a minigame
   ----------------------------------------------------------------------------
   The classroom apparatus is a battery-powered toy pig on a string, flying in a
   horizontal circle. What the lab actually asks a student to do is narrow and
   specific, and this game asks exactly that:

     1. Measure the string length and the radius of the circle (or the angle).
     2. Draw the free body: there are TWO forces on the pig, the tension along
        the string and its weight. Nothing else. No outward force.
     3. Resolve. Vertically nothing accelerates, so T cos(theta) = mg.
        Horizontally the whole net force is centripetal, so T sin(theta) = mv^2/r.
     4. Divide:  tan(theta) = v^2/(rg),  and the mass cancels.
     5. Predict the PERIOD, then time ten revolutions and compare.

   The prediction is the point. A student who computes T = 2*pi*sqrt(L cos(theta)/g)
   and then watches the pig fly at that period has done the lab; a student who
   watched first has only seen a toy.
   ========================================================================== */

const FlyingPig = (function () {
  const G = () => (typeof GRAVITY === "number" && GRAVITY > 0 ? GRAVITY : 9.8);

  const LEVELS = [
    { id: 1, name: "Angle given",
      blurb: "The string's angle from the vertical is measured for you." },
    { id: 2, name: "Radius given",
      blurb: "You are given the radius of the circle and must find the angle yourself." },
    { id: 3, name: "Tension too",
      blurb: "Find the period, and the tension the string carries." },
  ];

  let round = null;
  let result = null;
  let anim = null;

  /* --- the physics, in one place -------------------------------------------
     cos(theta) = g / (omega^2 L)  is the same statement as
     T_period = 2*pi*sqrt(L cos(theta) / g).  Both are used below; they must
     never disagree, so both come from here. */
  function periodFor(L, theta) {
    return 2 * Math.PI * Math.sqrt((L * Math.cos(theta)) / G());
  }
  function tensionFor(m, theta) {
    return (m * G()) / Math.cos(theta);
  }

  /* Build the answer first, then work backwards to the givens, so a round is
     never unsolvable and never lands on an absurd number. */
  function newRound(level) {
    const lv = Math.max(1, Math.min(3, Math.round(level || 1)));

    // A comfortable classroom cone: steep enough that the angle matters, shallow
    // enough that the string is not nearly horizontal (which no real toy reaches).
    const theta = (22 + Math.random() * 46) * (Math.PI / 180);      // 22 deg .. 68 deg
    const L = Math.round((0.45 + Math.random() * 0.95) * 100) / 100; // 0.45 .. 1.40 m
    const m = Math.round((0.08 + Math.random() * 0.42) * 100) / 100; // 0.08 .. 0.50 kg

    const r = L * Math.sin(theta);
    const period = periodFor(L, theta);
    const v = (2 * Math.PI * r) / period;
    const tension = tensionFor(m, theta);

    const givens = [
      ["String length, L", L.toFixed(2) + " m"],
      ["Pig mass, m", m.toFixed(2) + " kg"],
    ];
    if (lv === 1) {
      givens.push(["Angle from vertical, θ", ((theta * 180) / Math.PI).toFixed(1) + "°"]);
    } else {
      givens.push(["Radius of the circle, r", r.toFixed(3) + " m"]);
    }
    givens.push(["g", G().toFixed(2) + " m/s²"]);

    const inputs = [{ key: "period", label: "Period of one revolution", unit: "s", step: "0.001" }];
    if (lv === 3) inputs.push({ key: "tension", label: "Tension in the string", unit: "N", step: "0.001" });

    round = {
      level: lv, L, m, theta, r, period, v, tension,
      // A tenth of a second is what a stopwatch over ten revolutions resolves,
      // so grade to something a real measurement could distinguish.
      tolPeriod: Math.max(0.02, period * 0.02),
      tolTension: Math.max(0.02, tension * 0.02),
      givens, inputs,
      prompt: lv === 1
        ? "The pig flies in a horizontal circle on a string of the length below, hanging at the angle shown. Predict the period of one revolution."
        : lv === 2
          ? "The pig flies in a horizontal circle of the radius below, on a string of the length shown. Work out the angle from the geometry first, then predict the period."
          : "The pig flies in a horizontal circle of the radius below. Predict the period of one revolution, and the tension the string carries.",
      note: "Two forces act on the pig: the tension along the string, and its weight. Nothing pushes it outward.",
    };
    result = null;
    anim = null;
    return view();
  }

  function view() {
    if (!round) return null;
    return {
      id: "flying-pig",
      prompt: round.prompt,
      note: round.note,
      givens: round.givens.map((g) => ({ label: g[0], value: g[1], unit: "" })),
      inputs: round.inputs,
    };
  }

  /* Every other module answers a blank with a full result rather than a bare
     flag, and tolerates being called with nothing at all. This one did neither
     -- `answers.period` threw on null, and the host had to invent a verdict. */
  function blankResult() {
    return {
      correct: false, blank: true,
      verdict: { kind: "miss", text: "Nothing entered" },
      feedback: "Enter a number before you press Play.",
      misconception: null, solution: [], exact: {}, tolerance: {},
    };
  }

  function submit(answers) {
    if (!round) return blankResult();
    const a = answers || {};
    const rawT = String(a.period ?? "").trim();
    if (rawT === "") return blankResult();
    const guessT = Number(rawT);
    if (!Number.isFinite(guessT)) return blankResult();

    let guessTen = null;
    if (round.level === 3) {
      const rawN = String(a.tension ?? "").trim();
      if (rawN === "") return blankResult();
      guessTen = Number(rawN);
      if (!Number.isFinite(guessTen)) return blankResult();
    }

    const dT = guessT - round.period;
    const okT = Math.abs(dT) <= round.tolPeriod;
    const okN = guessTen === null || Math.abs(guessTen - round.tension) <= round.tolTension;
    const correct = okT && okN;

    // What the pig will actually do: fly at the angle the STUDENT's period
    // implies. A period that is too long means too slow, which means the cone
    // collapses toward the vertical -- so the error is visible as a shape, not
    // just as a number.
    const impliedOmega = (2 * Math.PI) / Math.max(guessT, 1e-6);
    const cosImplied = G() / (impliedOmega * impliedOmega * round.L);
    const flies = cosImplied < 1;
    const thetaGuess = flies ? Math.acos(cosImplied) : 0;

    const parts = [];
    if (correct) {
      parts.push("The pig settles at exactly the angle you predicted and holds it.");
    } else if (!okT) {
      parts.push(dT > 0
        ? `Too slow. At ${guessT.toFixed(3)} s the pig cannot hold the cone up and it collapses inward.`
        : `Too fast. At ${guessT.toFixed(3)} s the string rides higher than the measurement says.`);
    } else {
      parts.push("The period is right, but the tension is not.");
    }
    parts.push(`Exact period ${round.period.toFixed(3)} s`);
    if (round.level === 3) parts.push(`exact tension ${round.tension.toFixed(3)} N`);
    if (!okT) parts.push(`you were out by ${Math.abs(dT).toFixed(3)} s`);

    const deg = (round.theta * 180) / Math.PI;
    const solution = [
      round.level === 1
        ? `θ  given as ${deg.toFixed(1)}°`
        : `sin θ = r/L = ${round.r.toFixed(3)}/${round.L.toFixed(2)} = ${(round.r / round.L).toFixed(4)}   →   θ = ${deg.toFixed(2)}°`,
      `Vertical      T cos θ = mg`,
      `Horizontal    T sin θ = m·v²/r = m·4π²r/T_p²`,
      `Divide        tan θ = v²/(rg)      the mass cancels`,
      `Period        T_p = 2π√(L cos θ / g) = 2π√(${(round.L * Math.cos(round.theta)).toFixed(4)}/${G().toFixed(2)}) = ${round.period.toFixed(4)} s`,
      `Speed         v = 2πr/T_p = ${round.v.toFixed(4)} m/s`,
      `Tension       T = mg/cos θ = ${round.tension.toFixed(4)} N   (bigger than mg = ${(round.m * G()).toFixed(3)} N)`,
    ];

    result = {
      correct, blank: false,
      // A period that is too long implies a shallower cone, so the reveal
      // collapses inward -- the verdict names the shape the reader will see.
      verdict: correct
        ? { kind: "hit", text: "The cone holds" }
        : { kind: guessT > round.period ? "over" : "under",
            text: guessT > round.period
              ? "Too slow \u2014 the cone collapses inward"
              : "Too fast \u2014 the cone flies out wide" },
      exact: { period: round.period, tension: round.tension },
      tolerance: { period: round.tolPeriod, tension: round.tolTension },
      // Each part is already a sentence or a clause; join without adding a
      // second full stop to one that has its own.
      feedback: parts.map((x) => x.replace(/\.$/, "")).join(". ") + ".",
      // A reader who got it right is not to be told which mistake they made.
      misconception: correct ? null : misconceptionFor(guessT, guessTen),
      solution,
      thetaGuess, flies,
    };
    return result;
  }

  /* The wrong routes a student actually takes, named rather than lumped into
     "incorrect". Each is checked against the number they typed. */
  function misconceptionFor(guessT, guessTen) {
    const near = (a, b) => Math.abs(a - b) <= Math.max(0.03, Math.abs(b) * 0.03);
    const simple = 2 * Math.PI * Math.sqrt(round.L / G());
    if (near(guessT, simple)) {
      return {
        id: "used-full-length",
        label: "That is the SIMPLE pendulum period",
        detail: " You used the whole string length L. Only its vertical projection L·cos θ sets the period of a conical pendulum, because only the vertical component of the tension holds the weight up.",
      };
    }
    // At 45 degrees the radius L*sin(theta) and the height L*cos(theta) are
    // the same number, so this detector cannot tell the two apart -- and near
    // 45 it cannot tell them apart to within its own tolerance either. Naming
    // a mistake the reader may not have made is worse than naming none, and
    // running it anyway masked the two tension detectors below it.
    const usedRadius = 2 * Math.PI * Math.sqrt(round.r / G());
    const heightPeriod = 2 * Math.PI * Math.sqrt((round.L * Math.cos(round.theta)) / G());
    const separable = Math.abs(usedRadius - heightPeriod) > Math.max(0.03, heightPeriod * 0.03);
    if (separable && near(guessT, usedRadius)) {
      return {
        id: "used-radius",
        label: "You used the radius where the height belongs",
        detail: " The length in T = 2π√(ℓ/g) is the VERTICAL distance from the pivot down to the plane of the circle, which is L·cos θ, not the radius L·sin θ.",
      };
    }
    if (guessTen !== null && near(guessTen, round.m * G())) {
      return {
        id: "tension-equals-weight",
        label: "The tension is not mg",
        detail: " Only the vertical COMPONENT of the tension balances the weight, so T cos θ = mg and T = mg/cos θ, which is always larger than the weight. If T equalled mg there would be nothing left over to turn the pig.",
      };
    }
    if (guessTen !== null && near(guessTen, round.m * G() * Math.cos(round.theta))) {
      return {
        id: "tension-resolved-backwards",
        label: "The resolution is inverted",
        detail: " You multiplied by cos θ where you should have divided. T cos θ = mg gives T = mg/cos θ.",
      };
    }
    return null;
  }

  /* --- animation ----------------------------------------------------------- */

  function play() {
    if (!result) return false;
    anim = { t: 0, phase: "spin", settle: 0 };
    return true;
  }

  function tick(dt) {
    if (!anim) return false;
    // Clamp the step: a backgrounded tab hands back seconds at a time, and the
    // settle would jump straight past the reveal it exists to show.
    anim.t += Math.min(Math.max(dt, 0), 0.05);
    // The cone eases from the measured angle to the one the answer implies, so
    // a wrong prediction is watched drifting away rather than simply stated.
    anim.settle = Math.min(1, anim.t / 0.9);
    if (anim.t > 7) { anim = null; return false; }
    return true;
  }

  function animating() { return anim !== null; }

  function draw(ctx, w, h) {
    if (!(w > 12 && h > 12) || !round) return;
    const P = typeof PALETTE !== "undefined" ? PALETTE : null;
    if (!P) return;

    // While a result exists the pig flies at the angle the STUDENT's answer
    // implies, easing from the measured one, so the discrepancy is a shape the
    // reader watches appear rather than a number they read.
    const target = result ? result.thetaGuess : round.theta;
    const ease = anim ? anim.settle : (result ? 1 : 0);
    const theta = round.theta + (target - round.theta) * ease;

    const pivotY = h * 0.14;
    const cx = w * 0.46;
    const scale = Math.min((w * 0.34) / Math.max(round.L, 0.2), (h * 0.62) / Math.max(round.L, 0.2));

    const r = round.L * Math.sin(theta) * scale;
    const drop = round.L * Math.cos(theta) * scale;
    const orbY = pivotY + drop;
    const ry = r * 0.30;

    // the circle the pig sweeps
    if (r > 1) {
      ctx.save();
      ctx.strokeStyle = P.rule; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.ellipse(cx, orbY, r, ry, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // support, and the vertical the angle is measured from
    ctx.save();
    ctx.strokeStyle = P.rule; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(cx - 40, pivotY); ctx.lineTo(cx + 40, pivotY); ctx.stroke();
    ctx.restore();
    if (typeof drawDashedLine === "function") {
      drawDashedLine(ctx, cx, pivotY, cx, orbY + ry + 14, P.rule, 1, [3, 5]);
    }

    const phase = anim ? (anim.t / Math.max(round.period, 0.2)) * Math.PI * 2 : 0.7;
    const px = cx + r * Math.cos(phase);
    const py = orbY + ry * Math.sin(phase);

    ctx.save();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(cx, pivotY); ctx.lineTo(px, py); ctx.stroke();
    ctx.restore();

    // the angle arc, labelled
    if (r > 10 && typeof drawLabel === "function") {
      ctx.save();
      ctx.strokeStyle = P.brass; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.9;
      const a1 = Math.PI / 2;
      const a2 = Math.atan2(py - pivotY, px - cx);
      ctx.beginPath(); ctx.arc(cx, pivotY, 34, Math.min(a1, a2), Math.max(a1, a2)); ctx.stroke();
      ctx.restore();
      drawLabel(ctx, cx + (px > cx ? 26 : -26), pivotY + 50,
                ((theta * 180) / Math.PI).toFixed(1) + "°", P.brass, 11);
    }

    if (typeof drawFlyingPig === "function") {
      drawFlyingPig(ctx, px, py, Math.max(Math.min(r * 0.4, 34), 14), phase);
    }

    // the two forces, and nothing else -- which is the free body the lab wants
    if (typeof drawArrow === "function" && r > 6) {
      const T = tensionFor(round.m, theta);
      const fs = 36 / Math.max(round.m * G(), 0.05);
      const ux = cx - px, uy = pivotY - py;
      const un = Math.hypot(ux, uy) || 1;
      drawArrow(ctx, px, py, px + (ux / un) * T * fs, py + (uy / un) * T * fs, P.forest, 2);
      drawArrow(ctx, px, py, px, py + round.m * G() * fs, P.navy, 1.8);
      if (typeof drawLabel === "function") {
        drawLabel(ctx, px + (ux / un) * T * fs + 12, py + (uy / un) * T * fs - 8, "T", P.forest, 11);
        drawLabel(ctx, px + 14, py + round.m * G() * fs + 8, "mg", P.navy, 11);
      }
    }

    if (typeof drawDataPlate === "function") {
      const rows = [
        ["L", round.L.toFixed(2) + " m"],
        ["θ measured", ((round.theta * 180) / Math.PI).toFixed(1) + "°"],
      ];
      if (result) {
        rows.push(["θ your answer implies", result.flies
          ? ((result.thetaGuess * 180) / Math.PI).toFixed(1) + "°" : "string hangs limp"]);
        rows.push(["verdict", result.correct ? "matches" : "does not match"]);
      }
      drawDataPlate(ctx, w - 186, 12, 174, rows);
    }
    if (typeof sideNameplate === "function") {
      sideNameplate(ctx, 12, h - 40, "Experiment", "Flying Pig", P.crimson);
    }
  }

  function reset() { round = null; result = null; anim = null; }

  return {
    LEVELS,
    list: () => [{ id: "flying-pig", name: "Flying pig", group: "Energy & circular motion",
                   blurb: "A toy pig on a string flies in a horizontal circle. Predict its period." }],
    difficulties: () => LEVELS.map((l) => l.name),
    start(_id, difficulty) {
      const i = LEVELS.findIndex((l) => l.name === difficulty);
      return newRound(i >= 0 ? i + 1 : 1);
    },
    round: view,
    submit,
    play, tick, draw, reset, animating,
  };
})();
