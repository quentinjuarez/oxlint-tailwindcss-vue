<template>
  <UCard :ui="{ root: 'unknown-a' }" />
  <UCard :ui="{ 'root': 'unknown-b' }" />
  <UCard :ui="{ 'root': ok ? 'unknown-c' : '' }" />
  <UCard :ui="{ body: { base: 'unknown-d' } }" />
  <UCard :ui="'unknown-e'" />
  <UCard :ui="['unknown-f']" />
  <UCard :ui="ok ? 'unknown-g' : ''" />
  <UCard :ui="{ body: { 'unknown-h': ok } }" />
</template>
