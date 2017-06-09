match x:
  | it~isArray() with [ first ]: first
  | it~isObject() with { second: third }: third
