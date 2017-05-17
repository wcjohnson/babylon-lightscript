match x:
  | 1 with y: y
  | ~isArray() with [ first ]: first
  | ~isObject() with { second: third }: third
