import { ProviderRequestError } from "../provider-runtime.ts";

const textDecoder = new TextDecoder();

/**
 * Decode the msgpack values mymind streams from `GET /cards`.
 *
 * The card list is the only mymind response that is not JSON: it is a
 * concatenation of self-delimiting msgpack values, one per card, so the web
 * client can render cards while the response is still arriving. This decoder
 * covers the msgpack types that stream carries (nil, booleans, integers,
 * floats, strings, binary, arrays, and maps) and rejects the extension types
 * mymind never sends instead of guessing at their payloads.
 */
export function decodeMymindMsgpackStream(bytes: Uint8Array): unknown[] {
  const reader = new MsgpackReader(bytes);
  const values: unknown[] = [];
  while (!reader.done) {
    values.push(reader.readValue());
  }
  return values;
}

class MsgpackReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.offset >= this.bytes.byteLength;
  }

  readValue(): unknown {
    const tag = this.readUint8();
    if (tag <= 0x7f) return tag;
    if (tag >= 0xe0) return tag - 0x100;
    if (tag <= 0x8f) return this.readMap(tag - 0x80);
    if (tag <= 0x9f) return this.readArray(tag - 0x90);
    if (tag <= 0xbf) return this.readString(tag - 0xa0);

    switch (tag) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return this.readBinary(this.readUint8());
      case 0xc5:
        return this.readBinary(this.readUint16());
      case 0xc6:
        return this.readBinary(this.readUint32());
      case 0xca:
        return this.readFloat32();
      case 0xcb:
        return this.readFloat64();
      case 0xcc:
        return this.readUint8();
      case 0xcd:
        return this.readUint16();
      case 0xce:
        return this.readUint32();
      case 0xcf:
        return this.readSafeInteger(this.readBigUint64());
      case 0xd0:
        return this.readInt8();
      case 0xd1:
        return this.readInt16();
      case 0xd2:
        return this.readInt32();
      case 0xd3:
        return this.readSafeInteger(this.readBigInt64());
      case 0xd9:
        return this.readString(this.readUint8());
      case 0xda:
        return this.readString(this.readUint16());
      case 0xdb:
        return this.readString(this.readUint32());
      case 0xdc:
        return this.readArray(this.readUint16());
      case 0xdd:
        return this.readArray(this.readUint32());
      case 0xde:
        return this.readMap(this.readUint16());
      case 0xdf:
        return this.readMap(this.readUint32());
      default:
        throw msgpackError(`unsupported value type 0x${tag.toString(16).padStart(2, "0")}`);
    }
  }

  private readArray(length: number): unknown[] {
    const items: unknown[] = [];
    for (let index = 0; index < length; index++) {
      items.push(this.readValue());
    }
    return items;
  }

  private readMap(size: number): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    for (let index = 0; index < size; index++) {
      const key = this.readValue();
      if (typeof key !== "string" && typeof key !== "number") {
        throw msgpackError("map keys must be strings or numbers");
      }
      map[String(key)] = this.readValue();
    }
    return map;
  }

  private readString(length: number): string {
    return textDecoder.decode(this.take(length));
  }

  private readBinary(length: number): Uint8Array {
    return Uint8Array.from(this.take(length));
  }

  private readSafeInteger(value: bigint): number {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) {
      throw msgpackError("64-bit integer exceeds the safe JSON integer range");
    }
    return asNumber;
  }

  private readUint8(): number {
    return this.view.getUint8(this.advance(1));
  }

  private readUint16(): number {
    return this.view.getUint16(this.advance(2));
  }

  private readUint32(): number {
    return this.view.getUint32(this.advance(4));
  }

  private readBigUint64(): bigint {
    return this.view.getBigUint64(this.advance(8));
  }

  private readInt8(): number {
    return this.view.getInt8(this.advance(1));
  }

  private readInt16(): number {
    return this.view.getInt16(this.advance(2));
  }

  private readInt32(): number {
    return this.view.getInt32(this.advance(4));
  }

  private readBigInt64(): bigint {
    return this.view.getBigInt64(this.advance(8));
  }

  private readFloat32(): number {
    return this.view.getFloat32(this.advance(4));
  }

  private readFloat64(): number {
    return this.view.getFloat64(this.advance(8));
  }

  private take(length: number): Uint8Array {
    const start = this.advance(length);
    return this.bytes.subarray(start, start + length);
  }

  private advance(length: number): number {
    const start = this.offset;
    if (start + length > this.bytes.byteLength) {
      throw msgpackError("response ended before a complete value was read");
    }
    this.offset = start + length;
    return start;
  }
}

function msgpackError(reason: string): ProviderRequestError {
  return new ProviderRequestError(502, `mymind returned an unreadable card stream: ${reason}`);
}
