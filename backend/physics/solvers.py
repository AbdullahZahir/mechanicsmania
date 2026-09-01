"""
Pure equation solvers ported from mechanicscalculator.py.

Each solver takes `k` (a dict of known variable -> float|None) and `solve_for`
(the variable name being solved for), and returns a dict:
    {"solution": float, "equation": str, "originalEquation": str}
or None if not enough information was supplied to solve.

The branch order and guard conditions (e.g. avoiding division by zero,
rejecting negative square roots) mirror the original script's elif chains
exactly, so the same inputs produce the same answers.
"""
import math

from .data import GRAV_ACCEL as G
from .data import GRAV_CONSTANT as BIG_G


def _result(solution, equation, original_equation):
    if solution is None:
        return None
    return {"solution": solution, "equation": equation, "originalEquation": original_equation}


def _nonzero(x, eps=1e-9):
    # Guards divisors derived from trig functions (cos/sin of an angle that
    # can land exactly on a root, e.g. cos(pi/2)) where floating-point error
    # leaves a tiny non-zero residue instead of an exact 0.0. A plain
    # `!= 0` check lets that residue through and produces a wildly wrong,
    # blown-up "solution" instead of correctly reporting "unsolvable".
    return abs(x) > eps


def _run_closure(knowns, fill, passes=4):
    """Work out the quantities that follow immediately from the ones given.

    The same idea as _orbital_closure below, generalised so any chapter can
    use it. A student measures what the apparatus actually offers -- a boat
    speed, a current and a river width; two spring constants and a mass -- and
    the quantity they want sits one definitional step further on. A solver
    that fires exactly one equation per request cannot get there, and tells
    someone who has supplied everything the apparatus has that they have not
    given enough values.

    `fill(k, note)` is called repeatedly until a pass adds nothing new, so one
    step can unlock the next. note() fills a key only while it is still
    unknown, which is what stops a derived value from overwriting a number the
    reader typed, and what stops two steps that imply each other from looping.

    Each note records HOW the value was reached, not merely that it was: a
    fixed label per key once printed the provenance of a route that had not
    been taken, so the equation and its origin travel with the value.

    Returns (knowns, chain, used), where `used` maps a key to the
    (equation, origin) pair that produced it.
    """
    k = dict(knowns)
    chain = []
    used = {}

    def note(key, value, text, equation, origin):
        if k.get(key) is None and value is not None:
            k[key] = value
            chain.append(text)
            used[key] = (equation, origin)

    for _ in range(passes):
        before = len(chain)
        fill(k, note)
        if len(chain) == before:
            break
    return k, chain, used


def _closed(solver, fill):
    """Run a definitional closure before a solver dispatches.

    Whatever the closure worked out travels back with the answer under
    `derived`, so the printed working can substitute the same numbers the
    answer used. Without that the chapter chains correctly but the line
    beneath the answer is withheld, because the intermediate is in nobody's
    list of knowns.
    """
    def wrapped(k, solveFor):
        given = set(key for key, value in k.items() if value is not None)
        filled, chain, used = _run_closure(k, fill)
        derived = {key: value for key, value in filled.items()
                   if value is not None and key not in given}

        if solveFor in used:
            # The closure has already answered the question outright. That is
            # a complete answer, not a step towards one.
            equation, origin = used[solveFor]
            result = _result(filled[solveFor], equation, origin)
        else:
            result = solver(filled, solveFor)

        if result is not None and chain:
            result["chain"] = chain
            result["derived"] = derived
        return result

    wrapped.__name__ = getattr(solver, "__name__", "solver") + "_closed"
    wrapped.__doc__ = solver.__doc__
    return wrapped


def solve_kinematics(k, solveFor):
    vi, vf, v, a, d, t = k.get("vi"), k.get("vf"), k.get("v"), k.get("a"), k.get("d"), k.get("t")

    # --- relative velocity ----------------------------------------------------
    # Velocity is only ever measured against a frame. The subscript rule
    # v(A rel C) = v(A rel B) + v(B rel C) is what lets a swimmer's speed in
    # the water be added to the river's speed over the ground.
    if solveFor == "v_rel" and None not in (k.get("v_a"), k.get("v_b")):
        return _result(k["v_a"] - k["v_b"], "v_AB = v_A - v_B",
                       "The velocity of A as seen from B is the difference of their velocities")
    if solveFor == "v_a" and None not in (k.get("v_rel"), k.get("v_b")):
        return _result(k["v_rel"] + k["v_b"], "v_A = v_AB + v_B", "v_AB = v_A - v_B")
    if solveFor == "v_b" and None not in (k.get("v_a"), k.get("v_rel")):
        return _result(k["v_a"] - k["v_rel"], "v_B = v_A - v_AB", "v_AB = v_A - v_B")
    if solveFor == "v_resultant" and None not in (k.get("v_a"), k.get("v_b")):
        # Perpendicular frames -- a boat crossing a current, a plane in a
        # crosswind -- combine by Pythagoras rather than by adding.
        return _result((k["v_a"] ** 2 + k["v_b"] ** 2) ** 0.5, "v = sqrt(v_A^2 + v_B^2)",
                       "Perpendicular velocities combine as vectors, not by adding")

    if solveFor == "v" and d is not None and t is not None and t != 0:
        return _result(d / t, "v = d/t", "v = d/t")
    if solveFor == "d" and v is not None and t is not None:
        return _result(v * t, "d = v*t", "v = d/t")
    if solveFor == "t" and d is not None and v is not None and v != 0:
        return _result(d / v, "t = d/v", "v = d/t")

    if solveFor == "a" and vf is not None and vi is not None and t is not None and t != 0:
        return _result((vf - vi) / t, "a = (vf - vi)/t", "a = (vf - vi)/t")
    if solveFor == "vf" and vi is not None and a is not None and t is not None:
        return _result(vi + a * t, "vf = vi + a*t", "a = (vf - vi)/t")
    if solveFor == "vi" and vf is not None and a is not None and t is not None:
        return _result(vf - a * t, "vi = vf - a*t", "a = (vf - vi)/t")
    if solveFor == "t" and vf is not None and vi is not None and a is not None and a != 0:
        return _result((vf - vi) / a, "t = (vf - vi)/a", "a = (vf - vi)/t")

    if solveFor == "d" and vi is not None and t is not None and a is not None:
        return _result((vi * t) + (0.5 * a * t ** 2), "d = vi*t + 0.5*a*t^2", "d = vi*t + 0.5*a*t^2")
    if solveFor == "vi" and d is not None and t is not None and a is not None and t != 0:
        return _result((d - 0.5 * a * t ** 2) / t, "vi = (d - 0.5*a*t^2) / t", "d = vi*t + 0.5*a*t^2")
    if solveFor == "a" and d is not None and vi is not None and t is not None and t != 0:
        return _result((d - vi * t) * 2 / (t ** 2), "a = 2*(d - vi*t) / t^2", "d = vi*t + 0.5*a*t^2")

    if solveFor == "vf" and vi is not None and a is not None and d is not None:
        val = vi ** 2 + 2 * a * d
        if val >= 0:
            return _result(val ** 0.5, "vf = sqrt(vi^2 + 2*a*d)", "vf^2 = vi^2 + 2ad")
        return None
    if solveFor == "vi" and vf is not None and a is not None and d is not None:
        val = vf ** 2 - 2 * a * d
        if val >= 0:
            return _result(val ** 0.5, "vi = sqrt(vf^2 - 2*a*d)", "vf^2 = vi^2 + 2ad")
        return None
    if solveFor == "a" and vf is not None and vi is not None and d is not None and d != 0:
        return _result((vf ** 2 - vi ** 2) / (2 * d), "a = (vf^2 - vi^2) / (2*d)", "vf^2 = vi^2 + 2ad")
    if solveFor == "d" and vf is not None and vi is not None and a is not None and a != 0:
        return _result((vf ** 2 - vi ** 2) / (2 * a), "d = (vf^2 - vi^2) / (2*a)", "vf^2 = vi^2 + 2ad")

    if solveFor == "d" and vi is not None and vf is not None and t is not None:
        return _result(0.5 * (vi + vf) * t, "d = 0.5*(vi + vf)*t", "d = 0.5*(vi+vf)*t")
    if solveFor == "vi" and d is not None and vf is not None and t is not None and t != 0:
        return _result((2 * d / t) - vf, "vi = (2*d/t) - vf", "d = 0.5*(vi+vf)*t")
    if solveFor == "vf" and d is not None and vi is not None and t is not None and t != 0:
        return _result((2 * d / t) - vi, "vf = (2*d/t) - vi", "d = 0.5*(vi+vf)*t")
    if solveFor == "t" and d is not None and vi is not None and vf is not None and (vi + vf) != 0:
        return _result((2 * d) / (vi + vf), "t = (2*d) / (vi + vf)", "d = 0.5*(vi+vf)*t")

    return None


def solve_projectile(k, solveFor):
    """Two-dimensional launch problems on level ground.

    The launch angle is handled in degrees, matching how problems are stated,
    and converted to radians at the boundary. Heights and vertical positions
    are measured relative to the launch point.
    """
    v0, theta_deg = k.get("v0_p"), k.get("theta_p")
    v0x, v0y = k.get("v0x"), k.get("v0y")
    tFlight, rng, hMax = k.get("t_flight"), k.get("range_p"), k.get("h_max")
    t, xAt, yAt, vyAt = k.get("t_p"), k.get("x_at_t"), k.get("y_at_t"), k.get("vy_at_t")

    theta = math.radians(theta_deg) if theta_deg is not None else None

    # --- resolve the launch into components, or rebuild it from them --------
    if solveFor == "v0x":
        if v0 is not None and theta is not None:
            return _result(v0 * math.cos(theta), "v0x = v0*cos(theta)", "v0x = v0 cos θ")
        if rng is not None and tFlight is not None and _nonzero(tFlight):
            return _result(rng / tFlight, "v0x = range / t_flight", "range = v0x * t_flight")
    if solveFor == "v0y":
        if v0 is not None and theta is not None:
            return _result(v0 * math.sin(theta), "v0y = v0*sin(theta)", "v0y = v0 sin θ")
        if tFlight is not None:
            return _result(G * tFlight / 2, "v0y = g*t_flight / 2", "t_flight = 2*v0y/g")
        if hMax is not None and hMax >= 0:
            return _result((2 * G * hMax) ** 0.5, "v0y = sqrt(2*g*h_max)", "h_max = v0y^2/(2g)")
    if solveFor == "v0_p":
        if v0x is not None and v0y is not None:
            return _result((v0x ** 2 + v0y ** 2) ** 0.5, "v0 = sqrt(v0x^2 + v0y^2)", "v0x = v0 cos θ,  v0y = v0 sin θ")
        if rng is not None and theta is not None and _nonzero(math.sin(2 * theta)):
            val = rng * G / math.sin(2 * theta)
            return _result(val ** 0.5, "v0 = sqrt(range*g / sin(2*theta))", "range = v0² sin(2θ)/g") if val >= 0 else None
        if hMax is not None and theta is not None and _nonzero(math.sin(theta)):
            val = 2 * G * hMax / (math.sin(theta) ** 2)
            return _result(val ** 0.5, "v0 = sqrt(2*g*h_max / sin^2(theta))", "h_max = v0² sin²θ /(2g)") if val >= 0 else None
    if solveFor == "theta_p":
        if v0y is not None and v0x is not None and _nonzero(v0x):
            return _result(math.degrees(math.atan2(v0y, v0x)), "theta = atan(v0y / v0x)", "tan θ = v0y/v0x")
        if rng is not None and v0 is not None and _nonzero(v0):
            ratio = rng * G / (v0 ** 2)
            if -1 <= ratio <= 1:
                return _result(math.degrees(math.asin(ratio) / 2), "theta = ½·arcsin(range*g / v0^2)", "range = v0² sin(2θ)/g")
            return None

    # --- whole-flight quantities -------------------------------------------
    if solveFor == "t_flight":
        # 2*v0y/g is derived for a launch UPWARD over level ground. For a
        # downward or horizontal launch the object never rises, and the flight
        # time depends on a launch height this chapter does not model, so the
        # formula returns a negative time -- never a physical answer.
        if v0y is not None and v0y <= 0:
            return None
        if v0y is not None:
            return _result(2 * v0y / G, "t_flight = 2*v0y / g", "t_flight = 2 v0y / g")
        if v0 is not None and theta is not None:
            return _result(2 * v0 * math.sin(theta) / G, "t_flight = 2*v0*sin(theta) / g", "t_flight = 2 v0 sinθ / g")
    if solveFor == "range_p":
        if v0 is not None and theta is not None:
            return _result(v0 ** 2 * math.sin(2 * theta) / G, "range = v0^2*sin(2*theta) / g", "range = v0² sin(2θ)/g")
        if v0x is not None and tFlight is not None:
            return _result(v0x * tFlight, "range = v0x * t_flight", "range = v0x · t_flight")
    if solveFor == "h_max":
        # An object launched downward or horizontally rises no higher than the
        # point it left, so squaring a negative v0y and reporting a rise is
        # wrong rather than merely unhelpful.
        if v0y is not None and v0y < 0:
            return None
        if v0y is not None:
            return _result(v0y ** 2 / (2 * G), "h_max = v0y^2 / (2*g)", "h_max = v0y²/(2g)")
        if v0 is not None and theta is not None:
            return _result((v0 * math.sin(theta)) ** 2 / (2 * G), "h_max = (v0*sin(theta))^2 / (2*g)", "h_max = v0² sin²θ /(2g)")

    # --- state at a particular instant --------------------------------------
    if solveFor == "x_at_t" and v0x is not None and t is not None:
        return _result(v0x * t, "x(t) = v0x*t", "x(t) = v0x t")
    if solveFor == "y_at_t" and v0y is not None and t is not None:
        return _result(v0y * t - 0.5 * G * t ** 2, "y(t) = v0y*t - ½*g*t^2", "y(t) = v0y t − ½g t²")
    if solveFor == "vy_at_t" and v0y is not None and t is not None:
        return _result(v0y - G * t, "vy(t) = v0y - g*t", "vy(t) = v0y − g t")
    if solveFor == "t_p":
        if xAt is not None and v0x is not None and _nonzero(v0x):
            return _result(xAt / v0x, "t = x(t) / v0x", "x(t) = v0x t")
        if vyAt is not None and v0y is not None:
            return _result((v0y - vyAt) / G, "t = (v0y - vy(t)) / g", "vy(t) = v0y − g t")

    return None


def solve_gravitation(k, solveFor):
    """Universal gravitation, orbits and escape speed.

    m1 is the central body throughout: the field, orbital speed, period and
    escape speed all describe motion around m1. Potential energy is negative
    by the usual convention that U -> 0 at infinite separation.
    """
    m1, m2, r = k.get("m1_g"), k.get("m2_g"), k.get("r_g")
    F, U, gField = k.get("F_grav"), k.get("U_grav"), k.get("g_field")
    vOrb, T, vEsc = k.get("v_orbit"), k.get("T_orbit"), k.get("v_escape")

    # --- Newton's law of universal gravitation ------------------------------
    if solveFor == "F_grav" and None not in (m1, m2, r) and _nonzero(r):
        return _result(BIG_G * m1 * m2 / r ** 2, "F = G*m1*m2 / r^2", "F = Gm₁m₂/r²")
    if solveFor == "m1_g" and None not in (F, m2, r) and _nonzero(m2):
        return _result(F * r ** 2 / (BIG_G * m2), "m1 = F*r^2 / (G*m2)", "F = Gm₁m₂/r²")
    if solveFor == "m2_g" and None not in (F, m1, r) and _nonzero(m1):
        return _result(F * r ** 2 / (BIG_G * m1), "m2 = F*r^2 / (G*m1)", "F = Gm₁m₂/r²")
    if solveFor == "r_g" and None not in (F, m1, m2) and _nonzero(F):
        val = BIG_G * m1 * m2 / F
        return _result(val ** 0.5, "r = sqrt(G*m1*m2 / F)", "F = Gm₁m₂/r²") if val >= 0 else None

    # --- potential energy ---------------------------------------------------
    if solveFor == "U_grav" and None not in (m1, m2, r) and _nonzero(r):
        return _result(-BIG_G * m1 * m2 / r, "U = -G*m1*m2 / r", "U = −Gm₁m₂/r")
    if solveFor == "r_g" and None not in (U, m1, m2) and _nonzero(U):
        return _result(-BIG_G * m1 * m2 / U, "r = -G*m1*m2 / U", "U = −Gm₁m₂/r")

    # --- field strength -----------------------------------------------------
    if solveFor == "g_field" and m1 is not None and r is not None and _nonzero(r):
        return _result(BIG_G * m1 / r ** 2, "g = G*m1 / r^2", "g = GM/r²")
    if solveFor == "m1_g" and gField is not None and r is not None:
        return _result(gField * r ** 2 / BIG_G, "m1 = g*r^2 / G", "g = GM/r²")
    if solveFor == "r_g" and gField is not None and m1 is not None and _nonzero(gField):
        val = BIG_G * m1 / gField
        return _result(val ** 0.5, "r = sqrt(G*m1 / g)", "g = GM/r²") if val >= 0 else None

    # --- circular orbit -----------------------------------------------------
    if solveFor == "v_orbit" and m1 is not None and r is not None and _nonzero(r):
        val = BIG_G * m1 / r
        return _result(val ** 0.5, "v = sqrt(G*m1 / r)", "v_orbit = √(GM/r)") if val >= 0 else None
    if solveFor == "m1_g" and vOrb is not None and r is not None:
        return _result(vOrb ** 2 * r / BIG_G, "m1 = v^2*r / G", "v_orbit = √(GM/r)")
    if solveFor == "r_g" and vOrb is not None and m1 is not None and _nonzero(vOrb):
        return _result(BIG_G * m1 / vOrb ** 2, "r = G*m1 / v^2", "v_orbit = √(GM/r)")

    # --- Kepler's third law -------------------------------------------------
    if solveFor == "T_orbit" and m1 is not None and r is not None and _nonzero(m1):
        val = r ** 3 / (BIG_G * m1)
        return _result(2 * math.pi * val ** 0.5, "T = 2*pi*sqrt(r^3 / (G*m1))", "T² = 4π²r³/(GM)") if val >= 0 else None
    if solveFor == "r_g" and T is not None and m1 is not None and m1 > 0:
        # A fractional power of a negative base returns a complex number.
        return _result((BIG_G * m1 * (T / (2 * math.pi)) ** 2) ** (1 / 3), "r = cbrt(G*m1*(T/(2*pi))^2)", "T² = 4π²r³/(GM)")
    if solveFor == "m1_g" and T is not None and r is not None and _nonzero(T):
        return _result(4 * math.pi ** 2 * r ** 3 / (BIG_G * T ** 2), "m1 = 4*pi^2*r^3 / (G*T^2)", "T² = 4π²r³/(GM)")

    # --- escape speed -------------------------------------------------------
    if solveFor == "v_escape" and m1 is not None and r is not None and _nonzero(r):
        val = 2 * BIG_G * m1 / r
        return _result(val ** 0.5, "v_esc = sqrt(2*G*m1 / r)", "v_escape = √(2GM/r)") if val >= 0 else None
    if solveFor == "m1_g" and vEsc is not None and r is not None:
        return _result(vEsc ** 2 * r / (2 * BIG_G), "m1 = v_esc^2*r / (2G)", "v_escape = √(2GM/r)")
    if solveFor == "r_g" and vEsc is not None and m1 is not None and _nonzero(vEsc):
        return _result(2 * BIG_G * m1 / vEsc ** 2, "r = 2*G*m1 / v_esc^2", "v_escape = √(2GM/r)")

    # Escape speed is always sqrt(2) times the circular orbital speed at the
    # same radius, independent of both masses -- a relation worth surfacing.
    if solveFor == "v_escape" and vOrb is not None:
        return _result(vOrb * math.sqrt(2), "v_esc = sqrt(2) * v_orbit", "v_escape = √2 · v_orbit")
    if solveFor == "v_orbit" and vEsc is not None:
        return _result(vEsc / math.sqrt(2), "v_orbit = v_esc / sqrt(2)", "v_escape = √2 · v_orbit")

    return None


def solve_calc_varforce(k, solveFor):
    """Work done by a force that varies linearly with position.

    With F(x) = F0 + c·x, the work is a genuine integral rather than a
    product: W = ∫₀^d (F0 + c·x) dx = F0·d + ½c·d².
    """
    F0, c, d, W = k.get("F0_var"), k.get("c_var"), k.get("dx_var"), k.get("W_var")

    if solveFor == "W_var" and None not in (F0, c, d):
        return _result(F0 * d + 0.5 * c * d ** 2, "W = F0*d + ½*c*d^2", "W = ∫₀ᵈ (F0 + c·x) dx")
    if solveFor == "F0_var" and None not in (W, c, d) and _nonzero(d):
        return _result((W - 0.5 * c * d ** 2) / d, "F0 = (W - ½*c*d^2) / d", "W = ∫₀ᵈ (F0 + c·x) dx")
    if solveFor == "c_var" and None not in (W, F0, d) and _nonzero(d):
        return _result(2 * (W - F0 * d) / d ** 2, "c = 2*(W - F0*d) / d^2", "W = ∫₀ᵈ (F0 + c·x) dx")
    if solveFor == "dx_var" and None not in (W, F0, c):
        # Solve ½c·d² + F0·d − W = 0, taking the positive root.
        if _nonzero(c):
            disc = F0 ** 2 + 2 * c * W
            if disc < 0:
                return None
            root = (-F0 + disc ** 0.5) / c
            if root < 0:
                root = (-F0 - disc ** 0.5) / c
            return _result(root, "d = [-F0 + sqrt(F0^2 + 2*c*W)] / c", "W = F0·d + ½c·d²") if root >= 0 else None
        if _nonzero(F0):
            return _result(W / F0, "d = W / F0  (c = 0, constant force)", "W = F0·d")

    return None


def solve_forces(k, solveFor):
    vi, vf, a, t = k.get("vi"), k.get("vf"), k.get("a"), k.get("t")
    Fa, Ff, mu, weight, Fn, Fnet, mass = (
        k.get("Fa"), k.get("Ff"), k.get("mu"), k.get("weight"), k.get("Fn"), k.get("Fnet"), k.get("mass")
    )

    # Newton's second law relates acceleration to the NET force, not to the
    # applied one. Wiring it to Fa meant an object in free fall -- where the
    # wizard correctly records Fa = 0 (nothing is pushing it) and Fnet = mg --
    # was reported to have zero acceleration, which is the exact misconception
    # this chapter exists to destroy. The net force is consulted first, and
    # derived from the individual forces when it was not stated outright.
    if Fnet is None and Fa is not None and Ff is not None:
        Fnet = Fa - Ff

    if solveFor == "Fnet" and mass is not None and a is not None:
        return _result(mass * a, "ΣF = m*a", "ΣF = m*a")
    if solveFor == "a" and Fnet is not None and mass is not None and mass != 0:
        return _result(Fnet / mass, "a = ΣF/m", "ΣF = m*a")
    if solveFor == "mass" and Fnet is not None and a is not None and a != 0:
        return _result(Fnet / a, "m = ΣF/a", "ΣF = m*a")
    if solveFor == "Fnet" and Fa is not None and Ff is not None:
        return _result(Fa - Ff, "ΣF = Fa - Ff", "ΣF = Fa - Ff (one dimension)")

    # With no friction stated and no net force given, the applied force IS the
    # net force. The equation string says so, rather than implying F = ma holds
    # for whichever force happens to be named.
    _applied_is_net = Fnet is None and (Ff is None or Ff == 0)
    if solveFor == "Fa" and _applied_is_net and mass is not None and a is not None:
        return _result(mass * a, "Fa = m*a", "ΣF = m*a, and Fa is the only force along the motion")
    if solveFor == "mass" and _applied_is_net and Fa is not None and a is not None and a != 0:
        return _result(Fa / a, "m = Fa/a", "ΣF = m*a, and Fa is the only force along the motion")
    if solveFor == "a" and _applied_is_net and Fa is not None and mass is not None and mass != 0:
        return _result(Fa / mass, "a = Fa/m", "ΣF = m*a, and Fa is the only force along the motion")

    if solveFor == "Fa" and mass is not None and vf is not None and vi is not None and t is not None and t != 0:
        return _result(mass * (vf - vi) / t, "F = m*(vf - vi)/t", "F = m*(vf - vi)/t")
    if (solveFor == "mass" and Fa is not None and vf is not None and vi is not None
            and t is not None and t != 0 and _nonzero(vf - vi)):
        # Equal velocities mean no acceleration, so the mass is indeterminate
        # rather than infinite -- dividing here raised ZeroDivisionError.
        return _result(Fa / ((vf - vi) / t), "m = F/((vf - vi)/t)", "F = m*(vf - vi)/t")
    if solveFor == "vf" and Fa is not None and mass is not None and vi is not None and t is not None and mass != 0:
        return _result(((Fa / mass) * t) + vi, "vf = (F/m)*t + vi", "F = m*(vf - vi)/t")
    if solveFor == "vi" and Fa is not None and mass is not None and vf is not None and t is not None and mass != 0:
        return _result(vf - ((Fa / mass) * t), "vi = vf - (F/m)*t", "F = m*(vf - vi)/t")
    if solveFor == "t" and Fa is not None and mass is not None and vf is not None and vi is not None and (vf - vi) != 0:
        return _result(mass * (vf - vi) / Fa, "t = m*(vf - vi)/F", "F = m*(vf - vi)/t")

    if solveFor == "weight" and mass is not None:
        return _result(mass * G, "W = m*g", "W = mg")
    if solveFor == "mass" and weight is not None:
        return _result(weight / G, "m = W/g", "W = mg")

    if solveFor == "Ff" and mu is not None and Fn is not None:
        return _result(mu * Fn, "Ff = μ*Fn", "Ff = μ*Fn")
    if solveFor == "mu" and Ff is not None and Fn is not None and Fn != 0:
        return _result(Ff / Fn, "μ = Ff/Fn", "Ff = μ*Fn")
    if solveFor == "Fn" and Ff is not None and mu is not None and mu != 0:
        return _result(Ff / mu, "Fn = Ff/μ", "Ff = μ*Fn")

    if solveFor == "Fnet" and k.get("Fnet_forces") is not None:
        return _result(sum(k["Fnet_forces"]), "ΣF", "ΣF")

    return None


def solve_momentum(k, solveFor):
    p, pi, pf, changeOfp, J = k.get("p"), k.get("pi"), k.get("pf"), k.get("changeOfp"), k.get("J")
    vi, vf, v, t, Fa, mass = k.get("vi"), k.get("vf"), k.get("v"), k.get("t"), k.get("Fa"), k.get("mass")

    if solveFor == "p" and mass is not None and v is not None:
        return _result(mass * v, "p = m*v", "p = mv")
    if solveFor == "v" and p is not None and mass is not None and mass != 0:
        return _result(p / mass, "v = p/m", "p = mv")
    if solveFor == "mass" and p is not None and v is not None and v != 0:
        return _result(p / v, "m = p/v", "p = mv")

    if solveFor == "J" and pf is not None and pi is not None:
        return _result(pf - pi, "J = pf - pi", "J = pf - pi")
    if solveFor == "pf" and J is not None and pi is not None:
        return _result(J + pi, "pf = J + pi", "J = pf - pi")
    if solveFor == "pi" and pf is not None and J is not None:
        return _result(pf - J, "pi = pf - J", "J = pf - pi")

    if solveFor == "changeOfp" and pf is not None and pi is not None:
        return _result(pf - pi, "Δp = pf - pi", "Δp = pf - pi")

    if solveFor == "J" and Fa is not None and t is not None:
        return _result(Fa * t, "J = Fa*t", "J = Fa*t")
    if solveFor == "Fa" and J is not None and t is not None and t != 0:
        return _result(J / t, "Fa = J/t", "J = Fa*t")
    if solveFor == "t" and J is not None and Fa is not None and Fa != 0:
        return _result(J / Fa, "t = J/Fa", "J = Fa*t")

    if solveFor == "J" and vf is not None and vi is not None and mass is not None:
        return _result((mass * vf) - (mass * vi), "J = m*vf - m*vi", "J = mvf - mvi")
    if solveFor == "mass" and J is not None and vf is not None and vi is not None and (vf - vi) != 0:
        return _result(J / (vf - vi), "m = J / (vf - vi)", "J = mvf - mvi")
    if solveFor == "vf" and J is not None and vi is not None and mass is not None and mass != 0:
        return _result((J / mass) + vi, "vf = (J/m) + vi", "J = mvf - mvi")
    if solveFor == "vi" and J is not None and vf is not None and mass is not None and mass != 0:
        return _result(vf - (J / mass), "vi = vf - (J/m)", "J = mvf - mvi")

    return None


