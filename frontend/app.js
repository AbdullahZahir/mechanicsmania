/* ============================================================================
   MechanicsMania — application shell
   ----------------------------------------------------------------------------
   A linear wizard over a set of physics chapters:

     home → chapters → [variants] → [briefing] → [setup prompts]
          → quantity → value entry → results

   Bracketed steps are skipped when a chapter doesn't define them. Every screen
   transition goes through `showScreen`, and every backward step is a closure
   pushed onto `history`, so Back can rewind through generator-driven setup
   questions as well as ordinary screens.
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  config: null,
  history: [],
  chapter: null,
  flow: null,
  variant: null,
  solverKey: null,
  varsKey: null,
  variables: [],
  known: {},

  setupFn: null,
  setupGen: null,
  setupStep: null,
  setupAnswers: [],
  knownAtSetupStart: {},

  target: null,
  pending: [],
  pendingIndex: 0,
  rawValues: {},
  forces: [""],
  worklog: [],
  viewMode: "scene",
  lastResult: null,
  symbolicFirst: false,
};

/* Which viewport tabs make sense for a given chapter. A free-body diagram is
   only meaningful where forces act, and motion graphs only where something is
   a function of time. */
const FREE_BODY_CONTEXTS = new Set([
  "projectile", "forces", "atwood", "atwood_flywheel", "rolling_race", "loop_coaster",
  "ballistic_pendulum", "osc_spring", "osc_general", "osc_pendulum", "rotDynamics",
  "energy", "work_grav", "work_kinetic", "work_elastic", "work_general",
  "collisions_elastic", "collisions_inelastic", "momentum", "gravitation",
  "orbital",
  // The five variants that moved into Classic Problem Types. buildFreeBody has
  // had cases for them all along; only this gate was missed.
  "ramp", "blockstack", "elevator", "roundabout", "com",
]);
const GRAPH_CONTEXTS = new Set([
  "kinematics", "projectile", "calc_kinematics", "rotKinematics", "calc_rotational",
  "osc_spring", "osc_general", "calc_oscillations",
]);

/* ============================================================================
   theme
   ========================================================================== */

const THEME_KEY = "mechanicsmania:theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toPaper = theme === "slate";
  const iconHref = toPaper ? "#i-sun" : "#i-moon";
  const label = toPaper ? "Switch to the paper theme" : "Switch to the slate theme";
  ["btn-theme", "btn-theme-home"].forEach((id) => {
    const btn = $(id);
    if (!btn) return;
    btn.setAttribute("aria-label", label);
    const use = btn.querySelector("use");
    if (use) use.setAttribute("href", iconHref);
  });
  // Canvas colours are sampled from CSS custom properties, so a theme change
  // has to re-seed the palette and repaint anything currently on screen.
  if (typeof refreshPalette === "function") refreshPalette();
}

function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  applyTheme(stored === "paper" ? "paper" : "slate");
  const toggle = () => {
    const next = document.documentElement.dataset.theme === "slate" ? "paper" : "slate";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  };
  $("btn-theme").addEventListener("click", toggle);
  $("btn-theme-home").addEventListener("click", toggle);
}

/* ============================================================================
   navigation
   ========================================================================== */

const CHROMELESS = new Set([
  "screen-home", "screen-chapters", "screen-reference", "screen-minigames",
  "screen-founder", "screen-pick",
  "screen-inertia", "screen-inertia-detail", "screen-play",
]);

// Screens that move focus into a field of their own once they are shown.
const FOCUSES_OWN_FIELD = new Set(["screen-prompt", "screen-value", "screen-minigames"]);

function showScreen(id) {
  $$(".screen").forEach((el) => el.classList.remove("is-active"));
  $(id).classList.add("is-active");
  $("masthead").hidden = CHROMELESS.has(id);

  if (id === "screen-home") startHomeFigures();
  else stopHomeFigures();
  if (id !== "screen-results") stopAnimation();
  // Leaving the sandbox by ANY route — including the masthead buttons, which
  // do not go through the sandbox's own exit handler — has to stop its loop,
  // or the rAF callback and its ResizeObserver keep painting a hidden canvas.
  if (id !== "screen-play") stopPlayLoop();
  if (id !== "screen-minigames") stopMiniLoop();
  if (id !== "screen-results" && derivationObserver) {
    derivationObserver.disconnect();
    derivationObserver = null;
  }

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  // Move focus to the new screen. Without this, keyboard and screen-reader
  // users stay parked on the control they just left, and every step means
  // tabbing back down from the top of the document. The two question screens
  // put focus in their own field instead, so leave those alone -- listing them
  // beats sniffing for an <input>, which also matched the results screen's
  // symbolic-mode checkbox and left that screen unfocused.
  const screen = $(id);
  if (screen && !FOCUSES_OWN_FIELD.has(id)) {
    const heading = screen.querySelector("h1");
    const target = heading || screen;
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
}

function setProgress(fraction) {
  const pct = Math.round(clamp(fraction, 0, 1) * 100);
  $("progress-bar").style.width = pct + "%";
  $("progress").setAttribute("aria-valuenow", String(pct));
}

function pushHistory(fn, tag) { fn.historyTag = tag; state.history.push(fn); }

function goBack() {
  const step = state.history.pop();
  if (step) step();
  else goChapters();
}

function goChapters() {
  // Any solve still in flight is now answering a question that is no longer on
  // screen. Bumping the token retires it, or its reply drags the reader back
  // to a results screen built from state this function has just cleared.
  solveToken += 1;
  state.history = [];
  state.chapter = null;
  state.flow = null;
  state.variant = null;
  state.known = {};
  showScreen("screen-chapters");
}

function goHome() {
  solveToken += 1;
  state.history = [];
  state.chapter = null;
  state.flow = null;
  state.variant = null;
  state.known = {};
  state.worklog = [];
  renderWorklog();
  showScreen("screen-home");
}

/* ============================================================================
   units
   ========================================================================== */

// Variable display names carry their unit in a trailing parenthetical, e.g.
// "Initial Velocity (m/s)". Splitting it out lets the answer show a number and
// a unit as separate typographic elements — and units are themselves worth
// marks on the exam, so they should never be dropped.
function splitUnit(fullName) {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(fullName || "");
  if (!match) return { name: fullName || "", unit: "" };
  const unit = match[2].trim();
  // Reject parentheticals that are clarifications rather than units.
  if (/\s/.test(unit) && !/[/·^]/.test(unit)) return { name: fullName, unit: "" };
  return { name: match[1].trim(), unit };
}

function unitFor(key) {
  return splitUnit(state.config.variableNames[key] || "").unit;
}

// A slider showing one decimal for a 0.005 step has fifty positions that all
// read the same. Take the precision from the step itself.
/* The displayed form of a value, widened until it actually represents it.
   A substitution line is working the reader is invited to check, so a figure
   inside it has to be the figure the answer used. */
function preciseEnough(value) {
  const shown = formatNumber(value);
  const back = Number(shown);
  if (!Number.isFinite(back)) return shown;
  const scale = Math.max(Math.abs(value), 1e-12);
  // The tolerance has to be tight, not merely reasonable. A figure accurate to
  // one part in ten thousand is still 0.5% wrong once "1 - e" gets hold of it,
  // and eccentricity near 1 is exactly where the interesting orbits live.
  const ok = (text) => Math.abs(Number(text) - value) / scale < 1e-9;
  if (ok(shown)) return shown;
  for (const digits of [4, 6, 8, 10, 12]) {
    const wider = String(Number(value.toPrecision(digits)));
    if (ok(wider)) return wider;
  }
  return String(value);
}

function decimalsFor(step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.max(0, Math.min(4, -Math.floor(Math.log10(s))));
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return n.toExponential(3);
  // Below 1 the useful digits are SIGNIFICANT FIGURES, not decimal places.
  // Rounding 0.000123 to three decimals gives 0, which reads as a broken
  // calculator rather than a small answer.
  return String(Number(abs < 1 ? n.toPrecision(3) : n.toFixed(3)));
}

/* ============================================================================
   boot
   ========================================================================== */

async function init() {
  // Without a guard here, any failure rejects init() before a single control
  // is wired. The markup still LOOKS right — the home screen is active in the
  // HTML — so the page appears fine while every button is dead and nothing
  // says why.
  let config;
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error(`Configuration request failed (${res.status})`);
    config = await res.json();
    if (!config || !Array.isArray(config.chapters)) throw new Error("Configuration was malformed");
  } catch (err) {
    showStartupFailure(err);
    return;
  }

  state.config = config;
  setGravity(state.config.gravity);
  setGravConstant(state.config.gravConstant);

  initTheme();
  renderChapters();
  renderReference();
  wireHome();
  wireBriefing();
  wirePrompt();
  wireValue();
  wireTally();
  wireResults();
  wirePlayground();
  wireGraphControls();
  wireMinigames();
  wireFounder();
  wireInertia();
  wireMasthead();

  showScreen("screen-home");
}

function showStartupFailure(err) {
  const host = document.getElementById("screen-home");
  if (!host) return;
  host.innerHTML = "";
  const box = document.createElement("div");
  box.className = "stack stack--narrow";
  box.innerHTML = `
    <div class="alert">
      <span class="alert__title">MechanicsMania could not start</span>
      <span></span>
    </div>`;
  box.querySelector(".alert span:last-child").textContent =
    `${err.message}. The page needs the local server running on port 8000 — start it, then reload.`;
  host.appendChild(box);
  host.classList.add("is-active");
}

/* ============================================================================
   home
   ========================================================================== */

function wireHome() {
  $("btn-begin").addEventListener("click", goChapters);
  // Remember where the reference was opened from so its exit returns there,
  // rather than always dumping the reader on the chapter index.
  $("btn-reference").addEventListener("click", () => {
    state.referenceReturn = goHome;
    $("btn-reference-back").textContent = "Back to the start";
    showScreen("screen-reference");
  });
  $("btn-reference-back").addEventListener("click", () => {
    const back = state.referenceReturn || goChapters;
    state.referenceReturn = null;
    back();
  });
}

let homeFiguresRunning = false;
function startHomeFigures() {
  if (homeFiguresRunning) return;
  homeFiguresRunning = true;
  startRocketAnim($("rocket-canvas"), $("rocket-readout"));
  startCradleAnim($("cradle-canvas"), $("cradle-readout"));
}
function stopHomeFigures() {
  if (!homeFiguresRunning) return;
  homeFiguresRunning = false;
  stopRocketAnim();
  stopCradleAnim();
}

/* ============================================================================
   chapters
   ========================================================================== */

function renderChapters() {
  const grid = $("chapter-index");
  grid.innerHTML = "";
  state.config.chapters.forEach((chapter) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "chapter";
    card.innerHTML = `
      <span class="chapter__head">
        <span class="chapter__num">${String(chapter.num).padStart(2, "0")}</span>
        <span class="chapter__name"></span>
      </span>
      <ul class="chapter__topics"></ul>`;
    card.querySelector(".chapter__name").textContent = chapter.name;
    const list = card.querySelector(".chapter__topics");
    chapter.concepts.forEach((concept) => {
      const li = document.createElement("li");
      li.textContent = concept;
      list.appendChild(li);
    });
    card.addEventListener("click", () => selectChapter(chapter));
    grid.appendChild(card);
  });
}

function selectChapter(chapter) {
  pushHistory(goChapters);
  state.chapter = chapter;
  state.variant = null;
  state.known = {};

  if (chapter.id === "cheatsheet") {
    state.referenceReturn = goChapters;
    $("btn-reference-back").textContent = "Back to chapters";
    showScreen("screen-reference");
    return;
  }

  if (chapter.id === "inertia") {
    openInertia();
    return;
  }

  state.flow = CHAPTER_FLOW[chapter.id];
  if (state.flow.subtypes) {
    renderVariants();
    showScreen("screen-variants");
    setProgress(0.08);
  } else {
    startBriefing();
  }
}

/* ============================================================================
   variants
   ========================================================================== */

/* Chapters with a handful of variants get a list; Classic Problem Types now
   holds ten distinct apparatus, which is a library rather than a choice. It
   gets the same card grid the chapter index uses, so picking a problem type
   feels like picking a chapter -- which is what it has become. */
const GRID_VARIANTS = new Set(["classicProblems"]);

function renderVariants() {
  $("variant-eyebrow").textContent = `Chapter ${state.chapter.num}`;
  $("variant-title").textContent = state.chapter.name;
  const list = $("variant-list");
  list.innerHTML = "";

  const asGrid = GRID_VARIANTS.has(state.chapter.id) || state.flow.subtypes.length > 6;
  list.className = asGrid ? "chapters" : "options";
  $("variant-sub").textContent = asGrid
    ? "Each of these is a complete setup with its own questions. Pick the one your problem describes."
    : "Pick the case that matches your problem.";

  state.flow.subtypes.forEach((variant) => {
    const item = document.createElement("button");
    item.type = "button";

    if (asGrid) {
      // Mirror the chapter card exactly: number, name, and the concepts it
      // covers -- no blurb, no pill boxes.
      item.className = "chapter";
      item.innerHTML = `
        <span class="chapter__head">
          <span class="chapter__num"></span>
          <span class="chapter__name"></span>
        </span>
        <ul class="chapter__topics"></ul>`;
      item.querySelector(".chapter__num").textContent =
        String(state.flow.subtypes.indexOf(variant) + 1).padStart(2, "0");
      item.querySelector(".chapter__name").textContent = variant.label;
      const topics = item.querySelector(".chapter__topics");
      (state.config.chapterVariables[variant.key] || []).slice(0, 6).forEach((key) => {
        const li = document.createElement("li");
        li.textContent = splitUnit(state.config.variableNames[key] || key).name;
        topics.appendChild(li);
      });
    } else {
      item.className = "option";
      item.innerHTML = `
        <span class="option__mark"><svg aria-hidden="true"><use href="#${variant.icon}"/></svg></span>
        <span><h3></h3><p></p></span>`;
      item.querySelector("h3").textContent = variant.label;
      item.querySelector("p").textContent = variant.desc;
    }

    item.addEventListener("click", () => selectVariant(variant));
    list.appendChild(item);
  });
}

function selectVariant(variant) {
  pushHistory(() => { renderVariants(); showScreen("screen-variants"); });
  state.variant = variant;
  startBriefing();
}

