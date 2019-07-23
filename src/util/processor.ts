import * as ts from 'typescript'
import { HoistState } from '../transform'

export abstract class Processor {
  static readonly processorList: readonly Processor[] = []

  static test: (node: ts.Node) => boolean

  static isNodeEqual(l?: ts.Node, r?: ts.Node): boolean {
    return l && r && l.pos === r.pos
  }

  static createStatements(matched: HoistState[], initialStatements: readonly ts.Statement[]) {
    return matched.reduce((res, m) => {
      const index = res.findIndex(s => Processor.isNodeEqual(m[2], s))
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

  abstract updateNode(node: ts.Node): ts.Node
}
