# Bookmark Sync Backend Specification

This document defines the technical specification for a decentralized storage vault designed to synchronize encrypted bookmark data across multiple devices. The backend acts as a "dumb" storage provider for opaque, versioned blobs.

## Overview

The backend is responsible for storing and retrieving encrypted data blobs. It does not possess the keys to decrypt the data, ensuring that all synchronization remains private and secure (Zero-Knowledge).

- **Authentication**: HMAC-SHA256 signed requests using a `Signing Secret`.
- **Security**: Data must be encrypted client-side using **AES-GCM**.
- **Storage**: Each `Sync ID` supports versioned history (default: last 10 versions).

---

## API Specification

All endpoints are prefixed with `/api/v1`.

### 1. Get Latest Sync Data

Retrieves the most recent encrypted blob for a specific ID.

- **URL**: `GET /sync/:id`
- **Success Response (200 OK)**:
  ```json
  {
  	"data": "base64_encoded_encrypted_blob",
  	"timestamp": 1625000000
  }
  ```
- **Error Response (404 Not Found)**: The provided ID does not exist.

### 2. Upload Sync Data

Uploads a new encrypted blob. This action automatically triggers history pruning.

- **URL**: `POST /sync/:id`
- **Headers**:
  - `X-Sync-Timestamp`: Unix timestamp in seconds (UTC).
  - `X-Sync-Signature`: HMAC-SHA256(signing_secret, timestamp + sha256(request_body)).
- **Request Body**:
  ```json
  {
  	"data": "base64_encoded_encrypted_blob",
  	"registration_secret": "signing_secret_string (first upload only)"
  }
  ```
  The `registration_secret` field **must** be included on the very first `POST` to a new `Sync ID` and **must not** be included on subsequent uploads. See [Client-side registration flow](#client-side-registration-flow) below.
- **Success Response (201 Created)**: Blob stored successfully.
- **Error Response (401 Unauthorized)**: Signature is invalid or timestamp has expired.
- **Error Response (409 Conflict)**: A `registration_secret` was provided but the `Sync ID` already exists.
- **Error Response (413 Payload Too Large)**: Payload exceeds the 1MB limit.
- **Error Response (429 Too Many Requests)**: Rate limit exceeded for this ID.

### 3. Get Version History

Lists the timestamps of available historical versions for recovery.

- **URL**: `GET /sync/:id/history`
- **Success Response (200 OK)**:
  ```json
  [
  	{ "timestamp": 1625000000 },
  	{ "timestamp": 1624999000 },
  	{ "timestamp": 1624998000 }
  ]
  ```

### 4. Get Specific Version (Recovery)

Retrieves a specific historical blob by its timestamp.

- **URL**: `GET /sync/:id/:timestamp`
- **Success Response (200 OK)**:
  ```json
  {
  	"data": "base64_encoded_encrypted_blob",
  	"timestamp": 1624999000
  }
  ```

---

## System Constraints & Rules

### Data Retention

- **History Limit**: The server retains exactly the **last 10 versions** per `Sync ID`.
- **Pruning**: Upon a successful `POST`, the oldest version exceeding the limit is permanently deleted.

### Limits

- **Max Payload Size**: 1MB per request.
- **Rate Limiting**:
  - **POST**: 5 requests per minute per `Sync ID`.
  - **GET**: 30 requests per minute per `Sync ID`.

### Persistence Requirements

- The backend must use a persistent store (SQLite, BadgerDB, or similar).
- Database should index `id` and `timestamp` for performant lookups and pruning.

### Authentication & Validation

To prevent unauthorized data rotation and resource exhaustion, the server implements the following validation for `POST` requests:

1.  **Registration**: On the first `POST` to a new `Sync ID`, the request body must include a `registration_secret` field. The server stores this string verbatim and uses its **raw UTF-8 bytes** as the HMAC key for all subsequent signature verifications for this ID. If a `POST` to an existing ID includes `registration_secret`, the server should respond with **409 Conflict**.
2.  **Timestamp Validation**: The server rejects requests where `abs(current_time - X-Sync-Timestamp) > 300 seconds`.
3.  **Signature Verification**: The `X-Sync-Signature` must match `HMAC-SHA256(stored_signing_secret_utf8_bytes, timestamp_string + sha256_hex(raw_body))`. Note: `timestamp_string` is the decimal string from the `X-Sync-Timestamp` header, and `sha256_hex(raw_body)` is the lowercase hex-encoded SHA-256 digest of the raw request body.
4.  **Replay Protection**: The server should track the last used timestamp per ID to prevent exact replays within the valid window.

### Client-side Registration Flow

The client does **not** know in advance whether a `Sync ID` has been registered. The recommended pattern is:

1.  **Fetch first**: `GET /sync/:id`.
2.  **If 404**: The ID is new. The next `POST` must include `registration_secret` (the same string used to derive the HMAC signing key).
3.  **If 200**: The ID already exists. The next `POST` must **not** include `registration_secret`; it authenticates using the HMAC signature alone.

This fetch-then-push pattern ensures the client never accidentally sends `registration_secret` to an already-registered ID, and never omits it for a new one.

### Security & CORS

- **CORS**: The server must allow Cross-Origin Resource Sharing from the trusted frontend origin.
- **Privacy**: The server must never receive the decryption key. The `:id` in the URL identifies the bucket, but the `:enc_key` remains strictly on the client. The `Signing Secret` (aka `registration_secret`) is used only for HMAC authentication and should be stored securely on the server.
- **Secret handling**: The signing secret is a plain string (typically hex-encoded random bytes). Both client and server must use its UTF-8 byte representation as the HMAC key material — no additional hashing or encoding is applied to derive the key.