/* ============================================================================
   briefing
   ========================================================================== */

function wireBriefing() {
  $("btn-briefing-next").addEventListener("click", () => {
    pushHistory(() => showScreen("screen-briefing"), "briefing");
    startSetup();
  });
}

function startBriefing() {
  // Several chapters are a menu of quite different scenarios, and the notes
  // for those are written per VARIANT. Keyed on the chapter id alone they were
  // unreachable, and the chapter's own aside -- about rolling races -- was
  // shown beside a roundabout. Take both from whichever level has the tip, so
  // a note and its aside always belong to the same apparatus.
  const key = state.variant && state.config.tips[state.variant.key]
    ? state.variant.key
    : state.chapter.id;
  const tip = state.config.tips[key];
  if (!tip) { startSetup(); return; }
  $("briefing-eyebrow").textContent = contextLabel();
  $("briefing-text").textContent = tip;
  const aside = state.config.marginalia[key];
  $("briefing-aside").textContent = aside || "";
  $("briefing-aside").classList.toggle("hidden", !aside);
  showScreen("screen-briefing");
  setProgress(0.16);
}

function contextLabel() {
  // Reachable with no chapter when a late solver reply lands after the reader
  // has navigated home.
  if (!state.chapter) return "";
  return state.variant ? `${state.chapter.name} · ${state.variant.label}` : state.chapter.name;
}

/* ============================================================================
   setup prompts (generator driven)
   ========================================================================== */

function wirePrompt() {
  $$("#prompt-choices [data-answer]").forEach((btn) => {
    btn.addEventListener("click", () => advanceSetup(btn.dataset.answer === "yes"));
  });
  $("prompt-submit").addEventListener("click", () => {
    const raw = $("prompt-input").value;
    if (raw.trim() === "") {
      showFieldError("prompt-error", "This one is needed to set the problem up — please enter a value.");
      $("prompt-input").focus();
      return;
    }
    const value = parseFloat(raw);
    const problem = state.setupStep && state.setupStep.validate
      ? state.setupStep.validate(value)
      : (Number.isFinite(value) ? null : "Enter a real number.");
    if (problem) { showFieldError("prompt-error", problem); $("prompt-input").focus(); return; }
    showFieldError("prompt-error", null);
    advanceSetup(value);
  });
  $("prompt-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("prompt-submit").click(); }
  });
  $("prompt-info-next").addEventListener("click", () => advanceSetup(null));
  $("btn-prompt-skip").addEventListener("click", goQuantity);
}

function startSetup() {
  state.solverKey = state.variant ? state.variant.solverKey || state.flow.solverKey : state.flow.solverKey;
  state.varsKey = state.variant ? state.variant.key : state.flow.varsKey;
  state.variables = state.config.chapterVariables[state.varsKey] || [];

  const setupFn = state.variant ? state.variant.scenario : state.flow.scenario;
  state.setupFn = setupFn;
  if (!setupFn) { goQuantity(); return; }

  state.knownAtSetupStart = { ...state.known };
  state.setupAnswers = [];
  state.setupGen = setupFn(state.known);

  const first = state.setupGen.next();
  if (first.done) { goQuantity(); return; }
  state.setupStep = first.value;
  renderSetupStep();
  showScreen("screen-prompt");
  focusSetupStep();
  setProgress(0.24);
}

function renderSetupStep() {
  const step = state.setupStep;
  $("prompt-question").textContent = step.type === "info" ? "Noted" : step.text;
  $("prompt-choices").classList.toggle("hidden", step.type !== "yesno");
  $("prompt-field").classList.toggle("hidden", step.type !== "number");
  $("prompt-info").classList.toggle("hidden", step.type !== "info");

  if (step.type === "info") $("prompt-info-text").textContent = step.text;
  if (step.type === "number") {
    $("prompt-input").value = "";
    showFieldError("prompt-error", null);
  }
}

// Focus belongs on whatever the reader is being asked to operate, and it can
// only be set once the screen is actually visible -- focusing a node inside a
// display:none parent is a no-op, which is why every setup question used to
// leave focus on <body>.
function focusSetupStep() {
  const step = state.setupStep;
  if (!step) return;
  if (step.type === "number") { $("prompt-input").focus(); return; }
  const first = step.type === "yesno"
    ? $("prompt-choices").querySelector("[data-answer]")
    : $("prompt-info-next");
  if (first) first.focus();
}

function advanceSetup(answer) {
  pushHistory(stepBackThroughSetup);
  state.setupAnswers.push(answer);

  const next = state.setupGen.next(answer);
  if (next.done) { goQuantity(); return; }
  state.setupStep = next.value;
  renderSetupStep();
  focusSetupStep();
  setProgress(clamp(0.24 + state.setupAnswers.length * 0.04, 0.24, 0.46));
}

// Generators can't rewind, so Back replays the generator from scratch with one
// fewer recorded answer. `known` is reset to its pre-setup snapshot first so
// replaying cannot double-apply any of the generator's side effects.
// Returns true when a setup question was shown. Returning false instead of
// calling goQuantity() is what keeps Back working: goQuantity pushes its own
// history entry, so a rebuild that ran to completion used to re-enter it and
// push another, pinning the user on the quantity screen for ever.
function rebuildSetup() {
  state.known = { ...state.knownAtSetupStart };
  state.setupGen = state.setupFn(state.known);

  let step = state.setupGen.next();
  for (const answer of state.setupAnswers) {
    if (step.done) break;
    step = state.setupGen.next(answer);
  }
  if (step.done) return false;

  state.setupStep = step.value;
  renderSetupStep();
  showScreen("screen-prompt");
  focusSetupStep();
  return true;
}

// Step one answer backwards through the setup questions. Falls through to the
// variant or chapter screen once there is nothing left to undo.
function stepBackThroughSetup() {
  if (state.setupFn && state.setupAnswers.length > 0) {
    state.setupAnswers.pop();
    if (rebuildSetup()) return;
  }
  // The briefing was pushed on the way in. Jumping straight to the variants
  // from here left that entry stranded on the stack, so the NEXT Back ran
  // FORWARD into the briefing. Walk back through it instead.
  const top = state.history[state.history.length - 1];
  if (top && top.historyTag === "briefing") { goBack(); return; }
  if (state.variant) { renderVariants(); showScreen("screen-variants"); return; }
  goChapters();
}

/* ============================================================================
   quantity picker
   ========================================================================== */

function goQuantity() {
  pushHistory(stepBackThroughSetup);
  renderQuantities();
  showScreen("screen-quantity");
  setProgress(0.5);
}

function renderQuantities() {
  $("quantity-eyebrow").textContent = contextLabel();
  const grid = $("quantity-grid");
  grid.innerHTML = "";
  state.variables.forEach((key) => {
    const { name, unit } = splitUnit(state.config.variableNames[key] || key);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quantity";
    btn.innerHTML = `<span class="quantity__sym"></span><span class="quantity__name"></span>`;
    btn.querySelector(".quantity__sym").textContent = unit ? `${key}  ·  ${unit}` : key;
    btn.querySelector(".quantity__name").textContent = name;
    btn.addEventListener("click", () => selectTarget(key));
    grid.appendChild(btn);
  });
}

function selectTarget(key) {
  pushHistory(() => { renderQuantities(); showScreen("screen-quantity"); });
  state.target = key;

  const already = Object.prototype.hasOwnProperty.call(state.known, key) ? state.known[key] : undefined;
  if (already !== undefined && already !== null) {
    presentResult({
      ok: true,
      solveFor: key,
      variableName: state.config.variableNames[key] || key,
      solution: already,
      equation: "Established while setting the problem up",
      originalEquation: "Established while setting the problem up",
    });
    return;
  }

  if (key === "Fnet" && state.solverKey === "forces") {
    state.forces = [""];
    renderTally();
    showScreen("screen-tally");
    setProgress(0.66);
    return;
  }

  state.pending = state.variables.filter(
    (v) => v !== key && !Object.prototype.hasOwnProperty.call(state.known, v)
  );
  state.pendingIndex = 0;
  state.rawValues = {};
  nextValue();
}

/* ============================================================================
   value entry
   ========================================================================== */

function wireValue() {
  $("value-submit").addEventListener("click", submitValue);
  $("value-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitValue(); }
  });
}

/* Quantities that cannot physically be zero or negative. Accepting a mass of
   -5 kg produced a weight of -49 N and propagated silently into the answer. */
const STRICTLY_POSITIVE = new Set([
  // masses
  "mass", "mass_dyn", "mass_osc", "mass_loop", "m1", "m2", "m1_bp", "m2_bp",
  "m1_g", "m2_g", "M_central", "m_sat",
  // stiffnesses, inertias, radii and lengths
  "k", "k_osc", "I", "I_pulley", "r", "r_dyn", "r_pulley", "L_pend",
  "R_loop", "R_body", "r_g", "r_orb", "a_semi", "r_peri", "r_apo",
  // amplitudes, periods and frequencies
  "A", "A_calc", "T_osc", "T_pend", "f_osc", "f_pend", "v0_p",
  "T_orbit", "T_kepler",
  // elapsed times: a duration running backwards inverts the sign of the
  // answer while looking like perfectly ordinary working
  "t", "t_p", "t_calc", "t_osc_calc", "t_flight",
  // heights above a reference, and the rolling shape factor
  "h_max", "h_loop", "h_min_loop", "h_roll", "h_bp", "altitude",
  // ramps, lifts, roundabouts and centres of mass. These tables were never
  // extended when the chapters were added, so a negative mass produced a
  // negative normal force and a negative radius produced a plausible-looking
  // 84% grip reading that hid the sign entirely.
  "mass_r", "d_ramp", "d_stop", "t_ramp", "height_r",
  "mass_e",
  "mass_car", "r_track",
  "m1_cm", "m2_cm", "m3_cm", "M_total", "L_rod",
]);

/* A few quantities are bounded on both sides rather than merely positive.
   Each entry is [low, high, message]; the bound is inclusive of neither end
   unless the message says otherwise. */
const BOUNDED = {
  // A ramp is a wedge: 0 is flat ground and 90 is a wall. Beyond that the
  // cosine turns negative and every force resolved from it flips sign.
  theta_ramp: [-1e-9, 90, "A ramp angle runs from 0\u00b0 (flat ground) to 90\u00b0 (a vertical wall)."],
  theta_crit: [-1e-9, 90, "The critical angle runs from 0\u00b0 to 90\u00b0."],
  theta_bank: [-1e-9, 90, "A bank angle runs from 0\u00b0 (flat) to 90\u00b0 (vertical)."],
  // Coefficients of friction are non-negative. Values above about 1.5 exist
  // (rubber on rubber) but are worth questioning, so the ceiling is generous.
  mu_s_r: [-1e-9, 3, "A coefficient of friction cannot be negative, and above about 1.5 is unusual even for rubber."],
  mu_k_r: [-1e-9, 3, "A coefficient of friction cannot be negative, and above about 1.5 is unusual even for rubber."],
  mu_s_track: [-1e-9, 3, "A coefficient of friction cannot be negative, and above about 1.5 is unusual even for rubber."],
  // A lift accelerating downward faster than g would need the floor to pull
  // the rider down, which a floor cannot do.
  a_elev: [-9.8000001, 1e6, "Below \u2212g the floor would have to PULL the rider down. At exactly \u2212g the lift is in free fall."],
  lambda_ratio: [-1e-9, 1e6, "A density ratio compares two densities, so it cannot be negative."],
  // k = I/(mR^2) is 0.4 for a solid sphere and 1 for a hoop. Nothing rolling
  // about its own axis can exceed 1.
  k_shape: [0, 1, "A rolling shape factor lies between 0 and 1 — 0.4 for a solid sphere, 1 for a hoop."],
  // e = 0 is a circle and e = 1 is a parabola that never returns.
  // Strictly below 1: e = 1 is a parabola, which never returns and has no
  // semi-major axis, so a(1-e) would report a perihelion of exactly zero.
  e_orb: [-1e-9, 0.999, "Eccentricity runs from 0 (a circle) up to just under 1. At e = 1 the path is a parabola and never closes."],
};

function validateQuantity(key, value) {
  if (!Number.isFinite(value)) return "Enter a real number.";
  const { name } = splitUnit(state.config.variableNames[key] || key);
  if (STRICTLY_POSITIVE.has(key) && value <= 0) {
    return `${name} has to be greater than zero.`;
  }
  if (Object.prototype.hasOwnProperty.call(BOUNDED, key)) {
    const [lo, hi, why] = BOUNDED[key];
    if (value <= lo || value > hi) return why;
  }
  // Beyond this the arithmetic stops meaning anything: 1e308 squared is
  // infinity, which is not an answer.
  if (Math.abs(value) > 1e30) return `${name} is too large to compute with. Try a value closer to everyday scale.`;
  if (key === "mu" && value < 0) return "A coefficient of friction cannot be negative.";
  // 0 degrees is a horizontal launch -- a ball rolling off a table -- and 90
  // is straight up. Both are ordinary problems, so only reject outside them.
  if (key === "theta_p" && (value < 0 || value > 90)) return "Launch angle must be between 0° and 90°.";
  return null;
}

function showFieldError(errorId, message) {
  const el = $(errorId);
  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
  // The field itself has to carry the invalid state. role="alert" announces
  // the message once; without aria-invalid a reader who tabs back to the
  // field gets no indication anything is wrong with it.
  const field = $(errorId.replace("-error", "-input"));
  if (field) field.setAttribute("aria-invalid", message ? "true" : "false");
}

function nextValue() {
  if (state.pendingIndex >= state.pending.length) { runSolve(); return; }
  renderValueStep();
}

function renderValueStep() {
  const key = state.pending[state.pendingIndex];
  const { name, unit } = splitUnit(state.config.variableNames[key] || key);
  $("value-counter").textContent = `Input ${state.pendingIndex + 1} of ${state.pending.length}`;
  $("value-question").textContent = unit ? `${name}, in ${unit}?` : `${name}?`;
  // Restore what was typed here before, so stepping Back does not destroy it.
  $("value-input").value = state.rawValues[key] ?? "";
  showFieldError("value-error", null);
  showScreen("screen-value");
  setProgress(clamp(0.55 + (state.pendingIndex / Math.max(state.pending.length, 1)) * 0.35, 0.55, 0.9));
  $("value-input").focus();
  $("value-input").select();
}

