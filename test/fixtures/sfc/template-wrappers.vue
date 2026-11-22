<template>
  <template v-if="a" class="p-1" :class="'m-1'"><b class="p-2">if</b></template>
  <template v-else-if="b" :class="'m-2'"><b :class="'p-3'">else if</b></template>
  <template v-else class="p-4"><b>else</b></template>
  <template v-for="item in items" :key="item" :class="item"><i class="p-5">{{ item }}</i></template>
  <Card>
    <template #header="{ cls }" class="p-6"><div :class="cls" class="m-6">header</div></template>
    <template v-slot:default :class="'p-7'"><p class="m-7">body</p></template>
  </Card>
</template>
