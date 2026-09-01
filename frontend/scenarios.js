/* Gravitational acceleration, owned by the backend and delivered by
 * /api/config. The value below is only a placeholder for the instant before
 * that response lands. Nothing in the frontend may hardcode its own g: the
 * setup wizard feeds `weight` straight into the solver, so a divergence here
 * would produce genuinely wrong answers rather than merely odd drawings. */
let GRAVITY = 9.8;

function setGravity(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
  GRAVITY = value;
  onGravityChanged();
}

/* Newton's constant travels the same way and for the same reason. It was
 * hardcoded in three separate frontend places, so changing the backend value
 * would have left the gravitation chapter's substitution line disagreeing
 * with the answer printed directly beside it. */
let GRAV_CONSTANT = 6.674e-11;

function setGravConstant(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
  GRAV_CONSTANT = value;
}

/*
 * Scenario "wording shortcut" wizards, ported from the valuesFromWording*()
 * functions in mechanicscalculator.py. Each is a JS generator: it yields a
 * question descriptor and receives the user's answer via .next(answer),
 * mutating the shared `knowns` object exactly like the original script did.
 *
 * knowns[var] === undefined  -> never touched, ask normally later
 * knowns[var] === null       -> explicitly "not directly known", skip asking
 * knowns[var] === <number>   -> known value
 */

function* kinematicsScenario(knowns) {
  const constVel = yield { type: "yesno", text: "Does the object have a constant velocity?" };
  if (constVel) {
    knowns.a = 0;
    yield { type: "info", text: "Constant velocity means the acceleration is zero, and the initial and final velocities are equal." };

    const zero = yield { type: "yesno", text: "Is that constant velocity zero?" };
    if (zero) {
      // A body at rest also has zero displacement. Leaving d unset invited a
      // student to enter "10 m" for an object that never moves, after which
      // the problem became unsolvable for a reason the app could not explain.
      knowns.v = 0;
      knowns.vi = 0;
      knowns.vf = 0;
      knowns.d = 0;
      yield {
        type: "info",
        text: "Then the object is at rest: every velocity is zero, and so is the displacement. Time is the one thing a stationary object leaves undetermined, since any duration fits, so choose something other than time to solve for.",
      };
    } else {
      // Not moving at zero, so vi and vf are equal but unknown -- record them
      // as "no direct value" rather than as numbers.
      knowns.vi = null;
      knowns.vf = null;
    }
    return;
  }
  const anyRest = yield { type: "yesno", text: "Is the initial or final velocity of this object at rest?" };
  if (anyRest) {
    if (yield { type: "yesno", text: "Is the Initial Velocity of the object at rest?" }) {
      knowns.vi = 0;
      yield { type: "info", text: "Your initial velocity of the object is 0!" };
    }
    if (yield { type: "yesno", text: "Is the Final Velocity of the object at rest?" }) {
      knowns.vf = 0;
      yield { type: "info", text: "Your final velocity of the object is 0!" };
    }
  }
}

