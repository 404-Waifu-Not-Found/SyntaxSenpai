#!/usr/bin/env node
import module from 'node:module'

import { runCLI } from './cli'

try {
  ;(module as any).enableCompileCache?.()
}
catch {}
runCLI()
