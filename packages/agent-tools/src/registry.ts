/**
 * Tool registry - centralized management of available tools
 */

import type {
  ToolCall,
  ToolDefinition,
} from "@syntax-senpai/ai-core";
import type {
  ToolImplementation,
  ToolExecutionContext,
  ToolResult,
  ToolPermissionKey,
} from "./types";

/**
 * Central registry for tool implementations
 */
export class ToolRegistry {
  private tools = new Map<string, ToolImplementation>();

  /**
   * Register a new tool
   */
  register(tool: ToolImplementation): void {
    this.tools.set(tool.definition.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolImplementation | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ToolImplementation[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions (filtered by permissions)
   * These are sent to the AI provider
   */
  getDefinitions(permissions?: Partial<Record<ToolPermissionKey, boolean>>): ToolDefinition[] {
    return this.getAll()
      .filter((tool) => {
        if (!permissions) return true;
        // Only include tools the user has permission for
        const requiredPerm = tool.requiresPermission;
        return permissions[requiredPerm] !== false;
      })
      .map((tool) => tool.definition);
  }

  /**
   * Execute a tool call
   */
  async execute(
    toolCall: ToolCall,
    ctx: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.get(toolCall.name);

    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolCall.name}`,
      };
    }

    // Check permissions
    const requiredPerm = tool.requiresPermission;
    if (ctx.permissions[requiredPerm] === false) {
      return {
        success: false,
        error: `Permission denied: ${requiredPerm}`,
      };
    }

    try {
      return await tool.execute(toolCall.arguments, ctx);
    } catch (error) {
      return {
        success: false,
        error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Clear all tools (useful for testing)
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * Global singleton instance
 */
export const toolRegistry = new ToolRegistry();
