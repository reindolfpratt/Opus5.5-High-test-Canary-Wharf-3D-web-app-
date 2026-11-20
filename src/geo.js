// Mapping between the model's local metres and real-world lat/lng, plus Google Street View links.
// Real coordinates were geocoded from OpenStreetMap (Nominatim). The model's layout is simplified, so the
// mapping is a best-fit similarity transform plus a local correction that snaps each anchor to its true position.

const LAT0 = 51.504949, LON0 = -0.01951; // One Canada Square
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const toMetric = (lat, lon) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
const fromMetric = (X, Z) => [LAT0 - Z / M_LAT, LON0 + X / M_LON];

// Landmarks: anchor = where the thing is in the model; real = true lat/lng; view = a ground-level viewpoint in the
// model (x, z, compass heading in degrees where 0 = north, pitch in degrees) used for "Go here" and Street View.
export const LANDMARKS = [
  { name: 'Cabot Square', anchor: [-230, 0], real: [51.505302, -0.022872], view: [-262, 28, 60, 8], labelY: 5 },
  { name: 'One Canada Square', anchor: [0, 0], real: [51.504949, -0.01951], view: [72, 16, 285, 32], labelY: 14 },
  { name: 'Canada Square Park', anchor: [100, 0], real: [51.504767, -0.017936], view: [58, -28, 120, 5], labelY: 4 },
  { name: '8 Canada Square (HSBC)', anchor: [165, -62], real: [51.505432, -0.01744], view: [150, -4, 0, 35], labelY: 14 },
  { name: '25 Canada Square (Citi)', anchor: [165, 66], real: [51.504015, -0.017985], view: [150, 6, 180, 35], labelY: 14 },
  { name: 'Jubilee Park', anchor: [270, 0], real: [51.503345, -0.018848], view: [238, 22, 90, 5], labelY: 5 },
  { name: 'Montgomery Square', anchor: [385, 4], real: [51.503335, -0.01676], view: [368, 4, 90, 6], labelY: 4 },
  { name: 'One Churchill Place', anchor: [500, -80], real: [51.505046, -0.014373], view: [446, -42, 50, 28], labelY: 14 },
  { name: '10 Upper Bank Street', anchor: [385, 62], real: [51.502734, -0.016898], view: [439, 24, 230, 28], labelY: 14 },
  { name: 'Crossrail Place', anchor: [75, -196], real: [51.506106, -0.017585], view: [60, -146, 0, 10], labelY: 20 },
  { name: 'Westferry Circus', anchor: [-580, 0], real: [51.505757, -0.026876], view: [-520, -7, 270, 4], labelY: 5 },
  { name: 'Newfoundland', anchor: [-372, 216], real: [51.50425, -0.025092], view: [-300, 180, 240, 30], labelY: 14 },
  { name: '40 Bank Street', anchor: [-55, 143], real: [51.502571, -0.019412], view: [-55, 180, 0, 35], labelY: 14 },
  { name: 'West India Quay warehouses', anchor: [-195, -312], real: [51.507634, -0.023869], view: [-195, -146, 0, 6], labelY: 26 },
  { name: 'Landmark Pinnacle', anchor: [-430, 478], real: [51.502715, -0.02548], view: [-430, 440, 180, 35], labelY: 14 },
  { name: 'Wardian', anchor: [-4, 486], real: [51.501576, -0.022431], view: [-4, 440, 180, 35], labelY: 14 },
  { name: 'South Quay Plaza', anchor: [150, 478], real: [51.500997, -0.017358], view: [150, 440, 180, 35], labelY: 14 },
  { name: 'Pan Peninsula', anchor: [406, 488], real: [51.499995, -0.017843], view: [406, 440, 180, 30], labelY: 14 },
  { name: 'One Park Drive', anchor: [640, 150], real: [51.502281, -0.015054], view: [600, 108, 135, 30], labelY: 14 },
];

