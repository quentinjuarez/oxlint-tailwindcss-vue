<template>
  <p class="p-1" :class="x // c">line comment</p>
  <p :class="a; b" class="p-2">two statements</p>
  <p :class="['a'">unbalanced bracket</p>
  <p :class="'p-3'">valid</p>
  <p :class="a <!-- b -->">HTML comment</p>
  <p :class=foo/>
  <p :class="'p-4'">valid after an unquoted value that ate the slash</p>
</template>
