import { Box, Button, Heading, Input, Textarea, chakra } from '@chakra-ui/react'
import type { BoxProps, ButtonProps, HeadingProps, HTMLChakraProps, InputProps, TextareaProps } from '@chakra-ui/react'
import type { ComponentProps } from 'react'
import { Link } from 'react-router'

export function PageContainer(props: BoxProps) {
  return <Box maxW="960px" mx="auto" p={{ base: '32px 20px', md: '48px 32px 64px' }} css={{ '& :is(a, button, input, textarea, select):focus-visible': { outline: '2px solid var(--muted)', outlineOffset: '3px' } }} {...props} />
}

export function PageHeading(props: HeadingProps) {
  return <Heading as="h1" fontSize={{ base: '24px', md: '28px' }} fontWeight="600" lineHeight="1.3" letterSpacing="-.03em" overflowWrap="anywhere" {...props} />
}

export function ActionButton(props: ButtonProps) {
  return <Button variant="outline" height="auto" border="1px solid var(--border)" borderRadius="6px" p="9px 14px" fontSize="13px" fontWeight="500" bg="transparent" color="var(--foreground)" _hover={{ opacity: 0.8 }} {...props} />
}

export function TextInput(props: InputProps) {
  return <Input height="auto" border="1px solid var(--border)" borderRadius="6px" p="9px 12px" bg="var(--background)" fontSize="13px" {...props} />
}

export function TextArea(props: TextareaProps) {
  return <Textarea border="1px solid var(--border)" borderRadius="6px" p="9px 12px" bg="var(--background)" fontSize="13px" resize="vertical" {...props} />
}

export function SelectInput(props: HTMLChakraProps<'select'>) {
  return <chakra.select border="1px solid var(--border)" borderRadius="6px" p="9px 12px" bg="var(--background)" fontSize="13px" width="100%" {...props} />
}

const StyledPageLink = chakra(Link, {
  base: { textDecoration: 'none', _hover: { color: 'var(--accent-ink)' } },
})

export function PageLink(props: ComponentProps<typeof StyledPageLink>) {
  return <StyledPageLink {...props} />
}

export function EmptyState(props: BoxProps) {
  return <Box p="40px 16px" textAlign="center" color="var(--muted)" fontSize="13px" {...props} />
}
