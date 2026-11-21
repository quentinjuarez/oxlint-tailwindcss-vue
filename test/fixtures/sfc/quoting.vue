<template>
  <p class="p-1 m-1">double quotes</p>
  <p class='p-2 m-2'>single quotes</p>
  <p class = "p-3">spaces around the equals sign</p>
  <p class="">empty value</p>
  <p class>no value</p>
  <p class="before:content-['x']">single quotes inside</p>
  <p class='after:content-["y"]'>double quotes inside</p>
  <p class="p-4`">backtick</p>
  <p class='p-5${x}'>dollar brace</p>
  <p class="p-6`
    p-7">backtick on two lines</p>
  <p class=flex >unquoted with room</p>
  <p class=grid>unquoted without room</p>
  <p class=a'b'>quote in an unquoted value</p>
  <p class=a`b >backtick in an unquoted value</p>
  <p class=p-8${x} >dollar brace in an unquoted value</p>
  <p class=
p-9 >unquoted value right after a line break</p>
  <p class=m-9
  >unquoted value right before a line break</p>
</template>
