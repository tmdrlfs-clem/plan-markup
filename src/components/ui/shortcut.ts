// Shortcut strings are written in the UX table form: "Ctrl+Shift+M", "Shift+Alt+L", "V", "Del".
// Several shortcuts for one command are separated by a space.

const ARIA_KEY_NAMES: Record<string, string> = {
  ctrl: "Control",
  control: "Control",
  del: "Delete",
  delete: "Delete",
  esc: "Escape",
  escape: "Escape",
  "+": "Plus",
  "-": "Minus",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
};

const MAC_SYMBOLS: Record<string, string> = {
  ctrl: "⌘",
  control: "⌘",
  cmd: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
};

/** Splits "Ctrl+Shift+M" or "Ctrl++" into its key tokens. */
function splitKeys(shortcut: string): string[] {
  if (shortcut.length > 1 && shortcut.endsWith("+")) {
    const head = shortcut.slice(0, -1);
    const rest = head.endsWith("+") ? head.slice(0, -1) : head;
    return [...(rest ? rest.split("+") : []), "+"];
  }
  return shortcut.split("+");
}

function splitShortcuts(shortcuts: string): string[] {
  return shortcuts.trim().split(/\s+/).filter(Boolean);
}

/** True on Apple platforms. Safe during SSR (returns false without `navigator`). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad/i.test(platform);
}

/** Display string: "Ctrl+Shift+M" everywhere, "⌘⇧M" on macOS. */
export function formatShortcut(shortcuts: string, mac: boolean = isMacPlatform()): string {
  return splitShortcuts(shortcuts)
    .map((shortcut) => {
      const keys = splitKeys(shortcut);
      if (!mac) return keys.join("+");
      return keys.map((k) => MAC_SYMBOLS[k.toLowerCase()] ?? k).join("");
    })
    .join(" ");
}

/**
 * Value for `aria-keyshortcuts`: "Ctrl+Shift+M" -> "Control+Shift+M", or "Meta+Shift+M"
 * on macOS, where Ctrl is shown (and pressed) as Command.
 */
export function toAriaKeyShortcuts(shortcuts: string, mac: boolean = isMacPlatform()): string {
  return splitShortcuts(shortcuts)
    .map((shortcut) =>
      splitKeys(shortcut)
        .map((k) => {
          const lower = k.toLowerCase();
          if (mac && (lower === "ctrl" || lower === "control" || lower === "cmd")) return "Meta";
          return ARIA_KEY_NAMES[lower] ?? (k.length === 1 ? k.toUpperCase() : k);
        })
        .join("+"),
    )
    .join(" ");
}
