/* ============================================================================
   Playground — scenario engine
   ----------------------------------------------------------------------------
   Solve-mode diagrams are parametric: they replay a closed-form position
   function using an answer the solver already produced. Nothing here does
   that. A scenario declares its dynamics and the state is integrated forward
   from the user's parameters, with the outcome unknown in advance.

   Engine commitments:

   1. `derivatives(state, params)` is PURE — it reads only its arguments.
      An impure version silently degrades RK4 toward Euler as soon as
      acceleration depends on position or velocity, while still printing
      fourth-order-looking numbers.

   2. Dynamics are DERIVED, not recalled. Where a textbook closed form exists
      it appears only in `analytic()`, as an independent reference to check
      the integration against.

   3. State is an arbitrary bag of named numbers, so a scenario can be 1-D,
      2-D, or carry many bodies without changing the integrator.

   4. Events are detected by bisection inside the step, so state and clock
      still correspond at the instant something happens. Events may be
      terminal (hit the floor) or impulsive (a collision that continues).
   ========================================================================== */

const PLAY_STEP = 1 / 480;      // simulated seconds per physics step
const PLAY_MAX_CATCHUP = 0.25;  // never simulate more than this WALL second
// The real per-frame limit is work, not simulated time: this many integration
// steps. It used to be a bare 0.5 simulated seconds, which silently overrode
// every timeScale above about 30x -- an orbit declaring 260x actually ran at
// 30x, so a five-hour transfer took ten minutes of wall clock to watch.
const PLAY_MAX_STEPS_PER_FRAME = 320;
// Fallback stop for a run that would otherwise never end. "Long enough" is
// scenario-specific — an Atwood drop lasts a second or two, while an orbit is
// measured in thousands — so a scenario may override it with `maxDuration`.
const PLAY_MAX_DURATION = 60;

/* --- generic integrator -------------------------------------------------- */

function stateAdd(state, delta, h) {
  const out = {};
  for (const key in state) out[key] = state[key] + h * delta[key];
  return out;
}

// Classical fourth-order Runge-Kutta over an arbitrary named state bag.
function rk4(d, state, p, h) {
  const k1 = d(state, p);
  const k2 = d(stateAdd(state, k1, h / 2), p);
  const k3 = d(stateAdd(state, k2, h / 2), p);
  const k4 = d(stateAdd(state, k3, h), p);
  const out = {};
  for (const key in state) {
    out[key] = state[key] + (h / 6) * (k1[key] + 2 * k2[key] + 2 * k3[key] + k4[key]);
  }
  return out;
}

// Locate a zero crossing of `detect` inside one step. Snapping to the
// boundary instead would leave the state and the clock inconsistent by up to
// a full step, which is invisible for a floor and fatal for a collision.
function bisectEvent(d, state, p, h, detect) {
  let lo = 0, hi = h;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    if (detect(rk4(d, state, p, mid), p) > 0) lo = mid; else hi = mid;
  }
  return { dt: hi, state: rk4(d, state, p, hi) };
}

function solve2x2(a11, a12, a21, a22, b1, b2) {
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) return null;
  return [(b1 * a22 - a12 * b2) / det, (a11 * b2 - b1 * a21) / det];
}

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ============================================================================
   scenario registry
   ========================================================================== */

const SCENARIOS = {};

/* --- 1. Atwood machine --------------------------------------------------- */
SCENARIOS.atwood = {
  label: "Atwood machine",
  group: "Forces & Newton's laws",
  ariaLabel: "Two masses hanging from a string over a pulley",
  blurb: "Two masses hang from a light string over a frictionless pulley. The string is inextensible, so both blocks share one acceleration.",
  defaults: { m1: 2, m2: 3, travel: 1.2 },
  controls: [
    { key: "m1", label: "Mass m₁ (left)", min: 0.5, max: 12, step: 0.1, unit: "kg" },
    { key: "m2", label: "Mass m₂ (right)", min: 0.5, max: 12, step: 0.1, unit: "kg" },
  ],
  state0: () => ({ y: 0, v: 0 }),

  // Assemble ΣF = ma for each body and solve for [T, a] rather than
  // substituting a remembered result.
  //   rising:      T − m1·g = m1·a   →   (1)T + (−m1)a =  m1·g
  //   descending:  m2·g − T = m2·a   →  (−1)T + (−m2)a = −m2·g
  constraint(p) {
    return solve2x2(1, -p.m1, -1, -p.m2, p.m1 * GRAVITY, -p.m2 * GRAVITY);
  },
  derivatives(state, p) {
    const s = SCENARIOS.atwood.constraint(p);
    return { y: state.v, v: s ? s[1] : 0 };
  },
  analytic(t, p) {
    const a = ((p.m2 - p.m1) * GRAVITY) / (p.m1 + p.m2);
    return { y: 0.5 * a * t * t };
  },
  events: [{ detect: (s, p) => p.travel - Math.abs(s.y), terminal: true }],
  isStatic: (p) => Math.abs(p.m2 - p.m1) < 1e-9,
  readouts(p, sim) {
    const s = SCENARIOS.atwood.constraint(p) || [0, 0];
    return [
      ["Acceleration", `${s[1].toFixed(3)} m/s²`],
      ["Tension", `${s[0].toFixed(2)} N`],
      ["Speed", `${Math.abs(sim.state.v).toFixed(2)} m/s`],
      ["a / g", `${(Math.abs(s[1]) / GRAVITY).toFixed(3)}`],
    ];
  },
  handoff: { chapter: "classicProblems", variant: "atwood", knowns: (p) => ({ m1: p.m1, m2: p.m2 }) },
  draw: drawAtwood,
};

/* --- 2. Vertical spring -------------------------------------------------- */
SCENARIOS.springVertical = {
  label: "Vertical spring",
  group: "Oscillations",
  ariaLabel: "A mass bouncing on a vertical spring",
  blurb: "A mass hangs from a spring. Gravity shifts the equilibrium down by mg/k but leaves the frequency untouched.",
  defaults: { m: 1.2, k: 45, y0: 0.28 },
  controls: [
    { key: "m", label: "Mass", min: 0.2, max: 8, step: 0.1, unit: "kg" },
    { key: "k", label: "Spring constant k", min: 5, max: 150, step: 1, unit: "N/m" },
    { key: "y0", label: "Release displacement", min: 0.02, max: 0.5, step: 0.01, unit: "m" },
  ],
  // y measured from the NATURAL length, positive downward, so the gravity
  // term is visible in the dynamics rather than hidden by a change of origin.
  state0: (p) => ({ y: (p.m * GRAVITY) / p.k + p.y0, v: 0 }),
  derivatives(state, p) {
    return { y: state.v, v: GRAVITY - (p.k / p.m) * state.y };
  },
  analytic(t, p) {
    const w = Math.sqrt(p.k / p.m);
    return { y: (p.m * GRAVITY) / p.k + p.y0 * Math.cos(w * t) };
  },
  events: [],
  isStatic: () => false,
  readouts(p, sim) {
    const w = Math.sqrt(p.k / p.m);
    const eq = (p.m * GRAVITY) / p.k;
    return [
      ["Angular frequency ω", `${w.toFixed(3)} rad/s`],
      ["Period T", `${((2 * Math.PI) / w).toFixed(3)} s`],
      ["Equilibrium shift mg/k", `${eq.toFixed(3)} m`],
      ["Displacement from eq.", `${(sim.state.y - eq).toFixed(3)} m`],
    ];
  },
  handoff: { chapter: "oscillations", variant: "osc_spring", knowns: (p) => ({ k_osc: p.k, mass_osc: p.m, A: p.y0, phi: 0 }) },
  draw: drawVerticalSpring,
};

/* --- 3. Horizontal spring with friction ---------------------------------- */
SCENARIOS.springHorizontal = {
  label: "Horizontal spring",
  group: "Oscillations",
  ariaLabel: "A block oscillating on a horizontal spring",
  blurb: "A block on a surface, attached to a spring. With friction switched on the motion is no longer harmonic: each swing loses a fixed amount of energy.",
  defaults: { m: 1.5, k: 60, x0: 0.35, mu: 0 },
  controls: [
    { key: "m", label: "Mass", min: 0.2, max: 8, step: 0.1, unit: "kg" },
    { key: "k", label: "Spring constant k", min: 5, max: 200, step: 1, unit: "N/m" },
    { key: "x0", label: "Initial stretch", min: 0.05, max: 0.6, step: 0.01, unit: "m" },
    { key: "mu", label: "Friction μ", min: 0, max: 0.5, step: 0.01, unit: "" },
  ],
  state0: (p) => ({ x: p.x0, v: 0 }),
  // Coulomb friction opposes motion, so the sign of the damping term flips
  // with velocity. That makes this genuinely non-linear, and the amplitude
  // then decays linearly rather than exponentially.
  derivatives(state, p) {
    const spring = -(p.k / p.m) * state.x;
    let fric = 0;
    if (p.mu > 0 && Math.abs(state.v) > 1e-6) fric = -Math.sign(state.v) * p.mu * GRAVITY;
    return { x: state.v, v: spring + fric };
  },
  analytic(t, p) {
    if (p.mu > 0) return null;           // no simple closed form with friction
    const w = Math.sqrt(p.k / p.m);
    return { x: p.x0 * Math.cos(w * t) };
  },
  events: [],
  isStatic: () => false,
  readouts(p, sim) {
    const w = Math.sqrt(p.k / p.m);
    const E = 0.5 * p.k * sim.state.x ** 2 + 0.5 * p.m * sim.state.v ** 2;
    const E0 = 0.5 * p.k * p.x0 ** 2;
    return [
      ["Angular frequency ω", `${w.toFixed(3)} rad/s`],
      ["Period T", `${((2 * Math.PI) / w).toFixed(3)} s`],
      ["Energy now", `${E.toFixed(3)} J`],
      ["Energy kept", `${((E / E0) * 100).toFixed(1)} %`],
    ];
  },
  handoff: {
    chapter: "oscillations",
    // Simple harmonic motion has no friction term. With mu turned up the
    // amplitude decays linearly and x(t) diverges from A*cos(wt) in both
    // magnitude and sign.
    available: (p) => (p.mu > 0
      ? `Simple harmonic motion assumes no friction. With μ = ${p.mu.toFixed(2)} the amplitude decays every half cycle, so x = A·cos(ωt) no longer describes this motion. Set μ to 0 to hand it over.`
      : null),
    variant: "osc_spring",
    knowns: (p) => ({ k_osc: p.k, mass_osc: p.m, A: p.x0, phi: 0 }),
  },
  draw: drawHorizontalSpring,
};

/* --- 4. Simple pendulum (non-linear) ------------------------------------- */
SCENARIOS.pendulum = {
  label: "Pendulum",
  group: "Oscillations",
  ariaLabel: "A pendulum swinging from a pivot",
  blurb: "A bob on a light rod. The true equation of motion carries sin θ, not θ — so the small-angle period is only an approximation, and it drifts as the swing widens.",
  defaults: { L: 1.0, theta0Deg: 25, m: 1 },
  controls: [
    { key: "L", label: "Length L", min: 0.2, max: 3, step: 0.05, unit: "m" },
    { key: "theta0Deg", label: "Release angle", min: 3, max: 170, step: 1, unit: "°" },
    { key: "m", label: "Bob mass", min: 0.2, max: 8, step: 0.1, unit: "kg" },
  ],
  state0: (p) => ({ th: (p.theta0Deg * Math.PI) / 180, w: 0 }),
  // The exact pendulum: α = −(g/L)·sin θ. Linearising to −(g/L)·θ is the
  // small-angle approximation, and comparing the two is the whole point.
  derivatives(state, p) {
    return { th: state.w, w: -(GRAVITY / p.L) * Math.sin(state.th) };
  },
  // Reference is the SMALL-ANGLE solution, so the readout shows how far the
  // real motion has departed from the textbook approximation.
  analytic(t, p) {
    const w = Math.sqrt(GRAVITY / p.L);
    return { th: ((p.theta0Deg * Math.PI) / 180) * Math.cos(w * t) };
  },
  events: [],
  isStatic: () => false,
  readouts(p, sim) {
    const Tsmall = 2 * Math.PI * Math.sqrt(p.L / GRAVITY);
    const th0 = (p.theta0Deg * Math.PI) / 180;
    // First-order correction to the period for a finite amplitude.
    const Ttrue = Tsmall * (1 + (th0 ** 2) / 16 + (11 * th0 ** 4) / 3072);
    return [
      ["Small-angle period", `${Tsmall.toFixed(3)} s`],
      ["Corrected period", `${Ttrue.toFixed(3)} s`],
      ["Approximation error", `${(((Ttrue - Tsmall) / Tsmall) * 100).toFixed(2)} %`],
      ["Angle now", `${((sim.state.th * 180) / Math.PI).toFixed(1)}°`],
    ];
  },
  handoff: {
    chapter: "oscillations",
    // T = 2*pi*sqrt(L/g) is the SMALL-ANGLE result. This scenario exists to
    // show where that breaks, so handing over a 170-degree swing would be
    // handing over the very approximation the panel is measuring the error of.
    available: (p) => (p.theta0Deg > 15
      ? `T = 2π√(L/g) is the small-angle result. At ${p.theta0Deg.toFixed(0)}° the true period is already noticeably longer — see the approximation error above. Reduce the amplitude below 15° to hand it over.`
      : null),
    variant: "osc_pendulum",
    knowns: (p) => ({ L_pend: p.L }),
  },
  draw: drawPendulum,
};

/* --- 5. Cart collision --------------------------------------------------- */
SCENARIOS.collision = {
  label: "Cart collision",
  group: "Momentum",
  ariaLabel: "Two carts colliding on a track",
  blurb: "Two carts on a frictionless track. The coefficient of restitution sets what happens on contact: 1 is perfectly elastic, 0 makes them stick together.",
  defaults: { m1: 2, m2: 3, u1: 3, u2: -1, e: 1 },
  controls: [
    { key: "m1", label: "Mass of cart 1", min: 0.5, max: 10, step: 0.1, unit: "kg" },
    { key: "m2", label: "Mass of cart 2", min: 0.5, max: 10, step: 0.1, unit: "kg" },
    { key: "u1", label: "Cart 1 initial velocity", min: -6, max: 6, step: 0.1, unit: "m/s" },
    { key: "u2", label: "Cart 2 initial velocity", min: -6, max: 6, step: 0.1, unit: "m/s" },
    { key: "e", label: "Restitution e", min: 0, max: 1, step: 0.05, unit: "" },
  ],
  state0: (p) => ({ x1: -1.4, v1: p.u1, x2: 1.4, v2: p.u2 }),
  derivatives(state) {
    return { x1: state.v1, v1: 0, x2: state.v2, v2: 0 };   // free between impacts
  },
  events: [
    {
      // Contact when the gap closes.
      detect: (s) => (s.x2 - s.x1) - 0.34,
      terminal: false,
      // Impulsive collision: conserve momentum, apply restitution to the
      // relative velocity. e = 1 recovers the elastic result exactly, e = 0
      // gives a common final velocity.
      apply(s, p) {
        if (s.v1 - s.v2 <= 0) return null;     // separating already
        const M = p.m1 + p.m2;
        const vRel = s.v1 - s.v2;
        const v1 = (p.m1 * s.v1 + p.m2 * s.v2 - p.m2 * p.e * vRel) / M;
        const v2 = (p.m1 * s.v1 + p.m2 * s.v2 + p.m1 * p.e * vRel) / M;
        return { ...s, v1, v2 };
      },
    },
    { detect: (s) => 4.2 - Math.abs(s.x1), terminal: true },
    { detect: (s) => 4.2 - Math.abs(s.x2), terminal: true },
  ],
  isStatic: (p) => Math.abs(p.u1) < 1e-9 && Math.abs(p.u2) < 1e-9,
  readouts(p, sim) {
    const pTot = p.m1 * sim.state.v1 + p.m2 * sim.state.v2;
    const kNow = 0.5 * p.m1 * sim.state.v1 ** 2 + 0.5 * p.m2 * sim.state.v2 ** 2;
    const k0 = 0.5 * p.m1 * p.u1 ** 2 + 0.5 * p.m2 * p.u2 ** 2;
    return [
      ["Total momentum", `${pTot.toFixed(3)} kg·m/s`],
      ["Kinetic energy", `${kNow.toFixed(3)} J`],
      ["KE retained", `${k0 > 0 ? ((kNow / k0) * 100).toFixed(1) : "100.0"} %`],
      ["v₁ , v₂", `${sim.state.v1.toFixed(2)} , ${sim.state.v2.toFixed(2)} m/s`],
    ];
  },
  handoff: {
    chapter: "collisions",
    // Only the two ENDS of the restitution range have a closed-form chapter.
    // Routing e = 0.6 to "elastic" answered -1.8 m/s for a collision the
    // sandbox had just measured at -0.84 m/s, under a heading claiming
    // kinetic energy was conserved.
    available: (p) => (p.e > 0.001 && p.e < 0.999
      ? `The solver models the two limiting cases: perfectly elastic (e = 1) and perfectly inelastic (e = 0). At e = ${p.e.toFixed(2)} this collision is neither, so its final speeds come from the simulation only. Set e to 0 or 1 to hand it over.`
      : null),
    variant: (p) => (p.e >= 0.999 ? "collisions_elastic" : "collisions_inelastic"),
    knowns: (p) => (p.e >= 0.999
      ? { m1: p.m1, m2: p.m2, v1i: p.u1, v2i: p.u2, _elastic: true }
      : { m1: p.m1, m2: p.m2, v1i: p.u1, v2i: p.u2 }),
  },
  draw: drawCollision,
};

/* --- 6. Newton's cradle -------------------------------------------------- */
SCENARIOS.cradle = {
  label: "Newton's cradle",
  group: "Momentum",
  ariaLabel: "A row of suspended balls in a Newton's cradle",
  blurb: "Identical balls hang in contact. Each is a pendulum; when two touch they exchange velocity, which is what an elastic collision between equal masses does.",
  defaults: { n: 5, lifted: 1, theta0Deg: 32, L: 1.0 },
  controls: [
    { key: "n", label: "Number of balls", min: 3, max: 7, step: 1, unit: "" },
    { key: "lifted", label: "Balls pulled back", min: 1, max: 3, step: 1, unit: "" },
    { key: "theta0Deg", label: "Release angle", min: 5, max: 60, step: 1, unit: "°" },
  ],
  state0: (p) => {
    const s = {};
    const n = Math.round(p.n), lifted = Math.min(Math.round(p.lifted), n - 1);
    for (let i = 0; i < n; i++) {
      s[`th${i}`] = i < lifted ? -(p.theta0Deg * Math.PI) / 180 : 0;
      s[`w${i}`] = 0;
    }
    return s;
  },
  derivatives(state, p) {
    const d = {};
    const n = Math.round(p.n);
    for (let i = 0; i < n; i++) {
      d[`th${i}`] = state[`w${i}`];
      d[`w${i}`] = -(GRAVITY / p.L) * Math.sin(state[`th${i}`]);
    }
    return d;
  },
  events: [
    {
      // Only a pair that is actually CLOSING can collide. Measuring the gap
      // across every pair meant the balls resting in contact contributed a
      // gap of exactly zero, so the detector sat at zero from the first
      // instant and the event could never arm — the swinging ball passed
      // straight through the stack and nothing else ever moved.
      detect: (s, p) => {
        const n = Math.round(p.n);
        let closest = 1;                       // positive while nothing approaches
        for (let i = 0; i < n - 1; i++) {
          if (s[`w${i}`] > s[`w${i + 1}`] + 1e-9) {
            closest = Math.min(closest, s[`th${i + 1}`] - s[`th${i}`]);
          }
        }
        return closest;
      },
      terminal: false,
      // Equal masses colliding elastically exchange velocities. The swap has
      // to cascade: the impulse travels through every ball in contact within
      // a single event, which is exactly why the far ball is the one that
      // flies out.
      apply(s, p) {
        const n = Math.round(p.n);
        const out = { ...s };
        let changed = false;
        for (let pass = 0; pass < n; pass++) {
          let swapped = false;
          for (let i = 0; i < n - 1; i++) {
            const touching = out[`th${i + 1}`] - out[`th${i}`] <= 1e-6;
            if (touching && out[`w${i}`] > out[`w${i + 1}`] + 1e-9) {
              const tmp = out[`w${i}`];
              out[`w${i}`] = out[`w${i + 1}`];
              out[`w${i + 1}`] = tmp;
              swapped = true;
              changed = true;
            }
          }
          if (!swapped) break;
        }
        return changed ? out : null;
      },
    },
  ],
  isStatic: () => false,
  readouts(p, sim) {
    const n = Math.round(p.n);
    let moving = 0, ke = 0;
    for (let i = 0; i < n; i++) {
      const w = sim.state[`w${i}`];
      if (Math.abs(w) > 0.05) moving++;
      ke += 0.5 * p.L * p.L * w * w;
    }
    return [
      ["Balls", `${n}`],
      ["Currently moving", `${moving}`],
      ["Total KE (per kg)", `${ke.toFixed(3)} J`],
      ["Period of one swing", `${(2 * Math.PI * Math.sqrt(p.L / GRAVITY)).toFixed(2)} s`],
    ];
  },
  handoff: null,
  draw: drawCradle,
};

/* --- 7. Rocket launch ---------------------------------------------------- */
SCENARIOS.rocket = {
  label: "Rocket launch",
  group: "Forces & Newton's laws",
  ariaLabel: "A rocket ascending under thrust",
  blurb: "A rocket burning fuel. Mass falls as propellant is expelled, so the acceleration climbs during the burn even though the thrust is constant.",
  defaults: { m0: 500, fuel: 300, thrust: 9000, burn: 40 },
  controls: [
    { key: "m0", label: "Dry mass", min: 100, max: 1200, step: 10, unit: "kg" },
    { key: "fuel", label: "Fuel mass", min: 0, max: 900, step: 10, unit: "kg" },
    { key: "thrust", label: "Thrust", min: 1000, max: 30000, step: 100, unit: "N" },
    { key: "burn", label: "Burn rate", min: 5, max: 120, step: 1, unit: "kg/s" },
  ],
  state0: (p) => ({ y: 0, v: 0, fuel: p.fuel }),
  // Variable mass: the vehicle gets lighter as it burns, so a = (T − mg)/m
  // rises through the burn. Thrust cuts out when the tanks run dry.
  derivatives(state, p) {
    const burning = state.fuel > 0;
    const m = p.m0 + Math.max(state.fuel, 0);
    const thrust = burning ? p.thrust : 0;
    return { y: state.v, v: thrust / m - GRAVITY, fuel: burning ? -p.burn : 0 };
  },
  events: [
    // Touchdown. Only armed while descending, so sitting on the pad at y = 0
    // with v = 0 does not count as landing before the thing has even left.
    // Guarding on altitude instead made the detector go POSITIVE on landing,
    // which meant it never crossed zero and the rocket fell through the pad.
    { detect: (s) => (s.v < 0 ? s.y : 1), terminal: true },
    { detect: (s) => 4000 - s.y, terminal: true },
  ],
  maxDuration: 300,
  isStatic: (p) => p.thrust <= p.m0 * GRAVITY && p.fuel <= 0,
  readouts(p, sim) {
    const m = p.m0 + Math.max(sim.state.fuel, 0);
    const a = (sim.state.fuel > 0 ? p.thrust : 0) / m - GRAVITY;
    return [
      ["Current mass", `${m.toFixed(0)} kg`],
      ["Acceleration", `${a.toFixed(2)} m/s²`],
      ["Speed", `${sim.state.v.toFixed(1)} m/s`],
      ["Altitude", `${sim.state.y.toFixed(1)} m`],
      ["Fuel left", `${Math.max(sim.state.fuel, 0).toFixed(0)} kg`],
    ];
  },
  handoff: null,
  draw: drawRocket,
};

/* --- 8. Roller-coaster loop ---------------------------------------------- */
/* ============================================================================
   the roller-coaster track
   ----------------------------------------------------------------------------
   The cart used to be placed by angle around the loop alone, which meant the
   ride began halfway through the story -- already at the bottom, already at
   speed -- and the drop that gave it that speed was asserted rather than
   shown.

   Here the track is a real curve: a release hill, a run-in, the vertical loop,
   and a run-out. The cart's state is arc length along it, so by construction
   it can never leave the rails or float above them. Its speed follows from the
   tangential component of gravity, which is exactly energy conservation
   expressed as an equation of motion.
   ========================================================================== */

const COASTER_SAMPLES = 900;
let coasterCache = null;

/* Build the track once per (R, h) and cache it. Sampling densely and storing
   cumulative arc length is what makes the motion smooth: interpolating along
   real arc length gives constant speed a constant screen pace, where
   interpolating a parameter would speed up and slow down for free. */
