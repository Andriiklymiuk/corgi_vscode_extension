/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { parse } from 'yaml';

interface ServiceEntry {
    cloneFrom?: string;
    port?: number;
    exports?: unknown;
    depends_on_services?: unknown;
}

interface DbServiceEntry {
    driver?: string;
    port?: number;
}

interface ParsedCompose {
    services?: Record<string, ServiceEntry | undefined>;
    db_services?: Record<string, DbServiceEntry | undefined>;
}

function asParsedCompose(value: unknown): ParsedCompose | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as ParsedCompose;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: string[] = [];
    for (const item of value) {
        if (typeof item === 'string') {
            out.push(item);
        }
    }
    return out;
}

function leadingSpaces(line: string): number {
    const match = /^(\s*)/.exec(line);
    return match ? match[1].length : 0;
}

/**
 * Completion provider for context-aware references inside corgi-compose.yml:
 *
 *   1. `${producer.VAR}` cross-service refs inside an `environment:` entry.
 *      • After `${`     -> producer service names (from depends_on_services).
 *      • After `${producer.` -> exported VARs from producer's `exports:` list.
 *
 *   2. `name: <service>` inside `depends_on_services:` -> all top-level
 *      service names declared in the same file.
 *
 *   3. `name: <db>` inside `depends_on_db:` -> all `db_services:` names.
 *
 * Triggered by `$`, `{`, `.`, `:`, ` `.
 */
export class CorgiCrossServiceRefCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.CompletionItem[]> {
        let raw: unknown;
        try {
            raw = parse(document.getText());
        } catch {
            return undefined;
        }
        const parsed = asParsedCompose(raw);
        if (!parsed) {
            return undefined;
        }

        const lineText = document.lineAt(position).text;
        const beforeCursor = lineText.substring(0, position.character);

        const depsContext = this.detectDepsNameContext(document, position, beforeCursor);
        if (depsContext) {
            return this.completeDepsName(parsed, depsContext, document, position.line);
        }

        const dotMatch = beforeCursor.match(/\$\{([A-Za-z0-9_\-/]+)\.([A-Za-z0-9_]*)$/);
        const openMatch = beforeCursor.match(/\$\{([A-Za-z0-9_\-/]*)$/);
        if (dotMatch || openMatch) {
            return this.completeCrossServiceRef(parsed, document, position, dotMatch);
        }

        return undefined;
    }

    private completeCrossServiceRef(
        parsed: ParsedCompose,
        document: vscode.TextDocument,
        position: vscode.Position,
        dotMatch: RegExpMatchArray | null
    ): vscode.CompletionItem[] | undefined {
        const services = asRecord(parsed.services);
        if (!services) {
            return undefined;
        }
        const currentService = this.findEnclosingServiceName(document, position.line);
        if (!currentService) {
            return undefined;
        }

        const consumer = asRecord(services[currentService]);
        if (!consumer) {
            return undefined;
        }

        const depsList = Array.isArray(consumer.depends_on_services)
            ? consumer.depends_on_services
            : [];
        const allowedProducers = new Set<string>();
        for (const dep of depsList) {
            const d = asRecord(dep);
            if (!d) {
                continue;
            }
            const name = d.name;
            if (typeof name === 'string' && name !== currentService) {
                allowedProducers.add(name);
            }
        }

        if (dotMatch) {
            const producer = dotMatch[1];
            if (!allowedProducers.has(producer)) {
                return undefined;
            }
            const producerService = asRecord(services[producer]);
            if (!producerService) {
                return undefined;
            }
            const exportsList = asStringArray(producerService.exports);
            if (exportsList.length === 0) {
                return undefined;
            }
            const items: vscode.CompletionItem[] = [];
            for (const entry of exportsList) {
                const varName = entry.includes('=') ? entry.split('=')[0].trim() : entry.trim();
                if (!varName) {
                    continue;
                }
                const item = new vscode.CompletionItem(varName, vscode.CompletionItemKind.Constant);
                item.detail = `exported by ${producer}`;
                item.documentation = entry.includes('=')
                    ? `Inline export: ${entry}`
                    : `Re-export of producer's own env var ${varName}`;
                items.push(item);
            }
            return items.length > 0 ? items : undefined;
        }

        const items: vscode.CompletionItem[] = [];
        for (const producer of allowedProducers) {
            const producerService = asRecord(services[producer]);
            const exportsList = producerService ? asStringArray(producerService.exports) : [];
            const hasExports = exportsList.length > 0;
            const item = new vscode.CompletionItem(producer, vscode.CompletionItemKind.Module);
            item.insertText = `${producer}.`;
            item.detail = hasExports
                ? `${exportsList.length} export(s)`
                : 'no exports declared';
            item.documentation = hasExports
                ? `Type . to pick an exported var.`
                : `Producer has no \`exports:\` list — cannot resolve ${producer}.VAR.`;
            item.command = {
                command: 'editor.action.triggerSuggest',
                title: 'Trigger Suggest',
            };
            items.push(item);
        }
        return items.length > 0 ? items : undefined;
    }

    /**
     * Look upward from the current line to determine if we're inside a
     * `depends_on_services:` or `depends_on_db:` array, and that the line
     * we're typing on is `- name: <partial>` (or just `name: <partial>`).
     * Returns the kind of completion needed, or null.
     */
    private detectDepsNameContext(
        document: vscode.TextDocument,
        position: vscode.Position,
        beforeCursor: string
    ): 'services' | 'db_services' | null {
        const nameLineMatch = beforeCursor.match(/^\s*-?\s*name:\s*\S*$/);
        if (!nameLineMatch) {
            return null;
        }

        const currentIndent = leadingSpaces(beforeCursor);
        for (let i = position.line - 1; i >= 0; i--) {
            const text = document.lineAt(i).text;
            const trimmed = text.trim();
            if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            }
            const indent = leadingSpaces(text);
            if (indent >= currentIndent) {
                continue;
            }
            if (trimmed.startsWith('depends_on_services:')) {
                return 'services';
            }
            if (trimmed.startsWith('depends_on_db:')) {
                return 'db_services';
            }
            // Hit a different parent (port:, environment:, etc.) — bail.
            if (trimmed.endsWith(':')) {
                return null;
            }
        }
        return null;
    }

