/**
 * Clipboard read/write. Uses Electron's clipboard when available,
 * otherwise falls back to platform pbcopy/xclip shell-outs. On mobile
 * or restricted contexts this tool returns a friendly error.
 */

import type { ToolImplementation } from "../types";

export interface ClipboardReadInput {
  _placeholder?: never;
}

export interface ClipboardWriteInput {
  text: string;
}

async function tryElectronClipboard(): Promise<null | {
  readText: () => string;
  writeText: (s: string) => void;
}> {
  try {
    const mod = (await import(/* @vite-ignore */ "electron")) as {
      clipboard?: { readText: () => string; writeText: (s: string) => void };
    };
    return mod.clipboard ?? null;
  } catch {
    return null;
  }
}

async function shellWrite(text: string): Promise<void> {
  const { spawn } = await import(/* @vite-ignore */ "child_process");
  const cmd = process.platform === "darwin" ? "pbcopy" : "xclip";
  const args = process.platform === "darwin" ? [] : ["-selection", "clipboard"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.stdin?.end(text);
  });
}

async function shellRead(): Promise<string> {
  const { spawn } = await import(/* @vite-ignore */ "child_process");
  const cmd = process.platform === "darwin" ? "pbpaste" : "xclip";
  const args = process.platform === "darwin" ? [] : ["-selection", "clipboard", "-o"];
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (chunk) => (out += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))));
  });
}

export const clipboardReadTool: ToolImplementation<ClipboardReadInput, { text: string }> = {
  definition: {
    name: "clipboard_read",
    description: "Read the current OS clipboard contents as text.",
    parameters: { type: "object", properties: {} },
  },
  requiresPermission: "networkAccess",
  async execute() {
    try {
      const electron = await tryElectronClipboard();
      const text = electron ? electron.readText() : await shellRead();
      return { success: true, data: { text }, displayText: text || "(clipboard empty)" };
    } catch (err) {
      return { success: false, error: `Clipboard read failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const clipboardWriteTool: ToolImplementation<ClipboardWriteInput, { text: string }> = {
  definition: {
    name: "clipboard_write",
    description: "Copy text to the OS clipboard.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "Text to copy." } },
      required: ["text"],
    },
  },
  requiresPermission: "networkAccess",
  async execute(input) {
    if (typeof input?.text !== "string") return { success: false, error: "text is required" };
    try {
      const electron = await tryElectronClipboard();
      if (electron) electron.writeText(input.text);
      else await shellWrite(input.text);
      return { success: true, data: { text: input.text }, displayText: `Copied ${input.text.length} chars.` };
    } catch (err) {
      return { success: false, error: `Clipboard write failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
