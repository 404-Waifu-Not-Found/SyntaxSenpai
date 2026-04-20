/**
 * Built-in tool implementations, ready to register with a ToolRegistry.
 */

import type { ToolRegistry } from "../registry";
import { webSearchTool } from "./web-search";
import { readFileTool, listDirectoryTool } from "./fs-read";
import { clipboardReadTool, clipboardWriteTool } from "./clipboard";
import { notifyTool } from "./notify";

export { webSearchTool, readFileTool, listDirectoryTool, clipboardReadTool, clipboardWriteTool, notifyTool };

export function builtinTools() {
  return [
    webSearchTool,
    readFileTool,
    listDirectoryTool,
    clipboardReadTool,
    clipboardWriteTool,
    notifyTool,
  ];
}

/**
 * Register every built-in tool into the given registry.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of builtinTools()) {
    registry.register(tool);
  }
}
