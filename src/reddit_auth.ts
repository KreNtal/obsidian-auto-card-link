import { requestUrl } from "obsidian";

// Reddit "installed app" OAuth client — see reddit.com/prefs/apps. Installed apps are public
// clients by design (no secret to protect), so it's safe to ship this id in the plugin.
// Leave empty to disable Reddit login entirely; the legacy anonymous scrape is used instead.
export const REDDIT_CLIENT_ID = "";
// Reddit requires a descriptive User-Agent on API calls. Format per Reddit's API rules:
// <platform>:<app id>:<version> (by /u/<your reddit username>).
export const REDDIT_USER_AGENT = "obsidian-plugin:auto-card-link-enhanced:1.0 (by /u/CHANGE_ME)";
// Registered as this app's redirect URI on reddit.com/prefs/apps. Obsidian's own custom URI
// scheme — works identically on desktop and mobile, no local server needed.
export const REDDIT_REDIRECT_URI = "obsidian://auto-card-link-enhanced-reddit-auth";
// The action name Main.ts registers via registerObsidianProtocolHandler — must match the
// path segment right after "obsidian://" above.
export const REDDIT_AUTH_PROTOCOL_ACTION = "auto-card-link-enhanced-reddit-auth";

export interface RedditTokens {
   accessToken: string;
   accessTokenExpiresAt: number; // epoch ms
   refreshToken: string;
}

// TypeScript's DOM typings flag the global btoa as deprecated (Node-oriented advice that
// doesn't apply to this browser/Electron renderer context), which trips this project's
// no-deprecated lint rule — so base64 is encoded by hand instead of silencing the warning.
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// 0-63 is always in range for a 64-character alphabet — the `!` just satisfies
// noUncheckedIndexedAccess, which can't see that from the `& 63` mask.
const b64 = (i: number): string => BASE64_ALPHABET[i]!;

function toBase64(bytes: Uint8Array): string {
   let result = "";
   let i = 0;
   for (; i + 2 < bytes.length; i += 3) {
      const chunk = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
      result += b64((chunk >> 18) & 63) + b64((chunk >> 12) & 63) + b64((chunk >> 6) & 63) + b64(chunk & 63);
   }
   const remaining = bytes.length - i;
   if (remaining === 1) {
      const chunk = bytes[i]! << 16;
      result += b64((chunk >> 18) & 63) + b64((chunk >> 12) & 63) + "==";
   } else if (remaining === 2) {
      const chunk = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
      result += b64((chunk >> 18) & 63) + b64((chunk >> 12) & 63) + b64((chunk >> 6) & 63) + "=";
   }
   return result;
}

