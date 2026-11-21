<template>
  <p class="content-['\201C']">octal-like escape</p>
  <p class="content-['a\_b']">underscore escape</p>
  <p class="content-['\0'] p-1">null escape</p>
  <p class="content-['\00']">null escape followed by a digit</p>
  <p class="content-['\8']">digit escape</p>
  <p class="content-['\x41']">hex escape</p>
  <p class="content-['\xZZ']">malformed hex escape</p>
  <p class="content-['\u00e9']">unicode escape</p>
  <p class="content-['\u{1F600}']">code point escape</p>
  <p class="content-['\u{110000}']">code point out of range</p>
  <p class="content-['\u12']">malformed unicode escape</p>
  <p class="a\\1">escaped backslash</p>
  <p class="p-2 \
    p-3">line continuation</p>
  <p class="trailing\">trailing backslash</p>
  <p class="p-4`\_">backtick and backslash</p>
</template>
