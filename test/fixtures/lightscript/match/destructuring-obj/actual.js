match x:
  | { a, b } and a > 1: a + b
  | { a, b }: a - b
  | { a, b = 2 }: a + b - 2
  | { a: 'a', b: 'c', d = 'e' }: [a, b, d].join('')
  | {
    a: {
      b: 'c'
      d = 'e'
    }
    f: { g: 'g', h = 'h' }
  }:
    [b, d, g, h].join('')
  | { a, b: 'b', ...c }: [a, b, c].join('')
