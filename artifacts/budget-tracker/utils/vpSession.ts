let _vpSessionToken: string | null = null;

export function setVpSessionToken(token: string): void {
  _vpSessionToken = token;
}

export function getVpSessionToken(): string | null {
  return _vpSessionToken;
}
