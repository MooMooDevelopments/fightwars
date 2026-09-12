/**
 * Token signing for the FightWars API.
 *
 * The game server verifies EdDSA (Ed25519) JWTs against this service's
 * JWKS (see src/server/jwt.ts and ServerEnv.jwkPublicKey). The private key
 * comes from API_JWT_PRIVATE_KEY (PKCS#8 PEM) in production; when unset a
 * fresh key pair is generated at startup, which is fine for dev and tests
 * (tokens simply stop verifying after a restart, and clients refresh).
 */
import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { randomUUID } from "node:crypto";
import { uuidToBase64url } from "../core/Base64";

export interface SigningKeys {
  privateKey: CryptoKey;
  publicJwk: JWK;
  /** The PEM the private key came from or was generated as (dev only). */
  privatePem: string;
}

export async function loadSigningKeys(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SigningKeys> {
  let privateKey: CryptoKey;
  let privatePem: string;
  const pem = env.API_JWT_PRIVATE_KEY;
  if (pem !== undefined && pem !== "") {
    privatePem = pem.replace(/\\n/g, "\n");
    privateKey = await importPKCS8(privatePem, "EdDSA");
  } else {
    const pair = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    privateKey = pair.privateKey;
    privatePem = await exportPKCS8(pair.privateKey);
  }
  // Derive the public JWK from the private key so the pair can never drift.
  const jwk = await exportJWK(privateKey);
  const publicJwk: JWK = {
    kty: "OKP",
    crv: "Ed25519",
    alg: "EdDSA",
    use: "sig",
    x: jwk.x,
  };
  return { privateKey, publicJwk, privatePem };
}

export interface TokenClaims {
  persistentId: string;
  issuer: string;
  audience: string;
  role?: string;
  /** Seconds. The client refreshes; keep it short (upstream uses 15 min). */
  ttlSeconds?: number;
}

export async function signToken(
  keys: SigningKeys,
  claims: TokenClaims,
): Promise<string> {
  const ttl = claims.ttlSeconds ?? 15 * 60;
  const jwt = new SignJWT(
    claims.role !== undefined ? { role: claims.role } : {},
  )
    .setProtectedHeader({ alg: "EdDSA" })
    .setJti(randomUUID())
    .setSubject(uuidToBase64url(claims.persistentId))
    .setIssuer(claims.issuer)
    .setAudience(claims.audience)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`);
  return jwt.sign(keys.privateKey);
}

/** Verify one of our own tokens (used by the API's own bearer routes). */
export async function verifyToken(
  keys: SigningKeys,
  token: string,
  issuer: string,
  audience: string,
): Promise<{ persistentIdB64: string; role?: string } | null> {
  try {
    const { importJWK } = await import("jose");
    const pub = await importJWK(keys.publicJwk, "EdDSA");
    const { payload } = await jwtVerify(token, pub, {
      algorithms: ["EdDSA"],
      issuer,
      audience,
    });
    if (typeof payload.sub !== "string") return null;
    return {
      persistentIdB64: payload.sub,
      role: typeof payload.role === "string" ? payload.role : undefined,
    };
  } catch {
    return null;
  }
}
