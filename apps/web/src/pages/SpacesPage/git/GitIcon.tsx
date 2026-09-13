export type GitIconName = 'file' | 'directory' | 'symlink' | 'submodule' | 'branch' | 'tag' | 'commit' | 'compare' | 'code' | 'chevron' | 'settings'

export default function GitIcon({ name, size = 16 }: { name: GitIconName; size?: number }) {
  const paths: Record<GitIconName, string> = {
    file: 'M6 3h8l4 4v14H6V3ZM14 3v5h4',
    directory: 'M3 7V4h6l2 3h10v13H3V7Z',
    symlink: 'M6 3h8l4 4v5M6 11V3M4 17h12m-4-4 4 4-4 4',
    submodule: 'M3 7V4h6l2 3h10v13H3V7ZM8 13l4 4 4-4',
    branch: 'M6 7v10m0-4c8 0 12-1 12-6M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    tag: 'M3 3h8l10 10-8 8L3 11V3ZM7 7h.01',
    commit: 'M3 12h5m8 0h5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    compare: 'M7 3v16m-4-4 4 4 4-4M17 21V5m-4 4 4-4 4 4',
    code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
    chevron: 'm6 9 6 6 6-6',
    settings: 'M4 7h7m4 0h5M4 17h3m4 0h9M13 4v6M9 14v6',
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d={paths[name]} /></svg>
}