function submitValue() {
  const key = state.pending[state.pendingIndex];
  const raw = $("value-input").value;

  if (raw.trim() !== "") {
    const value = parseFloat(raw);
    const problem = validateQuantity(key, value);
    if (problem) { showFieldError("value-error", problem); $("value-input").focus(); return; }
  }

  pushHistory(() => {
    delete state.known[key];
    state.pendingIndex = Math.max(0, state.pendingIndex - 1);
    renderValueStep();
  });

  state.rawValues[key] = raw;
  if (raw.trim() !== "") {
    const value = parseFloat(raw);
    if (Number.isFinite(value)) state.known[key] = value;
  }
  state.pendingIndex += 1;
  nextValue();
}

/* ============================================================================
   net-force tally
   ========================================================================== */

function wireTally() {
  $("tally-add").addEventListener("click", () => {
    state.forces = readForces();
    state.forces.push("");
    renderTally();
    const inputs = $$("#tally-rows input");
    inputs[inputs.length - 1]?.focus();
  });
  $("tally-done").addEventListener("click", () => {
    const typed = readForces();
    // Capture what is on screen BEFORE leaving. Only tally-add used to sync
    // state.forces, so pressing Back from the results screen replayed a stale
    // snapshot and every force the reader had typed came back blank.
    state.forces = typed;

    const values = typed.map(parseFloat).filter((v) => !Number.isNaN(v));
    if (values.length === 0) {
      showFieldError("tally-error", "Add at least one force before computing the net force — an empty list is not the same as forces that cancel.");
      return;
    }
    // A row that could not be read was dropped in silence, so the sum was
    // right for a list the reader could still see was longer.
    const unreadable = typed.filter((v) => v.trim() !== "" && Number.isNaN(parseFloat(v))).length;
    if (unreadable > 0) {
      showFieldError("tally-error", `${unreadable} row${unreadable > 1 ? "s" : ""} could not be read as a number. Clear or correct ${unreadable > 1 ? "them" : "it"} first.`);
      return;
    }
    showFieldError("tally-error", null);

    pushHistory(() => { renderTally(); showScreen("screen-tally"); });
    state.known.Fnet_forces = values;
    runSolve();
  });
}

function readForces() { return $$("#tally-rows input").map((i) => i.value); }

function updateTallySum() {
  const sum = readForces().map(parseFloat).filter((v) => !Number.isNaN(v)).reduce((a, b) => a + b, 0);
  $("tally-sum").textContent = `ΣF = ${sum.toFixed(2)} N`;
}

function renderTally() {
  const wrap = $("tally-rows");
  wrap.innerHTML = "";
  state.forces.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "tally__row";

    const input = document.createElement("input");
    input.className = "field";
    input.type = "number";
    input.step = "any";
    input.placeholder = `Force ${index + 1} (N)`;
    input.value = value || "";
    input.setAttribute("aria-label", `Force ${index + 1} in newtons`);
    input.addEventListener("input", updateTallySum);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("tally-add").click(); }
    });
    row.appendChild(input);

    if (state.forces.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn--icon btn--quiet";
      remove.setAttribute("aria-label", `Remove force ${index + 1}`);
      remove.innerHTML = `<svg aria-hidden="true"><use href="#i-close"/></svg>`;
      remove.addEventListener("click", () => {
        state.forces = readForces();
        state.forces.splice(index, 1);
        renderTally();
      });
      row.appendChild(remove);
    }
    wrap.appendChild(row);
  });
  updateTallySum();
}

/* ============================================================================
   solve + results
   ========================================================================== */

// Every solve carries a token. A reader who leaves the flow while a request
// is in the air used to be yanked back onto the results screen by the reply --
// and because leaving had already cleared state.chapter, the answer arrived
// beside the wrong diagram. Two rapid solves could also land out of order.
let solveToken = 0;

async function runSolve() {
  const token = ++solveToken;
  showScreen("screen-results");
  setProgress(1);
  setLoading(true);

  let data;
  try {
    const res = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapter: state.solverKey,
        solveFor: state.target,
        // The collisions solver serves both variants, so it needs to be told
        // which one it is looking at before it may apply the KE-conserving
        // elastic relations.
        knowns: state.varsKey === "collisions_elastic"
          ? { ...state.known, _elastic: true }
          : state.known,
      }),
    });
    if (!res.ok) throw new Error(`Solver responded ${res.status}`);
    data = await res.json();
    if (!data || typeof data !== "object") throw new Error("Malformed solver response");
  } catch (err) {
    // Flagged so the failure is reported as a transport problem rather than
    // dressed up as a statement about the physics.
    data = {
      ok: false,
      transport: true,
      message: "Could not reach the solver. Check that the local server is still running, then try again.",
    };
  }
  setLoading(false);
  // A newer solve started, or the reader navigated away. Either way this reply
  // is no longer the answer to the question on screen.
  if (token !== solveToken) return;
  presentResult(data);
}

function setLoading(isLoading) {
  $("answer-skeleton").classList.toggle("hidden", !isLoading);
  $("answer-block").classList.toggle("hidden", isLoading);
  $("results-alert").classList.add("hidden");
}

function presentResult(data) {
  showScreen("screen-results");
  setProgress(1);
  setLoading(false);
  state.lastResult = data;

  const failed = !data.ok;
  $("results-alert").classList.toggle("hidden", !failed);
  $("answer-block").classList.toggle("hidden", failed);

  if (failed) {
    $("results-alert-text").textContent = data.transport
      ? data.message
      : explainFailure(data.message);
  } else {
    // Clear it rather than just hiding it: assistive technology walks the
    // document, and stale text from the previous problem is still text.
    $("results-alert-text").textContent = "";
    const { name, unit } = splitUnit(data.variableName);
    $("answer-label").textContent = name;
    $("answer-value").textContent = formatNumber(data.solution);
    $("answer-unit").textContent = unit;
    $("answer-eq").textContent = data.equation;
    $("answer-origin").textContent = data.originalEquation;
    const caveat = consistencyWarning(state.known, state.varsKey)
      || rootCaveat(data.equation, data.solveFor, data.solution);
    $("answer-caveat").textContent = caveat;
    $("answer-caveat").classList.toggle("hidden", !caveat);
    $("symbolic-expr").textContent = data.equation;
    applySymbolicMode();
  }

  renderDerivation(data);
  recordWork(data);
  syncViewTabs();
  paintViewport();
}

/* A square root has two roots, and for a VECTOR component both are physical:
   a ball dropped from rest arrives at -19.8 m/s just as truly as +19.8. The
   solver has to return one number, so say plainly which one it returned and
   that the sign is set by the axis the reader chose -- sign conventions are
   worth real points on the exam. Scalars (speed, energy, mass) are exempt:
   there the negative root is not a physical answer. */
const SIGNED_UNITS = new Set(["m/s", "m", "m/s^2", "m/s²", "rad/s", "rad", "N·s", "kg·m/s", "N"]);

/* omega, T and f are three names for the same fact about an oscillator, so a
   reader who fills in all three can contradict themselves. The solver answers
   from whichever relationship fires first and says nothing, which is the one
   way this app can hand back a confidently wrong number. Say so instead. */
function consistencyWarning(known, varsKey) {
  if (varsKey !== "osc_spring" && varsKey !== "osc_general") return "";
  const w = known.omega_osc, T = known.T_osc, f = known.f_osc;
  const disagree = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) > 0.01;
  const clashes = [];
  if (w > 0 && T > 0 && disagree(w, 2 * Math.PI / T)) clashes.push(`ω = ${formatNumber(w)} rad/s implies T = ${formatNumber(2 * Math.PI / w)} s, not ${formatNumber(T)} s`);
  if (w > 0 && f > 0 && disagree(w, 2 * Math.PI * f)) clashes.push(`ω = ${formatNumber(w)} rad/s implies f = ${formatNumber(w / (2 * Math.PI))} Hz, not ${formatNumber(f)} Hz`);
  if (T > 0 && f > 0 && disagree(f, 1 / T)) clashes.push(`T = ${formatNumber(T)} s implies f = ${formatNumber(1 / T)} Hz, not ${formatNumber(f)} Hz`);
  if (!clashes.length) return "";
  return "The values you gave disagree with each other — " + clashes[0]
    + ". The answer below used one of them, so check which figure you meant.";
}

// Quantities that are magnitudes by construction. A negative escape speed is
// not "the other root", it is nothing at all, and the orbital chapter never
// asks the reader to choose an axis.
const UNSIGNED_KEYS = new Set([
  "v_circ", "v_escape_orb", "v_peri", "v_apo", "v_at_r", "v_orbit", "v_escape",
  "T_kepler", "T_orbit", "a_semi", "r_orb", "r_peri", "r_apo", "R_body",
  // Speeds, lengths and radii reached through a square root. Each is a
  // magnitude by construction, so the "two roots" caveat would offer a
  // negative alternative that has no meaning -- a negative terminal speed, a
  // negative river width.
  "v_term", "v_drag", "v_bank", "v_max_bank", "v_min_bank", "v_ground",
  "v_rel_mag", "vf_2d", "v1i_2d", "v2i_2d", "v1f_2d", "v2f_2d",
  "d_pp", "d_min_pp", "L_stick_pp", "r_bank", "w_river",
]);

function rootCaveat(equation, solveFor, solution) {
  if (!/\bsqrt\s*\(/.test(equation || "")) return "";
  if (UNSIGNED_KEYS.has(solveFor)) return "";
  if (!SIGNED_UNITS.has(unitFor(solveFor))) return "";
  if (!Number.isFinite(solution) || solution === 0) return "";
  const other = formatNumber(-Math.abs(solution));
  return `The square root has two roots. This is the positive one; ${other} is equally valid `
    + `and is the right answer whenever the quantity points along your negative axis.`;
}

/* "Try filling in a few more" is actively misleading when the setup answers
   already pinned every remaining quantity — there is nothing left to fill.
   Report what is actually known so the reader can see the real situation. */
function explainFailure(serverMessage) {
  const listed = describeGiven();
  // Nothing is left to supply when the wizard had no inputs to ask for at all
  // (the setup answers fixed everything), or when every input it did ask for
  // now carries a value.
  const pending = state.pending || [];
  const nothingLeft = pending.length === 0 ||
    pending.every((key) => Object.prototype.hasOwnProperty.call(state.known, key));

  if (nothingLeft) {
    return `Everything this chapter needs is already fixed — ${listed} — and none of its relationships connect those to the quantity you asked for. Try solving for something else, or go back and describe the situation differently.`;
  }
  return `${serverMessage} So far you have given ${listed}.`;
}

function sceneParams() {
  const params = {};
  Object.entries(state.known).forEach(([key, value]) => {
    if (typeof value === "number") params[key] = value;
  });
  const result = state.lastResult;
  if (result && result.ok) params[result.solveFor] = result.solution;
  params.inelastic = state.varsKey === "collisions_inelastic";
  params.pendulum = state.varsKey === "osc_pendulum";
  // Free-body and graph builders branch on which scenario is loaded.
  params._context = state.varsKey || state.chapter?.id;
  return params;
}

function paintViewport() {
  $("viewport-label").textContent = contextLabel();
  startAnimation($("scene-canvas"), currentVisual(), sceneParams(), state.viewMode);
}

function syncViewTabs() {
  const context = state.varsKey || state.chapter?.id;
  const available = {
    scene: true,
    freebody: FREE_BODY_CONTEXTS.has(context),
    graphs: GRAPH_CONTEXTS.has(context),
  };
  $$(".viewport__tabs .tab").forEach((tab) => {
    tab.hidden = !available[tab.dataset.mode];
  });
  if (!available[state.viewMode]) state.viewMode = "scene";
  selectViewTab(state.viewMode, false);
}

function selectViewTab(mode, repaint = true) {
  state.viewMode = mode;
  $$(".viewport__tabs .tab").forEach((tab) => {
    const on = tab.dataset.mode === mode;
    tab.classList.toggle("is-selected", on);
    tab.setAttribute("aria-selected", String(on));
    // Roving tabindex: only the selected tab is in the tab order, which is
    // what the tablist pattern requires.
    tab.tabIndex = on ? 0 : -1;
    if (on) $("viewport-panel").setAttribute("aria-labelledby", tab.id);
  });
  // The replay control only means something for a time-based scene.
  $("btn-replay").hidden = mode === "freebody";
  if (repaint) paintViewport();
}

/* --- symbolic-first ---------------------------------------------------- */

const SYMBOLIC_KEY = "mechanicsmania:symbolic";

function applySymbolicMode() {
  const on = state.symbolicFirst;
  $("toggle-symbolic").checked = on;
  $("symbolic-block").classList.toggle("hidden", !on);
  $("numeric-block").classList.toggle("hidden", on);
}

function initSymbolicMode() {
  try { state.symbolicFirst = localStorage.getItem(SYMBOLIC_KEY) === "1"; } catch { /* ignore */ }
  $("toggle-symbolic").checked = state.symbolicFirst;
  $("toggle-symbolic").addEventListener("change", (e) => {
    state.symbolicFirst = e.target.checked;
    try { localStorage.setItem(SYMBOLIC_KEY, state.symbolicFirst ? "1" : "0"); } catch { /* ignore */ }
    applySymbolicMode();
  });
  $("btn-reveal").addEventListener("click", () => {
    $("symbolic-block").classList.add("hidden");
    $("numeric-block").classList.remove("hidden");
  });
}

function currentVisual() {
  return (state.variant && state.variant.visual) || (state.flow && state.flow.visual) || "linear-motion";
}

function wireResults() {
  $("btn-again").addEventListener("click", () => {
    state.known = {};
    state.history = [];
    startSetup();
  });
  $("btn-newchapter").addEventListener("click", goChapters);
  $("btn-home").addEventListener("click", goHome);
  $("btn-replay").addEventListener("click", paintViewport);

  $$(".viewport__tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => selectViewTab(tab.dataset.mode));
    // Arrow keys move between tabs, as the tablist pattern expects.
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const visible = $$(".viewport__tabs .tab").filter((t) => !t.hidden);
      const here = visible.indexOf(tab);
      const next = visible[(here + step + visible.length) % visible.length];
      selectViewTab(next.dataset.mode);
      next.focus();
    });
  });

  initSymbolicMode();
}

