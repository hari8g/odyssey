let workspaceSessionId = 0

export function getWorkspaceSessionId(): number {
  return workspaceSessionId
}

export function bumpWorkspaceSession(): number {
  workspaceSessionId += 1
  return workspaceSessionId
}
