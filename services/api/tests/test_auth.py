import time
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from dailyfitted_api.auth import InvalidToken, TokenVerifier

from .conftest import ISSUER, SECRET, make_token


@pytest.fixture
def verifier() -> TokenVerifier:
    return TokenVerifier(issuer=ISSUER, audience="authenticated", key_resolver=None, shared_secret=SECRET)


def test_accepts_valid_shared_secret_token(verifier: TokenVerifier) -> None:
    user_id = uuid4()
    user = verifier.verify(make_token(user_id))
    assert user.id == user_id
    assert user.claims["role"] == "authenticated"


@pytest.mark.parametrize(
    "token_kwargs",
    [
        {"secret": "a-different-secret-that-is-also-long-enough"},
        {"expires_in": -60},
        {"audience": "anon"},
        {"issuer": "https://evil.example.com/auth/v1"},
    ],
    ids=["wrong-signature", "expired", "wrong-audience", "wrong-issuer"],
)
def test_rejects_bad_tokens(verifier: TokenVerifier, token_kwargs: dict[str, object]) -> None:
    with pytest.raises(InvalidToken):
        verifier.verify(make_token(uuid4(), **token_kwargs))  # type: ignore[arg-type]


def test_rejects_unsigned_alg_none_token(verifier: TokenVerifier) -> None:
    now = int(time.time())
    token = jwt.encode(
        {"sub": str(uuid4()), "aud": "authenticated", "iss": ISSUER, "exp": now + 60},
        key="",
        algorithm="none",
    )
    with pytest.raises(InvalidToken):
        verifier.verify(token)


def test_rejects_garbage(verifier: TokenVerifier) -> None:
    with pytest.raises(InvalidToken):
        verifier.verify("not-a-jwt")


def test_accepts_asymmetric_es256_token() -> None:
    """Newer Supabase projects sign with an ES256 key published at a JWKS URL."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    verifier = TokenVerifier(
        issuer=ISSUER,
        audience="authenticated",
        key_resolver=lambda _token: private_key.public_key(),
    )
    user_id = uuid4()
    now = int(time.time())
    token = jwt.encode(
        {"sub": str(user_id), "aud": "authenticated", "iss": ISSUER, "exp": now + 60},
        private_key,
        algorithm="ES256",
    )
    assert verifier.verify(token).id == user_id


def test_hs256_rejected_when_no_shared_secret_configured() -> None:
    """A project using signing keys must not accept shared-secret tokens."""
    verifier = TokenVerifier(issuer=ISSUER, audience="authenticated", key_resolver=lambda _t: None)
    with pytest.raises(InvalidToken):
        verifier.verify(make_token(uuid4()))
