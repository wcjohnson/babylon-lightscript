f() -/>
  <- match x:
    | a with -/> 1
    | b with -/>
      <- z()
    | c with async y => await y
    | d with =/> d()
    | e with => e()
