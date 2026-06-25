# Local Link Host - Backend Architectural Specification

This document defines the network protocols, data structures, and state machine logic for the Local Link Host (Android). This specification is intended for client-side developers (e.g., iOS) to ensure seamless integration with the peer-to-peer sync system.

## 1. Network Architecture Overview
The system uses two UDP channels to separate control signals from high-frequency audio data.

| Service | Protocol | Port | Data Type | Function |
| :--- | :--- | :--- | :--- | :--- |
| **Command Server** | UDP | 8080 | JSON String | Handshakes, Call Alerts, and Session teardowns. |
| **Voice Bridge** | UDP | 8081 | Base64 String | Full-duplex voice streaming (Host <-> Client). |

## 2. Handshake & Session Protocol (Port 8080)

### A. Connection Handshake
**Client Request:**
```json
{
  "request": "Connect",
  "passkey": "TALHA_SECURE_SYNC_2026"
}
```

*Note: The Host handles the "request" field case-insensitively.*

**Host Response:**
```json
{
  "status": "CONNECTED",
  "message": "Handshake successful."
}
```

### B. Disconnection Handshake
**Client Request:**
```json
{
  "type": "Disconnect",
  "passkey": "TALHA_SECURE_SYNC_2026"
}
```

---

## 3. Telephony State Matrix (Port 8080)
The Host emits these frames based on real-time SIM card state changes.

| Event | JSON Payload | Description |
| :--- | :--- | :--- |
| **Incoming Call** | `{"type": "CALL_ALERT", "number": "0223411076"}` | Initiates client ringing UI. |
| **Call Answered** | `{"type": "CALL_CANCEL", "reason": "ANSWERED_ON_HOST"}` | Kill client UI if answered on Android. |
| **Call Ended** | `{"type": "CALL_ENDED"}` | Terminates UI and stops audio loops. |

---

## 4. Full-Duplex Audio Bridge (Port 8081)
Audio is exchanged as **Base64 encoded strings** to ensure compatibility with the iPhone's network buffer processing.

### Activation
The audio bridge is activated when the Client sends:
```json
{
  "type": "CALL_ANSWERED",
  "action": "ACCEPT"
}
```

### Audio Technical Parameters
- **Encoding**: Linear PCM 16-bit Signed
- **Sampling Rate**: 44,100 Hz (44.1kHz)
- **Channels**: Mono
- **Transport Wrapper**: Base64 String (UTF-8 encoded bytes)

### Data Flow
1. **Host -> Client**: Android captures MIC -> Encodes to Base64 -> Sends to Client:8081.
2. **Client -> Host**: Client captures MIC -> Encodes to Base64 -> Sends to Host:8081.

---

## 5. Security & Stability
- **Locked Link**: Once a handshake is successful, the Host ignores packets from all other IP addresses until the session is disconnected.
- **Hardware Locks**: The Host maintains a `WifiLock` and `WakeLock` during active sessions to prevent packet loss during Android sleep cycles.
