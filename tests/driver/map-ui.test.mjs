import test from "node:test";
import assert from "node:assert/strict";
import { driverTypeMeta, formatDriverDistance } from "../../driver/map/index.js";

test("driverTypeMeta returns stable labels for known and unknown driver types", () => {
  assert.equal(driverTypeMeta("TAXI").short, "TAXI");
  assert.equal(driverTypeMeta("TIR").short, "TIR");
  assert.equal(driverTypeMeta("DELIVERY").short, "DEL");
  assert.equal(driverTypeMeta("GENERAL").short, "DRV");
  assert.equal(driverTypeMeta("UNKNOWN").short, "DRV");
});

test("formatDriverDistance produces compact map labels", () => {
  assert.equal(formatDriverDistance(0.126), "130 м");
  assert.equal(formatDriverDistance(0.994), "990 м");
  assert.equal(formatDriverDistance(1.234), "1.2 км");
  assert.equal(formatDriverDistance(9.94), "9.9 км");
  assert.equal(formatDriverDistance(12.7), "13 км");
  assert.equal(formatDriverDistance(Number.NaN), "");
});
