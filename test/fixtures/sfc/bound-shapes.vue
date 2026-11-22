<template>
  <p :class="{ 'p-1': a, 'm-1': b }">object</p>
  <p :class="['p-2', b, { 'm-2': c }, ...rest]">array</p>
  <p :class="ok ? 'p-3' : 'm-3'">ternary</p>
  <p :class="ok && 'p-4'">logical and</p>
  <p :class="size ?? 'p-5'">nullish coalescing</p>
  <p :class="`p-${n} m-6`">template literal</p>
  <p :class="cn('p-7', ok && 'm-7')">call</p>
  <p :class="sizes[size]">lookup</p>
  <p :class="'p-8 ' + extra">concatenation</p>
  <p v-bind:class="[a, 'p-9']">long form</p>
  <p :class='["p-10", b]'>single quotes</p>
  <p :class=bare>unquoted</p>
  <p
    :class="[
      'p-11',
      ok && 'm-11',
    ]"
  >multi-line</p>
  <p :class="/* note */ 'p-12'">block comment</p>
  <p :class="ok // note
">line comment before a line break</p>
  <p :class="a?.b ?? 'p-13'">optional chaining</p>
  <p :class="(() => 'p-14')()">arrow function</p>
  <p :class="/\)/.test(x) ? 'p-15' : ''">regular expression</p>
  <p :class="">empty</p>
  <p :class="  ">blank</p>
  <p :class="{ 'é': x, 'p-16': y }">non-ASCII key</p>
</template>
