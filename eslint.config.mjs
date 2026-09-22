import config from '@ddyscn/lint-config'

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      'packages/extension/.wxt/**',
    ],
  },
  ...config,
]
