// import * as ts from 'typescript'
// import * as utils from 'tsutils'

// const searchIdentifierInBindingName = (name: ts.BindingName, id: ts.Identifier): ts.Node => {
//   if (ts.isIdentifier(name) && name.getText() === id.getText()) {
//     return name
//   } else if (ts.isObjectBindingPattern(name)) {
//     return name.elements.find(e => searchIdentifierInBindingName(e.name, id))
//   } else if (ts.isArrayBindingPattern(name)) {
//     return name.elements.find(e => ts.isBindingElement(e) && searchIdentifierInBindingName(e.name, id))
//   }
// }

// const lookUp = (node: ts.Node, id: ts.Identifier): ts.Node | undefined => {
//   if (
//     (
//       ts.isVariableDeclaration(node)
//       || ts.isImportSpecifier(node)
//       || ts.isImportClause(node)
//     ) && node.name
//   ) {
//     const name = node.name
//     const bindingEle = searchIdentifierInBindingName(name, id)
//     if (bindingEle) {
//       return bindingEle
//     }
//   }

//   if (node.getChildCount()) {
//     for (const c of node.getChildren()) {
//       const res = lookUp(c, id)
//       if (res) {
//         return res
//       }
//     }
//   }
// }

// export abstract class HoistEntry {
//   protected readonly statement: ts.VariableStatement

//   constructor(protected readonly jsxElement: ts.JsxElement, protected readonly identifiers: ts.Identifier[]) {
//     this.statement = this.toDeclarationStatement()
//   }

//   protected abstract searchDeclarationInScope(scope: ts.Node, id: ts.Identifier): ts.Node

//   protected abstract findNearestScopeEntry(): ts.Node

//   protected abstract insertHoistedStatement(): ts.Node

//   protected toDeclarationStatement() {
//     const variable = ts.createUniqueName(`hoisted_constant_element`)
//     return ts.createVariableStatement(
//       undefined,
//       ts.createVariableDeclarationList([
//         ts.createVariableDeclaration(variable, undefined, this.jsxElement)
//       ], ts.NodeFlags.Const)
//     )
//   }

//   private findNearestScope(id: ts.Identifier) {
//     let cur: ts.Node = id
//     let height = 0
//     while (cur) {
//       while (!utils.isScopeBoundary(cur) && cur.parent) {
//         cur = cur.parent
//       }
//       const res = this.searchDeclarationInScope(cur, id)

//       if (res) {
//         return [res, height] as const
//       }
//       if (!cur.parent) {
//         return [cur, height] as const
//       }
//       cur = cur.parent
//       height += 1
//     }
//   }
// }
