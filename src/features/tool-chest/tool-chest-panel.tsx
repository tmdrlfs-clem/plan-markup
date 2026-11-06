"use client";

// The Tool Chest panel (Story 7.1, FR39, UX-DR19): the user's tool sets as
// collapsible groups in their order, with instant search over set and tool
// names. Create set adds one (named in place); each set renames (double-click
// or the pencil), moves up or down, and deletes after a confirmation that
// names its tool count. Story 7.2: each tool is a tile with its preview and
// name (a device shows its label). Import .btx comes with Story 7.4.

import { useEffect, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { cx } from "@/components/ui/cx";
import { fieldControlClasses } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { toast } from "@/components/ui/toast-store";
import { MAX_TOOL_SET_NAME, deleteSetText, searchToolSets, type ToolSet } from "@/core/tools/tool-set";

import { createToolSet, deleteToolSet, listToolSets, moveToolSet, renameToolSet } from "./actions";
import { ToolPreview } from "./tool-preview";

export const EMPTY_TOOL_CHEST = "No tool sets yet";
export const IMPORT_SOON = "Importing Revu tool sets (.btx) is coming soon.";
const NEW_SET_NAME = "New tool set";

type ChestState = { status: "loading" | "ready" | "error"; sets: ToolSet[] };

/** The user's tool sets (loaded when the panel first shows). */
export const toolChestStore = createStore<ChestState>(() => ({ status: "loading", sets: [] }));

let loadSeq = 0;
let owner: string | null = null;

/** The signed-in user: another user's workspace never shows the previous user's sets. */
export function setToolChestOwner(userId: string): void {
  if (owner !== userId) {
    loadSeq++;
    toolChestStore.setState({ status: "loading", sets: [] });
  }
  owner = userId;
}

/** Loads the user's sets into the store. */
export function loadToolSets(): void {
  const seq = ++loadSeq;
  void listToolSets().then(
    (result) => {
      if (seq !== loadSeq) return;
      toolChestStore.setState(result.ok ? { status: "ready", sets: result.data } : { status: "error", sets: [] });
    },
    () => {
      if (seq === loadSeq) toolChestStore.setState({ status: "error", sets: [] });
    },
  );
}

function failed(message: string): void {
  toast({ title: message, variant: "warning" });
}

async function create(name: string): Promise<void> {
  const result = await createToolSet({ name }).catch(() => null);
  if (!result?.ok) return failed(result?.message ?? "The tool set could not be created. Try again.");
  toolChestStore.setState((s) => ({ sets: [...s.sets, result.data] }));
}

async function rename(set: ToolSet, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === set.name) return;
  const before = toolChestStore.getState().sets;
  toolChestStore.setState({ sets: before.map((s) => (s.id === set.id ? { ...s, name: trimmed } : s)) });
  const result = await renameToolSet({ id: set.id, name: trimmed }).catch(() => null);
  if (!result?.ok) {
    toolChestStore.setState({ sets: before });
    failed(result?.message ?? "The tool set could not be renamed. Try again.");
  }
}

async function move(set: ToolSet, direction: -1 | 1): Promise<void> {
  const before = toolChestStore.getState().sets;
  const at = before.findIndex((s) => s.id === set.id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= before.length) return;
  const next = [...before];
  [next[at], next[to]] = [next[to], next[at]];
  toolChestStore.setState({ sets: next });
  const result = await moveToolSet({ id: set.id, direction }).catch(() => null);
  if (!result?.ok) {
    toolChestStore.setState({ sets: before });
    failed("The tool set could not be moved. Try again.");
  }
}

async function remove(set: ToolSet): Promise<void> {
  const before = toolChestStore.getState().sets;
  toolChestStore.setState({ sets: before.filter((s) => s.id !== set.id) });
  const result = await deleteToolSet({ id: set.id }).catch(() => null);
  if (!result?.ok) {
    toolChestStore.setState({ sets: before });
    failed("The tool set could not be deleted. Try again.");
  }
}

/** A set's name being typed: Enter or leaving keeps it, Esc cancels. */
function NameField({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(initial);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone(null);
    }
  };
  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={MAX_TOOL_SET_NAME}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => onDone(draft)}
      onKeyDown={onKeyDown}
      className={cx(fieldControlClasses("workspace", false), "min-w-0 flex-1")}
    />
  );
}

function ImportButton() {
  return (
    <Button size="sm" variant="ghost" disabled title={IMPORT_SOON} aria-description={IMPORT_SOON}>
      <FileUp size={14} aria-hidden="true" />
      Import .btx
    </Button>
  );
}

