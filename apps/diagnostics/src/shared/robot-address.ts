import type { Settings } from './settings';

export interface RobotAddress {
  // What this address is, for the person reading the screen.
  label: string;
  host: string;
}

// The roboRIO's static address on the robot radio's network: 10.TE.AM.2,
// where TE.AM is the team number split before its last two digits
// (973 -> 10.9.73.2, 10973 -> 10.109.73.2).
export function teamIpAddress(teamNumber: number): string {
  return `10.${Math.floor(teamNumber / 100)}.${teamNumber % 100}.2`;
}

// The name the roboRIO announces over mDNS.
export function teamMdnsHost(teamNumber: number): string {
  return `roboRIO-${teamNumber}-FRC.local`;
}

// The roboRIO's address when it's plugged in by USB, the same for every team.
export const usbAddress = '172.22.11.2';

// Every address worth trying for the robot, most likely first.
export function robotAddresses(settings: Settings): RobotAddress[] {
  if (settings.addressMode === 'manual') {
    return [{ label: 'Manual address', host: settings.manualAddress.trim() }];
  }

  const addresses: RobotAddress[] = [{ label: 'Robot network', host: teamIpAddress(settings.teamNumber) }];
  if (settings.mdnsEnabled) addresses.push({ label: 'mDNS name', host: teamMdnsHost(settings.teamNumber) });
  addresses.push({ label: 'USB', host: usbAddress });
  return addresses;
}
