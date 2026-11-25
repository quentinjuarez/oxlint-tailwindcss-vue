<template>
  <nav class="flex gap-4">
    <NuxtLink to="/" active-class="font-bold nav-unknown" prefetched-class="prefetch-unknown">Home</NuxtLink>
    <nuxt-link to="/about" exact-active-class="underline underline">
      About
    </nuxt-link>
  </nav>
</template>
