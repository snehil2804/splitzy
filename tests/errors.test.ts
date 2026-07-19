import assert from "node:assert/strict";
import { test } from "node:test";
import { isNetworkError, isPermissionError } from "../src/lib/errors";

test("permission-denied errors are classified as authorization failures", () => {
  assert.ok(isPermissionError("permission denied for table members"));
  assert.ok(isPermissionError("new row violates row-level security policy"));
  assert.ok(!isPermissionError("Failed to fetch"));
  assert.ok(!isPermissionError("The selected trip does not exist or is not active."));
});

test("network failures are classified as network, not authorization", () => {
  assert.ok(isNetworkError("Failed to fetch"));
  assert.ok(isNetworkError("NetworkError when attempting to fetch resource."));
  assert.ok(isNetworkError("Load failed"));
  assert.ok(!isNetworkError("permission denied for table members"));
});

test("the two classifications never overlap", () => {
  const samples = [
    "permission denied for table members",
    "Failed to fetch",
    "row-level security violation",
    "Load failed",
  ];
  for (const s of samples) {
    assert.ok(!(isPermissionError(s) && isNetworkError(s)), s);
  }
});
