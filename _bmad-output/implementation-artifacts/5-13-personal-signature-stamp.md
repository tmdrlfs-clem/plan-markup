# Story 5.13: Personal signature stamp

Status: done

## Story

As a fire engineer,
I want to keep my signature in my account and stamp it on drawings,
so that I can sign off markups without pasting an image each time.

## Acceptance Criteria

1. **Account & signature:** Settings → "Account & signature…" opens a dialog with the user's name and email and their saved signature ("No signature yet" when none).
2. **Make one:** draw on the SignaturePad (mouse, pen, finger; cut to its ink) or upload a PNG or JPEG (at most 5 MB; checked by its bytes, scaled to at most 1200 px a side and re-encoded as PNG, so its metadata goes); a preview shows it; Clear starts over; "Save signature" stores it.
3. **Storage:** the private `signatures` bucket at `<user_id>/<uuid>.png` (PNG only, at most 512 KB, checked again on the server) and one `signatures` row per user (D1: saving replaces it; the old image is removed). Owner-only RLS on the table and the bucket, for active users only; it is read by a signed URL of 10 minutes. pgTAP proves another user cannot read, write, replace or delete it, and anon cannot reach it.
4. **Place:** "Place on drawing" (a drawing open) arms Image with the stamp: the signature with "name · YYYY-MM-DD" drawn under it (D2); a click places it, one undo step "Add signature"; it is then an image markup like the others (move, resize, rotate, layers, Properties) carrying its signer and date; its caption is "Signature: name".
5. **Delete:** Delete removes the row and the image.
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run db:test`, `check:schema`, `check:types` pass; CI e2e on `fixtures/pdf/snap.pdf`: draw, save, read back on reopening, place ("Signature: …", "Undo Add signature"), undo, delete.

## Tasks / Subtasks

- [x] **Task 1: Database** — migration 20261105090000_signatures.sql (table, RLS, bucket, storage policies); supabase/tests/signatures_rls.test.sql (19); schema.sql and types.gen.ts regenerated.
- [x] **Task 2: Core and server** — core/signature/signature.ts (`checkSignaturePng`, `signatureCaption`, limits); features/signature/actions.ts (`saveSignature`, `getSignature`, `deleteSignature`); unit tests.
- [x] **Task 3: Client** — signature-image.ts (trim, upload re-encode, fetch, stamp), signature-pad.tsx, signature-dialog.tsx; the Settings menu item; image markups' optional `signature` meta; `pickImage` and the "Add signature" undo label.
- [x] **Task 4: Tests** — `e2e/signature.spec.ts` (AC 6).

## Dev Notes

- The stamp is composed in the browser into one PNG and placed by the Image tool, so it reuses image placement, editing and storage in the document; the signature meta records who and when.
- The image is never trusted by type: the client re-encodes, the server sniffs the PNG header and size, the bucket allows `image/png` and 512 KB only.
- A just-saved signature becomes a Blob from its base64 (CSP connect-src has no `data:`).
- Defaults chosen here, to confirm with the founder: D1 one signature per user, saving replaces it; D2 the caption "name · date" is drawn into the stamp image (not editable text; the date is the local date when placed); D3 uploads up to 5 MB, PNG or JPEG, scaled to 1200 px and stored as PNG; D4 the stamp is placed from the Settings dialog (no rail button yet); D5 the pad's ink is near-black #111111, 2.5 px.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.13], FR83
- [Source: _bmad-output/implementation-artifacts/5-8-image-and-dimension.md] (Image tool)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: table `public.signatures` (owner pk, path under the owner's folder, size 1..2000), RLS with `app.fn_is_active_user()`; private bucket (PNG, 512 KB); storage policies by the first folder. A direct delete of a storage object is blocked by `storage.protect_delete`, so the pgTAP test proves another user's update fails instead.
- Task 2: actions check the session user, validate with Zod and `checkSignaturePng`, upload then upsert (a failed upsert removes the new image), log failures without details.
- Task 3: dialog reads the saved signature each time it opens; the workspace shell test mocks the signature actions.
- Tests: unit 1908 pass; db:test 90 pass; local e2e passes (dev server); CI runs 41919809870 (e2e) and 41919810155 (db) green.

### File List

- supabase/migrations/20261105090000_signatures.sql (new), supabase/tests/signatures_rls.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- src/core/signature/signature.ts (new), signature.test.ts (new), src/core/schema/markup.ts
- src/features/signature/actions.ts (new), actions.test.ts (new), signature-image.ts (new), signature-pad.tsx (new), signature-dialog.tsx (new)
- src/features/editor/image-tool.ts, measure-tool.ts, index.ts
- src/features/workspace/workspace-menu-bar.tsx, workspace-shell.tsx, workspace-shell.test.tsx
- e2e/signature.spec.ts (new)
