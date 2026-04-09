# SyntaxSenpai Plugins

Tool plugins live in subdirectories under `plugins/` and are discovered from a `plugin.json` manifest.

Each plugin directory needs:

```text
plugins/
  my-plugin/
    plugin.json
    index.js
```

`plugin.json` fields:

- `name`: unique plugin name
- `version`: plugin version
- `main`: entry file relative to the plugin directory
- `enabled`: optional flag to disable loading

The entry module must export an `activate({ manifest, registerTool })` function. Call `registerTool(...)` with the same `ToolImplementation` shape used internally by `@syntax-senpai/agent-tools`.