/* ============================================================================
   derivation
   ========================================================================== */

let derivationObserver = null;
// The staggered reveal schedules timers against static <li> nodes. Leaving
// them pending meant an orphan from the PREVIOUS derivation fired after the
// next one had reset its rows, stranding that panel half-revealed.
let derivationTimers = [];

function describeGiven() {
  const parts = [];
  Object.entries(state.known).forEach(([key, value]) => {
    // The net-force builder stores a list, which a plain typeof check skipped
    // entirely -- so the very numbers that produced the answer went unlisted.
    if (Array.isArray(value)) {
      if (key === "Fnet_forces" && value.length) {
        parts.push(`forces = [${value.map((f) => formatNumber(f)).join(", ")}] N`);
      }
      return;
    }
    if (typeof value !== "number") return;
    const full = state.config.variableNames[key];
    if (!full) return;
    const unit = splitUnit(full).unit;
    parts.push(`${key} = ${formatNumber(value)}${unit ? " " + unit : ""}`);
  });
  return parts.length ? parts.join("     ") : "no numeric inputs — this followed from the setup answers";
}

/* --- substitution line ---------------------------------------------------
   Rewrites the rearranged formula with the reader's own numbers in place of
   the symbols. This is the step where mistakes actually happen — a dropped
   factor, a sign lost while plugging in — and it also lets someone check they
   entered what they meant to.

   It is deliberately FAIL-CLOSED. Equation strings are not a formal grammar;
   they vary across 214 solver paths and carry Greek symbols, function names
   and units. If even one token cannot be resolved with certainty, the whole
   line is withheld, because a wrong substitution is worse than none.        */

const MATH_FUNCTIONS = new Set([
  "sqrt", "cbrt", "sin", "cos", "tan", "asin", "acos", "atan",
  "arcsin", "arccos", "arctan", "exp", "ln", "log", "abs", "max", "min",
]);

// Symbols standing for physical constants. Note that π is deliberately NOT
// here: it is left as a symbol. Printing 3.142 loses precision against the
// real answer, and "2pi" would render as "23.142" once the digit and the
// value ran together.
function constantFor(token) {
  if (token === "g") return GRAVITY;
  if (token === "G") return GRAV_CONSTANT;
  return undefined;
}

const KEEP_SYMBOLIC = new Set(["pi", "π", "e"]);

// A few equations render a variable with its Greek letter.
const GREEK_ALIASES = { "μ": "mu", "θ": "theta", "ω": "omega", "α": "alpha", "τ": "tau", "φ": "phi" };

// "ΣF" is one token to the scanner, and it is the name of the net force.
// Without this the whole Newton's-second-law family printed no worked line.
const SIGMA_ALIASES = { "ΣF": "Fnet", "Στ": "tau" };

/* Equation strings are written for a human reader, so they use short display
   symbols where the state uses fully-qualified keys — "v0" for v0_p, "m" for
   mass. Mapping those is only safe with the chapter in hand, since the same
   letter means different things elsewhere: "t" is t_p in a projectile problem
   and t_calc in a calculus one. Hence one table per context rather than a
   single global guess. */
const SYMBOL_ALIASES = {
  kinematics: { v_A: "v_a", v_B: "v_b", v_AB: "v_rel" },
  projectile: { v0: "v0_p", theta: "theta_p", t: "t_p", range: "range_p", x: "x_at_t", y: "y_at_t", vy: "vy_at_t" },
  forces: { m: "mass", W: "weight", F: "Fa" },
  momentum: { m: "mass" },
  energy: { m: "mass" },
  work_kinetic: { m: "mass" },
  work_grav: { m: "mass" },
  work_general: { f_k: "Ff_w", d: "d_slide", v: "v_power", W_friction: "W_friction", W_f: "W_friction", F: "Fa" },
  // "g" is the FIELD STRENGTH here, a user-supplied quantity, not the 9.8
  // surface constant. Without this alias it fell through to the constant
  // table and printed a substitution 108% away from the stated answer.
  gravitation: {
    m1: "m1_g", m2: "m2_g", r: "r_g", M: "m1_g",
    // "g" is the FIELD STRENGTH here, a user-supplied quantity, not the 9.8
    // surface constant.
    g: "g_field", F: "F_grav", U: "U_grav", T: "T_orbit",
    v: "v_orbit", v_esc: "v_escape",
  },
  orbital: {
    M: "M_central", m: "m_sat", a: "a_semi", e: "e_orb",
    r: "r_orb", v: "v_at_r", T: "T_kepler", E: "E_orb",
    r_peri: "r_peri", r_apo: "r_apo", v_peri: "v_peri", v_apo: "v_apo",
    v_circ: "v_circ", v_esc: "v_escape_orb",
    R_body: "R_body", altitude: "altitude",
  },
  blockstack: {
    m_top: "m_top", m_bot: "m_bot", mu_s: "mu_between", mu_k: "mu_between",
    F: "F_push", a: "a_together", f: "f_on_top", N: "N_between",
    mu_ground: "mu_ground", mu_k: "mu_between", F_max: "F_max_together",
  },
  ramp: {
    m: "mass_r", theta: "theta_ramp", N: "Fn_r", f_smax: "Ff_static_max",
    mu_s: "mu_s_r", mu_k: "mu_k_r",
    f_k: "Ff_r", f_s: "Ff_static", Fa: "Fa_r", a: "a_ramp",
    d: "d_ramp", h: "height_r", v0: "v0_r", vf: "vf_r", t: "t_ramp",
  },
  elevator: {
    m: "mass_e", m_car: "mass_car_e", a: "a_elev", N: "Fn_e", T: "T_cable",
    scale_ratio: "scale_ratio",
    W: "W_true", W_apparent: "W_apparent",
  },
  com: {
    m1: "m1_cm", m2: "m2_cm", m3: "m3_cm",
    v3: "v3_cm", a1: "a1_cm", a2: "a2_cm", dx1: "dx1_cm", dx2: "dx2_cm",
    x1: "x1_cm", x2: "x2_cm", x3: "x3_cm",
    v1: "v1_cm", v2: "v2_cm",
    M: "M_total", F_ext: "F_ext_cm", L: "L_rod", ratio: "lambda_ratio", x_cm: "x_cm",
  },
  roundabout: {
    m: "mass_car", r: "r_track", v: "v_car", mu_s: "mu_s_track",
    a_t: "a_tangential", a_c: "a_centripetal", theta: "theta_bank", N: "Fn_car",
    a_required: "friction_demand",
  },
  rotKinematics: { theta: "theta_rot" },
  rotDynamics: {
    r: "r_dyn", m: "mass_dyn", mass: "mass_dyn", omega: "omega_dyn",
    dtheta: "theta_rot_dyn", dt: "t_rot", W: "W_rot", P: "P_rot",
    F: "F_tang", F_tang: "F_tang", dL: "changeOfL",
    alpha: "alpha_dyn", "ΔL": "changeOfL", v: "v_tang",
    // tau = r*F*sin(theta) and L = m*v*r*sin(theta) each carry their own
    // angle; without these r_dyn and F_tang lost their worked lines.
    theta: "theta_tau", theta_L: "theta_L", theta_tau: "theta_tau",
  },
  osc_spring: { I: "I_phys", m2: "mass_phys", d: "d_pivot", k1: "k1_comb", k2: "k2_comb",
    k_eq: "k_parallel", k_series: "k_series", k_parallel: "k_parallel", m: "mass_osc", mass: "mass_osc", k: "k_osc", omega: "omega_osc", x: "x_osc", v: "v_osc", T: "T_osc", f: "f_osc", a: "a_osc", E: "E_osc" },
  osc_general: { I: "I_phys", m2: "mass_phys", d: "d_pivot", k1: "k1_comb", k2: "k2_comb",
    k_eq: "k_parallel", k_series: "k_series", k_parallel: "k_parallel", m: "mass_osc", mass: "mass_osc", k: "k_osc", omega: "omega_osc", x: "x_osc", v: "v_osc", T: "T_osc", f: "f_osc", a: "a_osc", E: "E_osc" },
  osc_pendulum: {
    L: "L_pend", T: "T_pend",
    // The physical-pendulum relations live in this variant too; without
    // these the worked line was withheld for all four of its quantities.
    I: "I_phys", m2: "mass_phys", d: "d_pivot", m: "mass_phys",
  },
  calc_kinematics: { t: "t_calc", a: "a_const", a0: "a_const", j: "jerk" },
  calc_rotational: { t: "t_calc", theta0: "theta0_calc", omega0: "omega0_calc", alpha: "alpha_t" },
  calc_oscillations: { A: "A_calc", omega: "omega_calc", phi: "phi_calc", t: "t_osc_calc", x: "x_calc" },
  calc_workenergy: {
    dU: "dU",
    F: "F_calc", dx: "dx_calc", m: "mass", x: "dspring",
    W: "W_calc", KE: "KE_calc", PE: "PE_calc", E_total: "E_total_calc",
  },
  calc_varforce: { F0: "F0_var", c: "c_var", d: "dx_var", W: "W_var" },
  atwood: {}, atwood_flywheel: { I: "I_pulley", r: "r_pulley" },
  rolling_race: { k: "k_shape", h: "h_roll", theta: "theta_roll", v: "v_roll", a: "a_roll" },
  loop_coaster: { R: "R_loop", h: "h_loop", m: "mass_loop", v_bottom: "v_bottom_loop", v_min: "v_min_loop", h_min: "h_min_loop" },
  ballistic_pendulum: { m1: "m1_bp", m2: "m2_bp", v1i: "v1i_bp", vc: "v_common_bp", h: "h_bp" },
};

/* A few quantities are written in function notation -- "x(t)" is the position
   AT time t, not x multiplied by t. The token scanner cannot tell those from a
   product, so it bails out on any identifier followed by "(", which withheld
   every worked line in the calculus chapter. These tables name the ones that
   are really a single quantity, and they are resolved before scanning. */
const COMPOSITE_ALIASES = {
  // "costheta" is already the cosine, so the whole "cos(theta)" group is what
  // its value replaces. Aliasing just "theta" printed cos(cos(theta)).
  work_general: { "cos(theta)": "costheta" },
  calc_workenergy: { "cos(theta)": "costheta" },
  projectile: { "x(t)": "x_at_t", "y(t)": "y_at_t", "vy(t)": "vy_at_t" },
  calc_kinematics: { "x(t)": "x_t", "v(t)": "v_t", "a(t)": "a_t" },
  calc_rotational: { "theta(t)": "theta_t", "omega(t)": "omega_t" },
  calc_oscillations: { "x(t)": "x_calc", "x(0)": "x_calc" },
};

/* A chapter table says what a symbol means IN THIS CHAPTER, which is one level
   too coarse: several chapters reuse a letter across equations that mean
   different quantities by it. "d" in the work chapter is the displacement in
   W = Fa*d and the sliding distance in W_f = -f_k*d; "m" in the oscillations
   chapter is the bob in T = 2*pi*sqrt(m/k) and the swinging body in the
   physical-pendulum period. The chapter table can only name one of each, so
   whenever the reader had filled in BOTH quantities the worked line quietly
   printed the wrong one -- and being present, it never failed closed.

   These entries are keyed on the equation the solver actually returned, which
   is the only level at which a symbol has exactly one meaning. */
const EQUATION_ALIASES = {
  work_general: {
    "W = Fa*d*cos(theta)": { d: "d" },
    "W = Fa*d": { d: "d" },
    "Fa = W/(d*cos(theta))": { d: "d" },
    "Fa = W/d": { d: "d" },
  },
  // "T" here is the physical pendulum's period, not the spring's, and "m" is
  // the swinging body, not the block on the spring.
  osc_spring: {
    "T = 2*pi*sqrt(I / (m*g*d))": { m: "mass_phys" },
    "I = m*g*d*(T/(2*pi))^2": { m: "mass_phys", T: "T_phys" },
    "m = I / (g*d*(T/(2*pi))^2)": { T: "T_phys" },
    "d = I / (m*g*(T/(2*pi))^2)": { m: "mass_phys", T: "T_phys" },
  },
  osc_general: {
    "T = 2*pi*sqrt(I / (m*g*d))": { m: "mass_phys" },
    "I = m*g*d*(T/(2*pi))^2": { m: "mass_phys", T: "T_phys" },
    "m = I / (g*d*(T/(2*pi))^2)": { T: "T_phys" },
    "d = I / (m*g*(T/(2*pi))^2)": { m: "mass_phys", T: "T_phys" },
  },
  // Same collision as osc_spring: this variant's "T" is the SIMPLE pendulum's
  // period, but the physical-pendulum relations reach for T_phys, and "m" for
  // the swinging body rather than the bob.
  osc_pendulum: {
    "T = 2*pi*sqrt(I / (m*g*d))": { m: "mass_phys" },
    "I = m*g*d*(T/(2*pi))^2": { m: "mass_phys", T: "T_phys" },
    "m = I / (g*d*(T/(2*pi))^2)": { T: "T_phys" },
    "d = I / (m*g*(T/(2*pi))^2)": { m: "mass_phys", T: "T_phys" },
  },
  calc_workenergy: {
    "dU = -F*dx": { F: "F_from_U", dx: "dx_U" },
    "F = -dU/dx": { dx: "dx_U" },
    "dx = -dU / F": { F: "F_from_U" },
  },
  // The distance travelled BEFORE stopping, not the length of the slope.
  ramp: {
    "v0 = sqrt(2*abs(a)*d)": { d: "d_stop" },
  },
  // The balance point of the rod, not the centre of mass of the particles.
  com: {
    "L = x_cm*3*(1 + ratio) / (1 + 2*ratio)": { x_cm: "x_cm_rod" },
    "L = 2*x_cm": { x_cm: "x_cm_rod" },
    "ratio = (3*x_cm/L - 1) / (2 - 3*x_cm/L)": { x_cm: "x_cm_rod" },
    "x_cm = L*(1 + 2*ratio) / (3*(1 + ratio))": { x_cm: "x_cm_rod" },
    "x_cm = L/2": { x_cm: "x_cm_rod" },
  },
};

