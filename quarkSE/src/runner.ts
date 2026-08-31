import * as net from 'net';

const DAEMON_PORT = 50052;
<<<<<<< HEAD

export function runOnDaemon(llvmIR: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ port: DAEMON_PORT }, () => {
=======
const CONNECT_TIMEOUT_MS = 5000;

export function runOnDaemon(llvmIR: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ port: DAEMON_PORT });

        let settled = false;
        const finish = (fn: () => void) => {
            if (!settled) {
                settled = true;
                fn();
            }
        };

        client.setTimeout(CONNECT_TIMEOUT_MS, () => {
            client.destroy();
            finish(() => reject(new Error('daemon timeout (no response in ' + CONNECT_TIMEOUT_MS + 'ms)')));
        });

        client.on('connect', () => {
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
            client.write('COMPILE\n');
            client.write(llvmIR + '\n');
            client.write('END_COMPILE\n');
            client.write('EXECUTE int32 quark_main\n');
            client.write('EXIT\n');
        });
<<<<<<< HEAD
        let out = '';
        client.on('data', d => { out += d.toString(); });
        client.on('end', () => resolve(out));
        client.on('error', reject);
=======

        let out = '';
        client.on('data', (d) => {
            out += d.toString();
        });
        client.on('end', () => finish(() => resolve(out)));
        client.on('error', (err) => finish(() => reject(err)));
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
    });
}