function* forcesScenario(knowns) {
  const mass = yield {
    type: "number",
    text: "What is the mass of the object? (kg)",
    validate: (v) => (Number.isFinite(v) && v > 0 ? null : "Mass has to be greater than zero."),
  };
  knowns.mass = mass;
  const weight = mass * GRAVITY;
  knowns.weight = weight;
  yield { type: "info", text: `Its weight is ${formatNumber(weight)} N.` };

  const constVel = yield { type: "yesno", text: "Does your object have a constant velocity?" };
  if (constVel) {
    // Constant velocity means the forces BALANCE, not that they vanish. A
    // crate pushed at steady speed has a large applied force and an equally
    // large friction force. Zeroing them individually would be the classic
    // "motion requires a force" misconception, and would hand back Ff = 0 for
    // a problem whose whole point is that Ff = Fa.
    knowns.Fnet = 0;
    knowns.a = 0;
    yield { type: "info", text: "Then the net force and the acceleration are both zero. Any applied force is exactly balanced by friction, so neither one is necessarily zero on its own." };
  }
  const freeFall = yield { type: "yesno", text: "Is your object in free fall?" };
  if (freeFall) {
    knowns.Fn = 0;
    knowns.Ff = 0;
    knowns.mu = 0;
    knowns.Fa = 0;
    knowns.Fnet = weight;
    yield { type: "info", text: `Your net force is ${formatNumber(weight)} N!` };
    return;
  }
  // A surface is flat or angled, never both. Asking the two questions
  // independently let a student answer "yes" to each, at which point the app
  // announced it could not handle a ramp and then quietly solved a flat-ground
  // problem anyway, with Fn = mg still set. Branching makes the two mutually
  // exclusive, so the state can never contradict what the student was told.
  const flat = yield {
    type: "yesno",
    text: "Is your object on a flat, horizontal surface (not moving up or down)?",
  };
  if (flat) {
    knowns.Fn = weight;
    yield {
      type: "info",
      text: `On level ground with no vertical motion, the normal force balances the weight exactly, so Fn = ${formatNumber(weight)} N.`,
    };
    return;
  }

  const angled = yield { type: "yesno", text: "Is it on an angled ramp instead?" };
  if (angled) {
    // Deliberately leave Fn unset: on a ramp Fn = mg·cos(theta), not mg, and
    // asserting the flat-ground value here would be simply wrong.
    yield {
      type: "info",
      text: "On a ramp the normal force is mg·cos(θ), not mg, and friction acts along the slope. This chapter does not resolve those components for you, so leave the normal force blank unless you have worked it out yourself.",
    };
  }
}

function* collisionsElasticScenario(knowns) {
  const anyRest = yield { type: "yesno", text: "Are any of the initial or final velocities at rest?" };
  if (anyRest) {
    if (yield { type: "yesno", text: "Is the Initial Velocity of the first object at rest?" }) knowns.v1i = 0;
    if (yield { type: "yesno", text: "Is the Initial Velocity of the second object at rest?" }) knowns.v2i = 0;
    if (yield { type: "yesno", text: "Is the Final Velocity of the first object at rest?" }) knowns.v1f = 0;
    if (yield { type: "yesno", text: "Is the Final Velocity of the second object at rest?" }) knowns.v2f = 0;
    if (knowns.v1i === 0 && knowns.v2i === 0) {
      yield { type: "info", text: "Both initial velocities cannot be 0, or a collision did not occur -- double check your setup!" };
    }
  }
}

function* collisionsInelasticScenario(knowns) {
  const any = yield { type: "yesno", text: "Are there any initial velocities, or is the final velocity, at rest?" };
  if (any) {
    if (yield { type: "yesno", text: "Is the Initial Velocity of the first object at rest?" }) knowns.v1i = 0;
    if (yield { type: "yesno", text: "Is the Initial Velocity of the second object at rest?" }) knowns.v2i = 0;
    if (yield { type: "yesno", text: "Is the final velocity of the combined objects at rest?" }) knowns.vf = 0;
  }
}

function* energyScenario(knowns) {
  const spring = yield { type: "yesno", text: "Does the object in your system interact with a spring?" };
  if (!spring) {
    knowns.Uspring = null;
    knowns.dspring = null;
    knowns.Fspring = null;
    knowns.k = null;
    yield { type: "info", text: "There is no elastic potential energy or spring force in your system!" };
  }
  const earth = yield { type: "yesno", text: "Is Earth a part of your system?" };
  if (earth) {
    const originLine = yield { type: "yesno", text: "Is your object on the set y-origin line (y = 0)?" };
    if (originLine) {
      knowns.dy = 0;
      knowns.Ug = null;
      yield { type: "info", text: "There is no gravitational potential energy in your system!" };
    }
  } else {
    knowns.dy = 0;
    knowns.Ug = null;
    yield { type: "info", text: "There is no gravitational potential energy in your system!" };
  }
  const moving = yield { type: "yesno", text: "Is the object in your system moving?" };
  if (!moving) {
    knowns.v = 0;
    knowns.KE = null;
    yield { type: "info", text: "There is no kinetic energy in your system!" };
  }
}