// Returns the resolved key as well as the value, so the caller can consult the
// quantity's unit — an angle stated in degrees has to be printed as such.
function resolveSymbol(token, known, context, equation) {
  const has = (k) => k !== undefined && Object.prototype.hasOwnProperty.call(known, k);
  // The equation in hand outranks the chapter, because a symbol has exactly
  // one meaning inside one equation and several across a chapter.
  const perEq = equation && EQUATION_ALIASES[context] && EQUATION_ALIASES[context][equation];
  if (perEq && perEq[token]) {
    // An override that names a quantity the reader never supplied must not
    // fall through to the chapter table -- that is the collision it exists to
    // prevent. Fail closed instead.
    return has(perEq[token]) ? { key: perEq[token], value: known[perEq[token]] } : undefined;
  }
  // The chapter's alias table outranks a same-named raw known. In work_general
  // "d" is a variable AND an alias for d_slide; letting the raw name win meant
  // the friction equation printed the wrong distance without failing closed.
  const table = SYMBOL_ALIASES[context];
  if (table && table[token] && has(table[token])) {
    return { key: table[token], value: known[table[token]] };
  }
  if (has(token)) return { key: token, value: known[token] };
  const greek = GREEK_ALIASES[token] || SIGMA_ALIASES[token];
  if (has(greek)) return { key: greek, value: known[greek] };
  if (table) {
    const aliased = table[token] || (greek ? table[greek] : undefined);
    if (has(aliased)) return { key: aliased, value: known[aliased] };
  }
  return undefined;
}

/* A substitution line exists so the reader can do the arithmetic themselves.
   If our own arithmetic does not reproduce the answer printed just below it,
   the line is worse than absent: it is a confidently wrong worked example
   sitting next to a correct one. So evaluate what we are about to print and
   withhold it unless the two agree.

   This guards the whole class rather than any one chapter. A symbol that
   resolves to the wrong quantity -- for whatever reason, including one nobody
   has found yet -- cannot get past it. */
function substitutionAgrees(rhs, expected) {
  if (typeof expected !== "number" || !Number.isFinite(expected)) return true;

  let src = rhs
    // Square brackets are an outer grouping in a hand-written formula --
    // "[m2*(g - a) - a*I/r^2] / (g + a)". To JavaScript they are an array
    // literal, so normalise them before anything else looks at the string.
    .replace(/\[/g, "(").replace(/\]/g, ")")
    .replace(/π/g, "(" + Math.PI + ")")
    .replace(/·/g, "*")
    .replace(/−/g, "-")
    .replace(/\^/g, "**")
    // "38°" means 38 degrees; the trig below counts in radians.
    // The exponent has to be part of the number, or a degree value that
    // formats as 5.7e-05 leaves a bare "e-05" behind and the whole line is
    // withheld. It fails closed rather than printing wrongly, but the reader
    // still loses working they were entitled to see.
    .replace(/((?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)°/g, "($1*" + (Math.PI / 180) + ")");

  const FN = {
    sqrt: "Math.sqrt", cbrt: "Math.cbrt", sin: "Math.sin", cos: "Math.cos",
    tan: "Math.tan", asin: "Math.asin", acos: "Math.acos", atan: "Math.atan",
    arcsin: "Math.asin", arccos: "Math.acos", arctan: "Math.atan",
    exp: "Math.exp", ln: "Math.log", log: "Math.log10", abs: "Math.abs",
    max: "Math.max", min: "Math.min",
  };
  // Numbers first in the alternation, so the "e" of 6.674e-11 is read as part
  // of the number and not as a stray symbol. Getting this the other way round
  // rejects every line in the gravitation chapter.
  const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
  const TOKEN = new RegExp(NUMBER.source + "|[A-Za-z_][A-Za-z0-9_]*", "g");
  let unresolved = false;
  src = src.replace(TOKEN, (tok) => {
    if (/^[0-9.]/.test(tok)) return tok;
    if (Object.prototype.hasOwnProperty.call(FN, tok)) return FN[tok];
    unresolved = true;                 // a symbol survived; refuse to guess
    return tok;
  });
  if (unresolved) return false;
  // Whitelist what is left once the numbers and the named functions are taken
  // out, so nothing but arithmetic is ever evaluated.
  const bare = src.replace(/Math\.[a-z0-9]+/g, "")
    .replace(new RegExp(NUMBER.source, "g"), "");
  if (/[^+\-*.,/()\s]/.test(bare)) return false;

  let value;
  try {
    value = Function('"use strict"; return (' + src + ");")();
  } catch (err) {
    return false;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const scale = Math.max(Math.abs(expected), 1e-9);
  return Math.abs(value - expected) / scale < 1e-4;
}

function buildSubstitution(equation, known, context, solveFor, expected) {
  if (typeof equation !== "string") return null;
  const eq = equation.trim();
  const split = eq.indexOf("=");
  if (split < 0) return null;

  // An inverse trig function returns radians, but the quantity being solved
  // for may be stated in degrees — the solver converts, the printed line
  // cannot show that it did. Rather than display an expression that evaluates
  // to 0.785 beside an answer of 45, withhold it.
  // NOTE for whoever adds atan2 to MATH_FUNCTIONS: it must join this regex in
  // the same edit. "\batan\s*\(" does NOT match "atan2(", so today the 2D
  // direction lines are withheld only because the token scanner bails on the
  // "(" after an identifier. Make atan2 parseable without widening this guard
  // and every degree-valued direction prints a RADIANS line beside a degree
  // answer.
  if (solveFor && unitFor(solveFor) === "°" && /\b(asin|acos|atan|arcsin|arccos|arctan)\s*\(/.test(eq)) {
    return null;
  }

  const lhs = eq.slice(0, split).trim();
  // "½" reads well in a formula but is not a parseable numeral.
  const rhs = eq.slice(split + 1).trim().replace(/½/g, "0.5");
  if (!rhs) return null;

  let substituted = "";
  let cursor = 0;
  let replacements = 0;

  // Resolve function-notation quantities first, so the scanner below never
  // sees them. Longest name first, or "x(t)" inside "vx(t)" would match wrong.
  let scan = rhs;
  const composites = COMPOSITE_ALIASES[context];
  if (composites) {
    const names = Object.keys(composites).sort((a, b) => b.length - a.length);
    for (const name of names) {
      if (!scan.includes(name)) continue;
      const key = composites[name];
      if (!Object.prototype.hasOwnProperty.call(known, key)) return null;   // fail closed
      const v = known[key];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      // Same reason as the token path below: a line the reader is invited to
      // check has to carry enough figures to check with.
      const printed = v < 0 ? `(${preciseEnough(v)})` : preciseEnough(v);
      scan = scan.split(name).join(printed);
      replacements += 1;
    }
  }
  const tokenPattern = /[A-Za-z_α-ωΔΣ][A-Za-z0-9_α-ωτ]*/gu;

  for (const match of scan.matchAll(tokenPattern)) {
    const token = match[0];
    substituted += scan.slice(cursor, match.index);
    cursor = match.index + token.length;

    if (MATH_FUNCTIONS.has(token)) { substituted += token; continue; }

    // "a(t)" and "x(0)" are function APPLICATION, not multiplication. Naively
    // replacing the identifier turns them into "4.7(4.7)", which reads as a
    // product and evaluates to something else entirely. There is no way to
    // tell those apart from the token alone, so withhold the whole line.
    if (scan[cursor] === "(") return null;

    // The reader's own data outranks BOTH the constant table and the
    // keep-symbolic list. In the momentum chapter "pi" is initial momentum,
    // not 3.14159; in the gravitation chapter "g" is the field strength, not
    // 9.8. Resolving either as a constant produced a confidently wrong line.
    const resolved = resolveSymbol(token, known, context, eq);
    let value = resolved ? resolved.value : undefined;

    if (value === undefined && KEEP_SYMBOLIC.has(token)) {
      // "2pi" has to become "2·π" for the same reason "2g" does: an unspaced
      // digit-then-symbol reads as one token to anyone skimming the line.
      if (/[0-9]$/.test(substituted)) substituted += "·";
      substituted += token === "pi" ? "π" : token;
      continue;
    }
    // An alias declares what a symbol means IN THIS CHAPTER. If the aliased
    // quantity is missing, falling through to the global constant table would
    // contradict that declaration -- "g" in the gravitation chapter would
    // silently become 9.8 again. Fail closed instead.
    const aliasTable = SYMBOL_ALIASES[context];
    if (value === undefined && aliasTable && aliasTable[token]) return null;
    if (value === undefined) value = constantFor(token);
    if (typeof value !== "number" || !Number.isFinite(value)) return null;   // fail closed

    // Formulas are written with implicit multiplication: 2g, 2R, 3R. Dropping
    // a value straight in turns "2g" into "29.8", so make the product explicit.
    if (/[0-9]$/.test(substituted)) substituted += "·";

    // An angle held in degrees has to say so, or "cos(38)" reads as radians.
    const unit = resolved ? unitFor(resolved.key) : "";
    const suffix = unit === "°" ? "°" : "";

    // formatNumber shows 3 significant figures below 1, which is fine beside
    // an answer but not INSIDE one: "1 - e" with e = 0.96715 printed as 0.967
    // is 0.45% out, and e = 0.9995 printed as 1 divides by zero. Widen the
    // display until it round-trips, so the working can be checked by hand.
    const shown = preciseEnough(value);
    substituted += value < 0 ? `(${shown}${suffix})` : `${shown}${suffix}`;
    replacements += 1;
  }
  substituted += scan.slice(cursor);

  // Nothing was actually replaced, so the line would just repeat the formula.
  if (replacements === 0) return null;
  if (!substitutionAgrees(substituted, expected)) return null;
  return `${lhs} = ${substituted}`;
}

function renderDerivation(data) {
  const panel = $("derivation");
  if (derivationObserver) { derivationObserver.disconnect(); derivationObserver = null; }
  derivationTimers.forEach(clearTimeout);
  derivationTimers = [];

  if (!data.ok) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");

  const unit = unitFor(data.solveFor);
  $("deriv-given").textContent = describeGiven();
  // Some chapters have to work out an intermediate before the governing
  // relationship can be applied -- an orbital radius from an altitude, say.
  // Showing that step is the difference between a worked answer and a number
  // that appeared from nowhere.
  const chain = Array.isArray(data.chain) ? data.chain : [];
  $("deriv-chain-row").classList.toggle("hidden", chain.length === 0);
  $("deriv-chain").textContent = chain.join("     ");
  $("deriv-origin").textContent = data.originalEquation;
  $("deriv-rearranged").textContent = data.equation;
  $("deriv-result").textContent =
    `${data.solveFor} = ${formatNumber(data.solution)}${unit ? " " + unit : ""}`;

  // A chapter that had to work out an intermediate returns it, so the shown
  // working can substitute the same numbers the answer used rather than
  // failing closed on a quantity the reader never typed.
  const withDerived = data.derived ? { ...state.known, ...data.derived } : state.known;
  const substitution = buildSubstitution(data.equation, withDerived, state.varsKey, data.solveFor, data.solution);
  $("deriv-substitute-row").classList.toggle("hidden", !substitution);
  $("deriv-substitute").textContent = substitution || "";

  const lines = $$(".step-line:not(.hidden)", panel);
  lines.forEach((line) => line.classList.remove("is-revealed"));

  const reveal = () => lines.forEach((line, i) => {
    derivationTimers.push(setTimeout(() => line.classList.add("is-revealed"), i * 420));
  });

  // Respect a reduced-motion preference by showing the whole derivation at
  // once instead of staggering it in.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    lines.forEach((line) => line.classList.add("is-revealed"));
    return;
  }

  // Otherwise hold the reveal until the panel is actually scrolled into view,
  // so the steps animate as the reader arrives rather than off-screen.
  derivationObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal();
        derivationObserver.disconnect();
        derivationObserver = null;
        break;
      }
    },
    { threshold: 0.25 }
  );
  derivationObserver.observe(panel);
}

/* ============================================================================
   session worklog
   ========================================================================== */

function recordWork(data) {
  if (!data.ok) return;
  const { name, unit } = splitUnit(data.variableName);
  state.worklog.push({
    context: contextLabel(),
    quantity: name,
    value: `${formatNumber(data.solution)}${unit ? " " + unit : ""}`,
  });
  renderWorklog();
}

