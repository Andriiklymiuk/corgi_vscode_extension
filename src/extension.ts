/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as yaml from 'yaml';
import Ajv from 'ajv';
// import corgiSchema from './corgiSchema.json';  // Import the schema
import * as path from 'path';

const ajv = new Ajv();

const corgiSchema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "CorgiCompose schema",
    "type": "object",
    "properties": {
        "db_services": {
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
                                "required": ["name"],
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
                                "required": ["name"],
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
        const jsonContent = yaml.parse(yamlContent);
        const valid = ajv.validate(corgiSchema, jsonContent);
        if (!valid && ajv.errors) {
            const diagnosticErrors = ajv.errors.map(error => {
                const propertyPath = error.instancePath.split('/').slice(1);
                let invalidProperty = propertyPath[propertyPath.length - 1] || "unknown property";
                let searchProperty = invalidProperty;
                let additionalPropertyInfo = "";
                let isArrayItem = !isNaN(Number(invalidProperty));

                if (error.params && error.params.additionalProperty) {
                    additionalPropertyInfo = ` Not valid: ${error.params.additionalProperty}.`;
                    searchProperty = error.params.additionalProperty;
                }

                const message = error.message?.includes("must NOT have additional properties")
                    ? `Validation error at ${error.instancePath}: Property "${searchProperty}" is not allowed.`
                    : `Validation error at ${error.instancePath}:${additionalPropertyInfo} Property "${invalidProperty}" ${error.message}`;

                const lines = yamlContent.split('\n');
                let lineNumber = 0;

                if (isArrayItem || error.message?.includes("must be array")) {
                    const parentContext = propertyPath.slice(0, -3).join('.');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].trim().startsWith(parentContext)) {
                            // start searching for the property from this line onwards
                            for (let j = i + 1; j < lines.length; j++) {
                                if (lines[j].trim().startsWith(propertyPath[propertyPath.length - 3] + ':')) {
                                    for (let k = j + 1; k < lines.length; k++) {
                                        if (lines[k].trim().startsWith(propertyPath[propertyPath.length - 2] + ':')) {
                                            lineNumber = k;
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                            break;
                        }
                    }
                } else if (propertyPath.length === 1) {
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].trim().startsWith(searchProperty + ':')) {
                            lineNumber = i;
                            break;
                        }
                    }
                } else {
                    const parentContext = propertyPath.slice(0, -1).join('.');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].trim().startsWith(parentContext)) {
                            // start searching for the property from this line onwards
                            for (let j = i + 1; j < lines.length; j++) {
                                if (lines[j].trim().startsWith(searchProperty + ':')) {
                                    lineNumber = j;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }

                const range = new vscode.Range(lineNumber, 0, lineNumber, lines[lineNumber].length);
                return new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
            });
            diagnostics.set(document.uri, diagnosticErrors);
        } else {
            diagnostics.delete(document.uri);
        }
    } catch (err) {
        vscode.window.showInformationMessage('Error parsing YAML in Corgi extension!');
        console.error("Failed to parse YAML:", err);
    }
}

