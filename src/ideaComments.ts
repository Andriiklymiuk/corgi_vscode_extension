import * as path from 'node:path';
import * as vscode from 'vscode';
import { runCorgi } from './corgiExec';
import { commentArgs, findQuote, IdeaComment, ideaSlugOf, ideasDir, isAgent, lineRangeOf, readIdea, selectionAnchor, sourceSlugOf, statusLabel, waitsOnPerson } from './idea';
import { fireIdeasChanged, ideaAuthor, IdeaFilesWatcher, ideaStamp, lastLine, WRITE_MS } from './ideaCli';

/**
 * The idea's comments as VS Code comment threads on idea.md, for the
 * person who edits the page as markdown. One thread per comment, on the
 * lines its words are on (page-level comments sit on the first line), the
 * replies under it, the status in the thread's label. The reply box runs
 * `corgi idea comment --reply-to`; a thread started from the gutter's +
 * becomes a comment on those lines, anchored like a highlight on the page.
 *
 * When the idea's files change the threads are updated in place, by
 * comment id - a thread keeps its fold and the reply being typed in it;
 * only what appeared or disappeared is created or disposed. A change to
 * another idea, or none to this one's files, touches nothing. The watcher
 * runs only while an idea.md is open.
 */
export class IdeaCommentThreads implements vscode.Disposable {
    private readonly controller: vscode.CommentController;
    /** Per open document: its slug, the mtime stamp its threads were built from, and the threads by comment id. */
    private readonly docs = new Map<string, { slug: string; stamp: number; byId: Map<string, vscode.CommentThread> }>();
    private readonly info = new WeakMap<vscode.CommentThread, { slug: string; id: string }>();
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
        this.watcher = new IdeaFilesWatcher(agentDir);
        this.disposables.push(
            this.controller,
            this.watcher,
            this.watcher.onDidChange((slug) => this.changed(slug)),
            vscode.workspace.onDidOpenTextDocument((d) => this.opened(d)),
            vscode.workspace.onDidSaveTextDocument((d) => this.rebuild(d, true)),
            vscode.workspace.onDidCloseTextDocument((d) => this.closed(d)),
            vscode.commands.registerCommand('corgi.idea.replyThread', (reply: vscode.CommentReply) => this.reply(reply)),
            vscode.commands.registerCommand('corgi.idea.createThread', (reply: vscode.CommentReply) => this.reply(reply)),
            vscode.commands.registerCommand('corgi.idea.resolveThread', (thread: vscode.CommentThread) => this.setStatus(thread, 'resolve')),
            vscode.commands.registerCommand('corgi.idea.reopenThread', (thread: vscode.CommentThread) => this.setStatus(thread, 'reopen')),
        );
        for (const d of vscode.workspace.textDocuments) {
            this.opened(d);
        }
    }

    private slugOf(document: vscode.TextDocument): string | undefined {
        if (document.uri.scheme !== 'file') {
            return undefined;
        }
        return ideaSlugOf(this.agentDir, document.uri.fsPath) ?? sourceSlugOf(this.agentDir, document.uri.fsPath);
    }

    /** An idea.md opened: its threads, and the watcher if it was the first. */
    private opened(document: vscode.TextDocument): void {
        if (!this.slugOf(document)) {
            return;
        }
        this.rebuild(document, true);
        this.watcher.start();
    }

    /** The last idea.md closed: the watcher stops. */
    private closed(document: vscode.TextDocument): void {
        this.drop(document.uri);
        if (!this.docs.size) {
            this.watcher.stop();
        }
    }

    /** The files moved: the documents of that slug (all of them when unknown), each skipping itself when its stamp is unchanged. */
    private changed(slug: string | undefined): void {
        for (const [key, entry] of this.docs) {
            if (slug && entry.slug !== slug) {
                continue;
            }
            const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
            if (document) {
                this.rebuild(document, false);
            }
        }
    }

    private drop(uri: vscode.Uri): void {
        for (const t of this.docs.get(uri.toString())?.byId.values() ?? []) {
            t.dispose();
        }
        this.docs.delete(uri.toString());
    }

    /**
     * The threads for document from comments.json, by comment id: an
     * existing thread gets its range, comments, label and state set again;
     * a new comment gets a thread; a gone one loses it. Nothing happens when
     * the idea's files have not changed since the last build, unless forced.
     */
    rebuild(document: vscode.TextDocument, force: boolean): void {
        const slug = this.slugOf(document);
        if (!slug) {
            return;
        }
        const key = document.uri.toString();
        const stamp = ideaStamp(this.agentDir, slug);
        const entry = this.docs.get(key);
        if (!force && entry && entry.stamp === stamp) {
            return;
        }
        const idea = readIdea(ideasDir(this.agentDir), slug);
        if (!idea) {
            this.drop(document.uri);
            return;
        }
        const text = document.getText();
        const byId = entry?.byId ?? new Map<string, vscode.CommentThread>();
        const seen = new Set<string>();
        for (const c of idea.comments) {
            const id = String(c.id);
            seen.add(id);
            const hit = c.anchor ? findQuote(text, c.anchor) : null;
            const lines = hit ? lineRangeOf(text, hit.start, hit.end) : { startLine: 0, endLine: 0 };
            const range = new vscode.Range(lines.startLine, 0, lines.endLine, hit ? document.lineAt(Math.min(lines.endLine, document.lineCount - 1)).text.length : 0);
            const comments = threadComments(c);
            const label = threadLabel(c, !!hit);
            const contextValue = c.status === 'resolved' ? 'resolved' : 'open';
            const state = c.status === 'resolved' ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
            const have = byId.get(id);
            if (have) {
                if (!have.range?.isEqual(range)) {
                    have.range = range;
                }
                have.comments = comments;
                have.label = label;
                have.contextValue = contextValue;
                have.state = state;
                continue;
            }
            const thread = this.controller.createCommentThread(document.uri, range, comments);
            thread.label = label;
            thread.canReply = true;
            thread.contextValue = contextValue;
            thread.state = state;
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
            this.info.set(thread, { slug, id });
            byId.set(id, thread);
        }
        for (const [id, t] of byId) {
            if (!seen.has(id)) {
                t.dispose();
                byId.delete(id);
            }
        }
        this.docs.set(key, { slug, stamp, byId });
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
        const by = ideaAuthor();
        let args: string[];
        if (known) {
            args = commentArgs({ slug, text, by, replyTo: known.id });
        } else {
            // The words on those lines, from the saved text: corgi reads the file, not the editor.
            const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === thread.uri.toString());
            if (document?.isDirty) {
                await document.save();
            }
            const at = thread.range;
            const anchor = document && at
                ? selectionAnchor(document.getText(), document.offsetAt(new vscode.Position(at.start.line, 0)), document.offsetAt(new vscode.Position(at.end.line, document.lineAt(Math.min(at.end.line, document.lineCount - 1)).text.length)))
                : undefined;
            args = commentArgs({ slug, text, by, anchor: anchor?.quote ? anchor : undefined });
        }
        const r = await runCorgi(args, undefined, WRITE_MS);
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
        const r = await runCorgi(['idea', verb, '--json', '--', known.slug, known.id], undefined, WRITE_MS);
        if (!r.ok) {
            void vscode.window.showWarningMessage(`corgi could not ${verb} the comment: ${lastLine(r)}`);
            return;
        }
        this.afterWrite(known.slug, thread.uri);
    }

    private afterWrite(slug: string, uri: vscode.Uri): void {
        const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        if (document) {
            this.rebuild(document, true);
        }
        this.wrote.fire(slug);
        fireIdeasChanged(slug);
    }

    dispose(): void {
        for (const entry of this.docs.values()) {
            for (const t of entry.byId.values()) {
                t.dispose();
            }
        }
        this.docs.clear();
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
