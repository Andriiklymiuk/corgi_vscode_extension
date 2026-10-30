import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CorgiResult, runCorgi } from './corgiExec';
import { commentArgs, epicRef, IDEA_TYPES, IdeaDoc, IdeaListEntry, IdeaType, ideaCounts, ideaSlugOf, ideasDir, ideaStatusLabel, isSlug, mockHtml, newArgs, openCount, readIdea, selectionAnchor, sendTargets, SentLink, sentLabel, sourceSlugOf, typeDescriptions, typeLabel } from './idea';
import { onIdeasChanged } from './ideaCli';
import { fireIdeasChanged, ideaAuthor, IdeaFilesWatcher, ideaJSON, lastLine, SLOW_MS, WRITE_MS } from './ideaCli';
import { IdeaCommentThreads } from './ideaComments';
import { ideaPage } from './ideaHtml';
import { insideFolder } from './utils/insideFolder';

/**
 * An idea page beside the code. `corgi idea` keeps one markdown page per
 * thing you want built; people highlight words and comment, the agent
 * answers in the thread and amends the page, and "Build it" hands the page
 * over. This panel shows the page corgi rendered and the comments next to
 * it, acts through the `corgi idea` verbs, and re-reads whenever a file
 * under the idea changes - the agent answers on its own while the corgi
 * dashboard (`corgi agent up`) runs, so nothing here waits for it.
 */

type Message =
    | { type: 'ready' }
    | { type: 'comment'; text?: string; quote?: string; prefix?: string; suffix?: string; heading?: string; link?: string; files?: unknown }
    | { type: 'pickFiles' }
    | { type: 'reply'; id?: string | number; text?: string }
    | { type: 'status'; id?: string | number; status?: string }
    | { type: 'build' }
    | { type: 'send'; to?: string }
    | { type: 'openMarkdown' }
    | { type: 'openBrowser' }
    | { type: 'openLink'; url?: string }
    | { type: 'approve'; undo?: boolean }
    | { type: 'mock' }
    | { type: 'openMock' };

export class IdeaPanel {
    private static readonly open = new Map<string, IdeaPanel>();
    private readonly panel: vscode.WebviewPanel;
    private readonly watcher: IdeaFilesWatcher;
    private readonly ideaDir: string;
    private doc: IdeaDoc | undefined;
    private disposed = false;
    /** The number of the latest `corgi idea show`: an older one that lands later is dropped. */
    private seq = 0;
    /** Paths the person picked in the open dialog: the only ones a comment may attach. */
    private readonly picked = new Set<string>();

    static show(agentDir: string, slug: string, title?: string): void {
        if (!isSlug(slug)) {
            void vscode.window.showWarningMessage(`corgi: "${slug}" is not an idea slug.`);
            return;
        }
        const have = IdeaPanel.open.get(slug);
        if (have) {
            have.panel.reveal();
            return;
        }
        IdeaPanel.open.set(slug, new IdeaPanel(agentDir, slug, title));
    }

    /** The panel for slug when it is open: the comments view refreshes it after an edit. */
    static reload(slug: string): void {
        void IdeaPanel.open.get(slug)?.load();
    }

