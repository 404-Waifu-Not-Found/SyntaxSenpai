export type RepoListItem = {
  path: string
  name: string
  parentDir: string
  lastCommitTimestamp: number | null
  branch: string | null
}

export type RepoInfo = {
  path: string
  name: string
  branch: string | null
  isDirty: boolean
  aheadBehind: { ahead: number; behind: number } | null
  remoteUrl: string | null
  languages: string[]
  packageManager: string | null
  defaultStartCommand: string | null
  lastCommitSubject: string | null
  lastCommitRelative: string | null
}

export type ActiveCodingRepo = RepoInfo & { activatedAt: number }
