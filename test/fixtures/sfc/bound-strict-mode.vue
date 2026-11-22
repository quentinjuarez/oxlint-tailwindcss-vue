<template>
  <p :class="static ? 'p-1' : 'm-1'">reserved word in strict mode</p>
  <p class="p-2">kept</p>
  <p :class="yield">reserved identifier</p>
  <p :class="010 && 'p-3'">legacy octal literal</p>
  <p :class="'p-4'">kept</p>
</template>
