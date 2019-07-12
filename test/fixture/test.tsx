import React from 'react'
import i18n from 'i18n'

import { Component1 } from 'component'
import Component2 from 'component2'

const a = '3';
(function (b) {

  function render2(a) {
    return () => (<Component2 a={a} />);
  }

  class App extends React.Component {
    private static OI = 123
    as = 'as'

    render() {
      return (
        <div>
          <p/>
          <AppItem />
          { 3 }

          { i18n.get('title') }
        </div>
      );
    }

    renderCompo() {
      return <div>{ App.OI }</div>
    }

    renderApp() {
      return () => <div>{ i18n.get('title') }</div>
    }

    renderFor = () => {
      for (let a = 3; a < 10; a++) {
        const renderFunc = () => <div>{a}</div>
      }
    }
  }

  const AppItem = () => {
    return <div className={ a } />
  };

  const AppItem2 = () => <div className={a}>{ b }</div>
  const AppItem3 = () => <div className={a} data-hint={ i18n.get('title') } >{ b }</div>

  const renderApp = (c: string) => (q: number) => () => <div>{c}{q}</div>
  const renderApp2 = (c: string) => (q: number) => () => <div>{c}</div>

  function render() {
    // intentionally ignoring props
    return () => <Component2/>;
  }

  function withFunc() {
    return () => <Component1 renderA={ render2 } />
  }

  const AppApp = (c) => <Component1>{ b + 3 ? a : a[c] }</Component1>
});

function render({ text, className, id, ...props }) {
  // intentionally ignoring props
  return () => (<Component1 text={text} className={className} id={id} />);
}

function render2({ text, className, id, ...props }) {
  // intentionally ignoring props
  return () => (<div text={text} className={className} id={id} {...props} />);
}

const TableCell = ({ text }) => {
  function onClick(e) {
    console.log('Clicked' + text);
    e.stopPropagation();
  }

  return <td className="TableCell" onClick={onClick}>{text}</td>;
}

const Row = ({ text }) => {
  const [state, setState] = React.useState(3)

  if (state > 3) {
    const b = 7
    return <div data-id={state} onClick={ setState }>{b}</div>
  }
  return <div>{text}</div>
}