function coasterTrack(p) {
  if (coasterCache && coasterCache.R === p.R && coasterCache.h === p.h) return coasterCache;

  const R = p.R;
  const h = Math.max(p.h, 0.05);
  const hillRun = Math.max(h * 1.6, 4);        // horizontal extent of the drop
  const runIn = R * 1.6;
  const runOut = R * 2.4;

  const pts = [];
  const push = (x, y) => pts.push({ x, y });

  // --- the release hill: a raised cosine, so the slope is zero at the crest
  // and at the foot. A straight ramp would put a kink at the bottom, and a
  // kink is infinite curvature -- the normal force would spike there.
  const nHill = Math.round(COASTER_SAMPLES * 0.34);
  for (let i = 0; i <= nHill; i++) {
    const u = i / nHill;
    push(u * hillRun, (h / 2) * (1 + Math.cos(Math.PI * u)));
  }
  // --- flat run-in
  const nFlat = Math.round(COASTER_SAMPLES * 0.08);
  for (let i = 1; i <= nFlat; i++) push(hillRun + (i / nFlat) * runIn, 0);

  // --- the loop, entered at its bottom and traversed once
  const loopX = hillRun + runIn;
  const nLoop = Math.round(COASTER_SAMPLES * 0.42);
  for (let i = 1; i <= nLoop; i++) {
    const th = (i / nLoop) * Math.PI * 2;
    push(loopX + R * Math.sin(th), R * (1 - Math.cos(th)));
  }
  // --- run-out
  const nOut = COASTER_SAMPLES - pts.length;
  for (let i = 1; i <= nOut; i++) push(loopX + (i / nOut) * runOut, 0);

  // cumulative arc length, plus the tangent angle at each sample
  const sArr = [0];
  for (let i = 1; i < pts.length; i++) {
    sArr.push(sArr[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  // Arc-length bounds of the circular section, so the curvature there can be
  // taken from the geometry rather than measured off the samples.
  const loopI0 = nHill + nFlat;
  coasterCache = {
    R, h, pts, s: sArr, total: sArr[sArr.length - 1], loopX, loopStart: hillRun + runIn,
    loopS0: sArr[loopI0], loopS1: sArr[loopI0 + nLoop],
  };
  return coasterCache;
}

/* Where the cart is, and which way the track is pointing, at arc length s. */
function coasterAt(track, s) {
  const arr = track.s;
  const clamped = clamp(s, 0, track.total);
  // binary search rather than a linear scan: this runs inside the integrator
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= clamped) lo = mid; else hi = mid;
  }
  const span = arr[hi] - arr[lo] || 1e-9;
  const f = (clamped - arr[lo]) / span;
  const a = track.pts[lo], b = track.pts[hi];
  const x = a.x + (b.x - a.x) * f;
  const y = a.y + (b.y - a.y) * f;

  // Tangent from a wider stencil than one segment, so the direction does not
  // jitter between samples.
  const i0 = Math.max(0, lo - 1), i1 = Math.min(track.pts.length - 1, hi + 1);
  const dx = track.pts[i1].x - track.pts[i0].x;
  const dy = track.pts[i1].y - track.pts[i0].y;
  const len = Math.hypot(dx, dy) || 1e-9;
  return { x, y, tx: dx / len, ty: dy / len, slope: Math.atan2(dy, dx) };
}

/* Local curvature, which sets how much of gravity the track has to fight. On
   the flat it is zero; round the loop it is 1/R. Measured from the sampled
   points rather than assumed, so the hill's own curve counts too. */
function coasterCurvature(track, s) {
  // Inside the loop the track IS a circle of radius R, so its curvature is
  // known exactly. Measuring it from three points off the sampled polyline
  // instead put them a shade inside the true arc, which made the circumradius
  // small and the normal force at the top read about 1.6% high -- next to an
  // answer panel, on the same screen, quoting the exact figure.
  if (track.loopS0 !== undefined && s >= track.loopS0 && s <= track.loopS1) {
    return 1 / track.R;
  }
  const d = Math.max(track.total * 0.004, 0.05);
  const a = coasterAt(track, s - d);
  const b = coasterAt(track, s);
  const c = coasterAt(track, s + d);
  const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const l1 = Math.hypot(b.x - a.x, b.y - a.y);
  const l2 = Math.hypot(c.x - b.x, c.y - b.y);
  const l3 = Math.hypot(c.x - a.x, c.y - a.y);
  const denom = l1 * l2 * l3;
  if (denom < 1e-12) return 0;
  return (2 * cross) / denom;
}

SCENARIOS.coaster = {
  label: "Roller-coaster loop",
  group: "Energy & circular motion",
  ariaLabel: "A cart released from a hill, running down and round a vertical loop",
  blurb: "Release the cart at the top of the hill and watch it run. Its speed everywhere comes from the height it has given up, and the track can only PUSH — so if the release is too low the cart leaves the rails at the top of the loop.",
  defaults: { R: 3, h: 9, m: 200 },
  controls: [
    { key: "R", label: "Loop radius R", min: 1, max: 6, step: 0.1, unit: "m" },
    { key: "h", label: "Release height", min: 1, max: 25, step: 0.25, unit: "m" },
    { key: "m", label: "Cart mass", min: 50, max: 800, step: 10, unit: "kg" },
  ],
  // Released from rest at the crest, so the ride starts where the story does.
  state0: () => ({ s: 0, v: 0 }),
  derivatives(state, p) {
    const track = coasterTrack(p);
    const at = coasterAt(track, state.s);
    // Only the component of gravity ALONG the track accelerates the cart. The
    // perpendicular component is what the rails absorb, and that is the
    // normal force the readout reports.
    return { s: state.v, v: -GRAVITY * Math.sin(at.slope) };
  },
  events: [
    {
      // The rails can push, never pull. N = m(v^2*kappa + g*cos(slope)) with
      // kappa the local curvature; when that would go negative the cart is no
      // longer on the track.
      detect: (s, p) => {
        const track = coasterTrack(p);
        const at = coasterAt(track, s.s);
        const kappa = coasterCurvature(track, s.s);
        return s.v * s.v * kappa + GRAVITY * Math.cos(at.slope);
      },
      terminal: true,
      reason: "left the rails — the track cannot pull inward",
    },
    { detect: (s, p) => coasterTrack(p).total - s.s, terminal: true, reason: "completed the circuit" },
    {
      // Rolled backwards off the start: it never had the height to get round.
      detect: (s) => s.s + 0.001,
      terminal: true,
      reason: "rolled back down — it never reached the loop",
    },
  ],
  isStatic: (p) => p.h <= 0,
  maxDuration: 40,
  readouts(p, sim) {
    const track = coasterTrack(p);
    const at = coasterAt(track, sim.state.s);
    const kappa = coasterCurvature(track, sim.state.s);
    const v = sim.state.v;
    const N = p.m * (v * v * kappa + GRAVITY * Math.cos(at.slope));
    const inLoop = sim.state.s > 0 && at.x >= track.loopStart - 0.01 && at.y > 0.01;
    return [
      ["Height", `${at.y.toFixed(2)} m   of ${p.h.toFixed(2)} m released from`],
      ["Speed", `${Math.abs(v).toFixed(2)} m/s`],
      ["Speed from energy", `${Math.sqrt(Math.max(2 * GRAVITY * (p.h - at.y), 0)).toFixed(2)} m/s`],
      ["Normal force", `${N.toFixed(0)} N`],
      ["Where", inLoop ? "in the loop" : at.y > 0.05 ? "on the hill" : "on the flat"],
      ["Minimum release height", `${(2.5 * p.R).toFixed(2)} m   (h > 2.5R)`],
    ];
  },
  // The closed form for comparison: energy conservation, which the integrator
  // never consults. Agreement is evidence, not bookkeeping.
  analytic(t, p) {
    return null;
  },
  handoff: {
    chapter: "classicProblems", variant: "loop_coaster",
    knowns: (p) => ({ R_loop: p.R, h_loop: p.h, mass_loop: p.m }),
  },
  draw: drawCoaster,
};

SCENARIOS.coaster.trailPoint = (s) => {
  const track = coasterCache;
  if (!track) return null;
  const at = coasterAt(track, s.s);
  return { x: at.x, y: at.y };
};

/* --- 9. Block on an incline ---------------------------------------------- */
SCENARIOS.incline = {
  label: "Block on a ramp",
  group: "Forces & Newton's laws",
  ariaLabel: "A block on an inclined plane",
  blurb: "A block on a slope. It stays put while gravity's pull along the surface stays below what static friction can supply, then slides once it does not.",
  defaults: { m: 4, angleDeg: 30, mu: 0.35, length: 4 },
  controls: [
    { key: "angleDeg", label: "Ramp angle", min: 5, max: 75, step: 1, unit: "°" },
    { key: "mu", label: "Friction μ", min: 0, max: 1.2, step: 0.01, unit: "" },
    { key: "m", label: "Block mass", min: 0.5, max: 20, step: 0.5, unit: "kg" },
  ],
  state0: () => ({ s: 0, v: 0 }),
  derivatives(state, p) {
    const th = (p.angleDeg * Math.PI) / 180;
    const driving = GRAVITY * Math.sin(th);
    const maxStatic = p.mu * GRAVITY * Math.cos(th);
    // Below the static threshold and at rest, nothing moves at all.
    if (Math.abs(state.v) < 1e-6 && driving <= maxStatic) return { s: 0, v: 0 };
    const fric = Math.sign(state.v || 1) * p.mu * GRAVITY * Math.cos(th);
    return { s: state.v, v: driving - fric };
  },
  analytic(t, p) {
    const th = (p.angleDeg * Math.PI) / 180;
    const a = GRAVITY * (Math.sin(th) - p.mu * Math.cos(th));
    if (a <= 0) return { s: 0 };
    return { s: 0.5 * a * t * t };
  },
  events: [{ detect: (s, p) => p.length - s.s, terminal: true }],
  isStatic(p) {
    const th = (p.angleDeg * Math.PI) / 180;
    return Math.tan(th) <= p.mu;
  },
  readouts(p, sim) {
    const th = (p.angleDeg * Math.PI) / 180;
    const a = GRAVITY * (Math.sin(th) - p.mu * Math.cos(th));
    const slips = Math.tan(th) > p.mu;
    return [
      ["Slides?", slips ? "yes" : "no — friction holds it"],
      ["Acceleration", `${(slips ? a : 0).toFixed(3)} m/s²`],
      ["tan θ vs μ", `${Math.tan(th).toFixed(3)} vs ${p.mu.toFixed(2)}`],
      ["Speed", `${sim.state.v.toFixed(2)} m/s`],
    ];
  },
  handoff: {
    chapter: "forces",
    // The forces chapter has no ramp angle, so it cannot resolve weight into
    // components -- and the angle is the whole subject of this scenario.
    available: (p) => (p.angleDeg > 0
      ? `The forces chapter works in one dimension and has no ramp angle, so it cannot resolve the weight into components along a ${p.angleDeg.toFixed(0)}° slope. The acceleration above comes from g(sinθ − μcosθ), which this sandbox computes directly.`
      : null),
    variant: "forces",
    knowns: (p) => ({ mass: p.m, mu: p.mu }),
  },
  draw: drawIncline,
};

/* --- 10. Projectile ------------------------------------------------------ */
SCENARIOS.projectile = {
  label: "Projectile launcher",
  group: "Kinematics",
  ariaLabel: "A projectile following a curved trajectory",
  blurb: "A projectile launched from a chosen height. The horizontal and vertical axes are independent; only the time they share links them.",
  defaults: { v0: 22, angleDeg: 45, y0: 0, drag: 0 },
  controls: [
    { key: "v0", label: "Launch speed", min: 2, max: 60, step: 0.5, unit: "m/s" },
    { key: "angleDeg", label: "Launch angle", min: 1, max: 89, step: 1, unit: "°" },
    { key: "y0", label: "Launch height", min: 0, max: 30, step: 0.5, unit: "m" },
    { key: "drag", label: "Air resistance", min: 0, max: 0.25, step: 0.005, unit: "1/m" },
  ],
  state0: (p) => {
    const th = (p.angleDeg * Math.PI) / 180;
    return { x: 0, y: p.y0, vx: p.v0 * Math.cos(th), vy: p.v0 * Math.sin(th) };
  },
  // Quadratic drag opposes the velocity vector, which couples the two axes
  // and destroys the symmetry of the parabola.
  derivatives(state, p) {
    const speed = Math.hypot(state.vx, state.vy);
    const k = p.drag;
    return {
      x: state.vx,
      y: state.vy,
      vx: -k * speed * state.vx,
      vy: -GRAVITY - k * speed * state.vy,
    };
  },
  analytic(t, p) {
    if (p.drag > 0) return null;
    const th = (p.angleDeg * Math.PI) / 180;
    return { x: p.v0 * Math.cos(th) * t, y: p.y0 + p.v0 * Math.sin(th) * t - 0.5 * GRAVITY * t * t };
  },
  events: [{ detect: (s) => s.y, terminal: true }],
  isStatic: () => false,
  readouts(p, sim) {
    const th = (p.angleDeg * Math.PI) / 180;
    const ideal = (p.v0 ** 2 * Math.sin(2 * th)) / GRAVITY;
    return [
      ["Range so far", `${sim.state.x.toFixed(2)} m`],
      ["Height", `${sim.state.y.toFixed(2)} m`],
      ["Speed", `${Math.hypot(sim.state.vx, sim.state.vy).toFixed(2)} m/s`],
      ["Range if no drag, level", `${ideal.toFixed(2)} m`],
    ];
  },
  handoff: {
    chapter: "projectile",
    // The projectile chapter's relations assume no drag and level ground.
    // With either switched on, the sandbox and the solver are describing
    // different flights -- 6.76 m against 49.39 m at full drag.
    available: (p) => {
      if (p.drag > 0) return `The projectile chapter solves the drag-free case. With drag at ${p.drag.toFixed(3)} the range here is genuinely shorter than any of its formulas predict. Set drag to 0 to hand it over.`;
      if (p.y0 > 0) return `The projectile chapter assumes the launch and landing heights match. Launching from ${p.y0.toFixed(1)} m changes the flight time, so set the launch height to 0 to hand it over.`;
      return null;
    },
    variant: null,
    knowns: (p) => ({ v0_p: p.v0, theta_p: p.angleDeg }),
  },
  draw: drawProjectile,
};

/* --- 11. Flywheel -------------------------------------------------------- */
SCENARIOS.flywheel = {
  label: "Flywheel",
  group: "Rotation",
  ariaLabel: "A rotating disk driven by a torque",
  blurb: "A disk driven by a steady torque against friction at the axle. Its moment of inertia sets how reluctantly it changes speed.",
  defaults: { M: 8, R: 0.5, tau: 6, b: 0.4 },
  controls: [
    { key: "M", label: "Disk mass", min: 1, max: 40, step: 0.5, unit: "kg" },
    { key: "R", label: "Disk radius", min: 0.1, max: 1.5, step: 0.05, unit: "m" },
    { key: "tau", label: "Applied torque", min: 0, max: 40, step: 0.5, unit: "N·m" },
    { key: "b", label: "Axle friction", min: 0, max: 3, step: 0.05, unit: "N·m·s" },
  ],
  state0: () => ({ th: 0, w: 0 }),
  // I = ½MR² for a solid disk; drag torque grows with speed, so ω approaches
  // a terminal value rather than climbing without limit.
  derivatives(state, p) {
    const I = 0.5 * p.M * p.R * p.R;
    return { th: state.w, w: (p.tau - p.b * state.w) / I };
  },
  analytic(t, p) {
    const I = 0.5 * p.M * p.R * p.R;
    if (p.b <= 1e-9) return { th: 0.5 * (p.tau / I) * t * t };
    const wInf = p.tau / p.b;
    return { th: wInf * (t - (I / p.b) * (1 - Math.exp((-p.b * t) / I))) };
  },
  events: [],
  isStatic: (p) => p.tau <= 0,
  readouts(p, sim) {
    const I = 0.5 * p.M * p.R * p.R;
    return [
      ["Moment of inertia", `${I.toFixed(3)} kg·m²`],
      ["Angular velocity", `${sim.state.w.toFixed(2)} rad/s`],
      ["Rotational KE", `${(0.5 * I * sim.state.w ** 2).toFixed(1)} J`],
      ["Terminal ω", p.b > 0 ? `${(p.tau / p.b).toFixed(2)} rad/s` : "unbounded"],
    ];
  },
  handoff: {
    chapter: "rotDynamics",
    available: (p) => (p.b > 0
      ? `Στ = Iα with a constant torque gives a constant angular acceleration. The damping here (b = ${p.b.toFixed(2)}) makes τ depend on ω, so the flywheel approaches a terminal spin instead. Set damping to 0 to hand it over.`
      : null),
    variant: "rotDynamics",
    // mass_dyn and r_dyn are deliberately NOT sent: the rotational chapter
    // would recompute I as m*r^2, the point-mass form, which is double the
    // disk value the sandbox actually uses.
    knowns: (p) => ({ tau: p.tau, I: 0.5 * p.M * p.R * p.R }),
  },
  draw: drawFlywheel,
};

/* --- 12. Orbit ----------------------------------------------------------- */
/* One Earth radius, used by the surface-impact event, the altitude readout
 * and the drawing alike. Two different values were in play, so the readout
 * showed altitudes down to -171 km before impact registered. */
const EARTH_RADIUS = 6.371e6;

/* Orbital elements recovered from the integrated state. Nothing here is fed
 * in as a parameter: a, e and T are DERIVED from position and velocity, so
 * the readout is a measurement of the simulation rather than a restatement of
 * its inputs. That is what makes Kepler's laws checkable here instead of
 * merely illustrated. */
function orbitalElements(state, Mcentral) {
  const mu = GRAV_CONSTANT * Mcentral;
  const r = Math.hypot(state.x, state.y) || 1;
  const v = Math.hypot(state.vx, state.vy);
  // Specific orbital energy. Negative means bound; zero is exactly escape.
  const eps = (v * v) / 2 - mu / r;
  // Specific angular momentum, the conserved quantity behind Kepler II.
  const h = state.x * state.vy - state.y * state.vx;
  const bound = eps < 0;
  const a = bound ? -mu / (2 * eps) : Infinity;
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (mu * mu)));
  return {
    r, v, h, eps, bound, a, e,
    T: bound ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity,
    rPeri: bound ? a * (1 - e) : NaN,
    rApo: bound ? a * (1 + e) : NaN,
    vEsc: Math.sqrt((2 * mu) / r),
  };
}

SCENARIOS.orbit = {
  label: "Orbit",
  group: "Gravitation",
  ariaLabel: "A satellite orbiting a central body",
  blurb: "A satellite around a central body. Gravity always points at the centre, so the speed it is given sideways decides whether the path is a circle, an ellipse, or an escape.",
  defaults: { Mcentral: 5.972e24, r0: 7.0e6, speedFactor: 1.0 },
  controls: [
    { key: "r0", label: "Starting radius", min: 6.6e6, max: 4.2e7, step: 1e5, unit: "m" },
    { key: "speedFactor", label: "Speed vs circular", min: 0.55, max: 1.42, step: 0.005, unit: "×" },
  ],
  state0: (p) => {
    const vCirc = Math.sqrt((GRAV_CONSTANT * p.Mcentral) / p.r0);
    return { x: p.r0, y: 0, vx: 0, vy: vCirc * p.speedFactor };
  },
  // Inverse-square central force, in two dimensions. Nothing here is a
  // closed-form orbit; the shape emerges from the integration.
  derivatives(state, p) {
    const G = GRAV_CONSTANT;
    const r = Math.hypot(state.x, state.y) || 1;
    const acc = (-G * p.Mcentral) / (r * r * r);
    return { x: state.vx, y: state.vy, vx: acc * state.x, vy: acc * state.y };
  },
  events: [
    { detect: (s) => Math.hypot(s.x, s.y) - EARTH_RADIUS, terminal: true },  // struck the surface
    { detect: (s, p) => 12 * p.r0 - Math.hypot(s.x, s.y), terminal: true },  // escaped the view
  ],
  isStatic: () => false,
  timeScale: 900,        // orbital periods run to hours; compress them
  step: 2,               // seconds per step: ~2900 per orbit, ample for RK4
  maxDuration: 40000,    // roughly six low orbits, or a full escape
  readouts(p, sim) {
    const el = orbitalElements(sim.state, p.Mcentral);
    const rows = [
      ["Altitude", `${((el.r - EARTH_RADIUS) / 1000).toFixed(0)} km`],
      ["Speed", `${(el.v / 1000).toFixed(3)} km/s`],
      ["Escape speed here", `${(el.vEsc / 1000).toFixed(3)} km/s`],
    ];
    if (el.bound) {
      rows.push(
        ["Semi-major axis a", `${(el.a / 1000).toFixed(0)} km`],
        ["Eccentricity e", el.e.toFixed(4)],
        ["Period (Kepler III)", `${(el.T / 60).toFixed(1)} min`],
        ["Perigee / apogee", `${(el.rPeri / 1000).toFixed(0)} / ${(el.rApo / 1000).toFixed(0)} km`],
        // Kepler's second law, measured rather than asserted: this product is
        // the specific angular momentum, and it must not move.
        ["r × v_perp (Kepler II)", el.h.toExponential(6)],
      );
    } else {
      rows.push(["Path", "unbound — escaping"]);
    }
    return rows;
  },
  handoff: {
    chapter: "orbital",
    variant: null,
    knowns: (p) => ({ M_central: p.Mcentral, R_body: EARTH_RADIUS, r_orb: p.r0 }),
  },
  draw: drawOrbit,
};

SCENARIOS.kepler = {
  label: "Kepler's Third Law",
  group: "Gravitation",
  ariaLabel: "Live simulation of three satellites at different orbital radii, comparing their periods",
  blurb: "Three satellites at different radii, integrated side by side. Watch the outer one fall behind, then read T\u00b2/a\u00b3 off the panel and find it is the same number for all three.",
  defaults: { Mcentral: 5.972e24, r1: 8.0e6, r2: 1.4e7, r3: 2.4e7 },
  controls: [
    { key: "r1", label: "Inner radius", min: 6.6e6, max: 1.2e7, step: 1e5, unit: "m" },
    { key: "r2", label: "Middle radius", min: 1.2e7, max: 2.0e7, step: 1e5, unit: "m" },
    { key: "r3", label: "Outer radius", min: 2.0e7, max: 4.2e7, step: 1e5, unit: "m" },
  ],
  // Three independent two-body problems sharing one clock. Each starts on a
  // circular orbit, so any difference in how far round they get is entirely
  // the period difference Kepler's third law predicts.
  state0: (p) => {
    const circ = (r) => Math.sqrt((GRAV_CONSTANT * p.Mcentral) / r);
    return {
      x1: p.r1, y1: 0, vx1: 0, vy1: circ(p.r1),
      x2: p.r2, y2: 0, vx2: 0, vy2: circ(p.r2),
      x3: p.r3, y3: 0, vx3: 0, vy3: circ(p.r3),
    };
  },
  derivatives(state, p) {
    const mu = GRAV_CONSTANT * p.Mcentral;
    const pull = (x, y) => {
      const r = Math.hypot(x, y) || 1;
      const k = -mu / (r * r * r);
      return [k * x, k * y];
    };
    const [ax1, ay1] = pull(state.x1, state.y1);
    const [ax2, ay2] = pull(state.x2, state.y2);
    const [ax3, ay3] = pull(state.x3, state.y3);
    return {
      x1: state.vx1, y1: state.vy1, vx1: ax1, vy1: ay1,
      x2: state.vx2, y2: state.vy2, vx2: ax2, vy2: ay2,
      x3: state.vx3, y3: state.vy3, vx3: ax3, vy3: ay3,
    };
  },
  events: [],
  isStatic: () => false,
  timeScale: 900,
  step: 2,
  maxDuration: 200000,
  readouts(p, sim) {
    const mu = GRAV_CONSTANT * p.Mcentral;
    const T = (r) => 2 * Math.PI * Math.sqrt((r * r * r) / mu);
    // T^2/a^3 = 4*pi^2/(G*M) for every orbit around the same body, whatever
    // its size. Printing all three side by side is the law itself.
    const ratio = (r) => (T(r) ** 2 / r ** 3).toExponential(4);
    return [
      ["Inner  T", `${(T(p.r1) / 3600).toFixed(2)} h`],
      ["Middle T", `${(T(p.r2) / 3600).toFixed(2)} h`],
      ["Outer  T", `${(T(p.r3) / 3600).toFixed(2)} h`],
      ["T\u00b2/a\u00b3 inner", ratio(p.r1)],
      ["T\u00b2/a\u00b3 middle", ratio(p.r2)],
      ["T\u00b2/a\u00b3 outer", ratio(p.r3)],
      ["4\u03c0\u00b2/GM", (4 * Math.PI ** 2 / mu).toExponential(4)],
    ];
  },
  handoff: {
    chapter: "orbital",
    variant: null,
    knowns: (p) => ({ M_central: p.Mcentral, R_body: EARTH_RADIUS, a_semi: p.r1, e_orb: 0 }),
  },
  draw: drawKepler,
};

SCENARIOS.hohmann = {
  label: "Hohmann Transfer",
  group: "Gravitation",
  ariaLabel: "Live simulation of a two-burn Hohmann transfer between two circular orbits",
  blurb: "The cheapest way between two circular orbits: burn once to raise apogee, coast half an ellipse, burn again to circularise. Both burns are applied as real impulses, and the coast is integrated like any other orbit.",
  defaults: { Mcentral: 5.972e24, r1: 7.0e6, r2: 4.2e7 },
  controls: [
    { key: "r1", label: "Starting orbit", min: 6.6e6, max: 1.5e7, step: 1e5, unit: "m" },
    { key: "r2", label: "Target orbit", min: 1.6e7, max: 6.0e7, step: 2e5, unit: "m" },
  ],
  // The first burn is already applied at t = 0: the craft leaves on the
  // transfer ellipse whose perigee is r1 and whose apogee is r2.
  state0: (p) => {
    const mu = GRAV_CONSTANT * p.Mcentral;
    const aT = (p.r1 + p.r2) / 2;
    return { x: p.r1, y: 0, vx: 0, vy: Math.sqrt(mu * (2 / p.r1 - 1 / aT)), burned: 0 };
  },
  derivatives(state, p) {
    const mu = GRAV_CONSTANT * p.Mcentral;
    const r = Math.hypot(state.x, state.y) || 1;
    const k = -mu / (r * r * r);
    return { x: state.vx, y: state.vy, vx: k * state.x, vy: k * state.y, burned: 0 };
  },
  events: [
    {
      // Apogee arrival: the radial velocity crosses zero going outward. The
      // second burn is an impulse, so it is applied to the state rather than
      // folded into the derivatives -- exactly how a real manoeuvre is modelled.
      // x*vx + y*vy is r*(radial velocity): positive while climbing away,
      // zero exactly at apogee, negative on the way back down. The detector
      // wants that downward crossing, so it must NOT be negated.
      detect: (s) => (s.burned ? 1 : s.x * s.vx + s.y * s.vy),
      apply: (s, p) => {
        const mu = GRAV_CONSTANT * p.Mcentral;
        const r = Math.hypot(s.x, s.y) || 1;
        const speed = Math.hypot(s.vx, s.vy) || 1;
        const target = Math.sqrt(mu / r);      // circular speed at the new radius
        const scale = target / speed;
        return { ...s, vx: s.vx * scale, vy: s.vy * scale, burned: 1 };
      },
    },
  ],
  isStatic: () => false,
  timeScale: 900,
  step: 2,
  maxDuration: 200000,
  readouts(p, sim) {
    const mu = GRAV_CONSTANT * p.Mcentral;
    const aT = (p.r1 + p.r2) / 2;
    const v1 = Math.sqrt(mu / p.r1);
    const vPeri = Math.sqrt(mu * (2 / p.r1 - 1 / aT));
    const v2 = Math.sqrt(mu / p.r2);
    const vApo = Math.sqrt(mu * (2 / p.r2 - 1 / aT));
    const tTransfer = Math.PI * Math.sqrt((aT * aT * aT) / mu);
    const el = orbitalElements(sim.state, p.Mcentral);
    return [
      ["Burn 1 \u0394v", `${(vPeri - v1).toFixed(1)} m/s`],
      ["Burn 2 \u0394v", `${(v2 - vApo).toFixed(1)} m/s`],
      ["Total \u0394v", `${((vPeri - v1) + (v2 - vApo)).toFixed(1)} m/s`],
      ["Transfer time", `${(tTransfer / 3600).toFixed(2)} h`],
      ["Transfer a", `${(aT / 1000).toFixed(0)} km`],
      ["Now: e", el.bound ? el.e.toFixed(4) : "unbound"],
      ["Second burn", sim.state.burned ? "done \u2014 orbit circularised" : "pending at apogee"],
    ];
  },
  handoff: {
    chapter: "orbital",
    variant: null,
    knowns: (p) => ({
      M_central: p.Mcentral, R_body: EARTH_RADIUS,
      r_peri: p.r1, r_apo: p.r2, a_semi: (p.r1 + p.r2) / 2,
    }),
  },
  draw: drawHohmann,
};

