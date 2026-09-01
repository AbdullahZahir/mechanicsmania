/* ============================================================================
   PlayGraph — live strip chart and linearisation bench for the sandbox
   ----------------------------------------------------------------------------
   The SOLVE side draws motion graphs by replaying a closed form (see
   `buildGraphs` in animate.js). Nothing here does that. Every point on this
   chart is a sample of the integrated state, recorded as it happened, so the
   graph is a MEASUREMENT of the simulation and a slope read off it is an
   experimental result rather than a restatement of an input.

   Two AP Physics C skills drive the design:

   1. Graph interpretation — plot any recorded quantity against any other,
      with a labelled linear scale and real tick values, because that is what
      the scoring guidelines expect a student to be able to read.

   2. Experimental design and analysis — the FRQ asks for a LINEARISED plot
      and the physical meaning of its slope. `setTransform` applies one of the
      standard transforms to the X channel, and the fit reports slope,
      intercept, R² and the standard error of the slope with correct units.
      Plotting y against t² for a dropped ball must yield a slope of −g/2 in
      m/s², and the axis label and slope unit must say so.

   Commitments, each of which a naive version gets wrong:

   * The fit is two-pass and mean-centred. The textbook Σxy/Σx² shortcut
     catastrophically cancels once |x| is large: the orbit scenario records
     radii around 10⁷ m, whose squares are 10¹⁴, and the variance we actually
     want is fifteen orders of magnitude below the sum being accumulated.
     Centring first keeps every term the size of the signal.

   * Memory is bounded by DECIMATION, not by a ring buffer. A ring buffer
     bounds memory by throwing away the beginning of the run, which is
     precisely the part a parabola needs to be fittable. Halving instead keeps
     the whole time span at half the resolution, which a least-squares fit
     does not care about.

   * Samples a transform's domain excludes are dropped and COUNTED, never
     coerced. ln of a negative is not a data point, and a fit that silently
     absorbed one would be a fabricated result reported to four figures.

   * Autoscale is sticky. Recomputing the range from min/max every frame makes
     a live chart shimmer and unreadable; the range only moves when the data
     leaves it or shrinks to under half of it, and it always lands on tick
     boundaries so growth happens in visible steps.
   ========================================================================== */

/* --- how many samples are kept ------------------------------------------- */
// Per channel, as a Float64Array. The orbit scenario runs 40000 simulated
// seconds; at sixty records a second that is far more samples than a 700px
// wide chart can resolve, and far more than a fit needs.
const PLAYGRAPH_CAPACITY = 4096;

/* ============================================================================
   small numeric + text helpers
   ========================================================================== */

const PG_SUP = { "-": "⁻", "+": "", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const PG_SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉" };

function pgSuper(n) {
  return String(n).split("").map((c) => (c in PG_SUP ? PG_SUP[c] : c)).join("");
}
function pgSub(digits) {
  return String(digits).split("").map((c) => (c in PG_SUB ? PG_SUB[c] : c)).join("");
}

const PG_SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
function pgUnsuper(s) {
  return Number(s.split("").map((c) => PG_SUP_DIGITS.indexOf(c)).join(""));
}

// "4.905e+7" reads as noise on an axis; "4.905×10⁷" reads as a number.
function pgExpNotation(v, sig) {
  const s = v.toExponential(sig);
  const [mant, exp] = s.split("e");
  return `${mant}×10${pgSuper(Number(exp))}`;
}

// Legend and readout numbers. Fixed notation while the magnitude is human,
// scientific beyond it — the same rule the rest of the app's readouts follow.
function pgFmt(v, sig = 5) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6 || a < 1e-4) return pgExpNotation(v, Math.max(2, sig - 2));
  const digits = Math.max(0, Math.min(8, sig - 1 - Math.floor(Math.log10(a))));
  return Number(v.toFixed(digits)).toString();
}

// Tick steps land on 1, 2 or 5 times a power of ten. Splitting the raw range
// evenly instead produces ticks at 3.7143, which no reader can interpolate
// between and no student can read a value off.
function pgNiceStep(span, target) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

