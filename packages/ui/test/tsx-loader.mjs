import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function resolve(specifier, context, next) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of ['.tsx', '.ts']) {
      try {
        return await next(specifier + ext, context);
      } catch {
        // try the next extension
      }
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (!url.endsWith('.tsx')) return next(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: url,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return { format: 'module', source: outputText, shortCircuit: true };
}
