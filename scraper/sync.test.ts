// Device sync's shared logic (lib/syncData.ts): codes, validating what the server stores, merging.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_RE, cleanDoc, mergeDocs, newCode, normaliseCode } from "../lib/syncData.ts";
import { randomBytes } from "node:crypto";

test("sync codes: 12 unambiguous characters, typed forgivingly", () => {
  for (let i = 0; i < 50; i++) assert.match(newCode((n) => randomBytes(n)), CODE_RE);
  assert.equal(normaliseCode("7kq2 m9xa pt4d"), "7KQ2-M9XA-PT4D");
  assert.equal(normaliseCode("7KQ2M9XAPT4D"), "7KQ2-M9XA-PT4D");
  assert.equal(normaliseCode("7KQ2-M9XA-PT4O"), "7KQ2-M9XA-PT40"); // O read as zero
  assert.equal(normaliseCode("7KQ2-M9XA-PTLI"), "7KQ2-M9XA-PT11"); // L and I read as one
  assert.equal(normaliseCode("7KQ2-M9XA"), null);
  assert.equal(normaliseCode("UUUU-UUUU-UUUU"), null);
});

test("the server only stores well-formed lists", () => {
  const ok = { updatedAt: "2026-11-06T10:00:00.000Z", follows: ["tate-modern", "tate-modern"], people: ["bill-bailey"], saved: ["~o2-academy-brixton:muse-1", "barbican:hamlet~2"] };
  assert.deepEqual(cleanDoc(ok), { v: 1, ...ok, follows: ["tate-modern"] });
  assert.equal(cleanDoc({ ...ok, follows: ["<script>"] }), null);
  assert.equal(cleanDoc({ ...ok, updatedAt: "yesterday" }), null);
  assert.equal(cleanDoc({ ...ok, saved: "tate" }), null);
  assert.deepEqual(cleanDoc({ ...ok, people: undefined })?.people, []); // older clients without people
});

test("when both devices changed, nothing followed on either is lost", () => {
  const laptop = { follows: ["tate-modern", "barbican"], people: ["bill-bailey"], saved: ["e1"] };
  const phone = { follows: ["barbican", "roundhouse"], people: [], saved: ["e2"] };
  assert.deepEqual(mergeDocs(laptop, phone, "2026-11-06T12:00:00.000Z"), {
    v: 1,
    updatedAt: "2026-11-06T12:00:00.000Z",
    follows: ["tate-modern", "barbican", "roundhouse"],
    people: ["bill-bailey"],
    saved: ["e1", "e2"],
  });
});