function renderWorklog() {
  const box = $("worklog");
  const list = $("worklog-list");
  if (!state.worklog.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  list.innerHTML = "";
  state.worklog.forEach((entry) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="worklog__ctx"></span><span class="worklog__q"></span><span class="worklog__v"></span>`;
    li.querySelector(".worklog__ctx").textContent = entry.context;
    li.querySelector(".worklog__q").textContent = entry.quantity;
    li.querySelector(".worklog__v").textContent = entry.value;
    list.appendChild(li);
  });
}

/* ============================================================================
   moments of inertia
   ========================================================================== */

function openInertia() {
  // The screen must be visible BEFORE the figures are painted. Measuring a
  // canvas inside a display:none parent gives a client width of zero, and the
  // Math.max(w, 1) floor then bakes in a permanent 1x1 bitmap.
  showScreen("screen-inertia");
  renderInertiaGallery();
}

function renderInertiaGallery() {
  const bodies = state.config.inertiaBodies || [];
  const theorems = state.config.inertiaTheorems || [];

  const build = (host, items, isTheorem) => {
    host.innerHTML = "";
    items.forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "inertia-card";
      card.innerHTML = `
        <span class="inertia-card__figure"><canvas></canvas></span>
        <span class="inertia-card__name"></span>
        <span class="inertia-card__formula"></span>`;
      card.querySelector(".inertia-card__name").textContent = item.name;
      card.querySelector(".inertia-card__formula").textContent = item.formula;
      card.addEventListener("click", () => openInertiaDetail(item, isTheorem));
      host.appendChild(card);
      // Paint synchronously. Reading clientWidth forces layout, so the canvas
      // measures a real box without waiting for an animation frame — and a
      // frame that never arrives (a hidden tab) would otherwise leave the
      // figure blank and unregistered for theme repaints.
      paintInertiaFigure(card.querySelector("canvas"), item.shape || item.id);
    });
  };

  build($("inertia-grid"), bodies, false);
  build($("inertia-theorems"), theorems, true);
}

function openInertiaDetail(item, isTheorem) {
  state.inertiaItem = item;
  $("detail-name").textContent = item.name;
  $("detail-axis").textContent = isTheorem ? "Theorem" : "Moment of inertia";
  $("detail-assumes").textContent = isTheorem
    ? item.statement
    : `${item.axis} ${item.assumes}`;
  $("detail-formula").textContent = item.formula;
  $("detail-remark").textContent = item.remark || "";
  // Match the accessible-name treatment the other two canvases already have.
  $("inertia-canvas").setAttribute("role", "img");
  $("inertia-canvas").setAttribute("aria-label", `Diagram of ${item.name}, showing the axis and the mass element`);

  const list = $("detail-derivation");
  list.innerHTML = "";
  item.derivation.forEach((step) => {
    const li = document.createElement("li");
    const wrap = document.createElement("div");
    const label = document.createElement("b");
    label.textContent = step.label;
    const math = document.createElement("code");
    math.textContent = step.math;
    wrap.append(label, math);
    li.appendChild(wrap);
    list.appendChild(li);
  });

  renderInertiaCalculator(item, isTheorem);
  showScreen("screen-inertia-detail");
  paintInertiaFigure($("inertia-canvas"), item.shape || item.id);
}

// Evaluate I from the dimensions the reader types, using the same coefficient
// and combination rule the formula states.
function inertiaValue(item, mass, dims) {
  const d = (k) => Number(dims[k]);
  let group;
  switch (item.form) {
    case "L^2": group = d("L") ** 2; break;
    case "R^2": group = d("R") ** 2; break;
    case "R1^2+R2^2": group = d("R1") ** 2 + d("R2") ** 2; break;
    case "a^2+b^2": group = d("a") ** 2 + d("b") ** 2; break;
    case "3R^2+L^2": group = 3 * d("R") ** 2 + d("L") ** 2; break;
    default: return null;
  }
  if (!Number.isFinite(group) || !Number.isFinite(mass)) return null;
  return item.coeff * mass * group;
}

function renderInertiaCalculator(item, isTheorem) {
  const host = $("detail-calc");
  host.innerHTML = "";
  if (isTheorem || !item.dims) return;

  const values = { M: 1 };
  item.dims.forEach((dim) => { values[dim.key] = dim.default; });

  const output = document.createElement("div");
  output.className = "detail-calc__out";
  output.innerHTML = `<span>Moment of inertia</span><span></span>`;

  const refresh = () => {
    const I = inertiaValue(item, values.M, values);
    output.querySelector("span:last-child").textContent =
      I === null || !Number.isFinite(I) ? "—" : `${formatNumber(I)} kg·m²`;
  };

  const addRow = (key, label, unit, initial) => {
    const row = document.createElement("div");
    row.className = "detail-calc__row";
    const id = `inertia-in-${key}`;
    const lab = document.createElement("label");
    lab.htmlFor = id;
    lab.textContent = `${label} (${unit})`;
    const input = document.createElement("input");
    input.className = "field";
    input.id = id;
    input.type = "number";
    input.step = "any";
    input.min = "0";
    input.value = initial;
    input.max = "1e6";
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      // An upper bound as well as a lower one: 1e30 produced 8.3e88 kg·m²
      // with a straight face, which reads as a broken calculator.
      values[key] = Number.isFinite(v) && v > 0 && v <= 1e6 ? v : NaN;
      refresh();
    });
    row.append(lab, input);
    host.appendChild(row);
  };

  addRow("M", "Mass M", "kg", 1);
  item.dims.forEach((dim) => addRow(dim.key, dim.label, dim.unit, dim.default));
  host.appendChild(output);
  refresh();
}

function wireInertia() {
  $("btn-inertia-back").addEventListener("click", goChapters);
  $("btn-detail-back").addEventListener("click", openInertia);
  $("btn-detail-chapters").addEventListener("click", goChapters);
}

/* ============================================================================
   reference sheet
   ========================================================================== */

function renderReference() {
  // The chapter's number comes from its position in the index, so writing it
  // into the markup guarantees it goes stale the next time the order moves.
  const eyebrow = $("reference-eyebrow");
  const own = (state.config.chapters || []).find((c) => c.id === "cheatsheet");
  if (eyebrow && own) eyebrow.textContent = `Chapter ${own.num}`;
  const grid = $("reference-grid");
  grid.innerHTML = "";
  (state.config.reference || []).forEach((section) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <header class="card__head"><h3></h3><span class="card__weight"></span></header>
      <ul class="card__rows"></ul>`;
    card.querySelector("h3").textContent = section.unit;
    card.querySelector(".card__weight").textContent = section.weight;

    const rows = card.querySelector(".card__rows");
    section.rows.forEach((row) => {
      const li = document.createElement("li");
      if (row.kind) li.dataset.kind = row.kind;
      const label = document.createElement("b");
      label.textContent = row.label;
      const body = document.createElement("code");
      body.textContent = row.body;
      li.append(label, body);
      rows.appendChild(li);
    });
    grid.appendChild(card);
  });

  const src = state.config.referenceSource;
  if (src) {
    const note = $("reference-source");
    note.innerHTML = "";
    note.append(
      document.createTextNode("Adapted from "),
      Object.assign(document.createElement("em"), { textContent: src.title }),
      document.createTextNode(", published by ")
    );
    const link = document.createElement("a");
    link.href = src.url;
    link.textContent = src.publisher;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    note.append(link, document.createTextNode(". " + src.note));
  }
}

/* ============================================================================
   playground
   ========================================================================== */

function openPlayground(id) {
  if (id && SCENARIOS[id]) playSetScenario(id);
  showScreen("screen-play");
  playReset();
  renderPlayControls();
  syncPlayPanel();
  startPlayLoop();
  onPlayTick();
}

/* ============================================================================
   sandbox data analysis
   ========================================================================== */

/* The chart's controls are rebuilt whenever the apparatus changes, because the
   plottable quantities are derived from the scenario's own state bag. The
   previous selection is kept when the new scenario still offers it, so
   switching between two spring scenarios does not throw the reader back to
   the default axes. */
/* The experimental-design question does not ask a student to plot something.
   It asks WHAT to plot so the result is a straight line, and what the slope
   then means. These are the standard linearisations for the apparatus in this
   sandbox, named so a reader can try one rather than guess. */
const LINEARISATIONS = {
  projectile: [
    ["y against t²", "slope = −g/2, intercept = the launch height"],
    ["vᵧ against t", "slope = −g, straight for any launch"],
  ],
  rampSlide: [
    ["s against t²", "slope = a/2 = ½g(sinθ − μₖcosθ)"],
    ["v against t", "slope = the acceleration down the slope"],
  ],
  springHorizontal: [
    ["v² against x²", "a straight line of slope −k/m: energy conservation"],
    ["a against x", "slope = −ω², the definition of simple harmonic motion"],
  ],
  springVertical: [
    ["a against y", "slope = −k/m"],
  ],
  pendulum: [
    ["a against θ", "straight only for small θ — the approximation made visible"],
  ],
  orbit: [
    ["h against t", "flat: Kepler's second law, measured rather than asserted"],
    ["ε against t", "flat: the orbit's energy is conserved"],
  ],
  hohmann: [
    ["r against t", "the transfer ellipse, rising to apogee and levelling at the burn"],
  ],
  elevator: [
    ["v against t", "slope = the acceleration in each phase, in turn"],
  ],
  roundabout: [
    ["v against t", "slope = the tangential acceleration you set"],
  ],
  collision: [
    ["v₁ against t", "flat, then a step: all the change happens during the impact"],
  ],
  flywheel: [
    ["ω against t", "slope = α = τ/I while the torque is constant"],
  ],
  coaster: [
    ["v² against h", "slope = −2g: energy conservation on the track"],
  ],
};

/* Shown beneath the axis menus. Not a hint system -- the reader still has to
   choose and interpret -- but naming the standard plots is what turns a chart
   into the experimental-design exercise the exam sets. */
function renderLinearisationHints() {
  const host = $("pg-hints");
  if (!host) return;
  const list = LINEARISATIONS[Play.type];
  host.innerHTML = "";
  if (!list || !list.length) { host.hidden = true; return; }
  host.hidden = false;
  const intro = document.createElement("span");
  intro.className = "pg-hints__intro";
  intro.textContent = "Worth trying here:";
  host.appendChild(intro);
  list.forEach(([plot, meaning]) => {
    const li = document.createElement("span");
    li.className = "pg-hints__item";
    const b = document.createElement("b");
    b.textContent = plot;
    li.append(b, document.createTextNode(" — " + meaning));
    host.appendChild(li);
  });
}

function renderGraphControls() {
  if (typeof PlayGraph === "undefined") return;
  const channels = PlayGraph.channels();
  const current = PlayGraph.axes();

  const fill = (id, chosen) => {
    const sel = $(id);
    if (!sel) return;
    sel.innerHTML = "";
    channels.forEach((ch) => {
      const opt = document.createElement("option");
      opt.value = ch.key;
      opt.textContent = ch.unit ? `${ch.label} (${ch.unit})` : ch.label;
      sel.appendChild(opt);
    });
    if (channels.some((c) => c.key === chosen)) sel.value = chosen;
  };
  fill("pg-y", current.y);
  fill("pg-x", current.x);

  const tf = $("pg-tf");
  if (tf && !tf.dataset.filled) {
    PlayGraph.transforms().forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name === "none" ? "nothing (plot as measured)" : name;
      tf.appendChild(opt);
    });
    tf.dataset.filled = "1";
  }
}

/* Reported under the chart as well as on it, because a screen-reader user
   gets nothing from a canvas. Numbers only when the fit is real: the module
   withholds R² below three points and refuses a fit whose transform excluded
   the data, and this line has to be equally honest. */
function onPlayGraphPainted() {
  const el = $("pg-fit");
  if (!el || typeof PlayGraph === "undefined") return;
  const f = PlayGraph.fit();
  if (!f || f.reason) { el.textContent = f && f.reason ? f.reason : ""; return; }
  const parts = [`slope = ${formatNumber(f.slope)}`];
  if (PlayGraph.slopeUnit && PlayGraph.slopeUnit()) parts[0] += " " + PlayGraph.slopeUnit();
  parts.push(`intercept = ${formatNumber(f.intercept)}`);
  if (f.r2 !== null && f.r2 !== undefined) parts.push(`R² = ${f.r2.toFixed(6)}`);
  parts.push(`n = ${f.n}`);
  if (f.excluded) parts.push(`${f.excluded} excluded by the transform`);
  el.textContent = parts.join("   ·   ");
}

