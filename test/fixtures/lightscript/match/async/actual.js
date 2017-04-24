f() -/>
  <- match x:
    | a, -/> 1
    | b, -/>
      <- z()
    | c, async y => await y
    | d, =/> d()
    | e, => e()
