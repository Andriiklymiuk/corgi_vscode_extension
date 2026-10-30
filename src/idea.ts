import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * An idea page: one markdown page per thing you want built, written by the
 * agent from a sentence and argued over in comments. corgi keeps each one
 * under <agent dir>/ideas/<slug>/ - idea.md, meta.json, comments.json and
 * a files/ folder - and touches ideas/changed on every change. This module
 * reads those files and finds a comment's words on the page; it imports no
 * vscode, so the tests run in plain node. The functions marked "shared with
 * the webview" are injected into the page script by their source, so they
 * reference nothing outside themselves but each other.
 */

export type IdeaStatus = 'draft' | 'approved' | 'building' | 'built';
/** What kind of page: something to build from nothing, a feature in a product, a high-level design, a proposal to decide. */
export type IdeaType = 'idea' | 'spec' | 'hld' | 'rfc';
export const IDEA_TYPES: readonly IdeaType[] = ['idea', 'spec', 'hld', 'rfc'];
export type CommentKind = 'comment' | 'proposal';
export type CommentStatus = 'open' | 'answered' | 'fixed' | 'resolved';

export interface IdeaMeta {
    slug: string;
    title: string;
    name?: string;
    tags?: string[];
    summary?: string;
    workspace?: string;
    status: IdeaStatus;
    type?: IdeaType;
    key?: string;
    /** The markdown file the page was shared from, when it was. */
    source?: string;
    auto?: boolean;
    tasks?: number[];
    plan?: number;
    createdAt?: string;
    updatedAt?: string;
    /** The agent is working on an answer right now. */
    answering?: boolean;
    /** The stored copy of the agent's split into tickets; `IdeaDoc.tickets` carries the live board state. */
    tickets?: IdeaTicket[];
    sent?: SentLink[];
    /** Sign-offs, each for the text as it read then; `IdeaDoc.approvers` are the ones that still stand. */
    approvals?: { by: string; at?: string; rev?: number }[];
    needed?: number;
    buildWhenApproved?: boolean;
    /** What the threads settled: one line each, written when a thread is resolved. */
    decisions?: IdeaDecision[];
    /** The clickable mockup under files/, once drawn; mocking while the agent draws it. */
    mock?: string;
    mockAt?: string;
    mocking?: boolean;
}

export interface IdeaDecision {
    comment?: number;
    text: string;
    by?: string;
    at?: string;
}

/** One ticket of the agent's proposed split of the page. */
export interface IdeaTicket {
    id: number;
    title: string;
    body?: string;
    /** Ticket ids this one waits on. */
    after?: number[];
    ref?: string;
    url?: string;
    state?: string;
}

/** Where the page went: an epic, a ticket, a wiki page. */
export interface SentLink {
    kind: 'epic' | 'ticket' | 'page' | string;
    ref?: string;
    url?: string;
    title?: string;
    at?: string;
}

/** The destinations with credentials. */
export interface SendOptions {
    jira?: { project?: string; site?: string };
    linear?: { team?: string };
    confluence?: { site?: string };
}

/** Where a comment points on the page: the words, with context to tell copies apart. */
export interface IdeaAnchor {
    quote: string;
    prefix?: string;
    suffix?: string;
    heading?: string;
}

export interface IdeaFile {
    name: string;
    path: string;
    type?: string;
    size?: number;
}

export type CommentId = string | number;

export interface IdeaReply {
    id: CommentId;
    by: string;
    text: string;
    at: string;
    /** The agent changed the page with this reply. */
    changed?: boolean;
    files?: IdeaFile[];
    links?: string[];
}

export interface IdeaComment {
    id: CommentId;
    kind: CommentKind;
    by: string;
    text: string;
    anchor?: IdeaAnchor;
    status: CommentStatus;
    at: string;
    updatedAt?: string;
    files?: IdeaFile[];
    links?: string[];
    replies?: IdeaReply[];
}

export interface IdeaComments {
    next: number;
    comments: IdeaComment[];
}

/** One idea read from its folder. */
export interface Idea {
    slug: string;
    dir: string;
    file?: string;
    meta: IdeaMeta;
    markdown: string;
    comments: IdeaComment[];
}

