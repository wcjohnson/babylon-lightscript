match x:
  | a: 1
  | b with b -> b
  | c with (c) -> c
  | d with ({ d }) -> d
  | e with ({ e = 1 }) -> e
  | f with ([ f ]) -> f
  | g with ([ g = 1 ]) -> g
  | h with => 1
  | i with i => i
  | j with (j) => j
