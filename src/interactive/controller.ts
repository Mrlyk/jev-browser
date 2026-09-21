import { EventEmitter } from 'node:events';
import { Browser, coreEnv } from '../browser.js';
import { JevError } from '../errors.js';
import { executePlan, prepareAct, validatePlan, type Plan } from '../semantic.js';
import { withSession } from '../session.js';
import { Models } from './models.js';
import { browserArgs, parseInteractive, type InteractiveOptions } from './options.js';
import { aliases, commandHelp, navigationCommand, parseCommand } from './commands.js';
import { clean, needsConfirmation, planMessage, targetLabel } from './messages.js';
import { describe } from '../questions.js';

export type Tab = { tabId: string; targetId: string; title: string; url: string; active: boolean };
type Pending = { plan: Plan; expires: number; choices: Array<{ ref: string; label: string }>; instruction: string; document?: number };
export type ViewState = { busy: boolean; phase: string; connection: string; mode: string; model: string;
  modelState: string; tabs: Tab[]; pending?: Pending; choosingTab: boolean; choosingBrowser: boolean;
  transcript: Array<{ id: number; text: string; role: 'user' | 'assistant' }>; revision: number; exited: boolean };
type Dependencies = { models?: Models; browser?: (options: InteractiveOptions, lifecycle: {
  signal: AbortSignal; onDispatch: () => void }) => Browser };

