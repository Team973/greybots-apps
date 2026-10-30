// The app's settings: how to reach the robot, and where offloaded data
// lives. Used by both the main process (which stores them) and the window
// (which edits them), so nothing here may touch Node or the DOM.

// 'team' works the robot's addresses out from the team number; 'manual' uses
// the address typed in (a robot on a bench network, a simulator, ...).
export type AddressMode = 'team' | 'manual';

export interface Settings {
  teamNumber: number;
  addressMode: AddressMode;
  // An IP address or hostname. Only used in manual mode.
  manualAddress: string;
  // Whether to look for the robot and its coprocessors by mDNS. Discovery
  // itself comes with the log offload work (issue #91).
  mdnsEnabled: boolean;
  // Where logs and results are kept. Empty means the default folder, which
  // only the main process can name (it depends on the operating system).
  dataDirectory: string;
}

export const defaultSettings: Settings = {
  teamNumber: 973,
  addressMode: 'team',
  manualAddress: '',
  mdnsEnabled: true,
  dataDirectory: ''
};

export const maxTeamNumber = 99999;

export type SettingsErrors = Partial<Record<keyof Settings, string>>;

// What's wrong with a set of settings, by field. Empty when they're fine.
export function settingsErrors(settings: Settings): SettingsErrors {
  const errors: SettingsErrors = {};

  if (!Number.isInteger(settings.teamNumber) || settings.teamNumber < 1 || settings.teamNumber > maxTeamNumber) {
    errors.teamNumber = `Enter a team number from 1 to ${maxTeamNumber}.`;
  }

  if (settings.addressMode === 'manual') {
    const address = settings.manualAddress.trim();
    if (address === '') errors.manualAddress = 'Enter an IP address or hostname.';
    else if (!/^[A-Za-z0-9.:_-]+$/.test(address)) errors.manualAddress = "That doesn't look like an IP address or hostname.";
  }

  return errors;
}

// Settings read from disk or sent from the window can't be trusted to have
// the right shape (an older version, a hand-edited file). Anything missing or
// of the wrong type falls back to its default.
export function normalizeSettings(raw: unknown): Settings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  return {
    teamNumber: typeof input.teamNumber === 'number' && Number.isFinite(input.teamNumber)
      ? Math.trunc(input.teamNumber)
      : defaultSettings.teamNumber,
    addressMode: input.addressMode === 'manual' ? 'manual' : 'team',
    manualAddress: typeof input.manualAddress === 'string' ? input.manualAddress.trim() : defaultSettings.manualAddress,
    mdnsEnabled: typeof input.mdnsEnabled === 'boolean' ? input.mdnsEnabled : defaultSettings.mdnsEnabled,
    dataDirectory: typeof input.dataDirectory === 'string' ? input.dataDirectory.trim() : defaultSettings.dataDirectory
  };
}
