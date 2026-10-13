import {afterEach, beforeEach, expect, test, vi} from 'vitest'

const invoke = vi.fn<(tool: string, params: unknown) => Promise<unknown>>()
vi.mock('./registry', () => ({invoke: (tool: string, params: unknown) => invoke(tool, params)}))

const {runActions} = await import('./batch.js')

interface StepResult {
  index: number
  tool: string
  ok: boolean
  result?: unknown
  error?: string
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function run(params: unknown): Promise<{steps: StepResult[]}> {
  return (await runActions(params)) as {steps: StepResult[]}
}

test('runs steps in order and applies the batch tabId only where it is missing', async () => {
  invoke.mockImplementation(async (tool, params) => ({tool, params}))
  const result = await run({
    tabId: 7,
    actions: [
      {tool: 'press_key', params: {key: 'c'}},
      {tool: 'press_key', params: {key: 'o', tabId: 9}},
      {tool: 'type', params: {text: 'hello'}},
    ],
  })
  expect(invoke.mock.calls).toEqual([
    ['press_key', {key: 'c', tabId: 7}],
    ['press_key', {key: 'o', tabId: 9}],
    ['type', {text: 'hello', tabId: 7}],
  ])
  expect(result.steps.map((step) => step.ok)).toEqual([true, true, true])
  expect(result.steps[0]).toEqual({
    index: 0,
    tool: 'press_key',
    ok: true,
    result: {tool: 'press_key', params: {key: 'c', tabId: 7}},
  })
})

test('stops at the first failure without executing later steps', async () => {
  invoke.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('KEY_PIPELINE_DEAD: dead'))
  const result = await run({
    actions: [
      {tool: 'press_key', params: {key: 'a'}},
      {tool: 'press_key', params: {key: 'b'}},
      {tool: 'press_key', params: {key: 'c'}},
    ],
  })
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(result.steps).toEqual([
    {index: 0, tool: 'press_key', ok: true, result: {}},
    {index: 1, tool: 'press_key', ok: false, error: 'KEY_PIPELINE_DEAD: dead'},
  ])
})

test('continueOnError keeps executing after a failure', async () => {
  invoke.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({})
  const result = await run({
    continueOnError: true,
    actions: [{tool: 'click', params: {ref: 'e1'}}, {tool: 'snapshot', params: {}}],
  })
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(result.steps.map((step) => step.ok)).toEqual([false, true])
})

test('rejects batches that nest run_actions or name an unknown tool before executing anything', async () => {
  await expect(run({actions: [{tool: 'run_actions'}]})).rejects.toThrow()
  await expect(run({actions: [{tool: 'screenshot'}]})).rejects.toThrow()
  await expect(run({actions: [{tool: 'nope'}]})).rejects.toThrow()
  await expect(run({actions: []})).rejects.toThrow()
  expect(invoke).not.toHaveBeenCalled()
})
