// Written by scripts/blender/rides-dress.py: where the rides' dressing goes (park coordinates; x, z: the model's
// centre; y: its foot; w, d, h: its size) and its solid parts ([x, z, w, d, h, rot] colliders). shared/map.js places them.
export const RIDES_DRESS = [
 {
  "model": "dress_station",
  "x": 49.888,
  "z": 18.575,
  "y": 0.9,
  "w": 2.095,
  "d": 12.51,
  "h": 3.68,
  "solids": [
   [
    50.65,
    13.0,
    0.25,
    1.3,
    3.48,
    0.0
   ],
   [
    50.0,
    13.75,
    1.9,
    0.12,
    2.03,
    0.0
   ],
   [
    50.0,
    20.25,
    1.9,
    0.12,
    2.03,
    0.0
   ]
  ]
 },
 {
  "model": "dress_arena",
  "x": 48.0,
  "z": 62.93,
  "y": 0.0,
  "w": 25.48,
  "d": 19.34,
  "h": 5.793,
  "solids": [
   [
    52.4,
    72.2,
    0.9,
    0.7,
    1.15,
    0.0
   ]
  ]
 },
 {
  "model": "dress_freefall",
  "x": -93.626,
  "z": 3.053,
  "y": 0.0,
  "w": 10.173,
  "d": 8.806,
  "h": 2.38,
  "solids": [
   [
    -92.4,
    5.0,
    1.3,
    0.7,
    1.35,
    0.6
   ],
   [
    -98.3,
    0.4,
    0.8,
    0.5,
    2.3,
    -2.0222
   ],
   [
    -97.5,
    -0.7,
    0.8,
    0.5,
    2.3,
    -2.3946
   ],
   [
    -89.0,
    -0.6,
    1.0,
    1.5,
    1.5,
    0.0
   ]
  ]
 }
];
