import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { loadToolPlugins } from "../plugins";
import { ToolRegistry } from "../registry";

const PLUGINS_DIR = path.resolve(__dirname, "..", "..", "..", "..", "plugins");

describe("loadToolPlugins (integration against plugins/)", () => {
  it("loads every enabled plugin in the repo", async () => {
    const registry = new ToolRegistry();
    const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const loaded = await loadToolPlugins({ directory: PLUGINS_DIR, registry, logger: silentLogger });
    const names = loaded.map((l) => l.manifest.name).sort();
    expect(names).toEqual(["echo-tool", "github-api", "http-fetch"]);
  });

  it("registers every tool the plugins ship with", async () => {
    const registry = new ToolRegistry();
    const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    await loadToolPlugins({ directory: PLUGINS_DIR, registry, logger: silentLogger });
    const toolNames = registry.getAll().map((t) => t.definition.name).sort();
    expect(toolNames).toContain("echo_text");
    expect(toolNames).toContain("http_fetch");
    expect(toolNames).toContain("gh_list_issues");
    expect(toolNames).toContain("gh_get_issue");
    expect(toolNames).toContain("gh_list_prs");
  });

  it("normalizes legacy flat tool definitions from generated plugins", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "syntax-senpai-plugin-"));
    const pluginDir = path.join(directory, "legacy-tool");
    await fs.mkdir(pluginDir);
    await fs.writeFile(path.join(pluginDir, "plugin.json"), JSON.stringify({
      name: "legacy-tool",
      version: "1.0.0",
      main: "index.mjs",
    }));
    await fs.writeFile(path.join(pluginDir, "index.mjs"), `
      export function activate({ registerTool }) {
        registerTool({
          name: 'legacy_echo',
          description: 'Echo input',
          parameters: { type: 'object', properties: {} },
          async execute() { return { success: true, data: 'ok' } }
        })
      }
    `);

    try {
      const registry = new ToolRegistry();
      const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
      const loaded = await loadToolPlugins({ directory, registry, logger: silentLogger });
      expect(loaded[0]?.registeredTools).toEqual(["legacy_echo"]);
      expect(registry.get("legacy_echo")?.definition.name).toBe("legacy_echo");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("http_fetch refuses private hostnames by default", async () => {
    const registry = new ToolRegistry();
    const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    await loadToolPlugins({ directory: PLUGINS_DIR, registry, logger: silentLogger });
    const tool = registry.get("http_fetch")!;
    const result = await tool.execute(
      { url: "http://127.0.0.1:9999/" },
      {
        platform: "desktop",
        userId: "u1",
        waifuId: "aria",
        permissions: { fileRead: true, fileWrite: true, shellExec: true, networkAccess: true },
      }
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/private host/);
  });

  it("http_fetch rejects non-http URLs", async () => {
    const registry = new ToolRegistry();
    const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
    await loadToolPlugins({ directory: PLUGINS_DIR, registry, logger: silentLogger });
    const tool = registry.get("http_fetch")!;
    const result = await tool.execute(
      { url: "file:///etc/passwd" },
      {
        platform: "desktop",
        userId: "u1",
        waifuId: "aria",
        permissions: { fileRead: true, fileWrite: true, shellExec: true, networkAccess: true },
      }
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/http\/https/);
  });
});
