match x:
  | {
    a: [
      b
      {
        d
        e = 1
        ...f
      }
      g
    ]
    h = 'h'
    ...i
  }:
    [b, d, ...f, g, h, i].join('')
