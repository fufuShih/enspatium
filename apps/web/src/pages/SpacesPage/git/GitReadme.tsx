import { Box, Heading, Text } from '@chakra-ui/react'
import Markdown from 'react-markdown'
import type { GetGitSpaceFile200 } from '../../../api/generated/api.schemas.ts'

export default function GitReadme({ file }: { file: GetGitSpaceFile200 }) {
  if (!/\.(md|markdown)$/i.test(file.name)) return <Box as="pre" p="24px" m="0" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="13px">{file.content || 'This README is empty.'}</Box>
  return (
    <Box p={{ base: '20px', md: '28px' }} fontSize="14px" lineHeight="1.8" overflowWrap="anywhere" css={{ '& > :first-child': { marginTop: 0 }, '& > :last-child': { marginBottom: 0 }, '& ul, & ol': { paddingLeft: '24px', marginBlock: '12px' }, '& ul': { listStyleType: 'disc' }, '& ol': { listStyleType: 'decimal' }, '& pre': { background: 'var(--surface)', padding: '16px', overflowX: 'auto', borderRadius: '6px', marginBlock: '16px' }, '& code': { fontFamily: 'mono', fontSize: '0.9em' }, '& blockquote': { borderLeft: '3px solid var(--border)', paddingLeft: '16px', color: 'var(--muted)', marginBlock: '16px' }, '& hr': { marginBlock: '24px', borderColor: 'var(--border)' } }}>
      <Markdown skipHtml components={{
        h1: ({ children }) => <Heading as="h3" fontSize="24px" mt="24px" mb="16px">{children}</Heading>,
        h2: ({ children }) => <Heading as="h4" fontSize="20px" mt="24px" mb="12px">{children}</Heading>,
        h3: ({ children }) => <Heading as="h5" fontSize="17px" mt="20px" mb="10px">{children}</Heading>,
        p: ({ children }) => <Text my="12px">{children}</Text>,
        img: ({ alt }) => <Text as="span" color="var(--muted)">{alt ? `[${alt}]` : '[Image]'}</Text>,
        a: ({ href, children }) => /^https?:\/\//i.test(href ?? '') ? <Box asChild color="var(--foreground)" textDecoration="underline" textUnderlineOffset="3px"><a href={href} target="_blank" rel="noopener noreferrer">{children}</a></Box> : <>{children}</>,
      }}>{file.content || 'This README is empty.'}</Markdown>
    </Box>
  )
}
