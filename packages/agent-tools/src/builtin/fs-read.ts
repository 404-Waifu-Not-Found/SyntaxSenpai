/**
 * Filesystem read tools: read file + list directory.
 * Node-only; throws a friendly error if `fs` is unavailable (e.g. RN).
 */

import type { ToolImplementation, FilesystemTools } from "../types";

async function loadNodeFs(): Promise<typeof import("fs/promises")> {
  try {
    // Indirection keeps bundlers from pulling `fs` into RN builds.
    return await import(/* @vite-ignore */ "fs/promises");
  } catch (err) {
    throw new Error(`Filesystem not available on this platform: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadNodePath(): Promise<typeof import("path")> {
  return import(/* @vite-ignore */ "path");
}

const MAX_BYTES = 256 * 1024; // 256 KiB cap per read

export const readFileTool: ToolImplementation<FilesystemTools.ReadFileInput, {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
}> = {
  definition: {
    name: "read_file",
    description:
      "Read a text file's contents from disk. Returns up to 256KiB; sets truncated=true if the file was larger.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or cwd-relative file path." },
      },
      required: ["path"],
    },
  },
  requiresPermission: "fileRead",
  async execute(input, ctx) {
    if (!input?.path) return { success: false, error: "path is required" };

    try {
      const fs = await loadNodeFs();
      const path = await loadNodePath();
      const resolved = path.isAbsolute(input.path)
        ? input.path
        : path.resolve(ctx.workingDirectory ?? process.cwd(), input.path);

      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        return { success: false, error: `Not a regular file: ${resolved}` };
      }

      const handle = await fs.open(resolved, "r");
      try {
        const size = Math.min(stat.size, MAX_BYTES);
        const buf = new Uint8Array(size);
        const { bytesRead } = await handle.read({ buffer: buf, offset: 0, length: size, position: 0 });
        const content = Buffer.from(buf.buffer, buf.byteOffset, bytesRead).toString("utf8");
        const truncated = stat.size > MAX_BYTES;
        return {
          success: true,
          data: { path: resolved, content, truncated, bytes: stat.size },
          displayText: truncated
            ? `Read ${bytesRead} bytes (file is ${stat.size}; truncated).`
            : `Read ${bytesRead} bytes from ${resolved}.`,
        };
      } finally {
        await handle.close();
      }
    } catch (err) {
      return { success: false, error: `Read failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const listDirectoryTool: ToolImplementation<FilesystemTools.ListDirectoryInput, {
  path: string;
  entries: Array<{ name: string; type: "file" | "directory" | "other" }>;
}> = {
  definition: {
    name: "list_directory",
    description: "List immediate entries in a directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or cwd-relative directory path." },
        recursive: { type: "boolean", default: false },
      },
      required: ["path"],
    },
  },
  requiresPermission: "fileRead",
  async execute(input, ctx) {
    if (!input?.path) return { success: false, error: "path is required" };

    try {
      const fs = await loadNodeFs();
      const path = await loadNodePath();
      const resolved = path.isAbsolute(input.path)
        ? input.path
        : path.resolve(ctx.workingDirectory ?? process.cwd(), input.path);

      const dirents = await fs.readdir(resolved, { withFileTypes: true });
      const entries = dirents.map((d) => ({
        name: d.name,
        type: d.isFile() ? ("file" as const) : d.isDirectory() ? ("directory" as const) : ("other" as const),
      }));
      return {
        success: true,
        data: { path: resolved, entries },
        displayText: entries.map((e) => `${e.type === "directory" ? "d" : "-"} ${e.name}`).join("\n"),
      };
    } catch (err) {
      return { success: false, error: `List failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
