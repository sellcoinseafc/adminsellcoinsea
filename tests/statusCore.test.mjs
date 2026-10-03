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
  assert.equal(normalizeStoredStatus("transferred"), "transferred");
  assert.equal(isValidStatus("pending"), false);
});

test("stored legacy pending status remains readable as new", () => {
  assert.equal(normalizeStoredStatus("pending"), "new");
  assert.equal(normalizeStoredStatus("new"), "new");
  assert.equal(normalizeStoredStatus("invalid"), "");
});

test("operational status transitions remain selectable by the admin", () => {
  assert.equal(ALLOWED_STATUS_TRANSITIONS.new.has("progress"), true);
  assert.equal(normalizeStatus("pending_transfer"), "pending_transfer");
  assert.equal(ALLOWED_STATUS_TRANSITIONS.new.has("transferred"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.new.has("completed"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.finished.has("pending_transfer"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.pending_transfer.has("transferred"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.transferred.has("completed"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.completed.has("progress"), true);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.archived.has("completed"), false);
  assert.equal(ALLOWED_STATUS_TRANSITIONS.completed.has("archived"), false);
});
