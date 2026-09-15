import { SerialPort } from 'serialport';
/** Production transport backed by the serialport npm package. */
export class NodeSerialPortFactory {
    async list() {
        const ports = await SerialPort.list();
        return ports.map(portDescriptor);
    }
    create() {
        return new NodeSerialPortTransport();
    }
}
class NodeSerialPortTransport {
    port;
    dataListeners = new Set();
    errorListeners = new Set();
    closeListeners = new Set();
    async open(options) {
        if (this.port !== undefined)
            throw new Error('serial transport is already open');
        const port = new SerialPort({
            path: options.path,
            baudRate: options.baudRate,
            dataBits: options.dataBits ?? 8,
            stopBits: options.stopBits ?? 1,
            parity: options.parity ?? 'none',
            rtscts: options.rtscts ?? false,
            autoOpen: false,
        });
        this.port = port;
        port.on('data', (data) => {
            const bytes = Uint8Array.from(data);
            for (const listener of [...this.dataListeners])
                listener(bytes);
        });
        port.on('error', (error) => {
            for (const listener of [...this.errorListeners])
                listener(error);
        });
        port.on('close', () => {
            for (const listener of [...this.closeListeners])
                listener();
        });
        await callbackPromise(callback => { port.open(callback); });
    }
    async close() {
        const port = this.requirePort();
        if (port.isOpen)
            await callbackPromise(callback => { port.close(callback); });
        this.port = undefined;
    }
    async write(data) {
        const port = this.requirePort();
        await callbackPromise(callback => { port.write(Buffer.from(data), callback); });
        await callbackPromise(callback => { port.drain(callback); });
    }
    onData(listener) {
        this.dataListeners.add(listener);
        return () => { this.dataListeners.delete(listener); };
    }
    onError(listener) {
        this.errorListeners.add(listener);
        return () => { this.errorListeners.delete(listener); };
    }
    onClose(listener) {
        this.closeListeners.add(listener);
        return () => { this.closeListeners.delete(listener); };
    }
    requirePort() {
        if (this.port === undefined)
            throw new Error('serial transport is not open');
        return this.port;
    }
}
function callbackPromise(register) {
    return new Promise((resolve, reject) => {
        register((error) => { if (error == null)
            resolve();
        else
            reject(error); });
    });
}
function portDescriptor(port) {
    return {
        path: port.path,
        ...(port.manufacturer === undefined ? {} : { manufacturer: port.manufacturer }),
        ...(port.serialNumber === undefined ? {} : { serialNumber: port.serialNumber }),
        ...(port.vendorId === undefined ? {} : { vendorId: port.vendorId }),
        ...(port.productId === undefined ? {} : { productId: port.productId }),
        ...('friendlyName' in port && typeof port.friendlyName === 'string'
            ? { friendlyName: port.friendlyName }
            : {}),
    };
}
//# sourceMappingURL=node-serialport-transport.js.map