function* workKineticScenario(knowns) {
  if (yield { type: "yesno", text: "Is the object in your system at rest initially?" }) {
    knowns.KEi = 0;
    knowns.vi = 0;
    yield { type: "info", text: "You do not have any initial kinetic energy!" };
  }
  if (yield { type: "yesno", text: "Is the object's final velocity in your system at rest?" }) {
    knowns.KEf = 0;
    knowns.vf = 0;
    yield { type: "info", text: "You do not have any final kinetic energy!" };
  }
  if (knowns.KEf === 0 && knowns.KEi === 0) {
    knowns.KW = 0;
    yield { type: "info", text: "You do not have any work with Kinetic Energy!" };
  }
}

function* workGravScenario(knowns) {
  if (yield { type: "yesno", text: "Is your object on the y-origin line (y = 0) initially?" }) {
    knowns.Ugi = 0;
    knowns.dyi = 0;
  }
  if (yield { type: "yesno", text: "Is the object's final position on the y-origin line (y = 0)?" }) {
    knowns.Ugf = 0;
    knowns.dyf = 0;
  }
  if (knowns.Ugf === 0 && knowns.Ugi === 0) {
    yield { type: "info", text: "You do not have any work with Gravitational Potential Energy!" };
  }
}

function* workElasticScenario(knowns) {
  if (yield { type: "yesno", text: "Is your spring initially at rest?" }) {
    knowns.Uspringi = 0;
    knowns.dspringi = 0;
  }
  if (yield { type: "yesno", text: "Is your spring's final position at rest?" }) {
    knowns.Uspringf = 0;
    knowns.dspringf = 0;
  }
  if (knowns.Uspringi === 0 && knowns.Uspringf === 0) {
    yield { type: "info", text: "You do not have any work with Elastic Potential Energy!" };
  }
}

function* workGeneralScenario(knowns) {
  if (yield { type: "yesno", text: "Is a force applied at an angle to the direction of displacement?" }) {
    const theta = yield { type: "number", text: "What is the angle, in degrees?" };
    knowns.costheta = Math.cos((theta * Math.PI) / 180);
  }
}

function* rotKinematicsScenario(knowns) {
  const constOmega = yield { type: "yesno", text: "Does the object have a constant angular velocity (no angular acceleration)?" };
  if (constOmega) {
    knowns.alpha = 0;
    yield { type: "info", text: "Your angular acceleration is 0!" };
    const zero = yield { type: "yesno", text: "Is the constant angular velocity at zero?" };
    if (zero) {
      knowns.omega = 0;
      knowns.omega_i = 0;
      knowns.omega_f = 0;
      yield { type: "info", text: "Your angular velocity is 0!" };
    }
    return;
  }
  const anyRest = yield { type: "yesno", text: "Is the initial or final angular velocity of this object at rest (zero)?" };
  if (anyRest) {
    if (yield { type: "yesno", text: "Is the Initial Angular Velocity (ωi) at rest?" }) {
      knowns.omega_i = 0;
      yield { type: "info", text: "Your initial angular velocity is 0!" };
    }
    if (yield { type: "yesno", text: "Is the Final Angular Velocity (ωf) at rest?" }) {
      knowns.omega_f = 0;
      yield { type: "info", text: "Your final angular velocity is 0!" };
    }
  }
}

function* rotDynamicsScenario(knowns) {
  if (yield { type: "yesno", text: "Is the object initially at rest (angular velocity = 0) rotationally?" }) {
    knowns.omega_dyn = 0;
    knowns.Li = 0;
    yield { type: "info", text: "Your initial angular velocity and initial angular momentum are 0!" };
  }
  if (yield { type: "yesno", text: "Is there no net torque acting on this system (conservation of angular momentum applies)?" }) {
    yield {
      type: "info",
      text: "Conservation of Angular Momentum applies: Li = Lf. You'll need either Li & Lf, or I & ω for each state.",
    };
  }
}

