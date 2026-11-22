<template>
  <p :class="static ? 'p-1' : 'm-1'">reserved word in strict mode</p>
  <p class="p-2">kept</p>
  <p :class="yield">reserved identifier</p>
  <p :class="010 && 'p-3'">legacy octal literal</p>
  <p :class="'p-4'">kept</p>
  <p :class="'\1' && 'p-5'">numeric escape in a string</p>
  <p class="p-6">kept</p>
</template>
