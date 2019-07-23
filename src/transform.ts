// tslint:disable:no-console
import * as ts from 'typescript'
import * as utils from 'tsutils'
import { minBy, findLastIndex } from 'lodash'
import { isMutableElement } from './util'

const REACT_REGEX = /['"]react['"]/;

export type HoistState = [ts.VariableStatement, ts.Node?, ts.Node?]

/**
 * Check if node is a prologue directive (e.g "use strict")
 * @param node node to check
 * @returns {boolean} true if it is, false otherwise
 */
function isNotPrologueDirective(node: ts.Node): boolean {
  return (
    !ts.isExpressionStatement(node) || !ts.isStringLiteral(node.expression)
  );
}

/**
 * Check if this node is a import react node
 *
 * @param {ts.Node} node node
 * @param {ts.SourceFile} sf source file to get text from
 * @returns {boolean} true if it is, false otherwise
 */
function isReactImport(node: ts.Node, sf: ts.SourceFile): boolean {
  return (
    ts.isImportDeclaration(node) &&
    REACT_REGEX.test(node.moduleSpecifier.getText(sf))
  );
}

function isJsxElement(node: ts.Node) {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || ts.isJsxText(node)
}

function lookUpForRealScope(node: ts.Node) {
  let cur = node.parent || node
  while (
    cur.parent
    && !ts.isFunctionDeclaration(cur)
    && !ts.isFunctionExpression(cur)
    && !ts.isMethodDeclaration(cur)
    && !ts.isArrowFunction(cur)
    && !ts.isForInStatement(cur)
    && !ts.isForOfStatement(cur)
    && !ts.isForStatement(cur)
    && !ts.isSourceFile(cur)
  ) {
    cur = cur.parent
  }
  return cur
}

/**
 * Visit nodes recursively and try to determine if node's
 * considered a constant node.
 * NOTE: This modifies hoistedVariables inline
 *
 * @param {ts.TransformationContext} ctx transformation context
 * @param {HoistedVariables} hoistedVariables hoistedVariables to populate
 * @returns {ts.Visitor}
 */
function constantElementVisitor(
  ctx: ts.TransformationContext,
  hoistedVariables: HoistState[],
  opt?: Opts
): ts.Visitor {
  const visitor: ts.Visitor = node => {
    if (ts.isJsxText(node)) return node
    const mutableResult = !isJsxElement(node) || isMutableElement(node, opt)
    if (mutableResult !== true) {
      const nearestDeclaration = mutableResult && minBy(mutableResult.map(r => findNearestScope(r)), s => s[1])[0]
      const variable = ts.createUniqueName('hoisted');

      if (!isNodeEqual(lookUpForRealScope(nearestDeclaration), lookUpForRealScope(node))) {

        const shouldLazy = opt.lazyFunc && mutableResult

        const jsxNode: ts.Expression = shouldLazy
          ? ts.createCall(
            ts.createPropertyAccess(
              ts.createIdentifier('_'),
              ts.createIdentifier('memoize'),
            ), undefined, [
              ts.createArrowFunction(undefined, undefined, [], undefined, ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken), node as any)
            ]
          )
          : node as any

        const statement = ts.createVariableStatement(
          undefined,
          ts.createVariableDeclarationList([
            ts.createVariableDeclaration(variable, undefined, jsxNode)
          ], ts.NodeFlags.Const)
        );

        const nearestScope = lookUpForScope(nearestDeclaration)

        // Store the variable assignement to hoist later
        hoistedVariables.push([statement, ts.isSourceFile(nearestScope) ? undefined : nearestScope, nearestDeclaration]);

        // Replace <foo /> with {hoisted_constant_element_1}
        // TODO: Figure out case like `return <foo />
        return shouldLazy ? ts.createJsxExpression(undefined, ts.createCall(variable, undefined, [])) : ts.createJsxExpression(undefined, variable);
      }
    }
    try {
      return ts.visitEachChild(node, visitor, ctx);
    } catch {
      return node
    }
  };
  return visitor;
}
function isNodeEqual(l?: ts.Node, r?: ts.Node) {
  try {
    return l && r && l.getFullText() === r.getFullText() && l.pos === r.pos && l.end === r.end
  } catch {
    return false
  }
}

