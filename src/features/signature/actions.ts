"use server";

import { z } from "zod";

import { uuidv7 } from "@/core/ids/uuid";
import { SIGNATURE_MAX_BYTES, SIGNED_URL_SECONDS, checkSignaturePng } from "@/core/signature/signature";
import { getAuthUser } from "@/lib/auth";
import { fail, internalError, type Result } from "@/lib/result";
import { createServerSupabase } from "@/lib/supabase/server";

// Story 5.13 (FR83, AR19): the signed-in user's signature. The user comes
// from the session (never from the input); every read and write goes through
// RLS with the user's own client: the row in public.signatures and the object
// in the private `signatures` bucket under `<user_id>/`. The image is served
// by a signed URL that lives 10 minutes.

const BUCKET = "signatures";

/** Base64 of at most SIGNATURE_MAX_BYTES bytes. */
const PngInput = z.object({ png: z.string().max(Math.ceil(SIGNATURE_MAX_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/) });

export type SignatureInfo = { url: string; width: number; height: number };

/** Stores `{ png }` (base64) as the user's signature, replacing the one they had. */
export async function saveSignature(input: unknown): Promise<Result<{ width: number; height: number }>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  const parsed = PngInput.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "The signature must be a PNG image of at most 512 KB.");
  const bytes = new Uint8Array(Buffer.from(parsed.data.png, "base64"));
  const checked = checkSignaturePng(bytes);
  if (!checked.ok) return fail("INVALID_INPUT", checked.reason);
  try {
    const supabase = await createServerSupabase();
    const { data: old, error: readError } = await supabase.from("signatures").select("storage_path").eq("user_id", user.id).maybeSingle();
    if (readError) return internalError("signature.read_failed", new Error(`signatures select failed: ${readError.code ?? "unknown"}`));
    // A new name each time: a signed URL of the old image never shows the new one.
    const path = `${user.id}/${uuidv7()}.png`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: false });
    if (uploadError) return internalError("signature.upload_failed", new Error("signature upload failed"));
    const { error: rowError } = await supabase
      .from("signatures")
      .upsert({ user_id: user.id, storage_path: path, width: checked.width, height: checked.height, updated_at: new Date().toISOString() });
    if (rowError) {
      await supabase.storage.from(BUCKET).remove([path]);
      return internalError("signature.save_failed", new Error(`signatures upsert failed: ${rowError.code ?? "unknown"}`));
    }
    if (old?.storage_path && old.storage_path !== path) await supabase.storage.from(BUCKET).remove([old.storage_path]);
    return { ok: true, data: { width: checked.width, height: checked.height } };
  } catch (error) {
    return internalError("signature.save_failed", error);
  }
}

/** The user's signature: a signed URL (10 minutes) and its size; null when they have none. */
export async function getSignature(): Promise<Result<SignatureInfo | null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("signatures").select("storage_path, width, height").eq("user_id", user.id).maybeSingle();
    if (error) return internalError("signature.read_failed", new Error(`signatures select failed: ${error.code ?? "unknown"}`));
    if (!data) return { ok: true, data: null };
    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(data.storage_path, SIGNED_URL_SECONDS);
    if (signError || !signed) return internalError("signature.sign_failed", new Error("signed url failed"));
    return { ok: true, data: { url: signed.signedUrl, width: data.width, height: data.height } };
  } catch (error) {
    return internalError("signature.read_failed", error);
  }
}

/** Deletes the user's signature (its row and its image). */
export async function deleteSignature(): Promise<Result<null>> {
  const user = await getAuthUser();
  if (!user) return fail("UNAUTHENTICATED");
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("signatures").delete().eq("user_id", user.id).select("storage_path");
    if (error) return internalError("signature.delete_failed", new Error(`signatures delete failed: ${error.code ?? "unknown"}`));
    const paths = (data ?? []).map((r) => r.storage_path);
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
    return { ok: true, data: null };
  } catch (error) {
    return internalError("signature.delete_failed", error);
  }
}
