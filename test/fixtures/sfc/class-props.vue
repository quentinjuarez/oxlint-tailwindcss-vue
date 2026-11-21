<template>
  <Transition enter-active-class="transition duration-200" leaveToClass="opacity-0">
    <p v-if="open">content</p>
  </Transition>
  <transition-group move-class="transition-transform" tag="ul"><li key="a">a</li></transition-group>
  <RouterLink to="/" active-class="font-bold" exactActiveClass="underline">home</RouterLink>
  <nuxt-link to="/" exact-active-class="text-red-500">nuxt</nuxt-link>
  <div enter-active-class="not-checked" active-class="not-checked">plain element</div>
  <UiCard content-class="p-2  m-2
    rounded" header-class="a&amp;b">user attributes</UiCard>
</template>
