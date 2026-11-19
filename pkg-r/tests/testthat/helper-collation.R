# testthat runs each test with C collation, the order the radix sort uses
# anyway. Text order that has to match Python's whatever the user's locale
# is checked under an English locale too, where sort() puts "a" before "B".
with_english_collation <- function(code) {
  old <- Sys.getlocale("LC_COLLATE")
  on.exit(Sys.setlocale("LC_COLLATE", old), add = TRUE)
  for (loc in c("en_US.UTF-8", "en_US.utf8", "English_United States.utf8",
                "English_United States.1252", "English")) {
    if (suppressWarnings(Sys.setlocale("LC_COLLATE", loc)) != "") {
      return(force(code))
    }
  }
  testthat::skip("no English collation locale on this machine")
}