def solve_collisions(k, solveFor):
    v1i, v2i, v1f, v2f = k.get("v1i"), k.get("v2i"), k.get("v1f"), k.get("v2f")
    pi1, pi2, pf1, pf2 = k.get("pi1"), k.get("pi2"), k.get("pf1"), k.get("pf2")
    m1, m2, vf, pfc = k.get("m1"), k.get("m2"), k.get("vf"), k.get("pfc")

    # Direct p = mv definitions. Without these, momentum components are only
    # reachable through a conservation equation, which leaves them unsolvable
    # in an inelastic setup where the "after" momenta are a single combined
    # quantity rather than two separate ones.
    if solveFor == "pi1" and m1 is not None and v1i is not None:
        return _result(m1 * v1i, "pi1 = m1*v1i", "p = mv")
    if solveFor == "pi2" and m2 is not None and v2i is not None:
        return _result(m2 * v2i, "pi2 = m2*v2i", "p = mv")
    if solveFor == "pf1" and m1 is not None and v1f is not None:
        return _result(m1 * v1f, "pf1 = m1*v1f", "p = mv")
    if solveFor == "pf2" and m2 is not None and v2f is not None:
        return _result(m2 * v2f, "pf2 = m2*v2f", "p = mv")

    if solveFor == "pi1" and pi2 is not None and pf1 is not None and pf2 is not None:
        return _result((pf1 + pf2) - pi2, "pi1 = (pf1 + pf2) - pi2", "pi1 + pi2 = pf1 + pf2")
    if solveFor == "pi1" and None not in (m1, m2, v2i, v1f, v2f):
        return _result((m1 * v1f + m2 * v2f) - m2 * v2i, "pi1 = (m1*v1f + m2*v2f) - m2*v2i", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")

    if solveFor == "pi2" and pi1 is not None and pf1 is not None and pf2 is not None:
        return _result((pf1 + pf2) - pi1, "pi2 = (pf1 + pf2) - pi1", "pi1 + pi2 = pf1 + pf2")
    if solveFor == "pi2" and None not in (m1, m2, v1i, v1f, v2f):
        return _result((m1 * v1f + m2 * v2f) - m1 * v1i, "pi2 = (m1*v1f + m2*v2f) - m1*v1i", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")

    if solveFor == "pf1" and pi2 is not None and pi1 is not None and pf2 is not None:
        return _result((pi1 + pi2) - pf2, "pf1 = (pi1 + pi2) - pf2", "pi1 + pi2 = pf1 + pf2")
    if solveFor == "pf1" and None not in (m1, m2, v2i, v1i, v2f):
        return _result((m1 * v1i + m2 * v2i) - m2 * v2f, "pf1 = (m1*v1i + m2*v2i) - m2*v2f", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")

    if solveFor == "pf2" and pi2 is not None and pi1 is not None and pf1 is not None:
        return _result((pi1 + pi2) - pf1, "pf2 = (pi1 + pi2) - pf1", "pi1 + pi2 = pf1 + pf2")
    if solveFor == "pf2" and None not in (m1, m2, v1i, v1f, v2i):
        return _result((m1 * v1i + m2 * v2i) - m1 * v1f, "pf2 = (m1*v1i + m2*v2i) - m1*v1f", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")

    if solveFor == "pfc" and pi1 is not None and pi2 is not None:
        return _result(pi1 + pi2, "pfc = pi1 + pi2", "pi1 + pi2 = pfc")
    if solveFor == "pfc" and m1 is not None and m2 is not None and vf is not None:
        return _result((m1 + m2) * vf, "pfc = (m1+m2)*vf", "(m1+m2)*vf")
    if solveFor == "pfc" and m1 is not None and m2 is not None and v1i is not None and v2i is not None:
        return _result((m1 * v1i) + (m2 * v2i), "pfc = m1*v1i + m2*v2i", "m1*v1i + m2*v2i = (m1+m2)*vf")

    # A genuinely elastic collision conserves kinetic energy as well as
    # momentum, which pins down BOTH final velocities from the initial state
    # alone. Momentum conservation by itself is one equation in two unknowns,
    # so without this pair the most common collision problem in the course --
    # "two carts, known masses and initial speeds, find the final speeds" --
    # cannot be solved at all. Gated on the caller declaring the collision
    # elastic so an inelastic setup can never pick these up by accident.
    # ... and only when the reader has not already pinned the other final
    # velocity. Firing regardless meant a supplied v2f was silently discarded
    # in favour of the elastic prediction, so the answer contradicted a number
    # the reader had just entered, with nothing on screen to say so.
    if (k.get("_elastic") and None not in (m1, m2, v1i, v2i) and (m1 + m2) != 0
            and (v1f is None if solveFor == "v2f" else True)
            and (v2f is None if solveFor == "v1f" else True)):
        if solveFor == "v1f":
            return _result(
                ((m1 - m2) * v1i + 2 * m2 * v2i) / (m1 + m2),
                "v1f = [(m1 - m2)*v1i + 2*m2*v2i] / (m1 + m2)",
                "Elastic: momentum and kinetic energy both conserved",
            )
        if solveFor == "v2f":
            return _result(
                ((m2 - m1) * v2i + 2 * m1 * v1i) / (m1 + m2),
                "v2f = [(m2 - m1)*v2i + 2*m1*v1i] / (m1 + m2)",
                "Elastic: momentum and kinetic energy both conserved",
            )

    if solveFor == "v1f" and None not in (m1, m2, v1i, v2i, v2f):
        return _result((m1 * v1i + m2 * v2i - m2 * v2f) / m1, "v1f = (m1*v1i + m2*v2i - m2*v2f)/m1", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")
    if solveFor == "v2f" and None not in (m1, m2, v1i, v2i, v1f):
        return _result((m1 * v1i + m2 * v2i - m1 * v1f) / m2, "v2f = (m1*v1i + m2*v2i - m1*v1f)/m2", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")
    if solveFor == "v1i" and None not in (m1, m2, v2i, v1f, v2f):
        return _result((m1 * v1f + m2 * v2f - m2 * v2i) / m1, "v1i = (m1*v1f + m2*v2f - m2*v2i)/m1", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")
    if solveFor == "v2i" and None not in (m1, m2, v1i, v1f, v2f):
        return _result((m1 * v1i + m2 * v2f - m1 * v1f) / m2, "v2i = (m1*v1i + m2*v2f - m1*v1f)/m2", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")
    if solveFor == "m1" and None not in (m2, v1i, v1f, v2i, v2f) and (v1i - v1f) != 0:
        return _result((m2 * (v2f - v2i)) / (v1i - v1f), "m1 = m2*(v2f - v2i) / (v1i - v1f)", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")
    if solveFor == "m2" and None not in (m1, v1i, v1f, v2i, v2f) and (v2i - v2f) != 0:
        return _result((m1 * (v1f - v1i)) / (v2i - v2f), "m2 = m1*(v1f - v1i) / (v2i - v2f)", "m1*v1i + m2*v2i = m1*v1f + m2*v2f")

    if solveFor == "vf" and m1 is not None and m2 is not None and v1i is not None and v2i is not None:
        return _result((m1 * v1i + m2 * v2i) / (m1 + m2), "vf = (m1*v1i + m2*v2i) / (m1+m2)", "m1*v1i + m2*v2i = (m1+m2)*vf")
    if solveFor == "v1i" and m1 is not None and m2 is not None and v2i is not None and vf is not None:
        return _result(((m1 + m2) * vf - m2 * v2i) / m1, "v1i = ((m1+m2)*vf - m2*v2i)/m1", "m1*v1i + m2*v2i = (m1+m2)*vf")
    if solveFor == "v2i" and m1 is not None and m2 is not None and v1i is not None and vf is not None:
        return _result(((m1 + m2) * vf - m1 * v1i) / m2, "v2i = ((m1+m2)*vf - m1*v1i)/m2", "m1*v1i + m2*v2i = (m1+m2)*vf")
    if solveFor == "m1" and m2 is not None and v1i is not None and v2i is not None and vf is not None and (v1i - vf) != 0:
        return _result(((vf - v2i) * m2) / (v1i - vf), "m1 = (vf - v2i)*m2 / (v1i - vf)", "m1*v1i + m2*v2i = (m1+m2)*vf")
    if solveFor == "m2" and m1 is not None and v1i is not None and v2i is not None and vf is not None and (v2i - vf) != 0:
        return _result(((vf - v1i) * m1) / (v2i - vf), "m2 = (vf - v1i)*m1 / (v2i - vf)", "m1*v1i + m2*v2i = (m1+m2)*vf")

    return None


def solve_energy(k, solveFor):
    KE, Ug, Uspring, dy = k.get("KE"), k.get("Ug"), k.get("Uspring"), k.get("dy")
    mass, v, spring_k, dspring, Fspring = k.get("mass"), k.get("v"), k.get("k"), k.get("dspring"), k.get("Fspring")

    if solveFor == "KE" and mass is not None and v is not None:
        return _result(0.5 * mass * v ** 2, "KE = 0.5*m*v^2", "KE = 0.5*mass*v^2")
    if solveFor == "mass" and KE is not None and v is not None and v != 0:
        return _result((2 * KE) / (v ** 2), "mass = 2*KE/v^2", "KE = 0.5*mass*v^2")
    if solveFor == "v" and KE is not None and mass is not None and mass != 0:
        val = 2 * KE / mass
        if val >= 0:
            return _result(val ** 0.5, "v = sqrt(2*KE/mass)", "KE = 0.5*mass*v^2")
        return None

    if solveFor == "Ug" and mass is not None and dy is not None:
        return _result(mass * G * dy, "Ug = m*g*dy", "Ug = mass*g*dy")
    if solveFor == "mass" and Ug is not None and dy is not None and dy != 0:
        return _result(Ug / (G * dy), "mass = Ug/(g*dy)", "Ug = mass*g*dy")
    if solveFor == "dy" and Ug is not None and mass is not None and mass != 0:
        return _result(Ug / (mass * G), "dy = Ug/(mass*g)", "Ug = mass*g*dy")

    if solveFor == "Uspring" and spring_k is not None and dspring is not None:
        return _result(0.5 * spring_k * dspring ** 2, "Uspring = 0.5*k*dspring^2", "Uspring = 0.5*k*dspring^2")
    if solveFor == "k" and Uspring is not None and dspring is not None and dspring != 0:
        return _result((2 * Uspring) / (dspring ** 2), "k = 2*Uspring/dspring^2", "Uspring = 0.5*k*dspring^2")
    if solveFor == "dspring" and Uspring is not None and spring_k is not None and spring_k != 0:
        val = 2 * Uspring / spring_k
        if val >= 0:
            return _result(val ** 0.5, "dspring = sqrt(2*Uspring/k)", "Uspring = 0.5*k*dspring^2")
        return None

    if solveFor == "Fspring" and spring_k is not None and dspring is not None:
        return _result(-spring_k * dspring, "Fspring = -k*dspring", "Fspring = -k*dspring")
    # The minus sign in F = -kx states a DIRECTION: the spring pulls back
    # against the displacement. It is not a licence for a negative spring
    # constant, and returning k = -50 N/m contradicted this app's own input
    # rule, which refuses to accept a non-positive k in the first place.
    if solveFor == "k" and Fspring is not None and dspring is not None and dspring != 0:
        return _result(abs(Fspring) / abs(dspring), "k = abs(Fspring) / abs(dspring)", "Fspring = -k*dspring (the sign is direction)")
    if solveFor == "dspring" and Fspring is not None and spring_k is not None and spring_k != 0:
        return _result(abs(Fspring) / abs(spring_k), "dspring = abs(Fspring) / k", "Fspring = -k*dspring (the sign is direction)")

    return None


def solve_work(k, solveFor):
    W, ei, ef, Fa, d, P, hp = k.get("W"), k.get("ei"), k.get("ef"), k.get("Fa"), k.get("d"), k.get("P"), k.get("hp")
    KW, KEi, KEf, vi, vf, mass = k.get("KW"), k.get("KEi"), k.get("KEf"), k.get("vi"), k.get("vf"), k.get("mass")
    UgW, Ugi, Ugf, dyi, dyf = k.get("UgW"), k.get("Ugi"), k.get("Ugf"), k.get("dyi"), k.get("dyf")
    UspringW, Uspringi, Uspringf, dspringi, dspringf, spring_k = (
        k.get("UspringW"), k.get("Uspringi"), k.get("Uspringf"), k.get("dspringi"), k.get("dspringf"), k.get("k")
    )
    t = k.get("t")
    # No angle supplied means the force acts along the displacement, so
    # cos(theta) = 1. Leaving this as None instead made W = Fa*d*cos(theta)
    # unusable in both directions, so solving for Fa or d was impossible
    # unless the student happened to answer the optional angle question.
    costheta = k.get("costheta")
    # Remember whether an angle was actually supplied. When it was not, the
    # displayed equation must not carry a cos(theta) the reader never entered
    # -- there is no value to substitute for it, so the whole worked line was
    # being withheld.
    has_angle = costheta is not None
    if costheta is None:
        costheta = 1.0

    if solveFor == "KW" and KEf is not None and KEi is not None:
        return _result(KEf - KEi, "KW = KEf - KEi", "KW = KEf - KEi")
    if solveFor == "KEf" and KW is not None and KEi is not None:
        return _result(KW + KEi, "KEf = KW + KEi", "KW = KEf - KEi")
    if solveFor == "KEi" and KEf is not None and KW is not None:
        return _result(KEf - KW, "KEi = KEf - KW", "KW = KEf - KEi")
    if solveFor == "KW" and vf is not None and vi is not None and mass is not None:
        return _result(0.5 * mass * vf ** 2 - 0.5 * mass * vi ** 2, "KW = 0.5*m*vf^2 - 0.5*m*vi^2", "KW = 0.5*m*vf^2 - 0.5*m*vi^2")
    if solveFor == "vf" and KW is not None and vi is not None and mass is not None:
        temp = KW + 0.5 * mass * vi ** 2
        if temp >= 0:
            return _result((2 * temp / mass) ** 0.5, "vf = sqrt(2*(KW + 0.5*m*vi^2)/m)", "KW = 0.5*m*vf^2 - 0.5*m*vi^2")
        return None
    if solveFor == "vi" and KW is not None and vf is not None and mass is not None:
        temp = 0.5 * mass * vf ** 2 - KW
        if temp >= 0:
            return _result((2 * temp / mass) ** 0.5, "vi = sqrt(2*(0.5*m*vf^2 - KW)/m)", "KW = 0.5*m*vf^2 - 0.5*m*vi^2")
        return None
    if solveFor == "mass" and KW is not None and vf is not None and vi is not None and vf ** 2 != vi ** 2:
        return _result((2 * KW) / (vf ** 2 - vi ** 2), "mass = 2*KW/(vf^2 - vi^2)", "KW = 0.5*m*vf^2 - 0.5*m*vi^2")

    if solveFor == "UgW" and Ugf is not None and Ugi is not None:
        return _result(Ugf - Ugi, "UgW = Ugf - Ugi", "UgW = Ugf - Ugi")
    if solveFor == "Ugf" and UgW is not None and Ugi is not None:
        return _result(UgW + Ugi, "Ugf = UgW + Ugi", "UgW = Ugf - Ugi")
    if solveFor == "Ugi" and Ugf is not None and UgW is not None:
        return _result(Ugf - UgW, "Ugi = Ugf - UgW", "UgW = Ugf - Ugi")
    if solveFor == "UgW" and mass is not None and dyf is not None and dyi is not None:
        return _result(mass * G * dyf - mass * G * dyi, "UgW = m*g*dyf - m*g*dyi", "UgW = mass*g*dyf - mass*g*dyi")
    if solveFor == "mass" and UgW is not None and dyf is not None and dyi is not None and (dyf - dyi) != 0:
        return _result(UgW / (G * (dyf - dyi)), "mass = UgW/(g*(dyf-dyi))", "UgW = mass*g*dyf - mass*g*dyi")
    if solveFor == "dyf" and UgW is not None and mass is not None and dyi is not None:
        return _result((UgW + mass * G * dyi) / (mass * G), "dyf = (UgW + m*g*dyi)/(m*g)", "UgW = mass*g*dyf - mass*g*dyi")
    if solveFor == "dyi" and UgW is not None and mass is not None and dyf is not None:
        return _result((mass * G * dyf - UgW) / (mass * G), "dyi = (m*g*dyf - UgW)/(m*g)", "UgW = mass*g*dyf - mass*g*dyi")

    if solveFor == "UspringW" and Uspringf is not None and Uspringi is not None:
        return _result(Uspringf - Uspringi, "UspringW = Uspringf - Uspringi", "UspringW = Uspringf - Uspringi")
    if solveFor == "Uspringf" and UspringW is not None and Uspringi is not None:
        return _result(UspringW + Uspringi, "Uspringf = UspringW + Uspringi", "UspringW = Uspringf - Uspringi")
    if solveFor == "Uspringi" and Uspringf is not None and UspringW is not None:
        return _result(Uspringf - UspringW, "Uspringi = Uspringf - UspringW", "UspringW = Uspringf - Uspringi")
    if solveFor == "UspringW" and spring_k is not None and dspringf is not None and dspringi is not None:
        return _result(0.5 * spring_k * dspringf ** 2 - 0.5 * spring_k * dspringi ** 2, "UspringW = 0.5*k*dspringf^2 - 0.5*k*dspringi^2", "UspringW = 0.5*k*dspringf^2 - 0.5*k*dspringi^2")
    if solveFor == "k" and UspringW is not None and dspringf is not None and dspringi is not None and (dspringf ** 2 - dspringi ** 2) != 0:
        return _result((2 * UspringW) / (dspringf ** 2 - dspringi ** 2), "k = 2*UspringW/(dspringf^2 - dspringi^2)", "UspringW = 0.5*k*dspringf^2 - 0.5*k*dspringi^2")

    # U = 0.5*k*x^2 ITSELF, at either end. The chapter could take the
    # difference between two stored energies but could not work out either one
    # from a spring constant and a compression -- which is the first thing this
    # chapter is named after, and the only route a student who measured the
    # spring actually has.
    if solveFor == "Uspringi" and None not in (spring_k, dspringi):
        return _result(0.5 * spring_k * dspringi ** 2, "Uspringi = 0.5*k*dspringi^2",
                       "Elastic potential energy at the initial compression")
    if solveFor == "Uspringf" and None not in (spring_k, dspringf):
        return _result(0.5 * spring_k * dspringf ** 2, "Uspringf = 0.5*k*dspringf^2",
                       "Elastic potential energy at the final compression")
    if solveFor == "k" and None not in (Uspringi, dspringi) and _nonzero(dspringi):
        return _result((2 * Uspringi) / dspringi ** 2, "k = 2*Uspringi/dspringi^2",
                       "U = 0.5*k*x^2, rearranged")
    if solveFor == "k" and None not in (Uspringf, dspringf) and _nonzero(dspringf):
        return _result((2 * Uspringf) / dspringf ** 2, "k = 2*Uspringf/dspringf^2",
                       "U = 0.5*k*x^2, rearranged")
    if solveFor == "dspringi" and None not in (Uspringi, spring_k) and _nonzero(spring_k):
        val = 2 * Uspringi / spring_k
        # A negative stored energy describes no compression at all.
        return _result(val ** 0.5, "dspringi = sqrt(2*Uspringi/k)",
                       "U = 0.5*k*x^2, rearranged") if val >= 0 else None
    if solveFor == "dspringf" and None not in (Uspringf, spring_k) and _nonzero(spring_k):
        val = 2 * Uspringf / spring_k
        return _result(val ** 0.5, "dspringf = sqrt(2*Uspringf/k)",
                       "U = 0.5*k*x^2, rearranged") if val >= 0 else None
    if solveFor == "dspringf" and UspringW is not None and spring_k is not None and dspringi is not None:
        value = (2 * UspringW + spring_k * dspringi ** 2) / spring_k
        return _result(value ** 0.5, "dspringf = sqrt((2*UspringW + k*dspringi^2)/k)", "UspringW = 0.5*k*dspringf^2 - 0.5*k*dspringi^2") if value >= 0 else None
    if solveFor == "dspringi" and UspringW is not None and spring_k is not None and dspringf is not None:
        value = (spring_k * dspringf ** 2 - 2 * UspringW) / spring_k
        return _result(value ** 0.5, "dspringi = sqrt((k*dspringf^2 - 2*UspringW)/k)", "UspringW = 0.5*k*dspringf^2 - 0.5*k*dspringi^2") if value >= 0 else None

    if solveFor == "W" and Fa is not None and d is not None and costheta is not None:
        return _result(Fa * d * costheta,
                       "W = Fa*d*cos(theta)" if has_angle else "W = Fa*d",
                       "W = Fa*d*cos(theta)")
    if solveFor == "Fa" and W is not None and d is not None and costheta is not None and _nonzero(d * costheta):
        return _result(W / (d * costheta),
                       "Fa = W/(d*cos(theta))" if has_angle else "Fa = W/d",
                       "W = Fa*d*cos(theta)")
    if solveFor == "d" and W is not None and Fa is not None and costheta is not None and _nonzero(Fa * costheta):
        return _result(W / (Fa * costheta),
                       "d = W/(Fa*cos(theta))" if has_angle else "d = W/Fa",
                       "W = Fa*d*cos(theta)")
    if solveFor == "W" and ef is not None and ei is not None:
        return _result(ef - ei, "W = ef - ei", "W = ef - ei")
    if solveFor == "ef" and W is not None and ei is not None:
        return _result(W + ei, "ef = W + ei", "W = ef - ei")
    if solveFor == "ei" and ef is not None and W is not None:
        return _result(ef - W, "ei = ef - W", "W = ef - ei")

    if solveFor == "P" and ef is not None and ei is not None and t is not None and t != 0:
        return _result((ef - ei) / t, "P = (ef - ei)/t", "P = (ef - ei)/t")
    if solveFor == "ef" and P is not None and ei is not None and t is not None:
        return _result(P * t + ei, "ef = P*t + ei", "P = (ef - ei)/t")
    if solveFor == "ei" and ef is not None and P is not None and t is not None:
        return _result(ef - P * t, "ei = ef - P*t", "P = (ef - ei)/t")
    if solveFor == "t" and ef is not None and ei is not None and P is not None and P != 0:
        return _result((ef - ei) / P, "t = (ef - ei)/P", "P = (ef - ei)/t")

    # --- energy removed by friction -------------------------------------------
    # Friction converts mechanical energy to heat, so its work is negative no
    # matter which way the object slides -- taking magnitudes makes that
    # structural rather than dependent on the sign of the inputs.
    if solveFor == "W_friction" and None not in (k.get("Ff_w"), k.get("d_slide")):
        return _result(-abs(k["Ff_w"]) * abs(k["d_slide"]), "W_f = -f_k*d",
                       "Friction always does negative work on the sliding body")
    if solveFor == "d_slide" and None not in (k.get("W_friction"), k.get("Ff_w")) and _nonzero(k["Ff_w"]):
        return _result(abs(k["W_friction"]) / abs(k["Ff_w"]), "d = abs(W_f) / f_k", "W_f = -f_k*d")
    if solveFor == "Ff_w" and None not in (k.get("W_friction"), k.get("d_slide")) and _nonzero(k["d_slide"]):
        return _result(abs(k["W_friction"]) / abs(k["d_slide"]), "f_k = abs(W_f) / d", "W_f = -f_k*d")
    if solveFor == "ef" and None not in (ei, k.get("W_friction")):
        return _result(ei - abs(k["W_friction"]), "E_f = E_i - abs(W_friction)",
                       "KE_i + PE_i - f*d = KE_f + PE_f, with W_friction already negative")

    # --- power from force and speed -------------------------------------------
    if solveFor == "P" and None not in (Fa, k.get("v_power")):
        ct = costheta if has_angle else 1.0
        return _result(Fa * k["v_power"] * ct,
                       "P = F*v*cos(theta)" if has_angle else "P = F*v",
                       "The instantaneous form of P = dW/dt")
    if solveFor == "v_power" and None not in (P, Fa) and _nonzero(Fa):
        return _result(P / Fa, "v = P / F", "P = F*v")
    if solveFor == "Fa" and None not in (P, k.get("v_power")) and _nonzero(k["v_power"]):
        return _result(P / k["v_power"], "F = P / v", "P = F*v")

    if solveFor == "P" and W is not None and t is not None and t != 0:
        return _result(W / t, "P = W/t", "P = W/t")
    if solveFor == "W" and P is not None and t is not None:
        return _result(P * t, "W = P*t", "P = W/t")
    if solveFor == "t" and W is not None and P is not None and P != 0:
        return _result(W / P, "t = W/P", "P = W/t")

    if solveFor == "hp" and P is not None:
        return _result(P / 746, "hp = P/746", "hp = P/746")
    if solveFor == "P" and hp is not None:
        return _result(hp * 746, "P = hp*746", "hp = P/746")

    return None


def solve_rot_kinematics(k, solveFor):
    theta_rot, omega_i, omega_f, omega, alpha, arc, r, t = (
        k.get("theta_rot"), k.get("omega_i"), k.get("omega_f"), k.get("omega"),
        k.get("alpha"), k.get("arc"), k.get("r"), k.get("t")
    )

    if solveFor == "arc" and r is not None and theta_rot is not None:
        return _result(r * theta_rot, "arc = r*theta", "arc = r*theta")
    if solveFor == "r" and arc is not None and theta_rot is not None and theta_rot != 0:
        return _result(arc / theta_rot, "r = arc/theta", "arc = r*theta")
    if solveFor == "theta_rot" and arc is not None and r is not None and r != 0:
        return _result(arc / r, "theta = arc/r", "arc = r*theta")

    if solveFor == "omega" and theta_rot is not None and t is not None and t != 0:
        return _result(theta_rot / t, "omega = theta/t", "omega = theta/t")
    if solveFor == "theta_rot" and omega is not None and t is not None:
        return _result(omega * t, "theta = omega*t", "omega = theta/t")
    if solveFor == "t" and theta_rot is not None and omega is not None and omega != 0:
        return _result(theta_rot / omega, "t = theta/omega", "omega = theta/t")

    if solveFor == "alpha" and omega_f is not None and omega_i is not None and t is not None and t != 0:
        return _result((omega_f - omega_i) / t, "alpha = (omega_f - omega_i)/t", "alpha = (omega_f - omega_i)/t")
    if solveFor == "omega_f" and omega_i is not None and alpha is not None and t is not None:
        return _result(omega_i + alpha * t, "omega_f = omega_i + alpha*t", "alpha = (omega_f - omega_i)/t")
    if solveFor == "omega_i" and omega_f is not None and alpha is not None and t is not None:
        return _result(omega_f - alpha * t, "omega_i = omega_f - alpha*t", "alpha = (omega_f - omega_i)/t")
    if solveFor == "t" and omega_f is not None and omega_i is not None and alpha is not None and alpha != 0:
        return _result((omega_f - omega_i) / alpha, "t = (omega_f - omega_i)/alpha", "alpha = (omega_f - omega_i)/t")

    if solveFor == "theta_rot" and omega_i is not None and t is not None and alpha is not None:
        return _result(omega_i * t + 0.5 * alpha * t ** 2, "theta = omega_i*t + 0.5*alpha*t^2", "theta = omega_i*t + 0.5*alpha*t^2")
    if solveFor == "omega_i" and theta_rot is not None and t is not None and alpha is not None and t != 0:
        return _result((theta_rot - 0.5 * alpha * t ** 2) / t, "omega_i = (theta - 0.5*alpha*t^2)/t", "theta = omega_i*t + 0.5*alpha*t^2")
    if solveFor == "alpha" and theta_rot is not None and omega_i is not None and t is not None and t != 0:
        return _result((theta_rot - omega_i * t) * 2 / (t ** 2), "alpha = 2*(theta - omega_i*t)/t^2", "theta = omega_i*t + 0.5*alpha*t^2")

    if solveFor == "omega_f" and omega_i is not None and alpha is not None and theta_rot is not None:
        val = omega_i ** 2 + 2 * alpha * theta_rot
        return _result(val ** 0.5, "omega_f = sqrt(omega_i^2 + 2*alpha*theta)", "omega_f^2 = omega_i^2 + 2*alpha*theta") if val >= 0 else None
    if solveFor == "omega_i" and omega_f is not None and alpha is not None and theta_rot is not None:
        val = omega_f ** 2 - 2 * alpha * theta_rot
        return _result(val ** 0.5, "omega_i = sqrt(omega_f^2 - 2*alpha*theta)", "omega_f^2 = omega_i^2 + 2*alpha*theta") if val >= 0 else None
    if solveFor == "alpha" and omega_f is not None and omega_i is not None and theta_rot is not None and theta_rot != 0:
        return _result((omega_f ** 2 - omega_i ** 2) / (2 * theta_rot), "alpha = (omega_f^2 - omega_i^2)/(2*theta)", "omega_f^2 = omega_i^2 + 2*alpha*theta")
    if solveFor == "theta_rot" and omega_f is not None and omega_i is not None and alpha is not None and alpha != 0:
        return _result((omega_f ** 2 - omega_i ** 2) / (2 * alpha), "theta = (omega_f^2 - omega_i^2)/(2*alpha)", "omega_f^2 = omega_i^2 + 2*alpha*theta")

    if solveFor == "theta_rot" and omega_i is not None and omega_f is not None and t is not None:
        return _result(0.5 * (omega_i + omega_f) * t, "theta = 0.5*(omega_i + omega_f)*t", "theta = 0.5*(omega_i + omega_f)*t")
    if solveFor == "omega_i" and theta_rot is not None and omega_f is not None and t is not None and t != 0:
        return _result((2 * theta_rot / t) - omega_f, "omega_i = (2*theta/t) - omega_f", "theta = 0.5*(omega_i + omega_f)*t")
    if solveFor == "omega_f" and theta_rot is not None and omega_i is not None and t is not None and t != 0:
        return _result((2 * theta_rot / t) - omega_i, "omega_f = (2*theta/t) - omega_i", "theta = 0.5*(omega_i + omega_f)*t")
    if solveFor == "t" and theta_rot is not None and omega_i is not None and omega_f is not None and (omega_i + omega_f) != 0:
        return _result((2 * theta_rot) / (omega_i + omega_f), "t = (2*theta)/(omega_i + omega_f)", "theta = 0.5*(omega_i + omega_f)*t")

    return None


def solve_rot_dynamics(k, solveFor):
    tau, I, alpha_dyn = k.get("tau"), k.get("I"), k.get("alpha_dyn")
    L, Li, Lf, changeOfL, KErot = k.get("L"), k.get("Li"), k.get("Lf"), k.get("changeOfL"), k.get("KErot")
    r_dyn, F_tang, F_cent = k.get("r_dyn"), k.get("F_tang"), k.get("F_cent")
    omega_dyn, mass_dyn, v_tang = k.get("omega_dyn"), k.get("mass_dyn"), k.get("v_tang")

    if solveFor == "tau" and I is not None and alpha_dyn is not None:
        return _result(I * alpha_dyn, "tau = I*alpha", "tau = I*alpha")
    if solveFor == "I" and tau is not None and alpha_dyn is not None and alpha_dyn != 0:
        return _result(tau / alpha_dyn, "I = tau/alpha", "tau = I*alpha")
    if solveFor == "alpha_dyn" and tau is not None and I is not None and I != 0:
        return _result(tau / I, "alpha = tau/I", "tau = I*alpha")

    if solveFor == "tau" and None not in (r_dyn, F_tang, k.get("theta_tau")):
        return _result(r_dyn * F_tang * math.sin(math.radians(k["theta_tau"])),
                       "tau = r*F*sin(theta)", "Only the component of F perpendicular to r produces torque")
    if solveFor == "tau" and r_dyn is not None and F_tang is not None:
        return _result(r_dyn * F_tang, "tau = r*F_tang", "tau = r*F")
    # The sine-aware inverses must precede the perpendicular shortcuts, or an
    # angle the reader supplied changes nothing and the answer is out by 1/sin.
    if solveFor == "r_dyn" and None not in (tau, F_tang, k.get("theta_tau")):
        s_t = math.sin(math.radians(k["theta_tau"]))
        if _nonzero(F_tang * s_t):
            return _result(tau / (F_tang * s_t), "r = tau / (F*sin(theta))", "tau = r*F*sin(theta)")
        return None
    if solveFor == "F_tang" and None not in (tau, r_dyn, k.get("theta_tau")):
        s_t = math.sin(math.radians(k["theta_tau"]))
        if _nonzero(r_dyn * s_t):
            return _result(tau / (r_dyn * s_t), "F = tau / (r*sin(theta))", "tau = r*F*sin(theta)")
        return None
    if solveFor == "r_dyn" and tau is not None and F_tang is not None and F_tang != 0:
        return _result(tau / F_tang, "r = tau/F_tang", "tau = r*F")
    if solveFor == "F_tang" and tau is not None and r_dyn is not None and r_dyn != 0:
        return _result(tau / r_dyn, "F_tang = tau/r", "tau = r*F")

    if solveFor == "L" and I is not None and omega_dyn is not None:
        return _result(I * omega_dyn, "L = I*omega", "L = I*omega")
    if solveFor == "I" and L is not None and omega_dyn is not None and omega_dyn != 0:
        return _result(L / omega_dyn, "I = L/omega", "L = I*omega")
    if solveFor == "omega_dyn" and L is not None and I is not None and I != 0:
        return _result(L / I, "omega = L/I", "L = I*omega")

    if solveFor == "changeOfL" and Lf is not None and Li is not None:
        return _result(Lf - Li, "ΔL = Lf - Li", "ΔL = Lf - Li")
    if solveFor == "Lf" and changeOfL is not None and Li is not None:
        return _result(changeOfL + Li, "Lf = ΔL + Li", "ΔL = Lf - Li")
    if solveFor == "Li" and Lf is not None and changeOfL is not None:
        return _result(Lf - changeOfL, "Li = Lf - ΔL", "ΔL = Lf - Li")

    if solveFor == "KErot" and I is not None and omega_dyn is not None:
        return _result(0.5 * I * omega_dyn ** 2, "KErot = 0.5*I*omega^2", "KErot = 0.5*I*omega^2")
    if solveFor == "I" and KErot is not None and omega_dyn is not None and omega_dyn != 0:
        return _result((2 * KErot) / (omega_dyn ** 2), "I = 2*KErot/omega^2", "KErot = 0.5*I*omega^2")
    if solveFor == "omega_dyn" and KErot is not None and I is not None and I != 0:
        val = 2 * KErot / I
        return _result(val ** 0.5, "omega = sqrt(2*KErot/I)", "KErot = 0.5*I*omega^2") if val >= 0 else None

    if solveFor == "I" and mass_dyn is not None and r_dyn is not None:
        return _result(mass_dyn * r_dyn ** 2, "I = mass*r^2", "I = m*r^2 (point mass)")
    if solveFor == "mass_dyn" and I is not None and r_dyn is not None and r_dyn != 0:
        return _result(I / (r_dyn ** 2), "mass = I/r^2", "I = m*r^2 (point mass)")
    if solveFor == "r_dyn" and I is not None and mass_dyn is not None and mass_dyn != 0:
        val = I / mass_dyn
        return _result(val ** 0.5, "r = sqrt(I/mass)", "I = m*r^2 (point mass)") if val >= 0 else None

    # F_c = m*v^2/r is the form the exam states and the form a student reaches
    # for first. Only the m*omega^2*r version existed, so a problem giving the
    # tangential speed instead of the angular one came back unsolvable even
    # with every quantity in hand.
    if solveFor == "F_cent" and None not in (mass_dyn, v_tang, r_dyn) and r_dyn != 0:
        return _result(mass_dyn * v_tang ** 2 / r_dyn, "F_cent = mass*v^2/r", "F_c = m*v^2/r")
    if solveFor == "v_tang" and None not in (mass_dyn, F_cent, r_dyn) and mass_dyn != 0:
        _val = F_cent * r_dyn / mass_dyn
        return _result(_val ** 0.5, "v = sqrt(F_cent*r / mass)", "F_c = m*v^2/r") if _val >= 0 else None
    if solveFor == "r_dyn" and None not in (mass_dyn, v_tang, F_cent) and _nonzero(F_cent):
        return _result(mass_dyn * v_tang ** 2 / F_cent, "r = mass*v^2 / F_cent", "F_c = m*v^2/r")
    if solveFor == "mass_dyn" and None not in (F_cent, v_tang, r_dyn) and _nonzero(v_tang ** 2):
        return _result(F_cent * r_dyn / v_tang ** 2, "mass = F_cent*r / v^2", "F_c = m*v^2/r")

    if solveFor == "F_cent" and mass_dyn is not None and omega_dyn is not None and r_dyn is not None:
        return _result(mass_dyn * omega_dyn ** 2 * r_dyn, "F_cent = mass*omega^2*r", "F_cent = m*omega^2*r")
    if solveFor == "mass_dyn" and F_cent is not None and omega_dyn is not None and r_dyn is not None and omega_dyn != 0 and r_dyn != 0:
        return _result(F_cent / (omega_dyn ** 2 * r_dyn), "mass = F_cent/(omega^2*r)", "F_cent = m*omega^2*r")
    if solveFor == "omega_dyn" and F_cent is not None and mass_dyn is not None and r_dyn is not None and mass_dyn != 0 and r_dyn != 0:
        val = F_cent / (mass_dyn * r_dyn)
        return _result(val ** 0.5, "omega = sqrt(F_cent/(mass*r))", "F_cent = m*omega^2*r") if val >= 0 else None
    if solveFor == "r_dyn" and F_cent is not None and mass_dyn is not None and omega_dyn is not None and mass_dyn != 0 and omega_dyn != 0:
        return _result(F_cent / (mass_dyn * omega_dyn ** 2), "r = F_cent/(mass*omega^2)", "F_cent = m*omega^2*r")

    # --- rotational work and power ------------------------------------------
    # The rotational twins of W = F*d and P = F*v, with torque standing in for
    # force and angle for distance. Both are on the reference card.
    if solveFor == "W_rot" and None not in (tau, k.get("theta_rot_dyn")):
        return _result(tau * k["theta_rot_dyn"], "W = tau*dtheta", "W = tau*dtheta, the rotational form of W = F*d")
    if solveFor == "tau" and None not in (k.get("W_rot"), k.get("theta_rot_dyn")) and _nonzero(k["theta_rot_dyn"]):
        return _result(k["W_rot"] / k["theta_rot_dyn"], "tau = W / dtheta", "W = tau*dtheta")
    if solveFor == "theta_rot_dyn" and None not in (k.get("W_rot"), tau) and _nonzero(tau):
        return _result(k["W_rot"] / tau, "dtheta = W / tau", "W = tau*dtheta")
    if solveFor == "P_rot" and None not in (tau, omega_dyn):
        return _result(tau * omega_dyn, "P = tau*omega", "P = tau*omega, the rotational form of P = F*v")
    if solveFor == "tau" and None not in (k.get("P_rot"), omega_dyn) and _nonzero(omega_dyn):
        return _result(k["P_rot"] / omega_dyn, "tau = P / omega", "P = tau*omega")
    if solveFor == "omega_dyn" and None not in (k.get("P_rot"), tau) and _nonzero(tau):
        return _result(k["P_rot"] / tau, "omega = P / tau", "P = tau*omega")

    # --- torque at an angle ---------------------------------------------------
    # Only the perpendicular component of a force twists. Pulling straight along
    # the lever arm produces no torque at all, which is what the sine encodes.
    if solveFor == "theta_tau" and None not in (tau, r_dyn, F_tang) and _nonzero(r_dyn * F_tang):
        ratio = tau / (r_dyn * F_tang)
        if -1 <= ratio <= 1:
            return _result(math.degrees(math.asin(ratio)), "theta = arcsin(tau / (r*F))", "tau = r*F*sin(theta)")
        return None

    # --- angular momentum of a point particle --------------------------------
    if solveFor == "L" and None not in (mass_dyn, v_tang, r_dyn):
        ang = k.get("theta_L")
        s_t = math.sin(math.radians(ang)) if ang is not None else 1.0
        return _result(mass_dyn * v_tang * r_dyn * s_t,
                       "L = m*v*r*sin(theta)" if ang is not None else "L = m*v*r",
                       "Angular momentum of a point particle about the chosen origin")

    # --- angular impulse ------------------------------------------------------
    # The rotational twin of J = F*dt = dp: a torque applied over time changes
    # angular momentum by exactly that much.
    if solveFor == "theta_L" and None not in (L, mass_dyn, v_tang, r_dyn) and _nonzero(mass_dyn * v_tang * r_dyn):
        ratio = L / (mass_dyn * v_tang * r_dyn)
        if -1 <= ratio <= 1:
            return _result(math.degrees(math.asin(ratio)), "theta = arcsin(L / (m*v*r))", "L = m*v*r*sin(theta)")
        return None
    if solveFor == "changeOfL" and None not in (tau, k.get("t_rot")):
        return _result(tau * k["t_rot"], "dL = tau*dt", "Angular impulse: tau*dt = dL")
    if solveFor == "tau" and None not in (k.get("changeOfL"), k.get("t_rot")) and _nonzero(k["t_rot"]):
        return _result(k["changeOfL"] / k["t_rot"], "tau = dL / dt", "Angular impulse: tau*dt = dL")
    if solveFor == "t_rot" and None not in (k.get("changeOfL"), tau) and _nonzero(tau):
        return _result(k["changeOfL"] / tau, "dt = dL / tau", "Angular impulse: tau*dt = dL")

    if solveFor == "v_tang" and omega_dyn is not None and r_dyn is not None:
        return _result(omega_dyn * r_dyn, "v_tang = omega*r", "v_tang = omega*r")
    if solveFor == "omega_dyn" and v_tang is not None and r_dyn is not None and r_dyn != 0:
        return _result(v_tang / r_dyn, "omega = v_tang/r", "v_tang = omega*r")
    if solveFor == "r_dyn" and v_tang is not None and omega_dyn is not None and omega_dyn != 0:
        return _result(v_tang / omega_dyn, "r = v_tang/omega", "v_tang = omega*r")

    return None


def solve_oscillations(k, solveFor):
    A, omega_osc, T_osc, f_osc = k.get("A"), k.get("omega_osc"), k.get("T_osc"), k.get("f_osc")
    x_osc, v_osc, a_osc = k.get("x_osc"), k.get("v_osc"), k.get("a_osc")
    k_osc, mass_osc, phi, E_osc = k.get("k_osc"), k.get("mass_osc"), k.get("phi"), k.get("E_osc")
    T_pend, f_pend, L_pend, t = k.get("T_pend"), k.get("f_pend"), k.get("L_pend"), k.get("t")

    if solveFor == "T_pend" and L_pend is not None:
        return _result(2 * math.pi * (L_pend / G) ** 0.5, "T = 2*pi*sqrt(L/g)", "T_pend = 2*pi*sqrt(L/g)")
    if solveFor == "L_pend" and T_pend is not None:
        return _result(G * (T_pend / (2 * math.pi)) ** 2, "L = g*(T/(2*pi))^2", "T_pend = 2*pi*sqrt(L/g)")
    if solveFor == "f_pend" and T_pend is not None and T_pend != 0:
        return _result(1 / T_pend, "f = 1/T", "f_pend = 1/T_pend")
    if solveFor == "T_pend" and f_pend is not None and f_pend != 0:
        return _result(1 / f_pend, "T = 1/f", "f_pend = 1/T_pend")
    if solveFor == "f_pend" and L_pend is not None:
        return _result((1 / (2 * math.pi)) * (G / L_pend) ** 0.5, "f = (1/(2*pi))*sqrt(g/L)", "f_pend = (1/(2*pi))*sqrt(g/L)")

    if solveFor == "omega_osc" and k_osc is not None and mass_osc is not None and mass_osc != 0:
        return _result((k_osc / mass_osc) ** 0.5, "omega = sqrt(k/mass)", "omega = sqrt(k/m)")
    if solveFor == "k_osc" and omega_osc is not None and mass_osc is not None:
        return _result(omega_osc ** 2 * mass_osc, "k = omega^2*mass", "omega = sqrt(k/m)")
    if solveFor == "mass_osc" and omega_osc is not None and k_osc is not None and omega_osc != 0:
        return _result(k_osc / (omega_osc ** 2), "mass = k/omega^2", "omega = sqrt(k/m)")

    if solveFor == "T_osc" and mass_osc is not None and k_osc is not None and k_osc != 0:
        return _result(2 * math.pi * (mass_osc / k_osc) ** 0.5, "T = 2*pi*sqrt(mass/k)", "T = 2*pi*sqrt(m/k)")
    if solveFor == "mass_osc" and T_osc is not None and k_osc is not None:
        return _result(k_osc * (T_osc / (2 * math.pi)) ** 2, "mass = k*(T/(2*pi))^2", "T = 2*pi*sqrt(m/k)")
    if solveFor == "k_osc" and T_osc is not None and mass_osc is not None and T_osc != 0:
        return _result(mass_osc * (2 * math.pi / T_osc) ** 2, "k = mass*(2pi/T)^2", "T = 2*pi*sqrt(m/k)")

    # --- physical pendulum ----------------------------------------------------
    # A real swinging body is not a point on a string: its own moment of
    # inertia sets the period, and d is the pivot-to-centre-of-mass distance.
    # A simple pendulum is the special case I = mL^2, d = L, which collapses
    # this back to 2*pi*sqrt(L/g).
    if solveFor == "T_phys" and None not in (k.get("I_phys"), k.get("mass_phys"), k.get("d_pivot")):
        denom = k["mass_phys"] * G * k["d_pivot"]
        if _nonzero(denom) and k["I_phys"] / denom >= 0:
            return _result(2 * math.pi * (k["I_phys"] / denom) ** 0.5,
                           "T = 2*pi*sqrt(I / (m*g*d))",
                           "Physical pendulum, with d the pivot-to-centre-of-mass distance")
        return None
    if solveFor == "I_phys" and None not in (k.get("T_phys"), k.get("mass_phys"), k.get("d_pivot")):
        return _result(k["mass_phys"] * G * k["d_pivot"] * (k["T_phys"] / (2 * math.pi)) ** 2,
                       "I = m*g*d*(T/(2*pi))^2", "T = 2*pi*sqrt(I/(m*g*d))")
    if solveFor == "mass_phys" and None not in (k.get("T_phys"), k.get("I_phys"), k.get("d_pivot")):
        denom = G * k["d_pivot"] * (k["T_phys"] / (2 * math.pi)) ** 2
        if _nonzero(denom):
            return _result(k["I_phys"] / denom, "m = I / (g*d*(T/(2*pi))^2)", "T = 2*pi*sqrt(I/(m*g*d))")
        return None
    if solveFor == "k1_comb" and None not in (k.get("k_parallel"), k.get("k2_comb")):
        return _result(k["k_parallel"] - k["k2_comb"], "k1 = k_eq - k2", "Parallel: k_eq = k1 + k2")
    if solveFor == "k2_comb" and None not in (k.get("k_parallel"), k.get("k1_comb")):
        return _result(k["k_parallel"] - k["k1_comb"], "k2 = k_eq - k1", "Parallel: k_eq = k1 + k2")
    if solveFor == "k1_comb" and None not in (k.get("k_series"), k.get("k2_comb")) \
            and _nonzero(k["k2_comb"] - k["k_series"]):
        return _result(k["k_series"] * k["k2_comb"] / (k["k2_comb"] - k["k_series"]),
                       "k1 = k_eq*k2 / (k2 - k_eq)", "Series: 1/k_eq = 1/k1 + 1/k2")
    if solveFor == "k2_comb" and None not in (k.get("k_series"), k.get("k1_comb")) \
            and _nonzero(k["k1_comb"] - k["k_series"]):
        return _result(k["k_series"] * k["k1_comb"] / (k["k1_comb"] - k["k_series"]),
                       "k2 = k_eq*k1 / (k1 - k_eq)", "Series: 1/k_eq = 1/k1 + 1/k2")

    if solveFor == "d_pivot" and None not in (k.get("T_phys"), k.get("I_phys"), k.get("mass_phys")):
        denom = k["mass_phys"] * G * (k["T_phys"] / (2 * math.pi)) ** 2
        if _nonzero(denom):
            return _result(k["I_phys"] / denom, "d = I / (m*g*(T/(2*pi))^2)", "T = 2*pi*sqrt(I/(m*g*d))")
        return None

    # --- springs in combination ------------------------------------------------
    # Parallel springs both stretch by x, so their forces add: k adds.
    # Series springs share the force but split the stretch, so the COMPLIANCES
    # add -- which is why a series pair is always softer than either spring.
    if solveFor == "k_parallel" and None not in (k.get("k1_comb"), k.get("k2_comb")):
        return _result(k["k1_comb"] + k["k2_comb"], "k_eq = k1 + k2",
                       "Parallel: both springs stretch by the same x, so the forces add")
    if solveFor == "k_series" and None not in (k.get("k1_comb"), k.get("k2_comb")):
        tot = k["k1_comb"] + k["k2_comb"]
        if _nonzero(tot):
            return _result(k["k1_comb"] * k["k2_comb"] / tot, "k_eq = k1*k2 / (k1 + k2)",
                           "Series: 1/k_eq = 1/k1 + 1/k2, so the pair is softer than either spring")
        return None

    if solveFor == "f_osc" and T_osc is not None and T_osc != 0:
        return _result(1 / T_osc, "f = 1/T", "f = 1/T")
    if solveFor == "T_osc" and f_osc is not None and f_osc != 0:
        return _result(1 / f_osc, "T = 1/f", "f = 1/T")

    if solveFor == "f_osc" and omega_osc is not None:
        return _result(omega_osc / (2 * math.pi), "f = omega/(2*pi)", "omega = 2*pi*f")
    if solveFor == "omega_osc" and f_osc is not None:
        return _result(2 * math.pi * f_osc, "omega = 2*pi*f", "omega = 2*pi*f")

    if solveFor == "T_osc" and omega_osc is not None and omega_osc != 0:
        return _result((2 * math.pi) / omega_osc, "T = 2*pi/omega", "T = 2*pi/omega")
    if solveFor == "omega_osc" and T_osc is not None and T_osc != 0:
        return _result((2 * math.pi) / T_osc, "omega = 2*pi/T", "T = 2*pi/omega")

    if solveFor == "x_osc" and None not in (A, omega_osc, t, phi):
        return _result(A * math.cos(omega_osc * t + phi), "x = A*cos(omega*t + phi)", "x(t) = A*cos(omega*t + phi)")
    if solveFor == "A" and None not in (x_osc, omega_osc, t, phi):
        cosVal = math.cos(omega_osc * t + phi)
        return _result(x_osc / cosVal, "A = x/cos(omega*t + phi)", "x(t) = A*cos(omega*t + phi)") if _nonzero(cosVal) else None

    if solveFor == "v_osc" and None not in (A, omega_osc, t, phi):
        return _result(-A * omega_osc * math.sin(omega_osc * t + phi), "v = -A*omega*sin(omega*t + phi)", "v(t) = -A*omega*sin(omega*t + phi)")
    if solveFor == "A" and None not in (v_osc, omega_osc, t, phi) and omega_osc != 0:
        sinVal = math.sin(omega_osc * t + phi)
        return _result(-v_osc / (omega_osc * sinVal), "A = -v/(omega*sin(omega*t + phi))", "v(t) = -A*omega*sin(omega*t + phi)") if _nonzero(sinVal) else None

    if solveFor == "a_osc" and None not in (A, omega_osc, t, phi):
        return _result(-A * omega_osc ** 2 * math.cos(omega_osc * t + phi), "a = -A*omega^2*cos(omega*t + phi)", "a(t) = -A*omega^2*cos(omega*t + phi)")

    if solveFor == "v_osc" and A is not None and omega_osc is not None and t is None:
        return _result(A * omega_osc, "v_max = A*omega", "v_max = A*omega (maximum speed)")
    if solveFor == "A" and v_osc is not None and omega_osc is not None and t is None and omega_osc != 0:
        return _result(v_osc / omega_osc, "A = v_max/omega", "v_max = A*omega")

    if solveFor == "E_osc" and k_osc is not None and A is not None:
        return _result(0.5 * k_osc * A ** 2, "E = 0.5*k*A^2", "E = 0.5*k*A^2")
    if solveFor == "A" and E_osc is not None and k_osc is not None and k_osc != 0:
        val = 2 * E_osc / k_osc
        return _result(val ** 0.5, "A = sqrt(2*E/k)", "E = 0.5*k*A^2") if val >= 0 else None
    if solveFor == "k_osc" and E_osc is not None and A is not None and A != 0:
        return _result((2 * E_osc) / (A ** 2), "k = 2*E/A^2", "E = 0.5*k*A^2")

    # Inverting x = A*cos(omega*t + phi) for the phase constant or the time.
    # Both need |x/A| <= 1 for arccos to be defined.
    if solveFor == "phi" and None not in (x_osc, A, omega_osc, t) and _nonzero(A):
        ratio = x_osc / A
        if -1 <= ratio <= 1:
            return _result(math.acos(ratio) - omega_osc * t, "phi = arccos(x/A) - omega*t", "x(t) = A*cos(omega*t + phi)")
        return None
    if solveFor == "t" and None not in (x_osc, A, omega_osc, phi) and _nonzero(A) and _nonzero(omega_osc):
        ratio = x_osc / A
        if -1 <= ratio <= 1:
            return _result((math.acos(ratio) - phi) / omega_osc, "t = (arccos(x/A) - phi) / omega", "x(t) = A*cos(omega*t + phi)")
        return None

    if solveFor == "v_osc" and omega_osc is not None and A is not None and x_osc is not None:
        val = A ** 2 - x_osc ** 2
        return _result(omega_osc * val ** 0.5, "v = omega*sqrt(A^2 - x^2)", "v = omega*sqrt(A^2 - x^2)") if val >= 0 else None
    if solveFor == "x_osc" and v_osc is not None and omega_osc is not None and A is not None and omega_osc != 0:
        val = A ** 2 - (v_osc / omega_osc) ** 2
        return _result(val ** 0.5, "x = sqrt(A^2 - (v/omega)^2)", "v = omega*sqrt(A^2 - x^2)") if val >= 0 else None

    return None


def solve_calc_kinematics(k, solveFor):
    x0, v0, a_const, t_calc = k.get("x0"), k.get("v0"), k.get("a_const"), k.get("t_calc")
    x_t, v_t, a_t = k.get("x_t"), k.get("v_t"), k.get("a_t")
    jerk = k.get("jerk")

    # --- non-constant acceleration ------------------------------------------
    # With a jerk supplied, a(t) = a0 + j·t is genuinely a function of time and
    # the results below come from integrating it, not from the constant-a
    # shortcuts. Without one, everything falls through to the standard forms.
    if jerk is not None and _nonzero(jerk):
        if solveFor == "a_t" and None not in (a_const, t_calc):
            return _result(a_const + jerk * t_calc, "a(t) = a0 + j*t", "a(t) = a0 + ∫j dt")
        if solveFor == "v_t" and None not in (v0, a_const, t_calc):
            return _result(
                v0 + a_const * t_calc + 0.5 * jerk * t_calc ** 2,
                "v(t) = v0 + a0*t + ½*j*t^2",
                "v(t) = ∫(a0 + j·t) dt",
            )
        if solveFor == "x_t" and None not in (x0, v0, a_const, t_calc):
            return _result(
                x0 + v0 * t_calc + 0.5 * a_const * t_calc ** 2 + (jerk * t_calc ** 3) / 6,
                "x(t) = x0 + v0*t + ½*a0*t^2 + (1/6)*j*t^3",
                "x(t) = ∫∫(a0 + j·t) dt dt",
            )
        if solveFor == "jerk" and None not in (a_t, a_const, t_calc) and _nonzero(t_calc):
            return _result((a_t - a_const) / t_calc, "j = (a(t) - a0) / t", "a(t) = a0 + j·t")

    if solveFor == "jerk" and None not in (a_t, a_const, t_calc) and _nonzero(t_calc):
        return _result((a_t - a_const) / t_calc, "j = (a(t) - a0) / t", "a(t) = a0 + j·t")

    if solveFor == "x_t" and None not in (x0, v0, a_const, t_calc):
        return _result(x0 + v0 * t_calc + 0.5 * a_const * t_calc ** 2, "x(t) = x0 + v0*t + 0.5*a*t^2", "x(t) = ∫v(t)dt = x0 + v0*t + 0.5*a*t^2")
    if solveFor == "x_t" and None not in (x0, v0, t_calc) and a_const is None:
        return _result(x0 + v0 * t_calc, "x(t) = x0 + v0*t (a=0)", "x(t) = ∫v(t)dt, a=0")
    if solveFor == "v_t" and None not in (v0, a_const, t_calc):
        return _result(v0 + a_const * t_calc, "v(t) = v0 + a*t", "v(t) = ∫a(t)dt = v0 + a*t")
    if solveFor == "v_t" and v0 is not None and t_calc is not None and a_const is None:
        return _result(v0, "v(t) = v0 (a=0)", "v(t) = ∫a(t)dt, a=0")
    if solveFor == "a_t" and a_const is not None:
        return _result(a_const, "a(t) = a (constant)", "a(t) = dv/dt = constant")
    if solveFor == "v0" and None not in (x_t, x0, a_const, t_calc) and t_calc != 0:
        return _result((x_t - x0 - 0.5 * a_const * t_calc ** 2) / t_calc, "v0 = (x(t) - x0 - 0.5*a*t^2)/t", "x(t) = x0 + v0*t + 0.5*a*t^2")
    if solveFor == "x0" and None not in (x_t, v0, a_const, t_calc):
        return _result(x_t - v0 * t_calc - 0.5 * a_const * t_calc ** 2, "x0 = x(t) - v0*t - 0.5*a*t^2", "x(t) = x0 + v0*t + 0.5*a*t^2")
    if solveFor == "a_const" and None not in (v_t, v0, t_calc) and t_calc != 0:
        return _result((v_t - v0) / t_calc, "a = (v(t) - v0)/t", "v(t) = v0 + a*t")
    if solveFor == "t_calc" and None not in (v_t, v0, a_const) and a_const != 0:
        return _result((v_t - v0) / a_const, "t = (v(t) - v0)/a", "v(t) = v0 + a*t")
    return None


def solve_calc_rotational(k, solveFor):
    theta0, omega0, alpha_t, t_calc = k.get("theta0_calc"), k.get("omega0_calc"), k.get("alpha_t"), k.get("t_calc")
    theta_t, omega_t = k.get("theta_t"), k.get("omega_t")

    if solveFor == "theta_t" and None not in (theta0, omega0, alpha_t, t_calc):
        return _result(theta0 + omega0 * t_calc + 0.5 * alpha_t * t_calc ** 2, "theta(t) = theta0 + omega0*t + 0.5*alpha*t^2", "theta(t) = ∫omega(t)dt")
    if solveFor == "theta_t" and None not in (theta0, omega0, t_calc) and alpha_t is None:
        return _result(theta0 + omega0 * t_calc, "theta(t) = theta0 + omega0*t (alpha=0)", "theta(t) = ∫omega(t)dt, alpha=0")
    if solveFor == "omega_t" and None not in (omega0, alpha_t, t_calc):
        return _result(omega0 + alpha_t * t_calc, "omega(t) = omega0 + alpha*t", "omega(t) = ∫alpha(t)dt")
    if solveFor == "omega_t" and omega0 is not None and t_calc is not None and alpha_t is None:
        return _result(omega0, "omega(t) = omega0 (alpha=0)", "omega(t) = ∫alpha(t)dt, alpha=0")
    if solveFor == "alpha_t" and None not in (omega_t, omega0, t_calc) and t_calc != 0:
        return _result((omega_t - omega0) / t_calc, "alpha = (omega(t) - omega0)/t", "omega(t) = omega0 + alpha*t")
    if solveFor == "omega0_calc" and None not in (theta_t, theta0, alpha_t, t_calc) and t_calc != 0:
        return _result((theta_t - theta0 - 0.5 * alpha_t * t_calc ** 2) / t_calc, "omega0 = (theta(t) - theta0 - 0.5*alpha*t^2)/t", "theta(t) = theta0 + omega0*t + 0.5*alpha*t^2")
    if solveFor == "theta0_calc" and None not in (theta_t, omega0, alpha_t, t_calc):
        return _result(theta_t - omega0 * t_calc - 0.5 * alpha_t * t_calc ** 2, "theta0 = theta(t) - omega0*t - 0.5*alpha*t^2", "theta(t) = theta0 + omega0*t + 0.5*alpha*t^2")
    if solveFor == "t_calc" and None not in (omega_t, omega0, alpha_t) and alpha_t != 0:
        return _result((omega_t - omega0) / alpha_t, "t = (omega(t) - omega0)/alpha", "omega(t) = omega0 + alpha*t")
    return None


def solve_calc_workenergy(k, solveFor):
    W_calc, F_calc, dx_calc = k.get("W_calc"), k.get("F_calc"), k.get("dx_calc")
    KE_calc, PE_calc, E_total_calc = k.get("KE_calc"), k.get("PE_calc"), k.get("E_total_calc")
    mass, v, spring_k, dspring = k.get("mass"), k.get("v"), k.get("k"), k.get("dspring")
    costheta = k.get("costheta")

    if solveFor == "W_calc" and F_calc is not None and dx_calc is not None and costheta is not None:
        return _result(F_calc * dx_calc * costheta, "W = F*dx*cos(theta)", "W = ∫F dx (constant F, with angle)")
    if solveFor == "W_calc" and F_calc is not None and dx_calc is not None and costheta is None:
        return _result(F_calc * dx_calc, "W = F*dx", "W = ∫F dx (constant F, angle=0)")
    if solveFor == "F_calc" and W_calc is not None and dx_calc is not None and costheta is not None and _nonzero(dx_calc * costheta):
        return _result(W_calc / (dx_calc * costheta), "F = W/(dx*cos(theta))", "W = F*dx*cos(theta)")
    if solveFor == "F_calc" and W_calc is not None and dx_calc is not None and costheta is None and dx_calc != 0:
        return _result(W_calc / dx_calc, "F = W/dx", "W = F*dx")
    if solveFor == "dx_calc" and W_calc is not None and F_calc is not None and costheta is not None and _nonzero(F_calc * costheta):
        return _result(W_calc / (F_calc * costheta), "dx = W/(F*cos(theta))", "W = F*dx*cos(theta)")
    if solveFor == "dx_calc" and W_calc is not None and F_calc is not None and costheta is None and F_calc != 0:
        return _result(W_calc / F_calc, "dx = W/F", "W = F*dx")

    if solveFor == "KE_calc" and mass is not None and v is not None:
        return _result(0.5 * mass * v ** 2, "KE = 0.5*mass*v^2", "KE = 0.5*mv^2 (from ∫F=ma)")
    if solveFor == "mass" and KE_calc is not None and v is not None and v != 0:
        return _result((2 * KE_calc) / (v ** 2), "mass = 2*KE/v^2", "KE = 0.5*mv^2")
    if solveFor == "v" and KE_calc is not None and mass is not None and mass != 0:
        val = 2 * KE_calc / mass
        return _result(val ** 0.5, "v = sqrt(2*KE/mass)", "KE = 0.5*mv^2") if val >= 0 else None

    if solveFor == "PE_calc" and spring_k is not None and dspring is not None:
        return _result(0.5 * spring_k * dspring ** 2, "PE = 0.5*k*x^2", "PE = ∫kx dx = 0.5*k*x^2")
    if solveFor == "k" and PE_calc is not None and dspring is not None and dspring != 0:
        return _result((2 * PE_calc) / (dspring ** 2), "k = 2*PE/x^2", "PE = 0.5*k*x^2")
    if solveFor == "dspring" and PE_calc is not None and spring_k is not None and spring_k != 0:
        val = 2 * PE_calc / spring_k
        return _result(val ** 0.5, "x = sqrt(2*PE/k)", "PE = 0.5*k*x^2") if val >= 0 else None

    # --- force from a potential-energy curve ----------------------------------
    # F = -dU/dx is why a U(x) graph is readable at a glance: the force is
    # minus the slope, so the object is pushed DOWNHILL on the energy curve,
    # and equilibrium sits wherever the curve is flat.
    if solveFor == "F_from_U" and None not in (k.get("dU"), k.get("dx_U")) and _nonzero(k["dx_U"]):
        return _result(-k["dU"] / k["dx_U"], "F = -dU/dx",
                       "The force is minus the SLOPE of the potential-energy curve")
    if solveFor == "dx_U" and None not in (k.get("F_from_U"), k.get("dU")) and _nonzero(k["F_from_U"]):
        return _result(-k["dU"] / k["F_from_U"], "dx = -dU / F", "F = -dU/dx, rearranged")
    if solveFor == "dU" and None not in (k.get("F_from_U"), k.get("dx_U")):
        return _result(-k["F_from_U"] * k["dx_U"], "dU = -F*dx", "F = -dU/dx, rearranged")
    # For a spring, U = 0.5*k*x^2, so the slope gives back Hooke's law exactly.
    if solveFor == "F_from_U" and None not in (spring_k, dspring):
        return _result(-spring_k * dspring, "F = -d/dx(0.5*k*x^2) = -k*x",
                       "Differentiating the spring's potential energy returns Hooke's law")

    if solveFor == "E_total_calc" and KE_calc is not None and PE_calc is not None:
        return _result(KE_calc + PE_calc, "E_total = KE + PE", "E_total = KE + PE (conservation of energy)")
    if solveFor == "KE_calc" and E_total_calc is not None and PE_calc is not None:
        return _result(E_total_calc - PE_calc, "KE = E_total - PE", "E_total = KE + PE")
    if solveFor == "PE_calc" and E_total_calc is not None and KE_calc is not None:
        return _result(E_total_calc - KE_calc, "PE = E_total - KE", "E_total = KE + PE")

    return None


def solve_calc_oscillations(k, solveFor):
    A_calc, omega_calc, phi_calc, t_osc_calc = k.get("A_calc"), k.get("omega_calc"), k.get("phi_calc"), k.get("t_osc_calc")
    x_calc, v_calc, a_calc = k.get("x_calc"), k.get("v_calc"), k.get("a_calc")

    if solveFor == "x_calc" and None not in (A_calc, omega_calc, t_osc_calc, phi_calc):
        return _result(A_calc * math.cos(omega_calc * t_osc_calc + phi_calc), "x(t) = A*cos(omega*t + phi)", "x(t) = A*cos(omega*t + phi)")
    if solveFor == "x_calc" and None not in (A_calc, omega_calc, t_osc_calc) and phi_calc is None:
        return _result(A_calc * math.cos(omega_calc * t_osc_calc), "x(t) = A*cos(omega*t) (phi=0)", "x(t) = A*cos(omega*t), phi=0")

    if solveFor == "v_calc" and None not in (A_calc, omega_calc, t_osc_calc, phi_calc):
        return _result(-A_calc * omega_calc * math.sin(omega_calc * t_osc_calc + phi_calc), "v(t) = -A*omega*sin(omega*t + phi)", "v(t) = d/dt[A*cos(omega*t + phi)]")
    if solveFor == "v_calc" and None not in (A_calc, omega_calc, t_osc_calc) and phi_calc is None:
        return _result(-A_calc * omega_calc * math.sin(omega_calc * t_osc_calc), "v(t) = -A*omega*sin(omega*t) (phi=0)", "v(t) = d/dt[A*cos(omega*t)]")

    if solveFor == "a_calc" and None not in (A_calc, omega_calc, t_osc_calc, phi_calc):
        return _result(-A_calc * omega_calc ** 2 * math.cos(omega_calc * t_osc_calc + phi_calc), "a(t) = -A*omega^2*cos(omega*t + phi)", "a(t) = d^2/dt^2[A*cos(omega*t + phi)]")
    if solveFor == "a_calc" and None not in (A_calc, omega_calc, t_osc_calc) and phi_calc is None:
        return _result(-A_calc * omega_calc ** 2 * math.cos(omega_calc * t_osc_calc), "a(t) = -A*omega^2*cos(omega*t) (phi=0)", "a(t) = d^2/dt^2[A*cos(omega*t)]")

    if solveFor == "A_calc" and x_calc is not None and phi_calc is not None:
        cosVal = math.cos(phi_calc)
        return _result(x_calc / cosVal, "A = x(0)/cos(phi)", "x(0) = A*cos(phi)") if _nonzero(cosVal) else None

    if solveFor == "phi_calc" and None not in (x_calc, A_calc, omega_calc, t_osc_calc) and _nonzero(A_calc):
        ratio = x_calc / A_calc
        if -1 <= ratio <= 1:
            return _result(math.acos(ratio) - omega_calc * t_osc_calc, "phi = arccos(x/A) - omega*t", "x(t) = A*cos(omega*t + phi)")
        return None
    if solveFor == "t_osc_calc" and None not in (x_calc, A_calc, omega_calc, phi_calc) and _nonzero(A_calc) and _nonzero(omega_calc):
        ratio = x_calc / A_calc
        if -1 <= ratio <= 1:
            return _result((math.acos(ratio) - phi_calc) / omega_calc, "t = (arccos(x/A) - phi) / omega", "x(t) = A*cos(omega*t + phi)")
        return None

    if solveFor == "omega_calc" and a_calc is not None and x_calc is not None and x_calc != 0:
        val = -a_calc / x_calc
        return _result(val ** 0.5, "omega = sqrt(-a/x)", "a(t) = -omega^2*x(t)") if val >= 0 else None

    return None


def solve_atwood(k, solveFor):
    m1, m2, a, T = k.get("m1"), k.get("m2"), k.get("a"), k.get("T")

    if solveFor == "a":
        if m1 is not None and m2 is not None and (m1 + m2) != 0:
            return _result((m2 - m1) * G / (m1 + m2), "a = (m2 - m1)*g / (m1 + m2)", "a = (m2 - m1)g/(m1 + m2), taking m2 as the descending mass")
        if T is not None and m1 is not None and m1 != 0:
            return _result(T / m1 - G, "a = T/m1 - g", "T = m1*(g + a)")
        if T is not None and m2 is not None and m2 != 0:
            return _result(G - T / m2, "a = g - T/m2", "T = m2*(g - a)")

    if solveFor == "T":
        if m1 is not None and m2 is not None and (m1 + m2) != 0:
            return _result(2 * m1 * m2 * G / (m1 + m2), "T = 2*m1*m2*g / (m1 + m2)", "T = 2m1m2g/(m1 + m2)")
        if m1 is not None and a is not None:
            return _result(m1 * (G + a), "T = m1*(g + a)", "T = m1*(g + a)")
        if m2 is not None and a is not None:
            return _result(m2 * (G - a), "T = m2*(g - a)", "T = m2*(g - a)")

    if solveFor == "m1":
        if m2 is not None and a is not None and _nonzero(G + a):
            return _result(m2 * (G - a) / (G + a), "m1 = m2*(g - a) / (g + a)", "a = (m2 - m1)g/(m1 + m2)")
        if T is not None and a is not None and _nonzero(G + a):
            return _result(T / (G + a), "m1 = T / (g + a)", "T = m1*(g + a)")

    if solveFor == "m2":
        if m1 is not None and a is not None and _nonzero(G - a):
            return _result(m1 * (G + a) / (G - a), "m2 = m1*(g + a) / (g - a)", "a = (m2 - m1)g/(m1 + m2)")
        if T is not None and a is not None and _nonzero(G - a):
            return _result(T / (G - a), "m2 = T / (g - a)", "T = m2*(g - a)")

    return None


def solve_atwood_flywheel(k, solveFor):
    m1, m2 = k.get("m1"), k.get("m2")
    a, T1, T2 = k.get("a"), k.get("T1"), k.get("T2")
    I, r = k.get("I_pulley"), k.get("r_pulley")

    if solveFor == "a" and None not in (m1, m2, I, r) and r != 0:
        denom = m1 + m2 + I / (r ** 2)
        if _nonzero(denom):
            return _result(
                (m2 - m1) * G / denom,
                "a = (m2 - m1)*g / (m1 + m2 + I/r^2)",
                "a = (m2 - m1)g / (m1 + m2 + I/r^2)",
            )

    if solveFor == "T1" and m1 is not None and a is not None:
        return _result(m1 * (G + a), "T1 = m1*(g + a)", "T1 = m1*(g + a)")

    if solveFor == "T2" and m2 is not None and a is not None:
        return _result(m2 * (G - a), "T2 = m2*(g - a)", "T2 = m2*(g - a)")

    if solveFor == "I_pulley" and None not in (m1, m2, a, r) and _nonzero(a):
        bracket = (m2 - m1) * G / a - (m1 + m2)
        # A negative bracket means the stated acceleration is impossible for
        # those masses; reporting it would hand back a negative inertia.
        if bracket <= 0:
            return None
        return _result(bracket * (r ** 2), "I = r^2 * [(m2 - m1)*g/a - (m1 + m2)]", "a = (m2 - m1)g / (m1 + m2 + I/r^2)")

    if solveFor == "r_pulley" and None not in (m1, m2, a, I) and _nonzero(a):
        denom = (m2 - m1) * G / a - (m1 + m2)
        if denom > 0:
            return _result((I / denom) ** 0.5, "r = sqrt(I / [(m2 - m1)*g/a - (m1 + m2)])", "a = (m2 - m1)g / (m1 + m2 + I/r^2)")
        return None

    # Rearranging a = (m2 - m1)g / (m1 + m2 + I/r^2) for either hanging mass.
    # Writing C = I/r^2, the relation is linear in each mass separately.
    if solveFor == "m1" and None not in (m2, a, I, r) and r != 0 and _nonzero(G + a):
        C = I / (r ** 2)
        return _result((m2 * (G - a) - a * C) / (G + a), "m1 = [m2*(g - a) - a*I/r^2] / (g + a)", "a = (m2 - m1)g / (m1 + m2 + I/r^2)")
    if solveFor == "m2" and None not in (m1, a, I, r) and r != 0 and _nonzero(G - a):
        C = I / (r ** 2)
        return _result((m1 * (G + a) + a * C) / (G - a), "m2 = [m1*(g + a) + a*I/r^2] / (g - a)", "a = (m2 - m1)g / (m1 + m2 + I/r^2)")

    if solveFor == "T1" and m1 is not None and T2 is not None and m2 is not None and _nonzero(m2):
        return _result(m1 * (2 * G - T2 / m2), "T1 = m1*(2g - T2/m2)", "T1 = m1*(g + a),  T2 = m2*(g - a)")
    if solveFor == "T2" and m2 is not None and T1 is not None and m1 is not None and _nonzero(m1):
        return _result(m2 * (2 * G - T1 / m1), "T2 = m2*(2g - T1/m1)", "T1 = m1*(g + a),  T2 = m2*(g - a)")

    return None


def solve_rolling_race(k, solveFor):
    kShape, h, v, theta, a = k.get("k_shape"), k.get("h_roll"), k.get("v_roll"), k.get("theta_roll"), k.get("a_roll")

    if solveFor == "v_roll" and h is not None and kShape is not None and _nonzero(1 + kShape):
        val = 2 * G * h / (1 + kShape)
        return _result(val ** 0.5, "v = sqrt(2*g*h / (1 + k))", "mgh = 0.5*m*v^2*(1 + k)") if val >= 0 else None

    if solveFor == "h_roll" and v is not None and kShape is not None:
        return _result(v ** 2 * (1 + kShape) / (2 * G), "h = v^2*(1 + k) / (2*g)", "mgh = 0.5*m*v^2*(1 + k)")

    if solveFor == "k_shape" and v is not None and h is not None and _nonzero(v ** 2):
        # k = I/(mR^2) is bounded by 0 < k <= 1 for a body rolling about its
        # own symmetry axis, k = 1 being a hoop with every gram at the rim.
        # Outside that range the numbers describe no rolling object -- most
        # likely it slipped, so energy went to friction.
        _k = (2 * G * h) / (v ** 2) - 1
        if not 0 < _k <= 1:
            return None
        return _result(_k, "k = 2*g*h/v^2 - 1", "mgh = 0.5*m*v^2*(1 + k)")

    if solveFor == "a_roll" and theta is not None and kShape is not None and _nonzero(1 + kShape):
        return _result(G * math.sin(theta) / (1 + kShape), "a = g*sin(theta) / (1 + k)", "a = g*sin(theta) / (1 + k)")

    if solveFor == "theta_roll" and a is not None and kShape is not None:
        val = a * (1 + kShape) / G
        return _result(math.asin(val), "theta = asin(a*(1 + k) / g)", "a = g*sin(theta) / (1 + k)") if -1 <= val <= 1 else None

    if solveFor == "k_shape" and a is not None and theta is not None and _nonzero(a):
        return _result(G * math.sin(theta) / a - 1, "k = g*sin(theta)/a - 1", "a = g*sin(theta) / (1 + k)")

    return None


def solve_loop_coaster(k, solveFor):
    R, h = k.get("R_loop"), k.get("h_loop")
    vTop, vBottom = k.get("v_top"), k.get("v_bottom_loop")
    vMin, hMin = k.get("v_min_loop"), k.get("h_min_loop")
    Ntop, Nbottom, mass = k.get("N_top"), k.get("N_bottom"), k.get("mass_loop")

    if solveFor == "v_top" and h is not None and R is not None:
        val = 2 * G * (h - 2 * R)
        return _result(val ** 0.5, "v_top = sqrt(2*g*(h - 2R))", "mgh = mg(2R) + 0.5*m*v_top^2") if val >= 0 else None

    if solveFor == "h_loop" and vTop is not None and R is not None:
        return _result(vTop ** 2 / (2 * G) + 2 * R, "h = v_top^2/(2g) + 2R", "mgh = mg(2R) + 0.5*m*v_top^2")

    if solveFor == "v_bottom_loop" and h is not None:
        # A negative height under the root yields a complex number, not an error.
        return _result((2 * G * h) ** 0.5, "v_bottom = sqrt(2*g*h)", "mgh = 0.5*m*v_bottom^2") if h >= 0 else None

    if solveFor == "h_loop" and vBottom is not None:
        return _result(vBottom ** 2 / (2 * G), "h = v_bottom^2 / (2g)", "mgh = 0.5*m*v_bottom^2")

    if solveFor == "v_min_loop" and R is not None:
        return _result((G * R) ** 0.5, "v_min = sqrt(g*R)", "mg = m*v_min^2/R  (N = 0 at the top)")

    if solveFor == "R_loop" and vMin is not None:
        return _result(vMin ** 2 / G, "R = v_min^2 / g", "mg = m*v_min^2/R")

    if solveFor == "h_min_loop" and R is not None:
        return _result(2.5 * R, "h_min = 2.5*R", "h_min = 2R + R/2")

    if solveFor == "R_loop" and hMin is not None:
        return _result(hMin / 2.5, "R = h_min / 2.5", "h_min = 2.5*R")

    if solveFor == "N_top" and None not in (mass, vTop, R) and R != 0:
        # The track is a one-sided constraint: it can push inward, never pull.
        # A negative N means the cart already left the track before the top,
        # which needs v_top >= sqrt(g*R) to avoid -- so report "impossible"
        # rather than a negative normal force.
        if vTop ** 2 < G * R:
            return None
        return _result(mass * (vTop ** 2 / R - G), "N_top = m*(v_top^2/R - g)", "N_top + mg = m*v_top^2/R")

    if solveFor == "N_bottom" and None not in (mass, vBottom, R) and R != 0:
        return _result(mass * (vBottom ** 2 / R + G), "N_bottom = m*(v_bottom^2/R + g)", "N_bottom - mg = m*v_bottom^2/R")

    if solveFor == "mass_loop" and None not in (Ntop, vTop, R) and R != 0:
        denom = vTop ** 2 / R - G
        if _nonzero(denom):
            return _result(Ntop / denom, "m = N_top / (v_top^2/R - g)", "N_top + mg = m*v_top^2/R")
        return None
    if solveFor == "mass_loop" and None not in (Nbottom, vBottom, R) and R != 0:
        denom = vBottom ** 2 / R + G
        if _nonzero(denom):
            return _result(Nbottom / denom, "m = N_bottom / (v_bottom^2/R + g)", "N_bottom - mg = m*v_bottom^2/R")
        return None

    return None


def solve_ballistic_pendulum(k, solveFor):
    m1, v1i, m2 = k.get("m1_bp"), k.get("v1i_bp"), k.get("m2_bp")
    vc, h = k.get("v_common_bp"), k.get("h_bp")

    if solveFor == "v_common_bp":
        if None not in (m1, v1i, m2) and (m1 + m2) != 0:
            return _result(m1 * v1i / (m1 + m2), "vc = m1*v1i / (m1 + m2)", "m1*v1i = (m1 + m2)*vc")
        if h is not None and h >= 0:
            return _result((2 * G * h) ** 0.5, "vc = sqrt(2*g*h)", "0.5*(m1+m2)*vc^2 = (m1+m2)*g*h")

    if solveFor == "v1i_bp":
        if None not in (vc, m1, m2) and m1 != 0:
            return _result(vc * (m1 + m2) / m1, "v1i = vc*(m1 + m2) / m1", "m1*v1i = (m1 + m2)*vc")
        if None not in (h, m1, m2) and m1 != 0 and h >= 0:
            return _result((2 * G * h) ** 0.5 * (m1 + m2) / m1, "v1i = sqrt(2*g*h)*(m1 + m2)/m1", "m1*v1i = (m1+m2)*sqrt(2gh)")

    if solveFor == "h_bp" and vc is not None:
        return _result(vc ** 2 / (2 * G), "h = vc^2 / (2*g)", "0.5*(m1+m2)*vc^2 = (m1+m2)*g*h")

    if solveFor == "m2_bp" and None not in (m1, v1i, vc) and _nonzero(vc):
        return _result(m1 * v1i / vc - m1, "m2 = m1*v1i/vc - m1", "m1*v1i = (m1 + m2)*vc")

    if solveFor == "m1_bp" and None not in (v1i, m2, vc) and _nonzero(v1i - vc):
        return _result(vc * m2 / (v1i - vc), "m1 = vc*m2 / (v1i - vc)", "m1*v1i = (m1 + m2)*vc")

    return None


def _orbital_closure(k):
    """Work out the quantities that follow immediately from the ones given.

    A student is told "a satellite orbits 400 km above the Earth" and asked for
    the period. That is two steps -- r = R + altitude, then Kepler III -- and a
    solver that fires exactly one equation per request could not do it. The
    chapter's own reference card, its wizard and its tip all describe chains
    like this one, so the engine has to be able to follow them.

    Only DEFINITIONAL steps go here: converting altitude to radius, averaging
    the apsides, and expanding the e = 0 circle. Nothing that needs G or M, so
    the real physics still happens in the branches below and still gets shown
    as the equation the answer came from.

    Returns (knowns, chain) where chain names each step that was taken.
    """
    k = dict(k)
    chain = []

    used = {}

    def note(key, value, text, equation=None):
        if k.get(key) is None and value is not None:
            k[key] = value
            chain.append(text)
            # Remember HOW, not just that. A fixed label per key reported
            # "r_peri = 2a - r_apo" for a value actually reached through
            # a(1 - e), so the printed working contradicted the answer.
            if equation:
                used[key] = equation

    # Run to a fixed point: each step can unlock the next, and there are only a
    # handful, so a few passes settle it. The bound stops any accidental cycle.
    for _ in range(4):
        before = len(chain)

        # Radius is measured from the centre; altitude is not.
        if k.get("R_body") is not None:
            if k.get("altitude") is not None:
                note("r_orb", k["R_body"] + k["altitude"],
                     f"r = R_body + altitude = {k['R_body'] + k['altitude']:.6g} m",
                     "r = R_body + altitude")
            elif k.get("r_orb") is not None:
                note("altitude", k["r_orb"] - k["R_body"],
                     f"altitude = r - R_body = {k['r_orb'] - k['R_body']:.6g} m",
                     "altitude = r - R_body")

        # A circle is the ellipse with e = 0: the radius IS the semi-major
        # axis, and the two apsides coincide with it.
        if k.get("e_orb") == 0:
            if k.get("a_semi") is None and k.get("r_orb") is not None:
                note("a_semi", k["r_orb"], "a = r, because e = 0 makes the orbit a circle", "a = r")
            elif k.get("r_orb") is None and k.get("a_semi") is not None:
                note("r_orb", k["a_semi"], "r = a, because e = 0 makes the orbit a circle", "r = a")
            if k.get("a_semi") is not None:
                note("r_peri", k["a_semi"], "r_peri = a for a circle", "r_peri = a")
                note("r_apo", k["a_semi"], "r_apo = a for a circle", "r_apo = a")

        # The major axis spans perihelion to aphelion.
        if None not in (k.get("r_peri"), k.get("r_apo")):
            note("a_semi", (k["r_peri"] + k["r_apo"]) / 2,
                 f"a = (r_peri + r_apo)/2 = {(k['r_peri'] + k['r_apo']) / 2:.6g} m",
                 "a = (r_peri + r_apo) / 2")
        if None not in (k.get("a_semi"), k.get("e_orb")):
            note("r_peri", k["a_semi"] * (1 - k["e_orb"]),
                 f"r_peri = a(1 - e) = {k['a_semi'] * (1 - k['e_orb']):.6g} m",
                 "r_peri = a*(1 - e)")
            note("r_apo", k["a_semi"] * (1 + k["e_orb"]),
                 f"r_apo = a(1 + e) = {k['a_semi'] * (1 + k['e_orb']):.6g} m",
                 "r_apo = a*(1 + e)")
        if None not in (k.get("a_semi"), k.get("r_peri")) and k.get("r_apo") is None:
            note("r_apo", 2 * k["a_semi"] - k["r_peri"],
                 f"r_apo = 2a - r_peri = {2 * k['a_semi'] - k['r_peri']:.6g} m",
                 "r_apo = 2*a - r_peri")
        if None not in (k.get("a_semi"), k.get("r_apo")) and k.get("r_peri") is None:
            note("r_peri", 2 * k["a_semi"] - k["r_apo"],
                 f"r_peri = 2a - r_apo = {2 * k['a_semi'] - k['r_apo']:.6g} m",
                 "r_peri = 2*a - r_apo")

        # One physical step earns its place here, because it is how orbital
        # elements are actually determined: given where a body is and how fast
        # it is going, vis-viva fixes the size of its orbit. Without it a state
        # vector could reach the semi-major axis but never the period.
        if (k.get("a_semi") is None and k.get("M_central") is not None
                and None not in (k.get("r_orb"), k.get("v_at_r"))):
            mu_local = BIG_G * k["M_central"]
            denom = 2 / k["r_orb"] - k["v_at_r"] ** 2 / mu_local
            if _nonzero(denom, 1e-30):
                note("a_semi", 1 / denom,
                     f"a = 1/(2/r - v²/GM) = {1 / denom:.6g} m, by vis-viva",
                     "a = 1 / (2/r - v^2/(G*M))")

        if len(chain) == before:
            break

    return k, chain, used


def _orbital_was_derived(key, chain):
    """True when the closure -- not the reader -- supplied this quantity."""
    prefixes = {
        "r_orb": "r =", "altitude": "altitude =", "a_semi": "a =",
        "r_peri": "r_peri", "r_apo": "r_apo",
    }
    head = prefixes.get(key)
    return bool(head) and any(step.startswith(head) for step in chain)


def solve_orbital(k, solveFor):
    """Orbital mechanics: Kepler's three laws, vis-viva, and orbital energy.

    The central body is M throughout. Distances are measured from the CENTRE
    of the central body, not from its surface, which is the single most common
    place a satellite problem goes wrong -- hence the explicit radius/altitude
    pair rather than one ambiguous "distance".

    Sign convention: bound orbits have negative total energy. E = 0 is the
    parabolic escape trajectory and E > 0 is hyperbolic, so the sign of E is
    the answer to "will it come back?".
    """
    given = set(kk for kk, vv in k.items() if vv is not None)
    k, chain, closure_used = _orbital_closure(k)
    # What the closure worked out, so the frontend can substitute it into the
    # displayed working. Without this the answer chains but the line beneath it
    # is withheld, because the intermediate is in no one's list of knowns.
    derived = {kk: vv for kk, vv in k.items() if vv is not None and kk not in given}

    M, m = k.get("M_central"), k.get("m_sat")
    a, e = k.get("a_semi"), k.get("e_orb")
    rPeri, rApo = k.get("r_peri"), k.get("r_apo")
    vPeri, vApo = k.get("v_peri"), k.get("v_apo")
    r, v = k.get("r_orb"), k.get("v_at_r")
    T, E = k.get("T_kepler"), k.get("E_orb")
    R_body, alt = k.get("R_body"), k.get("altitude")
    vCirc = k.get("v_circ")

    mu = BIG_G * M if M is not None else None

    # An ellipse cannot have its far point nearer than its near point, and the
    # e formula happily returns a negative eccentricity for it -- a number the
    # app refuses to accept as INPUT for the same quantity.
    if None not in (rPeri, rApo) and rApo < rPeri:
        return None

    CLOSURE_EQUATIONS = {
        "r_orb": ("r = R_body + altitude", "Orbital radius is measured from the CENTRE of the body"),
        "altitude": ("altitude = r - R_body", "Orbital radius is measured from the CENTRE of the body"),
        "a_semi": ("a = (r_peri + r_apo) / 2", "The major axis spans perihelion to aphelion"),
        "r_peri": ("r_peri = 2a - r_apo", "The two apsides average to the semi-major axis"),
        "r_apo": ("r_apo = 2a - r_peri", "The two apsides average to the semi-major axis"),
    }

    def out(value, equation, origin):
        """Attach whatever had to be worked out first, so the reader sees the
        whole route rather than a formula fed by numbers from nowhere."""
        res = _result(value, equation, origin)
        if res is not None and chain:
            res["chain"] = chain
            res["derived"] = derived
        return res

    # The closure may already have worked the target out from definitions
    # alone. That is a complete answer, not a step towards one.
    if solveFor in closure_used:
        eq = closure_used[solveFor]
        origin = CLOSURE_EQUATIONS.get(solveFor, (eq, "Follows from the definitions alone"))[1]
        return out(k[solveFor], eq, origin)

    # --- Kepler's first law: the geometry of the ellipse --------------------
    if solveFor == "r_peri" and None not in (a, e):
        return out(a * (1 - e), "r_peri = a*(1 - e)", "Kepler I: the orbit is an ellipse with M at one focus")
    if solveFor == "r_apo" and None not in (a, e):
        return out(a * (1 + e), "r_apo = a*(1 + e)", "Kepler I: the orbit is an ellipse with M at one focus")
    if solveFor == "a_semi" and None not in (rPeri, rApo):
        return out((rPeri + rApo) / 2, "a = (r_peri + r_apo) / 2", "The major axis spans perihelion to aphelion")
    if solveFor == "e_orb" and None not in (rPeri, rApo) and _nonzero(rPeri + rApo):
        return out((rApo - rPeri) / (rApo + rPeri), "e = (r_apo - r_peri) / (r_apo + r_peri)", "Kepler I: e measures how far the focus sits from the centre")
    if solveFor == "a_semi" and None not in (rPeri, e) and _nonzero(1 - e):
        return out(rPeri / (1 - e), "a = r_peri / (1 - e)", "r_peri = a(1 - e)")
    if solveFor == "e_orb" and None not in (rPeri, a) and _nonzero(a):
        return out(1 - rPeri / a, "e = 1 - r_peri/a", "r_peri = a(1 - e)")

    # --- Kepler's second law: equal areas means constant angular momentum ---
    # At perihelion and aphelion the velocity is perpendicular to the radius,
    # so L = mvr reduces to r_peri*v_peri = r_apo*v_apo with no sine factor.
    if solveFor == "v_apo" and None not in (rPeri, vPeri, rApo) and _nonzero(rApo):
        return out(rPeri * vPeri / rApo, "v_apo = r_peri*v_peri / r_apo", "Kepler II: r_peri*v_peri = r_apo*v_apo")
    if solveFor == "v_peri" and None not in (rApo, vApo, rPeri) and _nonzero(rPeri):
        return out(rApo * vApo / rPeri, "v_peri = r_apo*v_apo / r_peri", "Kepler II: r_peri*v_peri = r_apo*v_apo")

    # --- Kepler's third law -------------------------------------------------
    if solveFor == "T_kepler" and None not in (mu, a) and mu > 0 and a > 0:
        return out(2 * math.pi * (a ** 3 / mu) ** 0.5, "T = 2*pi*sqrt(a^3 / (G*M))", "Kepler III: T^2 = 4*pi^2*a^3/(G*M)")
    if solveFor == "a_semi" and None not in (mu, T) and mu > 0:
        return out((mu * (T / (2 * math.pi)) ** 2) ** (1 / 3), "a = cbrt(G*M*(T/(2*pi))^2)", "Kepler III: T^2 = 4*pi^2*a^3/(G*M)")
    if solveFor == "M_central" and None not in (a, T) and _nonzero(T):
        return out(4 * math.pi ** 2 * a ** 3 / (BIG_G * T ** 2), "M = 4*pi^2*a^3 / (G*T^2)", "Kepler III: T^2 = 4*pi^2*a^3/(G*M)")

    # --- vis-viva: the speed anywhere on any conic --------------------------
    if solveFor == "v_at_r" and None not in (mu, r, a) and _nonzero(r) and _nonzero(a):
        val = mu * (2 / r - 1 / a)
        return out(val ** 0.5, "v = sqrt(G*M*(2/r - 1/a))", "Vis-viva: v^2 = G*M*(2/r - 1/a)") if val >= 0 else None
    if solveFor == "a_semi" and None not in (mu, r, v) and _nonzero(r) and _nonzero(mu):
        denom = 2 / r - v ** 2 / mu
        return out(1 / denom, "a = 1 / (2/r - v^2/(G*M))", "Vis-viva: v^2 = G*M*(2/r - 1/a)") if _nonzero(denom) else None
    if solveFor == "v_peri" and None not in (mu, rPeri, a) and _nonzero(rPeri) and _nonzero(a):
        val = mu * (2 / rPeri - 1 / a)
        return out(val ** 0.5, "v_peri = sqrt(G*M*(2/r_peri - 1/a))", "Vis-viva at perihelion") if val >= 0 else None
    if solveFor == "v_apo" and None not in (mu, rApo, a) and _nonzero(rApo) and _nonzero(a):
        val = mu * (2 / rApo - 1 / a)
        return out(val ** 0.5, "v_apo = sqrt(G*M*(2/r_apo - 1/a))", "Vis-viva at aphelion") if val >= 0 else None

    # --- circular special case ----------------------------------------------
    if solveFor == "v_circ" and None not in (mu, r) and _nonzero(r) and mu > 0:
        return out((mu / r) ** 0.5, "v_circ = sqrt(G*M / r)", "A circle is the ellipse with e = 0, so a = r")
    if solveFor == "r_orb" and k.get("v_circ") is not None and mu is not None and _nonzero(k["v_circ"]):
        return out(mu / k["v_circ"] ** 2, "r = G*M / v_circ^2", "v_circ = sqrt(G*M/r)")

    # --- energy -------------------------------------------------------------
    # E < 0 is a closed orbit, E = 0 is exactly escape, E > 0 never returns.
    if solveFor == "E_orb" and None not in (mu, m, a) and _nonzero(a):
        return out(-mu * m / (2 * a), "E = -G*M*m / (2*a)", "E = -G*M*m/(2a) for any bound orbit")
    if solveFor == "a_semi" and None not in (mu, m, E) and _nonzero(E):
        return out(-mu * m / (2 * E), "a = -G*M*m / (2*E)", "E = -G*M*m/(2a)")
    if solveFor == "E_orb" and None not in (mu, m, r, v) and _nonzero(r):
        return out(0.5 * m * v ** 2 - mu * m / r, "E = 0.5*m*v^2 - G*M*m/r", "E = KE + U, with U negative")

    # --- escape -------------------------------------------------------------
    if solveFor == "v_escape_orb" and None not in (mu, r) and _nonzero(r) and mu > 0:
        return out((2 * mu / r) ** 0.5, "v_esc = sqrt(2*G*M / r)", "Escape is the speed that makes E = 0")

    # --- radius and altitude are not the same number ------------------------
    if solveFor == "r_orb" and None not in (R_body, alt):
        return out(R_body + alt, "r = R_body + altitude", "Orbital radius is measured from the CENTRE of the body")
    if solveFor == "altitude" and None not in (r, R_body):
        return out(r - R_body, "altitude = r - R_body", "Orbital radius is measured from the CENTRE of the body")
    if solveFor == "R_body" and None not in (r, alt):
        return out(r - alt, "R_body = r - altitude", "Orbital radius is measured from the CENTRE of the body")

    # --- the orbiting mass ---------------------------------------------------
    # It cancels out of every orbital SHAPE relation, which is why a satellite's
    # period does not depend on it. Energy is the one place it survives.
    if solveFor == "m_sat" and None not in (mu, a, E) and _nonzero(mu) and _nonzero(a):
        return out(-2 * E * a / mu, "m = -2*E*a / (G*M)", "E = -G*M*m/(2a), rearranged for m")
    if solveFor == "m_sat" and None not in (mu, r, v, E) and _nonzero(0.5 * v ** 2 - mu / r):
        return out(E / (0.5 * v ** 2 - mu / r), "m = E / (0.5*v^2 - G*M/r)", "E = m(v^2/2 - G*M/r)")

    # --- reading the central mass back off an observed orbit ----------------
    if solveFor == "M_central" and None not in (vCirc, r):
        return out(vCirc ** 2 * r / BIG_G, "M = v_circ^2*r / G", "v_circ = sqrt(G*M/r)")
    if solveFor == "M_central" and None not in (k.get("v_escape_orb"), r):
        return out(k["v_escape_orb"] ** 2 * r / (2 * BIG_G), "M = v_esc^2*r / (2*G)", "v_esc = sqrt(2*G*M/r)")
    if solveFor == "M_central" and None not in (v, r, a) and _nonzero(2 / r - 1 / a):
        return out(v ** 2 / (BIG_G * (2 / r - 1 / a)), "M = v^2 / (G*(2/r - 1/a))", "Vis-viva, rearranged for M")

    # --- escape and circular speed are a fixed ratio apart ------------------
    if solveFor == "v_escape_orb" and vCirc is not None:
        return out(2 ** 0.5 * vCirc, "v_esc = sqrt(2) * v_circ", "Both come from the same G*M/r, so their ratio is always sqrt(2)")
    if solveFor == "v_circ" and k.get("v_escape_orb") is not None:
        return out(k["v_escape_orb"] / 2 ** 0.5, "v_circ = v_esc / sqrt(2)", "Both come from the same G*M/r, so their ratio is always sqrt(2)")
    if solveFor == "r_orb" and None not in (mu, k.get("v_escape_orb")) and _nonzero(k.get("v_escape_orb")):
        return out(2 * mu / k["v_escape_orb"] ** 2, "r = 2*G*M / v_esc^2", "v_esc = sqrt(2*G*M/r)")

    # --- eccentricity straight from the ellipse's own numbers ---------------
    if solveFor == "e_orb" and None not in (rApo, a) and _nonzero(a):
        return out(rApo / a - 1, "e = r_apo/a - 1", "r_apo = a(1 + e)")
    return None

def solve_ramp(k, solveFor):
    """A block on an inclined plane, in every configuration the course asks for.

    The ramp is where a student first has to RESOLVE a vector rather than add
    magnitudes, which is why it carries so much of the exam. Everything here
    follows from choosing axes along and perpendicular to the surface:

        along:         ma = Fa - mg*sin(theta) - f
        perpendicular: N  = mg*cos(theta)      (no acceleration off the surface)

    Static and kinetic friction are kept separate on purpose. f_s <= mu_s*N is
    an INEQUALITY -- static friction takes whatever value prevents sliding, up
    to a ceiling -- and writing it as an equality is one of the most common
    errors on the exam.
    """
    m = k.get("mass_r")
    theta = k.get("theta_ramp")
    mu_s, mu_k = k.get("mu_s_r"), k.get("mu_k_r")
    Fa = k.get("Fa_r")
    N, f = k.get("Fn_r"), k.get("Ff_r")
    a = k.get("a_ramp")
    d, v0, vf = k.get("d_ramp"), k.get("v0_r"), k.get("vf_r")
    h = k.get("height_r")

    rad = math.radians(theta) if theta is not None else None
    sin_t = math.sin(rad) if rad is not None else None
    cos_t = math.cos(rad) if rad is not None else None

    # --- resolving the weight ------------------------------------------------
    if solveFor == "Fg_par" and None not in (m, sin_t):
        return _result(m * G * sin_t, "Fg_par = m*g*sin(theta)",
                       "The component of weight ALONG the surface")
    if solveFor == "Fg_perp" and None not in (m, cos_t):
        return _result(m * G * cos_t, "Fg_perp = m*g*cos(theta)",
                       "The component of weight INTO the surface")
    if solveFor == "Fn_r" and None not in (m, cos_t):
        # There is no acceleration perpendicular to the surface, so N balances
        # only the perpendicular component. N = mg is true on the flat, and
        # nowhere else -- assuming it on a ramp is a standard lost mark.
        return _result(m * G * cos_t, "N = m*g*cos(theta)",
                       "Perpendicular to the surface nothing accelerates, so N = mg*cos(theta)")
    if solveFor == "mass_r" and None not in (N, cos_t) and _nonzero(cos_t):
        return _result(N / (G * cos_t), "m = N / (g*cos(theta))", "N = mg*cos(theta)")
    if solveFor == "theta_ramp" and None not in (N, m) and _nonzero(m * G):
        ratio = N / (m * G)
        if -1 <= ratio <= 1:
            return _result(math.degrees(math.acos(ratio)), "theta = arccos(N / (m*g))",
                           "N = mg*cos(theta)")
        return None

    # --- will it slide? the critical angle -----------------------------------
    if solveFor == "theta_crit" and mu_s is not None:
        # tan(theta) = mu_s exactly when the pull along the slope reaches the
        # static ceiling. Below it the block holds; above it, it goes -- and
        # notice the mass cancels, so a heavy block slips at the same angle.
        return _result(math.degrees(math.atan(mu_s)), "theta_crit = arctan(mu_s)",
                       "It slips when mg*sin(theta) exceeds mu_s*mg*cos(theta), and the mass cancels")
    if solveFor == "mu_s_r" and k.get("theta_crit") is not None:
        return _result(math.tan(math.radians(k["theta_crit"])), "mu_s = tan(theta_crit)",
                       "At the critical angle the static ceiling is exactly reached")
    if solveFor == "mu_s_r" and theta is not None:
        # Only true if the ramp is sitting exactly at the verge of slipping.
        # Printing "tan(theta_crit)" while reading theta_ramp put two numbers
        # for the same quantity side by side, differing threefold.
        return _result(math.tan(rad), "mu_s = tan(theta_ramp)",
                       "Assuming this ramp is exactly at the angle where the block begins to slide")

    # --- static friction actually holding the block --------------------------
    if solveFor == "Ff_static" and None not in (m, sin_t, cos_t):
        # What friction IS, not what it could be at most: it matches the pull.
        # But only while the block is actually held -- past the critical angle
        # there is no static friction to report, and returning mg*sin(theta)
        # anyway gave a force 8.7x larger than the surface can supply.
        pull = abs(m * G * sin_t - (Fa if Fa is not None else 0.0))
        if mu_s is not None and pull > mu_s * m * G * cos_t:
            return None
        return _result(pull, "f_s = abs(m*g*sin(theta) - Fa)" if Fa else "f_s = m*g*sin(theta)",
                       "Static friction matches whatever is left over along the slope, never more than mu_s*N")
    if solveFor == "Ff_static_max" and None not in (mu_s, m, cos_t):
        return _result(mu_s * m * G * cos_t, "f_smax = mu_s*m*g*cos(theta)",
                       "f_s <= mu_s*N is a CEILING, not an equality")

    # --- kinetic friction while sliding --------------------------------------
    if solveFor == "Ff_r" and None not in (mu_k, N):
        return _result(mu_k * N, "f_k = mu_k*N", "f_k = mu_k*N, constant while sliding")
    if solveFor == "Ff_r" and None not in (mu_k, m, cos_t):
        return _result(mu_k * m * G * cos_t, "f_k = mu_k*m*g*cos(theta)",
                       "f_k = mu_k*N with N = mg*cos(theta)")
    if solveFor == "mu_k_r" and None not in (f, N) and _nonzero(N):
        return _result(f / N, "mu_k = f_k / N", "f_k = mu_k*N")

    # --- acceleration along the slope ----------------------------------------
    # Down-slope is positive throughout, matching the variable's own label.
    #
    # Friction opposes MOTION, never the applied force, so its sign cannot be
    # chosen until the direction of sliding is known. Subtracting it blindly
    # meant the wizard's own "nothing is pushing it" answer -- which records
    # Fa_r = 0, not None -- silently selected the up-slope deceleration
    # formula and returned -7.45 m/s^2 where the answer is +2.35.
    if solveFor == "a_ramp" and None not in (m, sin_t, cos_t) and _nonzero(m):
        push = Fa if Fa is not None else 0.0            # positive = up the slope
        drive = m * G * sin_t - push                    # net pull down the slope
        grip = f if f is not None else ((mu_k * m * G * cos_t) if mu_k is not None else 0.0)
        ceiling = (mu_s * m * G * cos_t) if mu_s is not None else grip

        moving = v0 is not None and abs(v0) > 1e-9
        if not moving and abs(drive) <= ceiling:
            # Static friction is enough to hold it, so nothing accelerates.
            return _result(0.0, "a = 0",
                           "The pull along the slope is within the static ceiling, so the block does not move")
        # Sliding: friction opposes the direction of travel.
        direction = 1.0 if drive > 0 else -1.0
        value = (drive - direction * grip) / m
        if Fa is not None and Fa != 0:
            eq = ("a = (m*g*sin(theta) - Fa - f_k) / m" if direction > 0
                  else "a = (m*g*sin(theta) - Fa + f_k) / m")
            return _result(value, eq,
                           "Newton's second law along the surface. Friction opposes the MOTION, so its "
                           "sign follows the direction of travel, not the direction of the push")
        return _result(value, "a = g*(sin(theta) - mu_k*cos(theta))",
                       "Sliding down: ma = mg*sin(theta) - mu_k*mg*cos(theta), and the mass cancels")

    if solveFor == "a_ramp" and None not in (sin_t, cos_t) and mu_k is not None:
        # No mass given, so the mass-cancelling form. Still clamped: a block
        # that cannot start does not accelerate up the hill.
        if mu_s is not None and sin_t <= mu_s * cos_t:
            return _result(0.0, "a = 0", "tan(theta) is below mu_s, so the block does not move")
        val = G * (sin_t - mu_k * cos_t)
        if val <= 0:
            return _result(0.0, "a = 0",
                           "mu_k*cos(theta) exceeds sin(theta), so the block cannot slide from rest")
        return _result(val, "a = g*(sin(theta) - mu_k*cos(theta))",
                       "Sliding down: ma = mg*sin(theta) - mu_k*mg*cos(theta), and the mass cancels")
    if solveFor == "a_ramp" and sin_t is not None and mu_k is None:
        return _result(G * sin_t, "a = g*sin(theta)",
                       "Frictionless: the only force along the slope is mg*sin(theta)")
    if solveFor == "a_decel" and None not in (sin_t, cos_t, mu_k):
        # Going UP the slope friction points down-slope alongside gravity, so
        # the two ADD. The block decelerates harder going up than it
        # accelerates coming back down -- a favourite two-part question.
        return _result(G * (sin_t + mu_k * cos_t), "a = g*(sin(theta) + mu_k*cos(theta))",
                       "Moving UP the slope, friction and gravity both act down-slope")

    # --- the force needed to hold or to push ---------------------------------
    if solveFor == "Fa_r" and None not in (m, a, sin_t):
        friction = f if f is not None else ((mu_k * m * G * cos_t) if mu_k is not None else 0.0)
        return _result(m * (a + G * sin_t) + friction,
                       "Fa = m*a + m*g*sin(theta) + f_k",
                       "Newton's second law along the surface, rearranged for the applied force")
    if solveFor == "Fa_r" and None not in (m, sin_t):
        friction = k.get("Ff_static_max")
        if friction is None:
            friction = (mu_s * m * G * cos_t) if mu_s is not None else 0.0
        need = m * G * sin_t - friction
        if need <= 0:
            # Friction alone already holds it, so no push is needed at all.
            # A negative answer here read as "push it DOWN the slope".
            return _result(0.0, "Fa = 0",
                           "Static friction alone exceeds the pull, so the block holds with no push at all")
        return _result(need, "Fa = m*g*sin(theta) - f_smax",
                       "The least push that still holds the block, with static friction helping")

    # --- kinematics along the slope ------------------------------------------
    if solveFor == "vf_r" and None not in (v0, a, d):
        val = v0 ** 2 + 2 * a * d
        return _result(val ** 0.5, "vf = sqrt(v0^2 + 2*a*d)",
                       "vf^2 = vi^2 + 2ad, applied along the slope") if val >= 0 else None
    if solveFor == "vf_r" and None not in (a, d):
        val = 2 * a * d
        return _result(val ** 0.5, "vf = sqrt(2*a*d)",
                       "vf^2 = 2ad, starting from rest") if val >= 0 else None
    if solveFor == "v0_r" and None not in (vf, a, d):
        val = vf ** 2 - 2 * a * d
        return _result(val ** 0.5, "v0 = sqrt(vf^2 - 2*a*d)", "vf^2 = vi^2 + 2ad, rearranged") if val >= 0 else None
    if solveFor == "v0_r" and None not in (k.get("d_stop"), a):
        return _result((2 * abs(a) * k["d_stop"]) ** 0.5, "v0 = sqrt(2*abs(a)*d)",
                       "The speed needed to travel that far up the slope before stopping")
    if solveFor == "d_ramp" and None not in (vf, a) and _nonzero(a):
        return _result(vf ** 2 / (2 * a), "d = vf^2 / (2*a)", "vf^2 = 2ad from rest")
    if solveFor == "t_ramp" and None not in (d, a) and _nonzero(a):
        val = 2 * d / a
        return _result(val ** 0.5, "t = sqrt(2*d/a)",
                       "d = 0.5*a*t^2 from rest") if val >= 0 else None
    if solveFor == "d_stop" and None not in (v0, a) and _nonzero(a):
        return _result(v0 ** 2 / (2 * abs(a)), "d = v0^2 / (2*abs(a))",
                       "How far up the slope it travels before coming to rest, using the magnitude of a")

    # --- geometry and energy --------------------------------------------------
    if solveFor == "height_r" and None not in (d, sin_t):
        return _result(d * sin_t, "h = d*sin(theta)",
                       "The VERTICAL drop over a distance d measured along the slope")
    if solveFor == "d_ramp" and None not in (h, sin_t) and _nonzero(sin_t):
        return _result(h / sin_t, "d = h / sin(theta)",
                       "The slope distance corresponding to a vertical drop h")
    if solveFor == "W_friction_r" and None not in (f, d):
        # Friction removes energy whichever way the block is moving, so this
        # is negative by construction rather than by the sign of the inputs.
        return _result(-abs(f) * abs(d), "W_f = -f_k*d",
                       "Friction always does NEGATIVE work on the sliding body")   # noqa: E501
    if solveFor == "vf_r" and None not in (h, mu_k, cos_t, sin_t) and _nonzero(sin_t):
        val = 2 * G * h * (1 - mu_k * cos_t / sin_t)
        return _result(val ** 0.5, "vf = sqrt(2*g*h*(1 - mu_k/tan(theta)))",
                       "mgh - f_k*d = 0.5*m*vf^2, with d = h/sin(theta)") if val >= 0 else None
    if solveFor == "vf_r" and h is not None and mu_k is None:
        val = 2 * G * h
        return _result(val ** 0.5, "vf = sqrt(2*g*h)",
                       "Frictionless: mgh = 0.5*m*vf^2, and the mass cancels") if val >= 0 else None

    return None


def solve_elevator(k, solveFor):
    """A body in an accelerating lift, and the apparent weight it feels.

    Nothing here changes the true weight mg. What changes is the NORMAL force
    the floor supplies -- and since a bathroom scale reads the normal force,
    that is exactly what "feeling heavier" measures.

    Sign convention: a is positive UPWARD throughout. A lift slowing while it
    descends therefore has a > 0 as well, which is why "going down" is not the
    same question as "accelerating down".
    """
    m, a = k.get("mass_e"), k.get("a_elev")
    N, T = k.get("Fn_e"), k.get("T_cable")
    W_true, W_app = k.get("W_true"), k.get("W_apparent")
    ratio = k.get("scale_ratio")

    if solveFor == "W_true" and m is not None:
        return _result(m * G, "W = m*g",
                       "True weight never changes -- only the normal force does")
    if solveFor == "mass_e" and W_true is not None:
        return _result(W_true / G, "m = W/g", "W = mg")

    # --- the normal force, which is what a scale reads -----------------------
    if solveFor == "Fn_e" and None not in (m, a):
        # A floor is a one-sided constraint. At or below free fall the rider
        # separates from it entirely -- which is why loose objects float in a
        # plummeting lift -- so N is zero, never negative.
        if a <= -G:
            return _result(0.0, "N = 0",
                           "At or below free fall the rider leaves the floor, so it supplies no force")
        return _result(m * (G + a), "N = m*(g + a)", "N - mg = ma, taking up as positive")
    if solveFor == "W_apparent" and None not in (m, a):
        if a <= -G:
            return _result(0.0, "W_apparent = 0", "In free fall the scale reads nothing at all")
        return _result(m * (G + a), "W_apparent = m*(g + a)",
                       "Apparent weight IS the normal force")
    if solveFor == "a_elev" and None not in (N, m) and _nonzero(m):
        return _result(N / m - G, "a = N/m - g", "N - mg = ma")
    if solveFor == "a_elev" and None not in (W_app, m) and _nonzero(m):
        return _result(W_app / m - G, "a = W_apparent/m - g", "N - mg = ma")
    if solveFor == "mass_e" and None not in (N, a) and _nonzero(G + a):
        return _result(N / (G + a), "m = N / (g + a)", "N = m(g + a)")

    # --- the ratio a scale actually shows ------------------------------------
    if solveFor == "scale_ratio" and a is not None:
        # Above 1 the rider feels heavy, below 1 light, and exactly 0 is free
        # fall -- the floor supplies nothing and the rider floats.
        return _result((G + a) / G, "N/W = (g + a)/g",
                       "How many times its true weight the scale reads")
    if solveFor == "a_elev" and ratio is not None:
        # Name the ratio itself. Writing it as N/W let the substitution line
        # resolve N and W from the reader's own separately-entered values,
        # which could contradict the ratio and flip the printed sign.
        return _result((ratio - 1) * G, "a = (scale_ratio - 1)*g",
                       "N/W = (g + a)/g, rearranged for the acceleration")

    # --- the cable holding the car itself ------------------------------------
    # The cable carries the whole car, which is not the rider standing in it.
    # Using mass_e for both reported the tension needed to hoist one person as
    # though it were the lift's cable tension.
    car = k.get("mass_car_e")
    if solveFor == "T_cable" and None not in (car, a):
        if a <= -G:
            return _result(0.0, "T = 0", "At or below free fall the cable goes slack and carries nothing")
        return _result(car * (G + a), "T = m_car*(g + a)", "The cable carries the whole car: T - mg = ma")
    if solveFor == "mass_car_e" and None not in (T, a) and _nonzero(G + a):
        return _result(T / (G + a), "m_car = T / (g + a)", "T = m_car*(g + a)")
    if solveFor == "T_cable" and None not in (m, a):
        if a <= -G:
            # A cable pulls; it cannot push. At or past free fall it goes slack.
            return _result(0.0, "T = 0", "At or below free fall the cable goes slack and carries nothing")
        return _result(m * (G + a), "T = m*(g + a)",
                       "The cable carries the whole car: T - mg = ma")
    if solveFor == "a_elev" and None not in (T, m) and _nonzero(m):
        return _result(T / m - G, "a = T/m - g", "T - mg = ma")
    if solveFor == "mass_e" and None not in (T, a) and _nonzero(G + a):
        return _result(T / (G + a), "m = T / (g + a)", "T = m(g + a)")

    return None


def solve_com(k, solveFor):
    """Centre of mass: the point at which a system behaves as one particle.

    What makes this quantity worth its own chapter is that Newton's second law
    applies to it EXACTLY. An exploding shell's fragments fly everywhere, but
    their centre of mass carries on along the original parabola, because the
    explosion is internal and internal forces cancel in third-law pairs.
    """
    m1, m2, m3 = k.get("m1_cm"), k.get("m2_cm"), k.get("m3_cm")
    x1, x2, x3 = k.get("x1_cm"), k.get("x2_cm"), k.get("x3_cm")
    v1, v2 = k.get("v1_cm"), k.get("v2_cm")
    x_cm, v_cm = k.get("x_cm"), k.get("v_cm")
    M, F_ext, a_cm = k.get("M_total"), k.get("F_ext_cm"), k.get("a_cm")
    L_rod, lam_ratio = k.get("L_rod"), k.get("lambda_ratio")

    masses = [mm for mm in (m1, m2, m3) if mm is not None]

    # A third particle in the system makes every two-body inversion wrong, not
    # approximate -- the forward direction already refuses, and the inverses
    # have to refuse for the same reason.
    _third = m3 is not None
    if solveFor == "M_total" and masses:
        terms = " + ".join("m" + str(i + 1) for i in range(len(masses)))
        return _result(sum(masses), "M = " + terms, "The total mass of the system")

    # --- discrete masses ------------------------------------------------------
    if solveFor == "x_cm" and None not in (m1, m2, m3, x1, x2, x3) and _nonzero(m1 + m2 + m3):
        return _result((m1 * x1 + m2 * x2 + m3 * x3) / (m1 + m2 + m3),
                       "x_cm = (m1*x1 + m2*x2 + m3*x3) / (m1 + m2 + m3)",
                       "x_cm = sum(m_i*x_i) / M")
    # A third mass in the system with no position given makes the two-body
    # answer wrong, not approximate. Refuse rather than drop it in silence.
    if solveFor == "x_cm" and m3 is not None and x3 is None:
        return None
    if solveFor == "x_cm" and None not in (m1, m2, x1, x2) and _nonzero(m1 + m2):
        return _result((m1 * x1 + m2 * x2) / (m1 + m2),
                       "x_cm = (m1*x1 + m2*x2) / (m1 + m2)", "x_cm = sum(m_i*x_i) / M")
    if solveFor == "x1_cm" and not _third and None not in (m1, m2, x2, x_cm) and _nonzero(m1):
        return _result(((m1 + m2) * x_cm - m2 * x2) / m1,
                       "x1 = ((m1 + m2)*x_cm - m2*x2) / m1", "x_cm = sum(m_i*x_i) / M, rearranged")
    if solveFor == "x2_cm" and not _third and None not in (m1, m2, x1, x_cm) and _nonzero(m2):
        return _result(((m1 + m2) * x_cm - m1 * x1) / m2,
                       "x2 = ((m1 + m2)*x_cm - m1*x1) / m2",
                       "x_cm = sum(m_i*x_i) / M, rearranged")
    if solveFor == "m2_cm" and not _third and None not in (m1, x1, x2, x_cm) and _nonzero(x2 - x_cm) \
            and min(x1, x2) <= x_cm <= max(x1, x2):
        # Outside the two bodies there is no pair of POSITIVE masses that
        # balances there, and the formula quietly returns a negative mass.
        # The centre of mass sits closer to the heavier body, dividing the
        # separation in inverse proportion to the two masses.
        return _result(m1 * (x_cm - x1) / (x2 - x_cm),
                       "m2 = m1*(x_cm - x1) / (x2 - x_cm)",
                       "The centre of mass divides the separation in INVERSE proportion to the masses")

    if solveFor == "m1_cm" and not _third and None not in (m2, x1, x2, x_cm) \
            and _nonzero(x_cm - x1) and min(x1, x2) <= x_cm <= max(x1, x2):
        return _result(m2 * (x2 - x_cm) / (x_cm - x1), "m1 = m2*(x2 - x_cm) / (x_cm - x1)",
                       "The centre of mass divides the separation in INVERSE proportion to the masses")
    if solveFor == "m3_cm" and None not in (m1, m2, x1, x2, x3, x_cm) and _nonzero(x3 - x_cm):
        return _result((m1 * (x_cm - x1) + m2 * (x_cm - x2)) / (x3 - x_cm),
                       "m3 = (m1*(x_cm - x1) + m2*(x_cm - x2)) / (x3 - x_cm)",
                       "Every mass times its distance from the centre of mass must balance")
    if solveFor == "x3_cm" and None not in (m1, m2, m3, x1, x2, x_cm) and _nonzero(m3):
        return _result(((m1 + m2 + m3) * x_cm - m1 * x1 - m2 * x2) / m3,
                       "x3 = ((m1 + m2 + m3)*x_cm - m1*x1 - m2*x2) / m3",
                       "x_cm = sum(m_i*x_i) / M, rearranged")

    # --- velocity, and the law that makes this quantity matter ---------------
    if solveFor == "v_cm" and None not in (m1, m2, m3, v1, v2, k.get("v3_cm")) and _nonzero(m1 + m2 + m3):
        return _result((m1 * v1 + m2 * v2 + m3 * k["v3_cm"]) / (m1 + m2 + m3),
                       "v_cm = (m1*v1 + m2*v2 + m3*v3) / (m1 + m2 + m3)", "v_cm = p_total / M")
    # A third mass in the system makes the two-body average simply wrong -- it
    # divided by 2 kg for a system massing 4 kg. Refuse rather than answer.
    if solveFor == "v_cm" and m3 is not None and k.get("v3_cm") is None:
        return None
    if solveFor == "v_cm" and None not in (m1, m2, v1, v2) and _nonzero(m1 + m2):
        return _result((m1 * v1 + m2 * v2) / (m1 + m2),
                       "v_cm = (m1*v1 + m2*v2) / (m1 + m2)",
                       "v_cm = p_total / M, so the centre of mass carries the system's momentum")
    if solveFor == "v1_cm" and not _third and None not in (m1, m2, v2, v_cm) and _nonzero(m1):
        return _result(((m1 + m2) * v_cm - m2 * v2) / m1, "v1 = ((m1 + m2)*v_cm - m2*v2) / m1",
                       "v_cm = p_total / M, rearranged")
    if solveFor == "v2_cm" and not _third and None not in (m1, m2, v1, v_cm) and _nonzero(m2):
        return _result(((m1 + m2) * v_cm - m1 * v1) / m2, "v2 = ((m1 + m2)*v_cm - m1*v1) / m2",
                       "v_cm = p_total / M, rearranged")
    if solveFor == "v3_cm" and None not in (m1, m2, m3, v1, v2, v_cm) and _nonzero(m3):
        return _result(((m1 + m2 + m3) * v_cm - m1 * v1 - m2 * v2) / m3,
                       "v3 = ((m1 + m2 + m3)*v_cm - m1*v1 - m2*v2) / m3", "v_cm = p_total / M, rearranged")
    if solveFor == "a1_cm" and None not in (m1, m2, k.get("a2_cm"), a_cm) and _nonzero(m1):
        return _result(((m1 + m2) * a_cm - m2 * k["a2_cm"]) / m1,
                       "a1 = ((m1 + m2)*a_cm - m2*a2) / m1", "a_cm is the mass-weighted mean of the parts")
    if solveFor == "a2_cm" and None not in (m1, m2, k.get("a1_cm"), a_cm) and _nonzero(m2):
        return _result(((m1 + m2) * a_cm - m1 * k["a1_cm"]) / m2,
                       "a2 = ((m1 + m2)*a_cm - m1*a1) / m2", "a_cm is the mass-weighted mean of the parts")
    if solveFor == "p_total_cm" and None not in (M, v_cm):
        return _result(M * v_cm, "p_total = M*v_cm",
                       "The whole system's momentum is M*v_cm")
    if solveFor == "a_cm" and None not in (F_ext, M) and _nonzero(M):
        return _result(F_ext / M, "a_cm = F_ext / M",
                       "Only EXTERNAL forces move the centre of mass -- internal ones cancel in third-law pairs")
    if solveFor == "a_cm" and None not in (m1, m2, k.get("a1_cm"), k.get("a2_cm")) and _nonzero(m1 + m2):
        return _result((m1 * k["a1_cm"] + m2 * k["a2_cm"]) / (m1 + m2),
                       "a_cm = (m1*a1 + m2*a2) / (m1 + m2)",
                       "The centre of mass accelerates as the mass-weighted mean of its parts")
    if solveFor == "F_ext_cm" and None not in (M, a_cm):
        return _result(M * a_cm, "F_ext = M*a_cm",
                       "Newton's second law applies exactly to the centre of mass")

    # --- the relation the chapter's own blurb promises -----------------------
    # Internal forces cannot shift the centre of mass, so when one body moves
    # one way the other must move back: m1*dx1 = -m2*dx2. This is the person
    # walking along a boat, and it is THE centre-of-mass problem.
    if solveFor == "dx2_cm" and None not in (m1, m2, k.get("dx1_cm")) and _nonzero(m2):
        return _result(-m1 * k["dx1_cm"] / m2, "dx2 = -m1*dx1 / m2",
                       "m1*dx1 + m2*dx2 = 0, because the centre of mass cannot move")
    if solveFor == "dx1_cm" and None not in (m1, m2, k.get("dx2_cm")) and _nonzero(m1):
        return _result(-m2 * k["dx2_cm"] / m1, "dx1 = -m2*dx2 / m1",
                       "m1*dx1 + m2*dx2 = 0, because the centre of mass cannot move")

    # --- a continuous rod -----------------------------------------------------
    if solveFor == "L_rod" and None not in (k.get("x_cm_rod"), lam_ratio) and lam_ratio >= 0:
        denom = (1 + 2 * lam_ratio)
        if _nonzero(denom):
            return _result(k["x_cm_rod"] * 3 * (1 + lam_ratio) / denom,
                           "L = x_cm*3*(1 + ratio) / (1 + 2*ratio)",
                           "x_cm = L(1 + 2*ratio) / (3(1 + ratio)), rearranged")
        return None
    if solveFor == "L_rod" and k.get("x_cm_rod") is not None:
        return _result(2 * k["x_cm_rod"], "L = 2*x_cm", "A uniform rod balances at its midpoint")
    if solveFor == "lambda_ratio" and None not in (k.get("x_cm_rod"), L_rod) and _nonzero(L_rod):
        # x_cm/L = (1 + 2R) / (3 + 3R), solved for R.
        f = k["x_cm_rod"] / L_rod
        denom = 2 - 3 * f
        if _nonzero(denom):
            return _result((3 * f - 1) / denom, "ratio = (3*x_cm/L - 1) / (2 - 3*x_cm/L)",
                           "x_cm = L(1 + 2*ratio) / (3(1 + ratio)), solved for the ratio")
        return None

    if solveFor == "x_cm_rod" and None not in (L_rod, lam_ratio) and lam_ratio >= 0 and _nonzero(1 + lam_ratio):
        # lambda(x) = lambda0*(1 + (ratio - 1)*x/L): the density runs linearly
        # from lambda0 at one end to ratio*lambda0 at the other.
        return _result(L_rod * (1 + 2 * lam_ratio) / (3 * (1 + lam_ratio)),
                       "x_cm = L*(1 + 2*ratio) / (3*(1 + ratio))",
                       "x_cm = integral(x*lambda dx) / integral(lambda dx) for a linearly varying density")
    # A ratio the reader supplied but which this model cannot use must not fall
    # through to "uniform rod" -- that asserts the opposite of what they said.
    if solveFor == "x_cm_rod" and L_rod is not None and lam_ratio is not None:
        return None
    if solveFor == "x_cm_rod" and L_rod is not None:
        return _result(L_rod / 2, "x_cm = L/2", "A uniform rod balances at its midpoint")

    return None

def solve_roundabout(k, solveFor):
    """A car on a circular track, and the friction that keeps it there.

    On a flat curve nothing pushes the car inward except friction between tyre
    and road, so friction alone supplies the whole centripetal force. That puts
    a hard ceiling on the speed, and the ceiling does NOT depend on the car's
    mass -- a loaded lorry and an empty one slide at the same speed.

    When the driver is also speeding up or braking, friction has two jobs at
    once: mv^2/r pointing inward and ma_t pointing along the track. They are
    perpendicular, so the demand is their vector sum -- the "friction circle".
    The car holds the road while

        sqrt( (v^2/r)^2 + a_t^2 )  <=  mu_s * g

    and breaks away the instant that is exceeded. Steady cornering (a_t = 0) is
    just the special case where the whole budget goes to turning.
    """
    m, r = k.get("mass_car"), k.get("r_track")
    v, mu_s = k.get("v_car"), k.get("mu_s_track")
    a_t = k.get("a_tangential")
    theta_bank = k.get("theta_bank")
    N = k.get("Fn_car")

    rad = math.radians(theta_bank) if theta_bank is not None else None

    # --- the centripetal demand ----------------------------------------------
    if solveFor == "a_centripetal" and None not in (v, r) and _nonzero(r):
        return _result(v ** 2 / r, "a_c = v^2 / r",
                       "Centripetal acceleration points INWARD, toward the centre of the circle")
    if solveFor == "Fc_required" and None not in (m, v, r) and _nonzero(r):
        return _result(m * v ** 2 / r, "F_c = m*v^2 / r",
                       "The net inward force a circular path requires")
    if solveFor == "v_car" and None not in (k.get("a_centripetal"), r):
        val = k["a_centripetal"] * r
        return _result(val ** 0.5, "v = sqrt(a_c * r)", "a_c = v^2/r") if val >= 0 else None

    # --- what friction can supply --------------------------------------------
    if solveFor == "Ff_available" and None not in (mu_s, m, rad) and _nonzero(math.cos(rad)):
        # On a bank the normal force is larger, so the friction ceiling is too.
        return _result(mu_s * m * G / math.cos(rad), "f_max = mu_s*m*g / cos(theta)",
                       "On a bank N = mg/cos(theta), so the friction ceiling rises with it")
    if solveFor == "Ff_available" and None not in (mu_s, m):
        # The most the road can push sideways, whatever the driver asks for.
        return _result(mu_s * m * G, "f_max = mu_s*m*g",
                       "On a flat road N = mg, so the friction ceiling is mu_s*m*g")
    # Banking tilts the normal force so it helps turn, and friction then adds
    # to that rather than doing the whole job. Ignoring the bank under-reported
    # the limit by 36% on a 25-degree curve -- which is the entire question.
    if solveFor == "v_max" and None not in (mu_s, r, rad):
        tan_b = math.tan(rad)
        denom = 1 - mu_s * tan_b
        if denom <= 0:
            return None
        return _result((G * r * (tan_b + mu_s) / denom) ** 0.5,
                       "v_max = sqrt(g*r*(tan(theta) + mu_s) / (1 - mu_s*tan(theta)))",
                       "On a bank the normal force helps turn, and friction adds to it")
    if solveFor == "v_min" and None not in (mu_s, r, rad):
        tan_b = math.tan(rad)
        num = tan_b - mu_s
        if num <= 0:
            return _result(0.0, "v_min = 0",
                           "mu_s exceeds tan(theta), so the car can stop on the bank without sliding")
        return _result((G * r * num / (1 + mu_s * tan_b)) ** 0.5,
                       "v_min = sqrt(g*r*(tan(theta) - mu_s) / (1 + mu_s*tan(theta)))",
                       "Below this the car slides DOWN the bank")

    if solveFor == "v_max" and None not in (mu_s, r, a_t):
        # With part of the budget spent on speeding up, less is left to turn
        # with, so the cornering ceiling drops.
        budget = (mu_s * G) ** 2 - a_t ** 2
        if budget <= 0:
            return None
        return _result((budget ** 0.5 * r) ** 0.5,
                       "v_max = sqrt(r * sqrt((mu_s*g)^2 - a_t^2))",
                       "Whatever grip the tangential demand uses is no longer available for turning")
    if solveFor == "v_max" and None not in (mu_s, r):
        val = mu_s * G * r
        # The mass cancels: this ceiling is a property of the road and the
        # curve, not of the vehicle taking it.
        return _result(val ** 0.5, "v_max = sqrt(mu_s*g*r)",
                       "m*v^2/r = mu_s*m*g, and the mass cancels") if val >= 0 else None
    if solveFor == "mu_s_track" and None not in (v, r) and _nonzero(G * r):
        return _result(v ** 2 / (G * r), "mu_s = v^2 / (g*r)",
                       "The least friction that makes this speed survivable")
    if solveFor == "r_track" and None not in (v, mu_s) and _nonzero(mu_s * G):
        return _result(v ** 2 / (mu_s * G), "r = v^2 / (mu_s*g)",
                       "The tightest curve this speed can hold")

    # --- the friction circle, when the driver is also accelerating -----------
    if solveFor == "friction_demand" and None not in (v, r) and _nonzero(r):
        tang = a_t if a_t is not None else 0.0
        return _result(((v ** 2 / r) ** 2 + tang ** 2) ** 0.5,
                       "a_required = sqrt((v^2/r)^2 + a_t^2)",
                       "Turning and accelerating are perpendicular demands, so they add as vectors")
    if solveFor == "friction_budget" and mu_s is not None:
        return _result(mu_s * G, "a_max = mu_s*g",
                       "The total acceleration the tyres can deliver in any direction")
    if solveFor == "grip_used" and None not in (v, r, mu_s) and _nonzero(r) and _nonzero(mu_s * G):
        tang = a_t if a_t is not None else 0.0
        # A demand the reader supplied outranks one recomputed here, or the
        # printed line substitutes their number into an answer built from ours.
        demand = k.get("friction_demand")
        if demand is None:
            demand = ((v ** 2 / r) ** 2 + tang ** 2) ** 0.5
        # Above 1 the car has already left the circle.
        return _result(demand / (mu_s * G), "grip = a_required / (mu_s*g)",
                       "The fraction of the available grip in use; at 1 the tyres let go")
    if solveFor == "a_tangential" and None not in (mu_s, v, r) and _nonzero(r):
        budget = (mu_s * G) ** 2 - (v ** 2 / r) ** 2
        if budget <= 0:
            return None
        return _result(budget ** 0.5, "a_t = sqrt((mu_s*g)^2 - (v^2/r)^2)",
                       "The hardest the driver can accelerate while still holding this corner")

    # --- a banked curve -------------------------------------------------------
    if solveFor == "theta_bank" and None not in (v, r) and _nonzero(G * r):
        # Banking steeply enough lets the normal force do the turning, so the
        # curve can be taken at this speed on ice.
        return _result(math.degrees(math.atan(v ** 2 / (G * r))),
                       "theta = arctan(v^2 / (g*r))",
                       "The bank angle that needs NO friction at all at this speed")
    if solveFor == "v_nofriction" and None not in (rad, r):
        val = G * r * math.tan(rad)
        return _result(val ** 0.5, "v = sqrt(g*r*tan(theta))",
                       "The one speed a banked curve holds with no friction") if val >= 0 else None
    if solveFor == "Fn_car" and None not in (m, rad) and _nonzero(math.cos(rad)):
        return _result(m * G / math.cos(rad), "N = m*g / cos(theta)",
                       "On a bank the normal force exceeds mg, because it also supplies the turn")
    if solveFor == "mass_car" and None not in (N, rad):
        return _result(N * math.cos(rad) / G, "m = N*cos(theta) / g", "N = mg/cos(theta)")

    return None

def solve_blockstack(k, solveFor):
    """One block riding on another, with friction between them.

    The point students miss: NOTHING touches the top block except the block
    underneath it. So the only horizontal force on it is friction -- which
    means friction is what DRIVES it forward here, not what holds it back.

    While the pair moves together they share one acceleration, and the friction
    the top block needs is m_top*a. Friction can supply at most mu_s*m_top*g,
    so there is a hard ceiling on the applied force:

        F_max = mu_s * g * (m_top + m_bot)        (frictionless ground)

    Push harder and the top block cannot keep up. It then slides, kinetic
    friction takes over at its ceiling, and the two accelerate differently.
    """
    mt, mb = k.get("m_top"), k.get("m_bot")
    mu_s, mu_g = k.get("mu_between"), k.get("mu_ground")
    F = k.get("F_push")
    total = (mt + mb) if None not in (mt, mb) else None

    # Ground friction acts on the pair as a whole, under the bottom block.
    ground = (mu_g * total * G) if None not in (mu_g, total) else 0.0

    # --- the contact between them --------------------------------------------
    if solveFor == "N_between" and mt is not None:
        # The top block presses down with its own weight and nothing else.
        return _result(mt * G, "N = m_top*g",
                       "The top block's weight is the only thing pressing the surfaces together")
    if solveFor == "m_top" and k.get("N_between") is not None:
        return _result(k["N_between"] / G, "m_top = N/g", "N = m_top*g")

    # --- moving together ------------------------------------------------------
    if solveFor == "a_together" and None not in (F, total) and _nonzero(total):
        return _result((F - ground) / total, "a = (F - mu_ground*(m_top + m_bot)*g) / (m_top + m_bot)",
                       "While they move together they behave as one body of the combined mass")
    if solveFor == "F_push" and None not in (k.get("a_together"), total):
        return _result(k["a_together"] * total + ground, "F = (m_top + m_bot)*a + mu_ground*(m_top + m_bot)*g",
                       "Newton's second law for the pair treated as one body")

    # --- the friction the top block actually feels ---------------------------
    if solveFor == "f_on_top" and None not in (mt, k.get("a_together")):
        # What friction IS, not its maximum: it supplies exactly what the top
        # block needs to keep up, and it points FORWARD.
        return _result(mt * k["a_together"], "f = m_top*a",
                       "Friction is the only horizontal force on the top block, so it is what accelerates it")
    if solveFor == "f_on_top" and None not in (mt, F, total) and _nonzero(total):
        return _result(mt * (F - ground) / total, "f = m_top*(F - mu_ground*(m_top + m_bot)*g) / (m_top + m_bot)",
                       "The top block needs m_top*a of friction to share the pair's acceleration")

    # --- the ceiling ----------------------------------------------------------
    if solveFor == "F_max_together" and None not in (mu_s, total):
        # Solving mu_s*m_top*g = m_top*a for a gives a_max = mu_s*g, and the
        # top block's mass cancels -- so the ceiling depends on the TOTAL mass
        # and on mu_s, but not on how the mass is divided between them.
        return _result(mu_s * G * total + ground, "F_max = mu_s*g*(m_top + m_bot) + mu_ground*(m_top + m_bot)*g",
                       "The pair separates when the required friction reaches mu_s*m_top*g")
    if solveFor == "mu_between" and None not in (k.get("F_max_together"), total) and _nonzero(G * total):
        return _result((k["F_max_together"] - ground) / (G * total), "mu_s = (F_max - mu_ground*(m_top + m_bot)*g) / (g*(m_top + m_bot))",
                       "F_max = mu_s*g*(m_top + m_bot)")

    # --- once it slips --------------------------------------------------------
    # Which regime applies has to be settled BEFORE either acceleration is
    # reported. Returning the slipping values unconditionally gave three
    # mutually contradictory answers to one problem, including the
    # kinematically impossible a_top > a_bot -- the top block cannot outrun the
    # block that is dragging it along.
    _slipping = None
    if None not in (F, mu_s, total):
        _slipping = F > mu_s * G * total + ground

    if solveFor == "a_top":
        if _slipping is False and _nonzero(total):
            return _result((F - ground) / total,
                           "a_top = (F - mu_ground*(m_top + m_bot)*g) / (m_top + m_bot)",
                           "Below the ceiling they move together, so the top block shares the pair's acceleration")
        if mu_s is not None and _slipping is not False:
            return _result(mu_s * G, "a_top = mu_k*g",
                           "Sliding: friction is at its maximum, and the top block's mass cancels")
    if solveFor == "a_bot" and None not in (F, mt, mb, mu_s) and _nonzero(mb):
        if _slipping is False and _nonzero(total):
            return _result((F - ground) / total,
                           "a_bot = (F - mu_ground*(m_top + m_bot)*g) / (m_top + m_bot)",
                           "Below the ceiling they move together, so both blocks share one acceleration")
        # The bottom block is pushed forward by F and dragged back by the top
        # block's friction, which by Newton's third law is equal and opposite
        # to the friction driving the top block. The two branches agree exactly
        # at F = F_max, so the pair is continuous there.
        return _result((F - mu_s * mt * G - ground) / mb,
                       "a_bot = (F - mu_k*m_top*g - mu_ground*(m_top + m_bot)*g) / m_bot",
                       "The top block drags backward on the bottom one by Newton's third law")
    if solveFor == "slips" and None not in (F, mu_s, total):
        return _result(1.0 if F > mu_s * G * total + ground else 0.0, "slips = F > F_max",
                       "1 means the applied force exceeds what friction between them can transmit")

    return None


def _decay(t, tau):
    """1 - e^(-t/tau), for a decay that actually decays.

    A negative time constant, or a time before release, describes no part of
    this motion -- and the exponential does not merely return something odd
    for them, it overflows outright. Refusing here keeps every branch that
    uses the curve finite by construction.
    """
    if t is None or tau is None or tau <= 0 or t < 0:
        return None
    return 1 - math.exp(-t / tau)


def _drag_linear_closure(k, note):
    """Terminal velocity and the time constant are DEFINED by the mass and the
    drag coefficient, and the speed at a stated instant follows from them by
    the chapter's own solution.

    The apparatus is a body, a fluid and a stopwatch, so mass_d, b_drag and
    t_drag are the three numbers a reader actually has. Without this pass the
    drag force at that instant is unreachable from all three of them, because
    F_d = b*v needs a speed the solver can work out but will not chain to.
    """
    m, b = k.get("mass_d"), k.get("b_drag")
    if None not in (m, b) and _nonzero(b):
        note("v_term", m * G / b, "v_term = mass_d*g/b_drag = %.6g m/s" % (m * G / b),
             "v_term = mass_d*g / b_drag",
             "At terminal velocity the drag exactly cancels the weight: b*v = mg")
        note("tau_drag", m / b, "tau_drag = mass_d/b_drag = %.6g s" % (m / b),
             "tau_drag = mass_d / b_drag", "The time constant of m*dv/dt = mg - b*v")
    if k.get("v_term") is not None:
        note("tau_drag", k["v_term"] / G, "tau_drag = v_term/g = %.6g s" % (k["v_term"] / G),
             "tau_drag = v_term / g", "tau = m/b = v_term/g")
    if k.get("tau_drag") is not None:
        note("v_term", G * k["tau_drag"], "v_term = g*tau_drag = %.6g m/s" % (G * k["tau_drag"]),
             "v_term = g*tau_drag", "tau = m/b and v_term = mg/b, so the two differ only by g")
    # The one step here that is physics rather than definition, and it earns
    # its place for the same reason vis-viva does in the orbital closure: it
    # is how the state of the body at the stated instant is actually
    # determined, and every other quantity at that instant hangs off it.
    fade = _decay(k.get("t_drag"), k.get("tau_drag"))
    if fade is not None and k.get("v_term") is not None:
        note("v_drag", k["v_term"] * fade,
             "v_drag = v_term*(1 - exp(-t_drag/tau_drag)) = %.6g m/s" % (k["v_term"] * fade),
             "v_drag = v_term*(1 - exp(-t_drag/tau_drag))",
             "v(t) = v_term(1 - e^(-t/tau)), the solution of m*dv/dt = mg - b*v")


def solve_drag_linear(k, solveFor):
    """Falling against a drag force proportional to speed, F_d = -b*v.

    This is the low-speed regime: a mist droplet, a bead settling through
    glycerine, anything small and slow enough that the air flows smoothly
    around it. Newton's second law reads m dv/dt = mg - b*v, whose solution
    climbs toward mg/b without ever arriving:

        v(t) = v_term*(1 - e^(-t/tau)),   tau = m/b = v_term/g

    "When does it reach terminal velocity?" therefore has no finite answer,
    and that is the trap the chapter exists to spring. The answerable version
    is when it reaches 95% of it, t = tau*ln(20), a shade under three time
    constants.
    """
    m, b = k.get("mass_d"), k.get("b_drag")
    v_term, v, t, tau = k.get("v_term"), k.get("v_drag"), k.get("t_drag"), k.get("tau_drag")
    Fd = k.get("Fd_drag")

    # v_term and tau_drag are DEFINED by m and b, so the closure above reaches
    # them from any of their partners and there is nothing left to do here.

    if solveFor == "mass_d":
        if None not in (v_term, b):
            return _result(v_term * b / G, "mass_d = v_term*b_drag / g", "v_term = mg/b")
        if None not in (tau, b):
            return _result(tau * b, "mass_d = tau_drag*b_drag", "tau = m/b")
    if solveFor == "b_drag":
        if None not in (m, v_term) and _nonzero(v_term):
            return _result(m * G / v_term, "b_drag = mass_d*g / v_term", "v_term = mg/b")
        if None not in (m, tau) and _nonzero(tau):
            return _result(m / tau, "b_drag = mass_d / tau_drag", "tau = m/b")
        if None not in (Fd, v) and _nonzero(v):
            return _result(Fd / v, "b_drag = Fd_drag / v_drag",
                           "b is defined by the drag law itself: F_d = b*v")

    # --- the speed history ---------------------------------------------------
    # v_drag itself is reached by the closure whenever a time is on the table,
    # so what is left here is the reading off the drag law.
    if solveFor == "v_drag" and None not in (Fd, b) and _nonzero(b):
        return _result(Fd / b, "v_drag = Fd_drag / b_drag", "F_d = b*v")

    if solveFor == "t_drag":
        if None not in (v, v_term, tau) and tau > 0 and v_term > 0 and 0 <= v < v_term:
            return _result(-tau * math.log(1 - v / v_term),
                           "t_drag = -tau_drag*ln(1 - v_drag/v_term)",
                           "v(t) = v_term(1 - e^(-t/tau)), solved for t")
        # A speed at or above v_term is never reached, however long you wait.
        return None

    if solveFor == "Fd_drag" and None not in (b, v):
        return _result(b * v, "Fd_drag = b_drag*v_drag", "F_d = b*v, opposing the motion")

    if solveFor == "x_drag" and v_term is not None:
        fade = _decay(t, tau)
        if fade is not None:
            return _result(v_term * t - v_term * tau * fade,
                           "x_drag = v_term*t_drag - v_term*tau_drag*(1 - exp(-t_drag/tau_drag))",
                           "x(t) is the integral of v(t): it trails the line v_term*t by "
                           "v_term*tau once the exponential has died away")

    return None


def _drag_quadratic_closure(k, note):
    """Same reasoning as the linear closure: the apparatus supplies m, c and a
    stopwatch, and both the speed and the drag force at that instant sit one
    definitional step past them."""
    m, c = k.get("mass_d"), k.get("c_drag")
    if None not in (m, c) and _nonzero(c) and m * G / c >= 0:
        val = (m * G / c) ** 0.5
        note("v_term", val, "v_term = sqrt(mass_d*g/c_drag) = %.6g m/s" % val,
             "v_term = sqrt(mass_d*g / c_drag)",
             "At terminal velocity c*v^2 = mg, so v_term = sqrt(mg/c)")
    vt, t = k.get("v_term"), k.get("t_drag")
    if None not in (vt, t) and vt > 0 and t >= 0:
        val = vt * math.tanh(G * t / vt)
        note("v_drag", val, "v_drag = v_term*tanh(g*t_drag/v_term) = %.6g m/s" % val,
             "v_drag = v_term*(1 - 2/(exp(2*g*t_drag/v_term) + 1))",
             "v(t) = v_term*tanh(g*t/v_term)")


def solve_drag_quadratic(k, solveFor):
    """Falling against a drag force proportional to the SQUARE of the speed.

    F_d = -c*v^2 is the high-speed regime -- a skydiver, a hailstone, a car
    at motorway speed -- where the body leaves a turbulent wake behind it.
    Doubling the speed now quadruples the drag, so terminal velocity depends
    on the square ROOT of the weight: v_term = sqrt(mg/c). Four times the
    mass falls only twice as fast, which is why a large hailstone hurts and
    a small one does not.

    The approach is a hyperbolic tangent, v(t) = v_term*tanh(g*t/v_term),
    which flattens out far more abruptly than the linear case: by
    t = 3*v_term/g the body is within half a percent of terminal.
    """
    m, c = k.get("mass_d"), k.get("c_drag")
    v_term, v, Fd = k.get("v_term"), k.get("v_drag"), k.get("Fd_drag")

    # v_term is DEFINED by m and c, so the closure above already reaches it.
    if solveFor == "mass_d" and None not in (c, v_term):
        return _result(c * v_term ** 2 / G, "mass_d = c_drag*v_term^2 / g", "c*v_term^2 = mg")
    if solveFor == "c_drag":
        if None not in (m, v_term) and _nonzero(v_term):
            return _result(m * G / v_term ** 2, "c_drag = mass_d*g / v_term^2", "c*v_term^2 = mg")
        if None not in (Fd, v) and _nonzero(v):
            return _result(Fd / v ** 2, "c_drag = Fd_drag / v_drag^2",
                           "c is defined by the drag law itself: F_d = c*v^2")

    # v(t) is reached by the closure whenever a time is on the table -- it
    # prints tanh as 1 - 2/(e^(2u) + 1), which is the same function but stays
    # finite for a large exponent instead of handing back inf/inf, so the
    # working can still be checked far out on the flat part of the curve.
    if solveFor == "v_drag" and None not in (Fd, c) and _nonzero(c):
        val = Fd / c
        return _result(val ** 0.5, "v_drag = sqrt(Fd_drag / c_drag)", "F_d = c*v^2") if val >= 0 else None

    if solveFor == "t_drag" and None not in (v, v_term) and v_term > 0 and -v_term < v < v_term:
        # The inverse of tanh, written with a logarithm so it can be evaluated
        # and checked by hand.
        return _result(v_term * math.log((v_term + v) / (v_term - v)) / (2 * G),
                       "t_drag = v_term*ln((v_term + v_drag)/(v_term - v_drag)) / (2*g)",
                       "v(t) = v_term*tanh(g*t/v_term), solved for t")

    if solveFor == "Fd_drag" and None not in (c, v):
        return _result(c * v ** 2, "Fd_drag = c_drag*v_drag^2", "F_d = c*v^2, opposing the motion")

    return None


def _sum_terms(terms):
    """Add signed terms, printing only the ones that can be non-zero.

    Each entry is (value, text, sign, live). A body at rest contributes
    exactly zero however it is pointing, so dropping its term from the printed
    line is not a tidy-up: it is what lets the working be shown at all, since
    the heading of a stationary body is a number the reader has no reason to
    have supplied, and an unresolved symbol withholds the whole line.
    """
    total = 0.0
    parts = []
    for value, text, sign, live in terms:
        total += value
        if not live:
            continue
        if not parts:
            parts.append(text if sign > 0 else "-" + text)
        else:
            parts.append(("+ " if sign > 0 else "- ") + text)
    return total, (" ".join(parts) if parts else "0")


def _heading(speed, angle):
    """A body at rest has no direction, so treat a missing one as harmless.

    Requiring a heading for a stationary target would make the commonest
    two-dimensional collision in the course -- a moving puck striking a still
    one -- unanswerable for want of a number that cannot change the answer.
    """
    if angle is None and speed == 0:
        return 0.0
    return angle


def _collision2d_inelastic_closure(k, note):
    """The wreck plus one body's approach fixes the other body's approach.

    This is the crash-reconstruction direction, and it belongs in the closure
    rather than in a branch because the ENERGY lost then becomes reachable
    too. Without it the solver can work out the missing approach velocity, and
    can compute the loss from two approach velocities, but not both in one
    request -- so a reader who measured the wreck could never ask what the
    collision cost.
    """
    m1, m2 = k.get("m1_2d"), k.get("m2_2d")
    vf, thf = k.get("vf_2d"), k.get("thetaf_2d")
    if None in (m1, m2, vf, thf):
        return

    for mine, mass, v_key, th_key, om_key, ov_key, oth_key in (
        ("1", m1, "v1i_2d", "theta1i_2d", "m2_2d", "v2i_2d", "theta2i_2d"),
        ("2", m2, "v2i_2d", "theta2i_2d", "m1_2d", "v1i_2d", "theta1i_2d"),
    ):
        ov = k.get(ov_key)
        oth = _heading(ov, k.get(oth_key))
        # note() refuses to overwrite, so this arm may still run when the
        # SPEED is known and only the direction is missing -- which is exactly
        # the case a reader who measured one approach and the wreck is in.
        if None in (ov, oth) or not _nonzero(mass):
            continue
        if k.get(v_key) is not None and k.get(th_key) is not None:
            continue
        om = k[om_key]

        def component(fn, trig):
            return _sum_terms([
                ((m1 + m2) * vf * trig(math.radians(thf)),
                 "(m1_2d + m2_2d)*vf_2d*%s(thetaf_2d)" % fn, 1, True),
                (-om * ov * trig(math.radians(oth)),
                 "%s*%s*%s(%s)" % (om_key, ov_key, fn, oth_key), -1, ov != 0),
            ])

        px, px_s = component("cos", math.cos)
        py, py_s = component("sin", math.sin)
        speed = (px ** 2 + py ** 2) ** 0.5 / mass
        note(v_key, speed, "%s = %.6g m/s, from the total momentum minus the other body" % (v_key, speed),
             "%s = sqrt((%s)^2 + (%s)^2) / m%s_2d" % (v_key, px_s, py_s, mine),
             "Subtract what the other body brought from the total momentum, and what is left is this one's")
        if _nonzero(px) or _nonzero(py):
            ang = math.degrees(math.atan2(py, px))
            note(th_key, ang, "%s = %.6g deg" % (th_key, ang),
                 "%s = atan2(%s, %s)" % (th_key, py_s, px_s),
                 "That body's momentum is the total minus the other's, and its direction follows")


def solve_collision2d_inelastic(k, solveFor):
    """Two bodies that collide and move off together, in a plane.

    Momentum is a VECTOR, so it is conserved component by component and the
    two components are two separate equations. Adding the speeds, or the
    angles, is the error this chapter exists to prevent: only the components
    add.

        p_x = m1*v1*cos(th1) + m2*v2*cos(th2)
        p_y = m1*v1*sin(th1) + m2*v2*sin(th2)
        vf  = sqrt(p_x^2 + p_y^2) / (m1 + m2)
        thf = atan2(p_y, p_x)

    Kinetic energy is NOT conserved -- the bodies stick, so this is the most
    inelastic collision possible and the loss is as large as momentum allows.
    """
    m1, m2 = k.get("m1_2d"), k.get("m2_2d")
    v1, v2 = k.get("v1i_2d"), k.get("v2i_2d")
    th1 = _heading(v1, k.get("theta1i_2d"))
    th2 = _heading(v2, k.get("theta2i_2d"))
    vf, thf = k.get("vf_2d"), k.get("thetaf_2d")
    ke_lost = k.get("KE_lost_2d")

    have_initial = None not in (m1, m2, v1, th1, v2, th2)

    def initial(fn):
        trig = math.cos if fn == "cos" else math.sin
        return _sum_terms([
            (m1 * v1 * trig(math.radians(th1)), "m1_2d*v1i_2d*%s(theta1i_2d)" % fn, 1, v1 != 0 or v2 == 0),
            (m2 * v2 * trig(math.radians(th2)), "m2_2d*v2i_2d*%s(theta2i_2d)" % fn, 1, v2 != 0),
        ])

    # --- forward: where the wreck goes ---------------------------------------
    if solveFor == "vf_2d":
        if have_initial and _nonzero(m1 + m2):
            px, px_s = initial("cos")
            py, py_s = initial("sin")
            return _result((px ** 2 + py ** 2) ** 0.5 / (m1 + m2),
                           "vf_2d = sqrt((%s)^2 + (%s)^2) / (m1_2d + m2_2d)" % (px_s, py_s),
                           "Momentum is conserved in each direction separately")
        if None not in (m1, m2, v1, v2, ke_lost) and _nonzero(m1 + m2):
            val = (m1 * v1 ** 2 + m2 * v2 ** 2 - 2 * ke_lost) / (m1 + m2)
            return _result(val ** 0.5,
                           "vf_2d = sqrt((m1_2d*v1i_2d^2 + m2_2d*v2i_2d^2 - 2*KE_lost_2d) / (m1_2d + m2_2d))",
                           "Whatever kinetic energy survives the impact is carried by the combined mass") if val >= 0 else None

    if solveFor == "thetaf_2d" and have_initial:
        px, px_s = initial("cos")
        py, py_s = initial("sin")
        if not _nonzero(px) and not _nonzero(py):
            # Zero total momentum leaves the wreck at rest, and a body at rest
            # has no direction to report.
            return None
        return _result(math.degrees(math.atan2(py, px)),
                       "thetaf_2d = atan2(%s, %s)" % (py_s, px_s),
                       "The wreck moves along the total momentum vector, whatever the two bodies were doing")

    if solveFor == "KE_lost_2d":
        if None not in (m1, m2, v1, v2, vf):
            return _result(0.5 * m1 * v1 ** 2 + 0.5 * m2 * v2 ** 2 - 0.5 * (m1 + m2) * vf ** 2,
                           "KE_lost_2d = 0.5*m1_2d*v1i_2d^2 + 0.5*m2_2d*v2i_2d^2 - 0.5*(m1_2d + m2_2d)*vf_2d^2",
                           "The kinetic energy that went into heat, sound and permanent deformation")
        if have_initial and _nonzero(m1 + m2):
            px, px_s = initial("cos")
            py, py_s = initial("sin")
            return _result(0.5 * m1 * v1 ** 2 + 0.5 * m2 * v2 ** 2 - (px ** 2 + py ** 2) / (2 * (m1 + m2)),
                           "KE_lost_2d = 0.5*m1_2d*v1i_2d^2 + 0.5*m2_2d*v2i_2d^2 - ((%s)^2 + (%s)^2) / (2*(m1_2d + m2_2d))"
                           % (px_s, py_s),
                           "The surviving kinetic energy is p^2/(2M), so the rest of it is lost")

    # Reading one body's approach off the wreck is done by the closure above,
    # so that the ENERGY lost is reachable from the same measurement.

    # --- backward: one unknown mass ------------------------------------------
    # Either component of the momentum equation pins a single unknown mass on
    # its own. The x equation is tried first and the y equation stands in when
    # the x denominator vanishes -- which happens whenever the approach and the
    # wreck share the same horizontal velocity.
    if solveFor in ("m1_2d", "m2_2d") and None not in (v1, th1, v2, th2, vf, thf):
        r1, r2, rf = math.radians(th1), math.radians(th2), math.radians(thf)
        for fn, trig in (("cos", math.cos), ("sin", math.sin)):
            lhs = v1 * trig(r1) - vf * trig(rf)
            rhs = vf * trig(rf) - v2 * trig(r2)
            if solveFor == "m1_2d" and m2 is not None and _nonzero(lhs):
                return _result(m2 * rhs / lhs,
                               "m1_2d = m2_2d*(vf_2d*{f}(thetaf_2d) - v2i_2d*{f}(theta2i_2d))"
                               " / (v1i_2d*{f}(theta1i_2d) - vf_2d*{f}(thetaf_2d))".format(f=fn),
                               "One component of momentum conservation is one equation in the one unknown mass")
            if solveFor == "m2_2d" and m1 is not None and _nonzero(rhs):
                return _result(m1 * lhs / rhs,
                               "m2_2d = m1_2d*(v1i_2d*{f}(theta1i_2d) - vf_2d*{f}(thetaf_2d))"
                               " / (vf_2d*{f}(thetaf_2d) - v2i_2d*{f}(theta2i_2d))".format(f=fn),
                               "One component of momentum conservation is one equation in the one unknown mass")

    return None


def solve_collision2d_general(k, solveFor):
    """Two bodies that collide in a plane and separate again.

    Momentum conservation gives two equations, one per axis, and nothing more.
    That is not enough to predict the outcome: four final numbers (two speeds,
    two directions) cannot come from two equations. A real problem always
    supplies the missing information -- one body's final velocity is measured,
    or the collision is declared elastic, or the geometry is fixed. This
    chapter takes the honest route: give it three of the four final quantities
    and it returns the fourth, in any direction.
    """
    m1, m2 = k.get("m1_2d"), k.get("m2_2d")
    v1i, v2i = k.get("v1i_2d"), k.get("v2i_2d")
    v1f, v2f = k.get("v1f_2d"), k.get("v2f_2d")
    th1i = _heading(v1i, k.get("theta1i_2d"))
    th2i = _heading(v2i, k.get("theta2i_2d"))
    th1f = _heading(v1f, k.get("theta1f_2d"))
    th2f = _heading(v2f, k.get("theta2f_2d"))

    def term(mass, speed, angle, mkey, vkey, akey, sign, fn):
        trig = math.cos if fn == "cos" else math.sin
        return (sign * mass * speed * trig(math.radians(angle)),
                "%s*%s*%s(%s)" % (mkey, vkey, fn, akey), sign, speed != 0)

    def combine(spec, fn):
        return _sum_terms([term(*args, fn=fn) for args in spec])

    # --- the momentum a body carries away, as the total minus the others -----
    #
    # Every one of these four is the same rearrangement: three momentum vectors
    # are known, the fourth is what makes the sum balance.
    ROUTES = {
        "v1f_2d": ("theta1f_2d", m1, "m1_2d", [
            (m1, v1i, th1i, "m1_2d", "v1i_2d", "theta1i_2d", 1),
            (m2, v2i, th2i, "m2_2d", "v2i_2d", "theta2i_2d", 1),
            (m2, v2f, th2f, "m2_2d", "v2f_2d", "theta2f_2d", -1),
        ], (v1i, th1i, v2i, th2i, v2f, th2f)),
        "v2f_2d": ("theta2f_2d", m2, "m2_2d", [
            (m1, v1i, th1i, "m1_2d", "v1i_2d", "theta1i_2d", 1),
            (m2, v2i, th2i, "m2_2d", "v2i_2d", "theta2i_2d", 1),
            (m1, v1f, th1f, "m1_2d", "v1f_2d", "theta1f_2d", -1),
        ], (v1i, th1i, v2i, th2i, v1f, th1f)),
        "v1i_2d": ("theta1i_2d", m1, "m1_2d", [
            (m1, v1f, th1f, "m1_2d", "v1f_2d", "theta1f_2d", 1),
            (m2, v2f, th2f, "m2_2d", "v2f_2d", "theta2f_2d", 1),
            (m2, v2i, th2i, "m2_2d", "v2i_2d", "theta2i_2d", -1),
        ], (v1f, th1f, v2f, th2f, v2i, th2i)),
        "v2i_2d": ("theta2i_2d", m2, "m2_2d", [
            (m1, v1f, th1f, "m1_2d", "v1f_2d", "theta1f_2d", 1),
            (m2, v2f, th2f, "m2_2d", "v2f_2d", "theta2f_2d", 1),
            (m1, v1i, th1i, "m1_2d", "v1i_2d", "theta1i_2d", -1),
        ], (v1f, th1f, v2f, th2f, v1i, th1i)),
    }
    for speed_key, (angle_key, mass, mass_key, spec, needed) in ROUTES.items():
        if solveFor not in (speed_key, angle_key):
            continue
        if mass is None or None in (m1, m2) or None in needed:
            continue
        px, px_s = combine(spec, "cos")
        py, py_s = combine(spec, "sin")
        if solveFor == speed_key and _nonzero(mass):
            return _result((px ** 2 + py ** 2) ** 0.5 / mass,
                           "%s = sqrt((%s)^2 + (%s)^2) / %s" % (speed_key, px_s, py_s, mass_key),
                           "Total momentum is fixed, so the fourth vector is whatever balances the other three")
        if solveFor == angle_key and (_nonzero(px) or _nonzero(py)):
            return _result(math.degrees(math.atan2(py, px)),
                           "%s = atan2(%s, %s)" % (angle_key, py_s, px_s),
                           "The missing momentum vector points wherever it must for the sum to balance")

    # --- one unknown mass ----------------------------------------------------
    if solveFor in ("m1_2d", "m2_2d") and None not in (v1i, th1i, v2i, th2i, v1f, th1f, v2f, th2f):
        for fn, trig in (("cos", math.cos), ("sin", math.sin)):
            lost1 = v1i * trig(math.radians(th1i)) - v1f * trig(math.radians(th1f))
            gained2 = v2f * trig(math.radians(th2f)) - v2i * trig(math.radians(th2i))
            if solveFor == "m1_2d" and m2 is not None and _nonzero(lost1):
                return _result(m2 * gained2 / lost1,
                               "m1_2d = m2_2d*(v2f_2d*{f}(theta2f_2d) - v2i_2d*{f}(theta2i_2d))"
                               " / (v1i_2d*{f}(theta1i_2d) - v1f_2d*{f}(theta1f_2d))".format(f=fn),
                               "Whatever momentum body 1 loses along an axis, body 2 gains along it")
            if solveFor == "m2_2d" and m1 is not None and _nonzero(gained2):
                return _result(m1 * lost1 / gained2,
                               "m2_2d = m1_2d*(v1i_2d*{f}(theta1i_2d) - v1f_2d*{f}(theta1f_2d))"
                               " / (v2f_2d*{f}(theta2f_2d) - v2i_2d*{f}(theta2i_2d))".format(f=fn),
                               "Whatever momentum body 1 loses along an axis, body 2 gains along it")

    return None


def _angmomentum_closure(k, note):
    """The apparatus gives a lever arm, a force and an angle -- not a torque.

    Every impulse, work and power relation in this chapter is stated in terms
    of tau, so without this pass a reader who has measured r, F, the angle
    between them and a duration cannot reach the angular impulse at all. The
    same goes for L: the chapter's two definitions of it feed everything else.
    """
    rF, F, thF = k.get("r_F"), k.get("F_ang"), k.get("theta_F")
    if None not in (rF, F, thF):
        val = rF * F * math.sin(math.radians(thF))
        note("tau_ang", val, "tau_ang = r_F*F_ang*sin(theta_F) = %.6g N*m" % val,
             "tau_ang = r_F*F_ang*sin(theta_F)",
             "Only the component of F perpendicular to r twists")

    m, v, r, th = k.get("m_ang"), k.get("v_ang"), k.get("r_ang"), k.get("theta_ang")
    if None not in (m, v, r, th):
        val = m * v * r * math.sin(math.radians(th))
        note("L_point", val, "L_point = m_ang*v_ang*r_ang*sin(theta_ang) = %.6g kg*m^2/s" % val,
             "L_point = m_ang*v_ang*r_ang*sin(theta_ang)",
             "Only the component of v perpendicular to r carries angular momentum")
    if None not in (k.get("I_ang"), k.get("omega_ang")):
        val = k["I_ang"] * k["omega_ang"]
        note("L_point", val, "L_point = I_ang*omega_ang = %.6g kg*m^2/s" % val,
             "L_point = I_ang*omega_ang", "For a rigid body the same quantity is I*omega")
    if k.get("L_point") is not None and k.get("I_ang") is not None and _nonzero(k["I_ang"]):
        val = k["L_point"] / k["I_ang"]
        note("omega_ang", val, "omega_ang = L_point/I_ang = %.6g rad/s" % val,
             "omega_ang = L_point / I_ang", "L = I*omega")
    if k.get("L_point") is not None and k.get("omega_ang") is not None and _nonzero(k["omega_ang"]):
        val = k["L_point"] / k["omega_ang"]
        note("I_ang", val, "I_ang = L_point/omega_ang = %.6g kg*m^2" % val,
             "I_ang = L_point / omega_ang", "L = I*omega")


def solve_angmomentum(k, solveFor):
    """Angular momentum, torque, and the impulse-momentum theorem for rotation.

    A particle moving in a straight line still has angular momentum about any
    origin it does not pass through: L = m*v*r*sin(theta), where theta is the
    angle between the position vector and the velocity. Only the perpendicular
    part counts, which is the same sine that appears in tau = r*F*sin(theta),
    and for the same reason -- a force pulling straight along the lever arm
    twists nothing at all.

    Every rotational statement here is the twin of a linear one: L = I*omega
    mirrors p = m*v, tau*dt = dL mirrors F*dt = dp, W = tau*dtheta mirrors
    W = F*d, and P = tau*omega mirrors P = F*v.

    Angles between vectors are entered in DEGREES; the angle turned through in
    W = tau*dtheta is in RADIANS, because that is the only unit in which the
    rotational work formula is true.
    """
    m, v, r, th = k.get("m_ang"), k.get("v_ang"), k.get("r_ang"), k.get("theta_ang")
    L, I, w = k.get("L_point"), k.get("I_ang"), k.get("omega_ang")
    tau, F, rF, thF = k.get("tau_ang"), k.get("F_ang"), k.get("r_F"), k.get("theta_F")
    dt, dL = k.get("dt_ang"), k.get("dL_ang")
    dth, W, P = k.get("dtheta_ang"), k.get("W_tau"), k.get("P_tau")

    sin_th = math.sin(math.radians(th)) if th is not None else None
    sin_F = math.sin(math.radians(thF)) if thF is not None else None

    # --- angular momentum ----------------------------------------------------
    if solveFor == "L_point":
        if None not in (m, v, r, sin_th):
            return _result(m * v * r * sin_th, "L_point = m_ang*v_ang*r_ang*sin(theta_ang)",
                           "Only the component of v perpendicular to r carries angular momentum")
        if None not in (I, w):
            return _result(I * w, "L_point = I_ang*omega_ang",
                           "For a rigid body the same quantity is I*omega")
    if solveFor == "m_ang":
        if None not in (L, v, r, sin_th) and _nonzero(v * r * sin_th):
            return _result(L / (v * r * sin_th), "m_ang = L_point / (v_ang*r_ang*sin(theta_ang))",
                           "L = m*v*r*sin(theta), rearranged")
        if None not in (I, r) and _nonzero(r):
            return _result(I / r ** 2, "m_ang = I_ang / r_ang^2", "I = m*r^2 for a particle, rearranged")
    if solveFor == "v_ang":
        if None not in (L, m, r, sin_th) and _nonzero(m * r * sin_th):
            return _result(L / (m * r * sin_th), "v_ang = L_point / (m_ang*r_ang*sin(theta_ang))",
                           "L = m*v*r*sin(theta), rearranged")
        # A body turning at omega on radius r moves at v = omega*r.
        if None not in (w, r):
            return _result(w * r, "v_ang = omega_ang*r_ang", "v = omega*r for circular motion")
    if solveFor == "r_ang" and None not in (L, m, v, sin_th) and _nonzero(m * v * sin_th):
        return _result(L / (m * v * sin_th), "r_ang = L_point / (m_ang*v_ang*sin(theta_ang))",
                       "L = m*v*r*sin(theta), rearranged")
    if solveFor == "theta_ang" and None not in (L, m, v, r) and _nonzero(m * v * r):
        ratio = L / (m * v * r)
        if -1 <= ratio <= 1:
            return _result(math.degrees(math.asin(ratio)), "theta_ang = asin(L_point / (m_ang*v_ang*r_ang))",
                           "L = m*v*r*sin(theta), solved for the angle")
        # More angular momentum than m*v*r can supply describes no geometry.
        return None
    if solveFor == "I_ang":
        if None not in (L, w) and _nonzero(w):
            return _result(L / w, "I_ang = L_point / omega_ang", "L = I*omega")
        # A particle at radius r has I = m*r^2 by definition. Refusing this
        # asked a reader holding a mass and a ruler to supply I instead.
        if None not in (m, r):
            return _result(m * r ** 2, "I_ang = m_ang*r_ang^2",
                           "A single particle at radius r has I = m*r^2 about that axis")

    if solveFor == "omega_ang":
        if None not in (L, I) and _nonzero(I):
            return _result(L / I, "omega_ang = L_point / I_ang", "L = I*omega")
        if None not in (P, tau) and _nonzero(tau):
            return _result(P / tau, "omega_ang = P_tau / tau_ang", "P = tau*omega")
        if None not in (v, r) and _nonzero(r):
            return _result(v / r, "omega_ang = v_ang / r_ang", "v = omega*r, rearranged")

    # --- torque --------------------------------------------------------------
    if solveFor == "tau_ang":
        if None not in (rF, F, sin_F):
            return _result(rF * F * sin_F, "tau_ang = r_F*F_ang*sin(theta_F)",
                           "Only the component of F perpendicular to r twists")
        if None not in (dL, dt) and _nonzero(dt):
            return _result(dL / dt, "tau_ang = dL_ang / dt_ang", "Angular impulse: tau*dt = dL")
        if None not in (W, dth) and _nonzero(dth):
            return _result(W / dth, "tau_ang = W_tau / dtheta_ang", "W = tau*dtheta")
        if None not in (P, w) and _nonzero(w):
            return _result(P / w, "tau_ang = P_tau / omega_ang", "P = tau*omega")
    if solveFor == "F_ang" and None not in (tau, rF, sin_F) and _nonzero(rF * sin_F):
        return _result(tau / (rF * sin_F), "F_ang = tau_ang / (r_F*sin(theta_F))",
                       "tau = r*F*sin(theta), rearranged")
    if solveFor == "r_F" and None not in (tau, F, sin_F) and _nonzero(F * sin_F):
        return _result(tau / (F * sin_F), "r_F = tau_ang / (F_ang*sin(theta_F))",
                       "tau = r*F*sin(theta), rearranged")
    if solveFor == "theta_F" and None not in (tau, rF, F) and _nonzero(rF * F):
        ratio = tau / (rF * F)
        if -1 <= ratio <= 1:
            return _result(math.degrees(math.asin(ratio)), "theta_F = asin(tau_ang / (r_F*F_ang))",
                           "tau = r*F*sin(theta), solved for the angle")
        # r*F is the most torque that force can ever produce at that radius.
        return None

    # --- angular impulse, work and power -------------------------------------
    if solveFor == "dL_ang" and None not in (tau, dt):
        return _result(tau * dt, "dL_ang = tau_ang*dt_ang",
                       "Angular impulse: a torque applied for a time changes L by exactly that much")
    if solveFor == "dt_ang":
        if None not in (dL, tau) and _nonzero(tau):
            return _result(dL / tau, "dt_ang = dL_ang / tau_ang", "Angular impulse: tau*dt = dL")
        if None not in (W, P) and _nonzero(P):
            return _result(W / P, "dt_ang = W_tau / P_tau", "P = W/dt")
    if solveFor == "W_tau":
        if None not in (tau, dth):
            return _result(tau * dth, "W_tau = tau_ang*dtheta_ang",
                           "W = tau*dtheta, the rotational form of W = F*d")
        if None not in (P, dt):
            return _result(P * dt, "W_tau = P_tau*dt_ang", "P = W/dt")
    if solveFor == "dtheta_ang" and None not in (W, tau) and _nonzero(tau):
        return _result(W / tau, "dtheta_ang = W_tau / tau_ang", "W = tau*dtheta")
    if solveFor == "P_tau":
        if None not in (tau, w):
            return _result(tau * w, "P_tau = tau_ang*omega_ang",
                           "P = tau*omega, the rotational form of P = F*v")
        if None not in (W, dt) and _nonzero(dt):
            return _result(W / dt, "P_tau = W_tau / dt_ang", "P = W/dt")

    return None


def _statics_closure(k, note):
    """Two scales under a plank read out both masses.

    That IS the apparatus for this chapter -- a beam across two supports, a
    load on it, and a reading from each support -- and the two equilibrium
    conditions between them pin the beam's mass and the load's. Without this
    pass a reader with two scale readings, a tape measure and nothing else
    could not reach a single further quantity.
    """
    FL, FR = k.get("F_left"), k.get("F_right")
    mb, ml = k.get("m_beam"), k.get("m_load")
    L, xl = k.get("L_beam"), k.get("x_load")
    if None in (FL, FR):
        return
    total = (FL + FR) / G

    if mb is not None and ml is None:
        note("m_load", total - mb, "m_load = (F_left + F_right)/g - m_beam = %.6g kg" % (total - mb),
             "m_load = (F_left + F_right)/g - m_beam",
             "The two supports between them carry the whole weight")
        return
    if ml is not None and mb is None:
        note("m_beam", total - ml, "m_beam = (F_left + F_right)/g - m_load = %.6g kg" % (total - ml),
             "m_beam = (F_left + F_right)/g - m_load",
             "The two supports between them carry the whole weight")
        return
    if None in (L, xl) or not _nonzero(0.5 * L - xl):
        # A load sitting exactly at the beam's midpoint loads both supports
        # just as the beam's own weight does, so the two masses are genuinely
        # indistinguishable from the readings alone.
        return
    mb_val = (FR * L - xl * (FL + FR)) / (G * (0.5 * L - xl))
    note("m_beam", mb_val, "m_beam = %.6g kg, from the two support readings" % mb_val,
         "m_beam = (F_right*L_beam - x_load*(F_left + F_right)) / (g*(0.5*L_beam - x_load))",
         "Moments about the left support and the force balance, solved together")
    note("m_load", total - mb_val, "m_load = (F_left + F_right)/g - m_beam = %.6g kg" % (total - mb_val),
         "m_load = (F_left + F_right)/g - m_beam",
         "The two supports between them carry the whole weight")


def solve_statics(k, solveFor):
    """A loaded beam that is not going anywhere: the two conditions together.

    Equilibrium needs BOTH sums to vanish -- forces and torques. Either alone
    is not enough, and the torque condition is the one students skip.

    The beam is uniform, of mass m_beam and length L_beam, lying along x from
    0 at the left end to L_beam at the right. Its own weight acts at its
    midpoint, L_beam/2, which is the single fact that makes the whole chapter
    work. A point load m_load sits at x_load from the left end.

    Three standard supports are covered, and they share the same torque sum:

      * Two props, one at each end, carrying F_left and F_right. Taking
        moments about one prop kills its own force and leaves one equation in
        the other.
      * A hinge at the left end and a cable at the right end, pulling at
        theta_stat above the beam. Only the cable's vertical component,
        T*sin(theta), has a moment arm about the hinge -- which is why a
        nearly horizontal cable needs an enormous tension.
      * A single pivot at x_pivot, with tau_net the net torque of the two
        weights about it, anticlockwise positive. It balances when tau_net is
        zero, which happens exactly at the centre of mass.
    """
    mb, L = k.get("m_beam"), k.get("L_beam")
    ml, xl = k.get("m_load"), k.get("x_load")
    xp, tau = k.get("x_pivot"), k.get("tau_net")
    FL, FR = k.get("F_left"), k.get("F_right")
    T, thS = k.get("T_stat"), k.get("theta_stat")

    sin_S = math.sin(math.radians(thS)) if thS is not None else None

    # --- the two props -------------------------------------------------------
    if solveFor == "F_right":
        if None not in (mb, L, ml, xl) and _nonzero(L):
            return _result(G * (0.5 * mb * L + ml * xl) / L,
                           "F_right = g*(0.5*m_beam*L_beam + m_load*x_load) / L_beam",
                           "Moments about the LEFT prop: its own force has no arm, so it drops out")
        if None not in (FL, mb, ml):
            return _result((mb + ml) * G - FL, "F_right = (m_beam + m_load)*g - F_left",
                           "The two props between them carry the whole weight")
    if solveFor == "F_left":
        if None not in (mb, L, ml, xl) and _nonzero(L):
            return _result(G * (0.5 * mb * L + ml * (L - xl)) / L,
                           "F_left = g*(0.5*m_beam*L_beam + m_load*(L_beam - x_load)) / L_beam",
                           "Moments about the RIGHT prop: its own force has no arm, so it drops out")
        if None not in (FR, mb, ml):
            return _result((mb + ml) * G - FR, "F_left = (m_beam + m_load)*g - F_right",
                           "The two props between them carry the whole weight")

    if solveFor == "m_load":
        if None not in (FR, L, mb, xl) and _nonzero(xl):
            return _result((FR * L / G - 0.5 * mb * L) / xl,
                           "m_load = (F_right*L_beam/g - 0.5*m_beam*L_beam) / x_load",
                           "Moments about the left prop, rearranged for the load")
        if None not in (FL, L, mb, xl) and _nonzero(L - xl):
            return _result((FL * L / G - 0.5 * mb * L) / (L - xl),
                           "m_load = (F_left*L_beam/g - 0.5*m_beam*L_beam) / (L_beam - x_load)",
                           "Moments about the right prop, rearranged for the load")
        if None not in (T, sin_S, L, mb, xl) and _nonzero(xl):
            return _result((T * L * sin_S / G - 0.5 * mb * L) / xl,
                           "m_load = (T_stat*L_beam*sin(theta_stat)/g - 0.5*m_beam*L_beam) / x_load",
                           "Moments about the hinge, rearranged for the load")
        if None not in (tau, mb, xp, L, xl) and _nonzero(xp - xl):
            return _result((tau / G - mb * (xp - 0.5 * L)) / (xp - xl),
                           "m_load = (tau_net/g - m_beam*(x_pivot - 0.5*L_beam)) / (x_pivot - x_load)",
                           "The net torque about the pivot, rearranged for the load")

    if solveFor == "x_load":
        if None not in (FR, L, mb, ml) and _nonzero(ml):
            return _result((FR * L / G - 0.5 * mb * L) / ml,
                           "x_load = (F_right*L_beam/g - 0.5*m_beam*L_beam) / m_load",
                           "Moments about the left prop, rearranged for the load's position")
        if None not in (FL, L, mb, ml) and _nonzero(ml):
            return _result(L - (FL * L / G - 0.5 * mb * L) / ml,
                           "x_load = L_beam - (F_left*L_beam/g - 0.5*m_beam*L_beam) / m_load",
                           "Moments about the right prop, rearranged for the load's position")
        if None not in (T, sin_S, L, mb, ml) and _nonzero(ml):
            return _result((T * L * sin_S / G - 0.5 * mb * L) / ml,
                           "x_load = (T_stat*L_beam*sin(theta_stat)/g - 0.5*m_beam*L_beam) / m_load",
                           "Moments about the hinge, rearranged for the load's position")
        if None not in (tau, mb, ml, xp, L) and _nonzero(ml):
            return _result(xp - (tau / G - mb * (xp - 0.5 * L)) / ml,
                           "x_load = x_pivot - (tau_net/g - m_beam*(x_pivot - 0.5*L_beam)) / m_load",
                           "The net torque about the pivot, rearranged for the load's position")

    if solveFor == "m_beam":
        if None not in (FR, L, ml, xl) and _nonzero(L):
            return _result(2 * (FR * L / G - ml * xl) / L,
                           "m_beam = 2*(F_right*L_beam/g - m_load*x_load) / L_beam",
                           "The beam's own weight acts at L/2, so its arm is half the length")
        if None not in (FL, L, ml, xl) and _nonzero(L):
            return _result(2 * (FL * L / G - ml * (L - xl)) / L,
                           "m_beam = 2*(F_left*L_beam/g - m_load*(L_beam - x_load)) / L_beam",
                           "The beam's own weight acts at L/2, so its arm is half the length")
        if None not in (T, sin_S, L, ml, xl) and _nonzero(L):
            return _result(2 * (T * L * sin_S / G - ml * xl) / L,
                           "m_beam = 2*(T_stat*L_beam*sin(theta_stat)/g - m_load*x_load) / L_beam",
                           "Moments about the hinge, rearranged for the beam")
        if None not in (tau, ml, xp, xl, L) and _nonzero(xp - 0.5 * L):
            return _result((tau / G - ml * (xp - xl)) / (xp - 0.5 * L),
                           "m_beam = (tau_net/g - m_load*(x_pivot - x_load)) / (x_pivot - 0.5*L_beam)",
                           "The net torque about the pivot, rearranged for the beam")

    if solveFor == "L_beam":
        if None not in (FR, mb, ml, xl) and _nonzero(FR - 0.5 * mb * G):
            return _result(G * ml * xl / (FR - 0.5 * mb * G),
                           "L_beam = g*m_load*x_load / (F_right - 0.5*m_beam*g)",
                           "Moments about the left prop are linear in the length")
        if None not in (FL, mb, ml, xl) and _nonzero(0.5 * mb * G + ml * G - FL):
            return _result(G * ml * xl / (0.5 * mb * G + ml * G - FL),
                           "L_beam = g*m_load*x_load / (0.5*m_beam*g + m_load*g - F_left)",
                           "Moments about the right prop are linear in the length")
        if None not in (T, sin_S, mb, ml, xl) and _nonzero(T * sin_S - 0.5 * mb * G):
            return _result(G * ml * xl / (T * sin_S - 0.5 * mb * G),
                           "L_beam = g*m_load*x_load / (T_stat*sin(theta_stat) - 0.5*m_beam*g)",
                           "Moments about the hinge are linear in the length")
        if None not in (tau, mb, ml, xp, xl) and _nonzero(mb):
            return _result(2 * (mb * xp + ml * (xp - xl) - tau / G) / mb,
                           "L_beam = 2*(m_beam*x_pivot + m_load*(x_pivot - x_load) - tau_net/g) / m_beam",
                           "The net torque about the pivot, rearranged for the length")

    # --- the cable -----------------------------------------------------------
    if solveFor == "T_stat" and None not in (mb, L, ml, xl, sin_S) and _nonzero(L * sin_S):
        return _result(G * (0.5 * mb * L + ml * xl) / (L * sin_S),
                       "T_stat = g*(0.5*m_beam*L_beam + m_load*x_load) / (L_beam*sin(theta_stat))",
                       "Only T*sin(theta) has a moment arm about the hinge, so a shallow cable pulls hard")
    if solveFor == "theta_stat" and None not in (mb, L, ml, xl, T) and _nonzero(L * T):
        ratio = G * (0.5 * mb * L + ml * xl) / (L * T)
        if -1 <= ratio <= 1:
            return _result(math.degrees(math.asin(ratio)),
                           "theta_stat = asin(g*(0.5*m_beam*L_beam + m_load*x_load) / (L_beam*T_stat))",
                           "Moments about the hinge, solved for the cable angle")
        # No angle can make that tension hold this beam: even pulling straight
        # up, T*L is less than the moment of the weights.
        return None

    # --- one pivot -----------------------------------------------------------
    if solveFor == "tau_net" and None not in (mb, L, ml, xl, xp):
        return _result(G * (mb * (xp - 0.5 * L) + ml * (xp - xl)),
                       "tau_net = g*(m_beam*(x_pivot - 0.5*L_beam) + m_load*(x_pivot - x_load))",
                       "Anticlockwise positive: a weight to the RIGHT of the pivot tips it clockwise")
    if solveFor == "x_pivot" and None not in (mb, L, ml, xl) and _nonzero(mb + ml):
        if tau is not None:
            return _result((0.5 * mb * L + ml * xl + tau / G) / (mb + ml),
                           "x_pivot = (0.5*m_beam*L_beam + m_load*x_load + tau_net/g) / (m_beam + m_load)",
                           "The net torque about the pivot, solved for where the pivot must be")
        return _result((0.5 * mb * L + ml * xl) / (mb + ml),
                       "x_pivot = (0.5*m_beam*L_beam + m_load*x_load) / (m_beam + m_load)",
                       "A beam balances at its centre of mass, where the net torque is zero")

    return None


def _relvel_closure(k, note):
    """Speed made good is one definitional step from the boat and the current.

    A reader measures the boat's speed in still water, the current, and the
    width of the river -- that is the whole apparatus -- and then asks how
    long the crossing takes. t = w/v_ground needs a v_ground the solver can
    work out but will not chain to, so the commonest question in the chapter
    came back "you have not given enough values".
    """
    vb, vc, thH = k.get("v_boat"), k.get("v_current"), k.get("theta_head")
    if None not in (vb, vc) and abs(vc) < abs(vb):
        # At or past a current that matches the boat there is no crossing to
        # make good, and filling a zero here would hand back an infinite
        # crossing time instead of reporting that it cannot be done.
        val = (vb ** 2 - vc ** 2) ** 0.5
        note("v_ground", val, "v_ground = sqrt(v_boat^2 - v_current^2) = %.6g m/s" % val,
             "v_ground = sqrt(v_boat^2 - v_current^2)",
             "What is left of the boat's speed once the upstream part is spent on the current")
    if None not in (vb, thH):
        across = vb * math.cos(math.radians(thH))
        note("v_ground", across, "v_ground = v_boat*cos(theta_head) = %.6g m/s" % across,
             "v_ground = v_boat*cos(theta_head)",
             "Only the across-stream component of the boat's velocity makes progress")
        upstream = vb * math.sin(math.radians(thH))
        note("v_current", upstream, "v_current = v_boat*sin(theta_head) = %.6g m/s" % upstream,
             "v_current = v_boat*sin(theta_head)",
             "The upstream component of the boat's velocity exactly matches the current")
    if k.get("v_boat") is None and None not in (k.get("v_ground"), k.get("v_current")):
        val = (k["v_ground"] ** 2 + k["v_current"] ** 2) ** 0.5
        note("v_boat", val, "v_boat = sqrt(v_ground^2 + v_current^2) = %.6g m/s" % val,
             "v_boat = sqrt(v_ground^2 + v_current^2)",
             "The boat's own velocity is the vector sum of what it makes good and what it spends")


def solve_relvel(k, solveFor):
    """Velocity is only ever measured against a frame, and frames add.

    The subscript rule v(A rel C) = v(A rel B) + v(B rel C) is the whole
    chapter. A boat's velocity over the ground is its velocity through the
    water PLUS the water's velocity over the ground, and those two are at an
    angle to each other, so they combine as vectors and never by adding
    speeds.

    To land straight across, the boat must aim UPSTREAM by enough that the
    upstream component of its own velocity exactly cancels the current:

        sin(theta_head) = v_current / v_boat

    which has no solution at all once the current matches the boat's speed --
    a boat that cannot out-swim the river cannot land opposite where it
    started, however it is steered. Aiming straight across instead crosses
    sooner, in w/v_boat, but lands v_current*w/v_boat downstream.

    The second half of the chapter is the general two-frame case: give the two
    velocities as components and it returns the relative velocity as a
    magnitude and a direction.
    """
    vb, vc, w = k.get("v_boat"), k.get("v_current"), k.get("w_river")
    thH, vg = k.get("theta_head"), k.get("v_ground")
    tc, dr = k.get("t_cross"), k.get("drift")
    ax, ay = k.get("v_a_x"), k.get("v_a_y")
    bx, by = k.get("v_b_x"), k.get("v_b_y")
    vrm, vrd = k.get("v_rel_mag"), k.get("v_rel_dir")

    sin_H = math.sin(math.radians(thH)) if thH is not None else None
    cos_H = math.cos(math.radians(thH)) if thH is not None else None

    # --- the river crossing ---------------------------------------------------
    if solveFor == "theta_head" and None not in (vb, vc) and _nonzero(vb):
        if abs(vc) >= abs(vb):
            # The real answer is "you cannot": every heading leaves some
            # downstream component, so there is no angle that lands you
            # opposite where you started.
            return None
        return _result(math.degrees(math.asin(vc / vb)), "theta_head = asin(v_current / v_boat)",
                       "Aim upstream by exactly enough to cancel the current")

    if solveFor == "v_ground":
        if None not in (vb, vc):
            if abs(vc) >= abs(vb):
                return None
            return _result((vb ** 2 - vc ** 2) ** 0.5, "v_ground = sqrt(v_boat^2 - v_current^2)",
                           "What is left of the boat's speed once the upstream part is spent on the current")
        if None not in (vb, cos_H):
            return _result(vb * cos_H, "v_ground = v_boat*cos(theta_head)",
                           "Only the across-stream component of the boat's velocity makes progress")
        if None not in (w, tc) and _nonzero(tc):
            return _result(w / tc, "v_ground = w_river / t_cross", "Speed made good is width over time")

    if solveFor == "v_boat":
        if None not in (vg, vc):
            return _result((vg ** 2 + vc ** 2) ** 0.5, "v_boat = sqrt(v_ground^2 + v_current^2)",
                           "The boat's own velocity is the vector sum of what it makes good and what it spends")
        if None not in (vc, sin_H) and _nonzero(sin_H):
            return _result(vc / sin_H, "v_boat = v_current / sin(theta_head)",
                           "sin(theta) = v_current/v_boat, rearranged")
        if None not in (vc, w, dr) and _nonzero(dr):
            return _result(vc * w / dr, "v_boat = v_current*w_river / drift",
                           "Aimed straight across, the drift is the current times w/v_boat")
    if solveFor == "v_current":
        if None not in (vb, vg):
            val = vb ** 2 - vg ** 2
            return _result(val ** 0.5, "v_current = sqrt(v_boat^2 - v_ground^2)",
                           "The part of the boat's velocity spent cancelling the river") if val >= 0 else None
        if None not in (vb, sin_H):
            return _result(vb * sin_H, "v_current = v_boat*sin(theta_head)",
                           "The upstream component of the boat's velocity exactly matches the current")
        if None not in (dr, vb, w) and _nonzero(w):
            return _result(dr * vb / w, "v_current = drift*v_boat / w_river",
                           "Aimed straight across, drift = v_current*w/v_boat")

    if solveFor == "w_river":
        if None not in (vg, tc):
            return _result(vg * tc, "w_river = v_ground*t_cross", "Width is speed made good times time")
        if None not in (dr, vb, vc) and _nonzero(vc):
            return _result(dr * vb / vc, "w_river = drift*v_boat / v_current",
                           "Aimed straight across, drift = v_current*w/v_boat")
    if solveFor == "t_cross" and None not in (w, vg) and _nonzero(vg):
        return _result(w / vg, "t_cross = w_river / v_ground",
                       "Only the across-stream speed shortens the crossing")
    if solveFor == "drift" and None not in (vc, w, vb) and _nonzero(vb):
        return _result(vc * w / vb, "drift = v_current*w_river / v_boat",
                       "Aimed straight across, the crossing takes w/v_boat and the river carries you all of it")

    # --- the general two-frame case -------------------------------------------
    if solveFor == "v_rel_mag" and None not in (ax, ay, bx, by):
        return _result(((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5,
                       "v_rel_mag = sqrt((v_a_x - v_b_x)^2 + (v_a_y - v_b_y)^2)",
                       "Subtract the frames component by component, then take the magnitude")
    if solveFor == "v_rel_dir" and None not in (ax, ay, bx, by):
        if not _nonzero(ax - bx) and not _nonzero(ay - by):
            # Two bodies with the same velocity are at rest relative to each
            # other, and a body at rest has no direction.
            return None
        return _result(math.degrees(math.atan2(ay - by, ax - bx)),
                       "v_rel_dir = atan2(v_a_y - v_b_y, v_a_x - v_b_x)",
                       "The direction of the difference vector, measured from the x-axis")
    if solveFor == "v_a_x" and None not in (bx, vrm, vrd):
        return _result(bx + vrm * math.cos(math.radians(vrd)),
                       "v_a_x = v_b_x + v_rel_mag*cos(v_rel_dir)", "v_A = v_AB + v_B, component by component")
    if solveFor == "v_a_y" and None not in (by, vrm, vrd):
        return _result(by + vrm * math.sin(math.radians(vrd)),
                       "v_a_y = v_b_y + v_rel_mag*sin(v_rel_dir)", "v_A = v_AB + v_B, component by component")
    if solveFor == "v_b_x" and None not in (ax, vrm, vrd):
        return _result(ax - vrm * math.cos(math.radians(vrd)),
                       "v_b_x = v_a_x - v_rel_mag*cos(v_rel_dir)", "v_B = v_A - v_AB, component by component")
    if solveFor == "v_b_y" and None not in (ay, vrm, vrd):
        return _result(ay - vrm * math.sin(math.radians(vrd)),
                       "v_b_y = v_a_y - v_rel_mag*sin(v_rel_dir)", "v_B = v_A - v_AB, component by component")

    return None


def _banked_closure(k, note):
    """What a reader can measure on a real bank is its rise and its run, not
    its angle. Every other quantity in the chapter is stated in terms of the
    angle, so without this step a tape measure gets you nothing."""
    rise, run = k.get("rise_bank"), k.get("run_bank")
    if None not in (rise, run) and _nonzero(run):
        val = math.degrees(math.atan(rise / run))
        note("theta_bank_b", val, "theta_bank_b = atan(rise_bank/run_bank) = %.6g deg" % val,
             "theta_bank_b = atan(rise_bank / run_bank)",
             "The bank angle straight from the geometry of the road")


def solve_banked(k, solveFor):
    """A curve tilted inward, so the road can do some of the turning.

    On a flat bend only friction points inward. Tilt the road and the normal
    force tilts with it, and its horizontal component supplies centripetal
    force with no friction at all -- at exactly one speed:

        v = sqrt(g*R*tan(theta))

    Notice what is missing: the mass. It cancels, so a loaded lorry and an
    empty one hold the same bend at the same speed. The mass is kept as an
    input here precisely because it is a red herring, and because it is needed
    for the normal force, which is the one quantity that does depend on it.

    With friction there is a band of speeds rather than one:

        v_max = sqrt(g*R*(tan(theta) + mu)/(1 - mu*tan(theta)))
        v_min = sqrt(g*R*(tan(theta) - mu)/(1 + mu*tan(theta)))

    and v_min is zero whenever tan(theta) <= mu, because friction alone can
    then hold the car parked on the slope. If mu*tan(theta) reaches 1 there is
    no upper limit either -- the geometry runs out before the grip does.
    """
    v, r, th, mu = k.get("v_bank"), k.get("r_bank"), k.get("theta_bank_b"), k.get("mu_bank")
    vmax, vmin = k.get("v_max_bank"), k.get("v_min_bank")
    m, N = k.get("mass_bank"), k.get("Fn_bank")
    rise, run = k.get("rise_bank"), k.get("run_bank")

    rad = math.radians(th) if th is not None else None
    tan_t = math.tan(rad) if rad is not None and _nonzero(math.cos(rad)) else None
    cos_t = math.cos(rad) if rad is not None else None

    # --- the frictionless design speed ---------------------------------------
    if solveFor == "v_bank" and None not in (r, tan_t):
        val = G * r * tan_t
        return _result(val ** 0.5, "v_bank = sqrt(g*r_bank*tan(theta_bank_b))",
                       "The one speed the bank holds with no friction at all; the mass cancels") if val >= 0 else None
    if solveFor == "r_bank":
        if None not in (v, tan_t) and _nonzero(G * tan_t):
            return _result(v ** 2 / (G * tan_t), "r_bank = v_bank^2 / (g*tan(theta_bank_b))",
                           "v = sqrt(g*R*tan(theta)), rearranged")
        if None not in (vmax, tan_t, mu) and _nonzero(G * (tan_t + mu)):
            return _result(vmax ** 2 * (1 - mu * tan_t) / (G * (tan_t + mu)),
                           "r_bank = v_max_bank^2*(1 - mu_bank*tan(theta_bank_b)) / (g*(tan(theta_bank_b) + mu_bank))",
                           "The upper speed limit, rearranged for the radius")
    if solveFor == "theta_bank_b":
        if None not in (v, r) and _nonzero(G * r):
            return _result(math.degrees(math.atan(v ** 2 / (G * r))),
                           "theta_bank_b = atan(v_bank^2 / (g*r_bank))",
                           "The bank angle that needs no friction at this speed")
        if None not in (rise, run) and _nonzero(run):
            return _result(math.degrees(math.atan(rise / run)), "theta_bank_b = atan(rise_bank / run_bank)",
                           "The bank angle straight from the geometry of the road")
        if None not in (N, m) and _nonzero(N):
            ratio = m * G / N
            if -1 <= ratio <= 1:
                return _result(math.degrees(math.acos(ratio)), "theta_bank_b = acos(mass_bank*g / Fn_bank)",
                               "N = mg/cos(theta), solved for the angle")
            # A normal force smaller than the weight cannot hold the car on
            # any bank -- it would have to point partly downward.
            return None

    # --- friction widens one speed into a band --------------------------------
    if solveFor == "v_max_bank" and None not in (r, tan_t, mu):
        denom = 1 - mu * tan_t
        if denom <= 0:
            # Grip and geometry between them can hold ANY speed, so there is
            # no maximum to report.
            return None
        val = G * r * (tan_t + mu) / denom
        return _result(val ** 0.5,
                       "v_max_bank = sqrt(g*r_bank*(tan(theta_bank_b) + mu_bank) / (1 - mu_bank*tan(theta_bank_b)))",
                       "Above this the car slides UP the bank: friction is already pointing down-slope") if val >= 0 else None
    if solveFor == "v_min_bank" and None not in (r, tan_t, mu):
        num = tan_t - mu
        if num <= 0:
            return _result(0.0, "v_min_bank = 0",
                           "mu is at least tan(theta), so friction alone holds the car parked on the bank")
        val = G * r * num / (1 + mu * tan_t)
        return _result(val ** 0.5,
                       "v_min_bank = sqrt(g*r_bank*(tan(theta_bank_b) - mu_bank) / (1 + mu_bank*tan(theta_bank_b)))",
                       "Below this the car slides DOWN the bank") if val >= 0 else None
    if solveFor == "mu_bank":
        if None not in (vmax, r, tan_t) and _nonzero(G * r + vmax ** 2 * tan_t):
            return _result((vmax ** 2 - G * r * tan_t) / (G * r + vmax ** 2 * tan_t),
                           "mu_bank = (v_max_bank^2 - g*r_bank*tan(theta_bank_b))"
                           " / (g*r_bank + v_max_bank^2*tan(theta_bank_b))",
                           "The least friction that makes that top speed survivable")
        if None not in (vmin, r, tan_t) and vmin > 0 and _nonzero(G * r + vmin ** 2 * tan_t):
            return _result((G * r * tan_t - vmin ** 2) / (G * r + vmin ** 2 * tan_t),
                           "mu_bank = (g*r_bank*tan(theta_bank_b) - v_min_bank^2)"
                           " / (g*r_bank + v_min_bank^2*tan(theta_bank_b))",
                           "The least friction that stops the car sliding down below that speed")
        # A v_min of exactly zero says only that mu is AT LEAST tan(theta).
        # That is an inequality, not a value, so there is nothing to report.

    # --- the normal force, which is the one thing the mass does change --------
    if solveFor == "Fn_bank" and None not in (m, cos_t) and _nonzero(cos_t):
        return _result(m * G / cos_t, "Fn_bank = mass_bank*g / cos(theta_bank_b)",
                       "On a bank N exceeds mg, because it is also doing the turning")
    if solveFor == "mass_bank" and None not in (N, cos_t):
        return _result(N * cos_t / G, "mass_bank = Fn_bank*cos(theta_bank_b) / g", "N = mg/cos(theta)")

    # --- the geometry of the road itself --------------------------------------
    if solveFor == "rise_bank" and None not in (run, tan_t):
        return _result(run * tan_t, "rise_bank = run_bank*tan(theta_bank_b)", "tan(theta) = rise/run")
    if solveFor == "run_bank" and None not in (rise, tan_t) and _nonzero(tan_t):
        return _result(rise / tan_t, "run_bank = rise_bank / tan(theta_bank_b)", "tan(theta) = rise/run")

    return None


def _arrangement(value):
    """1 means series and 2 means parallel; anything else means unstated."""
    if value is None:
        return None
    if abs(value - 1) < 0.5:
        return "series"
    if abs(value - 2) < 0.5:
        return "parallel"
    return None


def _springs_combo_closure(k, note):
    """Two springs and a mass IS the apparatus.

    If that does not yield a period the chapter does not answer its own
    question, and it did not: every oscillator relation here is stated in
    terms of k_eq, which the solver could compute but would not chain to.
    Reducing the pair to one equivalent spring is the first move of the
    problem, so it belongs here rather than behind a separate request.
    """
    how = _arrangement(k.get("arrangement_sp"))
    k1, k2 = k.get("k1_sp"), k.get("k2_sp")
    if None in (k1, k2) or how is None:
        return
    if how == "parallel":
        note("k_eq_sp", k1 + k2, "k_eq_sp = k1_sp + k2_sp = %.6g N/m" % (k1 + k2),
             "k_eq_sp = k1_sp + k2_sp",
             "Parallel: both springs stretch by the same x, so their forces add")
    elif _nonzero(k1 + k2):
        val = k1 * k2 / (k1 + k2)
        note("k_eq_sp", val, "k_eq_sp = k1_sp*k2_sp/(k1_sp + k2_sp) = %.6g N/m" % val,
             "k_eq_sp = k1_sp*k2_sp / (k1_sp + k2_sp)",
             "Series: 1/k_eq = 1/k1 + 1/k2, so the pair is softer than either spring")


def solve_springs_combo(k, solveFor):
    """Two springs carrying one mass, and which way round they are.

    In PARALLEL both springs stretch by the same x, so their forces add and so
    do their constants: k_eq = k1 + k2. The pair is stiffer than either spring
    and the period gets SHORTER.

    In SERIES they share one force but split the stretch between them, so it
    is the compliances 1/k that add: 1/k_eq = 1/k1 + 1/k2. The pair is softer
    than either spring on its own -- softer even than the weaker one -- and the
    period gets LONGER. Almost everyone predicts this backwards the first time,
    because "two springs" sounds like "stronger".

    Either way the oscillator is an ordinary one once k_eq is known:
    T = 2*pi*sqrt(m/k_eq). Hang the mass on it instead and it settles at
    x = mg/k_eq, which gives the same period as a simple pendulum of that
    length: T = 2*pi*sqrt(x/g).
    """
    k1, k2, keq = k.get("k1_sp"), k.get("k2_sp"), k.get("k_eq_sp")
    m, T, w, x = k.get("mass_sp"), k.get("T_sp"), k.get("omega_sp"), k.get("x_sp")
    how = _arrangement(k.get("arrangement_sp"))

    TWO_PI = 2 * math.pi

    # --- combining the two springs -------------------------------------------
    # Combining the two springs is done by the closure above, so that a mass
    # and two constants -- the whole apparatus -- yields a period.
    if solveFor == "k_eq_sp":
        if None not in (m, T) and _nonzero(T):
            return _result(m * (TWO_PI / T) ** 2, "k_eq_sp = mass_sp*(2*pi/T_sp)^2", "T = 2*pi*sqrt(m/k)")
        if None not in (m, w):
            return _result(m * w ** 2, "k_eq_sp = mass_sp*omega_sp^2", "omega = sqrt(k/m)")
        if None not in (m, x) and _nonzero(x):
            return _result(m * G / x, "k_eq_sp = mass_sp*g / x_sp",
                           "The hanging mass stretches the combination until the spring force balances its weight")
    if solveFor == "k1_sp" and None not in (keq, k2):
        if how == "parallel":
            return _result(keq - k2, "k1_sp = k_eq_sp - k2_sp", "Parallel: k_eq = k1 + k2")
        if how == "series" and _nonzero(k2 - keq):
            if k2 <= keq:
                # A series pair is softer than EITHER spring, so a k_eq at or
                # above k2 describes no pair of positive constants.
                return None
            return _result(keq * k2 / (k2 - keq), "k1_sp = k_eq_sp*k2_sp / (k2_sp - k_eq_sp)",
                           "Series: 1/k1 = 1/k_eq - 1/k2")
    if solveFor == "k2_sp" and None not in (keq, k1):
        if how == "parallel":
            return _result(keq - k1, "k2_sp = k_eq_sp - k1_sp", "Parallel: k_eq = k1 + k2")
        if how == "series" and _nonzero(k1 - keq):
            if k1 <= keq:
                return None
            return _result(keq * k1 / (k1 - keq), "k2_sp = k_eq_sp*k1_sp / (k1_sp - k_eq_sp)",
                           "Series: 1/k2 = 1/k_eq - 1/k1")

    # --- the oscillator that results ------------------------------------------
    if solveFor == "mass_sp":
        if None not in (keq, T):
            return _result(keq * (T / TWO_PI) ** 2, "mass_sp = k_eq_sp*(T_sp/(2*pi))^2", "T = 2*pi*sqrt(m/k)")
        if None not in (keq, w) and _nonzero(w):
            return _result(keq / w ** 2, "mass_sp = k_eq_sp / omega_sp^2", "omega = sqrt(k/m)")
        if None not in (keq, x):
            return _result(keq * x / G, "mass_sp = k_eq_sp*x_sp / g", "The hanging mass stretches it by mg/k")
    if solveFor == "T_sp":
        if None not in (m, keq) and _nonzero(keq) and m / keq >= 0:
            return _result(TWO_PI * (m / keq) ** 0.5, "T_sp = 2*pi*sqrt(mass_sp / k_eq_sp)",
                           "Once the pair is reduced to one k_eq it is an ordinary spring-mass oscillator")
        if w is not None and _nonzero(w):
            return _result(TWO_PI / w, "T_sp = 2*pi / omega_sp", "T = 2*pi/omega")
        if x is not None and x >= 0:
            return _result(TWO_PI * (x / G) ** 0.5, "T_sp = 2*pi*sqrt(x_sp / g)",
                           "m/k equals x/g for a hanging spring, so the period reads off the static stretch")
    if solveFor == "omega_sp":
        if None not in (keq, m) and _nonzero(m) and keq / m >= 0:
            return _result((keq / m) ** 0.5, "omega_sp = sqrt(k_eq_sp / mass_sp)", "omega = sqrt(k/m)")
        if T is not None and _nonzero(T):
            return _result(TWO_PI / T, "omega_sp = 2*pi / T_sp", "T = 2*pi/omega")
        if x is not None and x > 0:
            return _result((G / x) ** 0.5, "omega_sp = sqrt(g / x_sp)",
                           "k/m equals g/x for a hanging spring")
    if solveFor == "x_sp":
        if None not in (m, keq) and _nonzero(keq):
            return _result(m * G / keq, "x_sp = mass_sp*g / k_eq_sp",
                           "The hanging mass settles where the spring force balances its weight")
        if T is not None:
            return _result(G * (T / TWO_PI) ** 2, "x_sp = g*(T_sp/(2*pi))^2", "T = 2*pi*sqrt(x/g)")
        if w is not None and _nonzero(w):
            return _result(G / w ** 2, "x_sp = g / omega_sp^2", "omega = sqrt(g/x)")

    # --- reading the arrangement back off the numbers -------------------------
    if solveFor == "arrangement_sp" and None not in (k1, k2, keq):
        scale = max(abs(k1), abs(k2), abs(keq), 1e-12)
        if abs(keq - (k1 + k2)) / scale < 1e-6:
            return _result(2.0, "arrangement_sp = 2",
                           "k_eq is the SUM of the two constants, so the springs are in parallel")
        if _nonzero(k1 + k2) and abs(keq - k1 * k2 / (k1 + k2)) / scale < 1e-6:
            return _result(1.0, "arrangement_sp = 1",
                           "k_eq is softer than either spring, so the springs are in series")
        return None

    return None


def solve_physical_pendulum(k, solveFor):
    """A real body swinging on a pivot, which is not a point on a string.

    A physical pendulum has its own moment of inertia about the pivot, and
    that is what sets the period:

        T = 2*pi*sqrt(I_pivot / (m*g*d)),   d = pivot to centre of mass

    Reaching for T = 2*pi*sqrt(d/g) here is the classic wrong answer, and it
    is not a near miss: for a stick swinging about one end it is out by about
    35%.

    For a uniform stick the parallel-axis theorem gives I = m(L^2/12 + d^2),
    so the period depends on the pivot position in a way that has a minimum:

        T = 2*pi*sqrt((L^2/12 + d^2) / (g*d))

    Move the pivot toward the centre and the restoring torque m*g*d dies away
    faster than I does, so the swing slows down again. The quickest swing is at
    d = L/sqrt(12) = 0.2887*L, and every period except that one is shared by
    TWO pivot positions -- the fact Kater's pendulum uses to measure g.
    """
    m, I, d = k.get("m_pp"), k.get("I_pp"), k.get("d_pp")
    T, L, w = k.get("T_pp"), k.get("L_stick_pp"), k.get("omega_pp")
    dmin = k.get("d_min_pp")

    TWO_PI = 2 * math.pi

    # --- the period -----------------------------------------------------------
    if solveFor == "T_pp":
        if None not in (I, m, d) and _nonzero(m * G * d) and I / (m * G * d) >= 0:
            return _result(TWO_PI * (I / (m * G * d)) ** 0.5, "T_pp = 2*pi*sqrt(I_pp / (m_pp*g*d_pp))",
                           "The body's own moment of inertia sets the period, not the distance alone")
        if None not in (L, d) and d > 0:
            return _result(TWO_PI * ((L ** 2 / 12 + d ** 2) / (G * d)) ** 0.5,
                           "T_pp = 2*pi*sqrt((L_stick_pp^2/12 + d_pp^2) / (g*d_pp))",
                           "A uniform stick has I = m(L^2/12 + d^2), and the mass then cancels out")
        if w is not None and _nonzero(w):
            return _result(TWO_PI / w, "T_pp = 2*pi / omega_pp", "T = 2*pi/omega")
    if solveFor == "omega_pp":
        if None not in (m, d, I) and _nonzero(I) and m * G * d / I >= 0:
            return _result((m * G * d / I) ** 0.5, "omega_pp = sqrt(m_pp*g*d_pp / I_pp)",
                           "m*g*d is the restoring torque per radian, and I is the inertia resisting it")
        if None not in (L, d) and d > 0:
            return _result((G * d / (L ** 2 / 12 + d ** 2)) ** 0.5,
                           "omega_pp = sqrt(g*d_pp / (L_stick_pp^2/12 + d_pp^2))",
                           "The uniform-stick case, where the mass cancels")
        if T is not None and _nonzero(T):
            return _result(TWO_PI / T, "omega_pp = 2*pi / T_pp", "T = 2*pi/omega")

    # --- the moment of inertia and the mass -----------------------------------
    if solveFor == "I_pp":
        if None not in (m, L, d):
            return _result(m * (L ** 2 / 12 + d ** 2), "I_pp = m_pp*(L_stick_pp^2/12 + d_pp^2)",
                           "Parallel-axis theorem: I about the pivot is I about the centre plus m*d^2")
        if None not in (T, m, d):
            return _result(m * G * d * (T / TWO_PI) ** 2, "I_pp = m_pp*g*d_pp*(T_pp/(2*pi))^2",
                           "T = 2*pi*sqrt(I/(m*g*d)), rearranged")
    if solveFor == "m_pp":
        if None not in (I, T, d) and _nonzero(G * d * (T / TWO_PI) ** 2):
            return _result(I / (G * d * (T / TWO_PI) ** 2), "m_pp = I_pp / (g*d_pp*(T_pp/(2*pi))^2)",
                           "T = 2*pi*sqrt(I/(m*g*d)), rearranged")
        if None not in (I, L, d) and _nonzero(L ** 2 / 12 + d ** 2):
            return _result(I / (L ** 2 / 12 + d ** 2), "m_pp = I_pp / (L_stick_pp^2/12 + d_pp^2)",
                           "I = m(L^2/12 + d^2) for a uniform stick, rearranged")

    # --- where the pivot is ---------------------------------------------------
    if solveFor == "d_pp":
        if None not in (I, m, T) and _nonzero(m * G * (T / TWO_PI) ** 2):
            return _result(I / (m * G * (T / TWO_PI) ** 2), "d_pp = I_pp / (m_pp*g*(T_pp/(2*pi))^2)",
                           "T = 2*pi*sqrt(I/(m*g*d)), rearranged")
        if None not in (I, m, L) and _nonzero(m):
            val = I / m - L ** 2 / 12
            return _result(val ** 0.5, "d_pp = sqrt(I_pp/m_pp - L_stick_pp^2/12)",
                           "Parallel-axis theorem, rearranged for the offset") if val >= 0 else None
        if None not in (T, L):
            # d^2 - C*d + L^2/12 = 0. Both roots are genuine: two pivot
            # positions share one period, which is the whole basis of Kater's
            # pendulum. Report the outer one when it still lies on the stick,
            # and the inner one otherwise.
            C = G * (T / TWO_PI) ** 2
            disc = C ** 2 - L ** 2 / 3
            if disc < 0:
                # Below the minimum period no pivot on the stick can swing
                # this quickly.
                return None
            outer = (C + disc ** 0.5) / 2
            inner = (C - disc ** 0.5) / 2
            if 0 < outer <= L / 2 + 1e-12:
                return _result(outer,
                               "d_pp = (g*(T_pp/(2*pi))^2 + sqrt((g*(T_pp/(2*pi))^2)^2 - L_stick_pp^2/3)) / 2",
                               "Two pivot positions share every period; this is the outer one")
            if 0 < inner <= L / 2 + 1e-12:
                return _result(inner,
                               "d_pp = (g*(T_pp/(2*pi))^2 - sqrt((g*(T_pp/(2*pi))^2)^2 - L_stick_pp^2/3)) / 2",
                               "Two pivot positions share every period; the outer one falls off the stick, so this is the inner one")
            return None

    if solveFor == "L_stick_pp":
        if None not in (I, m, d) and _nonzero(m):
            val = 12 * (I / m - d ** 2)
            return _result(val ** 0.5, "L_stick_pp = sqrt(12*(I_pp/m_pp - d_pp^2))",
                           "I = m(L^2/12 + d^2), rearranged for the length") if val >= 0 else None
        if None not in (T, d) and d > 0:
            val = 12 * (G * d * (T / TWO_PI) ** 2 - d ** 2)
            return _result(val ** 0.5, "L_stick_pp = sqrt(12*(g*d_pp*(T_pp/(2*pi))^2 - d_pp^2))",
                           "The uniform-stick period, rearranged for the length") if val >= 0 else None
        if dmin is not None:
            return _result(dmin * 12 ** 0.5, "L_stick_pp = d_min_pp*sqrt(12)", "d_min = L/sqrt(12)")
    if solveFor == "d_min_pp":
        if L is not None:
            return _result(L / 12 ** 0.5, "d_min_pp = L_stick_pp / sqrt(12)",
                           "Where dT/dd = 0: the quickest swing of a uniform stick, at 0.2887 of its length")
        # The general result behind the stick's L/sqrt(12): the period is
        # shortest when the pivot sits one RADIUS OF GYRATION from the centre
        # of mass, and I/m - d^2 is that radius squared by the parallel-axis
        # theorem. It holds for a disc or a hoop as well as for a stick.
        if None not in (I, m, d) and _nonzero(m):
            val = I / m - d ** 2
            return _result(val ** 0.5, "d_min_pp = sqrt(I_pp/m_pp - d_pp^2)",
                           "The quickest swing sits one radius of gyration from the centre of mass") if val >= 0 else None

    return None


SOLVERS = {
    "kinematics": solve_kinematics,
    "projectile": solve_projectile,
    "gravitation": solve_gravitation,
    "calc_varforce": solve_calc_varforce,
    "forces": solve_forces,
    "momentum": solve_momentum,
    "collisions": solve_collisions,
    "energy": solve_energy,
    "work": solve_work,
    "rotKinematics": solve_rot_kinematics,
    "rotDynamics": solve_rot_dynamics,
    "oscillations": solve_oscillations,
    "calc_kinematics": solve_calc_kinematics,
    "calc_rotational": solve_calc_rotational,
    "calc_workenergy": solve_calc_workenergy,
    "calc_oscillations": solve_calc_oscillations,
    "atwood": solve_atwood,
    "atwood_flywheel": solve_atwood_flywheel,
    "rolling_race": solve_rolling_race,
    "loop_coaster": solve_loop_coaster,
    "ballistic_pendulum": solve_ballistic_pendulum,
    "orbital": solve_orbital,
    "ramp": solve_ramp,
    "elevator": solve_elevator,
    "com": solve_com,
    "roundabout": solve_roundabout,
    "blockstack": solve_blockstack,
    # Chapters whose apparatus hands the reader quantities one definitional
    # step short of the governing equation get a closure pass first. See
    # _run_closure: without it the solver refuses a reader who has supplied
    # everything the apparatus actually offers.
    "drag_linear": _closed(solve_drag_linear, _drag_linear_closure),
    "drag_quadratic": _closed(solve_drag_quadratic, _drag_quadratic_closure),
    "collision2d_inelastic": _closed(solve_collision2d_inelastic, _collision2d_inelastic_closure),
    "collision2d_general": solve_collision2d_general,
    "angmomentum": _closed(solve_angmomentum, _angmomentum_closure),
    "statics": _closed(solve_statics, _statics_closure),
    "relvel": _closed(solve_relvel, _relvel_closure),
    "banked": _closed(solve_banked, _banked_closure),
    "springs_combo": _closed(solve_springs_combo, _springs_combo_closure),
    "physical_pendulum": solve_physical_pendulum,
}