// ---- best-fit similarity transform (complex least squares): T = a * w + b, w = x + i z ----
const anchors = LANDMARKS.map((l) => ({ w: l.anchor, t: toMetric(...l.real) }));
const n = anchors.length;
const wm = [0, 0], tm = [0, 0];
for (const a of anchors) { wm[0] += a.w[0] / n; wm[1] += a.w[1] / n; tm[0] += a.t[0] / n; tm[1] += a.t[1] / n; }
let num = [0, 0], den = 0;
for (const a of anchors) {
  const dw = [a.w[0] - wm[0], a.w[1] - wm[1]], dt = [a.t[0] - tm[0], a.t[1] - tm[1]];
  num[0] += dw[0] * dt[0] + dw[1] * dt[1]; num[1] += dw[0] * dt[1] - dw[1] * dt[0]; den += dw[0] * dw[0] + dw[1] * dw[1];
}
const A = [num[0] / den, num[1] / den];
const cmul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
const fit = (x, z) => { const r = cmul(A, [x - wm[0], z - wm[1]]); return [r[0] + tm[0], r[1] + tm[1]]; };
for (const a of anchors) { const f = fit(...a.w); a.r = [a.t[0] - f[0], a.t[1] - f[1]]; }
export const FIT_ROTATION_DEG = (Math.atan2(A[1], A[0]) * 180) / Math.PI;

// Exact Gaussian RBF interpolation of the residuals: every anchor maps to its true position, the field is smooth
// in between and falls back to the plain best-fit transform far from any anchor.
const SIG = 150;
const kern = (d2) => Math.exp(-d2 / (2 * SIG * SIG));
const W = (() => {
  const K = anchors.map((a) => anchors.map((b) => kern((a.w[0] - b.w[0]) ** 2 + (a.w[1] - b.w[1]) ** 2) + (a === b ? 1e-6 : 0)));
  const solve = (rhs) => { // Gaussian elimination with partial pivoting
    const M = K.map((row, i) => [...row, rhs[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((row, i) => row[n] / row[i]);
  };
  return [solve(anchors.map((a) => a.r[0])), solve(anchors.map((a) => a.r[1]))];
})();

export function localToMetric(x, z) {
  const f = fit(x, z); let cx = 0, cz = 0;
  anchors.forEach((a, i) => { const k = kern((x - a.w[0]) ** 2 + (z - a.w[1]) ** 2); cx += W[0][i] * k; cz += W[1][i] * k; });
  return [f[0] + cx, f[1] + cz];
}
export function localToLatLng(x, z) { return fromMetric(...localToMetric(x, z)); }

// local compass heading (0 = model north, i.e. -z) -> real compass heading
export function realHeading(localDeg) {
  const az = (localDeg * Math.PI) / 180; const d = cmul(A, [Math.sin(az), -Math.cos(az)]);
  return ((Math.atan2(d[0], -d[1]) * 180) / Math.PI + 360) % 360;
}

export function streetViewURL(lat, lng, heading = 0, pitch = 0) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}&heading=${Math.round(heading)}&pitch=${Math.round(Math.max(-80, Math.min(80, pitch)))}&fov=90`;
}

// Street View link for a model viewpoint
export function streetViewForLocal(x, z, localHeadingDeg, pitchDeg) {
  const [lat, lng] = localToLatLng(x, z);
  return streetViewURL(lat, lng, realHeading(localHeadingDeg), pitchDeg);
}

// Street View link for a landmark: the viewpoint is placed relative to the landmark's TRUE position
// (same offset and direction as in the model, rotated into real-world orientation), so the subject is in frame.
export function streetViewForLandmark(l) {
  const [x, z, hdg, pitch] = l.view; const t = toMetric(...l.real);
  const off = cmul(A, [x - l.anchor[0], z - l.anchor[1]]);
  const [lat, lng] = fromMetric(t[0] + off[0], t[1] + off[1]);
  return streetViewURL(lat, lng, realHeading(hdg), pitch);
}

// How far (m) each landmark sits from its real position under the global fit — used to report layout accuracy.
export function layoutErrors() {
  return anchors.map((a, i) => ({ name: LANDMARKS[i].name, offsetM: Math.round(Math.hypot(a.r[0], a.r[1])) }));
}
