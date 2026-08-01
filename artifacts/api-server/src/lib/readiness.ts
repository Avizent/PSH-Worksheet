let schemaReady = false;

export function markSchemaReady(): void {
  schemaReady = true;
}

export function isSchemaReady(): boolean {
  return schemaReady;
}
