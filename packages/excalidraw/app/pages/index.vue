<script setup lang="ts">
const { client, context, loading, error } = useHost()
</script>
<template>
  <p v-if="loading" class="message" role="status">Connecting to your workspace…</p>
  <p v-else-if="error" class="message error" role="alert">{{ error }}</p>
  <template v-else-if="client && context">
    <WorkspaceLauncher v-if="context.surface === 'workspace'" :client="client" />
    <DocumentEditor v-else-if="context.surface === 'file'" :client="client" :file="context.file" />
  </template>
</template>
