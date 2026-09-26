import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import type { CheckStorageIntegrity200 } from '../../api/generated/api.schemas'

export default function StorageCheckReport({ report }: { report: CheckStorageIntegrity200 }) {
  const fileCount = report.spaces.reduce((total, space) => total + space.filesChecked, 0)
  return <Box as="section" aria-label="Storage check results" mt="28px">
    <Heading as="h2" fontSize="18px" fontWeight="500" role="status">{report.status === 'ok' ? 'No issues found' : report.status === 'issues' ? 'Issues found' : 'Check incomplete'}</Heading>
    <Text mt="8px" fontSize="13px" color="var(--muted)" lineHeight="1.8">{report.mode === 'deep' ? 'Deep verification' : 'Basic check'} · {report.spaces.length} {report.spaces.length === 1 ? 'Space' : 'Spaces'} · {fileCount} {fileCount === 1 ? 'file' : 'files'} checked</Text>
    <Text mt="4px" fontSize="12px" color="var(--muted)">Finished {new Date(report.finishedAt).toLocaleString('en-US')}</Text>
    {report.status === 'incomplete' && <Text mt="12px" fontSize="13px" color="var(--muted)">Some content could not be verified. Review the findings and try a single Space.</Text>}
    {report.issues.length > 0 && <Box as="ul" listStyleType="none" m="0" mt="20px" p="0" border="1px solid var(--border)" borderRadius="8px">
      {report.issues.map((issue, index) => <Box as="li" key={index} p="16px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
        <Flex align="center" gap="10px" wrap="wrap"><Text fontSize="11px" textTransform="capitalize" color={issue.severity === 'error' ? 'fg.error' : 'var(--muted)'}>{issue.severity}</Text><Text fontSize="13px" fontWeight="500" overflowWrap="anywhere">{issue.code}</Text></Flex>
        <Text mt="6px" fontSize="13px" lineHeight="1.8">{issue.message}</Text>
        {(issue.spaceId || issue.key || issue.versionId || issue.path || issue.detail) && <Box as="dl" mt="8px" fontSize="12px" color="var(--muted)" lineHeight="1.8" overflowWrap="anywhere">
          {([['Space', issue.spaceId], ['Object', issue.key], ['Version', issue.versionId], ['Path', issue.path], ['Details', issue.detail]] as const).filter(([, value]) => value).map(([label, value]) => <Box key={label}><chakra.dt display="inline" fontWeight="500">{label}: </chakra.dt><chakra.dd display="inline" m="0" whiteSpace="pre-wrap">{value}</chakra.dd></Box>)}
        </Box>}
      </Box>)}
    </Box>}
  </Box>
}
