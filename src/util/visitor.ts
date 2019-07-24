import * as ts from 'typescript'
import { minBy } from 'lodash'
import * as utils from 'tsutils'
import { HoistState, Opts } from '../transform'
import { isMutableElement } from './mutable'

const REACT_REGEX = /['"]react['"]/;

/**
 * Check if node is a prologue directive (e.g "use strict")
 * @param node node to check
 * @returns {boolean} true if it is, false otherwise
 */
export function isNotPrologueDirective(node: ts.Node): boolean {
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
export function isReactImport(node: ts.Node, sf: ts.SourceFile): boolean {
  return (
    ts.isImportDeclaration(node) &&
    REACT_REGEX.test(node.moduleSpecifier.getText(sf))
  );
}

export function isJsxElement(node: ts.Node) {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || ts.isJsxText(node)
}

/**
 *
 * @param node 寻找该节点真正所在的函数作用域
 * 此方法用于判断两个节点是否在同一个函数作用域下
 * 如果在一个函数作用域下，则无需进行变量提升
 */
export function lookUpForRealScope(node: ts.Node) {
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
 * 判断两个节点是否是同一个节点，因为自己创建出来的节点获取 text 会报错，所以用 try
 * 不知道有没有更好的办法去判断？两个节点相同是否引用也一定相同？
 */
export function isNodeEqual(l?: ts.Node, r?: ts.Node) {
  try {
    return l && r && l.getFullText() === r.getFullText() && l.pos === r.pos && l.end === r.end
  } catch {
    return false
  }
}

/**
 *
 * @param matched 所有匹配到当前作用域下的需要提升的变量 type：【jsx 申明，当前作用域，jsx 中最近的 mutable 变量的申明语句】
 * @param initialStatements 当前作用域下所有的语句
 * 此方法用于递归的将所有提升变量的jsx申明语句（const hoisted = ...）
 * 插入到对应的最近的 mutable 变量的申明语句之后
 */
export function createStatements(matched: HoistState[], initialStatements: readonly ts.Statement[]) {
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


/**
 * Visit nodes recursively and try to determine if node's
 * considered a constant node.
 * NOTE: This modifies hoistedVariables inline
 *
 * @param {ts.TransformationContext} ctx transformation context
 * @param {HoistedVariables} hoistedVariables hoistedVariables to populate
 * @returns {ts.Visitor}
 */
export function constantElementVisitor(
  ctx: ts.TransformationContext,
  hoistedVariables: HoistState[],
  opt?: Opts
): ts.Visitor {
  const visitor: ts.Visitor = node => {
    if (ts.isJsxText(node)) return node
    const mutableResult = !isJsxElement(node) || isMutableElement(node, opt)
    if (mutableResult !== true) {
      // 寻找该 jsx 所有变量中最 low level 的变量的申明语句
      const nearestDeclaration = mutableResult && minBy(mutableResult.map(r => findNearestDeclaration(r)), s => s[1])[0]

      const variable = ts.createUniqueName('hoisted')

      // 如果该最近的申明语句和 jsx 所在的作用域相同，则无需提升
      if (!isNodeEqual(lookUpForRealScope(nearestDeclaration), lookUpForRealScope(node))) {

        const shouldLazy = opt.lazyFunc && mutableResult
        // 如果 lazy，name 所有提升的变量都用 _.memoize 包裹
        const jsxNode: ts.Expression = shouldLazy
          ? ts.createCall(
            ts.createPropertyAccess(
              ts.createIdentifier('_'),
              ts.createIdentifier('memoize'),
            ), undefined, [
              ts.createArrowFunction(
                undefined, undefined, [], undefined,
                ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken), node as any
              )
            ]
          )
          : node as any

        // 提升的 jsx 声明语句
        const statement = ts.createVariableStatement(
          undefined,
          ts.createVariableDeclarationList([
            ts.createVariableDeclaration(variable, undefined, jsxNode)
          ], ts.NodeFlags.Const)
        )

        // 该 jsx 所有变量中最 low level 的变量的申明语句所在的作用域
        const nearestScope = lookUpScope(nearestDeclaration)

        // Store the variable assignement to hoist later
        hoistedVariables.push([statement, ts.isSourceFile(nearestScope) ? undefined : nearestScope, nearestDeclaration])

        // Replace <foo /> with {hoisted_constant_element_1}
        // TODO: Figure out case like `return <foo />
        return shouldLazy
          ? ts.createJsxExpression(undefined, ts.createCall(variable, undefined, []))
          : ts.createJsxExpression(undefined, variable)
      }
    }
    try {
      return ts.visitEachChild(node, visitor, ctx)
    } catch {
      return node
    }
  }
  return visitor
}

/**
 * 真正执行变量提升的 visitor
 * 将所有可提升的变量插入到对应的位置
*/
export function scopeDeclarationVisitor(
  ctx: ts.TransformationContext,
  hoistedVariables: HoistState[]
): ts.Visitor {
  const visitor: ts.Visitor = node => {
    // 所有应该插入到该节点之下的 jsx 申明
    const matched = hoistedVariables.filter(v => node.pos === v[1].pos)
    if (matched.length) {
      const statements = matched.map(m => m[0])
      const scope = node

      // 针对不同种类的 node，对应不同的插入方法
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
        return ts.updateCaseClause(
          scope, scope.expression,
          createStatements(matched, scope.statements.map(s => ts.visitNode(s, visitor)))
        )
      }
    }
    return ts.visitEachChild(node, visitor, ctx)
  }

  return visitor
}

/**
 * 寻找某个引用的变量的申明语句以及离该处引用的高度（treeNode 意义上的高度
 * @param id 引用的节点
 * 具体方法时不断寻找 parent，如果遇到函数作用域或者块作用域
 * 则扫描一遍该作用域下所有语句（findDeclaration 的作用），查找该变量申明
 * 如果没有找到，则继续搜索 parent 的 parent，直到找到为止
 */
function findNearestDeclaration(id: ts.Identifier) {
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

// 查找某一个 bindingName 是否包含需要查找的变量
function findBinding(name: ts.BindingName, id: ts.Identifier): ts.Node | undefined {
  if (ts.isIdentifier(name) && name.getText() === id.getText()) {
    return name
  } else if (ts.isObjectBindingPattern(name)) {
    return name.elements.find(e => findBinding(e.name, id))
  } else if (ts.isArrayBindingPattern(name)) {
    return name.elements.find(e => ts.isBindingElement(e) && findBinding(e.name, id))
  }
}

/**
 * 此方法查找当前作用域下是否有需要查找的变量的声明语句
 * @param node 当前查找的作用域
 * @param id 需要查找的变量
 * 返回变量申明语句所在节点
 */
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

  // 如果当前节点是函数或者方法，则先从参数列表中查找，如果找到直接返回参数节点，否则递归查找函数体
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

  // 如果是 for 类语句，则先查找 for 括号 中的变量绑定，和上面函数做法类似
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    if (node.initializer && ts.isVariableDeclarationList(node.initializer) && lookUp(node.initializer)) {
      return node.initializer
    }
    return findDeclaration(node.statement, id)
  }

  // 查找当前作用域下所有语句，变量申明可能存在于：变量声明语句， import 语句，函数声明语句，类声明语句中
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

/**
 * 寻找某个申明语句所在的函数或者块作用域
 */
function lookUpScope(node: ts.Node) {
  let cur = node.parent || node
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
