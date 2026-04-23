import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../registry";
import type { ToolImplementation, ToolExecutionContext } from "../types";

function makeTool(name: string, opts: Partial<ToolImplementation> = {}): ToolImplementation {
  return {
    definition: {
      name,
      description: `test tool ${name}`,
      inputSchema: { type: "object", properties: {} },
    } as any,
    requiresPermission: "fileRead",
    execute: async () => ({ success: true, data: name }),
    ...opts,
  };
}

const ctx: ToolExecutionContext = {
  platform: "desktop",
  userId: "u1",
  waifuId: "aria",
  permissions: {
    fileRead: true,
    fileWrite: true,
    shellExec: true,
    networkAccess: true,
  },
};

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("echo"));
    expect(reg.get("echo")?.definition.name).toBe("echo");
    expect(reg.getAll()).toHaveLength(1);
  });

  it("filters definitions by permission", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("read_file", { requiresPermission: "fileRead" }));
    reg.register(makeTool("write_file", { requiresPermission: "fileWrite" }));

    const defs = reg.getDefinitions({ fileRead: true, fileWrite: false });
    expect(defs.map((d) => d.name)).toEqual(["read_file"]);
  });

  it("returns not-found error for unknown tool", async () => {
    const reg = new ToolRegistry();
    const res = await reg.execute(
      { name: "ghost", arguments: {}, id: "t1" } as any,
      ctx
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/not found/i);
  });

  it("denies when permission is explicitly false", async () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("read_file", { requiresPermission: "fileRead" }));
    const denied = await reg.execute(
      { name: "read_file", arguments: {}, id: "t1" } as any,
      { ...ctx, permissions: { ...ctx.permissions, fileRead: false } }
    );
    expect(denied.success).toBe(false);
    if (!denied.success) expect(denied.error).toMatch(/permission/i);
  });

  it("wraps thrown errors with success: false", async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeTool("boom", {
        execute: async () => {
          throw new Error("kaboom");
        },
      })
    );
    const res = await reg.execute(
      { name: "boom", arguments: {}, id: "t1" } as any,
      ctx
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/kaboom/);
  });

  it("clear() empties the registry", () => {
    const reg = new ToolRegistry();
    reg.register(makeTool("a"));
    reg.clear();
    expect(reg.getAll()).toHaveLength(0);
  });
});
