match x:
  | a, -> 1
  | b, b -> b
  | c, (c) -> c
  | d, ({ d }) -> d
  | e, ({ e = 1 }) -> e
  | f, ([ f ]) -> f
  | g, ([ g = 1 ]) -> g
  | h, => 1
  | i, i => i
  | j, (j) => j
