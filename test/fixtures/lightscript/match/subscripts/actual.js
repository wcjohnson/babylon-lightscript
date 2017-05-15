match x:
  | .a: 'has a'
  | ['b']: 'has b'
  | ?.c: 'has c'
  | ?[d]: 'has d'
  | .0: 'has first elem'
  | ~isFunction(): 'its a func'
