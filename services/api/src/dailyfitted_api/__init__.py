"""Daily Fitted backend: HTTP API and background worker."""


def main() -> None:
    """Run the API server (used by the `dailyfitted-api` command)."""
    import uvicorn

    uvicorn.run("dailyfitted_api.app:create_app", factory=True, host="0.0.0.0", port=8000)
