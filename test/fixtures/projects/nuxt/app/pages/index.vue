<script setup lang="ts">
const highlighted = ref(true);
</script>

<template>
  <section>
    <h1 class="text-brand text-3xl">Home</h1>
    <p :class="highlighted ? 'p-2 p-4' : 'p-2'">Welcome</p>
    <ClientOnly>
      <p class="hidden md:block">Client only</p>
    </ClientOnly>
  </section>
</template>