function createStatements(matched: HoistState[], initialStatements: readonly ts.Statement[]) {
  return matched.reduce((res, m) => {
    const index = res.findIndex(s => isNodeEqual(m[2], s))
    if (index < 0) {
      return [m[0], ...res]
    }
    return [
      ...res.slice(0, index + 1),
      m[0],
      ...res.slice(index - res.length + 1)
    ]
  }, initialStatements)
}

function scopeDeclarationVisitor(
  ctx: ts.TransformationContext,
  hoistedVariables: HoistState[]
): ts.Visitor {
  const visitor: ts.Visitor = node => {
    const matched = hoistedVariables.filter(v => node.pos === v[1].pos)
    if (matched.length) {
      const statements = matched.map(m => m[0])
      const scope = node
      if (ts.isBlock(scope)) {
        return ts.createBlock(createStatements(matched, scope.statements.map(s => ts.visitNode(s, visitor))))
      } else if (ts.isFunctionExpression(scope)) {
        return ts.updateFunctionExpression(
          scope,
          scope.modifiers,
          scope.asteriskToken,
          scope.name,
          scope.typeParameters,
          scope.parameters,
          scope.type,
          ts.createBlock(createStatements(matched, ts.visitNode<ts.Block>(scope.body, visitor).statements))
        )
      } else if (ts.isArrowFunction(scope)) {
        return ts.updateArrowFunction(
          scope,
          scope.modifiers,
          scope.typeParameters,
          scope.parameters,
          scope.type,
          scope.equalsGreaterThanToken,
          ts.isBlock(scope.body)
            ? ts.createBlock(createStatements(matched, ts.visitNode<ts.Block>(scope.body, visitor).statements))
            : ts.createBlock([
              ...statements,
              ts.createReturn(scope.body)
            ])
        )
      } else if (ts.isFunctionDeclaration(scope)) {
        return ts.updateFunctionDeclaration(
          scope,
          scope.decorators,
          scope.modifiers,
          scope.asteriskToken,
          scope.name,
          scope.typeParameters,
          scope.parameters,
          scope.type,
          ts.createBlock(createStatements(matched, ts.visitNode<ts.Block>(scope.body, visitor).statements))
        )
      } else if (ts.isMethodDeclaration(scope)) {
        return ts.updateMethod(
          scope,
          scope.decorators,
          scope.modifiers,
          scope.asteriskToken,
          scope.name,
          scope.questionToken,
          scope.typeParameters,
          scope.parameters,
          scope.type,
          ts.createBlock(createStatements(matched, ts.visitNode<ts.Block>(scope.body, visitor).statements))
        )
      } else if (ts.isForStatement(scope)) {

        return ts.updateFor(scope, scope.initializer, scope.condition, scope.incrementor, ts.createBlock(
          createStatements(
            matched,
            ts.isBlock(scope.statement)
              ? scope.statement.statements.map(s => ts.visitNode(s, visitor))
              : [ts.visitNode(scope.statement, visitor)]
          )
        ))
      } else if (ts.isForInStatement(scope)) {
        return ts.updateForIn(scope, scope.initializer, scope.expression, ts.createBlock(
          createStatements(
            matched,
            ts.isBlock(scope.statement)
              ? scope.statement.statements.map(s => ts.visitNode(s, visitor))
              : [ts.visitNode(scope.statement, visitor)]
          )
        ))
      } else if (ts.isForOfStatement(scope)) {
        return ts.updateForOf(scope, scope.awaitModifier, scope.initializer, scope.expression, ts.createBlock(
          createStatements(
            matched,
            ts.isBlock(scope.statement)
              ? scope.statement.statements.map(s => ts.visitNode(s, visitor))
              : [ts.visitNode(scope.statement, visitor)]
          )
        ))
      } else if (ts.isCaseClause(scope)) {
        return ts.updateCaseClause(scope, scope.expression, createStatements(matched, scope.statements.map(s => ts.visitNode(s, visitor))))
      }
    }
    return ts.visitEachChild(node, visitor, ctx)
  }

  return visitor
}

