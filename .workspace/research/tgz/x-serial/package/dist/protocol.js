/** Shared wire-safe values used by the Host service, model tools, and browser console. */
/** Versioned declaration that this Host supports cancellable snapshot waiting. */
export const SERIAL_WAIT_SNAPSHOT_CAPABILITY = 'v1';
/** Structured failure returned by a Harness Remote call. */
export class SerialRemoteError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'SerialRemoteError';
    }
}
/** Decode the mutually exclusive text/base64 request representation. */
export function decodeSendRequest(request) {
    const hasText = request.text !== undefined;
    const hasBytes = request.dataBase64 !== undefined;
    if (hasText === hasBytes) {
        throw new TypeError('serial send requires exactly one of text or dataBase64');
    }
    if (hasBytes) {
        const binary = globalThis.atob(request.dataBase64);
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    }
    const suffix = request.lineEnding === 'cr' ? '\r'
        : request.lineEnding === 'lf' ? '\n'
            : request.lineEnding === 'crlf' ? '\r\n'
                : '';
    return new TextEncoder().encode(`${request.text}${suffix}`);
}
//# sourceMappingURL=protocol.js.map