#!/usr/bin/env node
import {runCli} from './cli.js'

runCli().catch((error: unknown) => {
  console.error(`launcher failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