function findNearestScope(id: ts.Identifier) {
  let cur: ts.Node = id
  let height = 0
  while (cur) {
    while (!(utils.isScopeBoundary(cur) || ts.isCaseClause(cur)) && cur.parent) {
      cur = cur.parent
    }
    const res = findDeclaration(cur, id)

    if (res) {
      return [res, height] as const
    }
    if (!cur.parent) {
      return [cur, height] as const
    }
    cur = cur.parent
    height += 1
  }
}

function findBinding(name: ts.BindingName, id: ts.Identifier): ts.Node | undefined {
  if (ts.isIdentifier(name) && name.getText() === id.getText()) {
    return name
  } else if (ts.isObjectBindingPattern(name)) {
    return name.elements.find(e => findBinding(e.name, id))
  } else if (ts.isArrayBindingPattern(name)) {
    return name.elements.find(e => ts.isBindingElement(e) && findBinding(e.name, id))
  }
}

function findDeclaration(node: ts.Node, id: ts.Identifier): ts.Node | undefined {
  const lookUp = (node: ts.Node): ts.Node | undefined => {
    if (
      (
        ts.isVariableDeclaration(node)
        || ts.isImportSpecifier(node)
        || ts.isImportClause(node)
      ) && node.name
    ) {
      const name = node.name
      const bindingEle = findBinding(name, id)
      if (bindingEle) {
        return bindingEle
      }
    }

    if (node.getChildCount()) {
      for (const c of node.getChildren()) {
        const res = lookUp(c)
        if (res) {
          return res
        }
      }
    }
  }

  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node)) {
    for (const parameter of node.parameters) {
      if (findBinding(parameter.name, id)) {
        return parameter
      }
    }
    if (node.body) {
      return findDeclaration(node.body, id)
    }
  }

  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    if (node.initializer && ts.isVariableDeclarationList(node.initializer) && lookUp(node.initializer)) {
      return node.initializer
    }
    return findDeclaration(node.statement, id)
  }

  if (node.getChildCount()) {
    for (const child of ts.isBlock(node) || ts.isCaseClause(node) ? node.statements : node.getChildren()) {
      if ((ts.isVariableStatement(child) || ts.isImportDeclaration(child)) && lookUp(child)) {
        return child
      } else if (ts.isClassDeclaration(child) && child.name && findBinding(child.name, id)) {
        return child
      } else if (ts.isFunctionDeclaration(child) && child.name && findBinding(child.name, id)) {
        return child
      }
    }
  }
}

function lookUpForScope(node: ts.Node) {
  let cur = node.parent || node // todo ??
  while (cur.parent
    && !ts.isBlock(cur)
    && !ts.isFunctionExpression(cur)
    && !ts.isSourceFile(cur)
    && !ts.isArrowFunction(cur)
    && !ts.isFunctionDeclaration(cur)
    && !ts.isMethodDeclaration(cur)
    && !ts.isForInStatement(cur)
    && !ts.isForOfStatement(cur)
    && !ts.isForStatement(cur)
    && !ts.isCaseClause(cur)
  ) {
    cur = cur.parent
  }
  return cur
}

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
    return sf;
  }

  const lastImportIndex = findLastIndex(sf.statements, node => {
    return ts.isImportDeclaration(node)
      || (ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(
          ({ initializer: i }) => i && i.getText().startsWith('require')
        ))
  })

  let hoistedVariables: HoistState[] = [];
  const elVisitor = constantElementVisitor(ctx, hoistedVariables, opts);
  // We assume we only care about nodes after React import
  const transformedStatements = sf.statements
    .slice(lastImportIndex + 1, sf.statements.length)
    .map(node => ts.visitNode(node, elVisitor));

  const deVisitor = scopeDeclarationVisitor(ctx, hoistedVariables.filter(v => v[1]))
  const transformedAgain = transformedStatements.map(node => ts.visitNode(node, deVisitor))
  if (opts.verbose) {
    console.log(
      `\r\nHoisting ${hoistedVariables.length} elements in ${sf.fileName}:\r\n`
    );
    // hoistedVariables.forEach(n =>
    //   console.log(n.declarationList.declarations[0].initializer.getText(sf))
    // );
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
  );
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
  return ctx => sf => visitSourceFile(ctx, sf, opts);
}
