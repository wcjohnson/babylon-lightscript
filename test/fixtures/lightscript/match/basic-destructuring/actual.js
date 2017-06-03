match x:
  | a: 1
  | b: b
  | c as c: c
  | as as as: as
  | ~isNumber() as n: n + 1
