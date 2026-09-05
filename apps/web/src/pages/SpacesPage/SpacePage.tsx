import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import type { BoxProps, FlexProps } from '@chakra-ui/react'
import { Fragment } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { ActionButton, EmptyState, PageContainer, PageHeading, PageLink, TextInput } from '../../components/ui/Primitives'
import { useSpaces } from '../../context/spaces'
import { findEntry, spacePath } from './spaceData'
import { demoUser, namespacePath } from '../UserPage/namespaces'

export default function SpacePage() {
  const { account, spaceSlug } = useParams()
  const { spaces } = useSpaces()
  const [params] = useSearchParams()
  const space = spaces.find(item => item.owner.account === account && item.slug === spaceSlug)

  if (!space) {
    return (
      <PageContainer textAlign="center">
        <PageHeading mb="16px">Space not found</PageHeading>
        <Text color="var(--muted)" fontSize="13px">This Space does not exist or was reset when the page refreshed.</Text>
        <ActionButton asChild mt="20px"><PageLink to={namespacePath(account ? { account } : demoUser)}>Back to profile</PageLink></ActionButton>
      </PageContainer>
    )
  }

  const root = spacePath(space)
  const path = params.get('path') || ''
  const parts = path ? path.split('/') : []
  const entry = findEntry(space.items, path)
  const missing = Boolean(path && !entry)
  const isFile = Boolean(entry && !entry.children)
  const entries = path ? entry?.children ?? [] : space.items
  const parentPath = parts.slice(0, -1).join('/')
  const readme = entries.find(item => item.name === 'README.md' && !item.children)
  const search = params.get('q') || ''
  const visible = entries.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))

  function location(nextPath: string) {
    return nextPath ? `${root}?${new URLSearchParams({ path: nextPath })}` : root
  }

  return (
    <PageContainer>
      <Box as="nav" aria-label="Breadcrumb" fontSize="13px" color="var(--muted)" overflowWrap="anywhere">
        <PageLink to={namespacePath(space.owner)}>{space.owner.account}</PageLink>
        <Text as="span" mx="10px">/</Text>
        <Text as="span" aria-current="page">{space.name}</Text>
      </Box>
      <Box as="header" mt="24px" mb="32px">
        <Flex align="center" gap="14px" wrap="wrap">
          <PageHeading>{space.name}</PageHeading>
          <Text as="span" fontSize="12px" color="var(--muted)">{space.type === 'Git' ? 'Git' : 'Object storage'} · {space.visibility}</Text>
        </Flex>
        {space.description && <Text color="var(--muted)" fontSize="13px" mt="10px" lineHeight="1.7" overflowWrap="anywhere">{space.description}</Text>}
      </Box>

      <Box as="section" minW="0" aria-label="Content browser">
        <Flex align="center" justify="space-between" wrap="wrap" gap="16px" mb="16px">
          <Flex align="center" gap="12px" minW="0" fontSize="12px">
            {space.type === 'Git' && <Text as="span" whiteSpace="nowrap" p="6px 10px" border="1px solid var(--border)" borderRadius="5px" aria-label="Current branch: main">⑂ main</Text>}
            <Box as="nav" aria-label="File path" overflowWrap="anywhere">
              <PageLink to={root}>{space.name}</PageLink>
              {parts.map((part, index) => (
                <Fragment key={index}>
                  <Text as="span" color="var(--muted)" aria-hidden="true"> / </Text>
                  <PageLink to={location(parts.slice(0, index + 1).join('/'))} aria-current={index === parts.length - 1 ? 'page' : undefined}>{part}</PageLink>
                </Fragment>
              ))}
            </Box>
          </Flex>
          {!isFile && !missing && <Box flex={{ base: '1 1 100%', md: '0 1 190px' }}><FileSearch value={search} /></Box>}
        </Flex>

        {missing ? (
          <ContentPanel>
            <EmptyState>
              <Heading as="h2" fontSize="16px" fontWeight="500" color="var(--foreground)" mb="10px">Content not found</Heading>
              <Text>This path does not exist in this Space.</Text>
              <ActionButton asChild mt="20px"><PageLink to={root}>Back to root</PageLink></ActionButton>
            </EmptyState>
          </ContentPanel>
        ) : isFile && entry ? (
          <ContentPanel as="section" aria-label="File preview">
            <PanelHeading>
              <Heading as="h2" fontSize="12px" fontWeight="500" color="var(--foreground)" overflowWrap="anywhere">{entry.name}</Heading>
              <Text as="span" flexShrink="0">Plain text · {new TextEncoder().encode(entry.content ?? '').length} B</Text>
            </PanelHeading>
            <Box as="pre" m="0" p={{ base: '16px', md: '24px' }} fontSize="12px" lineHeight="1.9" overflowX="auto" css={{ tabSize: 2 }}>
              <Box as="code" fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace">{entry.content || 'This file is empty.'}</Box>
            </Box>
            <Box borderTop="1px solid var(--border)" p="12px 16px" fontSize="12px" color="var(--muted)">
              <PageLink to={location(parentPath)}>← Back to folder</PageLink>
            </Box>
          </ContentPanel>
        ) : (
          <>
            <ContentPanel>
              <PanelHeading>
                <Heading as="h2" fontSize="12px" fontWeight="500" color="var(--foreground)" overflowWrap="anywhere">{path ? parts.at(-1) : space.type === 'Git' ? 'Repository files' : 'All files'}</Heading>
                <Text as="span" flexShrink="0">{entries.length} {entries.length === 1 ? 'item' : 'items'}</Text>
              </PanelHeading>
              {path && <PageLink to={location(parentPath)} display="block" p="12px 16px" borderBottom="1px solid var(--border)" fontSize="12px" color="var(--muted)">↑ Parent folder</PageLink>}
              {visible.length > 0 ? (
                <Box as="ul" listStyleType="none" m="0" p="0">
                  {visible.map(item => (
                    <Box as="li" key={item.name} _notFirst={{ borderTop: '1px solid color-mix(in srgb, var(--border) 35%, transparent)' }}>
                      <PageLink to={location([...parts, item.name].join('/'))} display="flex" alignItems="center" gap="12px" p="12px 16px" fontSize="13px" _hover={{ bg: 'var(--surface)' }}>
                        <Text as="span" width="18px" flexShrink="0" fontSize="16px" color="var(--muted)" aria-hidden="true">{item.children ? '▤' : '≡'}</Text>
                        <Text as="span" overflowWrap="anywhere">{item.name}</Text>
                      </PageLink>
                    </Box>
                  ))}
                </Box>
              ) : (
                <EmptyState>
                  <Heading as="h2" fontSize="16px" fontWeight="500" color="var(--foreground)" mb="10px">{search ? 'No matching files' : 'No files yet'}</Heading>
                  {search && <ActionButton asChild mt="20px"><PageLink to={location(path)}>Clear search</PageLink></ActionButton>}
                </EmptyState>
              )}
            </ContentPanel>
            {space.type === 'Git' && readme && (
              <ContentPanel as="section" mt="24px">
                <PanelHeading>
                  <Heading as="h2" fontSize="12px" fontWeight="500" color="var(--foreground)">README.md</Heading>
                  <PageLink to={location([...parts, readme.name].join('/'))}>View source ↗</PageLink>
                </PanelHeading>
                <Box p={{ base: '16px', md: '24px' }}>
                  {readme.content?.split('\n').filter(Boolean).map((line, index) =>
                    line.startsWith('# ') ? <Heading as="h2" key={index} fontSize="22px" fontWeight="600" mb="16px">{line.slice(2)}</Heading>
                      : line.startsWith('## ') ? <Heading as="h3" key={index} fontSize="15px" fontWeight="600" mt="24px" mb="12px">{line.slice(3)}</Heading>
                        : <Text key={index} fontSize="13px" lineHeight="1.9" my="8px" color="var(--muted)">{line}</Text>,
                  )}
                </Box>
              </ContentPanel>
            )}
          </>
        )}
      </Box>
    </PageContainer>
  )
}

function ContentPanel(props: BoxProps) {
  return <Box border="1px solid color-mix(in srgb, var(--border) 60%, transparent)" borderRadius="6px" overflow="hidden" {...props} />
}

function PanelHeading(props: FlexProps) {
  return <Flex align="center" justify="space-between" gap="16px" p="12px 16px" borderBottom="1px solid color-mix(in srgb, var(--border) 55%, transparent)" fontSize="11px" color="var(--muted)" {...props} />
}

function FileSearch({ value }: { value: string }) {
  const [, setParams] = useSearchParams()
  return <TextInput width="100%" type="search" aria-label="Find a file" placeholder="Find a file…" value={value} onChange={event => {
    const query = event.target.value
    setParams(current => {
      const next = new URLSearchParams(current)
      if (query) next.set('q', query)
      else next.delete('q')
      return next
    }, { replace: true })
  }} />
}
