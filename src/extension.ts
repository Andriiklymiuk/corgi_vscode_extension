/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import Ajv from 'ajv';
// import corgiSchema from './corgiSchema.json';  // Import the schema
import * as path from 'path';

const ajv = new Ajv();

const corgiSchema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "CorgiCompose schema",
    "type": "object",
    "properties": {
        "db_service": {
            "type": "object",
            "patternProperties": {
                ".*": {
                    "type": "object",
                    "properties": {
                        "driver": { "type": "string" },
                        "host": { "type": "string" },
                        "user": { "type": "string" },
                        "password": { "type": "string" },
                        "databaseName": { "type": "string" },
                        "port": { "type": "integer" },
                        "seedFromDbEnvPath": { "type": "string" },
                        "seedFromFilePath": { "type": "string" },
                        "seedFromDb": {
                            "type": "object",
                            "properties": {
                                "host": { "type": "string" },
                                "databaseName": { "type": "string" },
                                "user": { "type": "string" },
                                "password": { "type": "string" },
                                "port": { "type": "integer" }
                            },
                            "required": ["host", "databaseName", "user", "password", "port"],
                            "additionalProperties": false
                        },
                        "additionalProperties": false
                    },
                    "required": ["databaseName"],
                    "additionalProperties": false
                }
            },
        },
        "services": {
            "type": "object",
            "patternProperties": {
                ".*": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "ignore_env": { "type": "boolean" },
                        "manualRun": { "type": "boolean" },
                        "cloneFrom": { "type": "string" },
                        "branch": { "type": "string" },
                        "environment": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "envPath": { "type": "string" },
                        "copyEnvFromFilePath": { "type": "string" },
                        "port": { "type": "integer" },
                        "depends_on_services": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "envAlias": { "type": "string" },
                                    "suffix": { "type": "string" }
                                },
                                "required": ["name", "envAlias"],
                                "additionalProperties": false
                            }
                        },
                        "depends_on_db": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "envAlias": { "type": "string" }
                                },
                                "required": ["name", "envAlias"],
                                "additionalProperties": false
                            }
                        },
                        "beforeStart": { "type": "array", "items": { "type": "string" } },
                        "start": { "type": "array", "items": { "type": "string" } },
                        "afterStart": { "type": "array", "items": { "type": "string" } },
                        "test": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "manualRun": { "type": "boolean" },
                                    "command": {
                                        "type": "array",
                                        "items": { "type": "string" }
                                    }
                                },
                                "required": ["name", "command"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": ["path"],
                    "additionalProperties": false
                },
            },
            "additionalProperties": false
        },
        "required": {
            "type": "object",
            "patternProperties": {
                ".*": {
                    "type": "object",
                    "properties": {
                        "why": { "type": "array", "items": { "type": "string" } },
                        "install": { "type": "array", "items": { "type": "string" } },
                        "optional": { "type": "boolean" },
                        "checkCmd": { "type": "string" }
                    },
                    "required": ["checkCmd"],
                    "additionalProperties": false
                }
            },
            "additionalProperties": false
        }
    },
    "additionalProperties": false,
};
const corgiPattern = /^corgi-.*\.(yml|yaml)$/;

export function activate(context: vscode.ExtensionContext) {
    const diagnostics = vscode.languages.createDiagnosticCollection('corgi');

    context.subscriptions.push(diagnostics);

    // vscode.window.showInformationMessage('Corgi extension activated!');
    console.log('Congratulations, your extension "corgi" is now active!');

    let disposable = vscode.commands.registerCommand('corgi.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from corgi!');
    });
    context.subscriptions.push(disposable);
    // Add event listener for document opening
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
        const baseFileName = path.basename(document.fileName);
        if (corgiPattern.test(baseFileName)) {
            validateYaml(diagnostics, document);
        } else {
            console.log('baseFileName', baseFileName);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
        const baseFileName = path.basename(document.fileName);
        if (corgiPattern.test(baseFileName)) {
            validateYaml(diagnostics, document);
        } else {
            console.log('baseFileName', baseFileName);
        }
    }));
}
export function deactivate() { }

function validateYaml(diagnostics: vscode.DiagnosticCollection, document: vscode.TextDocument) {
    const yamlContent = document.getText();
    try {
        const jsonContent = yaml.load(yamlContent);
        const valid = ajv.validate(corgiSchema, jsonContent);
        console.log('here');
        if (!valid && ajv.errors) {
            const diagnosticErrors = ajv.errors.map(error => {
                console.log('here 1');
                const message = `Validation error at ${error.instancePath}: ${error.message}`;
                const range = new vscode.Range(0, 0, document.lineCount, 0); // This can be improved to highlight the specific line of the error.
                return new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
            });
            diagnostics.set(document.uri, diagnosticErrors);
        } else {
            diagnostics.delete(document.uri);
        }
    } catch (err) {
        vscode.window.showInformationMessage('Corgi extension b!');
        // handle any YAML parsing errors
        console.error("Failed to parse YAML:", err);
    }
}