SCENARIOS.rampSlide = {
  label: "Block on an incline",
  group: "Forces & Newton's laws",
  ariaLabel: "Live simulation of a block sliding on an inclined plane with friction",
  blurb: "Raise the angle until the block breaks away. Below the critical angle tanθ = μₛ nothing moves however long you wait; above it, the block accelerates at g(sinθ − μₖcosθ).",
  defaults: { m: 4, angleDeg: 30, muS: 0.5, muK: 0.35, length: 5 },
  controls: [
    { key: "angleDeg", label: "Ramp angle", min: 0, max: 60, step: 1, unit: "°" },
    { key: "muS", label: "Static μₛ", min: 0, max: 1.2, step: 0.01, unit: "" },
    { key: "muK", label: "Kinetic μₖ", min: 0, max: 1.2, step: 0.01, unit: "" },
    { key: "m", label: "Mass", min: 0.5, max: 20, step: 0.5, unit: "kg" },
  ],
  state0: () => ({ s: 0, v: 0 }),
  // Coulomb friction is a piecewise law, and the piece that applies depends on
  // whether the block is already moving. Getting this wrong -- applying the
  // kinetic form to a stationary block -- makes a resting block creep.
  derivatives(state, p) {
    const th = (p.angleDeg * Math.PI) / 180;
    const along = GRAVITY * Math.sin(th);
    const normal = GRAVITY * Math.cos(th);
    if (Math.abs(state.v) < 1e-6) {
      // At rest: static friction matches the pull, up to its ceiling.
      if (along <= p.muS * normal) return { s: 0, v: 0 };
      // It has broken away, but kinetic friction can still exceed the pull if
      // mu_k > mu_s. Letting that through pushed a resting block UP the slope
      // and made it chatter -- exactly what the note above says must not happen.
      return { s: state.v, v: Math.max(0, along - p.muK * normal) };
    }
    return { s: state.v, v: along - Math.sign(state.v) * p.muK * normal };
  },
  events: [
    { detect: (s, p) => p.length - s.s, terminal: true, reason: "reached the bottom of the slope" },
  ],
  // A block that cannot overcome static friction never moves at all, and the
  // panel says so rather than sitting at zero with no explanation.
  isStatic: (p) => {
    const th = (p.angleDeg * Math.PI) / 180;
    // Held by static friction, OR broken away but unable to accelerate.
    return Math.sin(th) <= p.muS * Math.cos(th) || Math.sin(th) <= p.muK * Math.cos(th);
  },
  maxDuration: 30,
  analytic(t, p) {
    const th = (p.angleDeg * Math.PI) / 180;
    const a = GRAVITY * (Math.sin(th) - p.muK * Math.cos(th));
    if (a <= 0) return null;
    return { s: 0.5 * a * t * t, v: a * t };
  },
  readouts(p, sim) {
    const th = (p.angleDeg * Math.PI) / 180;
    const N = p.m * GRAVITY * Math.cos(th);
    const pull = p.m * GRAVITY * Math.sin(th);
    const ceiling = p.muS * N;
    const crit = (Math.atan(p.muS) * 180) / Math.PI;
    const a = GRAVITY * (Math.sin(th) - p.muK * Math.cos(th));
    return [
      ["Normal force N", `${N.toFixed(2)} N   (mg = ${(p.m * GRAVITY).toFixed(2)} N)`],
      ["Pull along slope", `${pull.toFixed(2)} N`],
      ["Static ceiling μₛN", `${ceiling.toFixed(2)} N`],
      ["Critical angle", `${crit.toFixed(1)}°`],
      // Breaking away is not the same as moving: with mu_k above mu_s the
      // block passes the static ceiling and kinetic friction still stops it
      // dead. Reporting "slides" there contradicted a block sitting still.
      ["Verdict", pull <= ceiling
        ? "holds — static friction is enough"
        : (a <= 0 ? "breaks away, but kinetic friction stops it — μₖ exceeds tanθ" : "slides")],
      ["Acceleration", `${Math.max(a, 0).toFixed(3)} m/s²   (mass cancels)`],
      ["Distance / speed", `${sim.state.s.toFixed(2)} m   ${sim.state.v.toFixed(2)} m/s`],
    ];
  },
  handoff: {
    chapter: "classicProblems", variant: "ramp",
    knowns: (p) => ({ mass_r: p.m, theta_ramp: p.angleDeg, mu_s_r: p.muS, mu_k_r: p.muK, d_ramp: p.length }),
  },
  draw: drawRampSlide,
};

SCENARIOS.elevator = {
  label: "Elevator & scale",
  group: "Forces & Newton's laws",
  ariaLabel: "Live simulation of a rider on a scale in an accelerating elevator",
  blurb: "Ride a full trip and watch the scale. It reads high while the lift speeds up, exactly mg while it cruises, low while it slows — and zero if you cut the cable.",
  defaults: { m: 70, aUp: 2.0, cruise: 3, cut: 0, down: 0 },
  controls: [
    { key: "m", label: "Rider mass", min: 20, max: 150, step: 1, unit: "kg" },
    { key: "aUp", label: "Acceleration", min: 0.2, max: 6, step: 0.1, unit: "m/s²" },
    { key: "cruise", label: "Cruise time", min: 1, max: 8, step: 0.5, unit: "s" },
    { key: "down", label: "Travel downward", min: 0, max: 1, step: 1, unit: "" },
    { key: "cut", label: "Cut the cable", min: 0, max: 1, step: 1, unit: "" },
  ],
  // Both trips start at y = 0 and the DRAWING decides where that sits: an
  // up-trip's world runs 0..+reach so the car starts at the bottom, a
  // down-trip's runs -reach..0 so it starts at the top. Keeping the state
  // simple and moving the choice into the view is what lets the same
  // integrator serve both without a sign scattered through the physics.
  state0: () => ({ y: 0, v: 0, phase: 0 }),
  // The lift's acceleration is a PROGRAMME, not a force balance -- the motor
  // imposes it. What the simulation then derives is the normal force, which is
  // the quantity the chapter is actually about.
  derivatives(state, p) {
    if (p.cut >= 0.5) return { y: state.v, v: -GRAVITY, phase: 0 };
    const a = elevatorProgramme(state.phase, p);
    return { y: state.v, v: a, phase: 1 };
  },
  events: [],
  isStatic: () => false,
  maxDuration: 40,
  readouts(p, sim) {
    const a = p.cut >= 0.5 ? -GRAVITY : elevatorProgramme(sim.state.phase, p);
    const N = p.m * (GRAVITY + a);
    const ratio = N / (p.m * GRAVITY);
    return [
      ["Phase", p.cut >= 0.5 ? "free fall — cable cut" : elevatorPhaseName(sim.state.phase, p)],
      ["Acceleration", `${a.toFixed(2)} m/s²  (up positive)`],
      ["True weight mg", `${(p.m * GRAVITY).toFixed(1)} N  — unchanged`],
      ["Scale reads N", `${N.toFixed(1)} N`],
      ["As a multiple", `${ratio.toFixed(3)} × mg`],
      ["Feels", ratio > 1.02 ? "heavier" : ratio < 0.98 ? "lighter" : "normal"],
      ["Height / speed", `${sim.state.y.toFixed(2)} m   ${sim.state.v.toFixed(2)} m/s`],
    ];
  },
  handoff: {
    chapter: "classicProblems", variant: "elevator",
    // Read the LIVE phase, not the slider. Handing over p.aUp meant the
    // chapter answered 826 N while the panel that launched it read 686 N --
    // in three of the five phases.
    knowns: (p) => ({
      mass_e: p.m,
      a_elev: p.cut >= 0.5 ? -GRAVITY : elevatorProgramme(Play.state.phase ?? 0, p),
    }),
  },
  draw: drawElevator,
};

SCENARIOS.roundabout = {
  label: "Roundabout & friction circle",
  group: "Energy & circular motion",
  ariaLabel: "Live simulation of a skateboard cornering on a circular track until friction gives way",
  blurb: "Ride a skateboard round a flat bend. Friction supplies the whole turn, so v_max = √(μₛgr) — and if you push while turning, the two demands add as vectors and the board lets go sooner.",
  defaults: { r: 40, muS: 0.7, aT: 0.0, v0: 8, m: 70 },
  controls: [
    { key: "m", label: "Rider mass (changes nothing)", min: 20, max: 120, step: 5, unit: "kg" },
    { key: "r", label: "Track radius", min: 10, max: 90, step: 1, unit: "m" },
    { key: "muS", label: "Static μₛ", min: 0.1, max: 1.2, step: 0.01, unit: "" },
    { key: "aT", label: "Tangential accel", min: 0, max: 6, step: 0.1, unit: "m/s²" },
    { key: "v0", label: "Starting speed", min: 1, max: 30, step: 0.5, unit: "m/s" },
  ],
  // Seed the released flag rather than relying on the edge-triggered event: a
  // car started ABOVE its cornering limit never crosses into the circle, so
  // the detector never fired and the panel claimed it was holding a corner it
  // had no grip for.
  state0: (p) => ({
    theta: 0, v: p.v0, slipX: 0, slipY: 0,
    free: Math.hypot((p.v0 * p.v0) / p.r, p.aT) > p.muS * GRAVITY ? 1 : 0,
  }),
  // Two regimes. On the track the driver's tangential demand is obeyed and the
  // car follows the circle. Once the friction circle is exceeded the tyres
  // cannot hold it, and the car leaves along the TANGENT -- straight, because
  // nothing is pushing it sideways any more.
  derivatives(state, p) {
    if (state.free >= 0.5) {
      return { theta: 0, v: 0, slipX: Math.cos(state.theta + Math.PI / 2) * state.v,
               slipY: Math.sin(state.theta + Math.PI / 2) * state.v, free: 0 };
    }
    return { theta: state.v / p.r, v: p.aT, slipX: 0, slipY: 0, free: 0 };
  },
  events: [
    {
      // The friction circle: turning and accelerating are perpendicular
      // demands on one budget, so they combine by Pythagoras.
      detect: (s, p) => {
        if (s.free >= 0.5) return 1;
        const demand = Math.hypot((s.v * s.v) / p.r, p.aT);
        return p.muS * GRAVITY - demand;
      },
      apply: (s) => ({ ...s, free: 1 }),
    },
  ],
  isStatic: () => false,
  maxDuration: 60,
  readouts(p, sim) {
    const s = sim.state;
    const ac = (s.v * s.v) / p.r;
    const demand = Math.hypot(ac, p.aT);
    const budget = p.muS * GRAVITY;
    const vMax = Math.sqrt(p.muS * GRAVITY * p.r);
    const vMaxTurning = p.aT < budget
      ? Math.sqrt(p.r * Math.sqrt(budget * budget - p.aT * p.aT)) : 0;
    return [
      ["Speed", `${s.v.toFixed(2)} m/s`],
      ["Centripetal demand", `${ac.toFixed(2)} m/s²`],
      ["Total demand", `√(a_c² + a_t²) = ${demand.toFixed(2)} m/s²`],
      ["Grip budget μₛg", `${budget.toFixed(2)} m/s²`],
      ["Grip used", `${((demand / budget) * 100).toFixed(0)} %`],
      ["v_max, steady", `${vMax.toFixed(2)} m/s  — try the mass slider`],
      ["v_max, accelerating", p.aT < budget ? `${vMaxTurning.toFixed(2)} m/s` : "cannot corner at all"],
      ["Status", s.free >= 0.5 ? "SLID OUT — now travelling straight" : "holding the curve"],
    ];
  },
  handoff: {
    chapter: "classicProblems", variant: "roundabout",
    knowns: (p) => ({ r_track: p.r, mu_s_track: p.muS, a_tangential: p.aT, mass_car: p.m, v_car: p.v0 }),
  },
  draw: drawRoundabout,
};

/* The lift's motion programme: accelerate up, cruise, decelerate, rest. The
 * phase variable is carried in the state bag so the integrator advances it
 * with everything else rather than reading a wall clock. */
function elevatorProgramme(phase, p) {
  const t = phase;
  const rampT = 2.0;
  // A DOWN trip reverses the velocity, not the physics: it starts by
  // accelerating downward (a < 0, scale reads light) and ends by SLOWING,
  // which is an upward acceleration and reads heavy. That second phase is the
  // case the chapter singles out, and the up-only programme never reached it.
  const sign = p.down >= 0.5 ? -1 : 1;
  if (t < rampT) return sign * p.aUp;
  if (t < rampT + p.cruise) return 0;
  if (t < rampT * 2 + p.cruise) return -sign * p.aUp;
  return 0;
}

function elevatorPhaseName(phase, p) {
  const rampT = 2.0;
  const down = p.down >= 0.5;
  if (phase < rampT) return down ? "accelerating downward" : "accelerating upward";
  if (phase < rampT + p.cruise) return "cruising at constant speed";
  if (phase < rampT * 2 + p.cruise) {
    return down ? "slowing while descending — accelerating UP" : "slowing to a stop";
  }
  return "at rest";
}

function drawRampSlide(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const th = (p.angleDeg * Math.PI) / 180;
  const padX = 60, baseY = h * 0.80;
  const run = Math.min(w - padX * 2, (h * 0.56) / Math.max(Math.tan(th), 0.05));
  const rise = run * Math.tan(th);
  const apexX = padX, apexY = baseY - rise, footX = padX + run;

  ctx.save();
  ctx.fillStyle = PALETTE.panel; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(apexX, apexY); ctx.lineTo(footX, baseY); ctx.lineTo(apexX, baseY);
  ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.save(); ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(apexX, apexY); ctx.lineTo(footX, baseY); ctx.lineTo(apexX, baseY);
  ctx.closePath(); ctx.stroke(); ctx.restore();

  const frac = Math.min(s.s / Math.max(p.length, 0.001), 1);
  const bx = apexX + (footX - apexX) * frac, by = apexY + (baseY - apexY) * frac;
  ctx.save();
  ctx.translate(bx, by); ctx.rotate(th);
  ctx.fillStyle = PALETTE.navy; ctx.fillRect(-13, -26, 26, 26);
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.2; ctx.strokeRect(-13, -26, 26, 26);
  ctx.restore();

  const nx = Math.sin(th), ny = -Math.cos(th);
  const cx = bx + nx * 13, cy = by + ny * 13;
  const N = p.m * GRAVITY * Math.cos(th), scale = 34 / (p.m * GRAVITY);
  drawArrow(ctx, cx, cy, cx, cy + p.m * GRAVITY * scale, PALETTE.navy, 1.8);
  drawArrow(ctx, cx, cy, cx + nx * N * scale, cy + ny * N * scale, PALETTE.forest, 1.8);
  const holds = Math.sin(th) <= p.muS * Math.cos(th);
  drawLabel(ctx, w * 0.5, 22, holds ? "static friction holds it" : "sliding", holds ? PALETTE.forest : PALETTE.crimson, 12);
}

function drawElevator(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const going = p.down >= 0.5;

  // The scale panel owns a fixed strip; the shaft gets the rest.
  const panelW = Math.min(190, Math.max(150, w * 0.30));
  const stageW = w - panelW - 16;

  // --- how far this trip actually travels, so the view can enclose it ------
  const rampT = 2.0;
  const peak = p.aUp * rampT * (rampT / 2 + p.cruise + rampT / 2);
  const reach = Math.max(Math.abs(peak), 4);

  // A descending lift starts at the TOP and works down, so the world runs from
  // -reach to 0 rather than 0 to +reach. Starting a down-trip at the floor
  // sent the car straight through the basement.
  const world = going ? newWorld(0, -reach) : newWorld(0, 0);
  includePoint(world, 0, going ? 0 : reach, 0);
  includePoint(world, 0, s.y, 2.5);          // and always the car itself
  const view = fitView("elev", stageW, h, world, { pad: 0.14 });

  if (stageW < 40 || h < 40) return;
  const shaftW = Math.max(Math.min(150, stageW * 0.42), 12);
  const shaftX = stageW * 0.5 - shaftW / 2;
  const carH = Math.max(30, view.S(2.4));
  const carY = view.Y(s.y) - carH / 2;

  // --- shaft rails, drawn the full world height ---------------------------
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1; ctx.globalAlpha = 0.45;
  ctx.setLineDash([4, 6]);
  [shaftX - 10, shaftX + shaftW + 10].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, view.Y(going ? 0.5 : reach + 0.5));
    ctx.lineTo(x, view.Y(going ? -reach - 0.5 : -0.5));
    ctx.stroke();
  });
  ctx.restore();

  // floor markers every whole metre the view can resolve without crowding
  const stepM = view.S(1) > 14 ? 1 : view.S(5) > 14 ? 5 : 10;
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.globalAlpha = 0.3; ctx.lineWidth = 1;
  const lo = going ? -Math.ceil(reach) : 0;
  const hi = going ? 0 : Math.ceil(reach);
  for (let m = lo; m <= hi; m += stepM) {
    const y = view.Y(m);
    if (y < -20 || y > h + 20) continue;
    ctx.beginPath(); ctx.moveTo(shaftX - 18, y); ctx.lineTo(shaftX - 10, y); ctx.stroke();
  }
  ctx.restore();

  // --- cable, only while it is holding anything ---------------------------
  if (p.cut < 0.5) {
    ctx.save();
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(shaftX + shaftW / 2, view.Y(going ? 0.5 : reach + 0.5));
    ctx.lineTo(shaftX + shaftW / 2, carY);
    ctx.stroke();
    ctx.restore();
  } else {
    // A cut cable hangs slack from the headgear rather than vanishing.
    ctx.save();
    ctx.strokeStyle = PALETTE.crimson; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
    ctx.beginPath();
    const top = view.Y(going ? 0.5 : reach + 0.5);
    ctx.moveTo(shaftX + shaftW / 2, top);
    ctx.quadraticCurveTo(shaftX + shaftW / 2 + 26, top + 26, shaftX + shaftW / 2 + 8, top + 46);
    ctx.stroke();
    ctx.restore();
  }

  // --- the car ------------------------------------------------------------
  ctx.save();
  ctx.fillStyle = PALETTE.panel; ctx.globalAlpha = 0.62;
  ctx.fillRect(shaftX, carY, shaftW, carH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1.5;
  ctx.strokeRect(shaftX, carY, shaftW, carH);
  ctx.restore();

  const a = p.cut >= 0.5 ? -GRAVITY : elevatorProgramme(s.phase, p);
  const N = p.m * Math.max(0, GRAVITY + a);
  const ratio = N / (p.m * GRAVITY);

  // Marcy the cat, on the scale, sized to the car so she never overflows it.
  if (carH > 26) {
    const floorY = carY + carH - Math.max(6, carH * 0.09);
    const px = shaftX + shaftW * 0.34;
    ctx.save();
    ctx.fillStyle = PALETTE.brass; ctx.globalAlpha = 0.85;
    ctx.fillRect(px - carH * 0.16, floorY - carH * 0.06, carH * 0.32, Math.max(3, carH * 0.05));
    ctx.restore();
    drawMarcy(ctx, px, floorY - carH * 0.06, clamp(carH * 0.52, 16, 64), { t: Play.t });

    // N and mg side by side: one moves, the other never does.
    const base = Math.min(carH * 0.42, 40);
    const nx = shaftX + shaftW * 0.72;
    drawArrow(ctx, nx, floorY, nx, floorY - base * Math.max(ratio, 0.02), PALETTE.forest, 2);
    drawArrow(ctx, nx, floorY - base, nx, floorY, PALETTE.navy, 1.6);
  }

  // acceleration arrow beside the car
  if (Math.abs(a) > 0.01 && carH > 20) {
    const ax = shaftX + shaftW + 26;
    const ay = carY + carH / 2;
    const dir = a > 0 ? -1 : 1;
    drawArrow(ctx, ax, ay, ax, ay + dir * 26, PALETTE.crimson, 2);
    drawLabel(ctx, ax + 12, ay + dir * 34, "a", PALETTE.crimson, 10);
  }

  drawZoomBar(ctx, stageW, h, view, "m");
  sideNameplate(ctx, 12, h - 40, "Cat", "Marcy the Cat", PALETTE.brass);

  // --- the live scale, given its own panel --------------------------------
  drawScaleDial(ctx, w - panelW - 4, 10, panelW, h - 20, p, ratio, N, a);
}

/* A bathroom scale with a moving needle. The number is what the chapter is
   about, so it gets a real instrument rather than a line in a table -- and the
   needle is what makes "heavier" and "lighter" legible at a glance. */
function drawScaleDial(ctx, x, y, w, h, p, ratio, N, a) {
  const cx = x + w / 2;
  const cy = y + Math.min(h * 0.42, w * 0.62);
  // A tiny canvas drives every derived radius negative, and arc() throws on a
  // negative radius rather than drawing nothing. Floor it once, here.
  const R = Math.max(Math.min(w * 0.40, h * 0.28), 2);
  if (w < 24 || h < 24) return;

  ctx.save();
  ctx.fillStyle = PALETTE.panel; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // The dial reads 0 to 2x true weight, so mg sits at the top -- straight up
  // means "your normal weight", which is the reading to compare against.
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const angleFor = (rr) => a0 + (clamp(rr, 0, 2) / 2) * (a1 - a0);

  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.globalAlpha = 0.55;
  for (let i = 0; i <= 8; i++) {
    const ang = a0 + (i / 8) * (a1 - a0);
    const inner = i % 2 === 0 ? R - 9 : R - 5;
    ctx.lineWidth = i % 2 === 0 ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.lineTo(cx + Math.cos(ang) * (R - 2), cy + Math.sin(ang) * (R - 2));
    ctx.stroke();
  }
  ctx.restore();

  // the reference mark at exactly mg
  const mgAng = angleFor(1);
  ctx.save();
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(mgAng) * (R - 13), cy + Math.sin(mgAng) * (R - 13));
  ctx.lineTo(cx + Math.cos(mgAng) * (R - 1), cy + Math.sin(mgAng) * (R - 1));
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, cx, cy - R - 9, "mg", PALETTE.brass, 10);

  const ang = angleFor(ratio);
  const colour = ratio > 1.02 ? PALETTE.crimson : ratio < 0.98 ? PALETTE.forest : PALETTE.ink;
  ctx.save();
  ctx.strokeStyle = colour; ctx.lineWidth = 2.6; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(ang) * (R - 12), cy + Math.sin(ang) * (R - 12));
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const rows = [
    ["reads", fmt(N) + " N"],
    ["as a multiple", ratio.toFixed(3) + " × mg"],
    ["true weight", fmt(p.m * GRAVITY) + " N"],
    ["acceleration", fmt(a) + " m/s²"],
    ["feels", ratio > 1.02 ? "heavier" : ratio < 0.98 ? "lighter" : "normal"],
  ];
  let ry = cy + R + 18;
  rows.forEach(([k, v]) => {
    if (ry > y + h - 4) return;
    drawLabel(ctx, x + 10, ry, k, PALETTE.inkSoft, 10, "left");
    drawLabel(ctx, x + w - 10, ry, v, PALETTE.ink, 11, "right");
    ry += 17;
  });
}

