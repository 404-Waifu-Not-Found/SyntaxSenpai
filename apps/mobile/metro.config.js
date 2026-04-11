const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all workspace packages for live reloading
config.watchFolders = [workspaceRoot];

// Resolve modules from both the mobile app and the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Desktop-only Node.js native modules that must not be bundled for mobile.
// These are only imported in DesktopKeystoreAdapter which is never reached on mobile.
const DESKTOP_ONLY_MODULES = new Set(['keytar', 'electron', 'fs', 'path', 'os', 'child_process']);

// Remap .js imports to .ts when resolving TypeScript source files
// (TypeScript ESM uses .js extensions in imports, but the actual files are .ts)
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Return an empty stub for desktop-only native modules
  if (DESKTOP_ONLY_MODULES.has(moduleName)) {
    return { type: 'empty' };
  }

  if (moduleName.endsWith('.js')) {
    const tsName = moduleName.slice(0, -3) + '.ts';
    try {
      return context.resolveRequest(context, tsName, platform);
    } catch {
      // fall through to default
    }
    const tsxName = moduleName.slice(0, -3) + '.tsx';
    try {
      return context.resolveRequest(context, tsxName, platform);
    } catch {
      // fall through to default
    }
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