export class Controller extends EventEmitter {
  browserClosed = false;
  state: ViewState = { busy: false, phase: '', connection: 'Disconnected', mode: 'Unknown', model: 'Not configured', modelState: '',
    tabs: [], choosingTab: false, choosingBrowser: false, transcript: [], revision: 0, exited: false };
  private models: Models;
  private factory: NonNullable<Dependencies['browser']>;
  private request?: AbortController;
  private dispatched = false;
  private refreshing = false;
  private owned = false;
  private recent: Array<{ action: string; target?: string }> = [];
  private sequence = 0;
  private task?: Promise<void>;
  private stopping = false;
  private clarification?: string;
  get isBusy() { return this.state.busy || this.refreshing; }
  constructor(public options: InteractiveOptions, dependencies: Dependencies = {}) {
    super();
    this.models = dependencies.models ?? new Models();
    this.factory = dependencies.browser ?? ((options, lifecycle) => new Browser(browserArgs(options), coreEnv(), { ...lifecycle, interactive: true }));
    this.updateModel();
  }
  private emitState() { this.emit('change'); }
  private phase(text: string) { this.state.phase = text; this.emitState(); }
  log(text: string, role: 'user' | 'assistant' = 'assistant') {
    this.state.transcript = [...this.state.transcript, { id: ++this.sequence, text: clean(text), role }];
    // Keep the in-memory transcript bounded; Static has already printed earlier entries.
    if (this.state.transcript.length > 200) { this.state.transcript = this.state.transcript.slice(-1); this.state.revision++; }
    this.emitState();
  }
  private updateModel() {
    try { const config = this.models.config(this.options.provider); this.state.model = `${config.transport === 'typesafe' ? 'TypeSafe' : 'OpenRouter'} / ${config.model}`; this.state.modelState = 'Ready'; }
    catch { this.state.model = 'Not configured'; this.state.modelState = 'Run jevb auth login to configure a key'; }
  }
  private browser(signal: AbortSignal) {
    return this.factory(this.options, { signal, onDispatch: () => { this.dispatched = true; this.phase('Executing browser action…'); } });
  }
  private reset() { this.state.pending = undefined; this.clarification = undefined; this.recent = []; }
  private async refresh(browser: Browser) {
    const before = this.state.tabs.find(tab => tab.active);
    const info = await browser.request(['session', 'info']);
    if (!info.active || info.runtime?.browserLaunched === false) {
      this.state.connection = 'Disconnected'; this.state.mode = 'Unknown'; this.state.tabs = []; this.reset(); return;
    }
    const result = await browser.request(['tab', 'list']);
    const tabs: Tab[] = result.tabs ?? [];
    const after = tabs.find(tab => tab.active);
    if (after) {
      const [title, url, document] = await browser.requestBatch([['get', 'title'], ['get', 'url'], ['eval', 'performance.timeOrigin']]);
      if (typeof title?.title === 'string') after.title = title.title;
      if (typeof url?.url === 'string') after.url = url.url;
      if (this.state.pending?.document !== undefined && this.state.pending.document !== document?.result) {
        this.reset(); this.log('The page reloaded. Pending confirmation cancelled.');
      }
    }
    const connection = info.runtime?.connection;
    this.state.connection = connection?.kind === 'managed' ? 'Connected · Managed' : connection?.kind === 'cdp' ? 'Connected · CDP' : 'Connected · Unknown';
    this.state.mode = typeof connection?.headless === 'boolean' ? connection.headless ? 'Headless' : 'Headed' : 'Unknown';
    this.state.tabs = tabs;
    if (before && (!after || before.targetId !== after.targetId || before.url !== after.url)) {
      if (this.state.pending) this.log('The page or selected tab changed. Pending confirmation cancelled.');
      this.reset();
    }
    if (this.state.pending && Date.now() > this.state.pending.expires) { this.reset(); this.log('Confirmation expired. Enter the action again.'); }
  }
  async poll() {
    if (this.stopping || this.state.busy || this.refreshing) return;
    this.refreshing = true;
    const request = new AbortController(); this.request = request;
    const timer = setTimeout(() => request.abort(), 5000);
    try { await withSession(this.options.session, () => this.refresh(this.browser(request.signal))); }
    catch (error) {
      if (!(error instanceof JevError && error.code === 'SESSION_BUSY')) { this.state.connection = 'Disconnected · Use /connect to reconnect'; this.state.tabs = []; this.reset(); }
    } finally { clearTimeout(timer); if (this.request === request) this.request = undefined; this.refreshing = false; this.emitState(); }
  }
  async start() { return this.perform(async browser => {
    this.phase(this.options.autoConnect ? 'Connecting to Chrome… Allow the browser prompt if shown. Esc to cancel.' : 'Connecting to browser…');
    const info = await browser.request(['session', 'info']);
    this.owned = !info.active && !this.options.cdp && !this.options.autoConnect;
    await browser.request(['tab', 'list']);
    await this.refresh(browser);
    this.log('Describe a browser action. Type / for commands.');
  }); }
  private async perform(action: (browser: Browser, signal: AbortSignal) => Promise<void>) {
    if (this.state.busy || this.refreshing || this.stopping) { this.log('An action is running. Wait for it to finish before sending.'); return; }
    this.state.busy = true; this.dispatched = false;
    const request = new AbortController(); this.request = request; this.emitState();
    this.task = (async () => {
      try { await withSession(this.options.session, () => action(this.browser(request.signal), request.signal)); }
      catch (error) {
        const unknown = this.dispatched || error instanceof JevError && error.dispatched;
        if (request.signal.aborted) this.log(unknown ? 'Stopped further steps. The action may have been sent. Check the page before continuing.' : 'Cancelled. No browser action was sent.');
        else this.log(`${error instanceof Error ? error.message : 'Action failed.'}${unknown ? '\nOutcome unknown. Check the page; the action will not be replayed.' : ''}`);
      } finally {
        this.request = undefined; this.state.busy = false; this.state.phase = ''; this.emitState();
      }
    })();
    await this.task;
  }
  cancel() {
    if (this.state.busy || this.refreshing) this.request?.abort();
    this.state.pending = undefined; this.clarification = undefined;
    this.state.choosingTab = false; this.state.choosingBrowser = false; this.emitState();
  }
  async submit(raw: string) {
    const text = raw.trim(); if (!text || this.stopping) return;
    if (this.state.busy || this.refreshing) { this.log('An action is running. Wait for it to finish before sending.'); return; }
    const input = aliases[text] ?? text;
    if (/^\/(exit|quit)( --close)?$/.test(input)) { await this.shutdown(input.endsWith('--close')); return; }
    this.log(text, 'user');
    await this.perform(async (browser, signal) => {
      if (input.startsWith('/')) { await this.slash(input, browser); return; }
      if (this.state.pending && await this.answer(input, browser)) { await this.refresh(browser); return; }
      this.state.pending = undefined;
      const newAction = /^(?:请)?(?:点击|打开|填写|输入|搜索|勾选|取消勾选|读取|返回|刷新|滚动|click\b|open\b|fill\b|type\b|search\b|read\b)/i.test(input);
      const instruction = this.clarification && !newAction ? `${this.clarification}\n补充说明：${input}` : input;
      this.clarification = undefined;
      this.phase('Reading the page and identifying the target…');
      const document = await this.document(browser);
      const jev = await this.models.get(this.options.provider);
      this.updateModel(); this.state.modelState = 'Requesting'; this.emitState();
      jev.evidence.length = 0;
      let plan: Plan;
      try {
        plan = await prepareAct({ instruction, probability: 0.8, margin: 0.2, signal, interactive: true, recent: this.recent }, browser, jev);
        this.state.modelState = 'Last request succeeded';
      } catch (error) {
        this.state.modelState = signal.aborted ? 'Cancelled' : 'Last request failed';
        if (error instanceof JevError && ['NEEDS_INPUT', 'NO_MATCH', 'AMBIGUOUS', 'NEEDS_URL'].includes(error.code)) {
          this.clarification = instruction; this.log(`${error.message}\nSpecify the target or input text; use /reset to start over.`); return;
        }
        throw error;
      }
      signal.throwIfAborted();
      await this.guardDocument(browser, document);
      if (needsConfirmation(plan)) {
        await validatePlan(plan, browser);
        signal.throwIfAborted();
        const issue = plan.uncertainties.find(item => item.alternatives.some(choice => choice.ref));
        const choices = issue?.alternatives.filter(item => item.ref).map(item => {
          const target = plan.before.candidates.find(candidate => candidate.ref === item.ref);
          return { ref: item.ref!, label: target ? targetLabel(target) : item.label };
        }) ?? [];
        this.state.pending = { plan, choices, instruction, document, expires: Date.now() + 300_000 };
        this.log(`${planMessage(plan)}\n${choices.length > 1 ? 'Use ↑↓ to select a target, then Enter to confirm.' : 'Use ↑↓ to choose execute or cancel, then Enter to confirm.'}`);
      } else await this.execute(plan, browser);
      await this.refresh(browser);
    });
  }
  private async answer(input: string, browser: Browser): Promise<boolean> {
    const pending = this.state.pending!;
    if (Date.now() > pending.expires) { this.reset(); throw new JevError('EXPIRED', 'Confirmation expired. Enter the action again.'); }
    const match = /^(?:第)?([1-9]|一|二|三)(?:个)?$/.exec(input);
    if (pending.choices.length > 1 && match) {
      const index = /^[1-9]$/.test(match[1]) ? +match[1] - 1 : ['一', '二', '三'].indexOf(match[1]);
      const choice = pending.choices[index];
      if (!choice) { this.log('Select a target from the list.'); return true; }
      await this.guardDocument(browser, pending.document);
      pending.plan.target = pending.plan.before.candidates.find(candidate => candidate.ref === choice.ref);
      pending.plan.uncertainties = pending.plan.uncertainties.filter(issue => !issue.alternatives.some(item => item.ref));
      await validatePlan(pending.plan, browser);
      pending.choices = [];
      this.log(`${planMessage(pending.plan)}\nUse ↑↓ to choose execute or cancel, then Enter to confirm.`); return true;
    }
    if (/^(确认|是|y|yes)$/i.test(input)) {
      if (pending.choices.length > 1) { this.log('Select a target first.'); return true; }
      await this.guardDocument(browser, pending.document);
      this.state.pending = undefined; await this.execute(pending.plan, browser); return true;
    }
    if (/^(取消|否|n|no)$/i.test(input)) { this.state.pending = undefined; this.log('Cancelled.'); return true; }
    return false;
  }
  private async document(browser: Browser): Promise<number | undefined> {
    try { return (await browser.request(['eval', 'performance.timeOrigin']))?.result; }
    catch (error) {
      if (error instanceof JevError && error.message.startsWith('tab_gone:')) return;
      throw error;
    }
  }
  private async guardDocument(browser: Browser, expected?: number) {
    if (expected !== undefined && expected !== await this.document(browser)) {
      this.reset(); throw new JevError('STALE_TARGET', 'The page reloaded. Enter the action again.');
    }
  }
  private async execute(plan: Plan, browser: Browser) {
    this.phase('Checking the page and target…');
    const result = await executePlan(plan, browser, true);
    this.log(`Executed: ${planMessage(plan)}${plan.operation === 'get_text' ? `\n${JSON.stringify(result.data.result)}` : ''}`);
    this.recent = [...this.recent, { action: plan.operation, target: plan.target && describe(plan.target) }].slice(-5);
  }
  private async slash(input: string, browser: Browser) {
    const { name, value } = parseCommand(input);
    if (['help', 'status', 'clear', 'reset'].includes(name) && value) throw new JevError('INVALID_ARGUMENT', `/${name} takes no arguments.`);
    if (name === 'help') { this.log(commandHelp); return; }
    if (name === 'status') { await this.refresh(browser); this.log(JSON.stringify({ session: this.options.session,
      connection: this.state.connection, mode: this.state.mode, model: this.state.model, modelState: this.state.modelState,
      tab: this.state.tabs.find(tab => tab.active), transport: this.models.status() }, null, 2)); return; }
    if (name === 'clear') { this.state.transcript = []; this.state.revision++; return; }
    if (name === 'reset') { this.reset(); this.log('Action context reset.'); return; }
    if (name === 'provider') {
      if (!value) { this.log(`Current model: ${this.state.model}; /provider auto|typesafe|openrouter`); return; }
      if (!['auto', 'typesafe', 'openrouter'].includes(value)) throw new JevError('INVALID_ARGUMENT', 'Choose auto, typesafe, or openrouter.');
      this.reset(); this.options.provider = value as InteractiveOptions['provider']; this.updateModel(); this.log(`Model: ${this.state.model}`); return;
    }
    if (name === 'connect') {
      if (!value) { this.state.choosingBrowser = true; return; }
      // Reconnect after this operation releases the old session lock.
      const [kind, ...rest] = value.split(/\s+/); const target = rest.join(' ');
      const args = kind === 'session' ? ['--session', target] : kind === 'cdp' ? ['--cdp', target] :
        kind === 'auto' ? ['--auto-connect'] : kind === 'headless' ? ['--headless'] : kind === 'headed' ? ['--headed'] : undefined;
      if (!args || (['auto', 'headed', 'headless'].includes(kind) && target)) throw new JevError('INVALID_ARGUMENT', '/connect auto|headed|headless|cdp <address>|session <name>');
      this.nextConnection = parseInteractive([...args, '--model-provider', this.options.provider]);
      this.reset(); this.state.choosingBrowser = false; return;
    }
    if (name === 'tab' && !value) { await this.refresh(browser); this.state.choosingTab = true; return; }
    const command = navigationCommand(name, value);
    if (!command) throw new JevError('INVALID_ARGUMENT', `Invalid arguments for /${name}.`);
    this.reset(); this.state.choosingTab = false;
    await browser.request(command, { dispatch: true });
    this.log(`Executed /${name}.`); await this.refresh(browser);
  }
  private nextConnection?: InteractiveOptions;
  async reconnect() {
    if (!this.nextConnection || this.state.busy || this.stopping) return;
    this.options = this.nextConnection; this.nextConnection = undefined; this.state.tabs = [];
    await this.start();
  }
  async shutdown(closeBrowser = false) {
    if (this.stopping) return;
    if (closeBrowser && !this.owned) { this.log('Only browsers created here can be closed. Use /exit to leave this browser open.'); return; }
    this.stopping = true; this.request?.abort(); await this.task;
    if (closeBrowser) {
      try {
        await withSession(this.options.session, () => this.browser(AbortSignal.timeout(5000)).request(['close']));
        this.browserClosed = true;
      }
      catch { this.log('Closing did not complete. Check the session with jevb session inspect.'); }
    }
    await this.models.close(); this.state.exited = true; this.emitState();
  }
}
