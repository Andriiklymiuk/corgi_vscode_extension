import * as vscode from 'vscode';
import * as yaml from 'yaml';
import Ajv from 'ajv';
import corgiSchema from './corgiSchema.json';

const ajv = new Ajv();

export function validateYaml(diagnostics: vscode.DiagnosticCollection, document: vscode.TextDocument) {
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