    private constructor(private readonly agentDir: string, private readonly slug: string, title?: string) {
        this.ideaDir = path.join(ideasDir(agentDir), slug);
        this.panel = vscode.window.createWebviewPanel('corgi.idea', `idea · ${title || slug}`, vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(this.ideaDir)],
        });
        this.panel.webview.html = ideaPage(crypto.randomBytes(16).toString('base64'), this.panel.webview.cspSource);
        this.panel.onDidDispose(() => this.dispose());
        this.panel.webview.onDidReceiveMessage((m: Message) => void this.onMessage(m));
        this.watcher = new IdeaFilesWatcher(agentDir, slug).start();
        this.watcher.onDidChange(() => {
            void this.load();
            fireIdeasChanged(slug);
        });
    }

    private post(m: unknown): void {
        if (!this.disposed) {
            void this.panel.webview.postMessage(m);
        }
    }

    private busy(what: string): void {
        this.post({ type: 'busy', what });
    }

    private error(msg: string): void {
        this.post({ type: 'error', msg });
    }

    /** Read the page as corgi renders it and send it over; the page draws it whole. */
    async load(): Promise<void> {
        if (this.disposed) {
            return;
        }
        const mine = ++this.seq;
        const r = await ideaJSON<IdeaDoc>(['show', this.slug, '--json']);
        if (this.disposed || mine !== this.seq) {
            return; // a newer read is on its way or landed already
        }
        if (!r.ok) {
            this.error(`corgi could not read the idea: ${r.why}`);
            return;
        }
        this.doc = r.value;
        this.panel.title = `idea · ${r.value.idea?.title || r.value.idea?.name || this.slug}`;
        this.post({ type: 'doc', doc: { ...this.withFileUris(r.value), me: ideaAuthor() } });
    }

    /** Attachments under the idea's files/ folder get a webview URI, so an image shows inline. */
    private withFileUris(doc: IdeaDoc): IdeaDoc {
        const fix = <T extends { files?: { path: string }[] }>(x: T): T => ({
            ...x,
            files: x.files?.map((f) => {
                const abs = path.isAbsolute(f.path) ? f.path : path.join(this.ideaDir, f.path);
                return insideFolder(this.ideaDir, abs) ? { ...f, uri: this.panel.webview.asWebviewUri(vscode.Uri.file(abs)).toString() } : f;
            }),
        });
        const filesBase = this.panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.ideaDir, 'files'))).toString();
        return { ...doc, filesBase, comments: (doc.comments ?? []).map((c) => ({ ...fix(c), replies: c.replies?.map(fix) })) };
    }

    /** A write through corgi: busy while it runs, a minute allowed (it notifies before it exits), then a re-read. */
    private async act(what: string, args: string[], failure: string): Promise<CorgiResult> {
        this.busy(what);
        const r = await runCorgi(args, undefined, WRITE_MS);
        if (!r.ok) {
            this.error(`${failure}: ${lastLine(r)}`);
        } else {
            fireIdeasChanged(this.slug);
        }
        this.busy('');
        await this.load();
        return r;
    }

    private async onMessage(m: Message): Promise<void> {
        switch (m.type) {
            case 'ready':
                await this.load();
                return;
            case 'comment': {
                const text = (m.text ?? '').trim();
                if (!text) {
                    return;
                }
                const files = (Array.isArray(m.files) ? m.files : []).filter((f): f is string => typeof f === 'string' && this.picked.has(f));
                const args = commentArgs({
                    slug: this.slug, text, by: ideaAuthor(),
                    anchor: m.quote?.trim() ? { quote: m.quote, prefix: m.prefix || undefined, suffix: m.suffix || undefined, heading: m.heading || undefined } : undefined,
                    links: m.link ? [m.link] : [],
                    files,
                });
                await this.act('sending your comment…', args, 'corgi could not add the comment');
                for (const f of files) {
                    this.picked.delete(f);
                }
                return;
            }
            case 'pickFiles': {
                const uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, openLabel: 'Attach to the comment' });
                const files = (uris ?? []).filter((u) => u.scheme === 'file').map((u) => ({ path: u.fsPath, name: path.basename(u.fsPath) }));
                for (const f of files) {
                    this.picked.add(f.path);
                }
                this.post({ type: 'picked', files });
                return;
            }
            case 'reply': {
                const text = (m.text ?? '').trim();
                if (!text || m.id === undefined || m.id === '') {
                    return;
                }
                await this.act('sending your reply…', commentArgs({ slug: this.slug, text, by: ideaAuthor(), replyTo: m.id }), 'corgi could not add the reply');
                return;
            }
            case 'status':
                if (m.id !== undefined && m.id !== '' && (m.status === 'resolved' || m.status === 'open')) {
                    await this.act(m.status === 'resolved' ? 'resolving…' : 'reopening…', ['idea', m.status === 'resolved' ? 'resolve' : 'reopen', '--json', '--', this.slug, String(m.id)], 'corgi could not change the comment');
                }
                return;
            case 'send':
                if (m.to === 'jira' || m.to === 'linear' || m.to === 'confluence') {
                    await sendIdea(this.slug, m.to, this.doc);
                    await this.load();
                }
                return;
            case 'build':
                await buildIdea(this.slug, this.doc?.idea?.title);
                await this.load();
                return;
            case 'openMarkdown':
                await openIdeaMarkdown(this.agentDir, this.slug, this.doc?.file);
                return;
            case 'openBrowser': {
                const r = await ideaJSON<{ link?: string }>(['open', this.slug, '--print', '--json']);
                if (!r.ok) {
                    void vscode.window.showWarningMessage(`corgi could not open the page in the browser (is the dashboard up? corgi agent up): ${r.why}`);
                    return;
                }
                if (r.value.link && /^https?:\/\//.test(r.value.link)) {
                    await vscode.env.openExternal(vscode.Uri.parse(r.value.link));
                }
                return;
            }
            case 'openLink':
                if (typeof m.url === 'string' && /^https?:\/\//.test(m.url)) {
                    await vscode.env.openExternal(vscode.Uri.parse(m.url));
                }
                return;
            case 'approve':
                await this.act(m.undo ? 'taking your sign-off back…' : 'signing it off…', ['idea', 'approve', '--json', '--by', ideaAuthor(), ...(m.undo ? ['--undo'] : []), '--', this.slug], 'corgi could not sign it off');
                return;
            case 'mock':
                await drawMock(this.slug, this.doc?.idea?.title);
                await this.load();
                return;
            case 'openMock':
                openMock(this.ideaDir, this.doc?.idea?.title || this.slug);
                return;
        }
    }

    private dispose(): void {
        this.disposed = true;
        this.watcher.dispose();
        IdeaPanel.open.delete(this.slug);
    }
}

