<script setup lang="ts">
const props = defineProps<{ size?: string; tone: 'a' | 'b' }>();
</script>

<template>
  <p :class="(props.size as string) ?? 'p-1'">as</p>
  <p :class="{ 'p-2': true } satisfies Record<string, boolean>">satisfies</p>
  <p :class="props.size!">non-null assertion</p>
  <p :class="<string>props.tone">angle-bracket assertion</p>
  <p :class="pick<string>('p-3')">generic call</p>
  <p :class="(<T,>(value: T) => value)('p-4')">generic arrow function</p>
</template>
