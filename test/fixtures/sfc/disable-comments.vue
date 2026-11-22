<template>
  <!-- oxlint-disable-next-line tailwindcss/no-unknown-classes -->
  <p class="p-1">next line</p>
  <!--oxlint-disable-line-->
  <!--
    eslint-disable tailwindcss/no-unknown-classes
  -->
  <p class="p-2"><!-- eslint-enable --></p>
  <!-- oxlint-enable -->
  <div v-pre><!-- eslint-disable-line --></div>
  <!-- note: oxlint-disable must start the comment -->
  <!-- eslint-disable-next-line */ -->
  <!-- <p class="in-comment"></p> -->
  <textarea><!-- oxlint-disable --></textarea>
</template>