/** One row of `corgi idea list --json`. */
export type IdeaListEntry = IdeaMeta & { open: number; forAgent: number; counts?: Record<string, number>; file?: string; link?: string };

/** What `corgi idea show <slug> --json` prints: the page rendered, with everything around it. */
export interface IdeaDoc {
    idea: IdeaMeta;
    markdown: string;
    html: string;
    comments: IdeaComment[];
    tasks?: { ref?: string; key?: string; title?: string; state?: string }[];
    plan?: { ref?: string; state?: string; todo?: number; doing?: number; review?: number; done?: number } | null;
    tickets?: IdeaTicket[] | null;
    sent?: SentLink[] | null;
    send?: SendOptions | null;
    counts?: Record<string, number>;
    open?: number;
    forAgent?: number;
    file?: string;
    link?: string;
    /** Where the panel finds the page's own files (set by the panel, not corgi). */
    filesBase?: string;
    approvers?: string[];
    needed?: number;
    approved?: boolean;
    /** The name this editor signs and comments as (set by the panel). */
    me?: string;
}

export const AGENT = 'agent';

/** The folder that holds every idea, under corgi's agent directory. */
export function ideasDir(agentDir: string): string {
    return path.join(agentDir, 'ideas');
}

/** The marker corgi touches on every change to any idea. */
export function changedMarker(agentDir: string): string {
    return path.join(ideasDir(agentDir), 'changed');
}

/** A slug as corgi makes them: nothing that could leave the ideas folder. */
export function isSlug(slug: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) && slug !== '.' && slug !== '..';
}

/** The slug when file is <agentDir>/ideas/<slug>/idea.md; undefined for any other file. */
export function ideaSlugOf(agentDir: string, file: string): string | undefined {
    const rel = path.relative(ideasDir(agentDir), file);
    const parts = rel.split(path.sep);
    if (parts.length !== 2 || parts[1] !== 'idea.md' || !isSlug(parts[0])) {
        return undefined;
    }
    return parts[0];
}

let sources: { stamp: number; bySource: Map<string, string> } | undefined;

/** The slug of the page shared from file (corgi idea share/open <file>); undefined when none was. */
export function sourceSlugOf(agentDir: string, file: string): string | undefined {
    const dir = ideasDir(agentDir);
    let stamp = 0;
    try {
        stamp = fs.statSync(changedMarker(agentDir)).mtimeMs;
    } catch {
        // no page changed yet
    }
    if (!sources || sources.stamp !== stamp) {
        const bySource = new Map<string, string>();
        let slugs: string[] = [];
        try {
            slugs = fs.readdirSync(dir).filter(isSlug);
        } catch {
            // no ideas folder
        }
        for (const slug of slugs) {
            const meta = readJson<IdeaMeta>(path.join(dir, slug, 'meta.json'));
            if (meta?.source) {
                bySource.set(path.resolve(meta.source), slug);
            }
        }
        sources = { stamp, bySource };
    }
    return sources.bySource.get(path.resolve(file));
}

function readJson<T>(file: string): T | undefined {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
        return undefined;
    }
}

