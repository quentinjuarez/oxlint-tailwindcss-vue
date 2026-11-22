<template>
  <p :[name]="'p-1'">dynamic argument</p>
  <p v-bind:['class']="'p-2'">dynamic argument with a literal</p>
  <p @class="onClass">event</p>
  <p v-on:class="onClass">long event</p>
  <Field v-model:class="model">model</Field>
  <p v-bind="{ class: 'p-3' }">object</p>
  <p :="{ class: 'p-4' }">object shorthand</p>
  <p v-tooltip:class="tip">custom directive</p>
  <p :class>same-name shorthand</p>
  <p v-bind:class>same-name long form</p>
  <Card #class="{ value }">slot named class</Card>
</template>
