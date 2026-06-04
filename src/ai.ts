/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { exec } from 'child_process';

// Run corgi and capture its output (terminal commands stream; AI needs the text).
// args are hardcoded constants in this file — never model/user input — so the
// template is injection-safe.
function corgiCapture(args: string, cwd: string, timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    exec(`corgi ${args}`, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim();
      resolve({ ok: !err, out });
    });
  });
}

function workspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function activeComposeText(): Promise<string | undefined> {
  const open = vscode.window.activeTextEditor?.document;
  if (open && /corgi.*\.(ya?ml)$/.test(open.fileName)) {
    return open.getText();
  }
  const files = await vscode.workspace.findFiles('**/*corgi-compose*.yml', '**/node_modules/**', 1);
  if (files.length) {
    return Buffer.from(await vscode.workspace.fs.readFile(files[0])).toString('utf8');
  }
  return undefined;
}

// Compact, grounded knowledge so the model gives accurate corgi help.
const SYSTEM_PROMPT = `You are the assistant for "corgi", a Go CLI that spins up databases, services, and required tools from one corgi-compose.yml (like docker-compose for services + databases + tool checks).

Be concise and practical. Prefer real corgi commands and valid corgi-compose.yml over generic advice. When you output a compose file, use a fenced \`\`\`yaml block.

corgi-compose.yml top-level keys: name, description, useDocker, init, beforeStart, afterStart, db_services, services, required, envTiers.

services.<name> fields: path, cloneFrom, branch, port, portAlias, manualRun, ignore_env, envPath, copyEnvFromFilePath, localhostNameInEnv, environment[], autoSourceEnv, healthCheck, depends_on_db[], depends_on_services[], exports[], beforeStart[], start[], afterStart[], restartPolicy, openOnReady, scripts[], tunnel.

db_services.<name> fields: driver (postgres/mysql/mongodb/redis/supabase/localstack/image/...), host, port, port2, user, password, databaseName, version, manualRun, healthCheck, seedFromFilePath, seedFromDbEnvPath, seedFromDb. The "image" driver also takes image/containerPort/environment/volumes/command.

Key commands: corgi run (start everything; --detach background, --seed, --services X, --with-deps), corgi doctor (preflight tools/ports/docker, --fix), corgi status (-w watch, -r ready, --json), corgi validate, corgi init, corgi db / corgi db shell, corgi test, corgi tunnel.

Run a branch in isolation without editing the compose: corgi run --service-branch <svc>=<branch> (reused git worktree, non-destructive), --service-dir <svc>=<path>, --service-checkout <svc>=<branch>. Manage with corgi worktree list/prune.

For agents/scripts: --json gives pure JSON on stdout, stable exit/error codes.`;

const chatHandler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  const cwd = workspaceCwd();
  const messages: vscode.LanguageModelChatMessage[] = [vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT)];

  // Carry prior turns of this conversation for continuity.
  for (const turn of context.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .map((p) => (p instanceof vscode.ChatResponseMarkdownPart ? p.value.value : ''))
        .join('');
      if (text) { messages.push(vscode.LanguageModelChatMessage.Assistant(text)); }
    }
  }

  // Slash commands enrich the prompt with live context.
  let userPrompt = request.prompt;
  if (request.command === 'new') {
    userPrompt = `Scaffold a corgi-compose.yml for: ${request.prompt || 'the project in this workspace'}. Output one \`\`\`yaml block, then a short bullet list of next steps.`;
  } else if (request.command === 'explain') {
    const compose = await activeComposeText();
    userPrompt = compose
      ? `Explain this corgi-compose.yml in plain language — what starts, in what order, and the env wiring:\n\n\`\`\`yaml\n${compose}\n\`\`\``
      : 'No corgi-compose.yml found in the workspace. Tell the user to open or create one (or run /new).';
  } else if (request.command === 'debug') {
    if (cwd) {
      stream.progress('Running corgi doctor + status…');
      const [doctor, status] = await Promise.all([
        corgiCapture('doctor --json', cwd),
        corgiCapture('status --json', cwd),
      ]);
      userPrompt = `Diagnose why my corgi stack may not be healthy and give concrete fixes.\n\ncorgi doctor --json:\n${doctor.out || '(no output)'}\n\ncorgi status --json:\n${status.out || '(no output)'}\n\nUser note: ${request.prompt || '(none)'}`;
    }
  }
  messages.push(vscode.LanguageModelChatMessage.User(userPrompt));

  try {
    const response = await request.model.sendRequest(messages, {}, token);
    for await (const chunk of response.text) {
      stream.markdown(chunk);
    }
  } catch (err) {
    stream.markdown(`\n\n_Could not reach a language model: ${err instanceof Error ? err.message : String(err)}_`);
  }

  stream.button({ command: 'corgi.doctorFromRoot', title: '$(check) corgi doctor' });
  stream.button({ command: 'corgi.runFromRoot', title: '$(play) corgi run' });
  return {};
};

function registerChatParticipant(context: vscode.ExtensionContext) {
  if (!vscode.chat?.createChatParticipant) { return; } // older VS Code
  const participant = vscode.chat.createChatParticipant('corgi.assistant', chatHandler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');
  context.subscriptions.push(participant);
}

// --- Language Model Tools (callable by Copilot agent mode) ---

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text || '(no output)')]);
}

class ReadOnlyCorgiTool implements vscode.LanguageModelTool<{}> {
  constructor(private readonly args: string) {}
  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const cwd = workspaceCwd();
    if (!cwd) { return textResult('No workspace folder is open.'); }
    const { out } = await corgiCapture(this.args, cwd);
    return textResult(out);
  }
}

class CorgiRunTool implements vscode.LanguageModelTool<{}> {
  async prepareInvocation(): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: 'Starting the corgi stack (detached)…',
      confirmationMessages: {
        title: 'Run corgi?',
        message: new vscode.MarkdownString('This will run `corgi run --detach` and start your databases and services.'),
      },
    };
  }
  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const cwd = workspaceCwd();
    if (!cwd) { return textResult('No workspace folder is open.'); }
    // --detach returns after beforeStart (which may install deps) — allow more time.
    const { out } = await corgiCapture('run --detach --json', cwd, 600_000);
    return textResult(out);
  }
}

function registerTools(context: vscode.ExtensionContext) {
  if (!vscode.lm?.registerTool) { return; } // older VS Code
  context.subscriptions.push(
    vscode.lm.registerTool('corgi-status', new ReadOnlyCorgiTool('status --json')),
    vscode.lm.registerTool('corgi-doctor', new ReadOnlyCorgiTool('doctor --json')),
    vscode.lm.registerTool('corgi-validate', new ReadOnlyCorgiTool('validate --json')),
    vscode.lm.registerTool('corgi-list', new ReadOnlyCorgiTool('list --json')),
    vscode.lm.registerTool('corgi-run', new CorgiRunTool()),
  );
}

export function registerCorgiAi(context: vscode.ExtensionContext) {
  registerChatParticipant(context);
  registerTools(context);
}
