match x:
  | ~isObject() with {y}: match y:
    | > 10: "soo big"
    | > 5: "still pretty big"
    | else: "kinda big"
  | else: "some other thing"