function wireGraphControls() {
  if (typeof PlayGraph === "undefined") return;
  const repaint = () => { paintPlayGraph(); };
  const onAxis = () => {
    PlayGraph.setAxes($("pg-y") && $("pg-x") ? $("pg-x").value : undefined,
                      $("pg-y") ? $("pg-y").value : undefined);
    repaint();
  };
  $("pg-x").addEventListener("change", onAxis);
  $("pg-y").addEventListener("change", onAxis);
  $("pg-tf").addEventListener("change", () => { PlayGraph.setTransform($("pg-tf").value); repaint(); });

  $("pg-csv").addEventListener("click", () => {
    const csv = PlayGraph.exportCSV();
    if (!csv) return;
    // A blob URL rather than a data: URI, because a long run's CSV exceeds
    // what a data: URI can carry in some browsers.
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mechanicsmania-${Play.type}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

function renderPlayControls() {
  const sc = SCENARIOS[Play.type];
  $("play-title").textContent = sc.label;
  $("play-group").textContent = sc.group || "";
  $("play-blurb").textContent = sc.blurb || "";
  $("play-canvas").setAttribute("aria-label", sc.ariaLabel);

  // The plottable quantities come from the scenario's own state bag, so the
  // menus have to be rebuilt whenever the apparatus does.
  renderGraphControls();
  renderLinearisationHints();

  const host = $("play-controls-host");
  host.innerHTML = "";
  sc.controls.forEach((control) => {
    const wrap = document.createElement("div");
    wrap.className = "play-field";
    const id = `play-ctl-${control.key}`;
    wrap.innerHTML = `<label for="${id}"><span></span><span class="play-field__val"></span></label>`;
    wrap.querySelector("label span").textContent = control.label;
    const readout = wrap.querySelector(".play-field__val");
    readout.textContent = `${Play.params[control.key].toFixed(decimalsFor(control.step))} ${control.unit}`;

    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = control.min; input.max = control.max; input.step = control.step;
    input.value = Play.params[control.key];
    input.addEventListener("input", () => {
      Play.params[control.key] = parseFloat(input.value);
      readout.textContent = `${Play.params[control.key].toFixed(decimalsFor(control.step))} ${control.unit}`;
      // Changing the apparatus invalidates any run in progress: the state on
      // screen was integrated under the old parameters, so it has to restart
      // rather than continue from a configuration that no longer exists.
      playReset();
      syncPlayPanel();
      playPaint();
      onPlayTick();
    });
    wrap.appendChild(input);
    host.appendChild(wrap);
  });
}

function syncPlayPanel() {
  const midRun = Play.started && !Play.finished;
  // Not every apparatus maps onto a solver chapter. Leaving the button live
  // where no hand-off exists meant clicking it did nothing at all — no
  // navigation, no message.
  // A scenario may say its current settings have moved past what the solver
  // chapter can model. Handing over anyway answers a different question --
  // and did so under a heading that contradicted the simulation.
  const route = SCENARIOS[Play.type].handoff;
  const blocked = route && route.available ? route.available(Play.params) : null;
  $("play-solve").hidden = !route;
  $("play-solve").disabled = !!blocked;
  const gate = $("play-handoff-note");
  if (gate) {
    gate.classList.toggle("hidden", !blocked);
    gate.textContent = blocked || "";
  }
  const stage = $("play-stage");
  if (stage) stage.setAttribute("aria-label", `Live simulation: ${SCENARIOS[Play.type].label}`);
  // A balanced apparatus -- equal Atwood masses, a block that will not slide,
  // zero torque -- is finished before it begins. Saying "Run again" then is a
  // lie about history, and running it armed a loop whose clock could never
  // move. Say what is actually true instead.
  const sc = SCENARIOS[Play.type];
  const isStatic = sc.isStatic ? sc.isStatic(Play.params) : false;
  const settled = isStatic && !Play.started;

  $("play-run").disabled = settled;
  $("play-run").textContent = settled
    ? "Nothing to run"
    : (Play.finished ? "Run again" : (midRun ? "Restart" : "Run"));

  // Pause is meaningful while running, Resume while paused part-way through.
  // It is only dead before the first run and after one finishes.
  $("play-pause").disabled = !Play.running && !midRun;
  $("play-pause").textContent = Play.running ? "Pause" : "Resume";

  const note = $("play-static-note");
  if (note) {
    note.classList.toggle("hidden", !settled);
    if (settled) note.textContent = staticReason(Play.type, Play.params);
  }
}

/* Why a configuration sits still. "Nothing happens" is only useful if the
   reader learns which balance is holding it there -- that balance is the
   physics of the scenario at its boundary. */
function staticReason(type, p) {
  switch (type) {
    case "atwood":
      return "The two masses are equal, so the tensions balance and ΣF = 0 on each side. Change one mass to make it move.";
    case "incline":
      return "tan θ is below μ, so static friction can match gravity's pull along the slope. Steepen the ramp or lower μ.";
    case "flywheel":
      return "With no applied torque there is no angular acceleration. Add torque to spin it up.";
    default:
      return "Every force on this configuration cancels, so nothing accelerates. Adjust a slider to unbalance it.";
  }
}

// Live numbers, refreshed each frame by the playground loop.
function onPlayTick() {
  if (document.querySelector(".screen.is-active")?.id !== "screen-play") return;
  const sc = SCENARIOS[Play.type];
  const rows = sc.readouts(Play.params, Play);

  rows.push(["Elapsed", `${Play.t.toFixed(2)} s`]);
  // A run that stops should say why. This was recorded and never read.
  if (Play.finished && Play.endedBecause) rows.push(["Ended", Play.endedBecause]);

  // The parity row compares the integrated state against the scenario's own
  // independent closed form. It is the evidence that the sandbox is solving
  // the equations rather than replaying a formula, so it is worth showing.
  if (sc.analytic && Number.isFinite(Play.maxDrift)) {
    rows.push(["Drift vs closed form", Play.maxDrift.toExponential(2)]);
  }

  const dl = $("play-readout");
  if (dl.children.length !== rows.length) {
    dl.innerHTML = rows.map(() => "<div><dt></dt><dd></dd></div>").join("");
  }
  rows.forEach((row, i) => {
    dl.children[i].querySelector("dt").textContent = row[0];
    dl.children[i].querySelector("dd").textContent = row[1];
  });
}

function wirePlayground() {
  $("btn-play").addEventListener("click", () => openPicker("play"));
  $("play-exit").addEventListener("click", () => openPicker("play"));

  // The corner dropdown that used to live here is gone. The index screen is
  // the only way in now, which is one control instead of two that had to be
  // kept in step -- and the one in the corner was the one nobody looked at.

  $("play-run").addEventListener("click", () => {
    playReset();
    // playReset marks a balanced configuration finished. Setting running on
    // top of that armed a requestAnimationFrame loop that re-armed itself
    // forever while playAdvance returned immediately.
    if (Play.finished) { syncPlayPanel(); playPaint(); onPlayTick(); return; }
    Play.running = true;
    Play.started = true;
    Play.lastFrame = null;

    // Reduced motion is handled inside resumePlayLoop, so every route in —
    // Run, Resume, anything later — respects it identically.
    resumePlayLoop();
    syncPlayPanel();
    playPaint();
    onPlayTick();
  });

  $("play-pause").addEventListener("click", () => {
    if (Play.running) pausePlayLoop();
    else { Play.running = true; resumePlayLoop(); }
    syncPlayPanel();
    onPlayTick();
  });

  $("play-reset").addEventListener("click", () => {
    playReset();
    syncPlayPanel();
    playPaint();
    onPlayTick();
  });

  // Each scenario declares its own hand-off, so the sandbox becomes a way of
  // authoring problems rather than a separate toy.
  $("play-solve").addEventListener("click", () => {
    const route = SCENARIOS[Play.type].handoff;
    if (!route) return;
    if (route.available && route.available(Play.params)) return;
    const chapter = state.config.chapters.find((c) => c.id === route.chapter);
    const flow = CHAPTER_FLOW[route.chapter];
    if (!chapter || !flow) return;

    const variantKey = typeof route.variant === "function" ? route.variant(Play.params) : route.variant;
    const variant = variantKey && flow.subtypes
      ? flow.subtypes.find((v) => v.key === variantKey)
      : null;

    state.history = [];
    state.chapter = chapter;
    state.flow = flow;
    state.variant = variant;
    state.solverKey = (variant && variant.solverKey) || flow.solverKey;
    state.varsKey = variant ? variant.key : flow.varsKey;
    state.variables = state.config.chapterVariables[state.varsKey] || [];
    state.known = route.knowns(Play.params);
    state.setupFn = null;
    pushHistory(openPlayground);
    renderQuantities();
    showScreen("screen-quantity");
    setProgress(0.5);
  });

}

/* ============================================================================
   minigames
   ----------------------------------------------------------------------------
   Two lab apparatus where the reader has to CALCULATE before anything happens.
   Unlike the sandbox, a number is committed first and the apparatus then
   either holds or visibly fails — which is the whole point: a prediction that
   was never made cannot be wrong, and cannot teach.
   ========================================================================== */

/* The balloon drop is a third apparatus with the same shape as the other two
   -- pose a problem, take a number, run the consequence -- but it arrived with
   its own API. Rather than edit either module, adapt it here, so the screen
   below has exactly one thing to talk to. */
const BALLOON_ID = "balloon-drop";

const PIG_ID = "flying-pig";

/* Which module owns which apparatus. Asking each module what it lists, rather
   than keeping a second copy of the ids here, means an apparatus can never be
   in the picker but unroutable -- which is how three Solve buttons went dead
   once, naming chapter ids that a restructure had renamed. */
/* Guard on the SHAPE, not on the name existing. A module whose file is absent
   leaves its global undefined, which `typeof` catches -- but a module whose
   file is half-written, or which threw partway through its own IIFE, leaves a
   global that is defined and useless. That second case took the whole
   minigame catalogue down with a TypeError, so the test is whether the thing
   can actually answer the calls the host is about to make. */
function mgUsable(mod) {
  return !!mod && typeof mod.list === "function"
    && typeof mod.start === "function" && typeof mod.submit === "function"
    && typeof mod.draw === "function";
}

function mgModules() {
  const named = [
    typeof RaceGames !== "undefined" ? RaceGames : null,
    typeof RampGames !== "undefined" ? RampGames : null,
    typeof TopicGames !== "undefined" ? TopicGames : null,
    typeof DemoGames !== "undefined" ? DemoGames : null,
  ];
  return named.filter((mod) => {
    if (!mod || mgUsable(mod)) return !!mod;
    // Say so once rather than failing silently: a module that loaded but does
    // not implement the contract is a bug worth seeing in the console.
    if (!mod.__warned) { mod.__warned = true; console.warn("Minigame module ignored: incomplete."); }
    return false;
  });
}

function mgModuleFor(id) {
  if (id === BALLOON_ID) return balloonAdapter;
  if (id === PIG_ID) return FlyingPig;
  for (const mod of mgModules()) {
    if (mod.list().some((g) => g.id === id)) return mod;
  }
  return MiniGames;
}

const balloonAdapter = {
  list: () => [{
    id: BALLOON_ID,
    group: "Kinematics",
    name: "Water balloon drop",
    blurb: "Dr. Jloane is walking under the bridge. Work out the moment to let go.",
  }],
  difficulties: () => (typeof BalloonDrop === "undefined"
    ? [] : BalloonDrop.LEVELS.map((l) => l.name)),

  start(_id, difficulty) {
    const levels = BalloonDrop.LEVELS;
    const found = levels.findIndex((l) => l.name === difficulty);
    return balloonAdapter._view(BalloonDrop.newRound(found >= 0 ? found + 1 : 1));
  },
  round: () => (BalloonDrop.round() ? balloonAdapter._view(BalloonDrop.round()) : null),

  // Its givens arrive as [label, value] pairs where the value already carries
  // its unit, so the unit column stays empty rather than repeating it.
  _view(rd) {
    if (!rd) return null;
    return {
      id: BALLOON_ID,
      prompt: rd.prompt,
      note: "Release time is measured from now. Answer either box — whichever your course asks for.",
      givens: (rd.givens || []).map((g) =>
        (Array.isArray(g) ? { label: g[0], value: g[1], unit: "" } : g)),
      inputs: [
        { key: "time", label: "Release after", unit: "s", step: "0.01" },
        { key: "distance", label: "…or Dr. Jloane is this far from the target", unit: "m", step: "0.01" },
      ],
    };
  },

  submit(answers) {
    // Either box is a complete answer, so grade whichever was filled and say
    // so rather than demanding both. `answers` is defaulted because the host
    // always builds an object, but every other module tolerates a bare call
    // and this one threw on it.
    const a = answers || {};
    const t = String(a.time ?? "").trim();
    const d = String(a.distance ?? "").trim();
    // A blank still carries a verdict, like every other module's does, so the
    // host never has to invent one.
    if (t === "" && d === "") return { correct: false, blank: true,
        verdict: { kind: "miss", text: "Nothing entered" },
        feedback: "Enter a number before you press Play.",
        misconception: null, solution: [], exact: {}, tolerance: {} };
    const useTime = t !== "";
    const r = BalloonDrop.submit(Number(useTime ? t : d), useTime ? "time" : "distance");
    if (r.error) return { correct: false, blank: true,
        verdict: { kind: "miss", text: "Nothing entered" },
        feedback: "Enter a number before you press Play.",
        misconception: null, solution: [], exact: {}, tolerance: {} };

    const solution = [
      `Fall time      t_fall = ${r.fallTime.toFixed(4)} s`,
      `Dr. Jloane arrives at  T = ${r.arrivalTime.toFixed(4)} s`,
      `Release at     t = T - t_fall = ${r.exactTime.toFixed(4)} s`,
      `At that moment they are ${r.exactDistance.toFixed(3)} m from the target`,
      `You released at ${r.releaseTime.toFixed(4)} s, missing by ${Math.abs(r.missBy).toFixed(3)} m`,
    ];
    return {
      correct: r.correct,
      blank: false,
      // The module already decided early-vs-late; forwarding it is the whole
      // job of this adapter. Dropping it here left the host inventing a
      // generic "Not quite" beside a verdict the apparatus had already made.
      verdict: r.verdict,
      exact: { time: r.exactTime, distance: r.exactDistance },
      tolerance: { time: r.toleranceTime, distance: r.tolerance },
      feedback: r.feedback,
      misconception: null,
      solution,
    };
  },

  play: () => BalloonDrop.play(),
  draw: (ctx, w, h) => BalloonDrop.draw(ctx, w, h),
  tick: (dt) => BalloonDrop.tick(dt),
  reset: () => BalloonDrop.reset(),
  animating: () => BalloonDrop.state().animating,
};

let mgHandle = null;
let mgLast = null;
let mgResizeObserver = null;
let mgGameId = null;
let mgDifficulty = "medium";

/* Every apparatus in one list, whichever module implements it. */
function mgCatalogue() {
  const list = MiniGames.list().slice();
  if (typeof BalloonDrop !== "undefined") list.push(...balloonAdapter.list());
  if (typeof FlyingPig !== "undefined") list.push(...FlyingPig.list());
  mgModules().forEach((mod) => list.push(...mod.list()));
  return list;
}

function mgSyncDifficulties(mod) {
  const sel = $("mg-difficulty");
  const levels = mod.difficulties(mgGameId) || [];
  const had = sel.value;
  sel.innerHTML = "";
  levels.forEach((d) => {
    const o = document.createElement("option");
    o.value = d; o.textContent = d;
    sel.appendChild(o);
  });
  // Keep the reader's choice when the new apparatus offers the same step.
  mgDifficulty = levels.includes(had) ? had : (levels[1] || levels[0] || "");
  sel.value = mgDifficulty;
  $("mg-difficulty-row").hidden = levels.length <= 1;
}

function mgPaint() {
  const canvas = $("mg-canvas");
  if (!canvas || typeof MiniGames === "undefined") return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr, h = canvas.height / dpr;
  ctx.clearRect(0, 0, w, h);
  mgModuleFor(mgGameId).draw(ctx, w, h);
  mgPaintVerdict(ctx, w, h);
}

function mgLoop(now) {
  const dt = mgLast === null ? 0 : (now - mgLast) / 1000;
  mgLast = now;
  const more = mgModuleFor(mgGameId).tick(dt);
  mgPaint();
  mgHandle = more ? requestAnimationFrame(mgLoop) : null;
}

function mgRelease() {
  if (mgHandle !== null) return;
  // Reduced motion still gets the outcome, just not the journey. The phase
  // machine caps itself, so this terminates.
  if (prefersReducedMotion()) {
    let guard = 0;
    while (mgModuleFor(mgGameId).tick(1 / 30) && guard++ < 400) { /* run it out */ }
    mgPaint();
    return;
  }
  mgLast = null;
  mgHandle = requestAnimationFrame(mgLoop);
}

function stopMiniLoop() {
  if (mgHandle) cancelAnimationFrame(mgHandle);
  mgHandle = null;
  if (mgResizeObserver) mgResizeObserver.disconnect();
  mgResizeObserver = null;
}

function openMinigames(id) {
  if (typeof MiniGames === "undefined") return;
  if (id) mgGameId = id;
  showScreen("screen-minigames");

  // Entry is through the index screen, which sets mgGameId before calling in.
  // Falling back to the first entry keeps a direct call honest.
  mgGameId = mgGameId || mgCatalogue()[0].id;

  // mgNewRound calls stopMiniLoop, which disconnects the observer -- so it has
  // to be created AFTER, or the canvas never resizes with its container.
  mgNewRound();

  const canvas = $("mg-canvas");
  mgResizeObserver = fitCanvasToParent(canvas, canvas.getContext("2d"));
  // A posed apparatus is a static drawing, so without this a theme switch
  // leaves it in the old palette until the reader submits.
  registerOneShot(canvas, mgPaint);
  mgPaint();
}

function mgNewRound() {
  stopMiniLoop();
  const mod = mgModuleFor(mgGameId);
  // Each apparatus names its own difficulty steps, so the menu is rebuilt
  // whenever the apparatus changes rather than assuming a shared ladder.
  mgSyncDifficulties(mod);
  const view = mod.start(mgGameId, mgDifficulty);
  if (!view) return;

  const meta = mgCatalogue().find((g) => g.id === mgGameId);
  $("mg-title").textContent = meta ? meta.name : "Minigame";
  $("mg-blurb").textContent = meta ? meta.blurb : "";
  $("mg-prompt").textContent = view.prompt || "";
  $("mg-note").textContent = view.note || "";

  const givens = $("mg-givens");
  givens.innerHTML = "";
  (view.givens || []).forEach((g) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = g.label;
    dd.textContent = g.unit ? `${g.value} ${g.unit}` : String(g.value);
    row.append(dt, dd);
    givens.appendChild(row);
  });

  const host = $("mg-inputs");
  host.innerHTML = "";
  (view.inputs || []).forEach((inp) => {
    const wrap = document.createElement("div");
    wrap.className = "play-field";
    const id = "mg-in-" + inp.key;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = inp.unit ? `${inp.label} (${inp.unit})` : inp.label;
    // Not every question is a number. "Which of these reaches the bottom
    // first?" has to be a choice, and squeezing it into a numeric box ("enter
    // 1, 2 or 3") tests reading comprehension rather than physics.
    let field;
    if (Array.isArray(inp.choices) && inp.choices.length) {
      field = document.createElement("select");
      field.className = "field";
      field.id = id;
      inp.choices.forEach((c) => {
        const o = document.createElement("option");
        o.value = String(c.value);
        o.textContent = c.label;
        field.appendChild(o);
      });
    } else {
      field = document.createElement("input");
      field.className = "field";
      field.type = "number";
      field.id = id;
      field.step = inp.step || "any";
      field.inputMode = "decimal";
    }
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $("mg-submit").click(); }
    });
    wrap.append(label, field);
    host.appendChild(wrap);
  });

  ["mg-verdict", "mg-feedback", "mg-misconception", "mg-solution", "mg-error"].forEach((id) => {
    $(id).textContent = "";
    $(id).classList.add("hidden");
  });
  mgGraded = false;
  mgLastVerdict = null;
  $("mg-submit").textContent = "Play";
  $("mg-submit").disabled = false;
  // Name the apparatus on the canvas, so a screen reader is not told
  // "Apparatus diagram" for all three.
  $("mg-canvas").setAttribute("aria-label",
    (meta ? meta.name + ". " : "") + (view.prompt || "Experiment diagram"));
  mgPaint();
  const first = host.querySelector("input");
  if (first) first.focus();
}

