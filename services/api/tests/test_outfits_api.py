from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from .conftest import FakeOutfitRepository, make_token


def photo_path_for(user_id: UUID) -> str:
    return f"{user_id}/{uuid4()}.jpg"


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_posting_requires_sign_in(client: TestClient, user_id: UUID) -> None:
    response = client.post("/outfits", json={"photo_path": photo_path_for(user_id)})
    assert response.status_code == 401


def test_post_outfit(
    client: TestClient, repo: FakeOutfitRepository, user_id: UUID, auth_headers: dict[str, str]
) -> None:
    path = photo_path_for(user_id)
    repo.uploaded_photos.add(path)

    response = client.post(
        "/outfits",
        json={"photo_path": path, "caption": "first fit", "worn_on": "2026-11-23"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user_id"] == str(user_id)
    assert body["photo_path"] == path
    assert body["caption"] == "first fit"
    assert body["worn_on"] == "2026-11-23"
    assert body["rank_key"] is None


def test_cannot_post_a_photo_from_someone_elses_folder(
    client: TestClient, repo: FakeOutfitRepository, auth_headers: dict[str, str]
) -> None:
    someone_else = uuid4()
    path = photo_path_for(someone_else)
    repo.uploaded_photos.add(path)

    response = client.post("/outfits", json={"photo_path": path}, headers=auth_headers)

    assert response.status_code == 422
    assert repo.outfits == []


def test_rejects_malformed_photo_path(
    client: TestClient, user_id: UUID, auth_headers: dict[str, str]
) -> None:
    for bad in [f"{user_id}/../../etc/passwd", f"{user_id}/photo.png", "photo.jpg"]:
        response = client.post("/outfits", json={"photo_path": bad}, headers=auth_headers)
        assert response.status_code == 422, bad


def test_photo_must_be_uploaded_first(
    client: TestClient, user_id: UUID, auth_headers: dict[str, str]
) -> None:
    response = client.post("/outfits", json={"photo_path": photo_path_for(user_id)}, headers=auth_headers)
    assert response.status_code == 422
    assert "Upload it first" in response.json()["detail"]


def test_same_photo_cannot_be_posted_twice(
    client: TestClient, repo: FakeOutfitRepository, user_id: UUID, auth_headers: dict[str, str]
) -> None:
    path = photo_path_for(user_id)
    repo.uploaded_photos.add(path)
    assert client.post("/outfits", json={"photo_path": path}, headers=auth_headers).status_code == 201
    assert client.post("/outfits", json={"photo_path": path}, headers=auth_headers).status_code == 409


def test_caption_length_limit(
    client: TestClient, repo: FakeOutfitRepository, user_id: UUID, auth_headers: dict[str, str]
) -> None:
    path = photo_path_for(user_id)
    repo.uploaded_photos.add(path)
    response = client.post("/outfits", json={"photo_path": path, "caption": "x" * 281}, headers=auth_headers)
    assert response.status_code == 422


def test_list_my_outfits_only_shows_mine_newest_first(
    client: TestClient, repo: FakeOutfitRepository, user_id: UUID, auth_headers: dict[str, str]
) -> None:
    for day in ["2026-11-20", "2026-11-22", "2026-11-21"]:
        path = photo_path_for(user_id)
        repo.uploaded_photos.add(path)
        client.post("/outfits", json={"photo_path": path, "worn_on": day}, headers=auth_headers)

    other_user = uuid4()
    other_path = photo_path_for(other_user)
    repo.uploaded_photos.add(other_path)
    client.post(
        "/outfits",
        json={"photo_path": other_path},
        headers={"Authorization": f"Bearer {make_token(other_user)}"},
    )

    response = client.get("/outfits/me", headers=auth_headers)

    assert response.status_code == 200
    assert [o["worn_on"] for o in response.json()] == ["2026-11-22", "2026-11-21", "2026-11-20"]
