export type OfficialContentPackage = {
  id: string
  version: string
  name: string
  digest: string
  resources: Array<{ id: string; name: string; resourceKind: string; available: boolean }>
  agents: Array<{ id: string; name: string; presetId: string }>
}
