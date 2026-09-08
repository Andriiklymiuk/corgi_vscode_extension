import * as vscode from 'vscode';
import { Board, BoardSession, formatElapsed, liveSessions, sessionName, statusRank, statusWord } from './agentBoard';
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
        const meta = [statusWord(s.status)];
        if (s.pending?.tool) {
            meta.push(`asks ${s.pending.tool}`);
        } else if (s.note) {
            meta.push(`"${s.note}"`);
        } else if (s.detail) {
            meta.push(s.detail);
        }
        if (typeof s.context?.percent === 'number' && s.context.percent > 0) {
            meta.push(`ctx ${s.context.percent}%`);
        }
        const elapsed = formatElapsed(s.statusSince);
        if (elapsed) {
            meta.push(elapsed);
        }
        item.description = meta.join(' · ');
        item.tooltip = [s.display || s.label, s.cwd, s.profile ? `account ${s.profile}` : '', s.host?.kind].filter(Boolean).join('\n');
        item.iconPath = new vscode.ThemeIcon(icons[s.status ?? ''] ?? 'circle-outline',
            s.status === 'needs_input' ? new vscode.ThemeColor('notificationsWarningIcon.foreground') : undefined);
        item.contextValue = s.pending ? 'corgiAgentSessionPending' : 'corgiAgentSession';
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
