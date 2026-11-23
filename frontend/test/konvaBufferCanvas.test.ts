import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const SRC = join(import.meta.dir, '../src');

// Konva draws a shape that has both a fill and a stroke through a stage-sized offscreen canvas
// whenever it also has a shadow or sits under a translucent group (Shape._useBufferCanvas in
// konva/lib/Shape.js). On the map that canvas is redrawn for every robot on every pose update,
// which dropped a 50-robot map to about 30 fps; perfectDrawEnabled={false} skips it.
const bufferCanvasShapes = (file: string, source: string) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const konvaNames = new Set<string>();
  const offenders: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@/lib/map/konva' &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements)
        konvaNames.add(element.name.text);
    }
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      konvaNames.has(node.tagName.getText())
    ) {
      const attributes = new Map(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map(attribute => [attribute.name.getText(), attribute.initializer?.getText() ?? 'true'])
      );
      if (
        attributes.has('fill') &&
        attributes.has('stroke') &&
        attributes.get('perfectDrawEnabled') !== '{false}'
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        offenders.push(`${file}:${line + 1} <${node.tagName.getText()}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
};

test('map shapes with a fill and a stroke skip Konva’s buffer canvas', () => {
  const offenders = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.tsx'))
    .flatMap(file => bufferCanvasShapes(file, readFileSync(join(SRC, file), 'utf8')));

  expect(offenders).toEqual([]);
});