/** The agent draws the page's screens as one clickable HTML file: a minute or two, under a progress notification. */
async function drawMock(slug: string, title?: string): Promise<void> {
    const name = title || slug;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `corgi: drawing the mockup of "${name}"…` }, async () => {
        const r = await ideaJSON<{ mock?: string }>(['mock', slug, '--json'], 11 * 60_000);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not draw the mockup: ${r.why}`);
            return;
        }
        fireIdeasChanged(slug);
    });
}

function openMock(ideaDir: string, title: string): void {
    let html: string;
    try {
        html = fs.readFileSync(path.join(ideaDir, 'files', 'mock.html'), 'utf8');
    } catch {
        void vscode.window.showInformationMessage('No mockup yet: press "Show me" on the page.');
        return;
    }
    const panel = vscode.window.createWebviewPanel('corgi.ideaMock', `mockup · ${title}`, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
    panel.webview.html = mockHtml(html);
}

/** Hand the page to the agent: it plans the work and starts; minutes, under a progress notification. */
export async function buildIdea(slug: string, title?: string): Promise<void> {
    const name = title || slug;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `corgi: handing "${name}" to the agent…` }, async () => {
        const r = await ideaJSON<{ plan?: { ref?: string } | null; tasks?: unknown[]; running?: boolean; why?: string }>(['build', slug, '--json'], SLOW_MS);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not build "${name}": ${r.why}`);
            return;
        }
        if (r.value.why) {
            void vscode.window.showInformationMessage(`corgi did not start building "${name}": ${r.value.why}`);
            return;
        }
        const tasks = Array.isArray(r.value.tasks) ? r.value.tasks.length : 0;
        const plan = r.value.plan?.ref ? ` as plan ${r.value.plan.ref}` : '';
        void vscode.window.showInformationMessage(`corgi is building "${name}"${plan}${tasks ? `: ${tasks} task${tasks === 1 ? '' : 's'}` : ''}${r.value.running ? ', a session is on it' : ''}.`);
    });
}

