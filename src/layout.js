// World layout for Canary Wharf (approximate, simplified real geography).
// Origin = centre of One Canada Square. x = east, z = south (so north = -z), y = up. 1 unit = 1 m.
import { rectPoly, circlePoly, notchedSquare, chamferRect, roundedLoop } from './util.js';

export const WATER_Y = -2.6;
export const KERB_H = 0.13;
export const FOOTWAY_W = 3.6;

// ---------------- Water ----------------
export const THAMES_EDGE_X = -660; // land ends here; river to the west
export const FAR_BANK_X = -1060;   // Rotherhithe side
export const DOCKS = [
  { name: 'North Dock', poly: rectPoly(90, -220, 1220, 140) },     // x -520..700, z -290..-150
  { name: 'Middle Dock', poly: rectPoly(-7, 220, 676, 70) },       // x -345..331, z 185..255
  { name: 'South Dock', poly: rectPoly(90, 367, 1220, 70) },       // x -520..700, z 332..402
];

// Walkable footbridges across the docks {x0,x1,z0,z1,h}
export const BRIDGES = [
  { x0: 20, x1: 26, z0: -152, z1: -178, h: 0.35 },   // to Crossrail Place
  { x0: 170, x1: 176, z0: -152, z1: -178, h: 0.35 },
  { x0: 90, x1: 96, z0: -219, z1: -292, h: 0.35 },   // Crossrail Place to West India Quay
  { x0: -303, x1: -297, z0: -148, z1: -292, h: 0.35 },
  { x0: -213, x1: -207, z0: 183, z1: 257, h: 0.35 }, // Middle Dock
  { x0: 147, x1: 153, z0: 183, z1: 257, h: 0.35 },
  { x0: -44, x1: -37, z0: 330, z1: 404, h: 0.35 },   // South Quay footbridge
  { x0: 297, x1: 303, z0: 330, z1: 404, h: 0.35 },
];
for (const b of BRIDGES) { if (b.z0 > b.z1) { const t = b.z0; b.z0 = b.z1; b.z1 = t; } }

// ---------------- Roads ----------------
// Main estate loop (North Colonnade / Upper Bank St / Bank St / West approach), two-way, UK left-hand running.
export const R1_CORNERS = [[-330, -95], [430, -95], [430, 105], [-330, 105]];
export const R1 = roundedLoop(R1_CORNERS, 24, 12);
export const MAIN_ROAD_W = 12; // 2 x 3.5 m lanes + 1.5 m cycle lanes + margins

// Dumbbell roads: straight two-way road with a roundabout / turning circle at each end.
export const WIA = { name: 'West India Avenue', x1: -580, x2: -366, z: 0, r1: 48, r2: 10, w: 9 };   // Westferry Circus <-> Cabot turning circle
export const MARSH = { name: 'Marsh Wall', x1: -575, x2: 690, z: 430, r1: 12, r2: 12, w: 9 };

// Signalised pedestrian crossings (centre points on road centrelines)
export const CROSSINGS = [
  { road: 'R1', x: -232, z: -95 }, { road: 'R1', x: 0, z: -95 }, { road: 'R1', x: 190, z: -95 },
  { road: 'R1', x: -232, z: 105 }, { road: 'R1', x: 0, z: 105 }, { road: 'R1', x: 268, z: 105 },
  { road: 'R1', x: 430, z: 4 }, { road: 'R1', x: -330, z: 0 },
  { road: 'MARSH', x: -40, z: 430 }, { road: 'MARSH', x: 300, z: 430 }, { road: 'MARSH', x: -420, z: 430 },
];

// ---------------- Open spaces ----------------
export const PARKS = [
  { name: 'Canada Square Park', poly: chamferRect(100, 0, 118, 68, 12), trees: 26, kind: 'lawn' },
  { name: 'Jubilee Park', poly: rectPoly(270, 0, 124, 70), trees: 60, kind: 'park' },
  { name: 'Westferry Circus', poly: circlePoly(-580, 0, 40, 40), trees: 30, kind: 'park' },
];
export const PLAZAS = [
  { name: 'Cabot Square', x0: -275, x1: -185, z0: -42, z1: 42 },
  { name: 'Montgomery Square', x0: 352, x1: 418, z0: -24, z1: 32 },
  { name: 'Canada Square', x0: 30, x1: 180, z0: -46, z1: 46 },
];

