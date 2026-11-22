<template>
  <MyButton class="p-1" :class="'m-1'">component</MyButton>
  <my-button class="p-2">kebab component</my-button>
  <component :is="tag" class="p-3" :class="'m-3'">dynamic component</component>
  <svg class="size-4" viewBox="0 0 1 1">
    <path class="fill-current" :class="'stroke-1'" d="M0 0" />
    <foreignObject><div class="p-4">HTML inside SVG</div></foreignObject>
  </svg>
  <math class="p-5"><mi class="m-5">x</mi></math>
  <slot name="footer" class="p-6" :class="'m-6'"></slot>
  <template class="p-7"><b class="m-7">native template</b></template>
  <Transition enter-active-class="transition" :leave-to-class="'opacity-0'">
    <p v-if="open" class="p-8">transition child</p>
  </Transition>
  <RouterLink to="/" :active-class="'font-bold'">link</RouterLink>
  <UiCard :ui="ui ?? 'p-9'" :content-class="'m-9'">user attributes</UiCard>
</template>