/** Send the page somewhere with credentials: an epic and its tickets in Jira or Linear, a page in Confluence. */
export async function sendIdea(slug: string, to: 'jira' | 'linear' | 'confluence', doc: IdeaDoc | undefined): Promise<void> {
    const target = sendTargets(doc?.send).find((t) => t.to === to);
    if (!target) {
        void vscode.window.showWarningMessage(`corgi has no ${to} credentials for this page.`);
        return;
    }
    const name = doc?.idea?.title || doc?.idea?.name || slug;
    const tickets = doc?.tickets?.length ? doc.tickets : doc?.idea?.tickets ?? [];
    let key = target.project;
    if (to === 'confluence') {
        key = (await vscode.window.showInputBox({ prompt: `Confluence space key for "${name}"${target.site ? ` on ${target.site}` : ''}`, placeHolder: 'DOCS', ignoreFocusOut: true }))?.trim() ?? '';
    } else if (!key) {
        key = (await vscode.window.showInputBox({ prompt: to === 'jira' ? `Jira project key for "${name}"${target.site ? ` on ${target.site}` : ''}` : `Linear team key for "${name}"`, placeHolder: to === 'jira' ? 'SHOP' : 'ENG', ignoreFocusOut: true }))?.trim() ?? '';
    }
    if (!key) {
        return;
    }
    const detail = to === 'confluence'
        ? `A page will be created in ${key}.`
        : `An epic and ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} will be created in ${key}.`;
    const ok = await vscode.window.showWarningMessage(`Send "${name}" to ${to}?`, { modal: true, detail }, 'Send');
    if (ok !== 'Send') {
        return;
    }
    const args = ['send', slug, '--to', to, to === 'confluence' ? '--space' : '--project', key, '--json'];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `corgi: sending "${name}" to ${to}…` }, async () => {
        const r = await ideaJSON<{ sent?: SentLink[] }>(args, SLOW_MS);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not send it to ${to}: ${r.why}`);
            return;
        }
        const first = (r.value.sent ?? []).find((l) => l && (l.ref || l.title || l.url));
        if (!first) {
            void vscode.window.showInformationMessage(`corgi sent "${name}" to ${to}.`);
            return;
        }
        const url = first.url && /^https?:\/\//.test(first.url) ? first.url : '';
        const choice = await vscode.window.showInformationMessage(`corgi sent "${name}" to ${to}: ${sentLabel(first)}`, ...(url ? ['Open'] : []));
        if (choice === 'Open' && url) {
            await vscode.env.openExternal(vscode.Uri.parse(url));
        }
    });
}

/** The page's type, picked: idea by default. */
export async function pickType(placeHolder = 'What kind of page is it?'): Promise<IdeaType | undefined> {
    const pick = await vscode.window.showQuickPick(
        IDEA_TYPES.map((t) => ({ label: typeLabel(t), description: typeDescriptions[t], type: t, picked: t === 'idea' })),
        { placeHolder, ignoreFocusOut: true },
    );
    return pick?.type;
}

/** `corgi idea new`: the agent writes the page, under a progress notification, then the panel opens on it. */
async function writeIdea(agentDir: string, args: string[]): Promise<void> {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'corgi: the agent is writing the idea page…' }, async () => {
        const r = await ideaJSON<{ idea?: { slug?: string; title?: string } }>(args.slice(1), SLOW_MS);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not write the page: ${r.why}`);
            return;
        }
        const slug = r.value.idea?.slug;
        if (!slug) {
            void vscode.window.showWarningMessage('corgi wrote no page.');
            return;
        }
        fireIdeasChanged(slug);
        IdeaPanel.show(agentDir, slug, r.value.idea?.title);
    });
}

/** A new page from a sentence and a type. */
export async function newIdea(agentDir: string): Promise<void> {
    const text = await vscode.window.showInputBox({ prompt: 'What do you want built? One sentence; the agent writes the page.', placeHolder: 'a scheduling app for a coffee shop', ignoreFocusOut: true });
    if (!text?.trim()) {
        return;
    }
    const type = await pickType();
    if (!type) {
        return;
    }
    await writeIdea(agentDir, newArgs(text.trim(), type));
}

/** The markdown in front of you kept as an idea page: `corgi idea new --from <file>`. */
interface Shared {
    slug: string;
    name?: string;
    link?: string;
    public?: boolean;
    hint?: string;
}

/** The markdown file in front (or the one clicked) as a page, word for word: no agent run, the same page each time. */
async function shareMarkdown(uri?: vscode.Uri): Promise<Shared | undefined> {
    const target = uri?.scheme === 'file' ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== 'file' || !/\.(md|markdown)$/i.test(target.fsPath)) {
        void vscode.window.showInformationMessage('Open a markdown file first.');
        return undefined;
    }
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target.toString());
    if (open?.isDirty) {
        await open.save();
    }
    const r = await ideaJSON<Shared>(['share', target.fsPath, '--json', '--no-copy']);
    if (!r.ok) {
        void vscode.window.showWarningMessage(`corgi could not share it: ${r.why}`);
        return undefined;
    }
    fireIdeasChanged(r.value.slug);
    return r.value;
}

export async function ideaFromFile(agentDir: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file' || (editor.document.languageId !== 'markdown' && !/\.(md|markdown)$/i.test(editor.document.fileName))) {
        void vscode.window.showInformationMessage('Open the markdown file to keep as an idea page first.');
        return;
    }
    if (editor.document.isDirty) {
        await editor.document.save();
    }
    const type = await pickType(`Keep ${path.basename(editor.document.fileName)} as which kind of page?`);
    if (!type) {
        return;
    }
    await writeIdea(agentDir, newArgs('', type, editor.document.fileName));
}

interface IdeaPick extends vscode.QuickPickItem {
    idea: IdeaListEntry;
}

