import compile from "../compile";
import { resolve } from "path";
import * as fs from 'fs';
// import { expect } from "chai";
import { Opts as PathTransformOpts } from "../src";
// import { readFile } from "fs-extra";

const opts: PathTransformOpts = {
  verbose: true,
  constantReg: /i18n.get\(.*\)/,
  aggressive: true,
  lazyFunc: 'true'
};

describe("transformer", function() {
  this.timeout(5000);

  fs.readdirSync(resolve(__dirname,'fixture')).forEach(file => {
    if (file.endsWith('tsx')) {
      it('test', () => {
        compile(resolve(__dirname, `fixture/${file}`), opts)
        return true
      })
    }
  })

});
