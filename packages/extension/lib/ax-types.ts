/**
 * CDP Accessibility 域节点的归一类型与手写守卫解析。
 * 全页树可达数万节点，逐节点 zod parse 开销不成比例，故手写守卫；
 * 其余一切边界输入仍走 zod。
 */

export interface AxNode {
  readonly nodeId: string
  readonly ignored: boolean
  readonly role: string
  readonly name: string
  readonly value: string
  readonly childIds: readonly string[]
  readonly backendDOMNodeId: number | undefined
  readonly frameId: string | undefined
  readonly checked: 'true' | 'false' | 'mixed' | undefined
  readonly disabled: boolean
  readonly expanded: boolean | undefined
  readonly selected: boolean | undefined
  readonly level: number | undefined
  readonly clickable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 取 CDP 的 {type, value} 包装里的字符串值。 */
function stringValue(raw: unknown): string {
  if (!isRecord(raw)) return ''
  const value = raw['value']
  return typeof value === 'string' ? value : ''
}

function boolProp(properties: readonly {name: string; value: unknown}[], name: string): boolean {
  const prop = properties.find((p) => p.name === name)
  if (prop === undefined) return false
  const value = isRecord(prop.value) ? prop.value['value'] : undefined
  return value === true
}

function tokenProp(properties: readonly {name: string; value: unknown}[], name: string): string | undefined {
  const prop = properties.find((p) => p.name === name)
  if (prop === undefined) return undefined
  const value = isRecord(prop.value) ? prop.value['value'] : undefined
  return typeof value === 'string' ? value : undefined
}

function numProp(properties: readonly {name: string; value: unknown}[], name: string): number | undefined {
  const prop = properties.find((p) => p.name === name)
  if (prop === undefined) return undefined
  const value = isRecord(prop.value) ? prop.value['value'] : undefined
  return typeof value === 'number' ? value : undefined
}

function optBoolProp(properties: readonly {name: string; value: unknown}[], name: string): boolean | undefined {
  const prop = properties.find((p) => p.name === name)
  if (prop === undefined) return undefined
  const value = isRecord(prop.value) ? prop.value['value'] : undefined
  return typeof value === 'boolean' ? value : undefined
}

function parseNode(raw: unknown): AxNode | undefined {
  if (!isRecord(raw) || typeof raw['nodeId'] !== 'string') return undefined
  const properties: {name: string; value: unknown}[] = Array.isArray(raw['properties'])
    ? raw['properties'].filter(
      (p): p is {name: string; value: unknown} => isRecord(p) && typeof p['name'] === 'string',
    )
    : []
  const childIds = Array.isArray(raw['childIds'])
    ? raw['childIds'].filter((id): id is string => typeof id === 'string')
    : []
  const backendDOMNodeId = typeof raw['backendDOMNodeId'] === 'number' ? raw['backendDOMNodeId'] : undefined
  const checkedRaw = tokenProp(properties, 'checked')
  const checked = checkedRaw === 'true' || checkedRaw === 'false' || checkedRaw === 'mixed' ? checkedRaw : undefined
  return {
    nodeId: raw['nodeId'],
    ignored: raw['ignored'] === true,
    role: stringValue(raw['role']) || 'generic',
    name: stringValue(raw['name']),
    value: stringValue(raw['value']),
    childIds,
    backendDOMNodeId,
    frameId: typeof raw['frameId'] === 'string' ? raw['frameId'] : undefined,
    checked,
    disabled: boolProp(properties, 'disabled'),
    expanded: optBoolProp(properties, 'expanded'),
    selected: optBoolProp(properties, 'selected'),
    level: numProp(properties, 'level'),
    clickable: boolProp(properties, 'clickable'),
  }
}

/** 解析 Accessibility.getFullAXTree 的 nodes 数组；坏节点跳过而非整体失败。 */
export function parseAxNodes(raw: unknown): AxNode[] {
  if (!Array.isArray(raw)) return []
  const nodes: AxNode[] = []
  for (const item of raw) {
    const node = parseNode(item)
    if (node !== undefined) nodes.push(node)
  }
  return nodes
}
