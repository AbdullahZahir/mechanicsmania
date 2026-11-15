/* ============================================================================
   badges — eight unit badges and the Elite Four
   ----------------------------------------------------------------------------
   The structure is borrowed from a game most readers already know. Working
   through a unit in the solver earns that unit's badge, the way beating a gym
   does. The four LAB badges are the Elite Four: they are not earned by solving
   on paper at all, only by running the simulations and experiments.

     Unit badges  — solve one problem of EVERY type the unit holds.
     Elite Four   — Simulation, Experiment, Analysis, Mastery.

   Three rules this file keeps:

   1. A badge can never be unearnable because of a stale id. Every requirement
      is checked against the live configuration at start-up, and one that names
      a problem type which no longer exists is dropped with a console warning
      rather than left as a box nobody can tick.
   2. A badge, once earned, stays earned. Adding a problem type to a unit later
      must not reach back and take a badge off someone's shelf.
   3. Progress tracking must never be able to break the thing it tracks. Storage
      is wrapped, the host calls in through a guard, and if this file fails to
      load the solver, sandbox and experiments carry on exactly as before.

   Progress lives in this browser only (localStorage). There is no account and
   nothing is sent anywhere.
   ========================================================================== */

const Badges = (function () {
  const STORE_KEY = "mechanicsmania.badges.v1";

  /* The seven units, in the order the indexes list them. */
  const UNIT_ORDER = [
    "Kinematics", "Forces & Newton's laws", "Momentum", "Energy & circular motion",
    "Rotation", "Oscillations", "Gravitation",
  ];

  /* --- the eight unit badges --------------------------------------------------
     `needs` lists solver problem types by the same keys the chapter flow uses.
     Two chapters are not units of their own: the Calculus chapter's types are
     filed under the unit each one belongs to, and Classic Problem Types — the
     multi-concept exam scenarios — is the eighth and last badge, because that
     is where the other seven are put to use together. Every one of the solver's
     problem types appears below exactly once. */
  const GYMS = [
    { id: "kinematics", name: "Kinematics", icon: "i-arc",
      needs: ["kinematics", "relvel", "projectile", "calc_kinematics"] },
    { id: "forces", name: "Forces", icon: "i-ramp",
      needs: ["forces", "drag_linear", "drag_quadratic"] },
    { id: "momentum", name: "Momentum", icon: "i-collide",
      needs: ["momentum", "collisions_elastic", "collisions_inelastic",
              "collision2d_inelastic", "collision2d_general"] },
    { id: "energy", name: "Energy", icon: "i-bolt",
      needs: ["energy", "work_kinetic", "work_grav", "work_elastic", "work_general",
              "calc_workenergy", "calc_varforce"] },
    { id: "rotation", name: "Rotation", icon: "i-flywheel",
      needs: ["rotKinematics", "rotDynamics", "angmomentum", "statics", "calc_rotational"] },
    { id: "gravitation", name: "Gravitation", icon: "i-orbit",
      needs: ["gravitation", "orbital"] },
    { id: "oscillations", name: "Oscillations", icon: "i-pendulum",
      needs: ["osc_spring", "osc_pendulum", "osc_general", "springs_combo",
              "physical_pendulum", "calc_oscillations"] },
    { id: "classics", name: "The Classics", icon: "i-atwood",
      needs: ["atwood", "atwood_flywheel", "rolling_race", "loop_coaster",
              "ballistic_pendulum", "ramp", "blockstack", "elevator", "roundabout",
              "com", "banked"] },
  ];

  /* --- the Elite Four: one badge per kind of lab work -------------------------
     Targets are deliberately breadth targets. Running the same simulation
     seven times teaches nothing the first run did not; running one from every
     unit does. */
  const DATA_TARGET = 3;       // simulations linearised
  const MASTER_TARGET = 5;     // experiments hit on their hardest setting
  const ELITE = [
    { id: "lab-sim", name: "Simulation", icon: "i-sliders", elite: true,
      how: "Run a simulation from every unit in the sandbox." },
    { id: "lab-exp", name: "Experiment", icon: "i-target", elite: true,
      how: "Score a direct hit in an experiment from every unit." },
    { id: "lab-data", name: "Analysis", icon: "i-graph", elite: true,
      how: "Linearise a run: choose graph axes that give a straight-line fit "
        + "(R² of 0.99 or better) in " + DATA_TARGET + " different simulations." },
    { id: "lab-master", name: "Mastery", icon: "i-star", elite: true,
      how: "Score a direct hit on the hardest setting of " + MASTER_TARGET
        + " different experiments." },
  ];

  const ALL = GYMS.concat(ELITE);

  let ctx = null;          // { config, flow, scenarios, games } from the host
  let store = blankStore();
  let persistent = true;   // false once localStorage has refused us
  let toastQueue = [];
  let toastTimer = null;
  let resetArmed = null;

  /* --- storage ---------------------------------------------------------------- */

  function blankStore() {
    return { v: 1, solved: {}, sims: {}, hits: {}, fits: {}, earned: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return blankStore();
      const data = JSON.parse(raw);
      const out = blankStore();
      // Copy field by field: a hand-edited or older record must not be able to
      // hand the renderer an array where it expects a map.
      ["solved", "sims", "hits", "fits", "earned"].forEach((k) => {
        if (data && data[k] && typeof data[k] === "object" && !Array.isArray(data[k])) out[k] = data[k];
      });
      return out;
    } catch (err) {
      // Private browsing, a full quota, or a corrupted record. Carry on in
      // memory: the session still earns badges, they just will not persist.
      persistent = false;
      return blankStore();
    }
  }

  function save() {
    if (!persistent) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
    catch (err) { persistent = false; }
  }

  /* --- names, taken from the live app rather than copied here ----------------- */

  function labelFor(key) {
    if (!ctx) return key;
    const flow = ctx.flow || {};
    for (const id of Object.keys(flow)) {
      const subs = flow[id] && flow[id].subtypes;
      if (!subs) continue;
      const hit = subs.find((s) => s.key === key);
      if (hit) return hit.label;
    }
    const chapter = ((ctx.config && ctx.config.chapters) || []).find((c) => c.id === key);
    return chapter ? chapter.name : key;
  }

  function inUnitOrder(groups) {
    const seen = Array.from(new Set(groups.filter(Boolean)));
    const known = UNIT_ORDER.filter((u) => seen.indexOf(u) >= 0);
    return known.concat(seen.filter((g) => UNIT_ORDER.indexOf(g) < 0));
  }

  function simGroups() {
    const sc = (ctx && ctx.scenarios) || {};
    return inUnitOrder(Object.keys(sc).map((id) => sc[id].group));
  }

  function gameList() {
    try { return (ctx && typeof ctx.games === "function" ? ctx.games() : []) || []; }
    catch (err) { return []; }
  }

  function gameGroups() {
    return inUnitOrder(gameList().map((g) => g.group));
  }

  /* --- progress ----------------------------------------------------------------
     Every badge reduces to { done, total, todo[] }. The requirement is computed
     from the live app each time, so a simulation or experiment added later
     simply shows up in the count. */
  function progress(b) {
    let done = 0, total = 1, todo = [];

    if (!b.elite) {
      total = b.needs.length;
      b.needs.forEach((k) => { if (store.solved[k]) done++; else todo.push(labelFor(k)); });
    } else if (b.id === "lab-sim") {
      const sc = (ctx && ctx.scenarios) || {};
      const groups = simGroups();
      total = groups.length;
      groups.forEach((g) => {
        const ran = Object.keys(sc).some((id) => sc[id].group === g && store.sims[id]);
        if (ran) done++; else todo.push(g);
      });
    } else if (b.id === "lab-exp") {
      const games = gameList();
      const groups = gameGroups();
      total = groups.length;
      groups.forEach((g) => {
        const hit = games.some((x) => x.group === g && store.hits[x.id]);
        if (hit) done++; else todo.push(g);
      });
    } else if (b.id === "lab-data") {
      total = DATA_TARGET;
      done = Math.min(Object.keys(store.fits).length, total);
    } else if (b.id === "lab-master") {
      total = MASTER_TARGET;
      done = Math.min(Object.keys(store.hits).filter((id) => store.hits[id].top).length, total);
    }

    total = Math.max(total, 1);
    const earned = !!store.earned[b.id];
    return { done: earned ? total : Math.min(done, total), total, todo: earned ? [] : todo, earned };
  }

  /* Award anything newly complete. Returns nothing; the toast and the redraw
     are side effects, because every caller wants both. */
  function settle() {
    const fresh = [];
    ALL.forEach((b) => {
      if (store.earned[b.id]) return;
      const p = progress(b);
      if (p.total > 0 && p.done >= p.total) {
        store.earned[b.id] = Date.now();
        fresh.push(b);
      }
    });
    save();
    render();
    fresh.forEach((b) => toast(b));
    if (fresh.length && earnedCount() === ALL.length) toast(null);
  }

  function earnedCount() {
    return ALL.filter((b) => store.earned[b.id]).length;
  }

  /* --- what the host reports -------------------------------------------------- */

  function solved(varsKey) {
    if (!varsKey || store.solved[varsKey]) return;
    store.solved[varsKey] = true;
    settle();
  }

  function simRun(scenarioId) {
    if (!scenarioId || store.sims[scenarioId]) return;
    store.sims[scenarioId] = true;
    settle();
  }

  function hit(gameId, tierIndex, tierCount) {
    if (!gameId) return;
    const rec = store.hits[gameId] || {};
    const top = Number.isFinite(tierIndex) && Number.isFinite(tierCount)
      && tierCount > 0 && tierIndex === tierCount - 1;
    if (rec.any && (rec.top || !top)) return;      // nothing new to record
    rec.any = true;
    if (top) rec.top = true;
    store.hits[gameId] = rec;
    settle();
  }

  function linearised(scenarioId) {
    if (!scenarioId || store.fits[scenarioId]) return;
    store.fits[scenarioId] = true;
    settle();
  }

  /* --- drawing ----------------------------------------------------------------
     One medallion, used at 22 px in the strip and 46 px in the case. Unit
     badges are round; the Elite Four are hexagons, so the two sets read apart
     even at the size of a favicon. The ring fills as the badge is worked
     towards, which makes the strip a progress display and not just a tally. */
  const HEX = "M20 2.5 35.16 11.25V28.75L20 37.5 4.84 28.75V11.25Z";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function statusText(b, p) {
    return p.earned ? b.name + " badge — earned"
      : b.name + " badge — " + p.done + " of " + p.total;
  }

  function medallion(b, p, size) {
    const pct = p.earned ? 100 : Math.round((100 * p.done) / p.total);
    const dash = 'pathLength="100" style="stroke-dasharray:' + pct + ' 100"';
    const shape = b.elite
      ? '<path class="badge__plate" d="' + HEX + '"/><path class="badge__ring" d="' + HEX + '" ' + dash + "/>"
      : '<circle class="badge__plate" cx="20" cy="20" r="17.5"/>'
        + '<circle class="badge__ring" cx="20" cy="20" r="17.5" transform="rotate(-90 20 20)" ' + dash + "/>";
    return '<svg class="badge ' + (b.elite ? "badge--elite" : "badge--gym") + (p.earned ? " is-earned" : "")
      + '" viewBox="0 0 40 40" width="' + size + '" height="' + size + '" role="img" aria-label="'
      + esc(statusText(b, p)) + '"><title>' + esc(statusText(b, p)) + "</title>" + shape
      + '<use class="badge__icon" href="#' + b.icon + '" x="10" y="10" width="20" height="20"/></svg>';
  }

  function el(id) { return document.getElementById(id); }

  function renderStrip() {
    const strip = el("badge-strip");
    if (!strip) return;
    const n = earnedCount();
    const champion = n === ALL.length;
    const set = (list) => '<span class="badge-strip__set">'
      + list.map((b) => medallion(b, progress(b), 22)).join("") + "</span>";
    strip.innerHTML = set(GYMS) + '<span class="badge-strip__sep" aria-hidden="true"></span>' + set(ELITE)
      + '<span class="badge-strip__count">' + (champion ? "Champion" : n + "/" + ALL.length) + "</span>";
    strip.classList.toggle("is-champion", champion);
    strip.setAttribute("aria-label", "Badges: " + n + " of " + ALL.length
      + " earned. Open the badge case.");
  }

  function card(b) {
    const p = progress(b);
    const sub = b.elite ? b.how
      : "Solve one problem of every type in the unit.";
    let state;
    if (p.earned) state = '<span class="badge-card__state is-earned">Earned</span>';
    else state = '<span class="badge-card__state">' + p.done + " of " + p.total + "</span>";
    const todo = p.todo.length
      ? '<p class="badge-card__todo"><span>Still to do</span> ' + p.todo.map(esc).join(" · ") + "</p>"
      : "";
    return '<li class="badge-card' + (p.earned ? " is-earned" : "") + '">'
      + medallion(b, p, 46)
      + '<div class="badge-card__body"><div class="badge-card__head"><h4>' + esc(b.name) + "</h4>" + state + "</div>"
      + '<p class="badge-card__how">' + esc(sub) + "</p>" + todo + "</div></li>";
  }

  function renderCase() {
    const body = el("badge-case-body");
    if (!body) return;
    const n = earnedCount();
    const champion = n === ALL.length;
    el("badge-case-sub").textContent = champion
      ? "All twelve. Champion of MechanicsMania."
      : n + " of " + ALL.length + " earned. Eight unit badges from the solver, then the Elite Four from the lab.";
    body.innerHTML =
      '<section><h3 class="badge-case__section">Unit badges</h3><ul class="badge-grid">'
      + GYMS.map(card).join("") + "</ul></section>"
      + '<section><h3 class="badge-case__section">The Elite Four <span>earned in the lab</span></h3>'
      + '<ul class="badge-grid">' + ELITE.map(card).join("") + "</ul></section>";
    const note = el("badge-case-note");
    if (note) {
      note.textContent = persistent
        ? "Progress is kept in this browser only."
        : "This browser is not allowing saved data, so badges last until the tab is closed.";
    }
  }

  function render() {
    renderStrip();
    const dlg = el("badge-case");
    if (dlg && dlg.open) renderCase();
  }

  /* --- the toast ---------------------------------------------------------------
     Queued rather than stacked: finishing one solve can complete a unit badge
     and, rarely, the whole set at once, and two notices drawn on top of each
     other announce neither. */
  function toast(b) {
    toastQueue.push(b);
    if (!toastTimer) nextToast();
  }

  function nextToast() {
    const box = el("badge-toast");
    if (!box) { toastQueue = []; return; }
    if (!toastQueue.length) {
      box.classList.remove("is-shown");
      toastTimer = null;
      return;
    }
    const b = toastQueue.shift();
    // The medallion is hidden from assistive technology here: its own label
    // would be read out on top of the words beside it, announcing the badge twice.
    box.innerHTML = b
      ? '<span aria-hidden="true">' + medallion(b, progress(b), 34) + "</span><div><strong>Badge earned</strong><span>"
        + esc(b.name) + (b.elite ? " · Elite Four" : "") + "</span></div>"
      : "<div><strong>Champion</strong><span>All twelve badges earned.</span></div>";
    box.classList.add("is-shown");
    toastTimer = setTimeout(nextToast, 3600);
  }

  /* --- where the strip lives ----------------------------------------------------
     Most screens have no masthead, so the strip sits in its own slim rail at
     the top left. On the screens that do, it moves INTO the masthead rather
     than stacking a second bar above it. One element, moved; never two copies
     to keep in step. */
  function place(mastheadVisible) {
    const strip = el("badge-strip"), rail = el("badge-rail"), slot = el("badge-slot");
    if (!strip || !rail || !slot) return;
    const target = mastheadVisible ? slot : rail;
    if (strip.parentNode !== target) target.appendChild(strip);
    rail.hidden = !!mastheadVisible;
  }

  /* --- wiring ----------------------------------------------------------------- */

  function disarmReset() {
    const btn = el("badge-reset");
    if (resetArmed) { clearTimeout(resetArmed); resetArmed = null; }
    if (btn) btn.textContent = "Reset progress";
  }

  function init(context) {
    ctx = context || {};
    store = load();

    // Rule 1: drop any requirement the live configuration does not know.
    const known = (ctx.config && ctx.config.chapterVariables) || null;
    if (known) {
      GYMS.forEach((b) => {
        b.needs = b.needs.filter((k) => {
          if (known[k]) return true;
          console.warn('Badges: "' + b.name + '" named a problem type that no longer exists (' + k + "); dropped.");
          return false;
        });
      });
    }

    const strip = el("badge-strip"), dlg = el("badge-case");
    if (strip && dlg) {
      strip.addEventListener("click", () => {
        renderCase();
        disarmReset();
        if (typeof dlg.showModal === "function") dlg.showModal();
        else dlg.setAttribute("open", "");            // very old browsers: still readable
      });
      const close = el("badge-case-close");
      if (close) close.addEventListener("click", () => dlg.close());
      // A click on the backdrop lands on the dialog element itself.
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

      const reset = el("badge-reset");
      if (reset) {
        // Two presses, not a confirm() box: erasing weeks of work deserves a
        // second thought, but a modal on top of a modal is its own problem.
        reset.addEventListener("click", () => {
          if (!resetArmed) {
            reset.textContent = "Press again to erase every badge";
            resetArmed = setTimeout(disarmReset, 4000);
            return;
          }
          disarmReset();
          store = blankStore();
          save();
          render();
        });
      }
    }

    // Anything already complete in a stored record (or completed by a change
    // to the requirements) is awarded quietly on load, without a toast.
    ALL.forEach((b) => {
      if (store.earned[b.id]) return;
      const p = progress(b);
      if (p.done >= p.total) store.earned[b.id] = Date.now();
    });
    save();
    render();
  }

  return {
    init, place,
    solved, simRun, hit, linearised,
    // read-only views, for tests and for anything that wants to show progress
    list: () => ALL.map((b) => Object.assign({ id: b.id, name: b.name, elite: !!b.elite }, progress(b))),
    earnedCount,
    total: () => ALL.length,
  };
})();
