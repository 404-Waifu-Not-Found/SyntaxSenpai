# Live2D Cubism Model Import Implementation

This document outlines the new Live2D model import feature added to the SyntaxSenpai desktop app.

## Features

### Model Import
- **File Dialog**: Users can browse and select a Cubism model directory
- **Validation**: Checks that the directory contains valid Cubism model files (`.model3.json` and `.moc3`)
- **Auto-Copy**: Models are copied to the app's local library (`userData/models/`)
- **Metadata Extraction**: Model settings and metadata are parsed and stored

### Model Management
- **List Models**: View all imported models with metadata
- **Delete Models**: Remove models from the library
- **Select/Load**: Choose a model and view detailed information
- **Path Resolution**: Handles both absolute and relative paths for model assets

### Model Viewer
- **Cubism Integration**: Uses native Cubism SDK to load and validate models
- **Metadata Display**: Shows texture count, motion groups, expressions, etc.
- **Version Info**: Displays Cubism SDK version

## IPC API

### Main Process (`apps/desktop/src/main/ipc/l2d.ts`)

```typescript
// Import a new model
ipcMain.handle('l2d:importModel', async () => {
  // Shows file dialog, validates directory, copies to library
  // Returns: { success, model, error?, canceled? }
})

// List all imported models
ipcMain.handle('l2d:listModels', async () => {
  // Returns: { success, models[], error? }
})

// Get a specific model's info
ipcMain.handle('l2d:getModel', async (modelId) => {
  // Returns: { success, model, error? }
})

// Delete a model from library
ipcMain.handle('l2d:deleteModel', async (modelId) => {
  // Returns: { success, error? }
})
```

### Preload API (`apps/desktop/src/preload/index.ts`)

```typescript
window.l2d = {
  importModel(),
  listModels(),
  deleteModel(modelId),
  getModel(modelId)
}
```

## Vue Components

### `L2dPanel.vue`
Comprehensive panel combining model browser and viewer with metadata display.

**Usage:**
```vue
<template>
  <L2dPanel />
</template>

<script setup>
import L2dPanel from '@/components/L2dPanel.vue'
</script>
```

### `L2dModelBrowser.vue`
Lists all imported models with import/delete buttons.

**Events:**
- `modelSelected`: Emitted when a model is clicked
- `modelLoaded`: Emitted when "Load Model" button is clicked

### `L2dViewer.vue`
Displays selected model information and Cubism metadata.

**Props:**
- `model`: The L2DModel to display

## Composable

### `useL2dModels()`

```typescript
const {
  models,           // ref<L2DModel[]>
  selectedModelId,  // ref<string | null>
  selectedModel,    // computed<L2DModel | null>
  isLoading,        // ref<boolean>
  error,            // ref<string | null>
  loadModels,       // () => Promise<void>
  importModel,      // () => Promise<boolean>
  deleteModel,      // (modelId) => Promise<boolean>
  selectModel       // (modelId) => void
} = useL2dModels()
```

## Data Model

### L2DModel Interface

```typescript
interface L2DModel {
  id: string                    // Base64-encoded model name
  name: string                  // Directory name
  path: string                  // Full path to model directory
  modelJsonPath: string         // Path to .model3.json
  metadata?: Record<string, any> // Data from .model3.json
  importedAt?: string           // ISO date string
}
```

### Storage

Models are stored in:
```
%APPDATA%\SyntaxSenpai\userData\models\
```

Each model is stored in its own directory with all original files preserved.

## Integration

### Adding to App UI

1. **Add to main settings/preferences:**

```vue
<template>
  <div>
    <!-- Other settings -->
    <section>
      <h2>Avatar Settings</h2>
      <L2dPanel />
    </section>
  </div>
</template>

<script setup>
import L2dPanel from '@

/components/L2dPanel.vue'
</script>
```

2. **Or create a dedicated modal:**

```vue
<template>
  <Dialog v-model="showL2dSettings">
    <L2dPanel />
  </Dialog>
</template>

<script setup>
import { ref } from 'vue'
import L2dPanel from '@/components/L2dPanel.vue'

const showL2dSettings = ref(false)
</script>
```

3. **Or use in specific chat/waifu section:**

```vue
<template>
  <div class="waifu-settings">
    <h3>{{ waifuName }} Settings</h3>
    <L2dPanel />
  </div>
</template>
```

## Error Handling

All IPC calls return a standardized response:

```typescript
{
  success: boolean      // Operation successful
  error?: string        // Error message if failed
  canceled?: boolean    // User canceled dialog
  model?: L2DModel      // Model data if applicable
  models?: L2DModel[]   // Models list if applicable
}
```

Components handle errors via:
- local `error` ref state
- error badge display
- console warnings for debugging

## Building

The native Cubism addon must be built before using the model import feature:

```bash
cd apps/desktop
pnpm build:native   # Builds the native addon
pnpm build          # Bundles everything
```

## Testing

### Manual Testing Steps

1. Build the app: `pnpm --dir apps/desktop run build`
2. Open the L2D panel
3. Click "Import Model"
4. Select a Cubism model directory
5. Verify model appears in the list
6. Click model to select it
7. View metadata and information
8. Click "Load Model" to validate
9. Verify Cubism info displays correctly

### Example Model Sources

- [Cubism SDK Sample Models](https://www.live2d.com/en/download/cubism-sdk/)
- Create test models using Live2D Cubism Editor

## Troubleshooting

### Model won't import
- Ensure directory contains `.model3.json` or `.moc3` files
- Check file permissions
- Verify path doesn't exceed system limits

### Metadata not showing
- Model JSON may be malformed
- Check model.json is valid JSON
- Ensure .model3.json is in model directory

### Cubism SDK not available
- Build native addon: `pnpm build:native`
- Check Node.js version (>=20.0.0)
- Verify preload module path resolution

## Future Enhancements

- WebGL/Canvas rendering of models
- Motion playback controls
- Expression triggering
- Parameter animation
- Model preview thumbnails
- Import from ZIP/TAR archives
- Model search/filtering
- Cloud model library integration
