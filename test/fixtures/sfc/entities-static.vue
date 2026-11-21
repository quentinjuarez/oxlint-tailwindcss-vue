<template>
  <p class="[&amp;>*]:p-2">ampersand entity</p>
  <p class="[&>svg]:size-4 [&_p]:mt-2">bare ampersands</p>
  <p class="before:content-[&quot;x&quot;]">quote entity</p>
  <p class='before:content-[&#39;y&#39;]'>numeric entity</p>
  <p class="p-1&#x20;m-1">hex entity</p>
  <p class="[&gt]:p-1">legacy entity without a semicolon</p>
  <p class="&copy-x">legacy entity before a dash</p>
  <p class="&copyx">legacy name before a letter</p>
  <p class="p-2&nbsp;m-2">no-break space entity</p>
</template>
