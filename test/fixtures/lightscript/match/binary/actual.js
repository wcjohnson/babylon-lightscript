match x:
  | > 2, -> "bigger than two"
  | > 3 and > 2, -> "so cool"
  | + 3 == 4, -> "its one shhh"
  | +1 or -1, -> "equal to one or negative one"
  | -1 or +1, -> "equal to one or negative one"
  | instanceof Class, -> "its a Class thing!"
  | ** 2 == b ** 2 + c ** 2, -> "triangle?"