function* oscillationsScenario(knowns) {
  if (yield { type: "yesno", text: "Does the oscillation start at maximum displacement (released from rest at amplitude, so φ = 0)?" }) {
    knowns.phi = 0;
    yield { type: "info", text: "Your phase constant (φ) is 0! x(t) = A·cos(ωt)" };
  }
  if (yield { type: "yesno", text: "Does the oscillation start at equilibrium with maximum velocity (x = 0 at t = 0, so φ = π/2)?" }) {
    knowns.phi = Math.PI / 2;
    yield { type: "info", text: "Your phase constant (φ) is π/2 ≈ 1.571 rad! x(t) = A·cos(ωt + π/2) = -A·sin(ωt)" };
  }
}

function* calcWorkEnergyScenario(knowns) {
  if (yield { type: "yesno", text: "Is a force applied at an angle to the displacement?" }) {
    const theta = yield { type: "number", text: "What is the angle, in degrees?" };
    knowns.costheta = Math.cos((theta * Math.PI) / 180);
  }
}

/* ---------------------------------------------------------------------- */
/* Chapter flow configuration                                             */
/* ---------------------------------------------------------------------- */

/* Orbital problems almost always name a familiar central body, and the two
 * numbers a student then has to look up -- its mass and its radius -- are the
 * two they are most likely to get wrong or conflate. Offering them directly
 * also lets the wizard settle the radius-versus-altitude question, which is
 * where satellite problems go wrong more often than anywhere else. */
const CENTRAL_BODIES = {
  earth: { label: "Earth", M: 5.972e24, R: 6.371e6 },
  moon: { label: "the Moon", M: 7.342e22, R: 1.7374e6 },
  mars: { label: "Mars", M: 6.417e23, R: 3.3895e6 },
  sun: { label: "the Sun", M: 1.989e30, R: 6.9634e8 },
};

function* orbitalScenario(knowns) {
  const useEarth = yield {
    type: "yesno",
    text: "Is the central body the Earth?",
  };
  if (useEarth) {
    knowns.M_central = CENTRAL_BODIES.earth.M;
    knowns.R_body = CENTRAL_BODIES.earth.R;
    yield {
      type: "info",
      text: "Using M = 5.972×10²⁴ kg and R = 6371 km for the Earth.",
    };
  }

  const fromAltitude = yield {
    type: "yesno",
    text: "Is the orbit given as an altitude above the surface, rather than a distance from the centre?",
  };
  if (fromAltitude) {
    yield {
      type: "info",
      // This is the single most common slip in a satellite problem, so it is
      // worth saying out loud rather than silently adding the two numbers.
      text: "Then the orbital radius is r = R_body + altitude. Every orbital formula measures r from the CENTRE of the central body, never from its surface.",
    };
  }

  const circular = yield {
    type: "yesno",
    text: "Is the orbit circular?",
  };
  if (circular) {
    knowns.e_orb = 0;
    yield {
      type: "info",
      // a = r for a circle, which is what makes Kepler III and vis-viva
      // collapse to the familiar circular forms.
      text: "A circle is the ellipse with e = 0, so the semi-major axis equals the orbital radius and perihelion equals aphelion.",
    };
  }
}

/* The ramp wizard's whole job is to settle which friction regime applies,
 * because the algebra differs: a stationary block uses the static INEQUALITY,
 * a sliding one uses f = mu_k*N as an equality. Asking up front stops the
 * reader from having to notice the distinction unprompted. */
function* rampScenario(knowns) {
  const frictionless = yield {
    type: "yesno",
    text: "Is the ramp frictionless?",
  };
  if (frictionless) {
    knowns.mu_s_r = 0;
    knowns.mu_k_r = 0;
    yield {
      type: "info",
      text: "Then the only force along the slope is mg·sinθ, so the acceleration is g·sinθ whatever the block weighs.",
    };
  } else {
    const sliding = yield {
      type: "yesno",
      text: "Is the block already sliding?",
    };
    // Record it. Asking which regime applies and then throwing the answer away
    // left the solver guessing at the very thing the question settled.
    if (sliding) knowns.v0_r = knowns.v0_r ?? 0.001;
    yield {
      type: "info",
      text: sliding
        ? "Sliding, so kinetic friction applies: f = μₖN, constant and opposing the motion."
        : "At rest, so STATIC friction applies: fₛ ≤ μₛN. It supplies exactly what is needed to hold the block, up to that ceiling — it is not automatically μₛN.",
    };
  }

  const pushed = yield {
    type: "yesno",
    text: "Is anything pushing or pulling the block along the slope?",
  };
  if (!pushed) {
    knowns.Fa_r = 0;
    yield {
      type: "info",
      text: "Then gravity and friction are the only forces along the surface.",
    };
  }
}

