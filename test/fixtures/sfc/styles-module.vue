<template>
  <p :class="$style.local"></p>
</template>

<style module>
.local { color: red; }
:global(.shared) { color: blue; }
.local :global(.deep) { color: green; }
</style>
