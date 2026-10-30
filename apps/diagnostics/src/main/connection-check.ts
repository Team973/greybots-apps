import { connect } from 'node:net';

import type { AddressCheck, ConnectionReport, PortCheck } from '@shared/ipc';
import { robotAddresses } from '@shared/robot-address';
import type { Settings } from '@shared/settings';

// What to knock on to tell whether a robot is there. NetworkTables is up
// whenever robot code is running; SSH is up whenever the roboRIO is, and is
// what log offload will use.
const robotPorts = [
  { port: 5810, service: 'NetworkTables (NT4)' },
  { port: 22, service: 'SSH / SFTP' }
];

const timeoutMs = 1500;

export function checkPort(host: string, port: number, service: string): Promise<PortCheck> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = connect({ host, port });
    let settled = false;

    const finish = (open: boolean, error = '') => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, service, open, milliseconds: open ? Date.now() - started : null, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'No answer'));
    socket.once('error', (error: NodeJS.ErrnoException) => finish(false, describeError(error)));
  });
}

function describeError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'ECONNREFUSED':
      return 'Reached, but nothing is listening';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Name not found';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'No route to this address';
    default:
      return error.code ?? error.message;
  }
}

// Tries a plain TCP connection to every address the robot might be at. All
// at once, so a robot that isn't there costs one timeout, not one per port.
export async function checkConnection(settings: Settings): Promise<ConnectionReport> {
  const addresses: AddressCheck[] = await Promise.all(
    robotAddresses(settings).map(async (address) => ({
      ...address,
      ports: await Promise.all(robotPorts.map(({ port, service }) => checkPort(address.host, port, service)))
    }))
  );

  return {
    checkedAt: new Date().toISOString(),
    reachable: addresses.some((address) => address.ports.some((port) => port.open)),
    addresses
  };
}