/* The lift wizard exists to separate DIRECTION OF TRAVEL from DIRECTION OF
 * ACCELERATION, which is the whole difficulty of the topic. A lift slowing on
 * the way down is accelerating upward, and a reader who has just said "going
 * down" will not usually see that. */
function* elevatorScenario(knowns) {
  const step = yield {
    type: "yesno",
    text: "Is the elevator moving at a constant speed (or standing still)?",
  };
  if (step) {
    knowns.a_elev = 0;
    yield {
      type: "info",
      text: "Then there is no acceleration, so the floor pushes with exactly mg and the scale reads your true weight. Moving is not the same as accelerating.",
    };
    return;
  }
  const freefall = yield {
    type: "yesno",
    text: "Is the cable cut — is it in free fall?",
  };
  if (freefall) {
    knowns.a_elev = -GRAVITY;
    yield {
      type: "info",
      text: "In free fall the floor supplies nothing at all: N = 0, and the rider floats. Their weight has not changed — only the normal force has.",
    };
    return;
  }
  yield {
    type: "info",
    text: "Take UP as positive. Accelerating upward (or slowing while descending) makes the scale read high; accelerating downward makes it read low.",
  };
}

const CHAPTER_FLOW = {
  kinematics: {
    visual: "linear-motion",
    subtypes: [
      { key: "kinematics", solverKey: "kinematics", label: "Straight-Line Motion", icon: "i-run",
        desc: "One body on one axis under constant acceleration: displacement, velocity, acceleration and time.",
        scenario: kinematicsScenario },
      { key: "relvel", solverKey: "relvel", visual: "relative-velocity", label: "Relative Velocity & Reference Frames", icon: "i-wave",
        desc: "Motion measured from a frame that is itself moving \u2014 a boat in a current, or one body's velocity as seen from another.",
        scenario: null },
    ],
  },
  projectile: { solverKey: "projectile", varsKey: "projectile", scenario: null, visual: "projectile" },
  // Relative velocity is a kinematics idea, but the river crossing is a
  // distinct enough apparatus to deserve its own entry rather than a subtype.
  forces: {
    visual: "forces",
    subtypes: [
      { key: "forces", solverKey: "forces", label: "Newton's Laws & Friction", icon: "i-balance",
        desc: "Net force, mass and acceleration, with the normal force and friction that come with contact.",
        scenario: forcesScenario },
      { key: "drag_linear", solverKey: "drag_linear", visual: "drag", label: "Linear Drag", icon: "i-run",
        desc: "Resistance proportional to speed. The body approaches a terminal velocity exponentially and never quite arrives.",
        scenario: null },
      { key: "drag_quadratic", solverKey: "drag_quadratic", visual: "drag", label: "Quadratic Drag", icon: "i-wave",
        desc: "Resistance proportional to speed squared, which is the realistic case for anything moving quickly through air.",
        scenario: null },
    ],
  },
  momentum: { solverKey: "momentum", varsKey: "momentum", scenario: null, visual: "momentum" },
  collisions: {
    solverKey: "collisions",
    visual: "collision",
    subtypes: [
      { key: "collisions_elastic", label: "Elastic Collision", icon: "i-collide", desc: "The objects bounce apart, each keeping its own velocity. Momentum and kinetic energy are both conserved.", scenario: collisionsElasticScenario },
      { key: "collisions_inelastic", label: "Inelastic Collision", icon: "i-merge", desc: "The objects stick together and move off with one shared velocity. Only momentum is conserved.", scenario: collisionsInelasticScenario },
      { key: "collision2d_inelastic", solverKey: "collision2d_inelastic", visual: "collision-2d", label: "Two-Dimensional Sticking", icon: "i-merge",
        desc: "Two bodies collide on a plane and move off together. Momentum is conserved along each axis separately.",
        scenario: null },
      { key: "collision2d_general", solverKey: "collision2d_general", visual: "collision-2d", label: "Two-Dimensional Separating", icon: "i-collide",
        desc: "The bodies bounce apart in two dimensions. Momentum still balances componentwise, but on its own it cannot predict the outcome.",
        scenario: null },
    ],
  },
  energy: { solverKey: "energy", varsKey: "energy", scenario: energyScenario, visual: "energy" },
  work: {
    solverKey: "work",
    visual: "work",
    subtypes: [
      { key: "work_kinetic", label: "Kinetic Energy", icon: "i-run", desc: "Work that changes an object's speed, through the work-energy theorem.", scenario: workKineticScenario },
      { key: "work_grav", label: "Gravitational Potential Energy", icon: "i-hill", desc: "Work that raises or lowers an object against gravity.", scenario: workGravScenario },
      { key: "work_elastic", label: "Elastic Potential Energy", icon: "i-spring", desc: "Work that compresses or stretches a spring.", scenario: workElasticScenario },
      { key: "work_general", label: "General Work & Power", icon: "i-bolt", desc: "Work from an applied force, plus power and horsepower.", scenario: workGeneralScenario },
    ],
  },
  rotKinematics: { solverKey: "rotKinematics", varsKey: "rotKinematics", scenario: rotKinematicsScenario, visual: "rotational" },
  rotDynamics: {
    visual: "rotational",
    subtypes: [
      { key: "rotDynamics", solverKey: "rotDynamics", label: "Torque & Angular Acceleration", icon: "i-flywheel",
        desc: "\u03c4 = I\u03b1, rotational work and power, and the angular momentum of a spinning body.",
        scenario: rotDynamicsScenario },
      { key: "angmomentum", solverKey: "angmomentum", visual: "angular-momentum", label: "Angular Momentum & Impulse", icon: "i-loop",
        desc: "L = mvr\u00b7sin\u03b8 for a body that never rotates at all, and the angular impulse \u0394L = \u03c4\u0394t that changes it.",
        scenario: null },
      { key: "statics", solverKey: "statics", visual: "statics", label: "Static Equilibrium", icon: "i-balance",
        desc: "Nothing moves and nothing turns: \u03a3F = 0 and \u03a3\u03c4 = 0 together, on beams, supports and cables.",
        scenario: null },
    ],
  },
  gravitation: { solverKey: "gravitation", varsKey: "gravitation", scenario: null, visual: "gravitation" },
  orbital: { solverKey: "orbital", varsKey: "orbital", scenario: orbitalScenario, visual: "orbital" },
  oscillations: {
    solverKey: "oscillations",
    visual: "oscillation",
    subtypes: [
      { key: "osc_spring", label: "Spring-Mass Oscillator", icon: "i-spring", desc: "A mass bouncing on a spring, where ω comes from k and m.", scenario: oscillationsScenario },
      { key: "osc_pendulum", label: "Simple Pendulum", icon: "i-pendulum", desc: "A pendulum swinging through small angles, where ω depends only on its length.", scenario: null },
      { key: "osc_general", label: "General Harmonic Motion", icon: "i-wave", desc: "Position, velocity, acceleration and energy for any oscillator.", scenario: oscillationsScenario },
      { key: "springs_combo", solverKey: "springs_combo", visual: "springs-combo", label: "Springs in Series & Parallel", icon: "i-spring", desc: "Two springs combined. Parallel adds the constants and stiffens; series adds the compliances and softens.", scenario: null },
      { key: "physical_pendulum", solverKey: "physical_pendulum", visual: "physical-pendulum", label: "Physical Pendulum", icon: "i-pendulum", desc: "A real swinging body, whose period comes from its own rotational inertia rather than from a length alone.", scenario: null },
    ],
  },
  calculus: {
    visual: "calculus",
    subtypes: [
      { key: "calc_kinematics", solverKey: "calc_kinematics", label: "Calculus Kinematics", icon: "i-integral", desc: "Position, velocity and acceleration related by differentiation and integration.", scenario: null },
      { key: "calc_rotational", solverKey: "calc_rotational", label: "Calculus Rotational Kinematics", icon: "i-flywheel", desc: "The same derivatives and integrals applied to angular motion.", scenario: null },
      { key: "calc_workenergy", solverKey: "calc_workenergy", label: "Calculus Work-Energy", icon: "i-bolt", desc: "Work as an integral of force, and the energies that follow from it.", scenario: calcWorkEnergyScenario },
      { key: "calc_oscillations", solverKey: "calc_oscillations", label: "Calculus Oscillations", icon: "i-wave", desc: "The harmonic position function and its first two derivatives.", scenario: null },
      { key: "calc_varforce", solverKey: "calc_varforce", visual: "varforce", label: "Work by a Varying Force", icon: "i-integral", desc: "A force that changes with position, integrated over the displacement rather than multiplied by it.", scenario: null },
    ],
  },
  classicProblems: {
    subtypes: [
      { key: "atwood", solverKey: "atwood", visual: "atwood", label: "Atwood Machine", icon: "i-balance", desc: "Two masses hang from a string over a light pulley. Find the acceleration and the tension.", scenario: null },
      { key: "atwood_flywheel", solverKey: "atwood_flywheel", visual: "atwood-flywheel", label: "Atwood with a Massive Pulley", icon: "i-flywheel", desc: "The pulley now has rotational inertia, so the two tensions differ and a net torque spins it up.", scenario: null },
      { key: "rolling_race", solverKey: "rolling_race", visual: "rolling-race", label: "Rolling Race Down a Ramp", icon: "i-ramp", desc: "A sphere, cylinder or hoop rolls without slipping, splitting its energy between translation and spin.", scenario: null },
      { key: "loop_coaster", solverKey: "loop_coaster", visual: "loop-coaster", label: "Roller-Coaster Loop", icon: "i-loop", desc: "A cart drops from a height and must stay in contact with the track all the way around a vertical loop.", scenario: null },
      { key: "ballistic_pendulum", solverKey: "ballistic_pendulum", visual: "ballistic-pendulum", label: "Ballistic Pendulum", icon: "i-target", desc: "A bullet embeds in a hanging block: momentum through the impact, then energy through the swing.", scenario: null },
      { key: "ramp", solverKey: "ramp", visual: "ramp", label: "Block on a Ramp", icon: "i-ramp", desc: "Resolving weight along and into a slope, with static friction as a ceiling and kinetic friction as an equality.", scenario: rampScenario },
      { key: "blockstack", solverKey: "blockstack", visual: "blockstack", label: "Block on a Block", icon: "i-balance", desc: "One block rides on another. Friction between them is what drags the upper one along — until it cannot keep up and slips.", scenario: null },
      { key: "elevator", solverKey: "elevator", visual: "elevator", label: "Elevator & Apparent Weight", icon: "i-run", desc: "What a scale reads in an accelerating lift, and why your true weight never changes.", scenario: elevatorScenario },
      { key: "roundabout", solverKey: "roundabout", visual: "roundabout", label: "Roundabout & Banked Curve", icon: "i-loop", desc: "A skateboard cornering on friction alone, the friction circle, and the speed at which it lets go.", scenario: null },
      { key: "com", solverKey: "com", visual: "com", label: "Centre of Mass", icon: "i-balance", desc: "Where a system behaves as one particle — in position, velocity and acceleration.", scenario: null },
      { key: "banked", solverKey: "banked", visual: "banked-curve", label: "Banked Curve", icon: "i-loop", desc: "A bank that turns the corner with no friction at all, and the band of speeds it holds once friction is allowed.", scenario: null },
    ],
  },
};
