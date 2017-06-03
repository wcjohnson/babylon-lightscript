match x:
  | {
    a: [
      b
      {
        d
        e: 'e'
        ...f
      }
      g
    ]
    h = 'h'
    ...i
  }:
    [b, d, ...f, g, h, i].join('')
