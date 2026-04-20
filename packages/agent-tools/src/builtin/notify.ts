/**
 * OS notification tool. Tries Electron's Notification, then
 * falls back to `osascript` (macOS) / `notify-send` (Linux).
 */

import type { ToolImplementation, SystemTools } from "../types";

async function electronNotify(title: string, message: string): Promise<boolean> {
  try {
    const mod = (await import(/* @vite-ignore */ "electron")) as {
      Notification?: new (opts: { title: string; body: string }) => { show: () => void };
    };
    if (!mod.Notification) return false;
    const n = new mod.Notification({ title, body: message });
    n.show();
    return true;
  } catch {
    return false;
  }
}

async function shellNotify(title: string, message: string): Promise<void> {
  const { spawn } = await import(/* @vite-ignore */ "child_process");
  if (process.platform === "darwin") {
    const script = `display notification "${escape(message)}" with title "${escape(title)}"`;
    await run(spawn, "osascript", ["-e", script]);
  } else if (process.platform === "linux") {
    await run(spawn, "notify-send", [title, message]);
  } else {
    throw new Error(`Notifications not supported on ${process.platform}`);
  }
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function run(spawn: typeof import("child_process").spawn, cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

export const notifyTool: ToolImplementation<SystemTools.NotifyInput, { sent: true }> = {
  definition: {
    name: "notify",
    description: "Show an OS notification to the user.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        message: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high"] },
      },
      required: ["title", "message"],
    },
  },
  requiresPermission: "networkAccess",
  async execute(input) {
    if (!input?.title || !input?.message) {
      return { success: false, error: "title and message are required" };
    }
    try {
      if (!(await electronNotify(input.title, input.message))) {
        await shellNotify(input.title, input.message);
      }
      return { success: true, data: { sent: true }, displayText: `Notified: ${input.title}` };
    } catch (err) {
      return { success: false, error: `Notify failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