// toFixed on a residual of −1e−17 yields "-0.0", which reads as a negative
// value sitting between two positive ticks.
function pgFixed(v, decimals) {
  const s = v.toFixed(decimals);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

function pgDecimalsFor(step) {
  if (!Number.isFinite(step) || step <= 0) return 2;
  return Math.max(0, Math.min(8, Math.ceil(-Math.log10(step))));
}

/* --- units ---------------------------------------------------------------- */

// A unit raised to a power. Compound units get parenthesised so "(m/s)²" can
// never be misread as "m/s²", which is a different quantity entirely.
function pgUnitPow(unit, n) {
  if (!unit) return "";
  if (n === 1) return unit;
  const atomic = !/[\/·\s]/.test(unit);
  return (atomic ? unit : `(${unit})`) + pgSuper(n);
}

function pgUnitSqrt(unit) {
  if (!unit) return "";
  const atomic = !/[\/·\s]/.test(unit);
  return "√" + (atomic ? unit : `(${unit})`);
}

// The unit of a slope, dy/dx. Worth the special cases: the whole point of the
// linearisation exercise is that y (m) against t² (s²) has a slope in m/s²,
// and that v (m/s) against t (s) has one in m/s² as well — printing "m/s/s"
// there would hide the very identification the student is being asked to make.
function pgUnitRatio(uy, ux) {
  if (!ux) return uy;
  // Dividing by an inverse unit is multiplying by it. r (m) plotted against
  // 1/t (s⁻¹) has a slope in m·s; "m/s⁻¹" is the same quantity written so that
  // nobody can read it, and the 1/x transform makes that the common case.
  const inv = /^(.+?)⁻([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(ux);
  if (inv) {
    const flipped = pgUnitPow(inv[1], pgUnsuper(inv[2]));
    const num = uy.split("/");
    if (num.length === 2 && num[1] === flipped) return num[0];
    return uy ? `${uy}·${flipped}` : flipped;
  }
  if (!uy) return pgUnitPow(ux, -1);
  if (uy === ux) return "";
  const parts = uy.split("/");
  if (parts.length === 2 && parts[1] === ux) return `${parts[0]}/${pgUnitPow(ux, 2)}`;
  const denom = /[\/·\s]/.test(ux) ? `(${ux})` : ux;
  return `${uy}/${denom}`;
}

/* ============================================================================
   linearisation transforms
   ----------------------------------------------------------------------------
   Each carries its own DOMAIN. `ok` is the guard that keeps a sample out of
   the fit rather than letting Infinity or NaN through, and it is also what
   lets the chart say honestly how many points it refused.
   ========================================================================== */

const PLAYGRAPH_TRANSFORMS = {
  none: {
    apply: (x) => x,
    ok: () => true,
    label: (l) => l,
    unit: (u) => u,
    domain: "",
  },
  "x²": {
    apply: (x) => x * x,
    ok: () => true,
    label: (l) => `${l}²`,
    unit: (u) => pgUnitPow(u, 2),
    domain: "",
  },
  "√x": {
    apply: Math.sqrt,
    ok: (x) => x >= 0,
    label: (l) => `√${l}`,
    unit: (u) => pgUnitSqrt(u),
    domain: "√x needs x ≥ 0",
  },
  "1/x": {
    apply: (x) => 1 / x,
    ok: (x) => x !== 0,
    label: (l) => `1/${l}`,
    unit: (u) => pgUnitPow(u, -1),
    domain: "1/x needs x ≠ 0",
  },
  "ln x": {
    apply: Math.log,
    // The logarithm of a dimensioned quantity is only defined once it is
    // divided by its unit, which is why the label below reads ln(t/s).
    ok: (x) => x > 0,
    label: (l, u) => (u ? `ln(${l}/${u})` : `ln ${l}`),
    unit: () => "",
    domain: "ln x needs x > 0",
  },
  "1/x²": {
    apply: (x) => 1 / (x * x),
    ok: (x) => x !== 0,
    label: (l) => `1/${l}²`,
    unit: (u) => pgUnitPow(u, -2),
    domain: "1/x² needs x ≠ 0",
  },
};

const PLAYGRAPH_TRANSFORM_NAMES = Object.keys(PLAYGRAPH_TRANSFORMS);

/* ============================================================================
   channel derivation
   ----------------------------------------------------------------------------
   Channels come from the scenario itself: every key of its state bag, plus
   quantities that follow from those keys and the parameters WITHOUT guessing.
   The guards below exist because "where determinable" is a real constraint —
   see the mass and height notes.
   ========================================================================== */

// State keys follow one naming convention across the whole scenario registry:
// a base name and an optional body index. Anything unrecognised is carried
// through as a dimensionless number rather than given a unit it may not have.
function pgStateKeyMeta(key) {
  const m = /^([a-zA-Z_]+?)(\d*)$/.exec(key);
  const base = m ? m[1] : key;
  const idx = m ? m[2] : "";
  const s = pgSub(idx);
  switch (base) {
    case "x": case "y": case "s": case "r": case "d":
      return { label: base + s, unit: "m" };
    case "v":
      return { label: "v" + s, unit: "m/s" };
    case "vx":
      return { label: "v" + s + "ₓ", unit: "m/s" };
    case "vy":
      return { label: "v" + s + "ᵧ", unit: "m/s" };
    case "th": case "theta": case "angle":
      return { label: "θ" + s, unit: "rad" };
    case "w": case "omega":
      return { label: "ω" + s, unit: "rad/s" };
    case "fuel":
      return { label: "fuel", unit: "kg" };
    default:
      return { label: key, unit: "" };
  }
}

// Bodies are recovered from the state key names: x1/y1/vx1/vy1 is one body,
// th0/w0 another. Every scenario in the registry follows this, which is what
// makes speed, radius and energy derivable without a per-scenario table.
function pgBodyGroups(keys) {
  const groups = new Map();
  const at = (idx) => {
    if (!groups.has(idx)) groups.set(idx, { idx });
    return groups.get(idx);
  };
  for (const k of keys) {
    let m;
    // vx/vy are tested before v and before x/y: the anchored alternatives
    // would otherwise never see them.
    if ((m = /^vx(\d*)$/.exec(k))) at(m[1]).vx = k;
    else if ((m = /^vy(\d*)$/.exec(k))) at(m[1]).vy = k;
    else if ((m = /^v(\d*)$/.exec(k))) at(m[1]).v = k;
    else if ((m = /^x(\d*)$/.exec(k))) at(m[1]).x = k;
    else if ((m = /^y(\d*)$/.exec(k))) at(m[1]).y = k;
    else if ((m = /^s(\d*)$/.exec(k))) at(m[1]).s = k;
    else if ((m = /^(?:th|theta)(\d*)$/.exec(k))) at(m[1]).th = k;
    else if ((m = /^(?:w|omega)(\d*)$/.exec(k))) at(m[1]).w = k;
  }
  return [...groups.values()];
}

// The mass of a body moving in a straight line. `M` is accepted here but NOT
// for rotating bodies: the flywheel's M is a distributed disk, so ½Mv² would
// be off by a factor of two and look plausible while doing it.
function pgLinearMass(idx, p, groupCount) {
  const own = p["m" + idx];
  if (Number.isFinite(own) && own > 0) return own;
  if (Number.isFinite(p.m) && p.m > 0) return p.m;
  if (Number.isFinite(p.M) && p.M > 0) return p.M;
  // One body in the state bag but several named masses means a rigid
  // constraint tying them to a single speed — the Atwood string. The whole
  // system's kinetic energy is then ½(Σm)v².
  if (groupCount === 1 && Number.isFinite(p.m1) && Number.isFinite(p.m2)) return p.m1 + p.m2;
  return null;
}

// A bob swinging on a rod is a point mass; a driven disk is not. Requiring a
// lowercase `m` is the difference: pendulum and coaster declare one, the
// flywheel declares only `M`, and the cradle declares neither.
function pgBobMass(idx, p) {
  const own = p["m" + idx];
  if (Number.isFinite(own) && own > 0) return own;
  if (Number.isFinite(p.m) && p.m > 0) return p.m;
  return null;
}

function pgArmLength(p) {
  if (Number.isFinite(p.L) && p.L > 0) return p.L;
  if (Number.isFinite(p.R) && p.R > 0) return p.R;
  return null;
}

// Height measured UPWARD, per scenario, because there is no generic answer.
// springVertical's y runs DOWN from the natural length and atwood's y is a
// displacement of two bodies at once, so a blanket m·g·y would report a
// gravitational potential of the wrong sign for one and a meaningless one for
// the other. Only scenarios whose coordinate really is an elevation appear.
const PLAYGRAPH_HEIGHT_OF = {
  projectile: (s) => s.y,
  rocket: (s) => s.y,
  springVertical: (s) => -s.y,
  // This scenario's y is distance FALLEN, not height, so the drop height has
  // to be subtracted or the potential-energy channel would climb as the body
  // descends. Without the entry the channel is withheld entirely, which is
  // correct but leaves the one graph the apparatus is actually about missing.
  terminalVelocity: (s, p) => p.h - s.y,
};

// A readout value is only a channel if it is genuinely a number followed by a
// unit. "7000 / 8000 km" parses as 7000 under a lazier rule and would plot the
// perigee while claiming to be the perigee-and-apogee row, so any remainder
// containing a digit disqualifies the row.
function pgParseReadout(text) {
  if (typeof text !== "string") return null;
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(\S.*)?$/.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const rest = (m[2] || "").trim();
  if (rest.length > 12 || /\d/.test(rest)) return null;
  return { value, unit: rest };
}

// A stable key for a readout row, derived from its label. Used ONLY to name
// panel channels — never to decide whether two channels are the same thing.
// Deduplicating by label was a bug: it strips the subscripts and Greek letters
// that carry the distinction, so vₓ and vᵧ both reduced to "v", θ and ω both
// reduced to "", and every scenario quietly lost half its state bag.
function pgPanelSlug(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pgBuildChannels(type, sc, params) {
  const channels = [];
  const taken = new Set();
  // Keyed uniqueness only. A panel readout that duplicates a computed quantity
  // is kept on purpose: the orbit panel reports speed in km/s to four figures
  // while the computed channel is exact and in m/s, and which of those a
  // student should plot is their decision, not this module's.
  const add = (c) => {
    if (taken.has(c.key)) return;
    taken.add(c.key);
    channels.push(c);
  };

  add({ key: "t", label: "t", unit: "s", get: (t) => t });

  let state0 = {};
  try {
    state0 = sc.state0(params) || {};
  } catch (err) {
    state0 = {};
  }
  const keys = Object.keys(state0);
  for (const k of keys) {
    const meta = pgStateKeyMeta(k);
    add({ key: k, label: meta.label, unit: meta.unit, get: (t, s) => s[k] });
  }

  const groups = pgBodyGroups(keys);
  const heightOf = PLAYGRAPH_HEIGHT_OF[type] || null;
  const mu = Number.isFinite(params.Mcentral) ? () => GRAV_CONSTANT * params.Mcentral : null;

  for (const grp of groups) {
    const sub = pgSub(grp.idx);
    const planar = grp.vx && grp.vy;
    const kx = grp.vx, ky = grp.vy, kv = grp.v, kth = grp.th, kw = grp.w;
    const L = pgArmLength(params);

    // --- speed, and radius from the origin ---------------------------------
    let speedKey = null;
    if (planar) {
      speedKey = "speed" + grp.idx;
      add({ key: speedKey, label: "|v|" + sub, unit: "m/s", get: (t, s) => Math.hypot(s[kx], s[ky]) });
      if (grp.x && grp.y) {
        const px = grp.x, py = grp.y;
        add({ key: "radius" + grp.idx, label: "r" + sub, unit: "m", get: (t, s) => Math.hypot(s[px], s[py]) });
      }
    } else if (kv) {
      speedKey = "speed" + grp.idx;
      add({ key: speedKey, label: "|v|" + sub, unit: "m/s", get: (t, s) => Math.abs(s[kv]) });
    } else if (kth && kw && L) {
      // A rod of known length turns an angular rate into the bob's real speed.
      speedKey = "speed" + grp.idx;
      add({ key: speedKey, label: "|v|" + sub, unit: "m/s", get: (t, s) => Math.abs(L * s[kw]) });
    }

    // Degrees are what the release control is set in and what the panel reads
    // back, so the graph should be able to speak the same units.
    if (kth) {
      add({ key: kth + "_deg", label: "θ" + sub + " (deg)", unit: "°", get: (t, s) => (s[kth] * 180) / Math.PI });
    }

    // --- kinetic energy ----------------------------------------------------
    let keKey = null;
    if (planar || kv) {
      let mass = pgLinearMass(grp.idx, params, groups.length);
      // A rocket's mass is its dry mass plus whatever propellant is left, and
      // the tank level is right there in the state bag.
      const dry = params.m0;
      const hasFuel = keys.includes("fuel");
      if (mass === null && Number.isFinite(dry) && hasFuel) mass = -1;
      if (mass !== null) {
        const massOf = mass === -1 ? (s) => dry + Math.max(s.fuel, 0) : () => mass;
        keKey = "ke" + grp.idx;
        const v2 = planar ? (s) => s[kx] * s[kx] + s[ky] * s[ky] : (s) => s[kv] * s[kv];
        add({ key: keKey, label: "KE" + sub, unit: "J", get: (t, s) => 0.5 * massOf(s) * v2(s) });
      }
    } else if (kth && kw && L) {
      const m = pgBobMass(grp.idx, params);
      if (m !== null) {
        keKey = "ke" + grp.idx;
        add({ key: keKey, label: "KE" + sub, unit: "J", get: (t, s) => 0.5 * m * (L * s[kw]) * (L * s[kw]) });
      }
    }

    // --- potential energies ------------------------------------------------
    const potentials = [];
    if (kth && L) {
      const m = pgBobMass(grp.idx, params);
      if (m !== null) {
        // θ is measured from the low point in every rotational scenario here,
        // so L(1 − cos θ) is the rise above it.
        const get = (t, s) => m * GRAVITY * L * (1 - Math.cos(s[kth]));
        add({ key: "ug" + grp.idx, label: "U" + sub + " (grav)", unit: "J", get });
        potentials.push(get);
      }
    } else if (heightOf) {
      const m = pgLinearMass(grp.idx, params, groups.length);
      const dry = params.m0;
      const hasFuel = keys.includes("fuel");
      const massOf = m !== null ? () => m
        : (Number.isFinite(dry) && hasFuel ? (s) => dry + Math.max(s.fuel, 0) : null);
      if (massOf) {
        // params, because a scenario whose state stores distance FALLEN needs the
        // drop height to turn it back into a height.
        const get = (t, s) => massOf(s) * GRAVITY * heightOf(s, params);
        add({ key: "ug" + grp.idx, label: "U" + sub + " (grav)", unit: "J", get });
        potentials.push(get);
      }
    }
    // A spring constant plus a single coordinate measured from the natural
    // length — which is what both spring scenarios store — gives ½kx² exactly.
    const posKey = planar ? null : (grp.x || grp.y || grp.s);
    if (Number.isFinite(params.k) && params.k > 0 && posKey && !kth) {
      const k = params.k;
      const get = (t, s) => 0.5 * k * s[posKey] * s[posKey];
      add({ key: "us" + grp.idx, label: "U" + sub + " (spring)", unit: "J", get });
      potentials.push(get);
    }

    // Total mechanical energy is only worth showing when every potential the
    // scenario's forces derive from is accounted for. Half of them summed
    // with the kinetic term is not an energy, it is a drifting line that
    // invites the wrong conclusion about the integrator.
    if (keKey && potentials.length) {
      const keChan = channels.find((c) => c.key === keKey);
      const pots = potentials.slice();
      add({
        key: "emech" + grp.idx,
        label: "E" + sub + " (total)",
        unit: "J",
        get: (t, s, p) => {
          let sum = keChan.get(t, s, p);
          for (const f of pots) sum += f(t, s, p);
          return sum;
        },
      });
    }

    // --- orbital invariants ------------------------------------------------
    // Both are per unit satellite mass, so they need no mass at all — which is
    // the only reason they are available here, since the orbit scenarios never
    // declare one. Flat lines on these two are direct evidence that the
    // integrator is conserving energy and Kepler's second law.
    if (mu && planar && grp.x && grp.y) {
      const px = grp.x, py = grp.y;
      add({
        key: "eps" + grp.idx,
        label: "ε" + sub + " (spec. energy)",
        unit: "J/kg",
        get: (t, s) => {
          const r = Math.hypot(s[px], s[py]) || 1;
          return (s[kx] * s[kx] + s[ky] * s[ky]) / 2 - mu() / r;
        },
      });
      add({
        key: "hspec" + grp.idx,
        label: "h" + sub + " (spec. ang. mom.)",
        unit: "m²/s",
        get: (t, s) => s[px] * s[ky] - s[py] * s[kx],
      });
    }
  }

  // --- whatever the instrument panel already publishes as a number ---------
  // Matched by LABEL, not by row index: the orbit panel swaps four rows in and
  // out the moment a trajectory becomes unbound, so a positional index would
  // start recording the eccentricity into the altitude column mid-flight.
  const readoutChannels = [];
  if (typeof sc.readouts === "function") {
    let rows = [];
    try {
      rows = sc.readouts(params, { state: state0, params, t: 0, running: false, finished: false, started: false, trail: [], maxDrift: 0 }) || [];
    } catch (err) {
      rows = [];
    }
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const parsed = pgParseReadout(row[1]);
      if (!parsed) continue;
      const label = String(row[0]);
      const key = "panel:" + pgPanelSlug(label);
      const before = channels.length;
      add({ key, label, unit: parsed.unit, panel: label, get: () => NaN });
      if (channels.length > before) readoutChannels.push(channels[channels.length - 1]);
    }
  }

  return { channels, readoutChannels };
}

/* ============================================================================
   the store
   ========================================================================== */

const PlayGraph = (function () {
  let scenarioType = null;
  let scenarioRef = null;
  let channels = [];
  let channelByKey = new Map();
  let panelChannels = [];       // channels sourced from readouts(), by label
  let panelIndex = new Map();   // label -> column
  let columns = [];             // Float64Array per channel, parallel to `channels`
  let count = 0;
  let decim = 1;                // record calls per stored sample
  let sinceStored = 0;
  let version = 0;              // bumped on reset; invalidates the fit cache

  let xKey = "t";
  let yKey = null;
  let transformName = "none";
  let fitVisibility = "auto";

  let fitCache = { stamp: "", value: null };
  let rangeX = null;
  let rangeY = null;

  // Reused across frames so `record` allocates nothing. The scenario readouts
  // take a Play-shaped object; giving them a fresh literal sixty times a
  // second is avoidable garbage in the hot path.
  const readoutScratch = { state: null, params: null, t: 0, running: true, finished: false, started: true, trail: [], maxDrift: 0 };

  // Scratch for the fit and the polyline, sized once at reset.
  let bufX = new Float64Array(PLAYGRAPH_CAPACITY);
  let bufY = new Float64Array(PLAYGRAPH_CAPACITY);

  function columnOf(key) {
    const i = channels.findIndex((c) => c.key === key);
    return i < 0 ? null : columns[i];
  }

  /* --- lifecycle --------------------------------------------------------- */

  function reset(type, sc) {
    const scenarioObj = sc || (typeof SCENARIOS !== "undefined" ? SCENARIOS[type] : null);
    if (!scenarioObj) {
      channels = [];
      columns = [];
      count = 0;
      return;
    }
    const params = (typeof Play !== "undefined" && Play.type === type && Play.params)
      ? Play.params
      : { ...(scenarioObj.defaults || {}) };

    const built = pgBuildChannels(type, scenarioObj, params);
    const prevX = xKey, prevY = yKey;

    scenarioType = type;
    scenarioRef = scenarioObj;
    channels = built.channels;
    panelChannels = built.readoutChannels;
    channelByKey = new Map(channels.map((c) => [c.key, c]));
    panelIndex = new Map();
    for (const c of panelChannels) panelIndex.set(c.panel, channels.indexOf(c));

    // Dragging a slider calls playReset — and so this — on every input event.
    // Allocating a megabyte of Float64Array per event is a garbage-collection
    // stall for nothing: the existing buffers are already the right size and
    // count = 0 makes their contents unreachable.
    columns = columns.length === channels.length
      ? columns
      : channels.map(() => new Float64Array(PLAYGRAPH_CAPACITY));
    count = 0;
    decim = 1;
    sinceStored = 0;
    version++;
    fitCache = { stamp: "", value: null };
    rangeX = null;
    rangeY = null;

    // Pressing Reset to re-run the same apparatus should not silently throw
    // away the axes the student chose. They only fall back when the new
    // scenario has no such channel.
    xKey = channelByKey.has(prevX) ? prevX : "t";
    yKey = channelByKey.has(prevY) ? prevY : defaultYKey();
  }

  function defaultYKey() {
    for (const want of ["y", "th", "x", "s", "r"]) {
      if (channelByKey.has(want)) return want;
    }
    const first = channels.find((c) => c.key !== "t");
    return first ? first.key : "t";
  }

  /* --- recording --------------------------------------------------------- */

  // Bounded memory WITHOUT losing the start of the run: when the buffers fill,
  // keep every second sample and halve the sampling rate from then on. The
  // time span is preserved at half resolution, which is invisible to a fit and
  // invisible on a chart narrower than 2048 pixels. A ring buffer would have
  // dropped the first half of the flight instead — exactly the half a parabola
  // needs to be a parabola.
  function compact() {
    for (const col of columns) {
      for (let i = 0, j = 0; j < count; i++, j += 2) col[i] = col[j];
    }
    count = Math.ceil(count / 2);
    decim *= 2;
  }

  function record(t, state, params, sc) {
    if (!channels.length || !state) return;
    if (!Number.isFinite(t)) return;

    if (sinceStored++ % decim !== 0) return;
    if (count >= PLAYGRAPH_CAPACITY) compact();

    // The panel channels all come from one readouts() call, not one per
    // channel. Wrapped because it is foreign code evaluated on a state it may
    // not expect, and a throw here would kill the integration loop.
    if (panelChannels.length) {
      readoutScratch.state = state;
      readoutScratch.params = params;
      readoutScratch.t = t;
      const scen = sc || scenarioRef;
      let rows = null;
      try {
        rows = scen && typeof scen.readouts === "function" ? scen.readouts(params, readoutScratch) : null;
      } catch (err) {
        rows = null;
      }
      for (const c of panelChannels) c._pending = NaN;
      if (rows) {
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          const col = panelIndex.get(String(row[0]));
          if (col === undefined) continue;
          const parsed = pgParseReadout(row[1]);
          channels[col]._pending = parsed ? parsed.value : NaN;
        }
      }
    }

    const n = count;
    for (let i = 0; i < channels.length; i++) {
      const c = channels[i];
      let v;
      if (c.panel) {
        v = c._pending;
      } else {
        v = c.get(t, state, params);
      }
      columns[i][n] = typeof v === "number" ? v : NaN;
    }
    count = n + 1;
    fitCache.stamp = "";
  }

  /* --- axes and transform ------------------------------------------------- */

  function channelList() {
    return channels.map((c) => ({ key: c.key, label: c.label, unit: c.unit }));
  }

  function setAxes(nextX, nextY) {
    let changed = false;
    if (nextX !== undefined && nextX !== null && channelByKey.has(nextX) && nextX !== xKey) {
      xKey = nextX;
      changed = true;
    }
    if (nextY !== undefined && nextY !== null && channelByKey.has(nextY) && nextY !== yKey) {
      yKey = nextY;
      changed = true;
    }
    // The sticky range belongs to a pair of channels. Carrying it across a
    // change of axes would leave the chart framed on the previous quantity's
    // magnitudes until the hysteresis happened to trip.
    if (changed) invalidate();
    return changed;
  }

  function setTransform(name) {
    if (!(name in PLAYGRAPH_TRANSFORMS) || name === transformName) return false;
    transformName = name;
    invalidate();
    return true;
  }

  // "auto" draws the regression whenever the student has asked for a
  // linearisation, and on an untransformed plot only when the data really is
  // straight. Drawing a best-fit line across a parabola states a linear
  // relationship the data contradicts, and a reader who sees a line through
  // points believes the line.
  const FIT_LINEAR_R2 = 0.99;

  function setFitVisible(mode) {
    if (!["auto", "always", "never"].includes(mode) || mode === fitVisibility) return false;
    fitVisibility = mode;
    return true;
  }

  function fitIsShown(f) {
    if (f.slope === null || fitVisibility === "never") return false;
    if (fitVisibility === "always") return true;
    if (transformName !== "none") return true;
    return f.r2 !== null && f.r2 >= FIT_LINEAR_R2;
  }

  function invalidate() {
    rangeX = null;
    rangeY = null;
    fitCache = { stamp: "", value: null };
  }

  /* --- the transformed series -------------------------------------------- */

  // Fills bufX/bufY with the pairs that survive both finiteness and the
  // transform's domain, and reports how many did not. Everything downstream —
  // the fit, the autoscale, the polyline — reads this one result, so there is
  // exactly one definition of which samples count.
  function gather() {
    const colX = columnOf(xKey);
    const colY = columnOf(yKey);
    const tf = PLAYGRAPH_TRANSFORMS[transformName];
    if (!colX || !colY) return { n: 0, excluded: 0, tf };
    let n = 0, excluded = 0;
    for (let i = 0; i < count; i++) {
      const rawX = colX[i];
      const yv = colY[i];
      if (!Number.isFinite(rawX) || !Number.isFinite(yv)) { excluded++; continue; }
      if (!tf.ok(rawX)) { excluded++; continue; }
      const xv = tf.apply(rawX);
      // 1/x at 10⁻³²⁰ passes the x ≠ 0 guard and still overflows.
      if (!Number.isFinite(xv)) { excluded++; continue; }
      bufX[n] = xv;
      bufY[n] = yv;
      n++;
    }
    return { n, excluded, tf };
  }

  /* --- ordinary least squares -------------------------------------------- */

  // Two passes, mean-centred. The one-pass Σxy − ΣxΣy/n form is algebraically
  // identical and numerically hopeless here: with x around 10⁷ the two terms
  // agree to fifteen digits before subtracting, so the variance that survives
  // is rounding error. Centring first means every term accumulated is already
  // the size of the deviation being measured.
  function fit() {
    const stamp = `${version}|${xKey}|${yKey}|${transformName}|${count}`;
    if (fitCache.stamp === stamp) return fitCache.value;

    const { n, excluded, tf } = gather();
    const out = { slope: null, intercept: null, r2: null, n, excluded, reason: null };

    if (n < 2) {
      out.reason = n === 0 ? "no samples yet" : "a line needs at least 2 points";
      fitCache = { stamp, value: out };
      return out;
    }

    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += bufX[i]; my += bufY[i]; }
    mx /= n; my /= n;

    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = bufX[i] - mx;
      const dy = bufY[i] - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }

    // "All the same X" is not an exact test in floating point: after centring,
    // a spread below the last bit of the mean is indistinguishable from none,
    // and dividing by it manufactures a slope of 10¹⁶ from pure rounding.
    const scaleX = Math.max(Math.abs(mx), Math.sqrt(sxx / n));
    if (!(sxx > 0) || Math.sqrt(sxx / n) <= 1e-12 * Math.max(scaleX, Number.MIN_VALUE)) {
      out.reason = "x is constant — no slope is defined";
      fitCache = { stamp, value: out };
      return out;
    }

    out.slope = sxy / sxx;
    out.intercept = my - out.slope * mx;

    // R² on two points is 1 by construction and says nothing about the data.
    if (n >= 3 && syy > 0) {
      const r2 = (sxy * sxy) / (sxx * syy);
      out.r2 = Math.min(1, Math.max(0, r2));
      // Standard error of the slope: the quantity the experimental-analysis
      // FRQ asks for when it asks how well the slope is known.
      const sse = Math.max(0, syy - (sxy * sxy) / sxx);
      const s2 = sse / (n - 2);
      out.stderrSlope = Math.sqrt(s2 / sxx);
      out.stderrIntercept = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
    } else if (n >= 3 && syy === 0) {
      // A horizontal line does fit perfectly, but R² = 1 − SSE/SST is 0/0 when
      // the total sum of squares is zero. Reporting 1 there would be inventing
      // a goodness-of-fit for data that has no variation to explain.
      out.r2 = null;
      out.reason = "y is constant, so R² is 0/0";
    } else {
      out.reason = "needs at least 3 points";
    }

    fitCache = { stamp, value: out };
    return out;
  }

  /* --- labels ------------------------------------------------------------- */

  function axisTitleX() {
    const c = channelByKey.get(xKey);
    if (!c) return "x";
    const tf = PLAYGRAPH_TRANSFORMS[transformName];
    const label = tf.label(c.label, c.unit);
    const unit = tf.unit(c.unit);
    return unit ? `${label} (${unit})` : label;
  }

  function axisTitleY() {
    const c = channelByKey.get(yKey);
    if (!c) return "y";
    return c.unit ? `${c.label} (${c.unit})` : c.label;
  }

  function slopeUnit() {
    const cx = channelByKey.get(xKey);
    const cy = channelByKey.get(yKey);
    if (!cx || !cy) return "";
    return pgUnitRatio(cy.unit, PLAYGRAPH_TRANSFORMS[transformName].unit(cx.unit));
  }

  /* --- sticky autoscale ---------------------------------------------------- */

  // Grow when the data leaves the frame, shrink only when it has fallen below
  // half of it, and always land on tick boundaries. Re-deriving the range from
  // min/max every frame instead makes every gridline creep continuously, which
  // is unreadable while a run is in progress and makes it impossible to watch
  // a value approach a line.
  function stickyRange(current, lo, hi, targetTicks) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return current || { lo: 0, hi: 1, step: 0.5 };
    }
    // A conserved quantity varies only by the integrator's own rounding —
    // specific angular momentum holds to one part in 10¹⁴ here. Framing the
    // axis on that turns floating-point noise into a graph with a trend in it.
    // Widen to a window the noise cannot fill, so the line reads flat, which
    // is the true conclusion.
    const centre = (lo + hi) / 2;
    if (hi - lo <= Math.abs(centre) * 1e-11) {
      const eps = Math.abs(centre) * 5e-6 || 0.5;
      lo = centre - eps;
      hi = centre + eps;
    }
    const pad = (hi - lo) * 0.06;
    const wantLo = lo - pad, wantHi = hi + pad;
    const step = pgNiceStep(wantHi - wantLo, targetTicks);
    const snapped = {
      lo: Math.floor(wantLo / step) * step,
      hi: Math.ceil(wantHi / step) * step,
      step,
    };
    // Padding must not invent a sign the data does not have. A clock that ran
    // from 0 to 40000 s was being framed on an axis starting at −10000 s,
    // which reads as though the simulation had a history before it began.
    if (lo >= 0 && snapped.lo < 0) snapped.lo = 0;
    if (hi <= 0 && snapped.hi > 0) snapped.hi = 0;
    if (!current) return snapped;
    const inside = lo >= current.lo && hi <= current.hi;
    const shrunk = (hi - lo) < (current.hi - current.lo) * 0.5;
    if (inside && !shrunk) return current;
    return snapped;
  }

  /* --- drawing ------------------------------------------------------------ */

  function pal(name, fallback) {
    return (typeof PALETTE !== "undefined" && PALETTE[name]) || fallback;
  }
  function font() {
    return typeof FONT_LABEL !== "undefined" ? FONT_LABEL : '"IBM Plex Mono", Consolas, monospace';
  }
  function text(ctx, x, y, str, color, size, align = "left", baseline = "middle", weight = 400) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font()}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(str, x, y);
  }

  function ticksFor(range) {
    const out = [];
    // A float-accumulated loop drifts and produces 0.30000000000000004 as a
    // tick label; multiplying an integer index does not.
    const first = Math.round(range.lo / range.step);
    const last = Math.round(range.hi / range.step);
    for (let k = first; k <= last && out.length < 40; k++) out.push(k * range.step);
    return out;
  }

  // Radii of 10⁷ metres would need eight characters per tick and a left margin
  // wider than the plot, and a quantity that sits at 6.6026×10¹⁰ while varying
  // in the fourth decimal produces six ticks that all read "6.60255509" — an
  // axis carrying no information at all. Both are the same problem: the part
  // of the number that is shared by every tick belongs in the axis title, not
  // repeated on each label. Published figures factor out a decade and, when
  // the values are far from zero compared with their spread, an offset too.
  function axisNumbering(range) {
    const span = range.hi - range.lo;
    const maxAbs = Math.max(Math.abs(range.lo), Math.abs(range.hi));
    let offset = 0;
    if (span > 0 && maxAbs / span > 1e4) {
      const p = Math.pow(10, Math.floor(Math.log10(span)));
      const q = ((range.lo + range.hi) / 2) / p;
      // Beyond 2⁵³ the rounding below stops being exact, and an offset that is
      // not exactly what the label claims is worse than no offset.
      if (Math.abs(q) < 1e15) offset = Math.round(q) * p;
    }
    const resid = Math.max(Math.abs(range.lo - offset), Math.abs(range.hi - offset));
    let exp = 0;
    if (resid > 0) {
      const d = Math.floor(Math.log10(resid));
      if (d >= 5 || d <= -4) exp = d;
    }
    return { offset, exp, div: Math.pow(10, exp) };
  }

  // "  ×10⁷  + 6.60255509×10¹⁰" — everything the reader must add back.
  function axisSuffix(num) {
    let s = num.exp ? `  ×10${pgSuper(num.exp)}` : "";
    if (num.offset) s += `  ${num.offset > 0 ? "+" : "−"} ${pgFmt(Math.abs(num.offset), 10)}`;
    return s;
  }

  function draw(ctx, w, h) {
    if (!ctx || !(w > 0) || !(h > 0)) return;
    const ink = pal("ink", "#e8e6e1");
    const soft = pal("inkSoft", "#a4a8ad");
    const rule = pal("rule", "#3d4751");
    const paper = pal("paper", "#10151a");
    const seriesColor = pal("navy", "#5b9dd9");
    const fitColor = pal("crimson", "#d2504a");
    const cursorColor = pal("brass", "#c9a227");

    ctx.save();
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);

    if (w < 160 || h < 120) {
      text(ctx, w / 2, h / 2, "too small", soft, 10, "center");
      ctx.restore();
      return;
    }

    if (!channels.length) {
      text(ctx, w / 2, h / 2, "No scenario loaded", soft, 11, "center");
      ctx.restore();
      return;
    }

    const { n, excluded, tf } = gather();
    const titleX = axisTitleX();
    const titleY = axisTitleY();

    // --- ranges ------------------------------------------------------------
    let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (bufX[i] < loX) loX = bufX[i];
      if (bufX[i] > hiX) hiX = bufX[i];
      if (bufY[i] < loY) loY = bufY[i];
      if (bufY[i] > hiY) hiY = bufY[i];
    }
    const targetX = Math.max(3, Math.round(w / 110));
    const targetY = Math.max(3, Math.round(h / 60));
    rangeX = n ? stickyRange(rangeX, loX, hiX, targetX) : (rangeX || { lo: 0, hi: 1, step: 0.5 });
    rangeY = n ? stickyRange(rangeY, loY, hiY, targetY) : (rangeY || { lo: 0, hi: 1, step: 0.5 });

    const numX = axisNumbering(rangeX);
    const numY = axisNumbering(rangeY);
    const decX = pgDecimalsFor(rangeX.step / numX.div);
    const decY = pgDecimalsFor(rangeY.step / numY.div);
    const labelX = (v) => pgFixed((v - numX.offset) / numX.div, decX);
    const labelY = (v) => pgFixed((v - numY.offset) / numY.div, decY);

    const xTicks = ticksFor(rangeX);
    const yTicks = ticksFor(rangeY);

    // Measure the widest Y label rather than guessing a margin: an unmeasured
    // constant either wastes a quarter of the plot or clips "−12.5".
    ctx.font = `400 10px ${font()}`;
    let widest = 0;
    for (const v of yTicks) widest = Math.max(widest, ctx.measureText(labelY(v)).width);

    const padL = Math.min(w * 0.4, widest + 26);
    const padR = 12;
    const padT = 14;
    const padB = 42;
    const left = padL, right = w - padR, top = padT, bottom = h - padB;
    if (right - left < 40 || bottom - top < 40) {
      text(ctx, w / 2, h / 2, "too small", soft, 10, "center");
      ctx.restore();
      return;
    }

    const spanX = rangeX.hi - rangeX.lo || 1;
    const spanY = rangeY.hi - rangeY.lo || 1;
    const X = (v) => left + ((v - rangeX.lo) / spanX) * (right - left);
    const Y = (v) => bottom - ((v - rangeY.lo) / spanY) * (bottom - top);

    // --- grid --------------------------------------------------------------
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const v of xTicks) { const px = Math.round(X(v)) + 0.5; ctx.moveTo(px, top); ctx.lineTo(px, bottom); }
    for (const v of yTicks) { const py = Math.round(Y(v)) + 0.5; ctx.moveTo(left, py); ctx.lineTo(right, py); }
    ctx.stroke();
    ctx.restore();

    // --- zero lines --------------------------------------------------------
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = rule;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (rangeY.lo < 0 && rangeY.hi > 0) { ctx.moveTo(left, Y(0)); ctx.lineTo(right, Y(0)); }
    if (rangeX.lo < 0 && rangeX.hi > 0) { ctx.moveTo(X(0), top); ctx.lineTo(X(0), bottom); }
    ctx.stroke();
    ctx.restore();

    // --- axes --------------------------------------------------------------
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const v of xTicks) { const px = Math.round(X(v)) + 0.5; ctx.moveTo(px, bottom); ctx.lineTo(px, bottom + 4); }
    for (const v of yTicks) { const py = Math.round(Y(v)) + 0.5; ctx.moveTo(left - 4, py); ctx.lineTo(left, py); }
    ctx.stroke();

    for (const v of xTicks) text(ctx, X(v), bottom + 13, labelX(v), soft, 10, "center");
    for (const v of yTicks) text(ctx, left - 7, Y(v), labelY(v), soft, 10, "right");

    text(ctx, (left + right) / 2, bottom + 30, titleX + axisSuffix(numX), ink, 11.5, "center");
    ctx.save();
    ctx.translate(11, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    text(ctx, 0, 0, titleY + axisSuffix(numY), ink, 11.5, "center");
    ctx.restore();

    // --- series ------------------------------------------------------------
    if (n === 0) {
      text(ctx, (left + right) / 2, (top + bottom) / 2, "No samples yet — press Run", soft, 11, "center");
      if (excluded > 0) {
        text(ctx, (left + right) / 2, (top + bottom) / 2 + 16, `${excluded} sample${excluded === 1 ? "" : "s"} outside ${tf.domain || "the domain"}`, soft, 10, "center");
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();

    ctx.strokeStyle = seriesColor;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = X(bufX[i]), py = Y(bufY[i]);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // The live end of the trace. On a strip chart this is where "now" is, and
    // without it a closed orbit plotted as y against x is a static loop with
    // no indication of where the satellite actually is.
    ctx.fillStyle = cursorColor;
    ctx.beginPath();
    ctx.arc(X(bufX[n - 1]), Y(bufY[n - 1]), 3, 0, Math.PI * 2);
    ctx.fill();

    // --- the fit -----------------------------------------------------------
    const f = fit();
    const showFit = fitIsShown(f);
    if (showFit) {
      ctx.strokeStyle = fitColor;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(X(rangeX.lo), Y(f.intercept + f.slope * rangeX.lo));
      ctx.lineTo(X(rangeX.hi), Y(f.intercept + f.slope * rangeX.hi));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // --- legend ------------------------------------------------------------
    const lines = [];
    if (showFit) {
      const su = slopeUnit();
      lines.push([`slope = ${pgFmt(f.slope)}${su ? " " + su : ""}`, fitColor]);
      if (Number.isFinite(f.stderrSlope)) {
        lines.push([`  ± ${pgFmt(f.stderrSlope, 2)}${su ? " " + su : ""} (SE)`, soft]);
      }
      const cy = channelByKey.get(yKey);
      lines.push([`intercept = ${pgFmt(f.intercept)}${cy && cy.unit ? " " + cy.unit : ""}`, soft]);
      lines.push([f.r2 === null ? `R² — ${f.reason || "unavailable"}` : `R² = ${f.r2.toFixed(6)}`, soft]);
      lines.push([`n = ${n}${excluded ? `, ${excluded} excluded` : ""}`, soft]);
    } else if (transformName === "none") {
      // No transform and no straight line: say what was recorded, and say so
      // if the trace is a decimated view rather than every frame.
      lines.push([`n = ${n}${decim > 1 ? ` of ${decim * n} frames` : ""}`, soft]);
      if (excluded) lines.push([`${excluded} excluded`, soft]);
    } else {
      lines.push([`no fit — ${f.reason || "unavailable"}`, soft]);
      if (excluded) lines.push([`${excluded} excluded: ${tf.domain || "outside the domain"}`, soft]);
    }

    if (lines.length) {
      ctx.font = `400 10.5px ${font()}`;
      let boxW = 0;
      for (const [str] of lines) boxW = Math.max(boxW, ctx.measureText(str).width);
      boxW += 14;
      const boxH = lines.length * 14 + 10;
      // Put the card wherever the trace is not. The last sample is the live
      // end, so the corner farthest from it is the one least likely to matter.
      const lastHigh = Y(bufY[n - 1]) < (top + bottom) / 2;
      const bx = right - boxW - 6;
      const by = lastHigh ? bottom - boxH - 6 : top + 6;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = paper;
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
      lines.forEach(([str, color], i) => text(ctx, bx + 7, by + 12 + i * 14, str, color, 10.5, "left"));
    }

    ctx.restore();
  }

  /* --- export -------------------------------------------------------------- */

  function csvCell(str) {
    const s = String(str);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCSV() {
    if (!channels.length) return "";
    const head = channels.map((c) => csvCell(c.unit ? `${c.label} (${c.unit})` : c.label)).join(",");
    const rows = new Array(count);
    for (let i = 0; i < count; i++) {
      const cells = new Array(channels.length);
      for (let j = 0; j < channels.length; j++) {
        const v = columns[j][i];
        // String(v) is the shortest decimal that round-trips exactly, so the
        // exported file loses nothing a re-import would need. toFixed would.
        cells[j] = Number.isFinite(v) ? String(v) : "";
      }
      rows[i] = cells.join(",");
    }
    // CRLF is what RFC 4180 specifies and what a spreadsheet import expects.
    return head + "\r\n" + rows.join("\r\n") + (count ? "\r\n" : "");
  }

  /* --- read-only snapshot -------------------------------------------------- */

  // The transformed pairs the chart and the fit are actually working from.
  // Copies, because bufX/bufY are reused every frame.
  function series() {
    const { n, excluded } = gather();
    return { x: Array.prototype.slice.call(bufX, 0, n), y: Array.prototype.slice.call(bufY, 0, n), n, excluded };
  }

  function raw(key) {
    const col = columnOf(key);
    return col ? Array.prototype.slice.call(col, 0, count) : null;
  }

  return {
    reset,
    record,
    channels: channelList,
    setAxes,
    setTransform,
    draw,
    fit,
    exportCSV,

    // --- accessors the host UI needs to render its controls ----------------
    setFitVisible,
    transforms: () => PLAYGRAPH_TRANSFORM_NAMES.slice(),
    axes: () => ({ x: xKey, y: yKey, transform: transformName, fitVisible: fitVisibility }),
    axisTitleX,
    axisTitleY,
    slopeUnit,
    sampleCount: () => count,
    decimation: () => decim,
    capacity: () => PLAYGRAPH_CAPACITY,
    scenarioType: () => scenarioType,
    series,
    raw,
  };
})();
