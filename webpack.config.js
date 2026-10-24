'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src/corgiComposeSchema.json'),
          to: path.resolve(__dirname, 'dist/corgiComposeSchema.json')
        },
        {
          from: path.resolve(__dirname, 'src/corgiExamplesSchema.json'),
          to: path.resolve(__dirname, 'dist/corgiExamplesSchema.json')
        }
      ],
    }),
  ],
  // The idea page's webview script is built from the source of functions
  // the host also runs (ideaHtml.ts sharedScript): their names and bodies
  // must survive the release build as written, so no concatenation
  // renaming and no mangling.
  optimization: {
    minimize: false,
    concatenateModules: false,
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [extensionConfig];
