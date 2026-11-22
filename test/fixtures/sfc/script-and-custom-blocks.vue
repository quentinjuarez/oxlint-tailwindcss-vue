<script setup lang="ts">
const html = '<p class="in-script"></p>';
</script>

<template>
  <p class="p-1">template</p>
</template>

<style scoped>
.in-style { color: red; }
</style>

<docs>
<p class="in-docs"></p>
</docs>

<i18n lang="json">
{ "en": { "html": "<b class=\"in-i18n\"></b>" } }
</i18n>
