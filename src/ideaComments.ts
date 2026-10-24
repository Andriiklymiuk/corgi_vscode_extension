import * as path from 'node:path';
import * as vscode from 'vscode';
import { runCorgi } from './corgiExec';
import { findQuote, IdeaComment, ideaSlugOf, ideasDir, isAgent, lineRangeOf, readIdea, statusLabel, waitsOnPerson } from './idea';
import { ideaAuthor, IdeaFilesWatcher, lastLine } from './ideaCli';

/**
 * The idea's comments as VS Code comment threads on idea.md, for the
 * person who edits the page as markdown. One thread per comment, on the
 * lines its words are on (page-level comments sit on the first line), the
 * replies under it, the status in the thread's label. The reply box runs
 * `corgi idea comment --reply-to`; a thread started from the gutter's +
 * becomes a comment on those lines (`--quote`). The threads are rebuilt
 * whenever the idea's files change.
 */
export class IdeaCommentThreads implements vscode.Disposable {
    private readonly controller: vscode.CommentController;
    private readonly threads = new Map<string, vscode.CommentThread[]>();
    private readonly info = new WeakMap<vscode.CommentThread, { slug: string; id: string }>();
    // comment ids are numbers in comments.json; the CLI takes them as text
    private readonly watcher: IdeaFilesWatcher;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly wrote = new vscode.EventEmitter<string>();
    /** Fires with the slug after this view wrote a comment through corgi, so a panel on it re-reads at once. */
    readonly onDidWrite = this.wrote.event;

    constructor(private readonly agentDir: string) {
        this.controller = vscode.comments.createCommentController('corgi.idea', 'corgi idea');
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: (document) => (this.slugOf(document) ? [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0)] : []),
        };
        this.controller.options = { prompt: 'Comment for the agent', placeHolder: 'What about these lines? The agent answers and amends the page.' };
        this.watcher = new IdeaFilesWatcher(agentDir).start();
        this.disposables.push(
            this.controller,
            this.watcher,
            this.watcher.onDidChange(() => this.rebuildAll()),
            vscode.workspace.onDidOpenTextDocument((d) => this.rebuild(d)),
            vscode.workspace.onDidSaveTextDocument((d) => this.rebuild(d)),
            vscode.workspace.onDidCloseTextDocument((d) => this.drop(d.uri)),
            vscode.commands.registerCommand('corgi.idea.replyThread', (reply: vscode.CommentReply) => this.reply(reply)),
            vscode.commands.registerCommand('corgi.idea.createThread', (reply: vscode.CommentReply) => this.reply(reply)),
            vscode.commands.registerCommand('corgi.idea.resolveThread', (thread: vscode.CommentThread) => this.setStatus(thread, 'resolve')),
            vscode.commands.registerCommand('corgi.idea.reopenThread', (thread: vscode.CommentThread) => this.setStatus(thread, 'reopen')),
        );
        this.rebuildAll();
    }

    private slugOf(document: vscode.TextDocument): string | undefined {
        return document.uri.scheme === 'file' ? ideaSlugOf(this.agentDir, document.uri.fsPath) : undefined;
    }

    private rebuildAll(): void {
        for (const d of vscode.workspace.textDocuments) {
            this.rebuild(d);
        }
    }

    private drop(uri: vscode.Uri): void {
        for (const t of this.threads.get(uri.toString()) ?? []) {
            t.dispose();
        }
        this.threads.delete(uri.toString());
    }

    /** The threads for document, from comments.json, placed by each comment's words in the text as it is now. */
    rebuild(document: vscode.TextDocument): void {
        const slug = this.slugOf(document);
        if (!slug) {
            return;
        }
        this.drop(document.uri);
        const idea = readIdea(ideasDir(this.agentDir), slug);
        if (!idea) {
            return;
        }
        const text = document.getText();
        const made: vscode.CommentThread[] = [];
        for (const c of idea.comments) {
            const hit = c.anchor ? findQuote(text, c.anchor) : null;
            const lines = hit ? lineRangeOf(text, hit.start, hit.end) : { startLine: 0, endLine: 0 };
            const range = new vscode.Range(lines.startLine, 0, lines.endLine, hit ? document.lineAt(Math.min(lines.endLine, document.lineCount - 1)).text.length : 0);
            const thread = this.controller.createCommentThread(document.uri, range, threadComments(c));
            thread.label = threadLabel(c, !!hit);
            thread.canReply = true;
            thread.contextValue = c.status === 'resolved' ? 'resolved' : 'open';
            thread.state = c.status === 'resolved' ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
            this.info.set(thread, { slug, id: String(c.id) });
            made.push(thread);
        }
        this.threads.set(document.uri.toString(), made);
    }

    /** The reply box: a reply on an existing thread, or a new comment on the lines of a thread the + started. */
    private async reply(reply: vscode.CommentReply): Promise<void> {
        const text = reply.text.trim();
        const thread = reply.thread;
        const known = this.info.get(thread);
        const slug = known?.slug ?? (thread.uri.scheme === 'file' ? ideaSlugOf(this.agentDir, thread.uri.fsPath) : undefined);
        if (!text || !slug) {
            return;
        }
        const args = ['idea', 'comment', slug, text, '--by', ideaAuthor(), '--json'];
        if (known) {
            args.push('--reply-to', known.id);
        } else {
            const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === thread.uri.toString());
            const at = thread.range;
            const quote = document && at ? document.getText(new vscode.Range(at.start.line, 0, at.end.line, document.lineAt(Math.min(at.end.line, document.lineCount - 1)).text.length)).trim() : '';
            if (quote) {
                args.push('--quote', quote);
            }
        }
        const r = await runCorgi(args);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not add the comment: ${lastLine(r)}`);
            return;
        }
        if (!known) {
            // The real thread comes from comments.json on the rebuild.
            thread.dispose();
        }
        this.afterWrite(slug, thread.uri);
    }

    private async setStatus(thread: vscode.CommentThread, verb: 'resolve' | 'reopen'): Promise<void> {
        const known = this.info.get(thread);
        if (!known) {
            return;
        }
        const r = await runCorgi(['idea', verb, known.slug, known.id, '--json']);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not ${verb} the comment: ${lastLine(r)}`);
            return;
        }
        this.afterWrite(known.slug, thread.uri);
    }

    private afterWrite(slug: string, uri: vscode.Uri): void {
        const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (document) {
            this.rebuild(document);
        }
        this.wrote.fire(slug);
    }

    dispose(): void {
        for (const list of this.threads.values()) {
            for (const t of list) {
                t.dispose();
            }
        }
        this.threads.clear();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.wrote.dispose();
    }
}

