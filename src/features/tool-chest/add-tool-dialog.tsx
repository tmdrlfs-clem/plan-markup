"use client";

// Story 7.2 (FR40): "Add to Tool Chest…" — the selected markups become a tool
// in a set the user picks (or a new one), optionally typed as a device (group,
// label, description) for Story 7.3's counts. The tool keeps the markups'
// geometry and style; an image goes to the private `tool-assets` bucket.

import { useEffect, useId, useMemo, useState } from "react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { FieldShell, fieldControlClasses } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast-store";
import { deviceSchema, imageUpload, suggestedToolName, toolContentOf, toolNameSchema, type Device } from "@/core/tools/tool";
import { ownToolSets, toolSetNameSchema } from "@/core/tools/tool-set";

import { addTool } from "./actions";
import { addToolStore, closeAddTool, type AddToolRequest } from "./add-tool-store";
import { loadToolSets, toolChestStore } from "./tool-chest-panel";
import { ToolPreview } from "./tool-preview";

/** The Set choice for a new set. */
export const NEW_SET = "new";
export const DEFAULT_SET_NAME = "My tools";
export const ONE_IMAGE = "A tool can hold one image. Select one image at most.";

type Errors = Partial<Record<"name" | "setName" | "group" | "label" | "description", string>>;

function TextInput({ label, value, onChange, error, maxLength }: { label: string; value: string; onChange: (v: string) => void; error?: string; maxLength: number }) {
  const id = useId();
  return (
    <FieldShell layout="workspace" label={label} htmlFor={id} error={error} errorId={`${id}-error`}>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
        className={fieldControlClasses("workspace", Boolean(error))}
      />
    </FieldShell>
  );
}

function issue(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.success ? undefined : (result.error?.issues[0]?.message ?? "Check this value.");
}

export function AddToolDialog() {
  const request = useStore(addToolStore, (s) => s.request);
  // A new form for each request.
  return request ? <AddToolForm key={requestKey(request)} request={request} /> : null;
}

const keys = new WeakMap<AddToolRequest, number>();
let nextKey = 0;
function requestKey(r: AddToolRequest): number {
  let k = keys.get(r);
  if (k === undefined) keys.set(r, (k = ++nextKey));
  return k;
}

function AddToolForm({ request }: { request: AddToolRequest }) {
  const status = useStore(toolChestStore, (s) => s.status);
  const allSets = useStore(toolChestStore, (s) => s.sets);
  // Story 10.11: a tool goes into one of the user's own sets, never into a company set of someone else.
  const sets = useMemo(() => ownToolSets(allSets), [allSets]);
  const made = useMemo(() => toolContentOf(request.markups, { calibration: request.calibration, userUnit: request.userUnit }), [request]);
  const [name, setName] = useState(() => suggestedToolName(request.markups));
  const [setChoice, setSetChoice] = useState<string | null>(null);
  const [setName_, setSetName] = useState(DEFAULT_SET_NAME);
  const [isDevice, setIsDevice] = useState(false);
  const [device, setDevice] = useState<Device>({ group: "", label: "", description: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (toolChestStore.getState().status !== "ready") loadToolSets();
  }, []);

  // The first set until the user picks; a new set when there is none.
  const choice = setChoice ?? sets[0]?.id ?? NEW_SET;
  const options = [...sets.map((s) => ({ value: s.id, label: s.name })), { value: NEW_SET, label: "New tool set…" }];

  async function submit(): Promise<void> {
    if (!made || busy) return;
    const next: Errors = {
      name: issue(toolNameSchema.safeParse(name)),
      setName: choice === NEW_SET ? issue(toolSetNameSchema.safeParse(setName_)) : undefined,
    };
    let typed: Device | null = null;
    if (isDevice) {
      const parsed = deviceSchema.safeParse(device);
      if (parsed.success) typed = parsed.data;
      else for (const i of parsed.error.issues) next[i.path[0] as "group" | "label" | "description"] ??= i.message;
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const image = made.image ? imageUpload(made.image) : null;
    if (made.image && !image) {
      toast({ title: "The image cannot be saved in a tool.", variant: "warning" });
      return;
    }
    setBusy(true);
    const result = await addTool({
      set: choice === NEW_SET ? { name: setName_.trim() } : { id: choice },
      name: name.trim(),
      content: made.content,
      device: typed,
      image,
    }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      toast({ title: result?.message ?? "The tool could not be added. Try again.", variant: "warning" });
      return;
    }
    const { set, setId, tool } = result.data;
    toolChestStore.setState((s) => {
      const withSet = set && !s.sets.some((x) => x.id === set.id) ? [...s.sets, set] : s.sets;
      return { sets: withSet.map((x) => (x.id === setId ? { ...x, tools: [...x.tools.filter((t) => t.id !== tool.id), tool] } : x)) };
    });
    const setLabel = set?.name ?? sets.find((s) => s.id === setId)?.name ?? "the Tool Chest";
    toast({ title: `Added “${tool.name}” to ${setLabel}.`, variant: "success" });
    closeAddTool();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : closeAddTool())}
      title="Add to Tool Chest"
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <Button variant="ghost" onClick={closeAddTool}>
              Cancel
            </Button>
          }
          primary={
            <DialogPrimary disabled={!made || busy || status === "loading"} onClick={() => void submit()}>
              {busy ? "Adding…" : "Add tool"}
            </DialogPrimary>
          }
        />
      }
    >
      <div className="flex flex-col gap-3">
        {made ? (
          <div className="flex items-center gap-3">
            <ToolPreview content={made.content} imageUrl={null} imageData={made.image} size={64} />
            <p className="text-ws-sm text-muted">
              {made.content.markups.length === 1 ? "1 markup" : `${made.content.markups.length} markups`}
              {made.content.calibration ? " · measured at the page's scale" : ""}
            </p>
          </div>
        ) : (
          <p role="alert" className="text-ws-md text-danger">
            {ONE_IMAGE}
          </p>
        )}
        <TextInput label="Name" value={name} onChange={setName} error={errors.name} maxLength={100} />
        {status === "error" ? (
          <p className="text-ws-sm text-muted">Your tool sets could not be loaded; the tool goes into a new set.</p>
        ) : (
          <Select label="Tool set" value={choice} onValueChange={setSetChoice} options={options} disabled={status === "loading"} />
        )}
        {choice === NEW_SET ? <TextInput label="New set name" value={setName_} onChange={setSetName} error={errors.setName} maxLength={100} /> : null}
        <Checkbox label="Count as a device" checked={isDevice} onCheckedChange={(v) => setIsDevice(v === true)} />
        {isDevice ? (
          <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
            <TextInput label="Group" value={device.group} onChange={(group) => setDevice((d) => ({ ...d, group }))} error={errors.group} maxLength={60} />
            <TextInput label="Label" value={device.label} onChange={(label) => setDevice((d) => ({ ...d, label }))} error={errors.label} maxLength={60} />
            <TextInput label="Description" value={device.description} onChange={(description) => setDevice((d) => ({ ...d, description }))} error={errors.description} maxLength={500} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
