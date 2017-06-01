a = match x:
  | 3 with (three): three
  | 4 with ({ four = 4 }): four
  | 5 with ({ five = 5 }): five
