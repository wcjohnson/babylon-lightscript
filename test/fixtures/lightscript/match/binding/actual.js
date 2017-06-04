match x:
  | ~isArray() with [ first ]: first
  | ~isObject() with { second: third }: third
