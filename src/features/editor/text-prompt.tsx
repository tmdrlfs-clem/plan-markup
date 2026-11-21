"use client";

// A one-field prompt for the text a markup carries (Replace text's replacement,
// Insert text's inserted text; founder 2026-11-21). `askText` opens it; Add
// hands the text to the callback, Cancel or Esc drops it.

import { useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { MAX_TEXT_LENGTH } from "@/core/schema/markup";
import { viewerCommands } from "@/features/viewer";

type Prompt = { title: string; label: string; description?: string; onSubmit: (text: string) => void };
export const textPromptStore = createStore<{ prompt: Prompt | null; seq: number }>(() => ({ prompt: null, seq: 0 }));

/** Opens the prompt; `onSubmit` gets the text (never empty) when it is added. */
export function askText(prompt: Prompt): void {
  textPromptStore.setState((s) => ({ prompt, seq: s.seq + 1 }));
}

function close(): void {
  textPromptStore.setState({ prompt: null });
  viewerCommands.focusCanvas();
}

/** Mounted once in the workspace. */
export function TextPrompt() {
  const prompt = useStore(textPromptStore, (s) => s.prompt);
  const seq = useStore(textPromptStore, (s) => s.seq);
  if (!prompt) return null;
  return <PromptDialog key={seq} prompt={prompt} />;
}

function PromptDialog({ prompt }: { prompt: Prompt }) {
  const [text, setText] = useState("");
  const add = () => {
    if (text.trim() === "") return;
    close();
    prompt.onSubmit(text);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : close())}
      title={prompt.title}
      description={prompt.description}
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          }
          primary={
            <DialogPrimary disabled={text.trim() === ""} onClick={add}>
              Add
            </DialogPrimary>
          }
        />
      }
    >
      <TextField label={prompt.label} value={text} maxLength={MAX_TEXT_LENGTH} autoFocus onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
}
