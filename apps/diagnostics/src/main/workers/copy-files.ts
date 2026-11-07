// A process of its own that copies files for a copy to a USB drive
// (usb-service.ts), so the copy can be cancelled part way through a file: the
// system's file copy can't be stopped once started, but this process can be
// ended, which ends it. One file at a time, as asked: { id, from, to }, and
// answers { id } when it's done, or { id, error, code } when it can't be.

import { copyFile } from 'node:fs/promises';

interface Job {
  id: number;
  from: string;
  to: string;
}

process.parentPort.on('message', async (event) => {
  const { id, from, to } = event.data as Job;
  try {
    await copyFile(from, to);
    process.parentPort.postMessage({ id });
  } catch (error) {
    process.parentPort.postMessage({ id, error: (error as Error).message, code: (error as NodeJS.ErrnoException).code ?? '' });
  }
});
