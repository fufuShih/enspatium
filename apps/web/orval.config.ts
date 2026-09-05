import { defineConfig } from 'orval'

export default defineConfig({
  enspatium: {
    input: '../../packages/server/openapi.json',
    output: {
      target: './src/api/generated.ts',
      client: 'react-query',
      httpClient: 'fetch',
      baseUrl: '/api',
      urlEncodeParameters: true,
      override: {
        fetch: { includeHttpResponseReturnType: false, forceSuccessResponse: true },
        requestOptions: { credentials: 'include' },
      },
    },
  },
})