    private completeDepsName(
        parsed: ParsedCompose,
        kind: 'services' | 'db_services',
        document: vscode.TextDocument,
        currentLine: number
    ): vscode.CompletionItem[] | undefined {
        const block = asRecord(parsed[kind]);
        if (!block) {
            return undefined;
        }
        const allNames = Object.keys(block);
        if (allNames.length === 0) {
            return undefined;
        }
        const enclosingService =
            kind === 'services' ? this.findEnclosingServiceName(document, currentLine) : null;

        const items: vscode.CompletionItem[] = [];
        for (const n of allNames) {
            const entry = asRecord(block[n]);
            const item = new vscode.CompletionItem(n, vscode.CompletionItemKind.Reference);
            if (kind === 'services') {
                const port = typeof entry?.port === 'number' ? ` (port ${entry.port})` : '';
                const isSelf = n === enclosingService ? ' — same service (self-dep)' : '';
                item.detail = `services.${n}${port}${isSelf}`;
                item.documentation = typeof entry?.cloneFrom === 'string'
                    ? `Repo: ${entry.cloneFrom}`
                    : 'Declared in services:';
            } else {
                const driver = typeof entry?.driver === 'string' ? ` (${entry.driver})` : '';
                const port = typeof entry?.port === 'number' ? ` :${entry.port}` : '';
                item.detail = `db_services.${n}${driver}${port}`;
                item.documentation = `Declared in db_services:`;
            }
            items.push(item);
        }
        return items;
    }

    /**
     * Walk up from the current line to find the most recent `<service-name>:`
     * heading that sits at the indent level expected for a child of `services:`.
     * The compose schema nests services under a top-level `services:` key, so
     * service names are at indent depth 2 (two spaces).
     */
    private findEnclosingServiceName(
        document: vscode.TextDocument,
        currentLine: number
    ): string | null {
        let inServicesBlock = false;
        let serviceName: string | null = null;

        for (let i = currentLine; i >= 0; i--) {
            const text = document.lineAt(i).text;
            const trimmed = text.trim();
            if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            }
            const indent = leadingSpaces(text);

            if (indent === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(trimmed) && !serviceName) {
                serviceName = trimmed.replace(/:\s*$/, '');
            }
            if (indent === 0 && trimmed.startsWith('services:')) {
                inServicesBlock = true;
                break;
            }
            if (indent === 0 && trimmed.endsWith(':')) {
                if (!trimmed.startsWith('services:')) {
                    return null;
                }
            }
        }

        return inServicesBlock ? serviceName : null;
    }
}
