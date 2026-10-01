import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStatus,
  normalizeStoredStatus,
  isValidStatus,
  ALLOWED_STATUS_TRANSITIONS
} from "../server/services/statusCore.js";

test("API status normalization rejects legacy and invalid mutation values", () => {
  assert.equal(normalizeStatus("new"), "new");
  assert.equal(normalizeStatus("pending"), "");
  assert.equal(normalizeStatus("invalid"), "");
  assert.equal(normalizeStatus(" COMPLETED "), "completed");
  assert.equal(isValidStatus("pending"), false);
});

test("stored legacy pending status remains readable as new", () => {
  assert.equal(normalizeStoredStatus("pending"), "new");
  assert.equal(normalizeStoredStatus("new"), "new");
  assert.equal(normalizeStoredStatus("invalid"), "");
});

test("status transitions remain forward-only", () => {
  assert.equal(ALLOWED_STATUS_TRANSITIONS.new.has("progress"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.new.has("completed"), false);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.transferred.has("completed"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.completed.has("progress"), false);
});
