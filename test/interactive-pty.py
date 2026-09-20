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
    hook.write_text('''
import { Browser } from %s;
import { appendFileSync } from 'node:fs';
Browser.prototype.request = async function(args) {
  appendFileSync(%s, JSON.stringify(args) + '\\n');
  if (args[0] === 'session') return { active: true, runtime: { browserLaunched: true, connection: { kind: 'cdp', headless: null } } };
  if (args[0] === 'tab' && args[1] === 'list') return { tabs: [{ tabId:'t7', targetId:'target7', title:'中文测试页', url:'https://example.test', active:true }] };
  return {};
};
Browser.prototype.requestBatch = async function(commands) { return Promise.all(commands.map(args => this.request(args))); };
''' % (json.dumps((root / 'dist/browser.js').as_uri()), json.dumps(str(calls))))
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 100, 0, 0))
    env = dict(os.environ, TERM='xterm-256color', TYPESAFE_API_KEY='', OPENROUTER_API_KEY='',
               XDG_CONFIG_HOME=directory, NODE_OPTIONS='', JEV_BROWSER_RUNTIME_DIR=str(work / 'runtime'))
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
        wait_for('模型    未配置')
        # Chinese + combining character + grapheme deletion.
        send('中文e\u0301')
        send('\x7f')
        enter('输入')
        wait_for('你 › 中文输入')
        # Bracketed multiline paste must not execute any line.
        send('\x1b[200~/back\n/reload\x1b[201~')
        dispatched = [json.loads(line) for line in calls.read_text().splitlines()]
        assert ['back'] not in dispatched and ['reload'] not in dispatched
        send('\x15')  # Ctrl+U clears the draft.
        # Completion, command submission, and history.
        send('/sta')
        send('\t')
        send('\r')
        wait_for('你 › /status')
        send('\x1b[A')
        send('\r')
        read_for(0.3)
        assert rendered().count('你 › /status') >= 2
        # Action bar shares the slash-command handler.
        send('\t')
        send('\r')
        wait_for('已执行 /back')
        enter('/tabs')
        wait_for('t7 · 中文测试页 · https://example.test')
        send('\r')
        wait_for('已执行 /tab')
        # Resize a live terminal, then continue editing and exit.
        for width in (30, 120):
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, width, 0, 0))
            os.kill(process.pid, signal.SIGWINCH)
            read_for(0.2)
        enter('/quit')
        process.wait(timeout=8)
        read_for(0.2)
        assert process.returncode == 0
        assert termios.tcgetattr(slave) == original, 'raw mode was not restored'
        assert b'\x1b[?2004l' in output, 'bracketed paste mode was not restored'
        assert b'\x1b[?25h' in output, 'cursor was not restored'
        print(json.dumps({'passed': True, 'firstScreenMs': first_screen,
          'checks': ['bare entry', 'metadata', 'no key', 'Chinese and grapheme deletion', 'multiline paste',
                     'completion', 'history', 'action bar', 'tab selector', 'resize', 'terminal restoration']}, ensure_ascii=False))
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill()
        os.close(master)
        os.close(slave)
