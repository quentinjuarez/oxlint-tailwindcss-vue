<template>
  <p :class="ok &amp;&amp; 'p-1'">ampersand entities</p>
  <p :class="&quot;p-2&quot;">quote entities</p>
  <p :class="'&copy-x'">legacy entity before a dash</p>
  <p :class="'&copyx'">legacy name before a letter</p>
  <p :class="{ '[&>svg]:p-3': ok }">bare ampersand</p>
  <p :class="n &lt; 2 ? 'p-4' : 'm-4'">less-than entity</p>
</template>
