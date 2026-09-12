import * as vscode from 'vscode';
import { Board, BoardSession, changesLine, formatElapsed, formatTokens, isCrossing, isDrifting, limitLine, liveSessions, overlapLine, sessionName, spendLine, statusRank, statusWord, testsLine } from './agentBoard';
import type { AgentBoardWatcher } from './agentStatus';

/** A workspace heading or one session under it. */
export type AgentNode = { kind: 'group'; label: string; sessions: BoardSession[] } | { kind: 'session'; session: BoardSession };

/** Sessions grouped by workspace, alphabetically; needs-input first within each. */
export function groupSessions(board: Board | undefined): { label: string; sessions: BoardSession[] }[] {
    const groups = new Map<string, BoardSession[]>();
    for (const s of liveSessions(board)) {
        const key = s.label || s.display || '?';
        groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()]
        .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(([label, sessions]) => ({
            label,
            sessions: sessions.sort((a, b) => (statusRank[a.status ?? ''] ?? 9) - (statusRank[b.status ?? ''] ?? 9)),
        }));
}

const icons: Record<string, string> = {
    needs_input: 'bell', working: 'pulse', limited: 'warning', done: 'check', stale: 'circle-outline', unknown: 'question',
};

/** The Agent sessions view: the board as a tree, one node per session. */
export class AgentSessionsTree implements vscode.TreeDataProvider<AgentNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<AgentNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly watcher: AgentBoardWatcher) {
        this.disposables.push(watcher.onDidChangeBoard(() => this.changed.fire(undefined)));
    }

    getChildren(node?: AgentNode): AgentNode[] {
        if (!node) {
            const groups = groupSessions(this.watcher.current());
            if (groups.length === 1) {
                return groups[0].sessions.map((session) => ({ kind: 'session', session }));
            }
            return groups.map((g) => ({ kind: 'group', label: g.label, sessions: g.sessions }));
        }
        if (node.kind === 'group') {
            return node.sessions.map((session) => ({ kind: 'session', session }));
        }
        return [];
    }

    getTreeItem(node: AgentNode): vscode.TreeItem {
        if (node.kind === 'group') {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = 'corgiAgentGroup';
            item.description = `${node.sessions.length}`;
            item.iconPath = new vscode.ThemeIcon('folder');
            return item;
        }
        const s = node.session;
        const item = new vscode.TreeItem(s.title || sessionName(s), vscode.TreeItemCollapsibleState.None);
        const drifting = isDrifting(s);
        const crossing = isCrossing(s);
        const meta = [drifting ? 'drifting' : statusWord(s.status)];
        // The line after the status, in order: the drift reason, who else is
        // on its files, the permission, the note, the limit, what it is
        // doing, the branch.
        if (drifting) {
            meta.push(s.drift![0]);
        } else if (crossing) {
            meta.push(`⚠ ${overlapLine(s)}`);
        } else if (s.pending?.tool) {
            meta.push(`asks ${s.pending.tool}`);
        } else if (s.note) {
            meta.push(`"${s.note}"`);
        } else if (limitLine(s)) {
            meta.push(limitLine(s));
        } else if (s.detail) {
            meta.push(s.detail);
        } else if (s.branch) {
            meta.push(s.branch);
        }
        // The branch in one line, and the last test run: what an operator
        // reads before opening the diff.
        if (changesLine(s)) {
            meta.push(changesLine(s));
        }
        if (testsLine(s)) {
            meta.push(testsLine(s));
        }
        if (spendLine(s)) {
            meta.push(spendLine(s));
        }
        if (typeof s.context?.percent === 'number' && s.context.percent > 0) {
            meta.push(`ctx ${s.context.percent}%`);
        }
        const elapsed = formatElapsed(s.statusSince);
        if (elapsed) {
            meta.push(elapsed);
        }
        item.description = meta.join(' · ');
        item.tooltip = [
            s.display || s.label,
            s.cwd,
            s.branch ? `branch ${s.branch}` : '',
            s.profile ? `account ${s.profile}` : '',
            s.host?.kind,
            s.summary ? `\n${s.summary}` : '',
            s.pr ? `\n${s.pr}` : '',
            drifting ? `\ndrifting:\n${s.drift!.join('\n')}` : '',
            s.changes?.touched?.length ? `\ntouching: ${s.changes.touched.join(', ')}` : '',
            crossing ? `\ncrossing streams:\n${(s.overlap ?? []).map(o => o.sameCheckout ? `same checkout as ${o.session}` : `${o.session} on ${(o.files ?? []).join(', ')}`).join('\n')}` : '',
            s.tests ? `\n${testsLine(s)}${s.tests.at ? ` · ${formatElapsed(s.tests.at)}` : ''}` : '',
            s.spend?.tokens ? `\nspent ${formatTokens(s.spend.tokens)} tokens${s.spend.turns ? ` over ${s.spend.turns} turns` : ''}${s.cap ? ` · budget ${formatTokens(s.cap)}` : ''}${s.overCap ? ' · OVER BUDGET' : ''}` : '',
        ].filter(Boolean).join('\n');
        item.iconPath = drifting || s.overCap
            ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsErrorIcon.foreground'))
            : crossing
                ? new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('notificationsWarningIcon.foreground'))
                : new vscode.ThemeIcon(icons[s.status ?? ''] ?? 'circle-outline',
                    s.status === 'needs_input' ? new vscode.ThemeColor('notificationsWarningIcon.foreground') : undefined);
        // The context value carries what the row can do: Pending gets Allow /
        // Deny inline, Drift gets Fresh, Pr gets Open pull request.
        item.contextValue = ['corgiAgentSession', s.pending ? 'Pending' : '', drifting ? 'Drift' : '', s.pr ? 'Pr' : ''].join('');
        item.command = { command: 'corgi.agent.focusNode', title: 'Focus', arguments: [node] };
        return item;
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.changed.dispose();
    }
}
