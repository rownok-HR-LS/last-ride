// Written by scripts/blender/themed.py: where the themed buildings' painted fronts and inside dressing go, in each
// building's own coordinates (x, z: the model's centre; y: its foot; w, d, h: its size), and the parts of it
// that are solid ([x, z, w, d, h, rot] colliders, also building coordinates). shared/map.js places them.
export const THEMED = [
 {
  "model": "front_tunnel",
  "style": "tunnel",
  "x": 0.0,
  "z": 7.51,
  "y": -0.01,
  "w": 25.26,
  "d": 0.56,
  "h": 7.168,
  "solids": []
 },
 {
  "model": "front_funhouse",
  "style": "funhouse",
  "x": 0.0,
  "z": 8.255,
  "y": 0.82,
  "w": 23.56,
  "d": 0.501,
  "h": 13.08,
  "solids": []
 },
 {
  "model": "front_arcade",
  "style": "arcade",
  "x": 0.05,
  "z": 8.04,
  "y": 0.72,
  "w": 17.96,
  "d": 1.68,
  "h": 5.197,
  "solids": []
 },
 {
  "model": "inside_tunnel",
  "style": "tunnel",
  "x": 0.0,
  "z": -0.007,
  "y": 0.0,
  "w": 25.626,
  "d": 13.615,
  "h": 7.9,
  "solids": [
   [
    -11.2,
    4.2,
    0.62,
    0.16,
    0.96,
    1.7708
   ],
   [
    -10.6,
    2.0,
    0.62,
    0.16,
    0.96,
    1.4208
   ],
   [
    -11.7,
    -0.6,
    0.62,
    0.16,
    0.96,
    1.9208
   ],
   [
    -10.4,
    -5.0,
    0.62,
    0.16,
    0.96,
    1.2708
   ],
   [
    11.0,
    -3.6,
    0.62,
    0.16,
    0.96,
    1.6708
   ]
  ]
 },
 {
  "model": "inside_funhouse",
  "style": "funhouse",
  "x": 0.0,
  "z": 0.158,
  "y": 0.0,
  "w": 23.6,
  "d": 15.284,
  "h": 7.485,
  "solids": [
   [
    -9.6,
    -5.3,
    1.15,
    1.15,
    1.15,
    0.3
   ],
   [
    -8.1,
    -6.2,
    0.95,
    0.95,
    0.95,
    0.85
   ],
   [
    2.4,
    5.2,
    1.05,
    1.05,
    1.05,
    -0.4
   ]
  ]
 },
 {
  "model": "inside_arcade",
  "style": "arcade",
  "x": 0.0,
  "z": 0.0,
  "y": 0.0,
  "w": 19.6,
  "d": 13.6,
  "h": 4.43,
  "solids": []
 }
];
