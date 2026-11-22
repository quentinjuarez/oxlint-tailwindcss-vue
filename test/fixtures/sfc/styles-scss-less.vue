<template>
  <p class="card"></p>
</template>

<style lang="scss">
// .line-comment { }
.card {
  &__title { color: red; }
  &--active { color: blue; }
  #{$prefix}-dynamic { }
}
</style>

<style lang="less">
.panel { &-header { color: red; } }
.@{prefix}-dyn { }
</style>
