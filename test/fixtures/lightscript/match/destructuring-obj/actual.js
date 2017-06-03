match x:
  | ~isObject() and { a, b } and a~isNumber() and a > 1: a + b
  | { a, b }: a - b
  | { a, b = 2 }: a + b - 2
  | {
    a: {
      b
      d = 'e'
    }
    f: { ...g }
  }:
    [b, d, g].join('')
  | { a, ...c }: [a, b, c].join('')