function base64UrlEncode(bytes: Uint8Array): string {
   return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafeString(byteLength: number): string {
   const bytes = new Uint8Array(byteLength);
   crypto.getRandomValues(bytes);
   return base64UrlEncode(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
   const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
   return base64UrlEncode(new Uint8Array(digest));
}

function authHeader(): string {
   // Public client (installed app): client_id with an empty secret.
   return "Basic " + toBase64(new TextEncoder().encode(`${REDDIT_CLIENT_ID}:`));
}

/**
 * Drives Reddit's OAuth "authorization code + PKCE" flow for a real, per-user login — no
 * credentials ever touch the plugin, the user authenticates on reddit.com in their own browser.
 * A single in-flight login is supported at a time (`pending` holds the PKCE verifier + CSRF
 * state between starting the flow and the obsidian:// redirect coming back).
 */
export class RedditAuth {
   private pending?: { state: string; codeVerifier: string; };

   isConfigured(): boolean {
      return !!REDDIT_CLIENT_ID;
   }

   /** Opens the system browser to Reddit's consent screen. */
   async startLogin(): Promise<void> {
      const state = randomUrlSafeString(24);
      const codeVerifier = randomUrlSafeString(48);
      const codeChallenge = await pkceChallenge(codeVerifier);
      this.pending = { state, codeVerifier };

      const params = new URLSearchParams({
         client_id: REDDIT_CLIENT_ID,
         response_type: "code",
         state,
         redirect_uri: REDDIT_REDIRECT_URI,
         duration: "permanent", // required to get a refresh_token back
         scope: "read",
         code_challenge: codeChallenge,
         code_challenge_method: "S256",
      });

      window.open(`https://www.reddit.com/api/v1/authorize?${params.toString()}`);
   }

   /** Completes the flow once the obsidian:// redirect delivers Reddit's response. */
   async handleCallback(params: Record<string, string>): Promise<RedditTokens> {
      if (params.error) {
         throw new Error(`Reddit denied the login (${params.error}).`);
      }
      if (!this.pending || params.state !== this.pending.state) {
         throw new Error("This login link is stale or was already used — try connecting again.");
      }
      if (!params.code) {
         throw new Error("Reddit's response was missing the authorization code.");
      }

      const { codeVerifier } = this.pending;
      this.pending = undefined;

      const res = await requestUrl({
         url: "https://www.reddit.com/api/v1/access_token",
         method: "POST",
         throw: false,
         headers: {
            "Authorization": authHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": REDDIT_USER_AGENT,
         },
         body: new URLSearchParams({
            grant_type: "authorization_code",
            code: params.code,
            redirect_uri: REDDIT_REDIRECT_URI,
            code_verifier: codeVerifier,
         }).toString(),
      });

      if (res.status !== 200) {
         throw new Error(`Reddit rejected the login exchange (status ${res.status}).`);
      }

      const json = JSON.parse(res.text) as {
         access_token?: string; expires_in?: number; refresh_token?: string;
      };
      if (!json.access_token || !json.refresh_token) {
         throw new Error("Reddit's token response was missing an access or refresh token.");
      }

      return {
         accessToken: json.access_token,
         accessTokenExpiresAt: Date.now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000,
         refreshToken: json.refresh_token,
      };
   }

   /** Exchanges a stored refresh token for a fresh access token. */
   static async refresh(refreshToken: string): Promise<RedditTokens | undefined> {
      try {
         const res = await requestUrl({
            url: "https://www.reddit.com/api/v1/access_token",
            method: "POST",
            throw: false,
            headers: {
               "Authorization": authHeader(),
               "Content-Type": "application/x-www-form-urlencoded",
               "User-Agent": REDDIT_USER_AGENT,
            },
            body: new URLSearchParams({
               grant_type: "refresh_token",
               refresh_token: refreshToken,
            }).toString(),
         });

         if (res.status !== 200) {
            console.debug(`Reddit token refresh failed. Status: ${res.status}`);
            return undefined;
         }

         const json = JSON.parse(res.text) as { access_token?: string; expires_in?: number; };
         if (!json.access_token) return undefined;

         return {
            accessToken: json.access_token,
            accessTokenExpiresAt: Date.now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000,
            refreshToken, // Reddit doesn't rotate the refresh token on each use
         };
      } catch (e) {
         console.error("Reddit token refresh failed:", e);
         return undefined;
      }
   }

   /** Best-effort revoke on disconnect — failures are ignored, we drop the token locally regardless. */
   static async revoke(refreshToken: string): Promise<void> {
      try {
         await requestUrl({
            url: "https://www.reddit.com/api/v1/revoke_token",
            method: "POST",
            throw: false,
            headers: {
               "Authorization": authHeader(),
               "Content-Type": "application/x-www-form-urlencoded",
               "User-Agent": REDDIT_USER_AGENT,
            },
            body: new URLSearchParams({
               token: refreshToken,
               token_type_hint: "refresh_token",
            }).toString(),
         });
      } catch { /* best effort */ }
   }

   /** Fetches the connected account's username, for display in settings. */
   static async fetchUsername(accessToken: string): Promise<string | undefined> {
      try {
         const res = await requestUrl({
            url: "https://oauth.reddit.com/api/v1/me",
            throw: false,
            headers: {
               "Authorization": `Bearer ${accessToken}`,
               "User-Agent": REDDIT_USER_AGENT,
            },
         });
         if (res.status !== 200) return undefined;
         const json = JSON.parse(res.text) as { name?: string; };
         return json.name;
      } catch {
         return undefined;
      }
   }
}
