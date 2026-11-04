import { Model } from "../shared/model.js";
import { ClientTokenClaims } from "./claims.js";
import { VerifyClientTokenOptions } from "./verify.js";

//#region src/tokens/client.d.ts

type CreateTokenOptions = {
  /** Custom key-value pairs to attach to the client token. */
  metadata?: Record<string, unknown>;
  /** Seconds until the token expires (1-3600, default 60). */
  expiresIn?: number;
  /** Restrict which models this token can access (max 20 items). */
  allowedModels?: (Model | (string & {}))[];
  /**
   * Restrict which web origins this token can be used from (max 20 items).
   * Each entry must be a full origin including scheme, e.g. `https://example.com`.
   * Enforced on realtime sessions by matching the WebSocket `Origin` header
   * verbatim. Defense-in-depth — only effective for browser-based clients.
   */
  allowedOrigins?: string[];
  /** Operational limits for the token. */
  constraints?: {
    realtime?: {
      maxSessionDuration?: number;
    };
  };
};
type CreateTokenResponse = {
  apiKey: string;
  /** Signed JWT mirroring `apiKey`, verifiable offline via `client.tokens.verify` / `verifyClientToken`. */
  token?: string;
  expiresAt: string;
  /** Present when `allowedModels` and/or `allowedOrigins` were set on the request. */
  permissions?: {
    models?: (Model | (string & {}))[];
    origins?: string[];
  } | null;
  /** Present when `constraints` was set on the request. */
  constraints?: {
    realtime?: {
      maxSessionDuration?: number;
    };
  } | null;
};
type TokensClient = {
  /**
   * Create a client token.
   * @param options - Optional configuration for the token.
   * @param options.metadata - Custom key-value pairs to attach to the token.
   * @returns A short-lived API key safe for client-side use.
   * @example
   * ```ts
   * const client = createDecartClient({ apiKey: process.env.DECART_API_KEY });
   * const token = await client.tokens.create();
   * // Returns: { apiKey: "ek_...", token: "eyJhbGciOiJFZERTQS...", expiresAt: "2024-12-15T12:10:00Z" }
   *
   * // With metadata:
   * const token = await client.tokens.create({ metadata: { role: "viewer" } });
   *
   * // With expiry, model restrictions, origin restrictions, and constraints:
   * const token = await client.tokens.create({
   *   expiresIn: 300,
   *   allowedModels: ["lucy-latest", "lucy-restyle-latest"],
   *   allowedOrigins: ["https://example.com"],
   *   constraints: { realtime: { maxSessionDuration: 120 } },
   * });
   * ```
   */
  create: (options?: CreateTokenOptions) => Promise<CreateTokenResponse>;
  /**
   * Verify a client token's JWT OFFLINE against the platform's public JWKS (cached) and return its
   * claims — signature (EdDSA), `exp`, `iss`, `aud`. Same as the standalone `verifyClientToken`;
   * does not use the client's API key or `baseUrl`.
   */
  verify: (token: string, options?: VerifyClientTokenOptions) => Promise<ClientTokenClaims>;
  /**
   * Read a client token's claims WITHOUT verifying — no network, no crypto. UNTRUSTED: display or
   * logging only. Same as the standalone `decodeClientToken`.
   */
  decode: (token: string) => ClientTokenClaims;
};
//#endregion
export { CreateTokenOptions, CreateTokenResponse, TokensClient };