<template>
  <div class="card unknown-scope">
    <h2 class="title">x</h2>
    <p class="content"></p>
  </div>
</template>

<style>
@scope (.card) to (.content) {
  :scope { padding: 1rem; }
  .title { font-weight: 700; }
}
@scope (.panel, .sheet) {
  .body { margin: 0; }
}
</style>
