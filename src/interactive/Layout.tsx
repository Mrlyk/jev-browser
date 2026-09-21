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
        <Text color="cyan">开始使用</Text>
        <Text>/          查看所有命令</Text>
        <Text>/tab       切换操作标签页</Text>
        <Text>/connect   切换浏览器连接</Text>
        <Text>/exit      退出</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">浏览器</Text>
          <Text dimColor>默认连接已有 Chrome</Text>
          <Text dimColor>用一句话描述你要执行的操作</Text>
        </Box>
      </Box>
    </Box>
  </Box>;
}

export function Menu({ items, selected, title }: { items: Array<readonly [string, string]>; selected: number; title: string }) {
  const start = Math.max(0, selected - 4);
  return <Box flexDirection="column" paddingX={1}>
    <Text dimColor>{title} · ↑↓ 选择 · Enter 确定 · Esc 关闭</Text>
    {items.length ? items.slice(start, start + 6).map(([name, label], index) => <Text key={name} wrap="truncate-end"
      color={start + index === selected ? 'magentaBright' : undefined} bold={start + index === selected}>
      {start + index === selected ? '› ' : '  '}{clean(name)}  <Text dimColor>{clean(label)}</Text>
    </Text>) : <Text dimColor>暂无标签页，使用 /new 打开页面。</Text>}
  </Box>;
}

export function Footer({ state, session, width }: { state: import('./controller.js').ViewState; session: string; width: number }) {
  const tab = state.tabs.find(item => item.active);
  const connected = state.connection.startsWith('已连接');
  const connection = connected ? `${state.connection.includes('CDP') ? 'CDP' : state.connection.includes('本地') ? '本地' : '已连接'} · ${state.mode.replace('模式', '')}` : '未连接';
  const mode = width < 50 && connected ? connection.split(' · ')[0] : connection;
  const model = width < 50 ? state.model.split(' / ')[0] : state.model;
  return <Box width={width}>
    <Box maxWidth={Math.max(12, Math.floor(width * 0.38))} flexShrink={0}><Text color="magentaBright" wrap="truncate-end">{clean(model)}</Text></Box>
    <Box flexShrink={0}><Text dimColor> · </Text></Box>
    <Box flexShrink={1} minWidth={0}><Text color="cyan" wrap="truncate-end">{tab ? clean(`${tab.tabId} · ${tab.title || '无标题'}`) : '/tab 选择操作页'}</Text></Box>
    <Box flexShrink={0}><Text dimColor> · </Text></Box><Box flexShrink={0}><Text color={connected ? 'green' : 'gray'}>{mode}</Text></Box>
    {width >= 110 && <Box flexShrink={0}><Text dimColor> · {session}</Text></Box>}
  </Box>;
}
