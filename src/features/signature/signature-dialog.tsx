"use client";

// Settings → Account & signature (Story 5.13, FR83): the signed-in user's
// name and email, and their signature: drawn on the SignaturePad or made from
// an uploaded image (checked, scaled down, re-encoded), previewed, then saved
// to their private storage. "Place on drawing" arms Image with the stamp (the
// signature with their name and today's date); a click places it, and it is
// then a markup like the others.

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { pickImage } from "@/features/editor";
import { ProfileSection } from "@/features/account/profile-section";
import type { EffectivePlan } from "@/lib/plans";
import { hasDocument, viewerStore } from "@/features/viewer";

import { deleteSignature, getSignature, saveSignature } from "./actions";
import { fetchSignature, stampImage, trimmedPad, uploadedSignature, type SignaturePng } from "./signature-image";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";

/** Whether the dialog is open (Settings opens it). */
export const signatureDialog = createStore<{ open: boolean }>(() => ({ open: false }));
export const openSignatureDialog = () => signatureDialog.setState({ open: true });

export const PLACE_HINT = "Click where the signature goes; then drag its handles to resize it.";

type Saved = { preview: string; blob: Blob; width: number; height: number };

export function SignatureDialog({ name, email, plan }: { name: string; email: string; plan?: EffectivePlan }) {
  const open = useStore(signatureDialog, (s) => s.open);
  const drawing = useStore(viewerStore, hasDocument);
  const pad = useRef<SignaturePadHandle>(null);
  const file = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  // Loading until the saved signature is read (again after each close).
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SignaturePng | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The saved signature, read again each time the dialog opens (its signed URL lives 10 minutes).
  useEffect(() => {
    if (!open) return;
    let live = true;
    let url: string | null = null;
    void (async () => {
      const result = await getSignature();
      if (!live) return;
      if (!result.ok) setError(result.message);
      else if (result.data) {
        const blob = await fetchSignature(result.data.url);
        if (!live) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setSaved({ preview: url, blob, width: result.data.width, height: result.data.height });
        } else setError("Your saved signature could not be loaded.");
      } else setSaved(null);
      setLoading(false);
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open]);

  const close = () => {
    signatureDialog.setState({ open: false });
    setDraft(null);
    setError(null);
    setSaved(null);
    setLoading(true);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const result = await saveSignature({ png: draft.base64 });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    // From the base64 itself: CSP connect-src does not allow fetching data: URLs.
    const blob = new Blob([Uint8Array.from(atob(draft.base64), (ch) => ch.charCodeAt(0))], { type: "image/png" });
    setSaved({ preview: draft.dataUrl, blob, width: draft.width, height: draft.height });
    setDraft(null);
    pad.current?.clear();
  };

  const remove = async () => {
    setBusy(true);
    const result = await deleteSignature();
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSaved(null);
  };

  const place = async () => {
    if (!saved) return;
    const stamp = await stampImage(saved.blob, name);
    if (pickImage(stamp)) close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Account & signature"
      description={`${name.trim() || email} · ${email}`}
      size="md"
      footer={
        <DialogFooter
          secondary={
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
          }
          primary={
            <Button variant="primary" disabled={!draft || busy} onClick={() => void save()}>
              Save signature
            </Button>
          }
        />
      }
    >
      <div className="flex flex-col gap-3 text-ws-md">
        {/* Story 10.3: name and email. */}
        <ProfileSection name={name} email={email} plan={plan} />
        <section aria-label="Saved signature" className="flex flex-col gap-2">
          <h3 className="text-ws-sm text-muted">Saved signature</h3>
          {loading ? (
            <p className="text-ws-sm text-muted">Loading…</p>
          ) : saved ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the user's own image */}
              <img src={saved.preview} alt="Your saved signature" className="h-16 max-w-[240px] rounded-sm border border-border bg-white object-contain" />
              <Button size="sm" variant="primary" disabled={!drawing || busy} title={drawing ? PLACE_HINT : "Open a drawing first"} onClick={() => void place()}>
                Place on drawing
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
                Delete
              </Button>
            </div>
          ) : (
            <p className="text-ws-sm text-muted">No signature yet. Draw one below or upload an image.</p>
          )}
        </section>
        <section aria-label="New signature" className="flex flex-col gap-2">
          <h3 className="text-ws-sm text-muted">New signature</h3>
          <SignaturePad
            ref={pad}
            label="Signature pad: draw your signature"
            onInk={(canvas) => {
              setError(null);
              setDraft(trimmedPad(canvas));
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                pad.current?.clear();
                setDraft(null);
              }}
            >
              Clear
            </Button>
            <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>
              Upload image…
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Signature image file"
              data-testid="signature-file-input"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                void uploadedSignature(f).then((png) => {
                  if (typeof png === "string") return setError(png);
                  pad.current?.clear();
                  setError(null);
                  setDraft(png);
                });
              }}
            />
          </div>
          {draft ? (
            <div className="flex items-center gap-2">
              <span className="text-ws-sm text-muted">Preview</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made here */}
              <img src={draft.dataUrl} alt="New signature preview" className="h-16 max-w-[240px] rounded-sm border border-border bg-white object-contain" />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-ws-sm text-danger">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
