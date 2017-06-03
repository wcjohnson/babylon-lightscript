match x:
  | .a as { a, b = 1 }: a + b
  | .0 and .1 as [ a, b ]: a + b
