# @syntax-senpai/ui

Shared Vue 3 component library for SyntaxSenpai. The package exports the small reusable pieces that the desktop app uses for forms, layouts, transitions, and polished status UI.

## Install

This package is consumed through the workspace, so most contributors import it from other `@syntax-senpai/*` packages rather than installing it separately.

## Usage

```vue
<script setup lang="ts">
import { Button, Screen, TransitionVertical } from '@syntax-senpai/ui'
</script>

<template>
  <Screen>
    <Button>Save</Button>
  </Screen>
</template>
```

## Exports

- `animations` - `TransitionBidirectional`, `TransitionHorizontal`, `TransitionVertical`
- `form` - `Checkbox`, `Combobox`, `ComboboxSelect`, `Field`, `Input`, `Radio`, `Range`, `Select`, `SelectTab`, `Textarea`
- `layouts` - `Collapsible`, `Screen`, `Skeleton`
- `misc` - `Button`, `Callout`, `DoubleCheckButton`, `Progress`
- `composables` - `useDeferredMount`, `useTheme`
- `lampFlickerAnimationClass` - utility class for the ambient lamp effect

## Notes

- Built for UnoCSS-based Vue screens.
- No standalone build step is required.
- This package is shared between desktop UI surfaces and other Vue consumers in the monorepo.

## License

[MIT](../../LICENSE)