/* Once a round is graded the button stops being a submit control and becomes
   a replay control. Keeping it enabled is the point: a reader who got it wrong
   wants to watch the apparatus fail again, and often needs to. What it must
   NOT do is re-read the fields -- otherwise a reader could walk the number in
   until it lands, and a round that can be brute-forced teaches nothing. */
let mgGraded = false;

/* The one thing a reader looks for first is whether they hit it, and a verdict
   buried in the first clause of a paragraph is not that. It gets its own box,
   tinted by outcome. Every module supplies its own words -- "Balanced",
   "Tipped left", "Too early by 0.3 s" -- because the apparatus's own
   vocabulary carries more than a generic right/wrong would. */
/* The verdict is also painted onto the stage itself. A reader watching the
   apparatus run is looking AT the canvas, and making them break off to read a
   line in the side panel is the wrong way round -- the outcome belongs where
   the outcome happened. Held here rather than re-derived so the panel and the
   canvas can never disagree. */
let mgLastVerdict = null;

/* A frosted plate: the stage's own colour at low alpha, so it reads as a pane
   laid over the scene rather than a separate widget pasted on top. Only the
   rule and the text carry the outcome colour. */
function mgPaintVerdict(ctx, w, h) {
  if (!mgLastVerdict || !mgLastVerdict.text) return;
  // On a cramped stage the scene already fills the bottom strip -- the Atwood
  // mass labels and the spool's contact point both live there -- and an opaque
  // plate over them costs more than it gives. The side panel still shows the
  // verdict, so nothing is lost by standing down.
  if (!(w > 300 && h > 260)) return;
  const P = typeof PALETTE !== "undefined" ? PALETTE : null;
  if (!P) return;

  const TINT = { hit: P.forest, over: P.brass, under: P.brass, miss: P.crimson };
  const tint = TINT[mgLastVerdict.kind] || P.crimson;
  const text = mgLastVerdict.text;

  ctx.save();
  const size = Math.max(11, Math.min(15, w / 46));
  ctx.font = `600 ${size}px ${typeof FONT_LABEL !== "undefined" ? FONT_LABEL : "sans-serif"}`;
  const padX = 14, padY = 9;
  const tw = Math.min(ctx.measureText(text).width, w - 48);
  const bw = tw + padX * 2;
  const bh = size + padY * 2;
  const bx = (w - bw) / 2;
  const by = h - bh - 14;

  ctx.globalAlpha = 0.82;
  ctx.fillStyle = P.paper;
  if (typeof roundRectPath === "function") { roundRectPath(ctx, bx, by, bw, bh, 5); ctx.fill(); }
  else ctx.fillRect(bx, by, bw, bh);

  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.2;
  if (typeof roundRectPath === "function") { roundRectPath(ctx, bx, by, bw, bh, 5); ctx.stroke(); }
  else ctx.strokeRect(bx, by, bw, bh);

  // A thicker stub on the leading edge, matching the panel verdict's rule.
  ctx.globalAlpha = 1;
  ctx.fillStyle = tint;
  ctx.fillRect(bx, by + 3, 2.5, bh - 6);

  ctx.fillStyle = tint;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, by + bh / 2, w - 48);
  ctx.restore();
}

function mgRenderVerdict(r) {
  const el = $("mg-verdict");
  if (!el) return;
  const KINDS = ["hit", "over", "under", "miss"];
  const v = (r && r.verdict) || (r && r.correct
    ? { kind: "hit", text: "Direct hit" }
    : { kind: "miss", text: "Not quite" });
  const kind = KINDS.indexOf(v.kind) >= 0 ? v.kind : "miss";
  el.textContent = v.text || "";
  el.className = "mg-verdict mg-verdict--" + kind;
  el.classList.toggle("hidden", !v.text);
  mgLastVerdict = { kind, text: v.text || "" };
  mgPaint();
}

function mgSubmit() {
  const mod = mgModuleFor(mgGameId);
  const view = mod.round();
  if (!view) return;

  // Already graded: this press is a replay, not a re-submission.
  if (mgGraded) {
    if (mod.play) mod.play();
    mgRelease();
    return;
  }

  const answers = {};
  view.inputs.forEach((inp) => { answers[inp.key] = $("mg-in-" + inp.key).value; });

  const r = mod.submit(answers);
  if (r.blank) {
    // Nothing was entered, so the round is not lost -- say so and wait.
    showFieldError("mg-error", "Fill in every box before you press Play.");
    return;
  }
  showFieldError("mg-error", null);

  mgRenderVerdict(r);
  $("mg-feedback").textContent = r.feedback;
  $("mg-feedback").classList.remove("hidden");

  const mis = $("mg-misconception");
  if (r.misconception) {
    mis.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = r.misconception.label;
    mis.append(strong, document.createTextNode(r.misconception.detail));
    mis.classList.remove("hidden");
  } else {
    mis.classList.add("hidden");
  }

  const sol = $("mg-solution");
  sol.textContent = (r.solution || []).join("\n");
  sol.classList.toggle("hidden", !(r.solution && r.solution.length));

  // Move focus before locking anything, or it lands on <body> and a keyboard
  // reader loses their place.
  $("mg-next").focus();
  // The fields lock, not the button: the answer is committed, but the
  // apparatus can be watched as many times as the reader wants.
  mgGraded = true;
  $("mg-submit").textContent = "Replay";
  $("mg-submit").disabled = false;
  view.inputs.forEach((inp) => {
    const f = $("mg-in-" + inp.key);
    if (f) f.disabled = true;
  });
  // The balloon module separates grading from playing so the host can show the
  // verdict before the drop; the other two animate straight from submit().
  if (mod.play) mod.play();
  mgRelease();
}

function wireMinigames() {
  if (typeof MiniGames === "undefined") return;

  $("btn-minigames").addEventListener("click", () => openPicker("minigames"));
  $("pick-home").addEventListener("click", goHome);
  $("mg-difficulty").addEventListener("change", () => { mgDifficulty = $("mg-difficulty").value; mgNewRound(); });
  $("mg-submit").addEventListener("click", mgSubmit);
  $("mg-next").addEventListener("click", mgNewRound);
  $("mg-exit").addEventListener("click", () => { stopMiniLoop(); mgModuleFor(mgGameId).reset(); openPicker("minigames"); });
}

/* ============================================================================
   section index
   ----------------------------------------------------------------------------
   Both the sandbox and the minigames used to open straight into one apparatus
   with a dropdown in the corner, which hid everything else behind a control
   nobody looks at. They now open on a grid, the way the chapter index does, so
   what is available is the first thing a reader sees.
   ========================================================================== */

let pickKind = null;

function openPicker(kind) {
  pickKind = kind;
  const isPlay = kind === "play";
  $("pick-eyebrow").textContent = isPlay ? "Sandbox" : "Minigames";
  $("pick-title").textContent = isPlay ? "Choose a simulation" : "Choose a minigame";
  $("pick-sub").textContent = isPlay
    ? "Free play. Set the experiment up however you like and watch the equations run."
    : "Work the number out first, commit to it, then watch whether the physics agrees.";

  const host = $("pick-groups");
  host.innerHTML = "";

  // The sandbox groups by topic; the minigames are few enough to sit in one
  // list. Groups are seeded in the order below rather than in whatever order
  // the scenarios happen to be declared, so the index reads in the same
  // sequence as the chapters. Anything not named here falls in after.
  const GROUP_ORDER = [
    "Kinematics", "Forces & Newton's laws", "Momentum",
    "Energy & circular motion", "Rotation", "Oscillations", "Gravitation",
  ];
  const groups = new Map();
  if (isPlay) {
    const present = new Set(Object.values(SCENARIOS).map((sc) => sc.group || "Other"));
    GROUP_ORDER.forEach((g) => { if (present.has(g)) groups.set(g, []); });
    Object.entries(SCENARIOS).forEach(([id, sc]) => {
      const g = sc.group || "Other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ id, name: sc.label, blurb: sc.blurb });
    });
  } else {
    // Eighteen apparatus is too many for one undifferentiated list, so they
    // group the way the sandbox does. A module that does not declare a group
    // for a game falls in under "Other experiments" rather than vanishing.
    const MG_GROUP_ORDER = [
      "Kinematics", "Forces & Newton's laws", "Momentum",
      "Energy & circular motion", "Rotation", "Oscillations", "Gravitation",
      "Other experiments",
    ];
    const games = mgCatalogue().map((g) => ({
      id: g.id, name: g.name, blurb: g.blurb, group: g.group || "Other experiments",
    }));
    const present = new Set(games.map((g) => g.group));
    MG_GROUP_ORDER.forEach((t) => { if (present.has(t)) groups.set(t, []); });
    games.forEach((g) => {
      if (!groups.has(g.group)) groups.set(g.group, []);
      groups.get(g.group).push(g);
    });
  }

  let n = 0;
  groups.forEach((items, title) => {
    const sec = document.createElement("section");
    sec.className = "pick-group";
    const head = document.createElement("h2");
    head.className = "pick-group__title";
    head.textContent = title;
    const grid = document.createElement("div");
    grid.className = "pick-grid";
    items.forEach((item) => {
      n += 1;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "pick-card";
      const num = document.createElement("span");
      num.className = "pick-card__num";
      num.textContent = String(n).padStart(2, "0");
      const name = document.createElement("span");
      name.className = "pick-card__name";
      name.textContent = item.name;
      const blurb = document.createElement("span");
      blurb.className = "pick-card__blurb";
      blurb.textContent = item.blurb || "";
      card.append(num, name, blurb);
      card.addEventListener("click", () =>
        isPlay ? openPlayground(item.id) : openMinigames(item.id));
      grid.appendChild(card);
    });
    sec.append(head, grid);
    host.appendChild(sec);
  });

  showScreen("screen-pick");
}

/* ============================================================================
   founder
   ========================================================================== */

/* Profile handles the author has not supplied yet. A link that goes nowhere is
   worse than one that says it is coming, so these render disabled and say so
   until real URLs are dropped in here. */
const FOUNDER_LINKS = {
  github: "https://github.com/AbdullahZahir",
  linkedin: "https://www.linkedin.com/in/abdullah-zahir/",
  instagram: "https://instagram.com/azabdullahzahir",
};

function renderFounder() {
  let pending = 0;
  $$("#founder-socials .social").forEach((a) => {
    const url = FOUNDER_LINKS[a.dataset.social];
    if (url) {
      a.href = url;
      a.removeAttribute("data-pending");
      a.removeAttribute("aria-disabled");
    } else {
      pending += 1;
      a.href = "#";
      a.dataset.pending = "1";
      a.setAttribute("aria-disabled", "true");
      a.addEventListener("click", (e) => e.preventDefault(), { once: false });
    }
  });
  // There is no #founder-note element and there never was, so this message
   // could never appear. Every link is wired now, so the branch had nothing
   // left to say either -- warn where a developer would actually see it.
  if (pending) console.warn("FOUNDER_LINKS has unwired handles; those links are inert.");
}

function openFounder() {
  renderFounder();
  showScreen("screen-founder");
}

function wireFounder() {
  $("btn-founder").addEventListener("click", openFounder);
  $("btn-founder-back").addEventListener("click", goHome);
}

/* ============================================================================
   masthead
   ========================================================================== */

function wireMasthead() {
  $("btn-back").addEventListener("click", goBack);
  $("btn-restart").addEventListener("click", goHome);
  $("brand-home").addEventListener("click", goHome);
  // The chapter index hides the masthead, so without this the only way back
  // to the front page was reloading.
  $("btn-chapters-home").addEventListener("click", goHome);
}

init();
