import * as vscode from 'vscode';
import corgiSchema from './corgiSchema.json';

export class CorgiCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const currentLine = document.lineAt(position).text.substring(0, position.character);
    const currentIndent = this.getIndentation(currentLine);
    const parentKey = this.getParentKey(document, position.line, currentIndent);
    // Improve the word extraction logic to handle edge cases
    const poppedWord = currentLine.trim().split(/\s+/).pop();
    const typedWord = (poppedWord ? poppedWord.split(":")[0] : "") || "";


    const items: vscode.CompletionItem[] = [];
    if (context.triggerCharacter === ' ') {
      if (currentLine.trim().startsWith('driver:')) {
        for (const driver of corgiSchema.properties.db_services.patternProperties['.*'].properties.driver.enum) {
          items.push(new vscode.CompletionItem(driver, vscode.CompletionItemKind.Value));
        }
      }
      return items;
    }
    if (currentIndent === 0) {
      for (const prop in corgiSchema.properties) {
        if (prop.startsWith(typedWord)) {
          items.push(new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property));
        }
      }
    }
    else if (parentKey === 'db_services') {
      for (const prop in corgiSchema.properties.db_services.patternProperties['.*'].properties) {
        if (prop.startsWith(typedWord)) {
          items.push(new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property));
        }
      }
    }
    else {
      // Handle deeper properties based on parentKey
      let properties: any = corgiSchema.properties;

      // Iterate through the parents and narrow down to the properties of the current context
      for (const key of (parentKey ? parentKey.split('.') : [])) {
        if (properties[key] && properties[key].properties) {
          properties = properties[key].properties;
        }
        else if (properties[key] && properties[key].patternProperties && properties[key].patternProperties['.*']) {
          properties = properties[key].patternProperties['.*'].properties;
        }
      }
      if (parentKey?.endsWith('depends_on_db')) {
        const dbDependProperties = corgiSchema.properties.services.patternProperties['.*'].properties.depends_on_db.items.properties;

        for (const prop in dbDependProperties) {
          if (prop.startsWith(typedWord)) {
            items.push(new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property));
          }
        }
      }
      else if (parentKey?.endsWith('depends_on_services')) {
        const serviceDependProperties = corgiSchema.properties.services.patternProperties['.*'].properties.depends_on_services.items.properties;

        for (const prop in serviceDependProperties) {
          if (prop.startsWith(typedWord)) {
            items.push(new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property));
          }
        }
      } else {
        for (const prop in properties) {
          if (prop.startsWith(typedWord)) {
            items.push(new vscode.CompletionItem(prop, vscode.CompletionItemKind.Property));
          }
        }
      }
    }

    if (currentLine.trim().startsWith('driver:')) {
      const valueTyped = currentLine.trim().split(':')[1].trim();

      for (const driver of corgiSchema.properties.db_services.patternProperties['.*'].properties.driver.enum) {
        if (!valueTyped || driver.startsWith(valueTyped)) {
          items.push(new vscode.CompletionItem(driver, vscode.CompletionItemKind.Value));
        }
      }
    }

    return items.length > 0 ? items : undefined;
  }

  getIndentation(line: string): number {
    return (line.match(/^(\s*)/)![1].length) / 2; // assuming 2 spaces for indentation
  }

  getParentKey(document: vscode.TextDocument, lineNo: number, currentIndent: number): string | null {
    let parentKeys: string[] = [];
    let seenIndent = currentIndent;

    for (let i = lineNo - 1; i >= 0; i--) {
      const line = document.lineAt(i).text;
      const lineIndent = this.getIndentation(line);
      if (lineIndent < seenIndent) {
        // Only include lines that are properties (those ending with ':')
        if (line.trim().endsWith(':')) {
          parentKeys.unshift(line.trim().split(':')[0]);
          seenIndent = lineIndent;
        }
      }

      if (seenIndent === 0) {
        break; // Reached the top-level property
      }
    }

    return parentKeys.join('.');
  }
}