/** The idea under <ideas>/<slug>; undefined when its page is not there. */
export function readIdea(ideas: string, slug: string): Idea | undefined {
    if (!isSlug(slug)) {
        return undefined;
    }
    const dir = path.join(ideas, slug);
    const file = path.join(dir, 'idea.md');
    let markdown: string;
    try {
        markdown = fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
    const meta = readJson<Partial<IdeaMeta>>(path.join(dir, 'meta.json')) ?? {};
    const comments = readJson<Partial<IdeaComments>>(path.join(dir, 'comments.json'))?.comments;
    return {
        slug,
        dir,
        file,
        meta: { ...meta, slug: meta.slug || slug, title: meta.title || titleOf(markdown) || slug, status: meta.status || 'draft' },
        markdown,
        comments: Array.isArray(comments) ? comments.filter((c) => c && (typeof c.id === 'string' || typeof c.id === 'number')) : [],
    };
}

/** The first heading of the page, as a title. */
export function titleOf(markdown: string): string {
    const m = /^#\s+(.+?)\s*$/m.exec(markdown);
    return m ? m[1].replace(/\s+#+$/, '') : '';
}

/** Shared with the webview. */
export function isAgent(by: string | undefined): boolean {
    return (by ?? '').toLowerCase() === 'agent';
}

/** Someone other than the agent replied: a proposal that got this is accepted. Shared with the webview. */
export function personReplied(c: IdeaComment): boolean {
    return (c.replies ?? []).some((r) => !isAgent(r.by));
}

/** An open proposal nobody answered: it waits on a person to accept or dismiss it. Shared with the webview. */
export function waitsOnPerson(c: IdeaComment): boolean {
    return c.kind === 'proposal' && c.status === 'open' && !personReplied(c);
}

/** Open and on the agent's plate: a person's comment, or a proposal someone accepted. */
export function waitsOnAgent(c: IdeaComment): boolean {
    return c.status === 'open' && !waitsOnPerson(c);
}

/** Shared with the webview. */
export function isOpen(c: IdeaComment): boolean {
    return c.status !== 'resolved';
}

export function openCount(comments: readonly IdeaComment[]): number {
    return comments.filter(isOpen).length;
}

export function forAgentCount(comments: readonly IdeaComment[]): number {
    return comments.filter(waitsOnAgent).length;
}

/** The status, in words. Shared with the webview. */
export function statusLabel(status: CommentStatus | string | undefined): string {
    switch (status) {
        case 'answered': return 'answered';
        case 'fixed': return 'changed the page';
        case 'resolved': return 'resolved';
        default: return 'open';
    }
}

/** The page's type as a pill: "idea", "spec", "HLD", "RFC". Shared with the webview. */
export function typeLabel(type: IdeaType | string | undefined): string {
    switch ((type ?? '').toLowerCase()) {
        case 'spec': return 'spec';
        case 'hld': return 'HLD';
        case 'rfc': return 'RFC';
        default: return /^[a-z0-9][a-z0-9-]{0,31}$/.test(type ?? '') ? String(type) : 'idea';
    }
}

/** What each type is for, for the picker. */
export const typeDescriptions: Record<IdeaType, string> = {
    idea: 'something to build from nothing',
    spec: 'a feature in an existing product',
    hld: 'a high-level design',
    rfc: 'a proposal to decide',
};

/** The mockup in a panel of its own: its scripts run, but it reaches nothing outside itself. */
export function mockHtml(html: string): string {
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + csp) : csp + html;
}

/** The epic the page was sent as, when it was: its ref. */
export function epicRef(sent: readonly SentLink[] | null | undefined): string {
    return (sent ?? []).find((l) => l && l.kind === 'epic' && l.ref)?.ref ?? '';
}

/** "🎯 SHOP-12 · BrewShift" for an epic or ticket, "📄 page 99" for a wiki page. Shared with the webview. */
export function sentLabel(l: SentLink): string {
    if (l.kind === 'page') {
        return `📄 ${l.title || (l.ref ? `page ${l.ref}` : 'page')}`;
    }
    return `🎯 ${[l.ref, l.title].filter(Boolean).join(' · ') || l.kind}`;
}

/** The destinations a page can be sent to, from `send`: the key, and the project/team it already knows. */
export function sendTargets(send: SendOptions | null | undefined): { to: 'jira' | 'linear' | 'confluence'; project: string; site: string }[] {
    const out: { to: 'jira' | 'linear' | 'confluence'; project: string; site: string }[] = [];
    if (send?.jira) {
        out.push({ to: 'jira', project: send.jira.project ?? '', site: send.jira.site ?? '' });
    }
    if (send?.linear) {
        out.push({ to: 'linear', project: send.linear.team ?? '', site: '' });
    }
    if (send?.confluence) {
        out.push({ to: 'confluence', project: '', site: send.confluence.site ?? '' });
    }
    return out;
}

/** "after 1, 2" for a ticket that waits on others; "". Shared with the webview. */
export function afterLine(t: IdeaTicket): string {
    return t.after?.length ? `after ${t.after.join(', ')}` : '';
}

/** How many comments that are not resolved sit under a heading (by their anchor's heading). Shared with the webview. */
export function openUnder(comments: readonly IdeaComment[], heading: string): number {
    const key = heading.trim().toLowerCase();
    return comments.filter((c) => isOpen(c) && (c.anchor?.heading ?? '').trim().toLowerCase() === key).length;
}

/** The idea's standing, for a row: "draft", "building", "built". */
export function ideaStatusLabel(status: IdeaStatus | string | undefined): string {
    return status === 'building' || status === 'built' || status === 'approved' ? status : 'draft';
}

/** "3 open · 1 waiting on the agent" for a row under an idea's name. */
export function ideaCounts(open: number, forAgent: number): string {
    const bits = [`${open} open`];
    if (forAgent) {
        bits.push(`${forAgent} waiting on the agent`);
    }
    return bits.join(' · ');
}

/** The author to pass with --by: the setting when set, else the login name. */
export function authorName(setting: string | undefined, username: string): string {
    const s = (setting ?? '').trim();
    return s || username.trim() || 'someone';
}

/** How many characters at the end of a match the end of b: "abc" and "xbc" share 2. Shared with the webview. */
export function sharedTail(a: string, b: string): number {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) {
        n++;
    }
    return n;
}