export function ToolChestPanel() {
  const status = useStore(toolChestStore, (s) => s.status);
  const sets = useStore(toolChestStore, (s) => s.sets);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ToolSet | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (toolChestStore.getState().status !== "ready") loadToolSets();
  }, []);

  const shown = searchToolSets(sets, query);
  const searching = query.trim() !== "";

  const createField = creating ? (
    <div className="flex h-8 items-center px-2">
      <NameField
        initial={NEW_SET_NAME}
        label="New tool set name"
        onDone={(name) => {
          setCreating(false);
          if (name !== null && name.trim() !== "") void create(name.trim());
        }}
      />
    </div>
  ) : null;

  if (status === "loading") return <p className="p-3 text-ws-md text-muted">Loading tool sets…</p>;
  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-ws-md">
        <p>The tool sets could not be loaded.</p>
        <Button size="sm" onClick={loadToolSets}>
          Try again
        </Button>
      </div>
    );
  }
  if (sets.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-3 text-ws-md" data-testid="tool-chest-empty">
        <p>{EMPTY_TOOL_CHEST}</p>
        <div className="flex flex-wrap gap-2">
          <ImportButton />
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            Create set
          </Button>
        </div>
        {createField}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tool-chest">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <input
          type="search"
          aria-label="Search tools"
          placeholder="Search tools"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query !== "") {
              e.stopPropagation();
              setQuery("");
            }
          }}
          className={fieldControlClasses("workspace", false)}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" />
            Create set
          </Button>
          <ImportButton />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {searching && shown.length === 0 ? <p className="p-3 text-ws-md text-muted">No tools match “{query.trim()}”.</p> : null}
        {shown.map((set) => {
          const i = sets.findIndex((s) => s.id === set.id);
          if (renaming === set.id) {
            return (
              <div key={set.id} className="flex h-8 items-center border-b border-border px-2" data-testid="tool-set">
                <NameField
                  initial={set.name}
                  label="Tool set name"
                  onDone={(name) => {
                    setRenaming(null);
                    if (name !== null) void rename(set, name);
                  }}
                />
              </div>
            );
          }
          return (
            <div key={set.id} data-testid="tool-set" onDoubleClick={(e) => (e.target as HTMLElement).closest("button[aria-expanded]") && setRenaming(set.id)}>
              <Collapsible
                title={`${set.name} (${set.tools.length})`}
                open={searching || !collapsed.has(set.id)}
                onOpenChange={(open) =>
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (open) next.delete(set.id);
                    else next.add(set.id);
                    return next;
                  })
                }
                actions={
                  <>
                    <IconButton size="xs" label={`Rename ${set.name}`} icon={Pencil} onClick={() => setRenaming(set.id)} />
                    <IconButton size="xs" label={`Move ${set.name} up`} icon={ArrowUp} disabled={searching || i === 0} onClick={() => void move(set, -1)} />
                    <IconButton size="xs" label={`Move ${set.name} down`} icon={ArrowDown} disabled={searching || i === sets.length - 1} onClick={() => void move(set, 1)} />
                    <IconButton size="xs" label={`Delete ${set.name}`} icon={Trash2} onClick={() => setDeleting(set)} />
                  </>
                }
              >
                {set.tools.length === 0 ? (
                  <p className="text-ws-sm text-muted">No tools yet. Select a markup and add it to the Tool Chest.</p>
                ) : (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1" aria-label={`${set.name} tools`}>
                    {set.tools.map((tool) => (
                      <li
                        key={tool.id}
                        data-testid="tool"
                        title={tool.device ? `${tool.name} (${tool.device.group}: ${tool.device.label})` : tool.name}
                        className="flex min-w-0 flex-col items-center gap-1 rounded-[2px] p-1 hover:bg-surface-2"
                      >
                        <ToolPreview content={tool.content} imageUrl={tool.imageUrl} />
                        <span className="w-full truncate text-center text-ws-sm">{tool.name}</span>
                        {tool.device ? <span className="w-full truncate text-center text-ws-xs text-muted">{tool.device.label}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Collapsible>
            </div>
          );
        })}
        {createField}
      </div>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete tool set?"
        description={deleting ? deleteSetText(deleting) : ""}
        actionLabel={deleting && deleting.tools.length > 0 ? `Delete set and ${deleting.tools.length} ${deleting.tools.length === 1 ? "tool" : "tools"}` : "Delete set"}
        destructive
        onAction={() => {
          if (deleting) void remove(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}
