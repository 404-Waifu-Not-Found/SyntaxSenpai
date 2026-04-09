/**
 * Filesystem plugin loader for external tool packs.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ToolImplementation,
  ToolPluginManifest,
  ToolPluginModule
} from './types'
import { ToolRegistry, toolRegistry } from './registry'

export interface LoadedToolPlugin {
  manifest: ToolPluginManifest;
  registeredTools: string[];
}

export interface LoadToolPluginsOptions {
  directory: string;
  registry?: ToolRegistry;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

async function readManifest(manifestPath: string): Promise<ToolPluginManifest> {
  const raw = await fs.readFile(manifestPath, 'utf8')
  return JSON.parse(raw) as ToolPluginManifest
}

export async function loadToolPlugins({
  directory,
  registry = toolRegistry,
  logger = console
}: LoadToolPluginsOptions): Promise<LoadedToolPlugin[]> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const loadedPlugins: LoadedToolPlugin[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const pluginDir = path.join(directory, entry.name)
    const manifestPath = path.join(pluginDir, 'plugin.json')

    try {
      const manifest = await readManifest(manifestPath)
      if (manifest.enabled === false) {
        logger.info(`Skipping disabled tool plugin: ${manifest.name}`)
        continue
      }

      const modulePath = path.resolve(pluginDir, manifest.main)
      const imported = await import(pathToFileURL(modulePath).href)
      const pluginModule = (imported.default ?? imported) as ToolPluginModule

      if (typeof pluginModule.activate !== 'function') {
        throw new Error(`Plugin ${manifest.name} does not export an activate() function`)
      }

      const registeredTools: string[] = []
      const registerTool = (tool: ToolImplementation) => {
        registry.register(tool)
        registeredTools.push(tool.definition.name)
      }

      await pluginModule.activate({
        manifest,
        registerTool
      })

      loadedPlugins.push({ manifest, registeredTools })
      logger.info(`Loaded tool plugin ${manifest.name}@${manifest.version}`)
    } catch (error) {
      logger.error(`Failed to load tool plugin from ${pluginDir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return loadedPlugins
}
