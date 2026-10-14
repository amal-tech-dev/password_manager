import json
import os
import secrets
import threading
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import uvicorn

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = Path(os.getenv("DEV_VAULT_DATA_DIR", str(ROOT / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
VAULT_FILE = DATA_DIR / "vault.enc"
INGEST_TOKEN = os.getenv("DEV_VAULT_INGEST_TOKEN", "")
DASHBOARD_TOKEN = os.getenv("DEV_VAULT_DASHBOARD_TOKEN", "")
EXTENSION_TOKEN = os.getenv("DEV_VAULT_EXTENSION_TOKEN", "")
VAULT_KEY = os.getenv("DEV_VAULT_FERNET_KEY", "")
HOST = os.getenv("DEV_VAULT_HOST", "0.0.0.0")
PORT = int(os.getenv("DEV_VAULT_PORT", "8765"))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("DEV_VAULT_ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

if len(INGEST_TOKEN) < 32 or len(DASHBOARD_TOKEN) < 32:
    raise RuntimeError("Set separate DEV_VAULT_INGEST_TOKEN and DEV_VAULT_DASHBOARD_TOKEN values (at least 32 characters).")
try:
    fernet = Fernet(VAULT_KEY.encode("ascii"))
except Exception as exc:
    raise RuntimeError("DEV_VAULT_FERNET_KEY must be a valid Fernet key. Follow README.md to generate one.") from exc

app = FastAPI(title="Password Manager", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
vault_lock = threading.RLock()

class LoginRecord(BaseModel):
    domain: str = Field(min_length=1, max_length=253)
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=2000)

def authorized(header: str | None, expected: str) -> bool:
    return bool(header and header.startswith("Bearer ") and
                secrets.compare_digest(header[7:].strip(), expected))

def read_vault() -> dict:
    if not VAULT_FILE.exists():
        return {}
    try:
        decrypted = fernet.decrypt(VAULT_FILE.read_bytes())
        obj = json.loads(decrypted.decode("utf-8"))
        if not isinstance(obj, dict):
            raise ValueError("Vault root is not an object")
        return obj
    except (InvalidToken, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Vault could not be decrypted or is corrupt. Check the vault key and backup.") from exc

def write_vault(vault: dict) -> None:
    plaintext = json.dumps(vault, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encrypted = fernet.encrypt(plaintext)
    temp = VAULT_FILE.with_suffix(".enc.tmp")
    temp.write_bytes(encrypted)
    os.replace(temp, VAULT_FILE)

def store_login(record: LoginRecord) -> str:
    domain = record.domain.strip()
    username = record.username.strip()
    if not domain or not username:
        raise HTTPException(status_code=422, detail="Domain and username cannot be blank")

    account = {
        "domain": domain,
        "password": record.password,
    }

    with vault_lock:
        vault = read_vault()
        users = vault.setdefault(domain, {})
        previous = users.get(username)
        if isinstance(previous, dict) and (
            previous.get("domain", domain) == domain
            and previous.get("password") == record.password
        ):
            return "unchanged"
        if previous == record.password:
            return "unchanged"
        users[username] = account
        write_vault(vault)
        return "created" if previous is None else "updated"

@app.get("/")
async def dashboard():
    return FileResponse(WEB_DIR / "dashboard.html")

@app.get("/health")
async def health():
    return {"ok": True, "service": "developer-password-vault"}

@app.post("/api/login")
async def save_login(record: LoginRecord, authorization: str | None = Header(default=None)):
    if not authorized(authorization, INGEST_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid ingest credentials")
    # Passwords are deliberately never printed or written to plaintext logs.
    return {"ok": True, "result": store_login(record)}

@app.get("/api/vault")
async def get_vault(authorization: str | None = Header(default=None)):
    if not authorized(authorization, DASHBOARD_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid dashboard credentials")
    with vault_lock:
        return read_vault()

@app.post("/api/vault")
async def save_dashboard_login(record: LoginRecord, authorization: str | None = Header(default=None)):
    if not authorized(authorization, DASHBOARD_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid dashboard credentials")
    return {"ok": True, "result": store_login(record)}

def authorize_extension(header: str | None) -> None:
    if len(EXTENSION_TOKEN) < 32:
        raise HTTPException(status_code=503, detail="Browser extension access is not configured")
    if not authorized(header, EXTENSION_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid browser extension credentials")

@app.get("/api/extension/matches")
async def get_extension_matches(
    domain: str,
    authorization: str | None = Header(default=None),
):
    authorize_extension(authorization)
    normalized_domain = domain.strip().lower()
    if not normalized_domain or len(normalized_domain) > 253:
        raise HTTPException(status_code=422, detail="A valid domain is required")

    with vault_lock:
        vault = read_vault()
        users = next(
            (
                accounts
                for stored_domain, accounts in vault.items()
                if stored_domain.strip().lower() == normalized_domain
            ),
            {},
        )

    accounts = []
    for username, value in users.items():
        password = value if isinstance(value, str) else (
            value.get("password") if isinstance(value, dict) else None
        )
        if isinstance(password, str):
            accounts.append({"username": username, "password": password})
    return {"domain": normalized_domain, "accounts": accounts}

@app.post("/api/extension/login")
async def save_extension_login(
    record: LoginRecord,
    authorization: str | None = Header(default=None),
):
    authorize_extension(authorization)
    return {"ok": True, "result": store_login(record)}

@app.delete("/api/vault/{domain}/{username}")
async def delete_account(domain: str, username: str, authorization: str | None = Header(default=None)):
    if not authorized(authorization, DASHBOARD_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid dashboard credentials")
    with vault_lock:
        vault = read_vault()
        users = vault.get(domain)
        if not users or username not in users:
            raise HTTPException(status_code=404, detail="Account not found")
        del users[username]
        if not users:
            del vault[domain]
        write_vault(vault)
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, access_log=False)