function drawRoundabout(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w * 0.36, cy = h * 0.52, R = Math.min(w * 0.25, h * 0.33);

  ctx.save(); ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 24; ctx.globalAlpha = 0.2;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.6; ctx.lineWidth = 1.2; ctx.setLineDash([5, 7]);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke(); ctx.restore();

  const onTrack = s.free < 0.5;
  const carX = cx + R * Math.cos(s.theta) + (onTrack ? 0 : s.slipX * (R / Math.max(p.r, 1)));
  const carY = cy + R * Math.sin(s.theta) + (onTrack ? 0 : s.slipY * (R / Math.max(p.r, 1)));

  drawSkateboard(ctx, carX, carY, Math.max(R * 0.32, 24), s.theta + Math.PI / 2,
                 { colour: onTrack ? PALETTE.crimson : PALETTE.brass });

  const tx = -Math.sin(s.theta), ty = Math.cos(s.theta);
  drawArrow(ctx, carX, carY, carX + tx * 40, carY + ty * 40, PALETTE.navy, 2);
  if (onTrack) drawArrow(ctx, carX, carY, carX + (cx - carX) * 0.3, carY + (cy - carY) * 0.3, PALETTE.crimson, 2.2);

  const gx = w - 118, gy = h * 0.5, gR = Math.min(58, h * 0.19);
  const budget = p.muS * GRAVITY;
  const ac = (s.v * s.v) / p.r;
  ctx.save(); ctx.strokeStyle = PALETTE.forest; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(gx, gy, gR, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.25; ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(gx - gR, gy); ctx.lineTo(gx + gR, gy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx, gy - gR); ctx.lineTo(gx, gy + gR); ctx.stroke(); ctx.restore();

  const sc = gR / budget;
  const dx = p.aT * sc, dy = -ac * sc;
  const over = Math.hypot(dx, dy) > gR;
  drawArrow(ctx, gx, gy, gx + dx, gy + dy, over ? PALETTE.crimson : PALETTE.brass, 2.2);
  drawLabel(ctx, gx, gy - gR - 12, "friction circle", PALETTE.forest, 10);
  sideNameplate(ctx, 12, h - 40, "Rider", "Mr. J's Skateboard", PALETTE.crimson);
  drawLabel(ctx, gx, gy + gR + 16, over ? "exceeded" : `${((Math.hypot(dx, dy) / gR) * 100).toFixed(0)}% used`,
    over ? PALETTE.crimson : PALETTE.inkSoft, 10);
}

/* One number for how tall the bottom block is, used by the physics AND the
   drawing. Two copies would let the block be drawn resting somewhere it is not. */
const BLOCK_BOT_H = 0.42;

SCENARIOS.blockstack = {
  label: "Block on a block",
  group: "Forces & Newton's laws",
  ariaLabel: "Live simulation of one block riding on another, with friction between them",
  blurb: "Push the bottom block and the top one comes along — dragged by friction, the only horizontal force acting on it. Push too hard and friction runs out: the top block slides backwards off the stack, then falls.",
  defaults: { mTop: 2, mBot: 5, muBetween: 0.4, muGround: 0, F: 14, botLen: 1.6 },
  controls: [
    { key: "F", label: "Applied force", min: 0, max: 90, step: 1, unit: "N" },
    { key: "mTop", label: "Top block mass", min: 0.5, max: 10, step: 0.5, unit: "kg" },
    { key: "mBot", label: "Bottom block mass", min: 0.5, max: 12, step: 0.5, unit: "kg" },
    { key: "muBetween", label: "μ between blocks", min: 0, max: 1.2, step: 0.01, unit: "" },
    { key: "muGround", label: "μ with the ground", min: 0, max: 1.2, step: 0.01, unit: "" },
  ],
  // xT, xB are positions; the top block also has a fall once it clears the
  // back edge, so it carries its own vertical state.
  // The top block rides at the height of the bottom block's top face, so its
  // fall starts there and ends at the floor. Starting it at y = 0 made the
  // "fall" an instant teleport down onto the ground followed by 0.33 s of
  // sinking through it.
  state0: (p) => ({ xT: 0, vT: 0, xB: 0, vB: 0, yT: BLOCK_BOT_H, vyT: 0, fallen: 0 }),
  derivatives(state, p) {
    const g = GRAVITY;
    const total = p.mTop + p.mBot;
    const ground = p.muGround * total * g;
    const net = p.F - ground;

    // Once the top block has left the stack it is a projectile: nothing is
    // under it, so there is no friction and no normal force.
    if (state.fallen >= 0.5) {
      return { xT: state.vT, vT: 0, xB: state.vB, vB: (p.F - p.muGround * p.mBot * g) / p.mBot,
               yT: state.vyT, vyT: -g, fallen: 0 };
    }

    const shared = net / total;
    const needed = p.mTop * shared;                 // friction the top block wants
    const ceiling = p.muBetween * p.mTop * g;       // the most it can get

    if (needed <= ceiling) {
      // They move together. Friction supplies exactly what is needed and no
      // more -- this is the static case, and the pair is one body.
      return { xT: state.vT, vT: shared, xB: state.vB, vB: shared, yT: 0, vyT: 0, fallen: 0 };
    }
    // Slipping. Friction is now at its kinetic maximum, still forward on the
    // top block, and equal-and-opposite backward on the bottom one.
    const aTop = p.muBetween * g;
    const aBot = (p.F - ceiling - ground) / p.mBot;
    return { xT: state.vT, vT: aTop, xB: state.vB, vB: aBot, yT: 0, vyT: 0, fallen: 0 };
  },
  events: [
    {
      // The top block has slid back past the bottom block's trailing edge, so
      // there is nothing beneath it any more.
      detect: (s, p) => (s.fallen >= 0.5 ? 1 : p.botLen / 2 - (s.xB - s.xT)),
      apply: (s) => ({ ...s, fallen: 1 }),
      reason: "the top block slid off the back",
    },
    {
      detect: (s) => (s.fallen >= 0.5 ? s.yT : 1),
      terminal: true,
      reason: "the top block hit the ground",
    },
    { detect: (s) => 14 - s.xB, terminal: true, reason: "ran out of floor" },
  ],
  isStatic: (p) => p.F <= p.muGround * (p.mTop + p.mBot) * GRAVITY,
  maxDuration: 25,
  readouts(p, sim) {
    const g = GRAVITY, s = sim.state;
    const total = p.mTop + p.mBot;
    const ground = p.muGround * total * g;
    const shared = (p.F - ground) / total;
    const needed = p.mTop * shared;
    const ceiling = p.muBetween * p.mTop * g;
    const fMax = p.muBetween * g * total + ground;
    return [
      ["Friction needed on top", `${Math.max(needed, 0).toFixed(2)} N`],
      ["Friction available", `${ceiling.toFixed(2)} N   (μ·m_top·g)`],
      ["Largest force they survive", `${fMax.toFixed(2)} N`],
      ["Verdict", s.fallen >= 0.5 ? "the top block is falling"
        : needed <= ceiling ? "moving together" : "SLIPPING — the top block is falling behind"],
      ["Shared acceleration", needed <= ceiling ? `${shared.toFixed(3)} m/s²` : "—"],
      ["a_top / a_bot", needed <= ceiling ? "the same"
        : `${(p.muBetween * g).toFixed(2)} / ${((p.F - ceiling - ground) / p.mBot).toFixed(2)} m/s²`],
      ["Slip so far", `${Math.max(s.xB - s.xT, 0).toFixed(3)} m of ${(p.botLen / 2).toFixed(2)} m`],
    ];
  },
  handoff: {
    chapter: "classicProblems", variant: "blockstack",
    knowns: (p) => ({ m_top: p.mTop, m_bot: p.mBot, mu_between: p.muBetween,
                      mu_ground: p.muGround, F_push: p.F }),
  },
  draw: drawBlockStack,
};

function drawBlockStack(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;

  const world = newWorld(-0.6, -0.7);
  includePoint(world, s.xB + p.botLen, 1.2, 0);
  includePoint(world, s.xT, s.yT, 0.6);
  includePoint(world, s.xB, BLOCK_BOT_H, 0.3);
  includePoint(world, 3, 0, 0);
  const view = fitView("blockstack", w, h, world, { pad: 0.14 });

  const groundY = view.Y(0);
  drawGround(ctx, 0, groundY, w);

  const botW = view.S(p.botLen);
  const botH = Math.max(view.S(BLOCK_BOT_H), 10);
  const topW = botW * 0.5;
  const topH = Math.max(view.S(0.3), 8);
  const bx = view.X(s.xB);
  const tx = view.X(s.xT);
  const ty = view.Y(s.yT);

  // bottom block
  ctx.save();
  ctx.fillStyle = PALETTE.navy; ctx.globalAlpha = 0.9;
  ctx.fillRect(bx - botW / 2, groundY - botH, botW, botH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.2;
  ctx.strokeRect(bx - botW / 2, groundY - botH, botW, botH);
  ctx.restore();
  drawLabel(ctx, bx, groundY - botH / 2, fmt(p.mBot) + " kg", PALETTE.panel, 10);

  // top block, sitting exactly on the bottom one until it falls
  const topBase = view.Y(s.yT);
  ctx.save();
  ctx.fillStyle = s.fallen >= 0.5 ? PALETTE.crimson : PALETTE.brass;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(tx - topW / 2, topBase - topH, topW, topH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.2;
  ctx.strokeRect(tx - topW / 2, topBase - topH, topW, topH);
  ctx.restore();
  drawLabel(ctx, tx, topBase - topH / 2, fmt(p.mTop) + " kg", PALETTE.stage, 10);

  // the applied push
  if (p.F > 0) {
    const ax = bx - botW / 2;
    drawArrow(ctx, ax - 44, groundY - botH / 2, ax - 4, groundY - botH / 2, PALETTE.crimson, 2.2);
    drawLabel(ctx, ax - 52, groundY - botH / 2 - 12, "F = " + fmt(p.F) + " N", PALETTE.crimson, 10);
  }

  // The friction arrow on the top block, forward -- the point of the scenario.
  if (s.fallen < 0.5) {
    const g = GRAVITY, total = p.mTop + p.mBot;
    const shared = (p.F - p.muGround * total * g) / total;
    const needed = Math.max(p.mTop * shared, 0);
    const ceiling = p.muBetween * p.mTop * g;
    const f = Math.min(needed, ceiling);
    if (f > 0.01) {
      const fy = topBase - topH / 2;
      const len = clamp(f * 2.2, 12, 52);
      drawArrow(ctx, tx, fy, tx + len, fy, PALETTE.forest, 2);
      drawLabel(ctx, tx + len + 6, fy - 10, "f = " + fmt(f) + " N", PALETTE.forest, 10, "left");
    }
    if (needed > ceiling) {
      drawLabel(ctx, w / 2, 20, "friction has run out — the top block is sliding back",
        PALETTE.crimson, 12);
    }
  } else {
    drawLabel(ctx, w / 2, 20, "nothing beneath it — it is in free fall", PALETTE.crimson, 12);
  }

  drawZoomBar(ctx, w, h, view, "m");
}

SCENARIOS.blockstack.trailPoint = (s) => ({ x: s.xT, y: s.yT });

/* The cone angle that balances at this rotation rate.

   Vertically   T cos θ = mg
   Radially     T sin θ = m ω² L sin θ



/* The pig itself. A toy, drawn small, so it needs to read as a pig at 14px:
   round body, snout, two ears, and wings, which is what the classroom version
   actually has. */
function drawFlyingPig(ctx, x, y, s, phase) {
  if (!(s > 5)) return;
  const flap = Math.sin(phase * 6) * 0.5 + 0.5;
  ctx.save();

  // wings, behind the body
  ctx.fillStyle = PALETTE.panel;
  ctx.globalAlpha = 0.9;
  [-1, 1].forEach((side) => {
    ctx.save();
    ctx.translate(x, y - s * 0.15);
    ctx.rotate(side * (0.5 + flap * 0.5));
    ctx.beginPath();
    ctx.ellipse(side * s * 0.55, -s * 0.1, s * 0.5, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.globalAlpha = 1;

  // body
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.5, s * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ears
  ctx.beginPath();
  ctx.moveTo(x - s * 0.26, y - s * 0.30);
  ctx.lineTo(x - s * 0.34, y - s * 0.52);
  ctx.lineTo(x - s * 0.10, y - s * 0.36);
  ctx.closePath();
  ctx.moveTo(x + s * 0.26, y - s * 0.30);
  ctx.lineTo(x + s * 0.34, y - s * 0.52);
  ctx.lineTo(x + s * 0.10, y - s * 0.36);
  ctx.closePath();
  ctx.fill();

  // snout
  if (s > 14) {
    ctx.fillStyle = PALETTE.stage;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(x + s * 0.34, y + s * 0.06, s * 0.17, s * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.ink;
    ctx.beginPath();
    ctx.arc(x + s * 0.12, y - s * 0.10, Math.max(s * 0.055, 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ============================================================================
   simulation state
   ========================================================================== */

const Play = {
  type: "atwood",
  params: { ...SCENARIOS.atwood.defaults },
  state: {},
  t: 0,
  running: false,
  started: false,
  finished: false,
  endedBecause: null,
  handle: null,
  accumulator: 0,
  lastFrame: null,
  maxDrift: 0,
  trail: [],
};

function scenario() { return SCENARIOS[Play.type]; }

function playAdvance(seconds) {
  const sc = scenario();
  const p = Play.params;
  if (Play.finished) return;

  // Clamp SIMULATED seconds, not wall seconds. Applying the cap before the
  // time-scale multiply let a 260x scenario request 65 simulated seconds from
  // one stalled frame — more work than the iteration guard permits, so the
  // surplus stayed in the accumulator as permanent time debt.
  // A scenario whose natural timescale depends on the reader's own numbers
  // has to be able to say so. A drag time constant runs from 0.2 s to 1000 s
  // across the sliders, and one fixed number cannot serve both ends.
  const scale = (typeof sc.timeScale === "function" ? sc.timeScale(Play.params) : sc.timeScale) || 1;
  // Orbital motion is smooth and slow: resolving a 97-minute orbit at 1/480 s
  // spends four hundred thousand steps to describe one ellipse. A scenario may
  // therefore choose a step suited to its own timescale, and the step budget
  // below keeps the per-frame work constant either way.
  // A scenario whose natural timescale spans four orders of magnitude needs a
  // step to match, because the per-frame budget is step*PLAY_MAX_STEPS_PER_FRAME
  // and a fixed step therefore caps the sim-seconds per frame no matter what
  // timeScale says. A drag run at tau = 1000 s took 200 seconds of real time
  // for that reason.
  const step = (typeof sc.step === "function" ? sc.step(Play.params) : sc.step) || PLAY_STEP;
  Play.accumulator += Math.min(seconds * scale, PLAY_MAX_CATCHUP * scale, step * PLAY_MAX_STEPS_PER_FRAME);

  let iterations = 0;
  while (Play.accumulator >= step && iterations++ < PLAY_MAX_STEPS_PER_FRAME) {
    const next = rk4(sc.derivatives, Play.state, p, step);

    let handled = false;
    for (const ev of sc.events) {
      if (ev.detect(Play.state, p) > 0 && ev.detect(next, p) <= 0) {
        const hit = bisectEvent(sc.derivatives, Play.state, p, step, ev.detect);
        Play.state = hit.state;
        Play.t += hit.dt;
        Play.accumulator -= hit.dt;

        if (ev.terminal) {
          Play.running = false;
          Play.finished = true;
          Play.endedBecause = ev.reason || null;
          Play.accumulator = 0;
        } else if (ev.apply) {
          const changed = ev.apply(Play.state, p);
          if (changed) Play.state = changed;
        }
        handled = true;
        break;
      }
    }
    if (Play.finished) break;
    if (handled) continue;

    Play.state = next;
    Play.t += step;
    Play.accumulator -= step;

    const cap = (typeof sc.maxDuration === "function" ? sc.maxDuration(Play.params) : sc.maxDuration)
      || PLAY_MAX_DURATION;
    if (Play.t >= cap) {
      Play.running = false;
      Play.finished = true;
      Play.endedBecause = "ran for the full " + (cap < 100 ? cap.toFixed(1) : Math.round(cap)) + " s";
      Play.accumulator = 0;
      break;
    }
  }

  // If the guard cut the loop short, drop the unprocessed remainder rather
  // than carrying it forward. Keeping it would let the simulation clock fall
  // silently and permanently behind the wall clock.
  if (iterations >= PLAY_MAX_STEPS_PER_FRAME) Play.accumulator = 0;

  // Compare against the scenario's independent closed form where one exists.
  if (sc.analytic) {
    const ref = sc.analytic(Play.t, p);
    if (ref) {
      for (const key in ref) {
        Play.maxDrift = Math.max(Play.maxDrift, Math.abs(Play.state[key] - ref[key]));
      }
    }
  }

  recordTrail();
  // One sample per frame feeds the analysis chart. It has to sit here rather
  // than in the paint loop: a paused or reduced-motion run still integrates,
  // and its data is just as worth plotting.
  if (typeof PlayGraph !== "undefined") PlayGraph.record(Play.t, Play.state, Play.params, sc);
}

// A short trail of recent positions, for scenarios where the path is the
// interesting part.
function recordTrail() {
  const sc = scenario();
  if (!sc.trailPoint) return;
  const pt = sc.trailPoint(Play.state, Play.params);
  if (!pt) return;
  Play.trail.push(pt);
  if (Play.trail.length > 420) Play.trail.shift();
}

function playReset(keep = false) {
  const sc = scenario();
  Play.state = sc.state0(Play.params);
  Play.t = 0;
  Play.running = false;
  Play.started = false;
  Play.finished = sc.isStatic ? sc.isStatic(Play.params) : false;
  Play.endedBecause = null;
  Play.accumulator = 0;
  Play.maxDrift = 0;
  Play.lastFrame = null;
  Play.trail = [];
  if (typeof PlayGraph !== "undefined") PlayGraph.reset(Play.type, sc);
  // A new apparatus is a new subject, so the camera should frame it afresh
  // rather than inheriting the last scenario's zoom.
  if (typeof resetViewFit === "function") resetViewFit(Play.type);
}

function playSetScenario(type) {
  Play.type = type;
  Play.params = { ...SCENARIOS[type].defaults };
  playReset();
}

/* ============================================================================
   rendering
   ========================================================================== */

function stageMetrics(w, h) {
  return { cx: w / 2, groundY: h * 0.9, topY: h * 0.12 };
}

function drawAtwood(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const { cx } = stageMetrics(w, h);
  const pulleyY = h * 0.18, Rpx = clampNum(Math.min(w, h) * 0.07, 18, 32);
  const restY = h * 0.54, groundY = h * 0.93;
  const scale = (groundY - restY - 34) / p.travel;
  const size = (m) => clampNum(20 + m * 2.2, 20, 50);
  const s1 = size(p.m1), s2 = size(p.m2);
  const lx = cx - Rpx, rx = cx + Rpx;
  const y1 = restY - s.y * scale, y2 = restY + s.y * scale;

  ctx.strokeStyle = PALETTE.inkSoft; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 62, pulleyY - Rpx - 9); ctx.lineTo(cx + 62, pulleyY - Rpx - 9); ctx.stroke();
  for (let d = -56; d <= 56; d += 9) {
    ctx.beginPath(); ctx.moveTo(cx + d, pulleyY - Rpx - 9); ctx.lineTo(cx + d - 7, pulleyY - Rpx - 1); ctx.stroke();
  }
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(lx, pulleyY); ctx.lineTo(lx, y1);
  ctx.moveTo(rx, pulleyY); ctx.lineTo(rx, y2);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, pulleyY, Rpx, Math.PI, 0); ctx.stroke();
  drawWheel(ctx, cx, pulleyY, Rpx, s.y / 0.12, PALETTE.ink);
  drawGround(ctx, w, h, groundY);

  drawShadow(ctx, lx, groundY, s1 * 1.2, 0.3);
  drawShadow(ctx, rx, groundY, s2 * 1.2, 0.3);
  drawHangingBlock(ctx, lx, y1 + s1 / 2, s1, PALETTE.crimson);
  drawHangingBlock(ctx, rx, y2 + s2 / 2, s2, PALETTE.navy);
  drawCaption(ctx, lx, y1 - 22, `m₁ ${p.m1.toFixed(1)} kg`, PALETTE.crimson, 11);
  drawCaption(ctx, rx, y2 - 22, `m₂ ${p.m2.toFixed(1)} kg`, PALETTE.navy, 11);

  const sol = SCENARIOS.atwood.constraint(p) || [0, 0];
  const fs = 28 / (Math.max(p.m1, p.m2) * GRAVITY);
  drawArrow(ctx, lx, y1, lx, y1 - sol[0] * fs, PALETTE.brass, 2);
  drawArrow(ctx, rx, y2, rx, y2 - sol[0] * fs, PALETTE.brass, 2);
  drawArrow(ctx, lx, y1 + s1 / 2, lx, y1 + s1 / 2 + p.m1 * GRAVITY * fs, PALETTE.forest, 2);
  drawArrow(ctx, rx, y2 + s2 / 2, rx, y2 + s2 / 2 + p.m2 * GRAVITY * fs, PALETTE.forest, 2);
  if (Math.abs(s.v) > 0.04) {
    const L = clampNum(Math.abs(s.v) * 12, 8, 40), dir = Math.sign(s.v);
    drawArrow(ctx, rx + 26, y2 + s2 / 2, rx + 26, y2 + s2 / 2 + dir * L, PALETTE.navy, 2);
    drawArrow(ctx, lx - 26, y1 + s1 / 2, lx - 26, y1 + s1 / 2 - dir * L, PALETTE.navy, 2);
  }
}

function drawVerticalSpring(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w / 2, topY = h * 0.12;
  const eq = (p.m * GRAVITY) / p.k;
  const scale = clampNum((h * 0.3) / Math.max(p.y0, 0.05), 60, 420);
  const restY = h * 0.5;
  const y = restY + (s.y - eq) * scale;
  const size = clampNum(24 + p.m * 3, 24, 52);

  ctx.strokeStyle = PALETTE.inkSoft; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 54, topY); ctx.lineTo(cx + 54, topY); ctx.stroke();
  for (let d = -48; d <= 48; d += 9) { ctx.beginPath(); ctx.moveTo(cx + d, topY); ctx.lineTo(cx + d - 7, topY + 8); ctx.stroke(); }

  drawDashedLine(ctx, cx - 74, restY, cx + 74, restY, PALETTE.rule, 1, [3, 4]);
  drawCaption(ctx, cx - 100, restY, "equilibrium", PALETTE.inkSoft, 10);
  drawSpringCoil(ctx, cx, topY, cx, y - size / 2, 11, PALETTE.ink);
  drawHangingBlock(ctx, cx, y, size, PALETTE.crimson);

  const Fs = p.k * s.y, scaleF = 30 / Math.max(p.k * (eq + p.y0), 1);
  drawArrow(ctx, cx + size / 2 + 14, y, cx + size / 2 + 14, y - Fs * scaleF, PALETTE.brass, 2);
  drawArrow(ctx, cx - size / 2 - 14, y, cx - size / 2 - 14, y + p.m * GRAVITY * scaleF, PALETTE.forest, 2);
  drawCaption(ctx, cx + size / 2 + 34, y - 14, "kx", PALETTE.brass, 10);
  drawCaption(ctx, cx - size / 2 - 32, y + 16, "mg", PALETTE.forest, 10);
}

function drawHorizontalSpring(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const groundY = h * 0.68, wallX = w * 0.12;
  const restX = w * 0.55;
  const scale = clampNum((w * 0.3) / Math.max(p.x0, 0.05), 60, 500);
  const x = restX + s.x * scale;
  const size = clampNum(26 + p.m * 3, 26, 52);

  drawGround(ctx, w, h, groundY);
  ctx.strokeStyle = PALETTE.inkSoft; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(wallX, groundY); ctx.lineTo(wallX, groundY - h * 0.26); ctx.stroke();
  for (let d = 0; d < h * 0.26; d += 9) {
    ctx.beginPath(); ctx.moveTo(wallX, groundY - d); ctx.lineTo(wallX - 8, groundY - d - 7); ctx.stroke();
  }
  drawDashedLine(ctx, restX, groundY - h * 0.24, restX, groundY, PALETTE.rule, 1, [3, 4]);
  drawCaption(ctx, restX, groundY - h * 0.26, "x = 0", PALETTE.inkSoft, 10);

  drawSpringCoil(ctx, wallX, groundY - size / 2, x - size / 2, groundY - size / 2, 12, PALETTE.ink);
  drawHangingBlock(ctx, x, groundY - size / 2, size, PALETTE.crimson);
  drawShadow(ctx, x, groundY + 2, size * 1.2, 0.3);

  const F = -p.k * s.x, scaleF = 34 / Math.max(p.k * p.x0, 1);
  if (Math.abs(F) > 0.01) drawArrow(ctx, x, groundY - size - 10, x + F * scaleF, groundY - size - 10, PALETTE.brass, 2);
  if (p.mu > 0 && Math.abs(s.v) > 1e-3) {
    const f = -Math.sign(s.v) * p.mu * p.m * GRAVITY * scaleF;
    drawArrow(ctx, x, groundY - 6, x + f, groundY - 6, PALETTE.forest, 2);
    drawCaption(ctx, x + f / 2, groundY - 18, "friction", PALETTE.forest, 9.5);
  }
}

function drawPendulum(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w / 2, pivotY = h * 0.16;
  const Lpx = clampNum((h * 0.6) / Math.max(p.L, 0.2) * p.L, 60, h * 0.62);
  const bx = cx + Lpx * Math.sin(s.th), by = pivotY + Lpx * Math.cos(s.th);
  const size = clampNum(16 + p.m * 2.4, 16, 34);

  ctx.strokeStyle = PALETTE.inkSoft; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 46, pivotY); ctx.lineTo(cx + 46, pivotY); ctx.stroke();
  for (let d = -40; d <= 40; d += 9) { ctx.beginPath(); ctx.moveTo(cx + d, pivotY); ctx.lineTo(cx + d - 7, pivotY + 8); ctx.stroke(); }

  const th0 = (p.theta0Deg * Math.PI) / 180;
  drawAngleArc(ctx, cx, pivotY, Lpx * 0.34, Math.PI / 2 - th0, Math.PI / 2 + th0, PALETTE.rule, "");
  drawDashedLine(ctx, cx, pivotY, cx, pivotY + Lpx + 16, PALETTE.rule, 1, [3, 4]);

  if (Play.trail.length > 1) drawTrail(ctx, Play.trail, PALETTE.navy);

  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(cx, pivotY); ctx.lineTo(bx, by); ctx.stroke();
  ctx.fillStyle = PALETTE.ink; ctx.beginPath(); ctx.arc(cx, pivotY, 4, 0, Math.PI * 2); ctx.fill();
  sphereShade(ctx, bx, by, size, PALETTE.navy);

  // The restoring component is mg·sin θ, which is what makes it non-linear.
  const fs = 34 / (p.m * GRAVITY);
  drawArrow(ctx, bx, by, bx, by + p.m * GRAVITY * fs, PALETTE.forest, 2);
  const tangent = s.th + Math.PI / 2;
  const restoring = -p.m * GRAVITY * Math.sin(s.th) * fs;
  if (Math.abs(restoring) > 3) {
    drawArrow(ctx, bx, by, bx + restoring * Math.cos(tangent), by + restoring * Math.sin(tangent), PALETTE.crimson, 2);
    drawCaption(ctx, bx + restoring * Math.cos(tangent) * 1.5, by + restoring * Math.sin(tangent) * 1.5 - 10, "mg sin θ", PALETTE.crimson, 9.5);
  }
}

function drawCollision(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const groundY = h * 0.62, cx = w / 2;
  const scale = (w * 0.4) / 4.2;
  const size = (m) => clampNum(24 + m * 2.4, 24, 52);
  const s1 = size(p.m1), s2 = size(p.m2);
  const x1 = cx + s.x1 * scale, x2 = cx + s.x2 * scale;

  drawGround(ctx, w, h, groundY);
  drawRuler(ctx, w, h, groundY, 0);

  const spin1 = s.x1 * 6, spin2 = s.x2 * 6;
  drawCart(ctx, x1, groundY, s1, s1 * 0.62, spin1, PALETTE.crimson);
  drawCart(ctx, x2, groundY, s2, s2 * 0.62, spin2, PALETTE.navy);
  drawCaption(ctx, x1, groundY - s1 - 22, `${p.m1.toFixed(1)} kg`, PALETTE.crimson, 10);
  drawCaption(ctx, x2, groundY - s2 - 22, `${p.m2.toFixed(1)} kg`, PALETTE.navy, 10);

  const vs = 16;
  if (Math.abs(s.v1) > 0.05) drawArrow(ctx, x1, groundY - s1 - 8, x1 + s.v1 * vs, groundY - s1 - 8, PALETTE.navy, 2);
  if (Math.abs(s.v2) > 0.05) drawArrow(ctx, x2, groundY - s2 - 8, x2 + s.v2 * vs, groundY - s2 - 8, PALETTE.navy, 2);

  drawCaption(ctx, w / 2, h * 0.16,
    p.e >= 0.99 ? "perfectly elastic — kinetic energy conserved"
      : p.e <= 0.01 ? "perfectly inelastic — maximum energy lost"
        : `partially elastic, e = ${p.e.toFixed(2)}`, PALETTE.inkSoft, 11);
}

function drawCradle(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const n = Math.round(p.n);
  const cx = w / 2, topY = h * 0.16;
  const r = clampNum(Math.min(w / (n + 3), h * 0.075), 9, 20);
  const L = clampNum(h * 0.5, 60, 190);
  const spacing = r * 2;

  const frameL = cx - ((n - 1) / 2) * spacing - 32;
  const frameR = cx + ((n - 1) / 2) * spacing + 32;
  ctx.strokeStyle = PALETTE.inkSoft; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(frameL, topY - 14); ctx.lineTo(frameR, topY - 14);
  ctx.moveTo(frameL, topY - 14); ctx.lineTo(frameL - 12, topY + L + 26);
  ctx.moveTo(frameR, topY - 14); ctx.lineTo(frameR + 12, topY + L + 26);
  ctx.moveTo(frameL - 26, topY + L + 26); ctx.lineTo(frameR + 26, topY + L + 26);
  ctx.stroke();

  for (let i = 0; i < n; i++) {
    const ax = cx + (i - (n - 1) / 2) * spacing;
    const th = s[`th${i}`] ?? 0;
    const bx = ax + L * Math.sin(th), by = topY + L * Math.cos(th);
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax - 6, topY - 12); ctx.lineTo(bx, by);
    ctx.moveTo(ax + 6, topY - 12); ctx.lineTo(bx, by);
    ctx.stroke();
    const moving = Math.abs(s[`w${i}`] ?? 0) > 0.05;
    sphereShade(ctx, bx, by, r, moving ? PALETTE.crimson : PALETTE.ink);
  }
}

function drawRocket(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w / 2, padY = h * 0.9;
  const ceiling = h * 0.14;
  const shown = Math.min(s.y, 260);
  const scale = (padY - ceiling) / 260;
  const ry = padY - shown * scale;

  ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = PALETTE.rule; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const gy = padY - (i / 5) * (padY - ceiling);
    ctx.beginPath(); ctx.moveTo(w * 0.08, gy); ctx.lineTo(w * 0.92, gy); ctx.stroke();
    drawCaption(ctx, w * 0.055, gy, `${Math.round((i / 5) * 260)}`, PALETTE.inkSoft, 9);
  }
  ctx.restore();
  drawGround(ctx, w, h, padY);

  const burning = s.fuel > 0;
  if (burning) {
    const flick = 1 + Math.sin(sim.t * 30) * 0.2;
    ctx.fillStyle = PALETTE.crimson;
    ctx.beginPath(); ctx.moveTo(cx - 8, ry + 26); ctx.lineTo(cx, ry + 26 + 26 * flick); ctx.lineTo(cx + 8, ry + 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PALETTE.brass;
    ctx.beginPath(); ctx.moveTo(cx - 4, ry + 26); ctx.lineTo(cx, ry + 26 + 14 * flick); ctx.lineTo(cx + 4, ry + 26); ctx.closePath(); ctx.fill();
  }

  ctx.save(); ctx.translate(cx, ry);
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -30); ctx.quadraticCurveTo(13, -14, 13, 12); ctx.lineTo(13, 26); ctx.lineTo(-13, 26);
  ctx.lineTo(-13, 12); ctx.quadraticCurveTo(-13, -14, 0, -30); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -4, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath(); ctx.moveTo(-13, 14); ctx.lineTo(-24, 28); ctx.lineTo(-13, 26); ctx.closePath();
  ctx.moveTo(13, 14); ctx.lineTo(24, 28); ctx.lineTo(13, 26); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();

  const m = p.m0 + Math.max(s.fuel, 0);
  const fs = 26 / (p.thrust || 1);
  if (burning) drawArrow(ctx, cx + 26, ry + 20, cx + 26, ry + 20 + p.thrust * fs, PALETTE.crimson, 2);
  drawArrow(ctx, cx - 26, ry, cx - 26, ry + m * GRAVITY * fs, PALETTE.forest, 2);
  if (s.v > 0.5) drawArrow(ctx, cx, ry - 34, cx, ry - 34 - clampNum(s.v * 0.5, 8, 44), PALETTE.navy, 2);
}

function drawCoaster(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const track = coasterTrack(p);

  // Enclose the whole track plus the cart, so a tall release hill zooms the
  // view out rather than running off the top of the box.
  const world = newWorld(0, 0);
  includePoint(world, track.total > 0 ? track.pts[0].x : 0, p.h, 0);
  track.pts.forEach((q, i) => { if (i % 12 === 0) includePoint(world, q.x, q.y, 0); });
  const at = coasterAt(track, s.s);
  includePoint(world, at.x, at.y, p.R * 0.5);
  const view = fitView("coaster", w, h, world, { pad: 0.13 });

  // --- the rails ----------------------------------------------------------
  // Two rails offset along the local normal, so the track reads as a track
  // rather than a line, and the cart's wheels have something to sit on.
  const gauge = Math.max(view.S(p.R * 0.055), 3);
  const drawRail = (offset, alpha, width) => {
    ctx.save();
    ctx.strokeStyle = PALETTE.rule;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < track.pts.length; i += 2) {
      const q = track.pts[i];
      const a = coasterAt(track, track.s[i]);
      const nx = -a.ty, ny = a.tx;                 // inward normal
      const px = view.X(q.x) + nx * offset;
      const py = view.Y(q.y) - ny * offset;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  };
  drawRail(0, 0.22, gauge * 3.4);      // the bed
  drawRail(-gauge, 0.85, 1.5);
  drawRail(gauge, 0.85, 1.5);

  // sleepers, spaced along arc length so they stay even round the loop
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  const step = Math.max(track.total / 90, 0.2);
  for (let d = 0; d <= track.total; d += step) {
    const a = coasterAt(track, d);
    const nx = -a.ty, ny = a.tx;
    ctx.beginPath();
    ctx.moveTo(view.X(a.x) + nx * gauge * 1.5, view.Y(a.y) - ny * gauge * 1.5);
    ctx.lineTo(view.X(a.x) - nx * gauge * 1.5, view.Y(a.y) + ny * gauge * 1.5);
    ctx.stroke();
  }
  ctx.restore();

  // ground line under the flat sections
  ctx.save();
  ctx.strokeStyle = PALETTE.rule; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(view.X(-1), view.Y(0) + gauge * 3);
  ctx.lineTo(view.X(track.pts[track.pts.length - 1].x + 1), view.Y(0) + gauge * 3);
  ctx.stroke();
  ctx.restore();

  // release-height marker, and the minimum the loop demands
  const hMin = 2.5 * p.R;
  [[p.h, PALETTE.brass, "release h"], [hMin, PALETTE.crimson, "2.5R minimum"]].forEach(([yy, col, lab]) => {
    if (view.Y(yy) < 4 || view.Y(yy) > h - 4) return;
    ctx.save();
    ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(0, view.Y(yy)); ctx.lineTo(w, view.Y(yy)); ctx.stroke();
    ctx.restore();
    drawLabel(ctx, w - 8, view.Y(yy) - 8, lab, col, 10, "right");
  });

  if (Play.trail.length > 1) {
    drawTrail(ctx, Play.trail.map((q) => ({ x: view.X(q.x), y: view.Y(q.y) })), PALETTE.navy);
  }

  // --- the cart -----------------------------------------------------------
  // Drawn in the track's own frame and lifted by exactly its wheel radius, so
  // the wheels ride the rail at every point of the circuit including upside
  // down at the top of the loop.
  const cw = Math.max(view.S(p.R * 0.42), 14);
  const ch = cw * 0.62;
  const wheelR = Math.max(cw * 0.13, 2.5);
  const cx = view.X(at.x), cy = view.Y(at.y);
  const ang = Math.atan2(-at.ty, at.tx);      // canvas y is inverted

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  // wheels first, sitting ON the rail line
  ctx.fillStyle = PALETTE.ink;
  [-cw * 0.3, cw * 0.3].forEach((dx) => {
    ctx.beginPath(); ctx.arc(dx, -wheelR, wheelR, 0, Math.PI * 2); ctx.fill();
  });
  // body, resting on the wheels
  ctx.fillStyle = PALETTE.navy;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  const bodyY = -wheelR * 2 - ch;
  ctx.moveTo(-cw / 2, bodyY + ch);
  ctx.lineTo(-cw / 2 + ch * 0.25, bodyY);
  ctx.lineTo(cw / 2 - ch * 0.15, bodyY);
  ctx.lineTo(cw / 2, bodyY + ch);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();

  // --- forces at the cart -------------------------------------------------
  const kappa = coasterCurvature(track, s.s);
  const N = p.m * (s.v * s.v * kappa + GRAVITY * Math.cos(at.slope));
  const nx = -at.ty, ny = at.tx;
  const scale = 42 / Math.max(p.m * GRAVITY, 1);
  const anchorX = cx + nx * wheelR * 2, anchorY = cy - ny * wheelR * 2;
  drawArrow(ctx, anchorX, anchorY, anchorX, anchorY + p.m * GRAVITY * scale, PALETTE.navy, 1.8);
  if (N > 0) {
    drawArrow(ctx, anchorX, anchorY,
      anchorX + nx * N * scale, anchorY - ny * N * scale, PALETTE.forest, 2);
  }
  if (Math.abs(s.v) > 0.05) {
    drawArrow(ctx, anchorX, anchorY,
      anchorX + at.tx * Math.sign(s.v) * 30, anchorY - at.ty * Math.sign(s.v) * 30, PALETTE.crimson, 1.6);
  }

  drawZoomBar(ctx, w, h, view, "m");

  if (Play.finished && Play.endedBecause) {
    drawLabel(ctx, w / 2, 20, Play.endedBecause,
      /rails/.test(Play.endedBecause) ? PALETTE.crimson : PALETTE.forest, 12);
  }
}

function drawIncline(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const th = (p.angleDeg * Math.PI) / 180;
  const baseY = h * 0.82, baseX = w * 0.12;
  const runPx = Math.min(w * 0.74, (h * 0.6) / Math.max(Math.tan(th), 0.05));
  const topY = baseY - runPx * Math.tan(th);
  const scale = Math.hypot(runPx, runPx * Math.tan(th)) / p.length;

  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY); ctx.lineTo(baseX + runPx, baseY); ctx.lineTo(baseX + runPx, topY); ctx.closePath();
  ctx.stroke();
  drawAngleArc(ctx, baseX, baseY, 40, -0, -th, PALETTE.brass, `${p.angleDeg}°`);

  // slide down from the top corner
  const dx = -Math.cos(th), dy = Math.sin(th);
  const startX = baseX + runPx, startY = topY;
  const px = startX + dx * s.s * scale, py = startY + dy * s.s * scale;
  const size = clampNum(20 + p.m * 1.4, 20, 44);
  const nx = -dy, ny = dx;

  ctx.save();
  ctx.translate(px + nx * size * 0.5, py + ny * size * 0.5);
  ctx.rotate(-th);
  drawHangingBlock(ctx, 0, 0, size, PALETTE.crimson);
  ctx.restore();

  const cxb = px + nx * size * 0.5, cyb = py + ny * size * 0.5;
  const fs = 30 / (p.m * GRAVITY);
  drawArrow(ctx, cxb, cyb, cxb, cyb + p.m * GRAVITY * fs, PALETTE.forest, 2);
  const Nmag = p.m * GRAVITY * Math.cos(th);
  drawArrow(ctx, cxb, cyb, cxb + nx * Nmag * fs, cyb + ny * Nmag * fs, PALETTE.brass, 2);
  const slides = Math.tan(th) > p.mu;
  if (p.mu > 0) {
    const fmag = p.m * GRAVITY * Math.cos(th) * p.mu;
    drawArrow(ctx, cxb, cyb, cxb - dx * fmag * fs, cyb - dy * fmag * fs, PALETTE.crimson, 2);
  }
  drawCaption(ctx, w / 2, h * 0.12,
    slides ? "tan θ > μ — it slides" : "tan θ ≤ μ — static friction holds it", PALETTE.inkSoft, 11.5);
}

function drawProjectile(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const groundY = h * 0.88;
  const th = (p.angleDeg * Math.PI) / 180;
  const idealRange = (p.v0 ** 2 * Math.sin(2 * th)) / GRAVITY + 1;
  const idealPeak = p.y0 + (p.v0 * Math.sin(th)) ** 2 / (2 * GRAVITY) + 1;
  const scale = Math.min((w * 0.82) / idealRange, (groundY - h * 0.16) / idealPeak);
  const X = (x) => w * 0.09 + x * scale;
  const Y = (y) => groundY - y * scale;

  drawGround(ctx, w, h, groundY);
  if (p.y0 > 0) {
    ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(w * 0.09 - 22, Y(p.y0), 24, groundY - Y(p.y0)); ctx.fill(); ctx.stroke();
  }
  if (Play.trail.length > 1) drawTrail(ctx, Play.trail.map((t) => ({ x: X(t.x), y: Y(t.y) })), PALETTE.navy);

  const px = X(s.x), py = Y(s.y);
  const vs = clampNum(scale * 0.35, 0.6, 3.2);
  drawArrow(ctx, px, py, px + s.vx * vs, py, PALETTE.navy, 1.8);
  drawArrow(ctx, px, py, px, py - s.vy * vs, PALETTE.crimson, 1.8);
  sphereShade(ctx, px, py, 7, PALETTE.ink);
  drawAngleArc(ctx, X(0), Y(p.y0), 30, -th, 0, PALETTE.brass, `${p.angleDeg}°`);
  if (p.drag > 0) drawCaption(ctx, w / 2, h * 0.12, "with air resistance the path is no longer a symmetric parabola", PALETTE.inkSoft, 11);
}

function drawFlywheel(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w / 2, cy = h * 0.5;
  const Rpx = clampNum(Math.min(w, h) * 0.3, 50, 150);

  ctx.save(); ctx.translate(cx, cy); ctx.rotate(s.th);
  ctx.fillStyle = PALETTE.panel; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(0, 0, Rpx, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = PALETTE.brass; ctx.lineWidth = 6; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.arc(0, 0, Rpx - 5, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1; ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 1.6;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * Rpx * 0.16, Math.sin(a) * Rpx * 0.16);
    ctx.lineTo(Math.cos(a) * Rpx * 0.92, Math.sin(a) * Rpx * 0.92); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, Rpx * 0.16, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath(); ctx.arc(Rpx * 0.72, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (p.tau > 0) {
    ctx.strokeStyle = PALETTE.crimson; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(cx, cy, Rpx + 18, -0.9, 0.9); ctx.stroke();
    const ex = cx + (Rpx + 18) * Math.cos(0.9), ey = cy + (Rpx + 18) * Math.sin(0.9);
    drawArrow(ctx, ex - 6, ey - 8, ex, ey, PALETTE.crimson, 2.4);
    drawCaption(ctx, cx + Rpx + 52, cy, `τ = ${p.tau.toFixed(1)} N·m`, PALETTE.crimson, 10.5);
  }
}

function drawOrbit(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w * 0.5, cy = h * 0.5;
  const span = Math.max(p.r0 * 2.6, Math.hypot(s.x, s.y) * 1.2);
  const scale = Math.min(w, h) * 0.42 / span;
  const X = (x) => cx + x * scale;
  const Y = (y) => cy + y * scale;

  if (Play.trail.length > 1) drawTrail(ctx, Play.trail.map((t) => ({ x: X(t.x), y: Y(t.y) })), PALETTE.navy);

  const Rearth = 6.371e6 * scale;
  sphereShade(ctx, cx, cy, Math.max(Rearth, 8), PALETTE.brass);
  ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = PALETTE.rule; ctx.setLineDash([2, 6]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, p.r0 * scale, 0, Math.PI * 2); ctx.stroke(); ctx.restore();

  const px = X(s.x), py = Y(s.y);
  const r = Math.hypot(s.x, s.y) || 1;
  drawArrow(ctx, px, py, px + ((cx - px) / r) * 3e6 * scale, py + ((cy - py) / r) * 3e6 * scale, PALETTE.crimson, 1.8);
  const vmag = Math.hypot(s.vx, s.vy) || 1;
  drawArrow(ctx, px, py, px + (s.vx / vmag) * 34, py + (s.vy / vmag) * 34, PALETTE.navy, 1.8);
  sphereShade(ctx, px, py, 6, PALETTE.ink);
}

function drawKepler(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w * 0.5, cy = h * 0.5;
  const scale = (Math.min(w, h) * 0.44) / p.r3;
  const X = (x) => cx + x * scale;
  const Y = (y) => cy + y * scale;

  sphereShade(ctx, cx, cy, Math.max(EARTH_RADIUS * scale, 7), PALETTE.brass);

  const colours = [PALETTE.navy, PALETTE.forest, PALETTE.crimson];
  const radii = [p.r1, p.r2, p.r3];
  const pos = [[s.x1, s.y1], [s.x2, s.y2], [s.x3, s.y3]];

  radii.forEach((r, i) => {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = colours[i];
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // A radius line to each satellite. Seeing the three lines fan apart is the
  // point: they set off together and the outer one falls steadily behind.
  pos.forEach(([x, y], i) => {
    const px = X(x), py = Y(y);
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = colours[i];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.restore();
    sphereShade(ctx, px, py, 5, colours[i]);
  });
}

function drawHohmann(ctx, w, h, sim) {
  const p = sim.params, s = sim.state;
  const cx = w * 0.5, cy = h * 0.5;
  const scale = (Math.min(w, h) * 0.42) / p.r2;
  const X = (x) => cx + x * scale;
  const Y = (y) => cy + y * scale;

  sphereShade(ctx, cx, cy, Math.max(EARTH_RADIUS * scale, 7), PALETTE.brass);

  // The two circular orbits the manoeuvre joins.
  [[p.r1, PALETTE.navy], [p.r2, PALETTE.forest]].forEach(([r, colour]) => {
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = colour;
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // The transfer ellipse: perigee at r1, apogee at r2, so the Earth sits at
  // the focus nearer the starting orbit.
  const aT = (p.r1 + p.r2) / 2;
  const eT = (p.r2 - p.r1) / (p.r2 + p.r1);
  const bT = aT * Math.sqrt(1 - eT * eT);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = PALETTE.brass;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.ellipse(cx - aT * eT * scale, cy, aT * scale, bT * scale, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (Play.trail.length > 1) {
    drawTrail(ctx, Play.trail.map((t) => ({ x: X(t.x), y: Y(t.y) })), PALETTE.navy);
  }

  // Burn markers, at perigee and apogee of the transfer.
  const burnMark = (x, label, done) => {
    ctx.save();
    ctx.globalAlpha = done ? 0.9 : 0.45;
    ctx.strokeStyle = PALETTE.crimson;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(X(x), cy, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, X(x), cy - 14, label, PALETTE.crimson, 10);
  };
  burnMark(p.r1, "burn 1", true);
  burnMark(-p.r2, "burn 2", !!s.burned);

  const px = X(s.x), py = Y(s.y);
  const vmag = Math.hypot(s.vx, s.vy) || 1;
  drawArrow(ctx, px, py, px + (s.vx / vmag) * 30, py + (s.vy / vmag) * 30, PALETTE.navy, 1.8);
  sphereShade(ctx, px, py, 6, PALETTE.ink);
}

// Scenarios whose path is worth tracing.
SCENARIOS.projectile.trailPoint = (s) => ({ x: s.x, y: s.y });
SCENARIOS.orbit.trailPoint = (s) => ({ x: s.x, y: s.y });
SCENARIOS.hohmann.trailPoint = (s) => ({ x: s.x, y: s.y });

/* ============================================================================
   loop
   ========================================================================== */

let playResizeObserver = null;
let graphResizeObserver = null;

/* The analysis chart shares the scene's repaint cadence. Split out so the
   theme-repaint registration and the frame loop call the same code. */
function paintPlayGraph() {
  const graph = document.getElementById("pg-canvas");
  if (!graph || typeof PlayGraph === "undefined") return;
  const g = graph.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  PlayGraph.draw(g, graph.width / dpr, graph.height / dpr);
  if (typeof onPlayGraphPainted === "function") onPlayGraphPainted();
}

function playPaint() {
  const canvas = document.getElementById("play-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr, h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  scenario().draw(ctx, w, h, Play);
  paintPlayGraph();
}

// The loop only turns over while something is moving. Idling a
// requestAnimationFrame callback to repaint an unchanging picture burns a
// frame's work sixty times a second for nothing.
function playLoop(now) {
  const dt = Play.lastFrame === null ? 0 : (now - Play.lastFrame) / 1000;
  Play.lastFrame = now;

  if (!Play.running) {
    Play.handle = null;
    playPaint();
    if (typeof onPlayTick === "function") onPlayTick();
    return;
  }
  playAdvance(dt);
  playPaint();
  if (typeof onPlayTick === "function") onPlayTick();
  Play.handle = requestAnimationFrame(playLoop);
}

// True when the reader has asked the operating system to reduce motion.
function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Advance to the end without animating, bounded by REAL elapsed time. A step
// budget cannot work: a scenario running at 260x compresses hours into each
// call, so a fixed count would freeze the tab for seconds.
function fastForwardToEnd(budgetMs = 250) {
  const deadline = performance.now() + budgetMs;
  while (!Play.finished && performance.now() < deadline) playAdvance(1 / 60);
  Play.running = false;
  Play.finished = true;
  playPaint();
}

function resumePlayLoop() {
  if (Play.handle !== null) return;
  // Every route into the loop honours the preference, not just the Run
  // button. Resuming after a pause used to start animating regardless.
  if (prefersReducedMotion()) { fastForwardToEnd(); return; }
  Play.lastFrame = null;
  Play.handle = requestAnimationFrame(playLoop);
}

function pausePlayLoop() {
  Play.running = false;
  if (Play.handle) cancelAnimationFrame(Play.handle);
  Play.handle = null;
  playPaint();
}

function startPlayLoop() {
  const canvas = document.getElementById("play-canvas");
  if (!canvas) return;
  stopPlayLoop();
  playResizeObserver = fitCanvasToParent(canvas, canvas.getContext("2d"));

  const graph = document.getElementById("pg-canvas");
  if (graph) {
    graphResizeObserver = fitCanvasToParent(graph, graph.getContext("2d"));
    // A paused chart still has to repaint when the theme flips, or it keeps
    // one theme's ink on the other theme's ground.
    registerOneShot(graph, paintPlayGraph);
  }
  Play.lastFrame = null;
  playPaint();
  if (Play.running) resumePlayLoop();
}

function stopPlayLoop() {
  if (Play.handle) cancelAnimationFrame(Play.handle);
  Play.handle = null;
  Play.running = false;
  if (playResizeObserver) playResizeObserver.disconnect();
  if (graphResizeObserver) graphResizeObserver.disconnect();
  graphResizeObserver = null;
  playResizeObserver = null;
}

/* --- convergence self-test ----------------------------------------------- */

// Halving the step must cut the error about 16x for a fourth-order method.
//
// The reference has to be EXACT for the equation being integrated. Measuring
// the non-linear pendulum against the small-angle formula does not work: the
// gap between those two is a difference of physical models, so it stays put
// as h shrinks and the apparent order collapses to zero. The frictionless
// horizontal spring is the right test case — a = −(k/m)x genuinely depends on
// position, so it exercises every RK4 stage, and x = A·cos(ωt) solves it
// exactly.
// Self-convergence against a far finer run of the SAME equation. This is the
// canonical check because it is immune to two traps that a closed-form
// reference falls into: a reference that solves a *different* model (the
// small-angle pendulum), and an exact reference whose error bottoms out in
// floating-point roundoff before the asymptotic regime is reached.
//
// The pendulum is the subject because a = −(g/L)·sin θ is genuinely
// non-linear, so every RK4 stage must be evaluated at its own displaced
// state. A constant-acceleration scenario would pass no matter what, since
// RK4 integrates a constant exactly.
function integratorConvergenceOrder(steps = [1 / 60, 1 / 120, 1 / 240]) {
  return selfConvergenceOrder("pendulum", "th", steps);
}

function selfConvergenceOrder(type, key, steps = [1 / 60, 1 / 120, 1 / 240], target = 0.5) {
  const sc = SCENARIOS[type];
  const p = { ...sc.defaults };
  const integrate = (h) => {
    let state = sc.state0(p), t = 0;
    while (t + h <= target + 1e-12) { state = rk4(sc.derivatives, state, p, h); t += h; }
    return state[key];
  };
  const reference = integrate(1 / 8000);
  const errors = steps.map((h) => Math.abs(integrate(h) - reference));
  const order = [];
  for (let i = 1; i < errors.length; i++) {
    order.push(Math.log2(errors[i - 1] / Math.max(errors[i], Number.MIN_VALUE)));
  }
  return { errors, order };
}

/* ============================================================================
   Sandbox expansion — drag, reference frames, banking, spring networks, the
   physical pendulum, and the centre of mass of a shell that bursts.
   ----------------------------------------------------------------------------
   Each of these has a formula a student is expected to recall, and in every
   case the formula is the thing most often recalled WRONGLY: v_term as a speed
   the body eventually reaches, series springs as the stiff arrangement,
   2π√(d/g) for a swinging stick. None of them draws its motion from that
   formula. The equations are integrated and the closed form appears only in
   analytic() or in a readout, where a disagreement would be visible instead of
   impossible.
   ========================================================================== */

/* --- compacting sample buffers -------------------------------------------
   Three of these scenarios draw a curve of their own history: v against t for
   the falling body, x against t for the two oscillators, θ against t for the
   two pendulums. Play.trail caps at 420 points, which at 60 fps is the last
   seven seconds — for a ninety-second fall that discards precisely the rise
   the asymptote is measured against. These buffers keep the WHOLE span,
   halving their resolution each time they fill, which is invisible on a strip
   two hundred pixels wide.

   They are filled from trailPoint because that is the only hook a scenario
   gets that fires exactly once per integration frame. draw() repeats while
   paused and would stack a hundred samples on one instant, and a
   reduced-motion run never repaints at all until it is already over. */
const PLAY_TRACE_CAP = 1400;
const playTraces = new Map();

function playTraceOf(key, seriesCount) {
  let tr = playTraces.get(key);
  if (!tr || tr.y.length !== seriesCount) {
    tr = {
      x: [], y: Array.from({ length: seriesCount }, () => []),
      stride: 1, seen: 0, sig: null, last: -1,
    };
    playTraces.set(key, tr);
  }
  return tr;
}

/* Record one sample. The reset test needs BOTH halves: the clock going
   backwards catches Reset and Run again, and the parameter signature catches a
   slider drag, which restarts the run under the reader's hands without the
   clock necessarily having advanced first. Missing either one draws the new
   curve on top of the old one. */
function playTraceSample(key, values) {
  const tr = playTraceOf(key, values.length);
  const sig = Play.type + "|" + JSON.stringify(Play.params);
  if (sig !== tr.sig || Play.t <= tr.last) {
    tr.x.length = 0;
    tr.y.forEach((col) => { col.length = 0; });
    tr.stride = 1;
    tr.seen = 0;
    tr.sig = sig;
  }
  tr.last = Play.t;
  if (tr.seen++ % tr.stride !== 0) return tr;
  tr.x.push(Play.t);
  for (let i = 0; i < values.length; i++) tr.y[i].push(values[i]);
  if (tr.x.length >= PLAY_TRACE_CAP) {
    const half = (col) => {
      for (let i = 0, j = 0; j < col.length; i++, j += 2) col[i] = col[j];
      col.length = Math.ceil(col.length / 2);
    };
    half(tr.x);
    tr.y.forEach(half);
    tr.stride *= 2;
  }
  return tr;
}

/* --- a small framed chart ------------------------------------------------
   Used for the v–t trace, the twin oscillator strip and the T(d) curve. It
   returns the mapping so the caller can put its own markers on the same axes,
   and it clips rather than clamping: clamping folds an excursion onto the
   frame edge, which reads as a real value sitting exactly on the boundary. */
function playPlotFrame(ctx, x, y, w, h, xMin, xMax, yMin, yMax) {
  if (!(w > 56 && h > 38)) return null;
  const spanX = xMax - xMin;
  const spanY = yMax - yMin;
  if (!(Number.isFinite(spanX) && Number.isFinite(spanY) && spanX > 0 && spanY > 0)) return null;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = PALETTE.panel;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();

  return {
    x, y, w, h,
    X: (v) => x + ((v - xMin) / spanX) * w,
    Y: (v) => y + h - ((v - yMin) / spanY) * h,
    clip(fn) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      try { fn(); } finally { ctx.restore(); }
    },
  };
}

function playPlotLine(ctx, plot, xs, ys, colour, width, dash) {
  if (!plot || !xs || xs.length < 2) return;
  plot.clip(() => {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width || 1.6;
    ctx.lineJoin = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < xs.length; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) { started = false; continue; }
      const px = plot.X(xs[i]), py = plot.Y(ys[i]);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  });
}

/* A spring drawn with a coil amplitude the CALLER chooses. drawSpringCoil's
   amplitude is a fixed ten pixels, which is wider than a spring gets to be in
   a two-panel comparison on a narrow stage — the coils then overlap the block
   and the wall and the picture stops reading as a spring at all. */
function playSpring(ctx, x1, y1, x2, y2, coils, amp, colour) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 1) || !(coils > 0)) return;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  const segs = Math.max(Math.round(coils * 2), 2);
  for (let i = 1; i <= segs; i++) {
    const f = i / segs;
    const side = i % 2 === 0 ? 1 : -1;
    ctx.lineTo(x1 + ux * len * f + px * amp * side, y1 + uy * len * f + py * amp * side);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/* Every draw below opens with this. A canvas is laid out at 1×1 before its
   container has size, and arc() throws on the negative radius that a derived
   dimension becomes there rather than quietly drawing nothing. */
function playStageReady(w, h) {
  return w > 12 && h > 12 && PALETTE && PALETTE.ink;
}

/* ============================================================================
   19. Terminal velocity
   ========================================================================== */

/* Both drag laws share one time constant. For linear drag τ = m/b, and since
   v_term = mg/b that is the same number as v_term/g; for quadratic drag m/c is
   not even a time, but v_term/g still is, and it is the constant inside
   tanh(gt/v_term). One expression, correct for both, so the readout cannot
   quote a τ that belongs to the other law. */
function tvTerminal(p) {
  const k = Math.max(p.bDrag, 1e-9);
  return p.quad >= 0.5 ? Math.sqrt((p.m * GRAVITY) / k) : (p.m * GRAVITY) / k;
}

/* The drop is measured in time constants, not metres, so one control works for
   both laws and always lands the body somewhere on the interesting part of the
   curve. tvTerminal is defined once, just above -- a second identical copy used
   to sit here and shadow it. */
function tvTau(p) { return tvTerminal(p) / GRAVITY; }

/* Distance fallen after `p.h` time constants, closed form for each law. This
   sets where the ground goes; the motion itself is still integrated. */
function tvDropHeight(p) {
  const vt = tvTerminal(p);
  const tau = tvTau(p);
  const T = Math.max(p.h, 0.1) * tau;
  if (p.quad >= 0.5) {
    // x = v_t*tau*ln(cosh(T/tau)); log(cosh(u)) via the stable form, because
    // cosh overflows to Infinity by u = 710 and the ground would vanish.
    const u = T / tau;
    const lncosh = u + Math.log1p(Math.exp(-2 * u)) - Math.LN2;
    return vt * tau * lncosh;
  }
  return vt * T - vt * tau * (1 - Math.exp(-T / tau));
}

SCENARIOS.terminalVelocity = {
  label: "Terminal velocity",
  group: "Kinematics",
  ariaLabel: "Live simulation of a body dropped into still air, with its speed-time trace bending towards the terminal speed",
  blurb: "Let a body go in still air. Drag grows as it speeds up, until it exactly cancels the weight and the fall becomes steady. That steady speed is approached and never reached — which is why the trace bends towards the dashed line and flattens against it rather than crossing.",
  defaults: { m: 1.2, bDrag: 0.8, quad: 0, h: 4 },
  controls: [
    { key: "m", label: "Mass", min: 0.5, max: 20, step: 0.1, unit: "kg" },
    { key: "bDrag", label: "Drag coefficient — b if linear, c if quadratic", min: 0.02, max: 2.5, step: 0.02, unit: "SI" },
    { key: "quad", label: "Drag law: 0 = linear bv, 1 = quadratic cv²", min: 0, max: 1, step: 1, unit: "" },
    { key: "h", label: "Fall for \u2014 time constants \u03c4 (1\u03c4 = 63% of terminal, 3\u03c4 = 95%)", min: 1, max: 8, step: 0.5, unit: "\u03c4" },
  ],
  // y is distance FALLEN and v is downward speed, both measured positive down.
  // Written that way the drag term never changes sign during a drop, and the
  // equation stays the one on the page: m dv/dt = mg − bv.
  state0: () => ({ y: 0, v: 0 }),
  derivatives(state, p) {
    // |v|·v rather than v² so the quadratic law still OPPOSES the motion if
    // the state ever arrives here going upward. v² alone would accelerate such
    // a body, which is a runaway rather than a wrong number.
    const drag = p.quad >= 0.5
      ? (p.bDrag / p.m) * Math.abs(state.v) * state.v
      : (p.bDrag / p.m) * state.v;
    return { y: state.v, v: GRAVITY - drag };
  },
  // The textbook solutions, as an independent reference for the integrator.
  // Neither of them drives anything on screen.
  analytic(t, p) {
    const vT = tvTerminal(p);
    if (!Number.isFinite(vT) || vT <= 0) return null;
    const tau = vT / GRAVITY;
    if (p.quad >= 0.5) {
      const z = t / tau;
      // ln(cosh z) overflows to Infinity past z ≈ 710, and cosh has already
      // lost every bit of the −z branch by z = 20, where z − ln2 is exact to
      // the last place. Switching there keeps a long fall finite.
      const logCosh = z > 20 ? z - Math.LN2 : Math.log(Math.cosh(z));
      return { v: vT * Math.tanh(z), y: vT * tau * logCosh };
    }
    const e = Math.exp(-t / tau);
    return { v: vT * (1 - e), y: vT * t - vT * tau * (1 - e) };
  },
  events: [{ detect: (s, p) => tvDropHeight(p) - s.y, terminal: true, reason: "reached the ground" }],
  isStatic: () => false,
  // The run must last long enough for the body to actually reach terminal
  // velocity, or the scene shows uniform acceleration and then a stop -- the
  // exact opposite of its subject. Both are budgeted from tau, which spans
  // 0.2 s to 1000 s across the sliders, so no fixed number can serve both.
  // Resolve the motion against its own time constant rather than the clock: a
  // step of tau/2000 is far finer than an exponential needs, and it keeps the
  // whole fall inside a few seconds of watching at every setting.
  step: (p) => clampNum(tvTau(p) / 2000, 1 / 2000, 0.05),
  timeScale: (p) => clampNum(tvTau(p) / 1.5, 1, 400),
  maxDuration: (p) => tvTau(p) * 10 + 5,
  readouts(p, sim) {
    const vT = tvTerminal(p);
    const tau = vT / GRAVITY;
    const v = sim.state.v;
    const W = p.m * GRAVITY;
    const drag = p.quad >= 0.5 ? p.bDrag * Math.abs(v) * v : p.bDrag * v;
    // 95% of v_term: τ·ln20 for the exponential, τ·artanh(0.95) for the tanh.
    // They are different numbers (3.00τ against 1.83τ) and quoting one for the
    // other is the easiest way to make this panel disagree with the trace.
    const t95 = p.quad >= 0.5 ? tau * Math.atanh(0.95) : tau * Math.log(20);
    return [
      ["Drag law", p.quad >= 0.5 ? "quadratic — F_drag = c·v²" : "linear — F_drag = b·v"],
      ["Speed", `${v.toFixed(3)} m/s`],
      ["Terminal speed v_term", `${vT.toFixed(3)} m/s`],
      ["Fraction of v_term", `${((v / vT) * 100).toFixed(2)} %`],
      ["Time constant τ = v_term/g", `${tau.toFixed(3)} s`],
      ["95 % of v_term at", `${t95.toFixed(2)} s`],
      ["Weight mg", `${W.toFixed(2)} N`],
      ["Drag force now", `${drag.toFixed(3)} N`],
      ["Net force mg − F_drag", `${(W - drag).toFixed(4)} N`],
      ["Fallen", `${sim.state.y.toFixed(2)} m`],
      ["Still to fall", `${Math.max(tvDropHeight(p) - sim.state.y, 0).toFixed(2)} m`],
      ["Drop height", `${tvDropHeight(p).toFixed(1)} m  (${p.h.toFixed(1)}\u03c4)`],
    ];
  },
  draw: drawTerminalVelocity,
};

/* The two drag laws are two SEPARATE solver chapters, and app.js reads
   `chapter` as a value rather than calling it. A getter is the only way to
   route the toggle to the right one — handing a quadratic run to the linear
   chapter would answer mg/b for a body whose terminal speed is √(mg/c), which
   at the defaults is 14.7 m/s against 3.8 m/s. */
Object.defineProperty(SCENARIOS.terminalVelocity, "handoff", {
  enumerable: true,
  get() {
    const live = Play.type === "terminalVelocity" ? Play.params : SCENARIOS.terminalVelocity.defaults;
    const quad = live.quad >= 0.5;
    return {
      chapter: "forces",
      variant: quad ? "drag_quadratic" : "drag_linear",
      knowns: (p) => (p.quad >= 0.5
        ? { mass_d: p.m, c_drag: p.bDrag }
        : { mass_d: p.m, b_drag: p.bDrag }),
    };
  },
});

// The fall is a straight line, so there is no path worth tracing; what is
// worth keeping is v against t. Returning null leaves Play.trail empty.
SCENARIOS.terminalVelocity.trailPoint = (s) => {
  playTraceSample("terminalVelocity", [s.v]);
  return null;
};

function drawTerminalVelocity(ctx, w, h, sim) {
  if (!playStageReady(w, h)) return;
  const p = sim.params, s = sim.state;
  const vT = tvTerminal(p);
  const tau = vT / GRAVITY;

  // The trace earns its own half only when there is a half to give it. Below
  // this the split leaves the chart narrower than its own axis labels, and a
  // shaft with no graph is a better picture than two unreadable ones.
  const plotW = w >= 400 ? Math.min(w * 0.52, 520) : 0;
  const shaftW = w - plotW;

  const topY = 30;
  const groundY = h - 34;
  const span = Math.max(groundY - topY, 8);
  const cx = shaftW * 0.42;
  const H = tvDropHeight(p);
  const Y = (fallen) => topY + clampNum(fallen / Math.max(H, 1e-6), 0, 1) * span;

  // --- the shaft ----------------------------------------------------------
  ctx.save();
  ctx.strokeStyle = PALETTE.rule;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  [cx - 34, cx + 34].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, groundY);
    ctx.stroke();
  });
  ctx.restore();

  // Height marks at whatever round interval the shaft can resolve.
  const stepM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((m) => (m / H) * span > 16) || 2000;
  ctx.save();
  ctx.strokeStyle = PALETTE.rule;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  for (let d = 0; d <= H + 1e-9; d += stepM) {
    const y = Y(d);
    ctx.beginPath();
    ctx.moveTo(cx - 44, y);
    ctx.lineTo(cx - 34, y);
    ctx.stroke();
  }
  ctx.restore();

  drawGround(ctx, shaftW, h, groundY);
  drawLabel(ctx, cx, topY - 14, `drop ${H < 100 ? H.toFixed(1) : H.toFixed(0)} m  \u2014  ${p.h.toFixed(1)}\u03c4`, PALETTE.inkSoft, 10);

  // --- the body -----------------------------------------------------------
  const by = Y(s.y);
  const rBody = clampNum(6 + p.m * 0.5, 6, 15);
  sphereShade(ctx, cx, by, rBody, PALETTE.ink);

  // --- the two forces -----------------------------------------------------
  // Weight is drawn at a fixed length because it never changes; drag is drawn
  // as the same length times drag/mg, so the two arrows becoming equal and
  // opposite IS the terminal condition rather than an annotation about it.
  const W = p.m * GRAVITY;
  const drag = p.quad >= 0.5 ? p.bDrag * Math.abs(s.v) * s.v : p.bDrag * s.v;
  const ratio = clampNum(drag / W, 0, 1.2);
  const fLen = clampNum(span * 0.20, 16, 70);
  drawArrow(ctx, cx, by + rBody, cx, by + rBody + fLen, PALETTE.navy, 2.2);
  drawLabel(ctx, cx + 14, by + rBody + fLen + 10, `mg = ${W.toFixed(1)} N`, PALETTE.navy, 10, "left");
  if (ratio > 0.002) {
    drawArrow(ctx, cx, by - rBody, cx, by - rBody - fLen * ratio, PALETTE.crimson, 2.2);
    drawLabel(ctx, cx + 14, by - rBody - fLen * ratio - 8,
      `drag = ${Math.abs(drag).toFixed(1)} N`, PALETTE.crimson, 10, "left");
  }
  if (ratio > 0.985) {
    drawLabel(ctx, cx, Math.max(topY + 12, by - rBody - fLen * ratio - 24),
      "drag has caught the weight", PALETTE.forest, 11);
  }

  // --- the trace ----------------------------------------------------------
  if (plotW <= 0) return;
  const tr = playTraceOf("terminalVelocity", 1);
  const vs = tr.y[0];
  let vSeen = Math.abs(s.v);
  for (let i = 0; i < vs.length; i++) if (vs[i] > vSeen) vSeen = vs[i];
  vSeen = Math.max(vSeen, 0.05);

  // If v_term is a hundred times anything this fall reaches, drawing the
  // asymptote would squash the curve onto the axis and teach nothing. Say so
  // instead of drawing a line off the top of the box.
  /* The asymptote comes into view the instant the body passes 1/3.2 of
     terminal, and switching the axis on that instant collapsed the whole trace
     to a third of its height between two frames. Blend across the crossing
     instead: the axis then grows smoothly and the curve never jumps. */
  const inView = clampNum((vSeen * 3.2 / Math.max(vT, 1e-9) - 0.85) / 0.30, 0, 1);
  const yFull = Math.max(vT * 1.14, vSeen * 1.14);
  const yZoom = vSeen * 1.2;
  const yMax = yZoom + (yFull - yZoom) * (inView * inView * (3 - 2 * inView));
  const asymptoteInView = inView > 0.5;
  const xMax = Math.max(tr.x.length ? tr.x[tr.x.length - 1] : 0, Play.t, tau * 1.2, 0.5) * 1.05;

  const px = shaftW + 14;
  const py = 34;
  const pw = plotW - 30;
  const ph = h - 74;
  const plot = playPlotFrame(ctx, px, py, pw, ph, 0, xMax, 0, yMax);
  drawLabel(ctx, px + pw / 2, py - 12, "speed against time", PALETTE.inkSoft, 10);
  if (!plot) return;

  if (asymptoteInView) {
    drawDashedLine(ctx, plot.X(0), plot.Y(vT), plot.X(xMax), plot.Y(vT), PALETTE.brass, 1.4, [6, 5]);
    drawLabel(ctx, plot.x + plot.w - 6, plot.Y(vT) - 9,
      `v_term = ${vT.toFixed(2)} m/s`, PALETTE.brass, 10, "right");
    // Where the tangent at the origin would have reached v_term: the classic
    // reading of the time constant off a graph.
    if (plot.X(tau) < plot.x + plot.w - 4) {
      drawDashedLine(ctx, plot.X(tau), plot.Y(0), plot.X(tau), plot.Y(vT), PALETTE.rule, 1, [3, 4]);
      drawLabel(ctx, plot.X(tau), plot.y + plot.h - 8, "τ", PALETTE.inkSoft, 10);
      ctx.save();
      ctx.strokeStyle = PALETTE.rule;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.X(0), plot.Y(0));
      ctx.lineTo(plot.X(tau), plot.Y(vT));
      ctx.stroke();
      ctx.restore();
    }
  } else {
    drawLabel(ctx, plot.x + plot.w / 2, plot.y + 14,
      `v_term = ${vT.toFixed(0)} m/s — far above this fall`, PALETTE.brass, 10);
  }

  playPlotLine(ctx, plot, tr.x, vs, PALETTE.navy, 1.8);
  if (Number.isFinite(s.v)) {
    plot.clip(() => {
      ctx.save();
      ctx.fillStyle = PALETTE.navy;
      ctx.beginPath();
      ctx.arc(plot.X(Math.min(Play.t, xMax)), plot.Y(s.v), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
  drawLabel(ctx, plot.x + 4, plot.y + plot.h + 12, "t", PALETTE.inkSoft, 10, "left");
}

/* ============================================================================
   20. River crossing — the same motion in two frames
   ========================================================================== */

SCENARIOS.relativeVelocity = {
  label: "River crossing",
  group: "Kinematics",
  ariaLabel: "Live simulation of a boat crossing a flowing river, showing its track over the ground and its track through the water at the same time",
  blurb: "The engine drives the boat through the WATER, and the water is itself moving, so the track over the ground is the sum of the two. Head upstream at sinθ = v_current/v_boat and you land straight across — provided the boat is fast enough for such a heading to exist at all.",
  defaults: { vBoat: 5, vCurrent: 3, width: 30, headDeg: 0 },
  controls: [
    { key: "vBoat", label: "Boat speed through the water", min: 2.5, max: 12, step: 0.1, unit: "m/s" },
    { key: "vCurrent", label: "Current speed", min: 0, max: 12, step: 0.1, unit: "m/s" },
    { key: "width", label: "River width", min: 10, max: 50, step: 1, unit: "m" },
    { key: "headDeg", label: "Heading — 0 straight across, + upstream", min: -70, max: 70, step: 1, unit: "°" },
  ],
  // Two positions integrated side by side from ONE pair of velocities:
  // (x, y) over the ground, and (x2, y2) relative to the parcel of water the
  // boat set off beside. Same motion, two frames. Describing the second in a
  // readout while only drawing the first is what makes the frame feel like a
  // bookkeeping trick rather than a physical choice, so both are integrated.
  state0: () => ({ x: 0, y: 0, x2: 0, y2: 0 }),
  derivatives(state, p) {
    const th = (p.headDeg * Math.PI) / 180;
    const bx = -p.vBoat * Math.sin(th);        // upstream is −x
    const by = p.vBoat * Math.cos(th);
    return { x: bx + p.vCurrent, y: by, x2: bx, y2: by };
  },
  // Uniform motion in both frames, so the reference is exact and any drift is
  // the integrator's alone.
  analytic(t, p) {
    const th = (p.headDeg * Math.PI) / 180;
    const bx = -p.vBoat * Math.sin(th);
    const by = p.vBoat * Math.cos(th);
    return { x: (bx + p.vCurrent) * t, y: by * t, x2: bx * t, y2: by * t };
  },
  events: [{ detect: (s, p) => p.width - s.y, terminal: true, reason: "reached the far bank" }],
  isStatic: () => false,
  // The heading is capped at 70° precisely so cos θ can never approach zero: a
  // boat aimed straight upstream never crosses at all, and a crossing that
  // cannot finish is a worse lesson than one that finishes late. That cap also
  // bounds the slowest crossing at w/(v_boat·cos70°) = 58 s, which is why a
  // modest time scale is enough to keep every setting watchable.
  timeScale: 2,
  maxDuration: 90,
  readouts(p, sim) {
    const th = (p.headDeg * Math.PI) / 180;
    const bx = -p.vBoat * Math.sin(th);
    const by = p.vBoat * Math.cos(th);
    const gx = bx + p.vCurrent;
    const tCross = p.width / by;
    const drift = gx * tCross;
    // No heading lands you straight across once the current matches the boat:
    // sin θ = v_c/v_b has no solution above 1. Clamping to 90° would print a
    // heading that looks like an answer and drifts downstream for ever.
    const ferry = p.vCurrent < p.vBoat ? (Math.asin(p.vCurrent / p.vBoat) * 180) / Math.PI : null;
    const vStraight = p.vCurrent < p.vBoat ? Math.sqrt(p.vBoat ** 2 - p.vCurrent ** 2) : null;
    return [
      ["Over the ground", `${gx.toFixed(2)} across-stream, ${by.toFixed(2)} m/s`],
      ["Speed over the ground", `${Math.hypot(gx, by).toFixed(3)} m/s`],
      ["Through the water", `${bx.toFixed(2)} , ${by.toFixed(2)} m/s`],
      ["Speed through the water", `${p.vBoat.toFixed(3)} m/s`],
      ["Crossing time w / v_y", `${tCross.toFixed(2)} s`],
      ["Drift at the far bank", `${drift.toFixed(2)} m`],
      ["Heading for zero drift", ferry === null
        ? "none — the current is at least as fast as the boat"
        : `${ferry.toFixed(1)}° upstream`],
      ["Straight-across speed", vStraight === null
        ? "√(v_b² − v_c²) is imaginary here"
        : `${vStraight.toFixed(3)} m/s`],
      ["Position over the ground", `${sim.state.x.toFixed(2)} , ${sim.state.y.toFixed(2)} m`],
      ["Position in the water's frame", `${sim.state.x2.toFixed(2)} , ${sim.state.y2.toFixed(2)} m`],
      ["Distance through the water", `${Math.hypot(sim.state.x2, sim.state.y2).toFixed(2)} m`],
    ];
  },
  // The four sliders ARE the chapter's four givens, and the sandbox integrates
  // exactly the uniform motion the chapter solves, so this hands over at every
  // setting — including the one where the ferry angle has no solution, which is
  // a result the chapter is required to report rather than a gap in it.
  handoff: {
    chapter: "kinematics",
    variant: "relvel",
    knowns: (p) => ({
      v_boat: p.vBoat, v_current: p.vCurrent, w_river: p.width, theta_head: p.headDeg,
    }),
  },
  draw: drawRelativeVelocity,
};

SCENARIOS.relativeVelocity.trailPoint = (s) => ({ x: s.x, y: s.y });

function drawRelativeVelocity(ctx, w, h, sim) {
  if (!playStageReady(w, h)) return;
  const p = sim.params, s = sim.state;
  const th = (p.headDeg * Math.PI) / 180;
  const bx = -p.vBoat * Math.sin(th);
  const by = p.vBoat * Math.cos(th);
  const gx = bx + p.vCurrent;
  const tCross = p.width / by;
  const landing = gx * tCross;

  // Enclose the banks, the whole ground track and the drifting water parcel,
  // so a heavy downstream drift zooms out rather than sailing off the stage.
  const world = newWorld(0, 0);
  includePoint(world, 0, p.width, 0);
  includePoint(world, landing, p.width, 0);
  includePoint(world, s.x, s.y, 1);
  includePoint(world, p.vCurrent * Play.t, 0, 1);
  includePoint(world, Math.min(landing, 0) - p.width * 0.15, 0, 0);
  includePoint(world, Math.max(landing, 0) + p.width * 0.15, 0, 0);
  const view = fitView("relativeVelocity", w, h, world, { pad: 0.16 });

  const yNear = view.Y(0), yFar = view.Y(p.width);

  // --- the water ----------------------------------------------------------
  ctx.save();
  ctx.fillStyle = PALETTE.navy;
  ctx.globalAlpha = 0.10;
  ctx.fillRect(0, Math.min(yNear, yFar), w, Math.abs(yFar - yNear));
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  [yNear, yFar].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });
  ctx.restore();
  drawLabel(ctx, 10, yFar - 10, "far bank", PALETTE.inkSoft, 10, "left");
  drawLabel(ctx, 10, yNear + 16, "near bank", PALETTE.inkSoft, 10, "left");

  // Flow streaks, offset by the distance the water has actually moved. They
  // slide at the current's own speed, so "the river is moving" is shown rather
  // than captioned.
  if (p.vCurrent > 0.001 && Math.abs(yFar - yNear) > 26) {
    const spacing = 46;
    const shift = ((view.S(p.vCurrent * Play.t) % spacing) + spacing) % spacing;
    ctx.save();
    ctx.globalAlpha = 0.35;
    const lanes = 4;
    for (let i = 1; i < lanes; i++) {
      const y = yNear + ((yFar - yNear) * i) / lanes;
      for (let x = -spacing + shift; x < w; x += spacing) {
        drawArrow(ctx, x, y, x + 22, y, PALETTE.navy, 1.2);
      }
    }
    ctx.restore();
  }

  // --- the zero-drift track, when one exists ------------------------------
  if (p.vCurrent < p.vBoat) {
    drawDashedLine(ctx, view.X(0), yNear, view.X(0), yFar, PALETTE.forest, 1.2, [5, 5]);
    drawLabel(ctx, view.X(0), yFar - 24,
      `${((Math.asin(p.vCurrent / p.vBoat) * 180) / Math.PI).toFixed(0)}° upstream lands here`,
      PALETTE.forest, 10);
  }

  // --- the ground track and the landing point -----------------------------
  if (Play.trail.length > 1) {
    drawTrail(ctx, Play.trail.map((q) => ({ x: view.X(q.x), y: view.Y(q.y) })), PALETTE.navy);
  }
  drawDashedLine(ctx, view.X(landing), yFar - 12, view.X(landing), yFar + 12, PALETTE.crimson, 1.6, [4, 3]);
  drawLabel(ctx, view.X(landing), yFar - 20, `drift ${landing.toFixed(1)} m`, PALETTE.crimson, 10);

  // --- the drifting water parcel ------------------------------------------
  // The origin of the water's frame: the patch of river the boat started
  // beside. The dashed line from it to the boat IS the water-frame position,
  // and it is always exactly v_boat·t long however hard the river pushes.
  const parcelX = view.X(p.vCurrent * Play.t);
  const bxPix = view.X(s.x), byPix = view.Y(s.y);
  ctx.save();
  ctx.strokeStyle = PALETTE.forest;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(parcelX, yNear);
  ctx.lineTo(bxPix, byPix);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(parcelX, yNear, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  drawLabel(ctx, parcelX, yNear + 30, "the water's frame", PALETTE.forest, 10);

  // --- the boat -----------------------------------------------------------
  // Pointed along its HEADING, not along its course over the ground. Those two
  // differ by exactly the amount this scenario is about.
  const hull = clampNum(Math.min(w, h) * 0.035, 8, 20);
  ctx.save();
  ctx.translate(bxPix, byPix);
  ctx.rotate(Math.atan2(-by, bx));
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.moveTo(hull, 0);
  ctx.lineTo(-hull * 0.7, hull * 0.52);
  ctx.lineTo(-hull * 0.45, 0);
  ctx.lineTo(-hull * 0.7, -hull * 0.52);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // --- the velocity triangle, drawn on the boat ---------------------------
  const vScale = clampNum(Math.min(w, h) * 0.028, 3, 14);
  const hx = bxPix + bx * vScale, hy = byPix - by * vScale;
  drawArrow(ctx, bxPix, byPix, hx, hy, PALETTE.forest, 2);
  drawArrow(ctx, hx, hy, hx + p.vCurrent * vScale, hy, PALETTE.brass, 2);
  drawArrow(ctx, bxPix, byPix, bxPix + gx * vScale, byPix - by * vScale, PALETTE.crimson, 2.2);
  if (w > 380) {
    drawLabel(ctx, hx - 8, hy - 8, "v_boat", PALETTE.forest, 10, "right");
    drawLabel(ctx, hx + p.vCurrent * vScale + 6, hy - 8, "v_current", PALETTE.brass, 10, "left");
    drawLabel(ctx, bxPix + gx * vScale + 6, byPix - by * vScale + 12, "v_ground", PALETTE.crimson, 10, "left");
  }

  if (p.vCurrent >= p.vBoat) {
    drawLabel(ctx, w / 2, 18,
      "the current is at least as fast as the boat — no heading lands straight across",
      PALETTE.crimson, 11);
  }
  drawZoomBar(ctx, w, h, view, "m");
}

/* ============================================================================
   21. Banked curve
   ========================================================================== */

const BANK_HALF_WIDTH = 4;      // metres of bank surface either side of the design line

/* The band of speeds friction can hold on this bank. Both ends come from the
   same statement — |a along the surface| ≤ μN/m — solved for v, which is why
   they are computed together rather than quoted from memory separately. */
function bankBand(p) {
  const th = (p.bankDeg * Math.PI) / 180;
  const R = Math.max(p.radius, 0.1);
  const tanT = Math.tan(th);
  const gR = GRAVITY * R;
  const denom = 1 - p.mu * tanT;
  // μ·tanθ ≥ 1 means friction can hold ANY speed: the rider cannot be thrown
  // up a bank that steep with grip that good. Reporting the root of a negative
  // denominator would print NaN beside a rider sitting perfectly still.
  const vMax = denom > 1e-9 ? Math.sqrt((gR * (tanT + p.mu)) / denom) : Infinity;
  const vMin = tanT > p.mu ? Math.sqrt((gR * (tanT - p.mu)) / (1 + p.mu * tanT)) : 0;
  return { vMin, vMax, ideal: Math.sqrt(gR * tanT), tanT };
}

SCENARIOS.bankedCurve = {
  label: "Banked curve",
  group: "Energy & circular motion",
  ariaLabel: "Live simulation of a skateboard on a banked bend seen in cross-section, with a top-down inset of the lap",
  blurb: "A banked bend, seen head-on. At exactly v = √(gR·tanθ) the bank alone turns the rider and nothing slides — no friction needed. Faster and the rider climbs the bank, slower and it sinks towards the infield. Add friction and a whole BAND of speeds holds instead of one.",
  defaults: { radius: 25, bankDeg: 20, v0: 9.4, mu: 0.25, m: 70 },
  controls: [
    { key: "radius", label: "Turn radius R", min: 8, max: 80, step: 1, unit: "m" },
    { key: "bankDeg", label: "Bank angle θ", min: 0, max: 45, step: 1, unit: "°" },
    { key: "v0", label: "Speed", min: 0.5, max: 35, step: 0.1, unit: "m/s" },
    { key: "mu", label: "Friction μ", min: 0, max: 1.2, step: 0.01, unit: "" },
    { key: "m", label: "Rider mass (cancels from every speed here)", min: 20, max: 120, step: 1, unit: "kg" },
  ],
  // u is position UP the bank surface from the design line; th is the lap
  // angle, carried so the inset can show where round the bend the rider is; v
  // is constant, since nothing here drives or brakes.
  state0: (p) => ({ u: 0, vu: 0, th: 0, v: p.v0 }),
  derivatives(state, p) {
    const th = (p.bankDeg * Math.PI) / 180;
    const R = Math.max(p.radius, 0.1);
    const cen = (state.v * state.v) / R;
    // Perpendicular to the surface the rider is in equilibrium apart from the
    // inward-normal share of the centripetal requirement, so N carries a v²
    // term. Using mg·cosθ alone — the flat-ground answer — understates the grip
    // available at speed, and the band derived from it is wrong at BOTH ends.
    const aN = GRAVITY * Math.cos(th) + cen * Math.sin(th);
    // Along the surface, up-slope positive. This is the whole display: zero at
    // v = √(gR tanθ), positive above it, negative below.
    const aFree = cen * Math.cos(th) - GRAVITY * Math.sin(th);
    const grip = p.mu * aN;
    if (Math.abs(state.vu) < 1e-6) {
      // Not sliding: static friction takes up whatever the bank leaves over,
      // up to its ceiling. Applying the kinetic law to a stationary rider makes
      // one that is comfortably held creep up the bank for ever.
      const a = Math.abs(aFree) <= grip ? 0 : aFree - Math.sign(aFree) * grip;
      return { u: state.vu, vu: a, th: state.v / R, v: 0 };
    }
    return { u: state.vu, vu: aFree - Math.sign(state.vu) * grip, th: state.v / R, v: 0 };
  },
  analytic(t, p) {
    const R = Math.max(p.radius, 0.1);
    const ref = { th: (p.v0 / R) * t, v: p.v0 };
    // Once friction is switched on the slide has no closed form worth the
    // name; the lap angle and the speed are still exact, so those stay.
    if (p.mu > 0) return ref;
    const bank = (p.bankDeg * Math.PI) / 180;
    ref.u = 0.5 * (((p.v0 * p.v0) / R) * Math.cos(bank) - GRAVITY * Math.sin(bank)) * t * t;
    return ref;
  },
  events: [
    { detect: (s) => BANK_HALF_WIDTH - s.u, terminal: true, reason: "climbed off the top of the bank" },
    { detect: (s) => BANK_HALF_WIDTH + s.u, terminal: true, reason: "slid down into the infield" },
    { detect: (s) => 4 * Math.PI - s.th, terminal: true, reason: "held the bank for two full laps" },
  ],
  isStatic: () => false,
  // Real time. A rider thrown off a 45° bank at 35 m/s clears the four metres
  // of surface in under a third of a second; speeding that up any further is
  // the difference between watching it happen and finding it already over.
  maxDuration: 60,
  readouts(p, sim) {
    const s = sim.state;
    const th = (p.bankDeg * Math.PI) / 180;
    const R = Math.max(p.radius, 0.1);
    const band = bankBand(p);
    const cen = (s.v * s.v) / R;
    const aFree = cen * Math.cos(th) - GRAVITY * Math.sin(th);
    const aN = GRAVITY * Math.cos(th) + cen * Math.sin(th);
    const inBand = s.v >= band.vMin - 1e-9 && s.v <= band.vMax + 1e-9;
    return [
      ["Design speed √(gR·tanθ)", `${band.ideal.toFixed(2)} m/s`],
      ["Slowest that holds v_min", band.vMin > 0 ? `${band.vMin.toFixed(2)} m/s` : "0 — friction alone holds it at rest"],
      ["Fastest that holds v_max", Number.isFinite(band.vMax)
        ? `${band.vMax.toFixed(2)} m/s`
        : "no upper limit — μ·tanθ ≥ 1"],
      ["Speed", `${s.v.toFixed(2)} m/s`],
      ["Verdict", inBand
        ? (Math.abs(aFree) < 1e-6 ? "the design speed exactly — no friction needed" : "inside the band — friction holds it")
        : (s.v > band.vMax ? "above v_max — climbing the bank" : "below v_min — sliding towards the infield")],
      ["Along the surface, frictionless", `${aFree.toFixed(3)} m/s²`],
      ["Friction available μN/m", `${(p.mu * aN).toFixed(3)} m/s²`],
      ["Normal force N", `${(p.m * aN).toFixed(1)} N`],
      ["mg / cos θ", `${((p.m * GRAVITY) / Math.cos(th)).toFixed(1)} N`],
      ["Height on the bank", `${(s.u * Math.sin(th)).toFixed(3)} m`],
      ["Distance up the bank", `${s.u.toFixed(3)} m`],
      ["Laps completed", `${(s.th / (2 * Math.PI)).toFixed(2)}`],
    ];
  },
  handoff: {
    chapter: "classicProblems",
    // v_max = √(gR(tanθ+μ)/(1−μtanθ)) has no upper root once μ·tanθ reaches 1:
    // the denominator is zero or negative and the chapter would answer with a
    // NaN, or worse a plausible number of the wrong sign, for a bank that
    // genuinely holds every speed there is.
    available: (p) => {
      const tanT = Math.tan((p.bankDeg * Math.PI) / 180);
      return p.mu * tanT >= 1
        ? `With μ = ${p.mu.toFixed(2)} on a ${p.bankDeg.toFixed(0)}° bank, μ·tanθ = ${(p.mu * tanT).toFixed(2)} ≥ 1. The denominator of v_max = √(gR(tanθ+μ)/(1−μtanθ)) is zero or negative, so there is no fastest holding speed to solve for — friction holds any speed on this bank. Lower μ or the bank angle to hand it over.`
        : null;
    },
    variant: "banked",
    knowns: (p) => ({
      v_bank: p.v0, r_bank: p.radius, theta_bank_b: p.bankDeg, mu_bank: p.mu, mass_bank: p.m,
    }),
  },
  draw: drawBankedCurve,
};

function drawBankedCurve(ctx, w, h, sim) {
  if (!playStageReady(w, h)) return;
  const p = sim.params, s = sim.state;
  const th = (p.bankDeg * Math.PI) / 180;
  const band = bankBand(p);

  // --- the cross-section --------------------------------------------------
  // The centre of the bend is off to the LEFT, so up-slope runs to the right.
  // A perspective view of a banked track hides the one angle the problem is
  // about; head-on shows it directly.
  const baseY = h * 0.70;
  const originX = w * 0.40;
  const halfPx = clampNum(Math.min(w * 0.26, h * 0.34), 20, 200);
  const scale = halfPx / BANK_HALF_WIDTH;      // pixels per metre of bank surface
  const ux = Math.cos(th), uy = -Math.sin(th); // up-slope, in canvas pixels
  const SX = (u) => originX + u * scale * ux;
  const SY = (u) => baseY + u * scale * uy;

  // the road bed
  ctx.save();
  ctx.strokeStyle = PALETTE.rule;
  ctx.lineWidth = clampNum(halfPx * 0.10, 3, 14);
  ctx.lineCap = "butt";
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(SX(-BANK_HALF_WIDTH), SY(-BANK_HALF_WIDTH));
  ctx.lineTo(SX(BANK_HALF_WIDTH), SY(BANK_HALF_WIDTH));
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.moveTo(SX(-BANK_HALF_WIDTH), SY(-BANK_HALF_WIDTH));
  ctx.lineTo(SX(BANK_HALF_WIDTH), SY(BANK_HALF_WIDTH));
  ctx.stroke();
  ctx.restore();

  // the horizontal, and the bank angle between them
  drawDashedLine(ctx, SX(-BANK_HALF_WIDTH), baseY, SX(BANK_HALF_WIDTH), baseY, PALETTE.rule, 1, [4, 5]);
  if (p.bankDeg > 0.5 && halfPx > 44) {
    drawAngleArc(ctx, originX, baseY, clampNum(halfPx * 0.36, 16, 54), -th, 0, PALETTE.brass,
      `${p.bankDeg.toFixed(0)}°`);
  }
  drawDashedLine(ctx, originX, baseY - halfPx * 0.9, originX, baseY + 10, PALETTE.rule, 1, [2, 5]);
  drawLabel(ctx, originX, baseY + 22, "design line", PALETTE.inkSoft, 10);
  if (originX - halfPx - 60 > 6) {
    drawLabel(ctx, 8, baseY - 4, "← centre of the bend", PALETTE.inkSoft, 10, "left");
  }

  // --- the rider ----------------------------------------------------------
  const u = clampNum(s.u, -BANK_HALF_WIDTH, BANK_HALF_WIDTH);
  const rx = SX(u), ry = SY(u);
  const board = clampNum(halfPx * 0.42, 14, 74);
  drawSkateboard(ctx, rx, ry, board, -th, { colour: PALETTE.crimson, tag: false });

  // --- the forces, in the surface's own axes ------------------------------
  const cen = (s.v * s.v) / Math.max(p.radius, 0.1);
  const aN = GRAVITY * Math.cos(th) + cen * Math.sin(th);
  const aFree = cen * Math.cos(th) - GRAVITY * Math.sin(th);
  const grip = p.mu * aN;
  const fric = Math.abs(s.vu) < 1e-6
    ? -clampNum(aFree, -grip, grip)
    : -Math.sign(s.vu) * grip;

  const fScale = clampNum(halfPx * 0.85, 18, 140) / Math.max(GRAVITY + aN, 1e-6);
  const ax = rx, ay = ry - board * 0.30;
  drawArrow(ctx, ax, ay, ax, ay + GRAVITY * fScale, PALETTE.navy, 2);
  const nx = Math.sin(th), ny = -Math.cos(th);
  drawArrow(ctx, ax, ay, ax + nx * aN * fScale, ay + ny * aN * fScale, PALETTE.forest, 2.2);
  if (Math.abs(fric) > 0.01) {
    drawArrow(ctx, ax, ay, ax + ux * fric * fScale, ay + uy * fric * fScale, PALETTE.brass, 2);
  }
  if (w > 340) {
    drawLabel(ctx, ax + nx * aN * fScale + 8, ay + ny * aN * fScale - 6, "N", PALETTE.forest, 10, "left");
    drawLabel(ctx, ax + 8, ay + GRAVITY * fScale + 10, "mg", PALETTE.navy, 10, "left");
    if (Math.abs(fric) > 0.01) {
      drawLabel(ctx, ax + ux * fric * fScale, ay + uy * fric * fScale - 12, "f", PALETTE.brass, 10);
    }
  }

  // --- the holding band ---------------------------------------------------
  // A band, not a number: the point of switching friction on is that one
  // speed becomes an interval, and an interval has to be drawn as one.
  const gy = h - 34;
  const gx0 = 22;
  const gw = Math.max(w - 44, 10);
  if (gw > 90 && h > 150) {
    const vScale = Math.max(band.ideal * 1.6, s.v * 1.25,
      Number.isFinite(band.vMax) ? band.vMax * 1.18 : 0, 1);
    const GX = (v) => gx0 + clampNum(v / vScale, 0, 1) * gw;

    ctx.save();
    ctx.strokeStyle = PALETTE.rule;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx0, gy);
    ctx.lineTo(gx0 + gw, gy);
    ctx.stroke();
    ctx.restore();

    const hi = Number.isFinite(band.vMax) ? band.vMax : vScale;
    ctx.save();
    ctx.fillStyle = PALETTE.forest;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(GX(band.vMin), gy - 13, Math.max(GX(hi) - GX(band.vMin), 1), 26);
    ctx.restore();

    drawDashedLine(ctx, GX(band.ideal), gy - 18, GX(band.ideal), gy + 18, PALETTE.brass, 1.4, [4, 4]);
    drawLabel(ctx, GX(band.ideal), gy - 24, "√(gR tanθ)", PALETTE.brass, 10);

    ctx.save();
    ctx.strokeStyle = PALETTE.crimson;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(GX(s.v), gy - 15);
    ctx.lineTo(GX(s.v), gy + 15);
    ctx.stroke();
    ctx.restore();
    drawLabel(ctx, GX(s.v), gy + 27, `${s.v.toFixed(1)} m/s`, PALETTE.crimson, 10);
    drawLabel(ctx, gx0, gy - 24, `holds from ${band.vMin.toFixed(1)}`, PALETTE.forest, 10, "left");
    drawLabel(ctx, gx0 + gw, gy - 24,
      Number.isFinite(band.vMax) ? `to ${band.vMax.toFixed(1)} m/s` : "with no upper limit",
      PALETTE.forest, 10, "right");
  }

  // --- the lap, from above ------------------------------------------------
  const insetR = clampNum(Math.min(w * 0.13, h * 0.17), 12, 62);
  if (w > 300 && h > 190) {
    const icx = w - insetR - 26, icy = insetR + 26;
    ctx.save();
    ctx.strokeStyle = PALETTE.rule;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = clampNum(insetR * 0.16, 2, 9);
    ctx.beginPath();
    ctx.arc(icx, icy, insetR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const a = s.th;
    drawSkateboard(ctx, icx + insetR * Math.cos(a), icy + insetR * Math.sin(a),
      Math.max(insetR * 0.42, 8), a + Math.PI / 2, { colour: PALETTE.crimson, tag: false });
    drawLabel(ctx, icx, icy, `R = ${p.radius.toFixed(0)} m`, PALETTE.inkSoft, 10);
    drawLabel(ctx, icx, icy + insetR + 16, "from above", PALETTE.inkSoft, 10);
  }

  sideNameplate(ctx, 12, h - 74, "Rider", "Mr. J's Skateboard", PALETTE.crimson);
  if (Play.finished && Play.endedBecause) {
    drawLabel(ctx, w / 2, 18, Play.endedBecause,
      /lap/.test(Play.endedBecause) ? PALETTE.forest : PALETTE.crimson, 12);
  }
}

/* ============================================================================
   22. Springs in series and in parallel
   ========================================================================== */

/* arrangement 1 is series, 2 is parallel — the same coding the solver chapter
   uses for arrangement_sp, so the slider value can be handed straight over. */
function comboSpringK(p, arrangement) {
  const k1 = Math.max(p.k1, 1e-9), k2 = Math.max(p.k2, 1e-9);
  return arrangement === 1 ? (k1 * k2) / (k1 + k2) : k1 + k2;
}

SCENARIOS.springsCombo = {
  label: "Springs in series & parallel",
  group: "Oscillations",
  ariaLabel: "Live simulation of two identical masses released together, one on springs in series and one on springs in parallel",
  blurb: "The same mass, the same two springs, the same release — arranged two ways, side by side. In parallel the springs share the stretch and their stiffnesses add. In series they share the FORCE and each stretches fully, which makes the pair softer than either spring alone and its period LONGER. Watch which mass falls behind.",
  defaults: { k1: 40, k2: 80, m: 1.5, x0: 0.25, arr: 2 },
  controls: [
    { key: "k1", label: "Spring 1 stiffness k₁", min: 5, max: 160, step: 1, unit: "N/m" },
    { key: "k2", label: "Spring 2 stiffness k₂", min: 5, max: 160, step: 1, unit: "N/m" },
    // The stiffest pair on the lightest mass has a 0.22 s period, which is
    // thirteen frames a cycle. Any lighter and the parallel block is a blur
    // that no longer reads as an oscillation at all.
    { key: "m", label: "Mass (the same on both)", min: 0.4, max: 8, step: 0.1, unit: "kg" },
    { key: "x0", label: "Release displacement", min: 0.02, max: 0.4, step: 0.01, unit: "m" },
    { key: "arr", label: "Hand over to the solver: 1 = series, 2 = parallel", min: 1, max: 2, step: 1, unit: "" },
  ],
  // Body 1 is the series pair, body 2 the parallel pair. Both are released
  // from the same displacement at rest, because a phase difference is only
  // evidence if there was none to begin with.
  state0: (p) => ({ x1: p.x0, v1: 0, x2: p.x0, v2: 0 }),
  derivatives(state, p) {
    return {
      x1: state.v1, v1: -(comboSpringK(p, 1) / p.m) * state.x1,
      x2: state.v2, v2: -(comboSpringK(p, 2) / p.m) * state.x2,
    };
  },
  analytic(t, p) {
    return {
      x1: p.x0 * Math.cos(Math.sqrt(comboSpringK(p, 1) / p.m) * t),
      x2: p.x0 * Math.cos(Math.sqrt(comboSpringK(p, 2) / p.m) * t),
    };
  },
  events: [],
  isStatic: (p) => !(p.x0 > 0),
  maxDuration: 30,
  readouts(p, sim) {
    const kS = comboSpringK(p, 1), kP = comboSpringK(p, 2);
    const tS = 2 * Math.PI * Math.sqrt(p.m / kS);
    const tP = 2 * Math.PI * Math.sqrt(p.m / kP);
    return [
      ["k₁ , k₂", `${p.k1.toFixed(0)} , ${p.k2.toFixed(0)} N/m`],
      ["k_eq in series", `${kS.toFixed(2)} N/m`],
      ["k_eq in parallel", `${kP.toFixed(2)} N/m`],
      ["Softer than either spring?", kS < Math.min(p.k1, p.k2) ? "yes — series always is" : "—"],
      ["Period in series", `${tS.toFixed(3)} s`],
      ["Period in parallel", `${tP.toFixed(3)} s`],
      ["T_series / T_parallel", `${(tS / tP).toFixed(3)}`],
      ["Cycles so far, series", `${(sim.t / tS).toFixed(2)}`],
      ["Cycles so far, parallel", `${(sim.t / tP).toFixed(2)}`],
      ["Cycles the parallel is ahead", `${(sim.t / tP - sim.t / tS).toFixed(2)}`],
      ["x series", `${sim.state.x1.toFixed(4)} m`],
      ["x parallel", `${sim.state.x2.toFixed(4)} m`],
    ];
  },
  // Undamped simple harmonic motion in both arrangements, which is exactly
  // what the chapter solves — nothing here departs from it at any setting.
  handoff: {
    chapter: "oscillations",
    variant: "springs_combo",
    knowns: (p) => ({
      k1_sp: p.k1, k2_sp: p.k2, mass_sp: p.m, x_sp: p.x0,
      arrangement_sp: clampNum(Math.round(p.arr), 1, 2),
    }),
  },
  draw: drawSpringsCombo,
};

SCENARIOS.springsCombo.trailPoint = (s) => {
  playTraceSample("springsCombo", [s.x1, s.x2]);
  return null;
};

function drawSpringsCombo(ctx, w, h, sim) {
  if (!playStageReady(w, h)) return;
  const p = sim.params, s = sim.state;
  const kS = comboSpringK(p, 1), kP = comboSpringK(p, 2);
  const chosen = clampNum(Math.round(p.arr), 1, 2);

  const stripH = h > 250 ? clampNum(h * 0.26, 60, 130) : 0;
  const bodyH = h - stripH;
  const panelW = w / 2;
  const amp = Math.max(p.x0, 1e-6);
  // Both panels share one metre-to-pixel scale. Two scales would let the
  // series mass appear to swing further than the parallel one when the truth
  // is that they swing exactly as far and merely differ in timing.
  const rail = Math.max(panelW * 0.30, 12);
  const mScale = rail / (amp * 1.25);

  const drawPanel = (x0, title, arrangement, x, colour) => {
    const cx = x0 + panelW * 0.52;
    const wallX = x0 + panelW * 0.10;
    const yTop = bodyH * 0.30;
    const yBot = bodyH * 0.56;
    const yMid = (yTop + yBot) / 2;
    const blockW = clampNum(panelW * 0.14, 10, 46);
    const blockH = clampNum(bodyH * 0.20, 12, 62);
    const bx = cx + x * mScale;
    const live = arrangement === chosen;

    // the wall
    ctx.save();
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(wallX, yTop - blockH * 0.5);
    ctx.lineTo(wallX, yBot + blockH * 0.5);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (let y = yTop - blockH * 0.5; y < yBot + blockH * 0.5; y += 9) {
      ctx.beginPath();
      ctx.moveTo(wallX, y);
      ctx.lineTo(wallX - 7, y + 8);
      ctx.stroke();
    }
    ctx.restore();

    const coilAmp = clampNum(blockH * 0.20, 3, 11);
    if (arrangement === 1) {
      // Series: one force runs through both springs, so each stretches in
      // inverse proportion to its own stiffness. The junction therefore sits
      // where k₂/(k₁+k₂) of the total extension has been taken up — drawing it
      // at the midpoint would show two equally stretched springs, which is the
      // very picture that makes students expect a stiffer pair.
      const share = Math.max(p.k2, 1e-9) / (Math.max(p.k1, 1e-9) + Math.max(p.k2, 1e-9));
      const jRest = cx - blockW * 0.5 - (cx - blockW * 0.5 - wallX) * 0.5;
      const jx = jRest + x * mScale * share;
      playSpring(ctx, wallX, yMid, jx, yMid, 7, coilAmp, live ? PALETTE.forest : PALETTE.rule);
      playSpring(ctx, jx, yMid, bx - blockW * 0.5, yMid, 7, coilAmp, live ? PALETTE.forest : PALETTE.rule);
      ctx.save();
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.beginPath();
      ctx.arc(jx, yMid, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      playSpring(ctx, wallX, yTop, bx - blockW * 0.5, yTop, 7, coilAmp, live ? PALETTE.forest : PALETTE.rule);
      playSpring(ctx, wallX, yBot, bx - blockW * 0.5, yBot, 7, coilAmp, live ? PALETTE.forest : PALETTE.rule);
      ctx.save();
      ctx.strokeStyle = PALETTE.inkSoft;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(bx - blockW * 0.5, yTop);
      ctx.lineTo(bx - blockW * 0.5, yBot);
      ctx.stroke();
      ctx.restore();
    }

    // equilibrium mark and the block
    drawDashedLine(ctx, cx, yTop - blockH * 0.7, cx, yBot + blockH * 0.7, PALETTE.rule, 1, [3, 5]);
    ctx.save();
    ctx.fillStyle = colour;
    ctx.globalAlpha = live ? 0.95 : 0.55;
    ctx.fillRect(bx - blockW / 2, yMid - blockH / 2, blockW, blockH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx - blockW / 2, yMid - blockH / 2, blockW, blockH);
    ctx.restore();

    if (Math.abs(x) * mScale > 3) {
      drawArrow(ctx, cx, yMid + blockH * 0.85, bx, yMid + blockH * 0.85, PALETTE.crimson, 1.6);
    }
    drawLabel(ctx, x0 + panelW / 2, 20, title, live ? PALETTE.ink : PALETTE.inkSoft, 12);
    drawLabel(ctx, x0 + panelW / 2, 36,
      arrangement === 1
        ? `k_eq = ${kS.toFixed(1)} N/m   T = ${(2 * Math.PI * Math.sqrt(p.m / kS)).toFixed(2)} s`
        : `k_eq = ${kP.toFixed(1)} N/m   T = ${(2 * Math.PI * Math.sqrt(p.m / kP)).toFixed(2)} s`,
      PALETTE.inkSoft, 10);
    if (live) drawLabel(ctx, x0 + panelW / 2, bodyH - 10, "handed to the solver", PALETTE.brass, 10);
  };

  drawPanel(0, "series — 1/k_eq = 1/k₁ + 1/k₂", 1, s.x1, PALETTE.crimson);
  drawPanel(panelW, "parallel — k_eq = k₁ + k₂", 2, s.x2, PALETTE.navy);

  ctx.save();
  ctx.strokeStyle = PALETTE.rule;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panelW, 10);
  ctx.lineTo(panelW, bodyH - 6);
  ctx.stroke();
  ctx.restore();

  // --- the two traces, on one pair of axes --------------------------------
  if (stripH <= 0) return;
  const tr = playTraceOf("springsCombo", 2);
  const xMax = Math.max(Play.t, 1) * 1.05;
  const plot = playPlotFrame(ctx, 20, bodyH + 6, w - 40, stripH - 22, 0, xMax, -amp * 1.15, amp * 1.15);
  if (!plot) return;
  drawDashedLine(ctx, plot.x, plot.Y(0), plot.x + plot.w, plot.Y(0), PALETTE.rule, 1, [3, 4]);
  playPlotLine(ctx, plot, tr.x, tr.y[0], PALETTE.crimson, 1.6);
  playPlotLine(ctx, plot, tr.x, tr.y[1], PALETTE.navy, 1.6);
  drawLabel(ctx, plot.x + 6, plot.y + 12, "series", PALETTE.crimson, 10, "left");
  drawLabel(ctx, plot.x + 54, plot.y + 12, "parallel", PALETTE.navy, 10, "left");
  drawLabel(ctx, plot.x + plot.w - 6, plot.y + 12, "x against t", PALETTE.inkSoft, 10, "right");
}

/* ============================================================================
   23. Physical pendulum
   ========================================================================== */

/* A uniform stick of mass m pivoted a distance d from its centre has
   I = m(L²/12 + d²) about that pivot, and mgd sin θ of restoring torque, so
   the mass cancels out of α entirely. That is why this scenario has no mass
   slider: there is nothing for it to change. The stick is declared as 1 kg so
   the readout can print a moment of inertia in real units. */
const PP_STICK_MASS = 1;

function ppOmega(p) {
  const L = Math.max(p.Lstick, 1e-6);
  const d = Math.max(p.d, 1e-6);
  return Math.sqrt((GRAVITY * d) / ((L * L) / 12 + d * d));
}

SCENARIOS.physicalPendulum = {
  label: "Physical pendulum",
  group: "Oscillations",
  ariaLabel: "Live simulation of a uniform stick swinging from an off-centre pivot, beside a simple pendulum of the same length as the pivot distance",
  blurb: "A uniform stick hung from a hole a distance d from its centre. Its period is 2π√(I/mgd) with I = m(L²/12 + d²) — not 2π√(d/g). The faint ghost beside it IS that wrong answer, integrated from the same release, and it walks out of step within a swing or two. There is a d that makes the period as short as it can be; find it.",
  defaults: { Lstick: 1.2, d: 0.35, th0Deg: 12 },
  controls: [
    { key: "Lstick", label: "Stick length L", min: 0.4, max: 3, step: 0.05, unit: "m" },
    { key: "d", label: "Pivot distance d from the centre", min: 0.02, max: 1.5, step: 0.01, unit: "m" },
    { key: "th0Deg", label: "Release angle", min: 3, max: 150, step: 1, unit: "°" },
  ],
  state0: (p) => {
    const th0 = (p.th0Deg * Math.PI) / 180;
    return { th: th0, w: 0, th2: th0, w2: 0 };
  },
  // The FULL equation, sin θ and all, for both bodies. The ghost is integrated
  // exactly too, so the gap that opens between them is the moment-of-inertia
  // error by itself rather than that error tangled up with the small-angle one.
  derivatives(state, p) {
    const L = Math.max(p.Lstick, 1e-6);
    const d = Math.max(p.d, 1e-6);
    return {
      th: state.w,
      w: -((GRAVITY * d) / ((L * L) / 12 + d * d)) * Math.sin(state.th),
      th2: state.w2,
      w2: -(GRAVITY / d) * Math.sin(state.th2),
    };
  },
  // The reference is the SMALL-ANGLE solution for each body, exactly as the
  // simple-pendulum scenario above uses it: the drift row then measures how far
  // the true motion has walked away from the textbook approximation, and it
  // grows with the release angle rather than with the step size.
  analytic(t, p) {
    const th0 = (p.th0Deg * Math.PI) / 180;
    const d = Math.max(p.d, 1e-6);
    return {
      th: th0 * Math.cos(ppOmega(p) * t),
      th2: th0 * Math.cos(Math.sqrt(GRAVITY / d) * t),
    };
  },
  events: [],
  isStatic: () => false,
  maxDuration: 30,
  readouts(p, sim) {
    const L = Math.max(p.Lstick, 1e-6);
    const d = Math.max(p.d, 1e-6);
    const I = PP_STICK_MASS * ((L * L) / 12 + d * d);
    const T = (2 * Math.PI) / ppOmega(p);
    const Twrong = 2 * Math.PI * Math.sqrt(d / GRAVITY);
    const dMin = L / Math.sqrt(12);
    const Tmin = 2 * Math.PI * Math.sqrt(L / (Math.sqrt(3) * GRAVITY));
    const th0 = (p.th0Deg * Math.PI) / 180;
    // First-order amplitude correction, the same series the simple pendulum
    // scenario quotes — this is a period error of the MODEL's own making and
    // sits on top of everything else.
    const Ttrue = T * (1 + (th0 ** 2) / 16 + (11 * th0 ** 4) / 3072);
    // T/T_simple = √(1 + L²/12d²), which exceeds 1 for every d there is: the
    // simple-pendulum formula is always SHORT, never long, so the row can name
    // the direction instead of printing a signed percentage.
    return [
      ["I about the pivot", `${I.toFixed(4)} kg·m²   for a ${PP_STICK_MASS.toFixed(0)} kg stick`],
      ["I = m(L²/12 + d²)", `${(PP_STICK_MASS * (L * L) / 12).toFixed(4)} + ${(PP_STICK_MASS * d * d).toFixed(4)}`],
      ["Period 2π√(I/mgd)", `${T.toFixed(3)} s`],
      ["Corrected for amplitude", `${Ttrue.toFixed(3)} s`],
      ["Small-angle error in T", `${(((Ttrue - T) / T) * 100).toFixed(2)} %`],
      ["Wrong answer 2π√(d/g)", `${Twrong.toFixed(3)} s`],
      ["2π√(d/g) falls short by", `${(((T - Twrong) / T) * 100).toFixed(1)} %`],
      ["Period-minimising pivot", `${dMin.toFixed(3)} m   = L/√12`],
      ["Shortest period possible", `${Tmin.toFixed(3)} s`],
      ["This pivot is", Math.abs(d - dMin) < 0.006
        ? "at the minimum"
        : `${Math.abs(d - dMin).toFixed(3)} m ${d > dMin ? "beyond" : "short of"} it`],
      ["Pivot sits", d <= L / 2 ? "in the stick" : "off the end, on a light arm"],
      ["Stick angle", `${((sim.state.th * 180) / Math.PI).toFixed(2)}°`],
      ["Stick and ghost differ by", `${(((sim.state.th - sim.state.th2) * 180) / Math.PI).toFixed(2)}°`],
    ];
  },
  handoff: {
    chapter: "oscillations",
    // T = 2π√(I/mgd) is a small-angle result exactly as much as 2π√(L/g) is.
    // Handing over a 150° release would ask the chapter to answer with the very
    // approximation the panel above is measuring the error of.
    available: (p) => (p.th0Deg > 15
      ? `T = 2π√(I/mgd) is the small-angle result. At ${p.th0Deg.toFixed(0)}° the true period is already noticeably longer — the corrected period is in the panel above. Reduce the release angle below 15° to hand it over.`
      : null),
    variant: "physical_pendulum",
    knowns: (p) => ({
      m_pp: PP_STICK_MASS, L_stick_pp: p.Lstick, d_pp: p.d,
      I_pp: PP_STICK_MASS * ((p.Lstick * p.Lstick) / 12 + p.d * p.d),
    }),
  },
  draw: drawPhysicalPendulum,
};

SCENARIOS.physicalPendulum.trailPoint = (s) => {
  playTraceSample("physicalPendulum", [s.th, s.th2]);
  return null;
};

function drawPhysicalPendulum(ctx, w, h, sim) {
  if (!playStageReady(w, h)) return;
  const p = sim.params, s = sim.state;
  const L = Math.max(p.Lstick, 1e-6);
  const d = Math.max(p.d, 1e-6);
  const dMin = L / Math.sqrt(12);

  const stripH = h > 280 ? clampNum(h * 0.22, 56, 112) : 0;
  const curveW = w > 560 ? clampNum(w * 0.28, 150, 300) : 0;
  const bodyW = w - curveW;
  const bodyH = h - stripH;

  // The stick reaches d + L/2 below the pivot at most, and the ghost reaches d.
  const reach = d + L / 2;
  const pivotX = bodyW * 0.5;
  const pivotY = clampNum(bodyH * 0.16, 16, bodyH * 0.4);
  const scale = Math.max((bodyH - pivotY - 26) / Math.max(reach, 1e-6), 1e-6);
  const usable = Math.min(scale, (bodyW * 0.42) / Math.max(reach, 1e-6));

  // --- the pivot ----------------------------------------------------------
  ctx.save();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(pivotX - 34, pivotY);
  ctx.lineTo(pivotX + 34, pivotY);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  for (let dx = -30; dx <= 30; dx += 9) {
    ctx.beginPath();
    ctx.moveTo(pivotX + dx, pivotY);
    ctx.lineTo(pivotX + dx - 7, pivotY - 8);
    ctx.stroke();
  }
  ctx.restore();
  drawDashedLine(ctx, pivotX, pivotY, pivotX, pivotY + reach * usable, PALETTE.rule, 1, [3, 5]);

  // --- the ghost: a simple pendulum of length d ---------------------------
  const g2 = { x: pivotX + Math.sin(s.th2) * d * usable, y: pivotY + Math.cos(s.th2) * d * usable };
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = PALETTE.brass;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(g2.x, g2.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = PALETTE.brass;
  ctx.beginPath();
  ctx.arc(g2.x, g2.y, clampNum(usable * L * 0.05, 3.5, 9), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // --- the stick ----------------------------------------------------------
  // Drawn from its real ends: the pivot is d from the centre, so the near end
  // is at d − L/2 along the axis and sticks out ABOVE the pivot whenever the
  // hole is inside the stick. Drawing it as a rod hanging from the pivot would
  // hide the very geometry that makes I = m(L²/12 + d²).
  const ax = Math.sin(s.th), ay = Math.cos(s.th);
  const at = (r) => ({ x: pivotX + ax * r * usable, y: pivotY + ay * r * usable });
  const near = at(d - L / 2);
  const far = at(d + L / 2);
  const com = at(d);

  if (d > L / 2) {
    ctx.save();
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(near.x, near.y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = PALETTE.navy;
  ctx.lineWidth = clampNum(usable * L * 0.045, 4, 13);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(near.x, near.y);
  ctx.lineTo(far.x, far.y);
  ctx.stroke();
  ctx.restore();

  // the period-minimising hole, marked on the stick itself so the reader can
  // slide the pivot onto it rather than being told the number
  [dMin, -dMin].forEach((r) => {
    if (Math.abs(r) > L / 2) return;
    const q = at(d - r);
    ctx.save();
    ctx.strokeStyle = PALETTE.forest;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(q.x, q.y, clampNum(usable * L * 0.035, 2.5, 6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  ctx.save();
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.arc(com.x, com.y, clampNum(usable * L * 0.035, 3, 7), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (bodyW > 260) drawLabel(ctx, com.x + 14, com.y, "centre of mass", PALETTE.crimson, 10, "left");

  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawLabel(ctx, bodyW / 2, bodyH - 10,
    `d = ${d.toFixed(2)} m    L/√12 = ${dMin.toFixed(3)} m`,
    Math.abs(d - dMin) < 0.006 ? PALETTE.forest : PALETTE.inkSoft, 11);
  drawLabel(ctx, 10, pivotY + 16, "stick", PALETTE.navy, 10, "left");
  drawLabel(ctx, 10, pivotY + 30, "ghost: 2π√(d/g)", PALETTE.brass, 10, "left");

  // --- T against d, with the minimum there to be found --------------------
  if (curveW > 0 && bodyH > 150) {
    const cx0 = bodyW + 14;
    const cw = curveW - 30;
    const chh = Math.min(bodyH - 70, 220);
    const dHi = Math.max(L * 1.1, p.d * 1.1, 0.1);
    const tAt = (dd) => 2 * Math.PI * Math.sqrt(((L * L) / 12 + dd * dd) / (GRAVITY * Math.max(dd, 1e-6)));
    const tLo = tAt(dMin);
    const plot = playPlotFrame(ctx, cx0, 44, cw, chh, 0, dHi, 0, tLo * 3.2);
    if (plot) {
      const xs = [], ys = [];
      for (let i = 1; i <= 160; i++) {
        const dd = (i / 160) * dHi;
        xs.push(dd);
        ys.push(tAt(dd));
      }
      playPlotLine(ctx, plot, xs, ys, PALETTE.navy, 1.6);
      drawDashedLine(ctx, plot.X(dMin), plot.y, plot.X(dMin), plot.y + plot.h, PALETTE.forest, 1.2, [4, 4]);
      plot.clip(() => {
        ctx.save();
        ctx.fillStyle = PALETTE.crimson;
        ctx.beginPath();
        ctx.arc(plot.X(d), plot.Y(tAt(d)), 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      drawLabel(ctx, cx0 + cw / 2, 32, "period against pivot distance", PALETTE.inkSoft, 10);
      drawLabel(ctx, plot.X(dMin), plot.y + plot.h + 12, "L/√12", PALETTE.forest, 10);
    }
  }

  // --- the two angles against time ----------------------------------------
  if (stripH <= 0) return;
  const tr = playTraceOf("physicalPendulum", 2);
  const amp = Math.max((p.th0Deg * Math.PI) / 180, 1e-6) * 1.15;
  const plot = playPlotFrame(ctx, 20, bodyH + 4, w - 40, stripH - 20, 0, Math.max(Play.t, 1) * 1.05, -amp, amp);
  if (!plot) return;
  drawDashedLine(ctx, plot.x, plot.Y(0), plot.x + plot.w, plot.Y(0), PALETTE.rule, 1, [3, 4]);
  playPlotLine(ctx, plot, tr.x, tr.y[0], PALETTE.navy, 1.6);
  playPlotLine(ctx, plot, tr.x, tr.y[1], PALETTE.brass, 1.4, [4, 3]);
  drawLabel(ctx, plot.x + plot.w - 6, plot.y + 12, "θ against t — the gap is the error", PALETTE.inkSoft, 10, "right");
}

/* ============================================================================
   24. Exploding shell — the centre of mass carries on
   ========================================================================== */

const COM_SHELL_MASS = 4;        // kg, the whole shell before it bursts
const COM_MAX_FRAGMENTS = 6;

function comCount(p) { return clampNum(Math.round(p.n), 2, COM_MAX_FRAGMENTS); }

function comFlightTime(p) {
  return (2 * p.v0 * Math.sin((p.angleDeg * Math.PI) / 180)) / GRAVITY;
}

function comBurstTime(p) { return p.burstAt * comFlightTime(p); }

/* Fragment 1 takes the split; the rest share what is left equally. That is the
   textbook two-piece burst when n = 2 and a spray when it is larger, with one
   slider covering both. */
function comMasses(p) {
  const n = comCount(p);
  const heavy = COM_SHELL_MASS * clampNum(p.split, 0.05, 0.95);
  const rest = (COM_SHELL_MASS - heavy) / (n - 1);
  const out = [heavy];
  for (let i = 1; i < n; i++) out.push(rest);
  return out;
}

/* The scatter, in the shell's OWN frame. Directions are spread evenly round a
   circle and then the mass-weighted mean is subtracted, which makes the total
   momentum in that frame exactly zero for any mass split. Choosing the
   velocities directly and hoping they balance is how a burst ends up nudging
   the centre of mass off its parabola by a few centimetres — small enough to
   look like integration error and large enough to destroy the point. */
function comScatter(p) {
  const n = comCount(p);
  const ms = comMasses(p);
  const th = (p.angleDeg * Math.PI) / 180;
  const U = Math.max(0.6 * p.v0 * Math.sin(th), 0.05);
  const ux = [], uy = [];
  for (let i = 0; i < n; i++) {
    // The 0.4 rad offset keeps any fragment from starting exactly horizontal,
    // where it would sit on the parabola it is supposed to be leaving.
    const phi = 0.4 + (2 * Math.PI * i) / n;
    ux.push(U * Math.cos(phi));
    uy.push(U * Math.sin(phi));
  }
  let mx = 0, my = 0, M = 0;
  for (let i = 0; i < n; i++) { mx += ms[i] * ux[i]; my += ms[i] * uy[i]; M += ms[i]; }
  mx /= M; my /= M;
  for (let i = 0; i < n; i++) { ux[i] -= mx; uy[i] -= my; }
  return { ux, uy, ms, n };
}

/* The centre of mass, computed from the fragments every time it is asked for
   and never stored. Returns null if the state bag does not carry the fragments
   the parameters describe — which happens for exactly one frame if the count
   slider moves before a reset lands. */
function comOf(s, p) {
  const ms = comMasses(p);
  let M = 0, x = 0, y = 0, px = 0, py = 0;
  for (let i = 0; i < ms.length; i++) {
    const k = i + 1;
    const xk = s["x" + k], yk = s["y" + k], vxk = s["vx" + k], vyk = s["vy" + k];
    if (!Number.isFinite(xk) || !Number.isFinite(yk) || !Number.isFinite(vxk) || !Number.isFinite(vyk)) {
      return null;
    }
    M += ms[i];
    x += ms[i] * xk;
    y += ms[i] * yk;
    px += ms[i] * vxk;
    py += ms[i] * vyk;
  }
  return { x: x / M, y: y / M, vx: px / M, vy: py / M, px, py, M };
}

SCENARIOS.comExplosion = {
  label: "Exploding shell",
  group: "Momentum",
  ariaLabel: "Live simulation of a projectile that bursts into fragments in mid-flight, with the centre of mass staying on the original parabola",
  blurb: "A shell is launched, and part-way through its flight it bursts. The pieces fly apart, but the burst is an INTERNAL force and internal forces cannot move a centre of mass — so the centre of mass carries on along the original parabola as though nothing happened. The dashed curve is that parabola; watch the marker stay on it.",
  defaults: { v0: 26, angleDeg: 55, burstAt: 0.45, n: 3, split: 0.5 },
  controls: [
    { key: "v0", label: "Launch speed", min: 8, max: 40, step: 0.5, unit: "m/s" },
    { key: "angleDeg", label: "Launch angle", min: 15, max: 85, step: 1, unit: "°" },
    { key: "burstAt", label: "Burst time, as a fraction of the flight", min: 0.1, max: 0.9, step: 0.01, unit: "" },
    { key: "n", label: "Number of fragments", min: 2, max: COM_MAX_FRAGMENTS, step: 1, unit: "" },
    { key: "split", label: "Mass of the first fragment, as a fraction", min: 0.1, max: 0.9, step: 0.05, unit: "" },
  ],
  // Body 0 is the shell that never bursts — the ghost. Bodies 1..n are the
  // fragments, and they start exactly where and how the shell does, so the
  // burst separates them from a state they genuinely shared rather than from
  // one asserted at the moment of the bang.
  state0: (p) => {
    const th = (p.angleDeg * Math.PI) / 180;
    const vx = p.v0 * Math.cos(th), vy = p.v0 * Math.sin(th);
    const s = { x0: 0, y0: 0, vx0: vx, vy0: vy, phase: 0 };
    const n = comCount(p);
    for (let i = 1; i <= n; i++) {
      s["x" + i] = 0; s["y" + i] = 0; s["vx" + i] = vx; s["vy" + i] = vy;
    }
    return s;
  },
  // Free flight for everything, before and after. The burst is an impulse
  // applied by an event, not a term in the equation of motion — which is what
  // makes it internal, and what makes the centre of mass immune to it.
  derivatives(state, p) {
    const g = GRAVITY;
    const d = { x0: state.vx0, y0: state.vy0, vx0: 0, vy0: -g, phase: 1 };
    const n = comCount(p);
    for (let i = 1; i <= n; i++) {
      d["x" + i] = state["vx" + i];
      d["y" + i] = state["vy" + i];
      d["vx" + i] = 0;
      d["vy" + i] = -g;
    }
    return d;
  },
  analytic(t, p) {
    const th = (p.angleDeg * Math.PI) / 180;
    return {
      x0: p.v0 * Math.cos(th) * t,
      y0: p.v0 * Math.sin(th) * t - 0.5 * GRAVITY * t * t,
    };
  },
  events: [
    {
      // Impulsive, so it has to land on the instant. Applied at the end of
      // whichever step straddled it, the fragments would inherit velocities
      // from up to a step's worth of the wrong position.
      detect: (s, p) => comBurstTime(p) - s.phase,
      apply(s, p) {
        const sc = comScatter(p);
        const out = { ...s };
        for (let i = 1; i <= sc.n; i++) {
          if (!Number.isFinite(out["vx" + i])) continue;
          out["vx" + i] = s["vx" + i] + sc.ux[i - 1];
          out["vy" + i] = s["vy" + i] + sc.uy[i - 1];
        }
        return out;
      },
      reason: "burst",
    },
    {
      // The centre of mass follows the parabola only while gravity is the only
      // external force. The instant the ground pushes back on a fragment that
      // stops being true, so that is where this run honestly ends.
      detect: (s, p) => {
        const n = comCount(p);
        let lo = Infinity;
        for (let i = 1; i <= n; i++) {
          const yk = s["y" + i];
          if (Number.isFinite(yk) && yk < lo) lo = yk;
        }
        return Number.isFinite(lo) ? lo : 1;
      },
      terminal: true,
      reason: "the first fragment reached the ground — past here the ground pushes back and the centre of mass leaves the parabola",
    },
  ],
  isStatic: () => false,
  maxDuration: 25,
  readouts(p, sim) {
    const s = sim.state;
    const ms = comMasses(p);
    const com = comOf(s, p);
    const tBurst = comBurstTime(p);
    const burst = s.phase >= tBurst - 1e-9;
    const rows = [
      ["Fragments", `${comCount(p)}`],
      ["Shell mass", `${COM_SHELL_MASS.toFixed(2)} kg`],
      ["Fragment masses", ms.map((m) => m.toFixed(2)).join(" , ") + " kg"],
      ["Flight time of the shell", `${comFlightTime(p).toFixed(3)} s`],
      ["Burst at", `${tBurst.toFixed(3)} s`],
      ["Status", burst ? `burst — ${comCount(p)} pieces in the air` : "intact"],
    ];
    if (!com) return rows;
    rows.push(
      ["Centre of mass", `${com.x.toFixed(3)} , ${com.y.toFixed(3)} m`],
      ["Shell had it been intact", `${s.x0.toFixed(3)} , ${s.y0.toFixed(3)} m`],
      // The parity check the whole scenario rests on, computed from the
      // fragments and compared against a projectile that never burst. It is a
      // number on the panel rather than an assertion in a comment because a
      // reader is entitled to watch it stay at zero.
      ["Centre of mass off the parabola", `${Math.hypot(com.x - s.x0, com.y - s.y0).toExponential(2)} m`],
      ["Momentum, horizontal", `${com.px.toFixed(4)} kg·m/s`],
      ["Momentum, vertical", `${com.py.toFixed(3)} kg·m/s`],
      ["Kinetic energy", `${comKinetic(s, p).toFixed(1)} J`],
    );
    return rows;
  },
  handoff: {
    chapter: "collisions",
    // Run backwards, a two-piece burst IS a sticking collision: the two
    // fragments, brought together, must give exactly the shell's velocity. That
    // is a genuine problem the chapter solves — but only with two bodies, and
    // only once they have separate velocities to combine. Handing over three
    // fragments, or a shell that has not burst yet, would ask it to solve
    // something it is not describing.
    available: (p) => {
      if (comCount(p) !== 2) {
        return `The two-dimensional collision chapter combines exactly two bodies. Set the fragment count to 2 and this hands over as the burst run backwards: the two pieces, stuck back together, must give the shell's velocity.`;
      }
      const s = Play.state;
      if (!s || !Number.isFinite(s.phase) || s.phase < comBurstTime(p)) {
        return `The shell has not burst yet, so both "fragments" still share one velocity and there is no collision to solve. Run past ${comBurstTime(p).toFixed(2)} s to hand it over.`;
      }
      return null;
    },
    variant: "collision2d_inelastic",
    // Read the LIVE fragment velocities. The pair is a valid sticking collision
    // at every instant after the burst, because combining them always returns
    // the centre-of-mass velocity at that same instant.
    knowns: (p) => {
      const s = Play.state || {};
      const ms = comMasses(p);
      const deg = (y, x) => (Math.atan2(y, x) * 180) / Math.PI;
      return {
        m1_2d: ms[0], m2_2d: ms[1],
        v1i_2d: Math.hypot(s.vx1 || 0, s.vy1 || 0), theta1i_2d: deg(s.vy1 || 0, s.vx1 || 0),
        v2i_2d: Math.hypot(s.vx2 || 0, s.vy2 || 0), theta2i_2d: deg(s.vy2 || 0, s.vx2 || 0),
      };
    },
  },
  draw: drawComExplosion,
};

function comKinetic(s, p) {
  const ms = comMasses(p);
  let ke = 0;
  for (let i = 0; i < ms.length; i++) {
    const k = i + 1;
    const vx = s["vx" + k], vy = s["vy" + k];
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return NaN;
    ke += 0.5 * ms[i] * (vx * vx + vy * vy);
  }
  return ke;
}

/* The claim this scenario exists to make, checked every frame rather than
   asserted once. The tolerance is loose enough that RK4 roundoff (which runs
   at 1e-12 m over a four-second flight) never trips it and tight enough that
   any real momentum leak at the burst — a scatter that does not sum to zero,
   a fragment given the wrong mass — shows up immediately. It complains once
   per run: a warning per frame would bury the frame that first went wrong. */
const COM_PARITY_TOLERANCE = 1e-6;
let comParityWarned = -1;

SCENARIOS.comExplosion.trailPoint = (s, p) => {
  const com = comOf(s, p);
  if (!com) return null;
  const off = Math.hypot(com.x - s.x0, com.y - s.y0);
  if (Play.t < comParityWarned) comParityWarned = -1;      // a new run
  if (!(off <= COM_PARITY_TOLERANCE) && comParityWarned < 0) {
    comParityWarned = Play.t;
    console.warn(`comExplosion: centre of mass is ${off.toExponential(2)} m off the`
      + ` analytic parabola at t = ${Play.t.toFixed(3)} s — the burst is not`
      + ` momentum-conserving.`);
  }
  return { x: com.x, y: com.y };
};

function drawComExplosion(ctx, w, h, sim) {
  if (!playStageReady(w, h)) return;
  const p = sim.params, s = sim.state;
  const th = (p.angleDeg * Math.PI) / 180;
  const flight = comFlightTime(p);
  const ms = comMasses(p);
  const n = comCount(p);
  const com = comOf(s, p);

  const range = p.v0 * Math.cos(th) * flight;
  const peak = ((p.v0 * Math.sin(th)) ** 2) / (2 * GRAVITY);

  const world = newWorld(0, 0);
  includePoint(world, range, peak, 0);
  includePoint(world, -range * 0.06, 0, 0);
  for (let i = 1; i <= n; i++) {
    const xk = s["x" + i], yk = s["y" + i];
    if (Number.isFinite(xk) && Number.isFinite(yk)) includePoint(world, xk, yk, peak * 0.08);
  }
  const view = fitView("comExplosion", w, h, world, { pad: 0.15 });
  const groundY = view.Y(0);

  drawGround(ctx, w, h, groundY);

  // --- the parabola the shell would have flown ----------------------------
  // Sampled from the closed form on purpose: it is the REFERENCE the
  // integrated centre of mass is being checked against, so it must come from
  // somewhere the simulation cannot influence.
  ctx.save();
  ctx.strokeStyle = PALETTE.brass;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * flight;
    const px = view.X(p.v0 * Math.cos(th) * t);
    const py = view.Y(p.v0 * Math.sin(th) * t - 0.5 * GRAVITY * t * t);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
  if (w > 300) {
    drawLabel(ctx, view.X(range * 0.5), view.Y(peak) - 14,
      "the shell's parabola — the burst does not touch it", PALETTE.brass, 10);
  }

  // --- the traced centre of mass ------------------------------------------
  if (Play.trail.length > 1) {
    drawTrail(ctx, Play.trail.map((q) => ({ x: view.X(q.x), y: view.Y(q.y) })), PALETTE.crimson);
  }

  // --- the burst flash -----------------------------------------------------
  const tBurst = comBurstTime(p);
  const age = s.phase - tBurst;
  if (age >= 0 && age < 0.55) {
    const f = age / 0.55;
    ctx.save();
    ctx.globalAlpha = 0.55 * (1 - f);
    ctx.strokeStyle = PALETTE.crimson;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(view.X(p.v0 * Math.cos(th) * tBurst),
      view.Y(p.v0 * Math.sin(th) * tBurst - 0.5 * GRAVITY * tBurst * tBurst),
      Math.max(6 + f * 46, 1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // --- the fragments -------------------------------------------------------
  const rBase = clampNum(Math.min(w, h) * 0.020, 3, 11);
  for (let i = 1; i <= n; i++) {
    const xk = s["x" + i], yk = s["y" + i];
    if (!Number.isFinite(xk) || !Number.isFinite(yk)) continue;
    // Radius by the cube root of the mass, so a piece that carries half the
    // shell looks like half the shell rather than half its width.
    const r = Math.max(rBase * Math.cbrt(ms[i - 1] / COM_SHELL_MASS) * 1.6, 2.2);
    sphereShade(ctx, view.X(xk), view.Y(yk), r, PALETTE.ink, PALETTE.navy);
  }

  // --- the centre of mass --------------------------------------------------
  if (com) {
    const cx = view.X(com.x), cy = view.Y(com.y);
    const arm = clampNum(Math.min(w, h) * 0.022, 5, 13);
    ctx.save();
    ctx.strokeStyle = PALETTE.crimson;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, arm * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (w > 260) {
      drawLabel(ctx, cx, cy - arm - 10, "centre of mass", PALETTE.crimson, 10);
      drawLabel(ctx, cx, cy + arm + 14,
        `off the curve by ${Math.hypot(com.x - s.x0, com.y - s.y0).toExponential(1)} m`,
        PALETTE.inkSoft, 10);
    }
  }

  drawZoomBar(ctx, w, h, view, "m");
  if (Play.finished && Play.endedBecause) {
    drawLabel(ctx, w / 2, h - 12, Play.endedBecause, PALETTE.inkSoft, 10);
  } else if (age < 0) {
    drawLabel(ctx, w / 2, 18, `intact — bursts at ${tBurst.toFixed(2)} s`, PALETTE.inkSoft, 11);
  }
}
