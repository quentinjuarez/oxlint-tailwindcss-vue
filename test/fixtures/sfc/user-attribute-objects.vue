<template>
  <UCard :ui="{ root: 'unknown-a' }" />
  <UCard :ui="{ 'root': 'unknown-b' }" />
  <UCard :ui="{ 'root': ok ? 'unknown-c' : '' }" />
  <UCard :ui="{ body: { base: 'unknown-d' } }" />
  <UCard :ui="'unknown-e'" />
  <UCard :ui="['unknown-f']" />
  <UCard :ui="ok ? 'unknown-g' : ''" />
  <UCard ui="p-1" :class="{ 'p-2': ok }" />
  <UCard v-bind:ui="{ root: 'p-3' }" />
  <RouterLink :active-class="{ 'p-4': ok }" />
  <p :active-class="{ root: 'p-5' }" data-ui="p-6" :data-ui="{ root: 'p-7' }"></p>
</template>
