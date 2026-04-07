/**
 * Tool system types for the waifu agent
 */

import type { ToolCall, ToolDefinition } from "@syntax-senpai/ai-core";

export type ToolPermissionKey =
  | "fileRead"
  | "fileWrite"
  | "shellExec"
  | "networkAccess";

/**
 * Runtime context injected into every tool execution
 */
export interface ToolExecutionContext {
  platform: "mobile" | "desktop" | "remote-desktop"; // remote-desktop = phone controlling desktop
  workingDirectory?: string;
  userId: string;
  waifuId: string;
  permissions: ToolPermissions;
}

/**
 * Permission flags for tool execution
 */
export interface ToolPermissions {
  fileRead: boolean;
  fileWrite: boolean;
  shellExec: boolean;
  networkAccess: boolean;
  shellCommandAllowlist?: string[]; // optional restrictive mode
}

/**
 * Result of tool execution
 */
export type ToolResult<T = unknown> =
  | {
      success: true;
      data: T;
      displayText?: string; // optional formatted text to show user
    }
  | {
      success: false;
      error: string;
      displayText?: string;
    };

/**
 * What a tool author provides
 */
export interface ToolImplementation<TInput = unknown, TOutput = unknown> {
  definition: ToolDefinition;
  execute(input: TInput, ctx: ToolExecutionContext): Promise<ToolResult<TOutput>>;
  requiresPermission: ToolPermissionKey;
}

/**
 * Structured input for filesystem tools
 */
export namespace FilesystemTools {
  export interface ReadFileInput {
    path: string;
  }

  export interface WriteFileInput {
    path: string;
    content: string;
    createDirectories?: boolean;
  }

  export interface ListDirectoryInput {
    path: string;
    recursive?: boolean;
  }

  export interface DeleteFileInput {
    path: string;
  }

  export interface MoveFileInput {
    from: string;
    to: string;
  }

  export interface CreateDirectoryInput {
    path: string;
  }
}

/**
 * Structured input for shell tools
 */
export namespace ShellTools {
  export interface ExecuteCommandInput {
    command: string;
    args?: string[];
    cwd?: string;
    timeout?: number; // ms
  }

  export interface RunScriptInput {
    script: string;
    language: "bash" | "zsh" | "sh" | "powershell";
    cwd?: string;
    timeout?: number;
  }
}

/**
 * Structured input for search tools
 */
export namespace SearchTools {
  export interface WebSearchInput {
    query: string;
    limit?: number; // 1-10, default 5
    safeSearch?: boolean;
  }

  export interface FileSearchInput {
    pattern: string; // glob or regex
    directory?: string;
    limit?: number;
  }
}

/**
 * Structured input for code tools
 */
export namespace CodeTools {
  export interface ReadCodeFileInput {
    path: string;
    withHighlight?: boolean;
  }

  export interface ApplyPatchInput {
    filePath: string;
    patch: string; // unified diff format
  }
}

/**
 * Structured input for system tools
 */
export namespace SystemTools {
  export interface NotifyInput {
    title: string;
    message: string;
    priority?: "low" | "normal" | "high";
  }
}
