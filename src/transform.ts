// tslint:disable:no-console
import * as ts from 'typescript'
import { findLastIndex } from 'lodash'
import { isNotPrologueDirective, isReactImport, constantElementVisitor, scopeDeclarationVisitor } from './util'

// 【提升的 jsx 申明语句，后者所在作用域，jsx 中最近的 mutable 变量的申明语句】
export type HoistState = [ts.VariableStatement, ts.Node?, ts.Node?]

function visitSourceFile(
  ctx: ts.TransformationContext,
  sf: ts.SourceFile,
  opts?: Opts
): ts.SourceFile {
  /**
   * Find the 1st node that we can inject hoisted variable. This means:
   * 1. Pass the prologue directive
   * 2. Pass shebang (not a node)
   * 3. Pass top level comments (not a node)
   * 4. Pass React import (bc hoisted var uses React)
   */
  const firstHoistableNodeIndex = sf.statements.findIndex(
    node => isNotPrologueDirective(node) && isReactImport(node, sf)
  );

  // Can't find where to hoist
  if (!~firstHoistableNodeIndex) {
    return sf
  }

  const lastImportIndex = findLastIndex(sf.statements, node => {
    return ts.isImportDeclaration(node)
      || (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          ({ initializer: i }) => i && i.getText().startsWith('require')
        ))
  })

  let hoistedVariables: HoistState[] = []
  const elVisitor = constantElementVisitor(ctx, hoistedVariables, opts)
  // We assume we only care about nodes after React import
  const transformedStatements = sf.statements
    .slice(lastImportIndex + 1, sf.statements.length)
    .map(node => ts.visitNode(node, elVisitor))

  const deVisitor = scopeDeclarationVisitor(ctx, hoistedVariables.filter(v => v[1]))
  const transformedAgain = transformedStatements.map(node => ts.visitNode(node, deVisitor))

  if (opts.verbose) {
    console.log(
      `\r\nHoisting ${hoistedVariables.length} elements in ${sf.fileName}:\r\n`
    )
  }

  return ts.updateSourceFileNode(
    sf,
    ts.setTextRange(
      ts.createNodeArray([
        ...sf.statements.slice(0, lastImportIndex + 1),
        // Inject hoisted variables
        ...hoistedVariables.filter(v => !v[1]).map(v => v[0]),
        ...transformedAgain
      ]),
      sf.statements
    )
  )
}

export interface Opts {
  verbose?: boolean
  constantReg?: RegExp
  aggressive?: boolean
  lazyFunc?: string
}

export function transform(
  opts: Opts = {}
): ts.TransformerFactory<ts.SourceFile> {
  return ctx => sf => visitSourceFile(ctx, sf, opts)
}