// ---------------- Buildings ----------------
// style: facade texture family. lobby: recessed glazed ground floor height. crown: rooftop treatment.
// Heights are approximate real heights (m).
const B = (name, cx, cz, w, d, h, style, opts = {}) => ({ name, poly: rectPoly(cx, cz, w, d), h, style, ...opts });

export const BUILDINGS = [
  // --- Landmarks ---
  { name: 'One Canada Square', poly: notchedSquare(0, 0, 50, 4.5), h: 210, style: 'steel', lobby: 9, crown: 'pyramid', crownH: 25, landmark: true },
  { name: '8 Canada Square (HSBC)', poly: rectPoly(165, -62, 66, 44), h: 200, style: 'glassGrey', lobby: 10, crown: 'signBand', signColor: [6, 0.6, 0.5], landmark: true },
  { name: '25 Canada Square (Citi)', poly: notchedSquare(165, 66, 54, 6), h: 200, style: 'glassBlue', lobby: 10, crown: 'setback', signColor: [0.6, 1.5, 6], landmark: true },
  { name: '40 Bank Street', poly: rectPoly(-55, 143, 48, 48), h: 153, style: 'glassGrey', lobby: 8, crown: 'plant' },
  { name: '25 Bank Street', poly: rectPoly(40, 143, 56, 48), h: 153, style: 'glassBlue', lobby: 8, crown: 'plant' },
  { name: 'One Bank Street', poly: chamferRect(210, 143, 60, 46, 6), h: 131, style: 'glassGreen', lobby: 9, crown: 'setback' },
  { name: '10 Upper Bank Street', poly: rectPoly(385, 62, 60, 56), h: 151, style: 'glassBlue', lobby: 8, crown: 'plant' },
  { name: '1 Churchill Place', poly: rectPoly(500, -80, 54, 50), h: 156, style: 'glassBlue', lobby: 8, crown: 'plant' },
  { name: 'Newfoundland', poly: chamferRect(-372, 216, 30, 46, 7), h: 220, style: 'diagrid', lobby: 7, crown: 'diamond' },
  { name: 'Landmark Pinnacle', poly: chamferRect(-430, 478, 42, 42, 8), h: 233, style: 'resiWhite', lobby: 6, crown: 'slope' },
  { name: 'One Park Place', poly: rectPoly(-230, 475, 34, 30), h: 155, style: 'glassBlue', lobby: 6, crown: 'plant' },
  { name: 'Wardian West', poly: chamferRect(-30, 472, 28, 28, 4), h: 187, style: 'resiGrey', lobby: 6, crown: 'plant' },
  { name: 'Wardian East', poly: chamferRect(22, 500, 28, 28, 4), h: 175, style: 'resiGrey', lobby: 6, crown: 'plant' },
  { name: 'South Quay Plaza', poly: chamferRect(150, 478, 36, 36, 9), h: 215, style: 'resiWhite', lobby: 6, crown: 'slope' },
  { name: 'Pan Peninsula West', poly: chamferRect(380, 472, 32, 32, 6), h: 147, style: 'glassBlue', lobby: 6, crown: 'plant' },
  { name: 'Pan Peninsula East', poly: chamferRect(432, 505, 32, 32, 6), h: 122, style: 'glassBlue', lobby: 6, crown: 'plant' },
  { name: 'Landmark West', poly: rectPoly(-360, 505, 30, 30), h: 140, style: 'resiWhite', lobby: 6, crown: 'plant' },
  { name: 'One Park Drive', poly: circlePoly(640, 150, 22, 36), h: 205, style: 'resiGrey', lobby: 6, crown: 'plant' },
  { name: 'West India Quay Tower', poly: chamferRect(180, -322, 40, 34, 10), h: 111, style: 'glassBlue', lobby: 6, crown: 'plant' },

  // --- Cabot Square ring (stone, 1990s Postmodern) ---
  B('1 Cabot Square', -232, -66, 80, 34, 72, 'stone', { lobby: 7 }),
  B('20 Cabot Square', -232, 70, 80, 40, 68, 'stone', { lobby: 7 }),
  B('10 Cabot Square', -300, -51, 36, 64, 60, 'stoneWarm', { lobby: 7 }),
  B('25 Cabot Square', -300, 56, 36, 68, 60, 'stoneWarm', { lobby: 7 }),
  // Cabot Place retail podiums either side of the DLR, with a pedestrian arcade through the middle
  B('Cabot Place West N', -154, -48, 52, 68, 24, 'podium', { lobby: 6 }),
  B('Cabot Place West S', -154, 51, 52, 74, 24, 'podium', { lobby: 6 }),
  B('Cabot Place East N', -58, -48, 66, 68, 26, 'podium', { lobby: 6 }),
  B('Cabot Place East S', -58, 51, 66, 74, 26, 'podium', { lobby: 6 }),
  // --- Canada Square / Jubilee ---
  B('20 Canada Square', 75, -68, 70, 30, 72, 'glassGrey', { lobby: 7 }),
  B('Canada Place', 75, 72, 70, 34, 66, 'stoneWarm', { lobby: 7 }),
  B('Jubilee Place N', 270, -66, 130, 36, 38, 'glassGreen', { lobby: 6 }),
  B('Jubilee Place S', 270, 72, 130, 40, 42, 'stone', { lobby: 6 }),
  B('20 Bank Street', 385, -56, 60, 56, 70, 'stoneWarm', { lobby: 7 }),
  // --- North Colonnade frontage on North Dock ---
  B('North Colonnade 1', -262, -120, 100, 28, 34, 'stone', { lobby: 6 }),
  B('North Colonnade 5', -160, -120, 60, 28, 45, 'stoneWarm', { lobby: 6 }),
  B('North Colonnade 10', -40, -120, 80, 28, 52, 'glassGrey', { lobby: 6 }),
  B('North Colonnade 15', 80, -120, 70, 28, 40, 'stone', { lobby: 6 }),
  B('North Colonnade 20', 180, -120, 80, 28, 58, 'glassBlue', { lobby: 6 }),
  B('North Colonnade 25', 300, -120, 90, 28, 44, 'stone', { lobby: 6 }),
  // --- Churchill Place / east ---
  B('5 Churchill Place', 500, 0, 50, 40, 50, 'glassGrey', { lobby: 6 }),
  B('10 Churchill Place', 500, 70, 50, 50, 76, 'stoneWarm', { lobby: 6 }),
  B('Wood Wharf A', 600, 270, 40, 40, 92, 'resiGrey', { lobby: 5 }),
  B('Wood Wharf B', 700, 40, 40, 40, 110, 'glassGreen', { lobby: 5 }),
  B('Wood Wharf C', 720, 205, 30, 50, 70, 'brickModern', { lobby: 5 }),
  B('Wood Wharf D', 760, -60, 46, 46, 58, 'brickModern', { lobby: 5 }),
  // --- Bank Street (south of the estate, on Middle Dock) ---
  B('Bank Street 60', -260, 143, 70, 48, 40, 'stone', { lobby: 6 }),
  B('Bank Street 50', 122, 143, 40, 44, 60, 'stoneWarm', { lobby: 6 }),
  B('Bank Street 70', -185, 143, 60, 48, 52, 'glassGrey', { lobby: 6 }),
  B('Bank Street 80', 300, 143, 60, 44, 50, 'glassDark', { lobby: 6 }),
  B('Bank Street 90', 382, 143, 60, 44, 64, 'stone', { lobby: 6 }),
  // --- Heron Quays (between Middle Dock and South Dock) ---
  B('Heron Quays West', -262, 294, 90, 50, 32, 'glassGrey', { lobby: 5 }),
  B('Heron Quays 1', -25, 294, 60, 50, 44, 'glassBlue', { lobby: 5 }),
  B('Heron Quays 2', 62, 294, 70, 50, 48, 'stone', { lobby: 5 }),
  B('Heron Quays 3', 175, 294, 80, 50, 58, 'glassGreen', { lobby: 5 }),
  B('Heron Quays 4', 275, 294, 60, 50, 30, 'glassDark', { lobby: 5 }),
  // --- West India Quay (Georgian warehouses, north of North Dock) ---
  B('West India Quay Warehouse 1', -195, -312, 150, 32, 22, 'brick', { lobby: 0 }),
  B('West India Quay Warehouse 2', 0, -312, 140, 32, 22, 'brick', { lobby: 0 }),
  B('West India Quay Warehouse 3', 340, -314, 90, 36, 26, 'brick', { lobby: 0 }),
  B('Hertsmere House', -430, -322, 60, 40, 40, 'stone', { lobby: 5 }),
  // --- Westferry Circus surroundings ---
  B('Westferry North', -585, -112, 76, 40, 45, 'stone', { lobby: 6 }),
  B('Westferry South', -585, 112, 76, 40, 45, 'stone', { lobby: 6 }),
  B('West India Ave N', -470, -50, 40, 50, 38, 'stoneWarm', { lobby: 6 }),
  B('West India Ave S', -470, 52, 40, 50, 38, 'stoneWarm', { lobby: 6 }),
  // --- Marsh Wall mid-rises ---
  B('Marsh Wall 1', 260, 472, 40, 40, 70, 'glassGrey', { lobby: 5 }),
  B('Marsh Wall 2', 560, 470, 50, 40, 50, 'stone', { lobby: 5 }),
  B('Marsh Wall 3', -520, 470, 40, 36, 60, 'glassDark', { lobby: 5 }),
  B('Marsh Wall 4', 80, 520, 40, 30, 90, 'resiGrey', { lobby: 5 }),
  // --- Millwall / Westferry Road infill (west of Newfoundland, south of West India Avenue) ---
  B('Westferry Road 1', -560, 215, 70, 36, 28, 'brick', { lobby: 0 }),
  B('Westferry Road 2', -470, 290, 56, 40, 34, 'brickModern', { lobby: 4 }),
  B('Westferry Road 3', -600, 330, 44, 56, 46, 'resiGrey', { lobby: 4 }),
  B('Westferry Road 4', -590, 385, 70, 26, 22, 'brick', { lobby: 0 }),
  B('Westferry Road 5', -430, 175, 40, 40, 52, 'resiWhite', { lobby: 4 }),
  B('Millwall Quay', -600, 255, 36, 36, 18, 'brickModern', { lobby: 0 }),
  // --- Wood Wharf / Blackwall infill ---
  B('Wood Wharf E', 520, 210, 50, 44, 64, 'brickModern', { lobby: 5 }),
  B('Wood Wharf F', 520, 290, 60, 40, 38, 'glassGreen', { lobby: 5 }),
  B('Wood Wharf G', 780, 330, 40, 60, 48, 'resiGrey', { lobby: 5 }),
  B('Poplar Dock 1', 470, -350, 60, 40, 32, 'brick', { lobby: 0 }),
  B('Poplar Dock 2', 600, -360, 70, 36, 45, 'brickModern', { lobby: 4 }),
  B('Poplar Dock 3', 760, -300, 40, 50, 70, 'resiWhite', { lobby: 4 }),
  B('Cuba Street', 760, 470, 50, 40, 55, 'resiGrey', { lobby: 4 }),
  B('Millharbour', 320, 560, 46, 36, 40, 'brickModern', { lobby: 4 }),
  B('Millharbour 2', -180, 570, 50, 40, 32, 'brick', { lobby: 0 }),
];

// Crossrail Place (Elizabeth line station) sits in North Dock with a timber lattice roof
export const CROSSRAIL = { x0: -80, x1: 230, z0: -215, z1: -178, h: 16 };

// DLR viaduct (north-south through the estate)
export const DLR = { x: -110, z0: -1500, z1: 1500, deck: 8.0, width: 9.5,
  stations: [ { name: 'Canary Wharf', z0: -40, z1: 50 }, { name: 'Heron Quays', z0: 268, z1: 318 }, { name: 'West India Quay', z0: -350, z1: -305 }, { name: 'South Quay', z0: 470, z1: 520 } ] };

// Spawn: Heron Quays waterfront looking north across Middle Dock to the towers
export const SPAWN = { x: 96, z: 260, yaw: 0.12 };
