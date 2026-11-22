<template>
  <div v-pre class="p-1 {{ raw }}" :class="kept">
    <span class="p-2" :class="a" v-bind:class="b" .class="c" #class="d" @class="e" v-model:class="f">{{ g }}</span>
    <template v-if="h" class="p-3"></template>
  </div>
  <div :class="before" v-pre class="p-4" :ui="u"></div>
  <p :class="'p-5'">after v-pre</p>
</template>
