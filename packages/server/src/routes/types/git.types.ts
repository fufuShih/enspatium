import { Type } from '@sinclair/typebox'

import type { PublicSpace } from '../../db/space.types.js'

export interface GitAccess {
  space: Pick<PublicSpace, 'id' | 'namespaceId'>
  userId?: string
}

export const GitTransportParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const GitInfoRefsQuerySchema = Type.Object({
  service: Type.Union([
    Type.Literal('git-upload-pack'),
    Type.Literal('git-receive-pack'),
  ]),
})
