// The USB drives plugged in right now, on each operating system, without
// any extra packages.
//
// - Windows: drive letters are cheap to look at, so they're checked each
//   time; only when the letters change is Windows asked (once, through
//   PowerShell) which are removable or on a USB disk. A USB SSD counts as a
//   fixed disk to Windows, so "on a USB disk" is asked as well.
// - macOS: everything in /Volumes but the startup disk.
// - Linux: what's mounted under /media/<user>, /run/media/<user> or /media.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import type { UsbDrive } from '@shared/usb';

const windowsScript = `
$ProgressPreference = 'SilentlyContinue'
$usb = @(Get-CimInstance Win32_DiskDrive -Filter "InterfaceType='USB'" |
  ForEach-Object { Get-CimAssociatedInstance -InputObject $_ -ResultClassName Win32_DiskPartition } |
  ForEach-Object { Get-CimAssociatedInstance -InputObject $_ -ResultClassName Win32_LogicalDisk } |
  ForEach-Object { $_.DeviceID })
$drives = @(Get-CimInstance Win32_LogicalDisk |
  Where-Object { $_.DriveType -eq 2 -or $usb -contains $_.DeviceID } |
  Select-Object DeviceID, VolumeName)
ConvertTo-Json -Compress -InputObject $drives
`;

function powershell(script: string): Promise<string> {
  // -EncodedCommand takes the script as base64 UTF-16, so nothing in it
  // needs quoting for the command line.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

const exists = (path: string) => fs.access(path).then(() => true, () => false);

// Drive letters with something in them, but the system drive.
async function windowsLetters(): Promise<string[]> {
  const system = (process.env.SystemDrive ?? 'C:').toUpperCase();
  const letters = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:`).filter((d) => d !== system);
  const present = await Promise.all(letters.map((d) => exists(`${d}\\`)));
  return letters.filter((_, i) => present[i]);
}

let lastLetters = '';
let lastWindowsDrives: UsbDrive[] = [];

async function windowsDrives(): Promise<UsbDrive[]> {
  const letters = (await windowsLetters()).join(',');
  if (letters === lastLetters) return lastWindowsDrives;
  if (letters === '') {
    lastLetters = letters;
    lastWindowsDrives = [];
    return [];
  }
  const parsed = JSON.parse((await powershell(windowsScript)).trim() || '[]') as unknown;
  const list = (Array.isArray(parsed) ? parsed : [parsed]) as { DeviceID?: string; VolumeName?: string }[];
  lastWindowsDrives = list
    .filter((d) => typeof d?.DeviceID === 'string')
    .map((d) => ({ root: `${d.DeviceID}\\`, label: d.VolumeName ? `${d.DeviceID} (${d.VolumeName})` : d.DeviceID! }));
  // Only remembered once Windows has answered, so a failure is asked again.
  lastLetters = letters;
  return lastWindowsDrives;
}

async function mountsIn(folder: string, skip: (path: string) => Promise<boolean> = async () => false): Promise<UsbDrive[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  const drives: UsbDrive[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const root = join(folder, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (await skip(root)) continue;
    drives.push({ root, label: entry.name });
  }
  return drives;
}

async function macDrives(): Promise<UsbDrive[]> {
  // The startup disk is in /Volumes too, as a link to /.
  return mountsIn('/Volumes', async (root) => (await fs.realpath(root).catch(() => root)) === '/');
}

async function linuxDrives(): Promise<UsbDrive[]> {
  const user = userInfo().username;
  const found = [
    ...(await mountsIn(join('/media', user))),
    ...(await mountsIn(join('/run/media', user))),
    // Mounted straight into /media (some systems), not a user's folder.
    ...(await mountsIn('/media', async (root) => root === join('/media', user)))
  ];
  return found.filter((drive, i) => found.findIndex((d) => d.root === drive.root) === i);
}

export async function usbDrives(): Promise<UsbDrive[]> {
  if (process.platform === 'win32') return windowsDrives();
  if (process.platform === 'darwin') return macDrives();
  return linuxDrives();
}
