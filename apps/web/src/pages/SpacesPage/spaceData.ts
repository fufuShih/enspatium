import { demoOrganization, demoUser, namespacePath } from '../UserPage/namespaces'
import type { Namespace } from '../UserPage/namespaces'

export type SpaceEntry = {
  name: string
  content?: string
  children?: SpaceEntry[]
}

export type Space = {
  id: string
  owner: Namespace
  slug: string
  name: string
  description: string
  type: 'Git' | 'Object'
  visibility: 'Private' | 'Public'
  updated: string
  items: SpaceEntry[]
}

export const initialSpaces: Space[] = [
  {
    id: 'enspatium', name: 'enspatium', description: 'Everything is a Space. A home for my code and experiments.',
    owner: demoUser, slug: 'enspatium',
    type: 'Git', visibility: 'Public', updated: '2 hours ago',
    items: [
      { name: 'apps', children: [{ name: 'web', children: [{ name: 'README.md', content: '# Web\n\nThe frontend for Enspatium.\n\nA simple place to explore your code, files, and ideas.' }] }] },
      { name: 'packages', children: [{ name: 'README.md', content: '# Packages\n\nShared building blocks for the workspace.' }] },
      { name: 'README.md', content: '# Enspatium\n\nEverything is a Space.\n\nBring code, files, and knowledge into one place.\n\n## Inside this repository\n\n- apps/ — frontend applications\n- packages/ — shared packages\n\n## Getting started\n\nExplore the folders above and make yourself at home.' },
      { name: 'package.json', content: '{\n  "name": "enspatium",\n  "private": true,\n  "description": "Everything is a Space."\n}' },
    ],
  },
  {
    id: 'design-assets', name: 'design-assets', description: 'A collection of assets and inspiration for the next great idea.',
    owner: demoOrganization, slug: 'design-assets',
    type: 'Object', visibility: 'Private', updated: 'Yesterday',
    items: [
      { name: 'brand', children: [{ name: 'colors.json', content: '{\n  "background": "#f7f7f3",\n  "foreground": "#192635",\n  "accent": "#d5d3c2"\n}' }, { name: 'guidelines.md', content: '# Brand guidelines\n\nKeep it simple. Give ideas room to breathe.\n\nUse warm neutrals, clear typography, and generous spacing.' }] },
      { name: 'inspiration', children: [{ name: 'moodboard.md', content: '# Inspiration\n\n- Open spaces\n- Natural textures\n- Quiet places to create' }] },
      { name: 'logo.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">\n  <rect width="120" height="120" rx="24" fill="#ebe9dd" />\n  <circle cx="60" cy="60" r="28" fill="none" stroke="#192635" stroke-width="8" />\n</svg>' },
    ],
  },
  {
    id: 'personal-notes', name: 'personal-notes', description: 'Notes, thoughts, and little projects in progress.',
    owner: demoUser, slug: 'personal-notes',
    type: 'Git', visibility: 'Private', updated: '3 days ago',
    items: [
      { name: 'notes', children: [{ name: 'first-thoughts.md', content: '# First thoughts\n\nStart small. Make something useful. Keep going.' }] },
      { name: 'ideas.md', content: '# Ideas\n\n- Build a personal reading list\n- Collect useful snippets\n- Make room for a weekend project' },
      { name: 'README.md', content: '# Personal notes\n\nA home for unfinished thoughts and things worth remembering.' },
    ],
  },
]

export function spacePath(space: Space) {
  return `${namespacePath(space.owner)}/${encodeURIComponent(space.slug)}`
}

export function findEntry(items: SpaceEntry[], path: string): SpaceEntry | undefined {
  if (!path) return undefined
  const parts = path.split('/')
  let entries = items
  for (let index = 0; index < parts.length; index++) {
    const entry = entries.find(item => item.name === parts[index])
    if (!entry) return undefined
    if (index === parts.length - 1) return entry
    if (!entry.children) return undefined
    entries = entry.children
  }
  return undefined
}

export function countFiles(items: SpaceEntry[]): number {
  return items.reduce((total, item) => total + (item.children ? countFiles(item.children) : 1), 0)
}
