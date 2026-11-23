"""Verifying the Supabase sign-in token sent by the app.

The app signs in with Supabase Auth and gets a JWT (a signed token). It sends
that token on every API call as `Authorization: Bearer <token>`. We check the
signature, expiry, audience, and issuer before trusting who the caller is.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# Algorithms we accept. Listing them explicitly matters: it stops an attacker
# from sending a token with "alg": "none" or switching algorithms.
ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
SHARED_SECRET_ALGORITHMS = ["HS256"]


@dataclass(frozen=True)
class AuthUser:
    id: UUID
    # The full verified claims. The database layer passes these to Postgres so
    # Row Level Security sees the same user (see db.user_transaction).
    claims: dict[str, Any]


class InvalidToken(Exception):
    pass


# Given a raw token, return the public key that should have signed it.
KeyResolver = Callable[[str], Any]


class TokenVerifier:
    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        key_resolver: KeyResolver | None,
        shared_secret: str | None = None,
    ) -> None:
        self._issuer = issuer
        self._audience = audience
        self._key_resolver = key_resolver
        self._shared_secret = shared_secret

    @classmethod
    def for_supabase(
        cls, *, jwks_url: str, issuer: str, audience: str, shared_secret: str | None
    ) -> "TokenVerifier":
        # PyJWKClient downloads the project's public keys once and caches them.
        jwks_client = jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
        return cls(
            issuer=issuer,
            audience=audience,
            key_resolver=lambda token: jwks_client.get_signing_key_from_jwt(token).key,
            shared_secret=shared_secret,
        )

    def verify(self, token: str) -> AuthUser:
        try:
            algorithm = jwt.get_unverified_header(token).get("alg")
            if algorithm in SHARED_SECRET_ALGORITHMS and self._shared_secret:
                key: Any = self._shared_secret
                algorithms = SHARED_SECRET_ALGORITHMS
            elif algorithm in ASYMMETRIC_ALGORITHMS and self._key_resolver:
                key = self._key_resolver(token)
                algorithms = ASYMMETRIC_ALGORITHMS
            else:
                raise InvalidToken(f"unsupported token algorithm: {algorithm!r}")

            claims: dict[str, Any] = jwt.decode(
                token,
                key,
                algorithms=algorithms,
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
            return AuthUser(id=UUID(claims["sub"]), claims=claims)
        except InvalidToken:
            raise
        except (jwt.PyJWTError, ValueError, KeyError) as exc:
            raise InvalidToken(str(exc)) from exc


_bearer = HTTPBearer(auto_error=False)


def get_verifier(request: Request) -> TokenVerifier:
    verifier: TokenVerifier = request.app.state.verifier
    return verifier


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    verifier: Annotated[TokenVerifier, Depends(get_verifier)],
) -> AuthUser:
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing sign-in token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return verifier.verify(credentials.credentials)
    except InvalidToken:
        # Don't echo the reason to the caller; it can help an attacker.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or expired sign-in token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
