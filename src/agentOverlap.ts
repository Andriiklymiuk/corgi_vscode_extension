import * as path from 'path';
import * as vscode from 'vscode';

import { Board, BoardSession, quoteLines, sessionName, sessionOnFile } from './agentBoard';

/**
 * Who else is on this file. The daemon measures every live session's diff
 * once a minute and lists the files it touched; the file in front of you
 * being one of them is worth a word before the merge says it. A status bar
 * item names the session, and the first line of the editor carries the same
 * words, so a file opened for a quick edit says so where the eye lands.
 */
export class OverlapMarks implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly decoration: vscode.TextEditorDecorationType;
    private readonly disposables: vscode.Disposable[] = [];
    private board: Board | undefined;
    private hit: BoardSession | undefined;

    constructor() {
        this.item = vscode.window.createStatusBarItem('corgi.agentOverlap', vscode.StatusBarAlignment.Right, 90);
        this.item.name = 'Corgi: who else is on this file';
        this.item.command = 'corgi.agent.overlapFocus';
        this.decoration = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 2em', fontStyle: 'italic' },
        });
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.render()),
            vscode.commands.registerCommand('corgi.agent.overlapFocus', () => {
                if (this.hit) {
                    void vscode.commands.executeCommand('corgi.agent.focusSession', this.hit.id);
                }
            }),
        );
    }

    update(board: Board | undefined): void {
        this.board = board;
        this.render();
    }

    private render(): void {
        const editor = vscode.window.activeTextEditor;
        this.hit = editor ? sessionOnFile(this.board, editor.document.uri.fsPath) : undefined;
        if (!editor || !this.hit) {
            this.item.hide();
            editor?.setDecorations(this.decoration, []);
            return;
        }
        const words = `${sessionName(this.hit)} is editing this file`;
        this.item.text = `$(git-branch) ${words}`;
        this.item.tooltip = `${words}${this.hit.branch ? ` on ${this.hit.branch}` : ''} — click to bring it forward`;
        this.item.show();
        editor.setDecorations(this.decoration, [{ range: new vscode.Range(0, 0, 0, 0), renderOptions: { after: { contentText: `← ${words}` } } }]);
    }

    dispose(): void {
        this.item.dispose();
        this.decoration.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

/** What a selection says to a session: the file and line, the code, and room for the words. */
export function quoteSelection(doc: vscode.TextDocument, selection: vscode.Selection, root: string | undefined): string {
    const rel = root ? path.relative(root, doc.uri.fsPath) : path.basename(doc.uri.fsPath);
    return quoteLines(rel, selection.start.line + 1, selection.end.line + 1, doc.getText(selection));
}
