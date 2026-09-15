import type { SerialPortDescriptor } from '../protocol.js';
import type { SerialTransport, SerialTransportFactory } from './transport.js';
/** Production transport backed by the serialport npm package. */
export declare class NodeSerialPortFactory implements SerialTransportFactory {
    list(): Promise<readonly SerialPortDescriptor[]>;
    create(): SerialTransport;
}
//# sourceMappingURL=node-serialport-transport.d.ts.map