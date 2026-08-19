// kinematics.js — engine parameters + exact mechanical kinematics (pure, no DOM/GL).
// Units: millimetres, degrees for angles (radians via Math where needed).

export const ENGINE = {
  // --- geometry (mm) ---
  bore: 86,            // cylinder bore diameter
  stroke: 86,          // piston stroke (crank throw = stroke/2)
  crankRadius: 43,     // stroke / 2
  rodLength: 146,      // connecting rod centre-to-centre
  boreSpacing: 100,    // distance between adjacent cylinder axes
  deckHeight: 222,     // top deck Y (head gasket surface)
  crankAxisY: 0,       // crankshaft main-axis height

  // --- valvetrain ---
  valveLiftMax: 8,          // mm
  camBaseRadius: 14,        // mm
  intakeCenter: 470,        // cycle-angle (deg) of peak intake lift (0 = firing TDC)
  exhaustCenter: 250,       // cycle-angle (deg) of peak exhaust lift
  valveDuration: 240,       // crank degrees of valve opening
  camHalfAngle: 60,         // half-duration in CAM degrees (240/2 crank = 120 cam => 60 half)
};

export const DEG = Math.PI / 180;

// Cylinder indexing: 0 = cylinder #1 (front, timing end) ... 3 = cylinder #4.
export const FIRE_ORDER = [1, 3, 4, 2];           // firing order (human labels)
// Crank angle (deg) at which each cylinder fires (spark TDC / power-stroke start).
export const FIRE_PHASE = [0, 540, 180, 360];     // cylinders 1,2,3,4
// Crank-pin throw angle (deg) relative to +Y, flat-plane inline-4: throws 1&4 = 0, 2&3 = 180.
export const PIN_OFFSET = [0, 180, 180, 0];

export const STROKE_NAMES = ['做功', '排气', '进气', '压缩']; // power, exhaust, intake, compression
export const STROKE_KEYS = ['power', 'exhaust', 'intake', 'compression'];
export const STROKE_COLORS = {
  intake: [0.30, 0.60, 1.00],   // blue (fresh charge)
  compression: [1.00, 0.55, 0.15], // amber (compressing)
  power: [1.00, 0.30, 0.12],    // orange/red (combustion)
  exhaust: [0.55, 0.55, 0.58],  // grey (burnt gas)
};

export function wrap360(d) { return ((d % 360) + 360) % 360; }
export function wrap720(d) { return ((d % 720) + 720) % 720; }
export function wrap180(d) { return ((d + 180) % 360 + 360) % 360 - 180; }

// --- slider-crank: exact piston / rod kinematics ---
// crankDeg = current crankshaft angle, pinOffsetDeg = throw angle of that cylinder.
// Returns pin (big-end) position and piston (small-end) Y relative to crank centreline.
export function pistonKinematics(crankDeg, pinOffsetDeg) {
  const theta = (crankDeg + pinOffsetDeg) * DEG;
  const r = ENGINE.crankRadius, L = ENGINE.rodLength;
  const pinX = r * Math.sin(theta);
  const pinY = r * Math.cos(theta);
  const pistonY = pinY + Math.sqrt(Math.max(L * L - pinX * pinX, 0));
  const rodAngle = Math.atan2(pinX, pistonY - pinY); // rad, from vertical
  return { pinX, pinY, pistonY, rodAngleDeg: rodAngle / DEG };
}

// --- four-stroke cycle: which stroke a cylinder is in at crankDeg ---
export function cycleAngleOf(cylIdx, crankDeg) {
  return wrap720(crankDeg - FIRE_PHASE[cylIdx]);
}

export function strokeIndex(cylIdx, crankDeg) {
  const ca = cycleAngleOf(cylIdx, crankDeg);
  if (ca < 180) return 0;        // power
  if (ca < 360) return 1;        // exhaust
  if (ca < 540) return 2;        // intake
  return 3;                      // compression
}

export function strokeKey(cylIdx, crankDeg) {
  return STROKE_KEYS[strokeIndex(cylIdx, crankDeg)];
}

// --- valve lift: cam profile shared by geometry and kinematics ---
// bumpShape(betaDeg): 0..1, nonzero only within +- halfCamAngle.
export function bumpShape(betaDeg) {
  const b = wrap180(betaDeg);
  const half = ENGINE.camHalfAngle;
  if (Math.abs(b) > half) return 0;
  return (1 + Math.cos(Math.PI * b / half)) / 2;
}

// cam lobe radius (mm) at lobe angle phiDeg (0 = nose).
export function camLobeRadius(phiDeg) {
  return ENGINE.camBaseRadius + ENGINE.valveLiftMax * bumpShape(phiDeg);
}

// cam angle (deg) at which the given valve reaches peak lift.
export function valveOpenCamDeg(cylIdx, which) {
  const center = which === 'intake' ? ENGINE.intakeCenter : ENGINE.exhaustCenter;
  return wrap360((FIRE_PHASE[cylIdx] + center) / 2);
}

// valve lift (mm) at current crank angle.
export function valveLift(crankDeg, cylIdx, which) {
  const camDeg = crankDeg / 2;
  const gammaOpen = valveOpenCamDeg(cylIdx, which);
  return ENGINE.valveLiftMax * bumpShape(camDeg - gammaOpen);
}

// --- ignition flash: true shortly after the spark fires (start of power stroke) ---
export function isFiring(cylIdx, crankDeg, windowDeg = 25) {
  const ca = cycleAngleOf(cylIdx, crankDeg);
  return ca >= 0 && ca < windowDeg;
}