/** Shared with the webview. */
export function sharedHead(a: string, b: string): number {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) {
        n++;
    }
    return n;
}

/** Characters of context an anchor keeps on each side of its words. */
export const QUOTE_CONTEXT = 40;

/** Every start offset of needle in text. Shared with the webview. */
export function occurrences(text: string, needle: string): number[] {
    const out: number[] = [];
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
        out.push(i);
    }
    return out;
}

/** Of several copies of the words, the one whose surroundings match the anchor's prefix and suffix best. Shared with the webview. */
export function pickOccurrence(text: string, starts: number[], length: number, anchor: IdeaAnchor): number {
    if (starts.length === 1 || (!anchor.prefix && !anchor.suffix)) {
        return starts[0];
    }
    let best = starts[0];
    let bestScore = -1;
    for (const s of starts) {
        const before = text.slice(Math.max(0, s - 40), s);
        const after = text.slice(s + length, s + length + 40);
        const score = sharedTail(before, anchor.prefix ?? '') + sharedHead(after, anchor.suffix ?? '');
        if (score > bestScore) {
            best = s;
            bestScore = score;
        }
    }
    return best;
}

/**
 * Where the anchor's words are in text, as [start, end) offsets. With the
 * quote on the page more than once, the copy whose surroundings match the
 * anchor's prefix and suffix best wins - a text-quote selector. Whitespace
 * differences are forgiven when an exact match fails. Null when the words
 * are gone (the page changed under the comment). Shared with the webview.
 */
export function findQuote(text: string, anchor: IdeaAnchor | undefined): { start: number; end: number } | null {
    const quote = anchor?.quote ?? '';
    if (!quote) {
        return null;
    }
    const exact = occurrences(text, quote);
    if (exact.length) {
        const start = pickOccurrence(text, exact, quote.length, anchor!);
        return { start, end: start + quote.length };
    }
    // Loose: whitespace runs count as one space; map the hit back.
    const map: number[] = [];
    let loose = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/\s/.test(ch)) {
            if (loose.endsWith(' ')) {
                continue;
            }
            loose += ' ';
        } else {
            loose += ch;
        }
        map.push(i);
    }
    const needle = quote.replace(/\s+/g, ' ').trim();
    if (!needle) {
        return null;
    }
    const hits = occurrences(loose, needle);
    if (!hits.length) {
        return null;
    }
    const looseAnchor: IdeaAnchor = { quote: needle, prefix: anchor!.prefix?.replace(/\s+/g, ' '), suffix: anchor!.suffix?.replace(/\s+/g, ' ') };
    const at = pickOccurrence(loose, hits, needle.length, looseAnchor);
    return { start: map[at], end: map[at + needle.length - 1] + 1 };
}

/** The nearest markdown heading above offset, without its hashes; "" above the first. */
export function headingAbove(text: string, offset: number): string {
    const before = text.slice(0, Math.max(0, offset));
    let heading = '';
    const re = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
    for (let m = re.exec(before); m; m = re.exec(before)) {
        heading = m[2];
    }
    return heading;
}

/** An anchor for text[start, end): the words, 40 characters each side, the heading above. */
export function anchorFor(text: string, start: number, end: number): IdeaAnchor {
    const s = Math.max(0, Math.min(start, end));
    const e = Math.min(text.length, Math.max(start, end));
    return {
        quote: text.slice(s, e),
        prefix: text.slice(Math.max(0, s - QUOTE_CONTEXT), s),
        suffix: text.slice(e, e + QUOTE_CONTEXT),
        heading: headingAbove(text, s),
    };
}

