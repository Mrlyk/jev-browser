"""Real PTY regression for the terminal renderer and input. Requires Python 3 on POSIX."""
import fcntl
import json
import os
import pathlib
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

root = pathlib.Path(__file__).resolve().parents[1]
ansi = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07')

with tempfile.TemporaryDirectory(prefix='jev-tui-pty-') as directory:
    work = pathlib.Path(directory)
    hook = work / 'browser.mjs'
    calls = work / 'calls.jsonl'
    controller_url = (root / 'dist/interactive/controller.js').as_uri()
    hook.write_text('''
import { Browser } from %s;
import { appendFileSync } from 'node:fs';
import { Controller } from %s;
const originalSubmit = Controller.prototype.submit;
Controller.prototype.submit = async function(value) {
  if (value === '测试确认') {
    this.state.pending = { plan: { operation: 'click', target: { name: '测试按钮' } }, choices: [] };
    this.emit('change'); return;
  }
  if (this.state.pending && ['确认', '取消'].includes(value)) {
    this.state.pending = undefined;
    this.log(value === '确认' ? '选择执行完成' : '选择取消完成'); return;
  }
  return originalSubmit.call(this, value);
};
Browser.prototype.request = async function(args) {
  appendFileSync(%s, JSON.stringify(args) + '\\n');
  if (args[0] === 'session') return { active: true, runtime: { browserLaunched: true, connection: { kind: 'cdp', headless: null } } };
  if (args[0] === 'tab' && args[1] === 'list') return { tabs: [{ tabId:'t7', targetId:'target7', title:'中文测试页', url:'https://example.test', active:true }] };
  return {};
};
Browser.prototype.requestBatch = async function(commands) { return Promise.all(commands.map(args => this.request(args))); };
''' % (json.dumps((root / 'dist/browser.js').as_uri()), json.dumps(controller_url), json.dumps(str(calls))))
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 100, 0, 0))
    env = dict(os.environ, TERM='xterm-256color', TYPESAFE_API_KEY='', OPENROUTER_API_KEY='',
               XDG_CONFIG_HOME=directory, NODE_OPTIONS='', JEV_BROWSER_RUNTIME_DIR=str(work / 'runtime'))
    env['FORCE_COLOR'] = '3'
    env.pop('NO_COLOR', None)
    process = subprocess.Popen(['node', '--import', str(hook), 'dist/cli.js'], cwd=root, env=env,
                               stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    output = bytearray()
    started = time.monotonic()

    def read_for(seconds):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([master], [], [], 0.05)[0]:
                try:
                    chunk = os.read(master, 65536)
                    if not chunk: break
                    output.extend(chunk)
                except OSError:
                    break

    def rendered():
        return ansi.sub('', output.decode('utf-8', errors='replace'))

    def wait_for(text):
        deadline = time.monotonic() + 8
        while text not in rendered() and time.monotonic() < deadline and process.poll() is None:
            read_for(0.05)
        assert text in rendered(), 'Missing %r in %s' % (text, rendered()[-3000:])

    def send(value):
        os.write(master, value.encode())
        read_for(0.15)

    def enter(value):
        send(value)
        send('\r')

    try:
        wait_for('输入一句话操作浏览器')
        first_screen = round((time.monotonic() - started) * 1000)
        wait_for('t7 · 中文测试页')
        wait_for('未配置')
        assert '[后退]' not in rendered()
        assert 'Welcome to Jev' in rendered()
        # Chinese + combining character + grapheme deletion.
        send('中文e\u0301')
        send('\x7f')
        enter('输入')
        wait_for(' 中文输入')
        assert '你 ›' not in rendered()
        assert re.search(r'(?m)^ 中文输入 +\r?$', rendered())
        assert any(color in output for color in [b'\x1b[48;2;232;232;232m', b'\x1b[48;5;254m'])
        # Bracketed multiline paste must not execute any line.
        send('\x1b[200~/back\n/reload\x1b[201~')
        dispatched = [json.loads(line) for line in calls.read_text().splitlines()]
        assert ['back'] not in dispatched and ['reload'] not in dispatched
        send('\x15')  # Ctrl+U clears the draft.
        # Completion, command submission, and history.
        send('/sta')
        send('\t')
        send('\r')
        wait_for(' /status')
        send('\x1b[A')
        send('\r')
        read_for(0.3)
        assert len(re.findall(r'(?m)^ /status +\r?$', rendered())) >= 2
        # Slash menu replaces the toolbar. Arrow selection invokes /go.
        send('/')
        wait_for('命令 · ↑↓ 选择')
        send('\x1b[B')
        send('\r')
        wait_for('已执行 /go')
        enter('/back')
        wait_for('已执行 /back')
        enter('/tab')
        wait_for('中文测试页 · https://example.test')
        send('\r')
        wait_for('已执行 /tab')
        enter('/connect')
        wait_for('连接已有 Chrome（默认）')
        send('\x1b[B')
        send('\r')
        wait_for('/connect cdp')
        send('\x15')
        # Confirmation is answered entirely with arrows and Enter.
        enter('测试确认')
        wait_for('执行此次操作')
        send('\x1b[B')
        send('\r')
        wait_for('选择取消完成')
        enter('测试确认')
        send('\r')
        wait_for('选择执行完成')
        assert '输入「确认」' not in rendered()
        # Resize a live terminal, then continue editing and exit.
        for width in (30, 120):
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, width, 0, 0))
            os.kill(process.pid, signal.SIGWINCH)
            read_for(0.2)
        enter('/exit')
        process.wait(timeout=8)
        read_for(0.2)
        assert process.returncode == 0
        assert termios.tcgetattr(slave) == original, 'raw mode was not restored'
        assert b'\x1b[?2004l' in output, 'bracketed paste mode was not restored'
        assert b'\x1b[?25h' in output, 'cursor was not restored'
        print(json.dumps({'passed': True, 'firstScreenMs': first_screen,
          'checks': ['bare entry', 'metadata', 'no key', 'Chinese and grapheme deletion', 'multiline paste',
                     'completion', 'history', 'slash menu', 'confirmation selector', 'connection selector', 'tab selector', 'resize', 'terminal restoration']}, ensure_ascii=False))
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill()
        os.close(master)
        os.close(slave)
