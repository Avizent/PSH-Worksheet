import { getSessionToken } from "@/lib/authSession";

/**
 * fetch() with the signed-in user's session attached.
 *
 * The generated query hooks go through customFetch, which picks up the session
 * header from setDefaultHeaders (see contexts/AuthContext.tsx). Screens that
 * call fetch() directly — file uploads, blob downloads, exports — bypass that,
 * so they must use this instead. Since the API is gated globally, a bare
 * fetch() to /api now returns 401.
 *
 * Share-link requests (board-view) and the auth endpoints themselves are the
 * only ones that should still call fetch() directly.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-user-session", token);
  return fetch(input, { ...init, headers });
}
