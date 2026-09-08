import * as path from 'node:path';
import Mocha from 'mocha';

// Unit tests for the modules that do not import vscode; they run in plain
// node, no extension host needed.
const mocha = new Mocha({ ui: 'bdd', color: true });
mocha.addFile(path.join(__dirname, 'agentBoard.test.js'));
mocha.run((failures) => {
    process.exitCode = failures ? 1 : 0;
});
