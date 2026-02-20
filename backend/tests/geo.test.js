import test from 'node:test';
import assert from 'node:assert/strict';
import { gridKey, haversineDistanceMeters, pointInPolygon } from '../src/geo.js';

test('haversineDistanceMeters returns ~0 for identical points', () => {
  assert.ok(haversineDistanceMeters(56.8, 59.9, 56.8, 59.9) < 0.001);
});

test('haversineDistanceMeters returns expected distance for 1 degree lat', () => {
  const dist = haversineDistanceMeters(0, 0, 1, 0);
  assert.ok(dist > 110000 && dist < 112500);
});

test('pointInPolygon detects inside/outside', () => {
  const polygon = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ];
  assert.equal(pointInPolygon([0.5, 0.5], polygon), true);
  assert.equal(pointInPolygon([2, 2], polygon), false);
});

test('gridKey deterministic for same point', () => {
  const a = gridKey(56.8, 59.9, 30);
  const b = gridKey(56.8, 59.9, 30);
  assert.equal(a, b);
});
