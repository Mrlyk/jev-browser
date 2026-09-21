import { Box, Text } from 'ink';
import { clean } from './messages.js';

export function Welcome({ width }: { width: number }) {
  const wide = width >= 66;
  return <Box flexDirection="column" width={Math.min(width, 80)} marginBottom={1}>
    <Text dimColor>jevb v0.1.3</Text>
    <Box borderStyle="single" borderColor="gray" flexDirection={wide ? 'row' : 'column'} paddingX={1}>
      <Box width={wide ? 22 : undefined} flexDirection="column" alignItems={wide ? 'center' : 'flex-start'} paddingY={1}>
        <Text bold>Welcome to Jev</Text>
        {wide && <Box flexDirection="column" marginY={1}>
          <Text color="magentaBright">{'     █ █▀▀ █ █'}</Text>
          <Text color="magenta">{' █   █ █▀  █ █'}</Text>
          <Text color="cyan">{' ▀▀▀▀  ▀▀▀  ▀ '}</Text>
        </Box>}
        <Text dimColor>Your browser terminal</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} borderStyle={wide ? 'single' : undefined}
        borderTop={false} borderBottom={false} borderRight={false} borderColor="gray" paddingLeft={wide ? 2 : 0} paddingY={1}>
        <Text color="cyan">Getting started</Text>
        <Text>/          Browse commands</Text>
        <Text>/tab       Switch tabs</Text>
        <Text>/connect   Change connection</Text>
        <Text>/exit      Exit</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">Browser</Text>
          <Text dimColor>Connects to existing Chrome by default</Text>
          <Text dimColor>Describe a browser action in your own words</Text>
        </Box>
      </Box>
    </Box>
  </Box>;
}

export function Menu({ items, selected, title }: { items: Array<readonly [string, string]>; selected: number; title: string }) {
  const start = Math.max(0, selected - 4);
  return <Box flexDirection="column" paddingX={1}>
    <Text dimColor>{title} · ↑↓ Select · Enter Confirm · Esc Close</Text>
    {items.length ? items.slice(start, start + 6).map(([name, label], index) => <Text key={name} wrap="truncate-end"
      color={start + index === selected ? 'magentaBright' : undefined} bold={start + index === selected}>
      {start + index === selected ? '› ' : '  '}{clean(name)}  <Text dimColor>{clean(label)}</Text>
    </Text>) : <Text dimColor>No tabs. Use /new to open a page.</Text>}
  </Box>;
}

export function Footer({ state, session, width }: { state: import('./controller.js').ViewState; session: string; width: number }) {
  const tab = state.tabs.find(item => item.active);
  const connected = state.connection.startsWith('Connected');
  const connection = connected ? `${state.connection.includes('CDP') ? 'CDP' : state.connection.includes('Managed') ? 'Managed' : 'Connected'} · ${state.mode}` : 'Disconnected';
  const mode = width < 50 && connected ? connection.split(' · ')[0] : connection;
  const model = width < 50 ? state.model.split(' / ')[0] : state.model;
  return <Box width={width}>
    <Box maxWidth={Math.max(12, Math.floor(width * 0.38))} flexShrink={0}><Text color="magentaBright" wrap="truncate-end">{clean(model)}</Text></Box>
    <Box flexShrink={0}><Text dimColor> · </Text></Box>
    <Box flexShrink={1} minWidth={0}><Text color="cyan" wrap="truncate-end">{tab ? clean(`${tab.tabId} · ${tab.title || 'Untitled'}`) : '/tab Select a tab'}</Text></Box>
    <Box flexShrink={0}><Text dimColor> · </Text></Box><Box flexShrink={0}><Text color={connected ? 'green' : 'gray'}>{mode}</Text></Box>
    {width >= 110 && <Box flexShrink={0}><Text dimColor> · {session}</Text></Box>}
  </Box>;
}