/** One idea from `corgi idea list`, by name, with what waits on whom. */
export async function pickIdea(placeHolder: string): Promise<IdeaListEntry | undefined> {
    const r = await ideaJSON<{ ideas?: IdeaListEntry[] }>(['list', '--json']);
    if (!r.ok) {
        void vscode.window.showWarningMessage(`corgi could not list the ideas: ${r.why}`);
        return undefined;
    }
    const ideas = (r.value.ideas ?? []).filter((i) => i && isSlug(i.slug ?? ''));
    if (!ideas.length) {
        const go = await vscode.window.showInformationMessage('No idea pages yet.', 'New idea page…');
        if (go) {
            await vscode.commands.executeCommand('corgi.idea.new');
        }
        return undefined;
    }
    const icon = (i: IdeaListEntry) => (i.status === 'building' ? '$(pulse) ' : i.status === 'built' ? '$(check) ' : '$(lightbulb) ');
    const items: IdeaPick[] = ideas.map((i) => ({
        label: `${icon(i)}${i.name || i.title || i.slug}`,
        description: [typeLabel(i.type), ideaStatusLabel(i.status), ideaCounts(i.open ?? 0, i.forAgent ?? 0), epicRef(i.sent) ? `epic ${epicRef(i.sent)}` : ''].filter(Boolean).join(' · '),
        detail: i.summary,
        idea: i,
    }));
    const pick = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true, matchOnDetail: true });
    return pick?.idea;
}

/** The page's markdown in a normal editor; the comment threads show there. */
export async function openIdeaMarkdown(agentDir: string, slug: string, file?: string): Promise<void> {
    let target = file;
    if (!target) {
        const r = await ideaJSON<{ file?: string }>(['path', slug, '--json']);
        target = r.ok && r.value.file ? r.value.file : path.join(ideasDir(agentDir), slug, 'idea.md');
    }
    try {
        await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: false });
    } catch {
        void vscode.window.showWarningMessage(`corgi: the page is not at ${target}.`);
    }
}

/** A sidebar row or a slug: what the idea commands take. */
export type IdeaArg = { kind: 'idea'; slug: string; file?: string } | string | undefined;

function slugOf(arg: IdeaArg): string | undefined {
    const slug = typeof arg === 'string' ? arg : arg?.kind === 'idea' ? arg.slug : undefined;
    return slug && isSlug(slug) ? slug : undefined;
}

