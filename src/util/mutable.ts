import * as ts from 'typescript'
import { Opts } from '../transform'

/**
 * Check if an attribute is mutable (having non-primitive values)
 *
 * @param {ts.JsxAttributeLike} attr attribute
 * @returns {boolean} true if mutable, false otherwise
 */
function isMutableProp(attr: ts.JsxAttributeLike, opt?: Opts) {
  // {...props} spread operator's definitely mutable
  if (ts.isJsxSpreadAttribute(attr)) {
    return true;
  }
  const { initializer, name } = attr;
  if (name.getText() === 'ref') {
    return true
  }

  // cases like <button enabled />
  if (!initializer) {
    return false;
  }
  // foo="bar"
  if (ts.isStringLiteral(initializer)) {
    return false;
  }

  if (ts.isJsxExpression(initializer)) {
    return isMutableExpression(initializer, opt)
  }
  return true;
}

function isMutableExpression(expression: ts.Expression, opt?: Opts): boolean | ts.Identifier[] {
  if (opt && opt.constantReg && opt.constantReg.test(expression.getText())) {
    return false
  }
  if (
    // foo={true}
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    // foo={false}
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    // foo={1}
    ts.isNumericLiteral(expression) ||
    // foo={"asd"}
    ts.isStringLiteral(expression)
  ) {
    return false;
  } else if (ts.isIdentifier(expression)) {
    return [expression]
  } else if (ts.isPropertyAccessExpression(expression)) {
    return isMutableExpression(expression.expression, opt)
  } else if (ts.isBinaryExpression(expression)) {
    return isMutableOverAll(
      () => isMutableExpression(expression.left, opt),
      () => isMutableExpression(expression.right, opt)
    )
  } else if (ts.isElementAccessExpression(expression)) {
    return isMutableOverAll(
      () => isMutableExpression(expression.expression, opt),
      () => isMutableExpression(expression.argumentExpression, opt)
    )
  } else if (ts.isConditionalExpression(expression)) {
    return isMutableOverAll(
      () => isMutableExpression(expression.condition, opt),
      () => isMutableExpression(expression.whenFalse, opt),
      () => isMutableExpression(expression.whenTrue, opt)
    )
  } else if (ts.isJsxExpression(expression)) {
    return isMutableExpression(expression.expression, opt)
  } else if (ts.isPrefixUnaryExpression(expression)) {
    if (expression.operator === ts.SyntaxKind.ExclamationToken || expression.operator === ts.SyntaxKind.TildeToken)
      return isMutableExpression(expression.operand)
  } else if (ts.isTemplateExpression(expression)) {
    if (expression.templateSpans.length) {
      return isMutableOverAll(
        ...expression.templateSpans.map(s => () => isMutableExpression(s.expression))
      )
    }
    return false
  } else if (opt.aggressive && ts.isCallExpression(expression)) {
    return isMutableOverAll(
      () => isMutableExpression(expression.expression),
      ...expression.arguments.map(a => () => isMutableExpression(a)),
    )
  }
  return true
}

export function isMutableElement(el: ts.Node, opt?: Opts): boolean | ts.Identifier[] {
  if (ts.isJsxSelfClosingElement(el) || ts.isJsxOpeningElement(el)) {
    return isMutableJsxElement(el, opt)
  } else if (ts.isJsxText(el) || ts.isJsxClosingElement(el) || ts.isJsxClosingFragment(el) || ts.isJsxOpeningFragment(el)) {
    return false
  } else if (ts.isJsxElement(el)) {
    const res = isMutableOverAll(
      () => isMutableElement(el.openingElement, opt),
      ...el.children.map(c => () => isMutableElement(c, opt))
    )
    // console.log(el.getText(), (res !== true && res as any !== false) ? (res as any).map((r: any) => r.getText()) : res)
    return res
  } else if (ts.isJsxExpression(el)) {
    return isMutableExpression(el, opt)
  } else if (ts.isJsxFragment(el)) {
    return isMutableOverAll(
      ...el.children.map(c => () => isMutableElement(c, opt))
    )
  }
  return true
}

function isMutableJsxElement(el: ts.JsxSelfClosingElement | ts.JsxOpeningElement, opt?: Opts) {
  return isMutableOverAll(
    () => isMutableTagName(el.tagName),
    () => {
      return el.attributes && el.attributes.properties && el.attributes.properties.length &&
        isMutableOverAll(
          ...el.attributes.properties.map(p => () => isMutableProp(p, opt))
        )
    }
  )
}

function isMutableOverAll(...funcs: (() => boolean | ts.Identifier | ts.Identifier[])[]) {
  let ids: ts.Identifier[] = []
  for (let index = 0; index < funcs.length; index++) {
    const res = funcs[index]()
    if (res === true) {
      return true
    }
    if (res) {
      ids = ids.concat(res)
    }
  }
  return ids.length ? ids : false
}

function isMutableTagName(tagName: ts.JsxTagNameExpression) {
  if (ts.isIdentifier(tagName)) {
    if (tagName.getText().match(/^[a-z]/)) {
      return false
    }
    return tagName
  }
  return true
}
