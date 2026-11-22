<script setup lang="ts">
const title = 'App';
const wide = true;
</script>

<template>
  <div class="flex p-4 not-a-tailwind-class">
    <h1 class="text-lg font-bold text-lg">{{ title }}</h1>
    <p class="m-1 m-2">conflict</p>
    <p :class="wide ? 'w-full w-1/2' : 'w-auto'">ternary</p>
    <p class="card">from the style block</p>
    <!-- oxlint-disable-next-line tailwindcss/no-unknown-classes -->
    <p class="disabled-unknown">disabled</p>
    <p>Été déjà vu 😀 <span class="accent-unknown">accents</span></p>
  </div>
</template>

<style>
.card {
  color: red;
}
</style>
