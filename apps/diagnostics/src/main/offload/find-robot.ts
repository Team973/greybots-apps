import { robotAddresses, usbAddress } from '@shared/robot-address';
import type { Settings } from '@shared/settings';
import { checkPort } from '../connection-check';

// Where the robot answers on the SSH port, or null. USB if it answers
// there: a cable is faster and steadier than the radio. Otherwise the first
// address, in the order they're listed. Every address is tried at once, and
// the answer comes as soon as it's known: USB answering doesn't wait for the
// radio's address to time out.
export async function findRobot(
  settings: Settings,
  check: (host: string) => Promise<boolean> = async (host) => (await checkPort(host, 22, 'SSH')).open
): Promise<string | null> {
  const hosts = robotAddresses(settings).map(({ host }) => host);
  const preferred = [...hosts.filter((host) => host === usbAddress), ...hosts.filter((host) => host !== usbAddress)];
  const answers = new Map(preferred.map((host) => [host, check(host).catch(() => false)]));
  for (const host of preferred) {
    if (await answers.get(host)) return host;
  }
  return null;
}