/** "open · proposal · reply to accept, resolve to dismiss"; "(words not on the page)" when the anchor is lost. */
export function threadLabel(c: IdeaComment, found: boolean): string {
    const bits = [statusLabel(c.status)];
    if (c.kind === 'proposal') {
        bits.push('proposal');
    }
    if (waitsOnPerson(c)) {
        bits.push('reply to accept, resolve to dismiss');
    }
    if (c.anchor?.quote && !found) {
        bits.push('words no longer on the page');
    }
    return bits.join(' · ');
}

function threadComments(c: IdeaComment): vscode.Comment[] {
    const one = (by: string, text: string, at: string | undefined, changed?: boolean, links?: string[], files?: { name: string }[]): vscode.Comment => {
        const body = new vscode.MarkdownString();
        body.appendText(text);
        for (const u of (links ?? []).filter((l) => /^https?:\/\//.test(l))) {
            body.appendText('\n');
            body.appendMarkdown(`[${u.replace(/[[\]]/g, '')}](${u})`);
        }
        if (files?.length) {
            body.appendText(`\n${files.map((f) => path.basename(f.name)).join(', ')}`);
        }
        const when = at ? new Date(at) : undefined;
        return {
            body,
            mode: vscode.CommentMode.Preview,
            author: { name: isAgent(by) ? '✦ agent' : by || '?' },
            label: changed ? 'changed the page' : undefined,
            timestamp: when && !Number.isNaN(when.getTime()) ? when : undefined,
        };
    };
    return [one(c.by, c.text, c.at, false, c.links, c.files), ...(c.replies ?? []).map((r) => one(r.by, r.text, r.at, r.changed, r.links, r.files))];
}