export function registerIdeas(context: vscode.ExtensionContext, agentDir: string): void {
    const threads = new IdeaCommentThreads(agentDir);
    const pickSlug = async (arg: IdeaArg, placeHolder: string) => slugOf(arg) ?? (await pickIdea(placeHolder))?.slug;
    context.subscriptions.push(
        threads,
        threads.onDidWrite((slug) => IdeaPanel.reload(slug)),
        vscode.commands.registerCommand('corgi.idea.new', () => newIdea(agentDir)),
        vscode.commands.registerCommand('corgi.idea.fromFile', () => ideaFromFile(agentDir)),
        vscode.commands.registerCommand('corgi.idea.preview', async (uri?: vscode.Uri) => {
            const shared = await shareMarkdown(uri);
            if (shared) {
                IdeaPanel.show(agentDir, shared.slug, shared.name);
            }
        }),
        vscode.commands.registerCommand('corgi.idea.shareFile', async (uri?: vscode.Uri) => {
            const shared = await shareMarkdown(uri);
            if (!shared?.link) {
                if (shared) {
                    void vscode.window.showWarningMessage(shared.hint || 'No link yet - corgi agent up first.');
                }
                return;
            }
            await vscode.env.clipboard.writeText(shared.link);
            const note = shared.public ? 'Link copied - anyone with it reads and comments; the agent answers.' : 'Copied, but the link works on this Mac only - corgi agent up gives it a public address.';
            const go = await vscode.window.showInformationMessage(note, 'Open in Corgi Preview');
            if (go) {
                IdeaPanel.show(agentDir, shared.slug, shared.name);
            }
        }),
        vscode.commands.registerCommand('corgi.idea.open', async (arg?: IdeaArg) => {
            const slug = await pickSlug(arg, 'Idea page to open beside the code');
            if (slug) {
                IdeaPanel.show(agentDir, slug);
            }
        }),
        vscode.commands.registerCommand('corgi.idea.openMarkdown', async (arg?: IdeaArg) => {
            // The list already said where the file is: no `corgi idea path` for a row.
            const file = typeof arg === 'object' && arg?.kind === 'idea' && typeof arg.file === 'string' ? arg.file : undefined;
            const slug = await pickSlug(arg, 'Idea page to edit as markdown');
            if (slug) {
                await openIdeaMarkdown(agentDir, slug, file);
            }
        }),
        vscode.commands.registerCommand('corgi.idea.build', async (arg?: IdeaArg) => {
            const slug = await pickSlug(arg, 'Idea page to hand to the agent');
            if (slug) {
                await buildIdea(slug);
                IdeaPanel.reload(slug);
            }
        }),
        // Words selected in any markdown file: a comment on them, like a highlight on the page. A file
        // that is not a page yet becomes one (word for word, no agent run), so the team sees the comment too.
        vscode.commands.registerCommand('corgi.idea.commentSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            const file = editor && editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
            if (!editor || !file || (editor.document.languageId !== 'markdown' && !/\.(md|markdown)$/i.test(file))) {
                void vscode.window.showInformationMessage('Open a markdown file and select the words to comment on.');
                return;
            }
            // corgi reads the file: the saved text is what the anchor must match.
            if (editor.document.isDirty) {
                await editor.document.save();
            }
            const slug = ideaSlugOf(agentDir, file) ?? (await shareMarkdown(editor.document.uri))?.slug;
            if (!slug) {
                return;
            }
            const text = editor.document.getText();
            const found = editor.selection.isEmpty ? undefined : selectionAnchor(text, editor.document.offsetAt(editor.selection.start), editor.document.offsetAt(editor.selection.end));
            const anchor = found?.quote ? found : undefined;
            const words = await vscode.window.showInputBox({ prompt: anchor ? `Comment on "${anchor.quote.trim().slice(0, 60)}"` : 'Comment on the whole page', placeHolder: 'What about this? The agent answers and amends the page.', ignoreFocusOut: true });
            if (!words?.trim()) {
                return;
            }
            const r = await runCorgi(commentArgs({ slug, text: words.trim(), by: ideaAuthor(), anchor }), undefined, WRITE_MS);
            if (!r.ok) {
                void vscode.window.showWarningMessage(`corgi could not add the comment: ${lastLine(r)}`);
                return;
            }
            threads.rebuild(editor.document, true);
            IdeaPanel.reload(slug);
            fireIdeasChanged(slug);
        }),
        vscode.commands.registerCommand('corgi.idea.previewHere', async () => {
            const editor = vscode.window.activeTextEditor;
            const slug = editor?.document.uri.scheme === 'file' ? ideaSlugOf(agentDir, editor.document.uri.fsPath) : undefined;
            if (slug) {
                IdeaPanel.show(agentDir, slug);
                return;
            }
            await vscode.commands.executeCommand('corgi.idea.preview', editor?.document.uri);
        }),
        commentsStatus(agentDir),
    );
}

/** The comments on the markdown file in front, in the status bar: a click opens the preview. */
function commentsStatus(agentDir: string): vscode.Disposable {
    const bar = vscode.window.createStatusBarItem('corgi.idea.comments', vscode.StatusBarAlignment.Right, 90);
    bar.name = 'Corgi: comments on this markdown';
    bar.command = 'corgi.idea.previewHere';
    const refresh = () => {
        const doc = vscode.window.activeTextEditor?.document;
        const file = doc?.uri.scheme === 'file' ? doc.uri.fsPath : '';
        if (!doc || !file || (doc.languageId !== 'markdown' && !/\.(md|markdown)$/i.test(file))) {
            bar.hide();
            return;
        }
        const slug = ideaSlugOf(agentDir, file) ?? sourceSlugOf(agentDir, file);
        const idea = slug ? readIdea(ideasDir(agentDir), slug) : undefined;
        if (!idea) {
            bar.text = '$(comment-discussion) Comment';
            bar.tooltip = 'Open in Corgi Preview: the team highlights words and comments, the agent answers and fixes the file';
        } else {
            const open = openCount(idea.comments);
            const status = idea.meta.status === 'draft' ? '' : ` · ${ideaStatusLabel(idea.meta.status)}`;
            bar.text = `$(comment-discussion) ${open ? `${open} open` : 'no open comments'}${status}`;
            bar.tooltip = `${idea.meta.name || idea.meta.title}: open in Corgi Preview`;
        }
        bar.show();
    };
    refresh();
    return vscode.Disposable.from(
        bar,
        vscode.window.onDidChangeActiveTextEditor(refresh),
        vscode.workspace.onDidSaveTextDocument(refresh),
        onIdeasChanged(refresh),
    );
}
