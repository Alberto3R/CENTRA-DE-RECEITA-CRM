// Google OAuth 2.0 — helpers para o fluxo de conexão da agenda (multi-tenant).
//
// UM app OAuth do PRODUTO (GOOGLE_CLIENT_ID/SECRET no ambiente). Cada conta do
// CRM conecta a própria agenda pelo consent do Google; guardamos o refresh
// token (cifrado) por conta em `google_connections`. Aqui só a mecânica de
// OAuth (sem tocar no banco) — via fetch nos endpoints REST, sem dependência.

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

// Escopos MÍNIMOS (menos atrito na verificação do Google):
//   calendar.events   — SENSÍVEL: criar o evento (com Meet) na agenda escolhida.
//                       É o único que exige justificativa + vídeo na verificação.
//   calendar.freebusy — NÃO sensível: ler só livre/ocupado pra ofertar horário.
//   openid + email    — identificar qual conta Google foi conectada (mostrar na UI).
// NÃO pedimos calendar.readonly de propósito: é amplo demais (lê todos os eventos)
// e complica a verificação. O seletor de agenda funciona colando o ID da agenda
// (listCalendars dá 403 sem readonly → a UI cai no modo manual, já tratado).
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "openid",
  "email",
];

/**
 * Origem PÚBLICA da requisição (https + host real), lida dos headers de proxy.
 * Atrás do Vercel, `new URL(request.url)` costuma vir com scheme `http://`
 * (TLS termina na borda) e host interno — o que quebra o match do redirect_uri
 * no Google. x-forwarded-host + x-forwarded-proto dão o domínio público certo.
 */
export function publicOrigin(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return `${proto}://${host}`;
}

export function googleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID não configurado");
  return id;
}
function googleClientSecret(): string {
  const s = process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error("GOOGLE_CLIENT_SECRET não configurado");
  return s;
}

/**
 * URI de callback do produto. Ordem: override explícito (GOOGLE_REDIRECT_URI) >
 * origem da requisição (o domínio em que o usuário está AGORA) > site padrão.
 * Preferir a origem garante que connect e callback caiam no MESMO domínio — o
 * CRM roda em vários (www.centraldereceita.com.br, vendas.sales3r.com.br), e o
 * cookie de state + a sessão são por-domínio. Basta cadastrar cada domínio nos
 * "redirect URIs autorizados" do Google.
 */
export function googleRedirectUri(requestOrigin?: string): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI;
  if (explicit) return explicit;
  const base =
    requestOrigin?.replace(/\/$/, "") ??
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "";
  return `${base}/api/google/callback`;
}

/** URL de consentimento do Google. `state` amarra o callback à conta/usuário. */
export function buildAuthUrl(state: string, requestOrigin?: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: googleRedirectUri(requestOrigin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // pra receber refresh_token
    prompt: "consent", // força refresh_token mesmo em reconexão
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // segundos
  scope?: string;
  id_token?: string;
}

/** Troca o `code` do callback por tokens. */
export async function exchangeCode(
  code: string,
  requestOrigin?: string,
): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: googleRedirectUri(requestOrigin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha na troca de código Google (${res.status}): ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  return (await res.json()) as GoogleTokens;
}

/** Gera um novo access_token a partir do refresh_token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number; scope?: string }> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao renovar token Google (${res.status}): ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  return (await res.json()) as { access_token: string; expires_in: number; scope?: string };
}

/** E-mail da conta Google conectada (pra exibir na UI). */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}
