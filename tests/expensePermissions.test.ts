import assert from "node:assert/strict";
import { test } from "node:test";
import { getExpensePermissions } from "../src/lib/expensePermissions";

const CREATOR_ID = "auth-user-1";
const OTHER_ID = "auth-user-2";

test("the creator can always edit and delete their own expense", () => {
  const result = getExpensePermissions({ createdBy: CREATOR_ID }, CREATOR_ID, "member");
  assert.deepEqual(result, { canEdit: true, canDelete: true, note: null });
});

test("the creator can edit/delete even when they are also the trip owner", () => {
  const result = getExpensePermissions({ createdBy: CREATOR_ID }, CREATOR_ID, "owner");
  assert.deepEqual(result, { canEdit: true, canDelete: true, note: null });
});

test("a non-creator trip owner can delete but not edit, with an explanatory note", () => {
  const result = getExpensePermissions({ createdBy: CREATOR_ID }, OTHER_ID, "owner");
  assert.equal(result.canEdit, false);
  assert.equal(result.canDelete, true);
  assert.match(result.note ?? "", /only the person who logged it can edit/i);
});

test("a non-creator trip owner viewing a legacy (creator-less) expense gets a legacy-specific note", () => {
  const result = getExpensePermissions({ createdBy: null }, OTHER_ID, "owner");
  assert.equal(result.canEdit, false);
  assert.equal(result.canDelete, true);
  assert.match(result.note ?? "", /before creator tracking existed/i);
});

test("an ordinary member (not creator, not owner) can neither edit nor delete", () => {
  const result = getExpensePermissions({ createdBy: CREATOR_ID }, OTHER_ID, "member");
  assert.deepEqual(result, {
    canEdit: false,
    canDelete: false,
    note: "Only the person who logged this expense can edit or delete it.",
  });
});

test("an ordinary member viewing a legacy expense still gets the generic message, not the owner's legacy note", () => {
  const result = getExpensePermissions({ createdBy: null }, OTHER_ID, "member");
  assert.equal(result.canEdit, false);
  assert.equal(result.canDelete, false);
  assert.equal(result.note, "Only the person who logged this expense can edit or delete it.");
});

test("a signed-out / unlinked viewer (myUserId null) is never treated as the creator", () => {
  const result = getExpensePermissions({ createdBy: CREATOR_ID }, null, "member");
  assert.equal(result.canEdit, false);
  assert.equal(result.canDelete, false);
});

test("myUserId null with owner role can still delete (moderation), never edit", () => {
  const result = getExpensePermissions({ createdBy: CREATOR_ID }, null, "owner");
  assert.equal(result.canEdit, false);
  assert.equal(result.canDelete, true);
});

test("ownership is never inferred from anything but createdBy — a null role with a matching id is still the creator", () => {
  const result = getExpensePermissions({ createdBy: CREATOR_ID }, CREATOR_ID, null);
  assert.equal(result.canEdit, true);
  assert.equal(result.canDelete, true);
});