/** The zero-based lines that text[start, end) touches; a range ending right after a newline stays on the line before. */
export function lineRangeOf(text: string, start: number, end: number): { startLine: number; endLine: number } {
    const s = Math.max(0, Math.min(start, end, text.length));
    let e = Math.max(s, Math.min(Math.max(start, end), text.length));
    if (e > s && text[e - 1] === '\n') {
        e--;
    }
    const lineAt = (offset: number): number => {
        let n = 0;
        for (let i = 0; i < offset; i++) {
            if (text.charCodeAt(i) === 10) {
                n++;
            }
        }
        return n;
    };
    const startLine = lineAt(s);
    return { startLine, endLine: e === s ? startLine : lineAt(e) };
}

/** The offset of the first character of a zero-based line. */
export function lineStart(text: string, line: number): number {
    let at = 0;
    for (let n = 0; n < line; n++) {
        const next = text.indexOf('\n', at);
        if (next < 0) {
            return text.length;
        }
        at = next + 1;
    }
    return at;
}

/**
 * Words selected in the markdown, as a quote corgi can place: heading
 * marks, list bullets and quote marks are stripped at the start of every
 * line, because the rendered page has none of them.
 */
export function cleanQuote(text: string): string {
    return text.split('\n').map((line) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/, '')).join('\n').trim();
}

/**
 * The anchor for text[start, end) selected in the markdown: the quote with
 * heading marks and bullets stripped, placed where the cleaned words are
 * (so prefix and suffix abut them), the heading above. A quote that is
 * all markup becomes empty: a comment on the whole page.
 */
export function selectionAnchor(text: string, start: number, end: number): IdeaAnchor {
    const s = Math.max(0, Math.min(start, end));
    const e = Math.min(text.length, Math.max(start, end));
    const quote = cleanQuote(text.slice(s, e));
    if (!quote) {
        return { quote: '' };
    }
    const at = text.indexOf(quote, s);
    if (at >= 0 && at < e) {
        return anchorFor(text, at, at + quote.length);
    }
    // Several lines with marks inside: the raw span's context, the cleaned words.
    return { ...anchorFor(text, s, e), quote };
}

/** What a comment or reply carries to `corgi idea comment`. */
export interface CommentWrite {
    slug: string;
    text: string;
    by: string;
    anchor?: IdeaAnchor;
    replyTo?: CommentId;
    links?: string[];
    files?: string[];
}

/**
 * The argument list for `corgi idea comment`: every flag first, then `--`,
 * then the slug and the text - so words that start with a dash ("-1 on
 * sqlite") are text, not flags. The anchor goes whole: quote, prefix, suffix
 * and heading, so corgi places the comment on the right copy of the words.
 */
export function commentArgs(w: CommentWrite): string[] {
    const args = ['idea', 'comment', '--by', w.by, '--json'];
    if (w.replyTo !== undefined && w.replyTo !== '') {
        args.push('--reply-to', String(w.replyTo));
    }
    const quote = w.anchor?.quote ?? '';
    if (quote.trim()) {
        args.push('--quote', quote);
        if (w.anchor!.prefix) {
            args.push('--prefix', w.anchor!.prefix);
        }
        if (w.anchor!.suffix) {
            args.push('--suffix', w.anchor!.suffix);
        }
        if (w.anchor!.heading) {
            args.push('--heading', w.anchor!.heading);
        }
    }
    for (const l of w.links ?? []) {
        if (/^https?:\/\//.test(l)) {
            args.push('--link', l);
        }
    }
    for (const f of w.files ?? []) {
        if (f) {
            args.push('--file', f);
        }
    }
    args.push('--', w.slug, w.text);
    return args;
}

/** The argument list for `corgi idea new`: flags, `--`, the sentence (empty with --from). */
export function newArgs(text: string, type: IdeaType, from?: string): string[] {
    const args = ['idea', 'new', '--type', type, '--json'];
    if (from) {
        args.push('--from', from);
    }
    args.push('--', text);
    return args;
}
