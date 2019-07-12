import React from 'react';
function (a) {
    return React.createElement("div", null, a);
}
function render() {
    const b = 3;
    return React.createElement("div", null, b);
}
function asd(b) { const hoisted_constant_element_1 = _.memoize(() => React.createElement("div", null, b)); return () => hoisted_constant_element_1(); }
